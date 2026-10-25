#!/usr/bin/env python3
"""Phase 6: render FINDINGS-DETAIL.md and NEEDS-VALIDATION.md mechanically from findings.json,
and the data tables of REPORT.md (narrative sections come from parent/report_*.md)."""
import json, os, sys
from collections import Counter
TOOLS = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, TOOLS)
from ledger import OUT

F = json.load(open(os.path.join(OUT, "findings.json"), encoding="utf-8"))
L = json.load(open(os.path.join(OUT, "coverage-ledger.json"), encoding="utf-8"))
P5 = json.load(open(os.path.join(OUT, "parent", "phase5.json"), encoding="utf-8"))


def trace_md(r):
    out = ["| # | tipo | local | escopo | descrição |", "|---|---|---|---|---|"]
    for i, t in enumerate(r["trace"], 1):
        out.append(f"| {i} | {t['kind']} | `{t['file']}:{t['line']}` | {t['scope'].replace('|', '/')} | {t['description'].replace('|', '/')} |")
    return "\n".join(out)


def evidence_md(r):
    return "\n".join(f"- `{e['file']}:{e['line']}` — {e['description']}" for e in r["evidence"])


conf = [r for r in F if r["verdict"] == "confirmed"]
nv = [r for r in F if r["verdict"] == "needs_validation"]
rej = [r for r in F if r["verdict"] == "rejected"]

# FINDINGS-DETAIL.md: confirmed medium/high/critical (skill rule); low ones are summarized for completeness
D = ["# FINDINGS-DETAIL — run-1", "",
     "Pela regra da skill, este arquivo detalha só os achados `confirmed` de severidade **medium, high ou critical**.",
     f"Nesta run há {len(conf)} confirmado(s), nenhum acima de `low`. O registro completo do achado de severidade baixa",
     "está abaixo, copiado de `findings.json` sem alteração de veredito, severidade ou impacto, para quem for corrigir.", ""]
for r in conf:
    s = r["severity"]
    D += [f"## {r['title']}", "", f"- **fingerprint:** `{r['fingerprint']}`",
          f"- **severidade:** {s['overall_severity']} (probabilidade {s['likelihood']['score']}, impacto {s['impact']['score']}) · confiança {r['confidence']['score']}",
          f"- **verificação independente (Fase 5):** {P5.get(r['fingerprint'], {}).get('decision', 'pendente')}", "",
          "### Descrição", "", r["description"], "", "### Causa raiz", "", r["root_cause"], "",
          "### Comportamento esperado", "", r["intended_behavior"], "", "### Trace", "", trace_md(r), "",
          "### Evidência", "", evidence_md(r), "", "### Condições", ""]
    D += [f"- **{c['kind']}:** {c['description']}" for c in r["conditions"]]
    ex = r["execution"]
    D += ["", "### Reprodução local (sandbox, dados fictícios)", "", f"- **perspectiva:** {ex['attacker_perspective']}", "- **entradas:**"]
    D += [f"  - `{p}`" for p in ex["payloads"]]
    D += ["- **passos:**"] + [f"  {i}. {s_}" for i, s_ in enumerate(ex["instructions"], 1)]
    D += [f"- **resultado observado:** {ex['observed_result']}", "", "### Correção", "", r["remediation"]["strategy"], ""]
    for c in r["remediation"].get("code_changes", []):
        D += [f"`{c['file_name']}`:", "", "```js", c["fixed_code"], "```", ""]
    D += [f"**Severidade — probabilidade:** {s['likelihood']['reason']}", "", f"**Severidade — impacto:** {s['impact']['reason']}", "",
          f"**Confiança:** {r['confidence']['reason']}", ""]
open(os.path.join(OUT, "FINDINGS-DETAIL.md"), "w", encoding="utf-8").write("\n".join(D) + "\n")

# NEEDS-VALIDATION.md
N = ["# NEEDS-VALIDATION — run-1", "",
     "Pistas com caminho no código-fonte já verificado, mas cuja conclusão depende de um fato que o código não mostra",
     "(painel do GitHub, da Vercel ou do Supabase, ou comportamento do provedor). **Não têm severidade e não são",
     "vulnerabilidades confirmadas.** Cada uma traz o bloqueio exato e como resolver sem testar contra o ambiente real.", ""]
for i, r in enumerate(nv, 1):
    N += [f"## NV-{i}. {r['title']}", "", f"- **fingerprint:** `{r['fingerprint']}`",
          f"- **verificação independente (Fase 5):** {P5.get(r['fingerprint'], {}).get('decision', 'pendente')}", "",
          "### Descrição", "", r["description"], "", "### Causa raiz alegada", "", r["claimed_root_cause"], "",
          "### Trace", "", trace_md(r), "", "### Evidência", "", evidence_md(r), "", "### Bloqueios (o que falta observar)", ""]
    N += [f"- {b}" for b in r["blockers"]]
    vp = r["validation_plan"]
    if vp.get("deployment"):
        N += ["", "### Checagem pelo dono (painel, somente leitura)", "", vp["deployment"]]
    if vp.get("local"):
        N += ["", "### Checagem local (sandbox / ambiente isolado)", "", vp["local"]]
    N += [""]
open(os.path.join(OUT, "NEEDS-VALIDATION.md"), "w", encoding="utf-8").write("\n".join(N) + "\n")

# tables for REPORT.md
st = Counter(u["status"] for u in L)
T = {"confirmed_table": "\n".join(["| severidade | título | fronteira afetada | resultado observado |", "|---|---|---|---|"] +
                                    [f"| {r['severity']['overall_severity']} | {r['title']} | credencial de CI `divat_auditor_ci` ↔ servidor Postgres | {r['execution']['observed_result'][:220]}… |" for r in conf]),
     "nv_table": "\n".join(["| # | título | bloqueio principal | próximo passo |", "|---|---|---|---|"] +
                           [f"| NV-{i} | {r['title']} | {r['blockers'][0][:180]}… | ver `NEEDS-VALIDATION.md` §NV-{i} |" for i, r in enumerate(nv, 1)]),
     "coverage": dict(st), "n_units": len(L), "rejected": [(r["fingerprint"], r["title"]) for r in rej]}
json.dump(T, open(os.path.join(OUT, "parent", "report_tables.json"), "w", encoding="utf-8"), indent=2, ensure_ascii=False)
print("ok", len(conf), len(nv), len(rej), dict(st))
