#!/usr/bin/env python3
"""Phase 3/4 parent consolidation: verifier decision -> findings.json + ledger.
Usage: apply_verifier.py <verifier_id> <result.json> <expected_fingerprint>"""
import json, os, subprocess, sys, tempfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ledger import load, save, OUT, SKILL

FINDINGS = os.path.join(OUT, "findings.json")


def validate_records(records):
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, dir=os.path.join(OUT, "parent")) as f:
        json.dump(records, f, ensure_ascii=False)
        tmp = f.name
    r = subprocess.run(["node", os.path.join(SKILL, "validate-findings.cjs"), tmp], capture_output=True, text=True)
    os.unlink(tmp)
    return r.returncode, (r.stdout + r.stderr).strip()[-2500:]


def main(vid, path, fp):
    res = json.load(open(path, encoding="utf-8"))
    dec, rec = res.get("decision"), res.get("record")
    if dec not in ("confirmed", "needs_validation", "rejected") or not isinstance(rec, dict):
        print("MALFORMED verifier result: discard, re-run with a fresh verifier"); sys.exit(2)
    if rec.get("verdict") != dec:
        print(f"MALFORMED: decision {dec} != record.verdict {rec.get('verdict')}"); sys.exit(2)
    if rec.get("fingerprint") != fp:
        print(f"NOTE: fingerprint changed {fp} -> {rec.get('fingerprint')} (needs a genuinely different root cause)"); sys.exit(3)
    rc, out = validate_records([rec])
    if rc != 0:
        print("SCHEMA FAIL:", out); sys.exit(4)
    F = json.load(open(FINDINGS, encoding="utf-8")) if os.path.exists(FINDINGS) else []
    F = [x for x in F if x["fingerprint"] != fp] + [rec]
    F.sort(key=lambda x: x["fingerprint"])
    rc, out = validate_records(F)
    if rc != 0:
        print("FINDINGS FAIL:", out); sys.exit(5)
    json.dump(F, open(FINDINGS, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
    # ledger: record the independent decision as a verifier-owned source check on each linked unit
    L = load()
    paths = sorted({t["file"] for t in rec.get("trace", [])} | {e["file"] for e in rec.get("evidence", [])})
    n = 0
    for u in L:
        if fp in u.get("result_fingerprints", []):
            u["local_checks"].append({"agent_id": vid, "reviewed_paths": paths,
                                      "invariant": f"Phase 3 independent validation of candidate {fp}",
                                      "method": "source", "result": f"verifier decision: {dec}", "artifact": None})
            art_dir = os.path.join(OUT, "agents", vid, "artifacts")
            for fn in sorted(os.listdir(art_dir)) if os.path.isdir(art_dir) else []:
                if fn.endswith(".out") and not os.path.islink(os.path.join(art_dir, fn)):
                    u["local_checks"].append({"agent_id": vid, "reviewed_paths": paths,
                                              "invariant": f"Phase 3 independent local reproduction for {fp}",
                                              "method": "local", "result": f"see artifact; verifier decision: {dec}",
                                              "artifact": f"agents/{vid}/artifacts/{fn}"})
            for p in paths:
                if p not in u["reviewed_paths"]:
                    u["reviewed_paths"].append(p)
            u.setdefault("x_phase3", {})[fp] = {"verifier": vid, "decision": dec}
            n += 1
    print(f"{fp}: {dec} | linked units updated: {n} | findings: {len(F)}")
    sys.exit(save(L))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3])
