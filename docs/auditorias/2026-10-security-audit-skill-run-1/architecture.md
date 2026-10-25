# Architecture — DETRO-Banco-de-Dados @ 539abe2 (run-1)

## 1. Product, principals, protected resources
Public, read-only lookup portal for DETRO/RJ·DIVAT intercity bus lines (itineraries, timetables, fares, fleet, events, companies, portarias). No login. Data is loaded by the owner straight into Supabase project `gontnlfmothfglssbyyk` (sole DB; production and previews both use it: `app.js:170-184`, `src/data/rest.mjs:11-22`).
- **Anonymous visitor** (`anon` Postgres role; legacy anon JWT embedded at `app.js:148-149,174-175`, sent as apikey+Bearer by `src/data/rest.mjs:65-99`): by design SELECT on 15 public catalog tables, EXECUTE on 2 RPCs (`divat_busca_logradouro`, `divat_linhas_regiao`), Realtime `postgres_changes` on 15 tables. Also USAGE on schema `private` + EXECUTE `private.f_unaccent` (`supabase/migrations/20260729034018_phase3_moderate_hardening.sql:41,48`).
- **`authenticated`** (any Supabase Auth user): intended to have nothing (`…034018:85-87`; `20260930172521…:20`). Whether signup is closed is a panel fact.
- **Privileged DB roles**: `postgres`, `service_role`, nologin `divat_audit_owner` (member of `anon`, owns SECURITY DEFINER `audit.*`), `divat_auditor`, login `divat_auditor_ci` (CI secret).
- **Repo/CI principals**: repo writers, workflow dispatchers, same-repo PR authors, Vercel deployment events. GitHub metadata currently reports the repo **private**, while `docs/adr/0003…` records a decision that it is public — visibility is an unobserved deployment fact.
- **AI agents** working in the repo (Claude Code/Codex) with hooks, skills and MCP servers configured in-repo.
- Protected resources: integrity/availability of the shared DB and of the published site; non-public schemas (`private`, `audit`, `divat_integracao`, `divat_historico`, `stage_access_20260928`, staging tables); CI secrets (`SUPABASE_TEST_AUDIT_DATABASE_URL`, `SUPABASE_PROD_AUDIT_DATABASE_URL`, `SUPABASE_BACKUP_DATABASE_URL`, `BACKUP_AGE_PUBLIC_KEY`, `VERCEL_AUTOMATION_BYPASS_SECRET`); `contents: write` tokens; visitors' browsers (script integrity).

## 2. Comparable baseline
Standard Supabase "anon key + RLS" SPA calling PostgREST directly. The comparable accepts a public anon key and relies entirely on DB grants/RLS; any filter the UI builds is also directly reachable through REST. Calibrate client-side "filter injection" against that.

## 3. Stack, deployment paths, offline limits
Zero-build vanilla JS ES modules (`index.html:385` → `app.js` → `src/**/*.mjs`), vendored supabase-js 2.110.7 injected at runtime (`app.js:1626-1632`), static hosting on Vercel with headers in `vercel.json:1-16` (CSP `script-src 'self'`, `style-src-attr 'none'`, `connect-src` only the project, `frame-ancestors 'none'`) and a deny-all `.vercelignore` allowlist. 21 SQL migrations; historical baseline `docs/backup_schema.sql` (does not rebuild current DB). 12 GitHub workflows, Node/Python/shell scripts. Offline: Node 22, Playwright 1.56.1 + Chromium, semgrep in `.venv-semgrep`; no Postgres server/Supabase CLI — live grants, RLS, PostgREST exposed schemas, Auth settings, Vercel/GitHub panel state cannot be observed.

## 4. Entry surfaces and key paths
- DB rows → HTML strings → `innerHTML` (~135 sinks; escaper `esc` `src/domain/core.mjs:14`; raw-by-contract `metaRows`/`tableHTML` `src/ui/doc.mjs:36,49`; `fmtDate/fmtTime` return non-matching input verbatim `core.mjs:12-13`); PDF export reparses `pdfHTML()`/`outerHTML` (`app.js:981-999`); `data-row` JSON round-trip (`app.js:541,594,1191`).
- URL hash routes (`app.js:1701-1738`) → `VIEW_META/VIEW_TOPIC/LOADERS/VIEW_TABLES[view]` plain-object lookups.
- Search terms → PostgREST filters via `ilikeTerm` (`core.mjs:16`) / `orIlike` (`src/domain/busca.mjs:37`) and RPC args (`src/documentos/municipios-localidades.mjs:54,108`).
- Realtime callbacks (`app.js:1596-1613`, `src/domain/view-state.mjs:115-119`); version auto-reload via HEAD `/version.json` ETag (`app.js:1643-1665`).
- Workflows: same-repo `pull_request` jobs with DB auditor secret (`db-checks.yml:79-144`, `deriva.yml:47-75`); `deployment_status`/dispatch smoke with Vercel bypass secret and free-text URL (`deploy-smoke.yml`, `scripts/check_deploy.mjs:22-61`); dispatch-only write workflows with persisted tokens (`atualizar-baseline.yml:59-161`, `atualizar-semgrep-rulesets.yml:38-301`); backups (`backup.yml`, `backup-private.yml`).
- Scripts: `scripts/lib/audit-database.mjs` (psql, `sslmode=require` accepted), `backup_rest.mjs`, `restore_rest.mjs`, `backup_private.py`, `recover_access_memos.py`, `check_migrations.mjs` (regex gate).
- Agent tooling: SessionStart hooks run `npm install -g`/`pip install` (`.claude/hooks/session-start.sh:39-121`) and inject repo text as top-priority context (`.claude/hooks/superpowers-session-start.sh`); `.mcp.json` (remote Supabase MCP `read_only=true`, local graft via `npx --yes`); `.codex/config.toml:2` references the deleted project; skills with executable helpers (brainstorming local HTTP/WS server).

## 5. Trust boundaries and strongest visible control
- anon ↔ DB: table GRANT/RLS + RESTRICTIVE write blocks (`20260930213009…:20-70`), RPC EXECUTE allowlist (`…034018:87-115`); live state unobserved.
- DB content ↔ visitor DOM: `esc` + CSP without `unsafe-inline`.
- PR/branch code ↔ CI secrets: fork-exclusion `if:` only; no `environment:`.
- Deployment URL ↔ bypass secret: host allowlist regex in `check_deploy.mjs:29-44`.
- Repo content ↔ AI agent authority: none beyond pins (`scripts/graft.sh:6`, `skills-lock.json`).
- Migrations ↔ live posture: `scripts/check_migrations.mjs` (regex) + daily `scripts/check_grants.mjs` (public schema only).

## 6. Starting paths
`app.js`, `src/`, `index.html`, `vercel.json`, `.vercelignore`, `supabase/migrations/`, `docs/backup_schema.sql`, `.github/workflows/`, `scripts/`, `tests/`, `.claude/`, `.agents/`, `.codex/`, `.mcp.json`.

## 7. Prior coverage
No prior run of this skill. Prior non-skill reviews (Codex AUD-*, issue #121, SEC-* in `docs/seguranca.md`) are context only, not coverage.

## 8. Companion selection
CLIENT-SIDE (DOM `innerHTML` sinks, hash routing, plain-object lookups); WEB-PROTOCOL-AND-AUTH (API-key scope/exposure: anon key, auditor transport, bypass secret); SUPPLY-CHAIN-AND-RELEASE (workflows with secrets/write tokens, mutable installs, vendored code, agent plugins/hooks); CLOUD-AND-DEPLOYMENT (secret exposure across CI workloads, control precedence drift migrations↔live and vercel.json↔dashboard, edge file set); DATA-ISOLATION-AND-LIFECYCLE (public vs private/staging schemas, migration defaults, backup/restore scope, diagnostics as alternate readers); RESOURCE-EXHAUSTION (anon-reachable query amplification on the shared DB, retry/reload fan-out); AI-AND-LLM (repo/issue text and MCP servers feeding agents with write/DB tools); DESKTOP-MOBILE-AND-LOCAL-IPC (skill-shipped local HTTP/WS server); PROTOCOLS-RPC-AND-MESSAGING (Realtime channel as control input). Not selected: MEMORY-SAFETY-AND-BINARY (no native code; the only binary parser is Python).
