#!/usr/bin/env python3
"""Trusted parent-side runner for one bounded local check (security-audit skill).

Usage (run as root, with python3 -I):
  run_check.py --agent-dir <OUT>/agents/<id> --check NN [--timeout S] [--cwd DIR]
               [--loopback] [--env NAME=VALUE ...] [--promote REL ...] -- cmd args...

Guarantees (fail closed if any cannot be enforced):
  * fresh mount/net/pid/ipc/uts namespaces; no external network (loopback only on request)
  * whole filesystem read-only; only the agent's parent-mounted tmpfs scratch is writable
    (/tmp and /dev/shm are bound into scratch)
  * uid/gid 65534, no capabilities, no_new_privs
  * empty environment populated only from an allowlist with validated values
  * cgroup memory/pids/cpu limits + rlimits (cpu, fsize, nofile, nproc, core) + wall clock
  * after every sandboxed process is gone, promotes only allowlisted scratch files using
    retained directory descriptors, no-follow traversal, regular-file + nlink==1 checks,
    per-file and cumulative byte bounds, and exclusive destination creation.
"""
import argparse, hashlib, json, os, re, signal, stat, subprocess, sys, time

TOOLS = os.path.dirname(os.path.abspath(__file__))
INNER = os.path.join(TOOLS, "sandbox_inner.sh")
OUT_ROOT = os.environ.get("SBX_OUT_ROOT") or open(os.path.join(TOOLS, "out_root")).read().strip()
AGENT_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
WIN_DEV = {"con", "prn", "aux", "nul"} | {f"com{i}" for i in range(1, 10)} | {f"lpt{i}" for i in range(1, 10)}
ENV_ALLOW = {"PLAYWRIGHT_BROWSERS_PATH", "NODE_PATH", "LANG", "TZ", "LC_ALL", "GIT_CONFIG_COUNT", "GIT_CONFIG_KEY_0", "GIT_CONFIG_VALUE_0", "PYTHONDONTWRITEBYTECODE", "DIVAT_CHROMIUM_EXECUTABLE", "NO_PROXY"}
ENV_VAL_RE = re.compile(r"^[A-Za-z0-9_./:@+-]*$")
MEM_LIMIT = 2 * 1024**3
PIDS_MAX = 256
CPU_S = 120
FSIZE = 16 * 1024**2
NOFILE = 1024
NPROC = 256


def die(msg, code=2):
    print(json.dumps({"ok": False, "error": msg}))
    sys.exit(code)


def open_dir_nofollow(path):
    # Walk an absolute trusted path component by component without following symlinks.
    fd = os.open("/", os.O_RDONLY | os.O_DIRECTORY)
    for comp in [c for c in path.split("/") if c]:
        nfd = os.open(comp, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
        os.close(fd)
        fd = nfd
    return fd  # O_CLOEXEC is Python's default (non-inheritable)


def is_tmpfs_mount(path):
    with open("/proc/self/mountinfo") as f:
        for line in f:
            parts = line.split()
            sep = parts.index("-")
            if parts[4] == path and parts[sep + 1] == "tmpfs":
                return True
    return False


def ensure_subdir(scr_fd, name):
    try:
        st = os.stat(name, dir_fd=scr_fd, follow_symlinks=False)
        if not stat.S_ISDIR(st.st_mode):
            die(f"scratch/{name} exists and is not a real directory")
    except FileNotFoundError:
        os.mkdir(name, 0o700, dir_fd=scr_fd)
    fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=scr_fd)
    os.fchown(fd, 65534, 65534)
    os.fchmod(fd, 0o700)
    os.close(fd)


def validate_rel(rel):
    if not rel or rel.startswith("/"):
        raise ValueError("absolute or empty path")
    comps = rel.split("/")
    if any(c in ("", ".", "..") for c in comps):
        raise ValueError("empty, '.' or '..' component")
    return comps


def promote(scr_fd, art_fd, rel, per_file_max, budget_left):
    comps = validate_rel(rel)
    opened = []
    try:
        cur = scr_fd
        for c in comps[:-1]:
            cur = os.open(c, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=cur)
            opened.append(cur)
        src = os.open(comps[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=cur)
        opened.append(src)
        st1 = os.fstat(src)
        if not stat.S_ISREG(st1.st_mode):
            raise ValueError("not a regular file")
        if st1.st_nlink != 1:
            raise ValueError("link count != 1")
        limit = min(per_file_max, budget_left)
        if st1.st_size > limit:
            raise ValueError(f"size {st1.st_size} exceeds bound {limit}")
        chunks, total = [], 0
        while True:
            b = os.read(src, 65536)
            if not b:
                break
            total += len(b)
            if total > limit:
                raise ValueError("size bound exceeded while reading")
            chunks.append(b)
        data = b"".join(chunks)
        if len(data) != st1.st_size:
            raise ValueError("read size differs from fstat size")
        st2 = os.fstat(src)
        if (st2.st_ino, st2.st_dev, st2.st_mode, st2.st_nlink, st2.st_size) != (
            st1.st_ino, st1.st_dev, st1.st_mode, st1.st_nlink, st1.st_size):
            raise ValueError("file identity/type/link count/size changed")
        dcur = art_fd
        for c in comps[:-1]:
            try:
                os.mkdir(c, 0o700, dir_fd=dcur)
            except FileExistsError:
                pass
            nd = os.open(c, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=dcur)
            opened.append(nd)
            if not stat.S_ISDIR(os.fstat(nd).st_mode):
                raise ValueError("destination component is not a directory")
            dcur = nd
        dst = os.open(comps[-1], os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=dcur)
        opened.append(dst)
        dst_st = os.fstat(dst)
        if not stat.S_ISREG(dst_st.st_mode) or dst_st.st_nlink != 1:
            raise ValueError("destination is not a fresh regular file")
        view = memoryview(data)
        while view:
            n = os.write(dst, view)
            view = view[n:]
        os.fsync(dst)
        return len(data), hashlib.sha256(data).hexdigest()
    finally:
        for fd in reversed(opened):
            try:
                os.close(fd)
            except OSError:
                pass


def artifacts_bytes(art_fd):
    total = 0
    for entry in os.scandir(art_fd):
        st = entry.stat(follow_symlinks=False)
        if stat.S_ISREG(st.st_mode):
            total += st.st_size
    return total


def cgroup_setup(name):
    paths = {}
    for ctl, settings in (
        ("memory", {"memory.limit_in_bytes": str(MEM_LIMIT)}),
        ("pids", {"pids.max": str(PIDS_MAX)}),
        ("cpu", {"cpu.cfs_period_us": "100000", "cpu.cfs_quota_us": "100000"}),
    ):
        p = f"/sys/fs/cgroup/{ctl}/{name}"
        os.makedirs(p, exist_ok=True)
        for k, v in settings.items():
            with open(os.path.join(p, k), "w") as f:
                f.write(v)
        paths[ctl] = p
    sw = os.path.join(paths["memory"], "memory.memsw.limit_in_bytes")
    if os.path.exists(sw):
        with open(sw, "w") as f:
            f.write(str(MEM_LIMIT))
    return paths


def cgroup_procs(p):
    with open(os.path.join(p, "cgroup.procs")) as f:
        return [l.strip() for l in f if l.strip()]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--agent-dir", required=True)
    ap.add_argument("--check", required=True)
    ap.add_argument("--timeout", type=int, default=120)
    ap.add_argument("--cwd", default="/home/user/DETRO-Banco-de-Dados")
    ap.add_argument("--loopback", action="store_true")
    ap.add_argument("--env", action="append", default=[])
    ap.add_argument("--promote", action="append", default=[])
    ap.add_argument("cmd", nargs=argparse.REMAINDER)
    a = ap.parse_args()
    cmd = a.cmd[1:] if a.cmd and a.cmd[0] == "--" else a.cmd
    if not cmd:
        die("no command")
    if os.geteuid() != 0:
        die("must run as root (namespaces)")
    agent_dir = os.path.realpath(a.agent_dir)
    agents_root = os.path.join(OUT_ROOT, "agents")
    if os.path.dirname(agent_dir) != agents_root:
        die(f"agent dir must be directly under {agents_root}")
    agent_id = os.path.basename(agent_dir)
    if not AGENT_RE.match(agent_id) or agent_id in WIN_DEV:
        die("unsafe agent id")
    if not re.fullmatch(r"[0-9]{2}", a.check):
        die("--check must be two digits")
    if not (1 <= a.timeout <= 600):
        die("timeout out of range 1..600")
    envs = ["LANG=C.UTF-8", "PATH=/opt/node22/bin:/usr/local/bin:/usr/bin:/bin",
            "HOME=/sbx/scratch/home", "TMPDIR=/sbx/scratch/tmp"]
    for e in a.env:
        if "=" not in e:
            die(f"bad env {e!r}")
        k, v = e.split("=", 1)
        if k not in ENV_ALLOW or not ENV_VAL_RE.match(v):
            die(f"env {k} not allowlisted or value unsafe")
        envs.append(f"{k}={v}")
    cwd = a.cwd
    if not cwd.startswith("/") or "\n" in cwd:
        die("cwd must be absolute")

    with open(os.path.join(agent_dir, "promotion.json")) as f:
        pol = json.load(f)
    allow = set(pol["allow"])
    per_file_max = int(pol["per_file_max"])
    cumulative_max = int(pol["cumulative_max"])
    outname = f"check-{a.check}.out"
    to_promote = [outname] + a.promote
    for rel in to_promote:
        if rel not in allow:
            die(f"{rel} is not in the parent allowlist")

    scratch_path = os.path.join(agent_dir, "scratch")
    if not is_tmpfs_mount(scratch_path):
        die("scratch is not a parent-mounted tmpfs")
    scr_fd = open_dir_nofollow(scratch_path)
    art_fd = open_dir_nofollow(os.path.join(agent_dir, "artifacts"))
    for rel in to_promote:
        try:
            os.stat(rel, dir_fd=scr_fd, follow_symlinks=False)
            die(f"scratch/{rel} already exists; use a fresh check number / name")
        except FileNotFoundError:
            pass
        try:
            os.stat(rel.split("/")[0], dir_fd=art_fd, follow_symlinks=False)
            if "/" not in rel:
                die(f"artifacts/{rel} already exists")
        except FileNotFoundError:
            pass
    for d in ("tmp", "home", "shm"):
        ensure_subdir(scr_fd, d)

    root = f"/run/sbx-root-{agent_id}-{a.check}"
    os.makedirs(root, exist_ok=True)
    os.makedirs("/sbx/scratch", exist_ok=True)
    cg = cgroup_setup(f"sbx-{agent_id}-{a.check}")
    attach = " && ".join(f'echo $$ > {p}/cgroup.procs' for p in cg.values())
    inner_args = [root, scratch_path, cwd, outname, str(a.timeout), "1" if a.loopback else "0",
                  str(CPU_S), str(FSIZE), str(NOFILE), str(NPROC)] + envs + ["--"] + cmd
    shell = f'{attach} && exec unshare --mount --net --pid --ipc --uts --fork --kill-child /bin/sh "$0" "$@"'
    t0 = time.time()
    p = subprocess.Popen(["/bin/sh", "-c", shell, INNER] + inner_args,
                         env={"PATH": "/usr/sbin:/usr/bin:/sbin:/bin"}, close_fds=True,
                         stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    try:
        setup_out, _ = p.communicate(timeout=a.timeout + 30)
    except subprocess.TimeoutExpired:
        p.kill()
        setup_out, _ = p.communicate()
    wall = round(time.time() - t0, 2)
    # Ensure every sandboxed process is gone before promotion.
    for _ in range(50):
        if not any(cgroup_procs(x) for x in cg.values()):
            break
        for x in cg.values():
            for pid in cgroup_procs(x):
                try:
                    os.kill(int(pid), signal.SIGKILL)
                except ProcessLookupError:
                    pass
        time.sleep(0.1)
    if any(cgroup_procs(x) for x in cg.values()):
        die("sandboxed processes did not terminate; nothing promoted")
    for x in cg.values():
        try:
            os.rmdir(x)
        except OSError:
            pass
    try:
        os.rmdir(root)
    except OSError:
        pass

    promoted, errors = [], []
    used = artifacts_bytes(art_fd)
    for rel in to_promote:
        try:
            n, h = promote(scr_fd, art_fd, rel, per_file_max, cumulative_max - used)
            used += n
            promoted.append({"artifact": f"agents/{agent_id}/artifacts/{rel}", "bytes": n, "sha256": h})
        except Exception as e:  # discard the scratch entry on any failure
            errors.append({"file": rel, "error": str(e)})
            try:
                os.unlink(rel, dir_fd=scr_fd)
            except OSError:
                pass
    manifest = {
        "agent_id": agent_id, "check": a.check, "command": cmd, "cwd": cwd,
        "env_allowlist": envs, "loopback": a.loopback,
        "limits": {"wall_clock_s": a.timeout, "cpu_rlimit_s": CPU_S, "cgroup_cpu": "1 core",
                   "cgroup_memory_bytes": MEM_LIMIT, "cgroup_pids_max": PIDS_MAX,
                   "fsize_bytes": FSIZE, "nofile": NOFILE, "nproc": NPROC,
                   "scratch_tmpfs": "64MiB", "network": "none (new netns)",
                   "filesystem": "read-only except scratch", "uid": 65534},
        "exit_status": p.returncode, "wall_s": wall,
        "setup_output": setup_out.decode("utf-8", "replace")[-2000:],
        "promoted": promoted, "promotion_errors": errors,
    }
    mfd = os.open(f"check-{a.check}.manifest.json", os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=art_fd)
    os.write(mfd, json.dumps(manifest, indent=2).encode())
    os.close(mfd)
    manifest["manifest"] = f"agents/{agent_id}/artifacts/check-{a.check}.manifest.json"
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
