# Auditoria de segurança — run-1 (skill `cloudflare/security-audit-skill`)

> **Estado: CONCLUÍDA — todas as 6 fases; run_status: complete** · atualizado em 2026-10-13 15:06 UTC.
> Os achados em `findings.json` já passaram pela verificação independente.

Perfil `standard`, commit auditado `539abe2`, execução só sobre o código e testes locais em sandbox (sem rede, FS somente-leitura, uid 65534). Nada foi enviado ao banco, à Vercel ou ao GitHub.

## Cobertura (`coverage-ledger.json`)

| status | unidades |
|---|---|
| blocked | 2 |
| candidate | 5 |
| covered | 15 |
| **total** | **22** |

## Registros finais (`findings.json`, verificados nas Fases 3 e 5)

- **needs_validation** — `deploy-smoke.yml:deployment-status:checkout-deployment-sha-with-bypass-secret`
- **needs_validation** — `github-workflows/backup-private.yml:SUPABASE_BACKUP_DATABASE_URL:repo-scoped-secret-unbound-to-ref`
- **needs_validation** — `realtime:anon-postgres-changes:bulk-publication-subscription-amplification`
- **rejected** — `scripts/check_grants.mjs:--atualizar-baseline:grave-findings-baselined-without-refusal`
- **confirmed** (low) — `scripts/lib/audit-database.mjs:SSLMODES_ACEITOS:sslmode-require-unverified-server`

Leia primeiro o `REPORT.md` (em português). Detalhes: `FINDINGS-DETAIL.md` e `NEEDS-VALIDATION.md`.

## Onde está cada coisa

- `architecture.md` — mapa do sistema, fronteiras de confiança, escolha das classes de ataque.
- `coverage-ledger.json` — uma unidade por superfície × fronteira × subsistema × classe; quem revisou, o quê e com que evidência.
- `parent/results/` — resposta estruturada de cada caçador; `parent/candidates/` — candidatos; `parent/uncovered.json` — lacunas apontadas.
- `agents/<id>/artifacts/` — saída dos testes locais rodados no sandbox (promovidas com checagens no-follow) + manifesto com comando e limites.
- `tools/` — o sandbox (`run_check.py`, `sandbox_inner.sh`) e os scripts do coordenador.
