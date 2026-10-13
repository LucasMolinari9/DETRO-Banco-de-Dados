#!/usr/bin/env python3
"""Parent-only ledger helpers: canonical coverage_id derivation, load/save, validation."""
import json, os, subprocess, unicodedata

TOOLS = os.path.dirname(os.path.abspath(__file__))
OUT = open(os.path.join(TOOLS, "out_root")).read().strip()
SKILL = open(os.path.join(TOOLS, "skill_dir")).read().strip()
LEDGER = os.path.join(OUT, "coverage-ledger.json")
UNRESERVED = set(b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")


def enc(ref):
    assert ref == ref.strip() and ref and unicodedata.normalize("NFC", ref) == ref, ref
    return "".join(chr(b) if b in UNRESERVED else "%%%02X" % b for b in ref.encode("utf-8"))


def cid(refs):
    parts = [enc(refs[k]) for k in ("surface", "boundary", "subsystem", "attack_class")]
    if "lifecycle" in refs:
        parts.append(enc(refs["lifecycle"]))
    return "::".join(parts)


def unit(refs, labels, starting_paths, ordinary, companions, excluded, prior_status="none", wave=1):
    u = {
        "coverage_id": cid(refs),
        "canonical_refs": refs,
        "surface": labels["surface"], "boundary": labels["boundary"],
        "subsystem": labels["subsystem"], "attack_class": labels["attack_class"],
        "starting_paths": starting_paths,
        "ordinary_attack_class_block": ordinary,
        "selected_companion_blocks": companions,
        "excluded_blocks": excluded,
        "prior_status": prior_status,
        "attempts": [], "wave": wave, "status": "planned", "agent_id": None,
        "reviewed_paths": [], "local_checks": [], "result_fingerprints": [], "unresolved": [],
    }
    if "lifecycle" in refs:
        u["lifecycle"] = labels["lifecycle"]
    return u


def load():
    return json.load(open(LEDGER, encoding="utf-8"))


def save(units):
    ids = [u["coverage_id"] for u in units]
    assert len(ids) == len(set(ids)), "duplicate coverage_id"
    units.sort(key=lambda u: u["coverage_id"])
    with open(LEDGER, "w", encoding="utf-8") as f:
        json.dump(units, f, indent=2, ensure_ascii=False)
    return validate()


def validate():
    r = subprocess.run(["node", os.path.join(SKILL, "validate-coverage-ledger.cjs"), LEDGER],
                       capture_output=True, text=True)
    print(r.stdout.strip()[-3000:], r.stderr.strip()[-3000:])
    return r.returncode
