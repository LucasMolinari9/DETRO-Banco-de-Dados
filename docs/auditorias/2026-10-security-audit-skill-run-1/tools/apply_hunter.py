#!/usr/bin/env python3
"""Parent consolidation of one hunter result into the coverage ledger (HUNTING.md rules).
Usage: apply_hunter.py <agent_id> <result.json>"""
import json, os, re, stat, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ledger import load, save, OUT

AGENT_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
FP_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$")
TARGET = "/home/user/DETRO-Banco-de-Dados"
CAND_DIR = os.path.join(OUT, "parent", "candidates")
UNC_FILE = os.path.join(OUT, "parent", "uncovered.json")


def safe_rel(p):
    return isinstance(p, str) and p and not p.startswith("/") and all(s not in ("", ".", "..") for s in p.split("/"))


def artifact_ok(path, owner):
    if not isinstance(path, str) or not path.startswith(f"agents/{owner}/artifacts/") or not safe_rel(path):
        return False
    full = os.path.join(OUT, path)
    try:
        st = os.lstat(full)
    except FileNotFoundError:
        return False
    return stat.S_ISREG(st.st_mode) and st.st_nlink == 1


def main(agent_id, result_path):
    res = json.load(open(result_path, encoding="utf-8"))
    L = load()
    by_id = {u["coverage_id"]: u for u in L}
    mine = {c for c, u in by_id.items() if u["agent_id"] == agent_id and u["status"] == "in_progress"}
    seen, problems = set(), []
    fps_declared = {c.get("fingerprint") for c in res.get("candidates", [])}
    for r in res.get("units", []):
        cid = r.get("coverage_id")
        if cid not in mine or cid in seen:
            problems.append(f"unassigned/duplicate unit {str(cid)[:60]}")
            continue
        seen.add(cid)
        u = by_id[cid]
        disp, checks = r.get("disposition"), r.get("checks") or []
        err = None
        if disp not in ("covered", "candidate", "blocked"):
            err = "bad disposition"
        elif not checks or not r.get("reviewed_paths"):
            err = "missing paths/checks"
        else:
            union = []
            for ch in checks:
                if not AGENT_RE.match(str(ch.get("agent_id", ""))) or not ch.get("reviewed_paths") or not all(safe_rel(p) for p in ch["reviewed_paths"]):
                    err = "bad check owner/paths"; break
                if ch.get("method") == "source" and ch.get("artifact") is not None:
                    err = "source check with artifact"; break
                if ch.get("method") == "local" and not artifact_ok(ch.get("artifact"), ch["agent_id"]):
                    err = f"local artifact not promoted: {ch.get('artifact')}"; break
                if ch.get("method") not in ("source", "local"):
                    err = "bad method"; break
                for p in ch["reviewed_paths"]:
                    if p not in union:
                        union.append(p)
            if not err and sorted(union) != sorted(set(r["reviewed_paths"])):
                # parent normalizes unit-level paths to the exact union of check paths
                r["reviewed_paths"] = union
            fps = r.get("candidate_fingerprints") or []
            if not err:
                if disp == "candidate" and (not fps or not all(FP_RE.match(f) for f in fps)):
                    err = "candidate without valid fingerprints"
                elif disp != "candidate" and fps:
                    err = "fingerprints on non-candidate unit"
                elif disp == "covered" and r.get("unresolved"):
                    err = "covered with unresolved"
                elif disp == "blocked" and not r.get("unresolved"):
                    err = "blocked without unresolved"
                elif disp == "candidate" and not set(fps) <= fps_declared:
                    err = "fingerprint without candidate record"
        if err:
            problems.append(f"{cid[:60]}: {err} -> left planned")
            u.update(status="planned", agent_id=None, reviewed_paths=[], local_checks=[], result_fingerprints=[], unresolved=[])
            continue
        keep = ("agent_id", "reviewed_paths", "invariant", "method", "result", "artifact")
        u["status"] = disp
        u["reviewed_paths"] = r["reviewed_paths"]
        u["local_checks"] = [{k: ch.get(k) for k in keep} for ch in checks]
        u["result_fingerprints"] = r.get("candidate_fingerprints") or []
        u["unresolved"] = r.get("unresolved") or []
        u["x_hardening"] = res.get("hardening", [])
    for cid in mine - seen:
        problems.append(f"{cid[:60]}: absent from result -> left planned")
        by_id[cid].update(status="planned", agent_id=None)
    os.makedirs(CAND_DIR, exist_ok=True)
    for c in res.get("candidates", []):
        fp = c.get("fingerprint")
        if not fp or not FP_RE.match(fp):
            problems.append(f"candidate with bad fingerprint {fp}")
            continue
        safe = fp.replace("/", "__").replace(":", "_")
        path = os.path.join(CAND_DIR, f"{safe}.{agent_id}.json")
        c["_x_source_agent"] = agent_id
        json.dump(c, open(path, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
    unc = json.load(open(UNC_FILE)) if os.path.exists(UNC_FILE) else []
    for x in res.get("uncovered", []):
        x["_x_source_agent"] = agent_id
        unc.append(x)
    json.dump(unc, open(UNC_FILE, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
    print("problems:", problems or "none")
    rc = save(L)
    sys.exit(rc)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
