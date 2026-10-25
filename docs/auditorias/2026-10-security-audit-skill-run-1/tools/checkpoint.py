#!/usr/bin/env python3
"""Copy the current run state into docs/auditorias/<run>/ in the target repo and write STATUS.md.
Does not commit. Usage: checkpoint.py "<etapa atual>" """
import json, os, shutil, sys, datetime

TOOLS = os.path.dirname(os.path.abspath(__file__))
OUT = open(os.path.join(TOOLS, "out_root")).read().strip()
REPO = "/home/user/DETRO-Banco-de-Dados"
DEST = os.path.join(REPO, "docs", "auditorias", "2026-10-security-audit-skill-run-1")
SKIP_TOOLS = {"out_root", "skill_dir", "taskmap.json", "__pycache__"}

etapa = sys.argv[1] if len(sys.argv) > 1 else "em andamento"
if os.path.exists(DEST):
    shutil.rmtree(DEST)
os.makedirs(DEST)
for f in ("architecture.md", "run-metadata.json", "coverage-ledger.json", "findings.json",
          "REPORT.md", "FINDINGS-DETAIL.md", "NEEDS-VALIDATION.md"):
    p = os.path.join(OUT, f)
    if os.path.exists(p):
        shutil.copy2(p, DEST)
# parent bookkeeping: hunter/verifier results, candidates, uncovered (no raw transcripts)
src_parent = os.path.join(OUT, "parent")
if os.path.isdir(src_parent):
    for root, dirs, files in os.walk(src_parent):
        for fn in files:
            if fn.endswith(".raw.txt"):
                continue
            rel = os.path.relpath(os.path.join(root, fn), src_parent)
            os.makedirs(os.path.join(DEST, "parent", os.path.dirname(rel)), exist_ok=True)
            shutil.copy2(os.path.join(root, fn), os.path.join(DEST, "parent", rel))
# promoted evidence only: artifacts referenced by ledger checks (+ their trusted manifests)
L0 = json.load(open(os.path.join(OUT, "coverage-ledger.json")))
refs = set()
for u in L0:
    for ch in u.get("local_checks", []) + [c for a in u.get("attempts", []) for c in a.get("local_checks", [])]:
        if ch.get("artifact"):
            refs.add(ch["artifact"])
for fnd in (json.load(open(os.path.join(OUT, "findings.json"))) if os.path.exists(os.path.join(OUT, "findings.json")) else []):
    pass
for a in sorted(refs):
    parts = a.split("/")
    if len(parts) != 4 or parts[0] != "agents" or parts[2] != "artifacts":
        continue
    src = os.path.join(OUT, a)
    if not os.path.isfile(src) or os.path.islink(src):
        continue
    os.makedirs(os.path.join(DEST, "agents", parts[1], "artifacts"), exist_ok=True)
    shutil.copy2(src, os.path.join(DEST, a))
    base = parts[3].split(".")[0]
    man = os.path.join(OUT, "agents", parts[1], "artifacts", base + ".manifest.json")
    if os.path.isfile(man):
        shutil.copy2(man, os.path.join(DEST, "agents", parts[1], "artifacts", base + ".manifest.json"))
# trusted sandbox tooling, for reproducibility
os.makedirs(os.path.join(DEST, "tools"))
for f in sorted(os.listdir(TOOLS)):
    p = os.path.join(TOOLS, f)
    if f in SKIP_TOOLS or not os.path.isfile(p) or f.startswith("wave"):
        continue
    shutil.copy2(p, os.path.join(DEST, "tools", f))

L = json.load(open(os.path.join(OUT, "coverage-ledger.json")))
from collections import Counter
c = Counter(u["status"] for u in L)
cands = []
cdir = os.path.join(OUT, "parent", "candidates")
if os.path.isdir(cdir):
    for fn in sorted(os.listdir(cdir)):
        d = json.load(open(os.path.join(cdir, fn)))
        cands.append((d.get("fingerprint"), d.get("proposed_verdict"), d.get("title")))
final = os.path.exists(os.path.join(OUT, "findings.json"))
now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
lines = [
    "# Auditoria de segurança — run-1 (skill `cloudflare/security-audit-skill`)", "",
    f"> **Estado: {etapa}** · atualizado em {now}.",
    "> " + ("Os achados em `findings.json` já passaram pela verificação independente." if final else
            "**Nada aqui é achado confirmado ainda.** Os itens em `parent/candidates/` são *candidatos* de caçadores; "
            "só viram `confirmed`/`needs_validation`/`rejected` depois que um verificador novo tenta refutá-los (Fase 3)."), "",
    "Perfil `standard`, commit auditado `539abe2`, execução só sobre o código e testes locais em sandbox "
    "(sem rede, FS somente-leitura, uid 65534). Nada foi enviado ao banco, à Vercel ou ao GitHub.", "",
    "## Cobertura (`coverage-ledger.json`)", "",
    "| status | unidades |", "|---|---|",
] + [f"| {k} | {v} |" for k, v in sorted(c.items())] + [
    f"| **total** | **{len(L)}** |", "",
] + ((["## Registros finais (`findings.json`, verificados nas Fases 3 e 5)", ""] + [f"- **{x['verdict']}**" + (f" ({x['severity']['overall_severity']})" if x['verdict'] == 'confirmed' else "") + f" — `{x['fingerprint']}`" for x in json.load(open(os.path.join(OUT, "findings.json")))] + ["", "Leia primeiro o `REPORT.md` (em português). Detalhes: `FINDINGS-DETAIL.md` e `NEEDS-VALIDATION.md`."]) if final else (["## Candidatos até agora (não verificados)", ""] + ([f"- `{fp}` — proposto **{pv}** — {t}" for fp, pv, t in cands] or ["- nenhum"]))) + [
    "", "## Onde está cada coisa", "",
    "- `architecture.md` — mapa do sistema, fronteiras de confiança, escolha das classes de ataque.",
    "- `coverage-ledger.json` — uma unidade por superfície × fronteira × subsistema × classe; quem revisou, o quê e com que evidência.",
    "- `parent/results/` — resposta estruturada de cada caçador; `parent/candidates/` — candidatos; `parent/uncovered.json` — lacunas apontadas.",
    "- `agents/<id>/artifacts/` — saída dos testes locais rodados no sandbox (promovidas com checagens no-follow) + manifesto com comando e limites.",
    "- `tools/` — o sandbox (`run_check.py`, `sandbox_inner.sh`) e os scripts do coordenador.",
]
open(os.path.join(DEST, "STATUS.md"), "w", encoding="utf-8").write("\n".join(lines) + "\n")
print(DEST, c, len(cands))
