# Auditoria de segurança — run-1 (skill `cloudflare/security-audit-skill`)

> **Estado: Fase 2 em andamento — 6 de 12 caçadores concluídos; reposições rodando** · atualizado em 2026-10-13 02:30 UTC.
> **Nada aqui é achado confirmado ainda.** Os itens em `parent/candidates/` são *candidatos* de caçadores; só viram `confirmed`/`needs_validation`/`rejected` depois que um verificador novo tenta refutá-los (Fase 3).

Perfil `standard`, commit auditado `539abe2`, execução só sobre o código e testes locais em sandbox (sem rede, FS somente-leitura, uid 65534). Nada foi enviado ao banco, à Vercel ou ao GitHub.

## Cobertura (`coverage-ledger.json`)

| status | unidades |
|---|---|
| blocked | 1 |
| candidate | 2 |
| covered | 7 |
| in_progress | 11 |
| **total** | **21** |

## Candidatos até agora (não verificados)

- `deploy-smoke.yml:deployment-status:checkout-deployment-sha-with-bypass-secret` — proposto **needs_validation** — Deploy smoke runs the deployed commit's code with VERCEL_AUTOMATION_BYPASS_SECRET on any successful deployment_status, with no fork or creator guard
- `scripts/lib/audit-database.mjs:SSLMODES_ACEITOS:sslmode-require-unverified-server` — proposto **confirmed** — Auditor DB credential sent over unauthenticated TLS (sslmode=require) and given in cleartext to any interceptor

## Onde está cada coisa

- `architecture.md` — mapa do sistema, fronteiras de confiança, escolha das classes de ataque.
- `coverage-ledger.json` — uma unidade por superfície × fronteira × subsistema × classe; quem revisou, o quê e com que evidência.
- `parent/results/` — resposta estruturada de cada caçador; `parent/candidates/` — candidatos; `parent/uncovered.json` — lacunas apontadas.
- `agents/<id>/artifacts/` — saída dos testes locais rodados no sandbox (promovidas com checagens no-follow) + manifesto com comando e limites.
- `tools/` — o sandbox (`run_check.py`, `sandbox_inner.sh`) e os scripts do coordenador.
