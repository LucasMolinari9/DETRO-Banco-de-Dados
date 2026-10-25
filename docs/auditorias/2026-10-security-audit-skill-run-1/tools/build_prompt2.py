#!/usr/bin/env python3
"""Critic and verifier prompt builders (HUNTING.md coverage critic; VALIDATION-AND-REPORTING.md Phases 3 and 5).

build_prompt2.py critic <agent_id> <post-wave|final-clean>
build_prompt2.py verifier <agent_id> <candidate-file.json> <companion validation block refs...>
build_prompt2.py record <agent_id> <fingerprint> <companion validation block refs...>
"""
import json, os, sys
TOOLS = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, TOOLS)
from blocks import extract, SKILL  # noqa: E402
from build_prompt import fenced_after, schema_branches, OUT, TARGET  # noqa: E402

PROHIBIT = ("Hard prohibitions: no network access (no curl/wget/git fetch/npm/pip), no MCP tools of any kind "
            "(Supabase, Vercel, GitHub, Google Drive, …), no contact with deployed endpoints (Vercel, Supabase project "
            "`gontnlfmothfglssbyyk`, GitHub API), no real secrets, no edits to the target repository or any shared run file. "
            "docs/auditorias/ and the commits after 539abe2 were added by the audit coordinator and are out of scope.")


def sandbox_section(agent_id):
    agent_dir = os.path.join(OUT, "agents", agent_id)
    return f"""## Your paths and the sandbox
- Agent ID: `{agent_id}`. Only writable directory: `{agent_dir}/scratch`. Retained artifacts (parent-owned, read-only for you): `{agent_dir}/artifacts`.
- Promotion allowlist: `check-01.out` … `check-20.out` (stdout+stderr of each check) and `evidence-01.txt` … `evidence-20.txt`; per-file 131072 bytes, cumulative 2097152 bytes.
- The ONLY approved way to execute target-controlled code is the parent's OS-enforced sandbox runner (uid 65534, no capabilities, empty allowlisted env, no external network, filesystem read-only except your scratch seen as `/sbx/scratch` with /tmp and /dev/shm bound into it, cgroup memory 2 GiB / pids 256 / 1 CPU, rlimits cpu 120 s / fsize 16 MiB / nofile 1024 / nproc 256, wall clock):
  `python3 -I {TOOLS}/run_check.py --agent-dir {agent_dir} --check NN [--timeout 1-600] [--cwd /abs/dir] [--loopback] [--env NAME=VALUE] [--promote evidence-NN.txt] -- <command> <args...>`
  Fresh two-digit NN per check. Allowed extra env names: PLAYWRIGHT_BROWSERS_PATH, NODE_PATH, LANG, TZ, LC_ALL, GIT_CONFIG_COUNT/GIT_CONFIG_KEY_0/GIT_CONFIG_VALUE_0, PYTHONDONTWRITEBYTECODE, DIVAT_CHROMIUM_EXECUTABLE, NO_PROXY. Node: /opt/node22/bin/node; global modules /opt/node22/lib/node_modules; Chromium /opt/pw-browsers (launch with --no-sandbox). Target readable at `{TARGET}`. The promoted artifact path printed by the runner (`agents/{agent_id}/artifacts/check-NN.out`) is the only valid local evidence reference.
- {PROHIBIT}
"""


def critic(agent_id, kind):
    arch = open(os.path.join(OUT, "architecture.md"), encoding="utf-8").read()
    ledger_path = os.path.join(OUT, "coverage-ledger.json")
    unc_path = os.path.join(OUT, "parent", "uncovered.json")
    cdir = os.path.join(OUT, "parent", "candidates")
    cands = []
    for fn in sorted(os.listdir(cdir)):
        d = json.load(open(os.path.join(cdir, fn)))
        cands.append({"fingerprint": d["fingerprint"], "proposed_verdict": d.get("proposed_verdict"), "title": d.get("title"), "state": "awaiting Phase 3 validation"})
    hunting = open(os.path.join(SKILL, "HUNTING.md"), encoding="utf-8").read()
    i = hunting.index("## Coverage-critic waves")
    j = hunting.index("The parent rejects proposed units")
    critic_text = hunting[i:j].rstrip()
    P = [f"# Coverage critic ({kind})\n",
         "You are a fresh `research` coverage critic for a defensive source-first security audit. You read source but do not write files (other than nothing), do not run target code, and do not propose findings — only coverage.",
         f"Target repository: `{TARGET}` at commit 539abe2.\n",
         "## Your contract (verbatim from the skill)\n", critic_text, "",
         "## architecture.md (verbatim)\n", arch, "",
         "## Inputs (read these files fully)",
         f"- Full coverage ledger with each unit's assignment block map, reviewed paths, checks and unresolved facts: `{ledger_path}`",
         f"- Gap proposals returned by hunters as `uncovered` (treat as leads, verify against source and the ledger): `{unc_path}`",
         "- Prior-ledger gap summary: none (first run of this skill on this repository). Note: 8 wave-1 hunters were killed by an API rate limit and 4 more were stopped for budget; their units were reassigned to fresh hunters, which is recorded in each unit's `x_notes`.",
         "- Current candidate fingerprints and states:",
         "```json\n" + json.dumps(cands, indent=2, ensure_ascii=False) + "\n```",
         "- The skill's attack-class and companion files (for checking selected/excluded blocks): `" + SKILL + "`",
         "",
         "Check for: unmapped entry points, unchecked parallel paths, missing lifecycle modes, selected companion classes without a unit, unjustified exclusions, units closed without adequate paths/checks, and gaps no unit addresses. Propose a missing unit only with a source-backed reason and only if no existing unit's reviewed paths/checks already settle it. Use the same `FILE.md#Class name` block references as the ledger.",
         f"- {PROHIBIT}",
         "",
         "Return exactly the JSON object shape from the contract above (`missing_units`, `reassign_ids`, `resolved_prior_leads`, `stop`) and nothing else — no prose, no markdown fence.",
         ]
    agent_dir = os.path.join(OUT, "agents", agent_id)
    os.makedirs(agent_dir, exist_ok=True)
    p = os.path.join(agent_dir, "PROMPT.md")
    open(p, "w", encoding="utf-8").write("\n".join(P) + "\n")
    print(p, os.path.getsize(p))


def verifier(agent_id, cand_file, val_blocks):
    c = json.load(open(cand_file, encoding="utf-8"))
    fp = c["fingerprint"]
    L = json.load(open(os.path.join(OUT, "coverage-ledger.json"), encoding="utf-8"))
    linked = [{"coverage_id": u["coverage_id"], "local_checks": u["local_checks"], "reviewed_paths": u["reviewed_paths"]}
              for u in L if fp in u.get("result_fingerprints", [])]
    rec = {k: v for k, v in c.items() if not k.startswith("_x_")}
    arch = open(os.path.join(OUT, "architecture.md"), encoding="utf-8").read()
    vtext = open(os.path.join(SKILL, "VALIDATION-AND-REPORTING.md"), encoding="utf-8").read()
    P = ["# Phase 3 candidate verifier\n",
         f"Target repository (read-only): `{TARGET}` at commit 539abe2. Artifact paths below are relative to the run directory `{OUT}`.\n",
         "## Your instructions (verbatim from the skill)\n",
         "```text\n" + fenced_after("VALIDATION-AND-REPORTING.md", "#### Candidate-verifier prompt") + "\n```\n",
         "```text\n" + fenced_after("VALIDATION-AND-REPORTING.md", "Copy this promotion procedure verbatim into every candidate-verifier prompt") + "\n```\n",
         vtext[vtext.index("A verifier can promote"): vtext.index("The parent checks that each verifier")].strip(), "",
         "## Architecture facts (architecture.md, verbatim)\n", arch, "",
         "## Relevant companion validation blocks (verbatim)\n"]
    for b in val_blocks:
        P.append(f"### {b}\n\n" + extract(b) + "\n")
    P += ["## The candidate (written by a hunter, not by you)\n",
          "```json\n" + json.dumps(rec, indent=2, ensure_ascii=False) + "\n```\n",
          "## Linked coverage-unit checks and artifact paths\n",
          "```json\n" + json.dumps(linked, indent=2, ensure_ascii=False) + "\n```\n",
          "Prior records with the same fingerprint: none.\n",
          sandbox_section(agent_id),
          "## Schema branches (verbatim from report-schema.json): confirmed, needs_validation, rejected\n",
          "```json\n" + schema_branches({"confirmed", "needs_validation", "rejected"}) + "\n```\n",
          "Note: `proposed_verdict` and any `_x_` field are hunter/parent wrapper fields — your `record` must use `verdict` and match exactly one schema branch (additionalProperties: false).",
          "Return exactly one JSON object `{\"decision\": \"confirmed|needs_validation|rejected\", \"record\": {...}}` and nothing else — no prose, no markdown fence."]
    p = os.path.join(OUT, "agents", agent_id, "PROMPT.md")
    open(p, "w", encoding="utf-8").write("\n".join(P) + "\n")
    print(p, os.path.getsize(p))


def record(agent_id, fp, val_blocks):
    F = json.load(open(os.path.join(OUT, "findings.json"), encoding="utf-8"))
    r = [x for x in F if x["fingerprint"] == fp][0]
    L = json.load(open(os.path.join(OUT, "coverage-ledger.json"), encoding="utf-8"))
    linked = [{"coverage_id": u["coverage_id"], "local_checks": u["local_checks"]} for u in L if fp in u.get("result_fingerprints", [])]
    vtext = open(os.path.join(SKILL, "VALIDATION-AND-REPORTING.md"), encoding="utf-8").read()
    i = vtext.index("### Phase 5: Verify the final records with fresh eyes")
    j = vtext.index("Do not apply a Phase 5 replacement as final")
    P = ["# Phase 5 record verifier\n",
         "You are a fresh `research` verifier. You did not hunt or validate this record. Check the structured record itself against current source and evidence; stay inside source/local boundaries.",
         f"Target repository (read-only): `{TARGET}` at commit 539abe2. Artifact paths are relative to `{OUT}`.\n",
         "## Your instructions (verbatim from the skill)\n", vtext[i:j].strip(), "",
         "## Relevant companion validation blocks (verbatim)\n"]
    for b in val_blocks:
        P.append(f"### {b}\n\n" + extract(b) + "\n")
    P += ["## The final record\n", "```json\n" + json.dumps(r, indent=2, ensure_ascii=False) + "\n```\n",
          "## Linked coverage-unit checks\n", "```json\n" + json.dumps(linked, indent=2, ensure_ascii=False) + "\n```\n",
          sandbox_section(agent_id),
          "## Schema branches (verbatim): confirmed, needs_validation, rejected\n",
          "```json\n" + schema_branches({"confirmed", "needs_validation", "rejected"}) + "\n```\n",
          "Return exactly one JSON object — `{\"decision\":\"verified\",\"fingerprint\":\"...\"}` or `{\"decision\":\"replace\",\"reason\":\"...\",\"record\":{...}}` — and nothing else."]
    p = os.path.join(OUT, "agents", agent_id, "PROMPT.md")
    open(p, "w", encoding="utf-8").write("\n".join(P) + "\n")
    print(p, os.path.getsize(p))


if __name__ == "__main__":
    k = sys.argv[1]
    if k == "critic":
        critic(sys.argv[2], sys.argv[3])
    elif k == "verifier":
        verifier(sys.argv[2], sys.argv[3], sys.argv[4:])
    elif k == "record":
        record(sys.argv[2], sys.argv[3], sys.argv[4:])
