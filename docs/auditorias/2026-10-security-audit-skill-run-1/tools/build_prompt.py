#!/usr/bin/env python3
"""Parent-side prompt builder for hunters (HUNTING.md order) and verifiers.

build_prompt.py hunter <agent_id> <coverage_id>...   -> writes agents/<id>/PROMPT.md
build_prompt.py schema                               -> writes tools/schema-*.json
"""
import json, os, re, sys

TOOLS = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, TOOLS)
from blocks import extract, SKILL  # noqa: E402

OUT = open(os.path.join(TOOLS, "out_root")).read().strip()
TARGET = "/home/user/DETRO-Banco-de-Dados"


def fenced_after(fname, heading_prefix):
    text = open(os.path.join(SKILL, fname), encoding="utf-8").read()
    i = text.index(heading_prefix)
    j = text.index("```", i)
    j = text.index("\n", j) + 1
    k = text.index("```", j)
    return text[j:k].rstrip("\n")


def section(fname, heading):
    text = open(os.path.join(SKILL, fname), encoding="utf-8").read()
    i = text.index(heading)
    m = re.search(r"\n## ", text[i + len(heading):])
    return text[i: i + len(heading) + m.start()] if m else text[i:]


def schema_branches(verdicts):
    s = json.load(open(os.path.join(SKILL, "report-schema.json")))
    out = []
    for b in s["items"]["oneOf"]:
        if b["properties"]["verdict"]["const"] in verdicts:
            out.append(b)
    return json.dumps(out, indent=2, ensure_ascii=False)


def hunter(agent_id, cov_ids):
    ledger = json.load(open(os.path.join(OUT, "coverage-ledger.json")))
    by_id = {u["coverage_id"]: u for u in ledger}
    units = [by_id[c] for c in cov_ids]
    peers = sorted(u["coverage_id"] for u in ledger
                   if u["coverage_id"] not in cov_ids and u["status"] in ("in_progress", "planned"))
    arch = open(os.path.join(OUT, "architecture.md"), encoding="utf-8").read()
    sel, exc = [], {}
    for u in units:
        for b in ([u["ordinary_attack_class_block"]] if u["ordinary_attack_class_block"] else []) + u["selected_companion_blocks"]:
            if b not in sel:
                sel.append(b)
        for e in u["excluded_blocks"]:
            exc.setdefault(e["block"], e["reason"])
    for b in sel:
        exc.pop(b, None)
    agent_dir = os.path.join(OUT, "agents", agent_id)
    pol = json.load(open(os.path.join(agent_dir, "promotion.json")))
    P = []
    P.append("# Hunter assignment\n")
    P.append("Your goal is to find source-grounded security invariant failures in your assigned coverage units of the target repository. "
             "You must return exactly one JSON object matching the structured-result contract at the end of this prompt.\n")
    P.append(f"Target repository (read-only for you): `{TARGET}` at commit 539abe2ac670cd2c36e67aa5d4578d248eb0fd9a. All paths you report are repository-relative.\n")
    P.append("## architecture.md (verbatim)\n")
    P.append(arch)
    P.append("\n## Assigned coverage units\n")
    for u in units:
        P.append("```json\n" + json.dumps({k: u[k] for k in (
            "coverage_id", "canonical_refs", "surface", "boundary", "subsystem", "attack_class", "starting_paths",
            "ordinary_attack_class_block", "selected_companion_blocks", "excluded_blocks")}, indent=2, ensure_ascii=False) + "\n```\n")
    P.append("## Selected attack-class blocks (verbatim)\n")
    for b in sel:
        P.append(f"### {b}\n\n" + extract(b) + "\n")
    P.append("## Excluded blocks\n")
    for b, r in sorted(exc.items()):
        P.append(f"- `{b}` — {r}")
    P.append("\n## Core hunting method\n")
    P.append("```text\n" + fenced_after("HUNTING.md", "#### Core hunting method") + "\n```\n")
    P.append("```text\n" + fenced_after("HUNTING.md", "#### Promotion procedure") + "\n```\n")
    P.append("## Core validation rules\n")
    P.append("```text\n" + fenced_after("HUNTING.md", "#### Core validation rules") + "\n```\n")
    P.append("## Exclusions and peer-owned work\n")
    P.append("- Carried same-source prior confirmed exclusions: none (first run of this skill on this repository).")
    P.append("- Peer-owned current coverage IDs (do not duplicate; return a different boundary under `uncovered` instead):")
    for p in peers:
        P.append(f"  - `{p}`")
    P.append("\n## Your paths, sandbox, and result contract\n")
    P.append(f"- Agent ID: `{agent_id}`")
    P.append(f"- Your only writable directory: `{agent_dir}/scratch` (you may create files there, e.g. harness scripts and fixtures). "
             "Do NOT write anywhere else: not the target repository, not `artifacts/`, not the run's shared files, not other agents' directories, not /tmp.")
    P.append(f"- Retained artifacts directory (parent-owned, read-only for you): `{agent_dir}/artifacts`")
    P.append(f"- Promotion allowlist (scratch-relative): `check-01.out` … `check-20.out` (stdout+stderr of each sandboxed check, written automatically) and `evidence-01.txt` … `evidence-20.txt`; per-file limit {pol['per_file_max']} bytes, cumulative limit {pol['cumulative_max']} bytes.")
    P.append(f"""- The ONLY approved way to execute target-controlled code (node tests, harnesses importing target modules, Playwright, scripts from the repo, semgrep over the repo) is the parent's OS-enforced sandbox runner. It runs your command as uid 65534 with no capabilities, an empty allowlisted environment, no external network, the whole filesystem read-only except your scratch (seen inside the sandbox as `/sbx/scratch`; `/tmp` and `/dev/shm` are also redirected into it), cgroup memory 2 GiB / pids 256 / 1 CPU, rlimits cpu 120 s / fsize 16 MiB / nofile 1024 / nproc 256, and a wall-clock timeout. After the sandbox exits, trusted parent code promotes `check-NN.out` (and any `--promote evidence-NN.txt` you name) into `artifacts/` using the promotion procedure, and writes `check-NN.manifest.json` (command, env allowlist, limits, exit status). Invoke it as:

  `python3 -I {TOOLS}/run_check.py --agent-dir {agent_dir} --check NN [--timeout 1-600] [--cwd /abs/dir] [--loopback] [--env NAME=VALUE] [--promote evidence-NN.txt] -- <command> <args...>`

  * `NN` is a fresh two-digit number per check (01–20). The command's stdout+stderr goes to `/sbx/scratch/check-NN.out` automatically.
  * Default cwd is the target repo (read-only). Extra env names allowed: PLAYWRIGHT_BROWSERS_PATH, NODE_PATH, LANG, TZ, LC_ALL, GIT_CONFIG_COUNT, GIT_CONFIG_KEY_0, GIT_CONFIG_VALUE_0 (use `--env GIT_CONFIG_COUNT=1 --env GIT_CONFIG_KEY_0=safe.directory --env GIT_CONFIG_VALUE_0=/home/user/DETRO-Banco-de-Dados` for git as uid 65534), PYTHONDONTWRITEBYTECODE, DIVAT_CHROMIUM_EXECUTABLE, NO_PROXY (values must match `^[A-Za-z0-9_./:@+-]*$`). Node is at /opt/node22/bin/node; global node_modules (playwright etc.) at /opt/node22/lib/node_modules (use `--env NODE_PATH=/opt/node22/lib/node_modules` for CommonJS require, or import by absolute path); Chromium at /opt/pw-browsers (use `--env PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` and launch with `--no-sandbox`). Inside the sandbox, the target is readable at `{TARGET}` and your scratch at `/sbx/scratch`.
  * A harness can import real target modules by absolute path, e.g. `import {{ esc }} from '{TARGET}/src/domain/core.mjs'`. Write harness files into your scratch first (outside the sandbox, with your normal file tools), then run them via the runner.
  * Never run target-controlled code outside this runner. Never install or fetch anything. A local check's ledger `artifact` is the promoted path printed by the runner (`agents/{agent_id}/artifacts/check-NN.out` or `.../evidence-NN.txt`).
- Hard prohibitions: no network access outside the sandbox either (no curl/wget/git fetch/npm/pip), no MCP tools of any kind (Supabase, Vercel, GitHub, Google Drive, Figma, …), no contact with deployed endpoints (Vercel deployments, the Supabase project `gontnlfmothfglssbyyk`, GitHub API), no real secrets, no edits to the target repository or any shared run file.
""")
    P.append(section("HUNTING.md", "## Structured hunter result"))
    P.append("\n### `confirmed` and `needs_validation` branches of report-schema.json (verbatim)\n")
    P.append("```json\n" + schema_branches({"confirmed", "needs_validation"}) + "\n```\n")
    P.append("Return exactly one JSON object and nothing else (no prose, no markdown fence).")
    path = os.path.join(agent_dir, "PROMPT.md")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(P) + "\n")
    print(path, os.path.getsize(path))


if __name__ == "__main__":
    if sys.argv[1] == "hunter":
        hunter(sys.argv[2], sys.argv[3:])
    elif sys.argv[1] == "schema":
        for name, v in (("hunter", {"confirmed", "needs_validation"}), ("all", {"confirmed", "needs_validation", "rejected"})):
            open(os.path.join(TOOLS, f"schema-{name}.json"), "w").write(schema_branches(v))
        print("ok")
