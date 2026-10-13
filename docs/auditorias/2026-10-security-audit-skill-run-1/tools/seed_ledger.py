#!/usr/bin/env python3
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ledger import unit, save
from blocks import extract

AC = "ATTACK-CLASSES.md#"


def comp(file, *classes):
    """Selected companion classes + that companion's Core discipline, Universal moves, Validation rules."""
    out = [f"{file}#Core discipline"] + [f"{file}#{c}" for c in classes] + [f"{file}#Universal moves", f"{file}#Validation rules"]
    return out


def ex(*pairs):
    return [{"block": b, "reason": r} for b, r in pairs]


NOT_NATIVE = ("MEMORY-SAFETY-AND-BINARY.md#Core discipline", "No native/unsafe code in the repository; the only binary parser (scripts/recover_access_memos.py) is Python.")

U = []


def add(surface, boundary, subsystem, attack, labels, paths, ordinary, companions, excluded):
    refs = {"surface": surface, "boundary": boundary, "subsystem": subsystem, "attack_class": attack}
    U.append(unit(refs, labels, paths, ordinary, companions, excluded))


FE = "frontend (index.html, app.js, src/, vendor/, vercel.json, .vercelignore)"
DB = "supabase (supabase/migrations, docs/backup_schema.sql)"
CI = ".github/workflows"
SC = "scripts"
AG = "agent tooling (.claude, .agents, .codex, .mcp.json, AGENTS.md)"

# ---------------- frontend ----------------
add("src/data/rest.mjs#sbFetch response rows rendered via innerHTML", "src/domain/core.mjs#esc", "frontend", AC + "Injection",
    {"surface": "DB rows rendered as HTML strings into innerHTML (app.js, src/documentos, src/ui) incl. PDF re-parse",
     "boundary": "esc() HTML escaping + CSP script-src 'self' (vercel.json)", "subsystem": FE, "attack_class": "Injection → DOM XSS / HTML injection"},
    ["src/domain/core.mjs", "src/ui/doc.mjs", "src/ui/blocos.mjs", "src/ui/listas.mjs", "src/ui/empresas.mjs", "src/ui/paginacao.mjs",
     "src/documentos", "app.js", "vercel.json"],
    AC + "Injection", comp("CLIENT-SIDE.md", "DOM-based XSS", "DOM clobbering"),
    ex(("CLIENT-SIDE.md#`postMessage` origin and source trust", "No postMessage/message listener in app.js or src/ (grep)."),
       ("CLIENT-SIDE.md#Browser-storage disclosure and stale authorization", "No localStorage/sessionStorage/IndexedDB use; Realtime client persistSession:false (app.js:1607-1609)."),
       ("CLIENT-SIDE.md#Service-worker registration and scope takeover", "No service worker registered."),
       ("AI-AND-LLM.md#Insecure output rendering", "No model output is rendered by the portal."),
       NOT_NATIVE))

add("app.js#applyRoute location.hash", "app.js#VIEW_META/LOADERS/VIEW_TOPIC plain-object lookup", "frontend", "CLIENT-SIDE.md#Client-side navigation confusion",
    {"surface": "URL hash routes #/linha, #/topico, #/consulta and history write-back (syncHash/closeModal)",
     "boundary": "route parsing and own-property lookup of view/topic keys", "subsystem": FE, "attack_class": "Client-side navigation confusion / prototype keys"},
    ["app.js", "src/domain/view-state.mjs", "src/documentos/shell.mjs"],
    AC + "Business logic", comp("CLIENT-SIDE.md", "Client-side navigation confusion", "Prototype pollution and gadget chain"),
    ex(("CLIENT-SIDE.md#Window and opener state disclosure", "No window.open/opener use in app.js or src/."),
       ("DESKTOP-MOBILE-AND-LOCAL-IPC.md#Custom-scheme and deep-link ambiguity", "Web-only; manifest.webmanifest defines no protocol handlers or deep links.")))

add("src/domain/busca.mjs#orIlike + src/domain/core.mjs#ilikeTerm search terms", "PostgREST filter grammar under anon RLS", "frontend", AC + "Injection",
    {"surface": "typed search terms (hero search, searchLines, Portarias, Localidades, RPC args) → PostgREST query strings",
     "boundary": "client-side term encoding (ilikeTerm/orIlike/enc) and anon RLS on the server", "subsystem": FE, "attack_class": "Injection (PostgREST filter grammar)"},
    ["src/domain/core.mjs", "src/domain/busca.mjs", "app.js", "src/documentos/municipios-localidades.mjs", "src/documentos/estrutura-tarifas-portaria.mjs", "src/documentos/quadro-empresas.mjs", "src/data/rest.mjs"],
    AC + "Injection", [],
    ex(("WEB-PROTOCOL-AND-AUTH.md#Request framing and desynchronization", "No custom HTTP parser or proxy in the repo; fetch() to PostgREST only.")))

add("app.js#initRealtime postgres_changes + app.js#checarNovaVersao", "Realtime channel authorization + same-origin version.json", "frontend", AC + "Business logic",
    {"surface": "Realtime postgres_changes payloads and /version.json ETag auto-reload",
     "boundary": "anon Realtime subscription scope and reload/retry fan-out", "subsystem": FE, "attack_class": "Business logic / control input / retry fan-out"},
    ["app.js", "src/domain/view-state.mjs", "src/data/rest.mjs", "src/data/lookups.mjs", "vendor/supabase-js-2.110.7.min.js"],
    AC + "Business logic",
    comp("PROTOCOLS-RPC-AND-MESSAGING.md", "Untrusted producer treated as control plane", "Topic, routing-key, and subscription scope gaps")
    + comp("RESOURCE-EXHAUSTION-AND-AVAILABILITY.md", "Retry storm and fail-open amplification"),
    ex(("CLIENT-SIDE.md#Cross-site WebSocket request use", "Portal is a WebSocket client only; no first-party WS server or cookie session."),
       ("PROTOCOLS-RPC-AND-MESSAGING.md#Duplicate delivery and idempotency gaps", "Realtime events only trigger idempotent re-fetches; no state is written from payloads.")))

add("vercel.json#headers + .vercelignore allowlist", "published file set and security headers", "frontend", "CLOUD-AND-DEPLOYMENT.md#Edge/runtime boundary mismatch",
    {"surface": "Vercel static deployment: published files, headers, manifest", "boundary": ".vercelignore allowlist + vercel.json CSP/XFO/HSTS",
     "subsystem": FE, "attack_class": "Edge/runtime boundary mismatch / build-context inclusion / clickjacking"},
    ["vercel.json", ".vercelignore", "index.html", "manifest.webmanifest", "version.json", "tests/check.js"],
    None, comp("CLOUD-AND-DEPLOYMENT.md", "Edge/runtime boundary mismatch", "Security-control precedence drift")
    + comp("SUPPLY-CHAIN-AND-RELEASE.md", "Build-context inclusion") + comp("CLIENT-SIDE.md", "Clickjacking"),
    ex(("WEB-PROTOCOL-AND-AUTH.md#Cache deception and private-response caching", "Site serves only public static files; no private responses exist to cache."),
       ("WEB-PROTOCOL-AND-AUTH.md#Response-header injection", "No server code builds headers from input; headers are static in vercel.json.")))

# ---------------- database ----------------
add("PostgREST /rest/v1/<table> as anon", "supabase/migrations/20260930213009_harden_divat_table_security_preserve_public_reads.sql#RLS+GRANT", "supabase", AC + "Access control",
    {"surface": "PostgREST table endpoints and Realtime publication reachable with the public anon key",
     "boundary": "table GRANTs, RLS policies, RESTRICTIVE write blocks for anon/authenticated", "subsystem": DB, "attack_class": "Access control (anon/authenticated table authority)"},
    ["supabase/migrations", "docs/backup_schema.sql", "scripts/check_grants.mjs", "scripts/check_migrations.mjs", "app.js"],
    AC + "Access control", comp("DATA-ISOLATION-AND-LIFECYCLE.md", "Policy and query disagreement", "Missing tenant or owner enforcement")
    + comp("WEB-PROTOCOL-AND-AUTH.md", "API-key scope and resource binding"),
    ex(("WEB-PROTOCOL-AND-AUTH.md#JWT verification and claim binding", "JWT verification is performed by Supabase, not repository code."),
       ("DATA-ISOLATION-AND-LIFECYCLE.md#Composite-key and namespace collision", "Single-tenant public catalog; no tenant keys.")))

add("PostgREST /rest/v1/rpc/* and schema private as anon", "supabase/migrations/20260729034018_phase3_moderate_hardening.sql#EXECUTE allowlist", "supabase", AC + "Access control",
    {"surface": "RPC endpoints, private schema functions, audit SECURITY DEFINER functions",
     "boundary": "EXECUTE allowlist, schema USAGE, SECURITY DEFINER/INVOKER, search_path", "subsystem": DB, "attack_class": "Access control (function/schema authority)"},
    ["supabase/migrations/20260729034018_phase3_moderate_hardening.sql", "supabase/migrations/20260822144625_phase3_repara_funcoes_publicas.sql", "supabase/migrations/20260822151732_phase3_fecha_security_digest.sql",
     "supabase/migrations/20260824015915_phase3_guarda_fecha_security_digest.sql", "docs/backup_schema.sql", "scripts/check_phase3_audit.mjs"],
    AC + "Access control", comp("DATA-ISOLATION-AND-LIFECYCLE.md", "Analytics, logs, traces, and diagnostics as alternate readers"),
    ex(("DATA-ISOLATION-AND-LIFECYCLE.md#Search, cache, and index ACL drift", "No search index or cache tier; RPCs query base tables directly."),))

add("PostgREST anon queries and RPCs", "anon statement_timeout + pgrst.db_max_rows", "supabase", "RESOURCE-EXHAUSTION-AND-AVAILABILITY.md#Database and downstream query amplification",
    {"surface": "anon-callable filters and RPCs (ilike wildcards, divat_linhas_regiao full aggregation, limit up to 30000)",
     "boundary": "role timeouts / db_max_rows / client limits", "subsystem": DB, "attack_class": "Database and downstream query amplification"},
    ["docs/backup_schema.sql", "supabase/migrations/20260729034018_phase3_moderate_hardening.sql", "src/documentos/municipios-localidades.mjs", "src/data/rest.mjs", "app.js"],
    None, comp("RESOURCE-EXHAUSTION-AND-AVAILABILITY.md", "Database and downstream query amplification", "Pre-authentication work imbalance"),
    ex(("RESOURCE-EXHAUSTION-AND-AVAILABILITY.md#Decompression and representation amplification", "No decompression or document parsing on any server path."),))

add("supabase/migrations privileged roles divat_audit_owner/divat_auditor/divat_auditor_ci", "role membership + SECURITY DEFINER ownership", "supabase", AC + "Chained vulnerabilities and trust boundaries",
    {"surface": "audit roles, CI auditor login, rollback script", "boundary": "role membership (grant anon to divat_audit_owner), NOINHERIT, definer functions",
     "subsystem": DB, "attack_class": "Chained vulnerabilities and trust boundaries (role/privilege composition)"},
    ["supabase/migrations/20260729034018_phase3_moderate_hardening.sql", "scripts/bootstrap_phase3_auditor.sql", "scripts/rollback_phase3_test.sql", "scripts/lib/audit-database.mjs", "docs/backup_schema.sql"],
    AC + "Chained vulnerabilities and trust boundaries", comp("CLOUD-AND-DEPLOYMENT.md", "Workload identity overreach"),
    ex(("CLOUD-AND-DEPLOYMENT.md#Cross-account or cross-tenant role confusion", "Single Supabase project; no cross-account roles."),))

add("supabase/migrations lifecycle + scripts/check_migrations.mjs gate", "migration gate + default privileges", "supabase", "DATA-ISOLATION-AND-LIFECYCLE.md#Migration default and ownership confusion",
    {"surface": "new objects created by migrations (public, private, staging, historical schemas), default privileges, gate regexes",
     "boundary": "scripts/check_migrations.mjs + explicit RLS/REVOKE + supabase_admin default privileges", "subsystem": DB, "attack_class": "Migration default and ownership confusion"},
    ["supabase/migrations", "scripts/check_migrations.mjs", "tests/migrations-contract.test.mjs", "scripts/check_grants.mjs", "docs/backup_schema.sql"],
    None, comp("DATA-ISOLATION-AND-LIFECYCLE.md", "Migration default and ownership confusion", "Restore reintroduces invalid state")
    + comp("CLOUD-AND-DEPLOYMENT.md", "Security-control precedence drift"),
    ex(("DATA-ISOLATION-AND-LIFECYCLE.md#Soft-delete and tombstone bypass", "No soft-delete semantics in the schema."),))

# ---------------- CI ----------------
add(".github/workflows/db-checks.yml + deriva.yml pull_request", "fork-exclusion if: + secrets.SUPABASE_TEST_AUDIT_DATABASE_URL", ".github/workflows", "SUPPLY-CHAIN-AND-RELEASE.md#Untrusted code in a privileged workflow",
    {"surface": "pull_request jobs (and other PR-triggered jobs) executing PR-head scripts", "boundary": "if: head.repo == repo fork exclusion; secret scope; no environment:",
     "subsystem": CI, "attack_class": "Untrusted code in a privileged workflow"},
    [".github/workflows/db-checks.yml", ".github/workflows/deriva.yml", ".github/workflows/phase3-security.yml", ".github/workflows/ci.yml", ".github/workflows/views.yml", ".github/workflows/graft.yml", ".github/workflows/semgrep.yml"],
    AC + "Cryptography and secrets", comp("SUPPLY-CHAIN-AND-RELEASE.md", "Untrusted code in a privileged workflow", "Workflow command and expression confusion")
    + comp("CLOUD-AND-DEPLOYMENT.md", "Secret exposure across workload boundaries"),
    ex(("SUPPLY-CHAIN-AND-RELEASE.md#Release authorization and signing-policy gaps", "No signing/release artifacts are produced; deploy is Vercel git integration (panel fact)."),))

add(".github/workflows/deploy-smoke.yml deployment_status + inputs.url", "scripts/check_deploy.mjs host allowlist for VERCEL_AUTOMATION_BYPASS_SECRET", ".github/workflows", "SUPPLY-CHAIN-AND-RELEASE.md#Workflow command and expression confusion",
    {"surface": "deployment_status event payload and workflow_dispatch URL input", "boundary": "check_deploy.mjs hostname allowlist/regex + https requirement + redirect handling",
     "subsystem": CI, "attack_class": "Workflow command/expression confusion; secret sent to attacker-chosen host"},
    [".github/workflows/deploy-smoke.yml", "scripts/check_deploy.mjs", "tests/deploy-smoke.test.js", "tests/fixtures/deploy-smoke-fetch.mjs", "app.js"],
    AC + "Cryptography and secrets", comp("SUPPLY-CHAIN-AND-RELEASE.md", "Workflow command and expression confusion", "Untrusted code in a privileged workflow")
    + comp("WEB-PROTOCOL-AND-AUTH.md", "API-key exposure and unsafe transport"),
    ex(("WEB-PROTOCOL-AND-AUTH.md#Host and forwarded-header trust", "No server consumes Host headers; the URL is client-side input to a script."),))

add(".github/workflows dispatch-only write and backup workflows", "permissions: contents/pull-requests write + persisted checkout token + artifacts", ".github/workflows", "SUPPLY-CHAIN-AND-RELEASE.md#Automation identity overreach",
    {"surface": "atualizar-baseline, atualizar-semgrep-rulesets, backup-private, backup workflows", "boundary": "workflow permissions, persist-credentials, artifact retention/encryption",
     "subsystem": CI, "attack_class": "Automation identity overreach / artifact trust / backup scope"},
    [".github/workflows/atualizar-baseline.yml", ".github/workflows/atualizar-semgrep-rulesets.yml", ".github/workflows/backup-private.yml", ".github/workflows/backup.yml",
     "scripts/backup_private.py", "scripts/backup_rest.mjs", "scripts/check_grants.mjs", "scripts/check_data_quality.mjs"],
    AC + "Feature abuse and data leakage", comp("SUPPLY-CHAIN-AND-RELEASE.md", "Automation identity overreach", "Cache, artifact, and workspace trust mixing")
    + comp("DATA-ISOLATION-AND-LIFECYCLE.md", "Export and backup scope expansion", "Backup and replication boundary drift"),
    ex(("SUPPLY-CHAIN-AND-RELEASE.md#Update metadata and rollback confusion", "Workflows do not publish update metadata."),))

add("CI and runtime dependency inputs (npm/pip/registry rules/actions/vendored code)", "version pins, SHA pins, vendored integrity", ".github/workflows", "SUPPLY-CHAIN-AND-RELEASE.md#Mutable and unbound build inputs",
    {"surface": "npm i -g playwright, pip install semgrep/psycopg, semgrep registry rules, actions uses:, vendored supabase-js/fonts/semgrep rules",
     "boundary": "exact version pins, action SHA pins, vendored copies + manifests", "subsystem": CI, "attack_class": "Mutable and unbound build inputs / dependency confusion / generated provenance"},
    [".github/workflows", "vendor", ".semgrep", "scripts/semgrep.sh", "index.html", "app.js"],
    AC + "Obvious things", comp("SUPPLY-CHAIN-AND-RELEASE.md", "Mutable and unbound build inputs", "Dependency source and namespace confusion", "Generated-source and codegen provenance gaps", "Build-to-promotion substitution"),
    ex(("SUPPLY-CHAIN-AND-RELEASE.md#Release authorization and signing-policy gaps", "No release/signing pipeline in source."),))

# ---------------- scripts ----------------
add("scripts CLI args, env, artifact files", "scripts input validation (URL/ref/role/path checks)", "scripts", AC + "Resource and file handling",
    {"surface": "backup_rest.mjs, restore_rest.mjs, backup_private.py, recover_access_memos.py, lib/audit-database.mjs, check_* scripts",
     "boundary": "URL/ref/role validation, table allowlists, sha256 manifest, path handling, TLS mode", "subsystem": SC, "attack_class": "Resource and file handling / restore authority / credential transport"},
    ["scripts/backup_rest.mjs", "scripts/restore_rest.mjs", "scripts/backup_private.py", "scripts/recover_access_memos.py", "scripts/lib/audit-database.mjs",
     "scripts/check_deploy.mjs", "scripts/lib/rig.mjs", "scripts/semgrep.sh", "scripts/update_superpowers.sh"],
    AC + "Resource and file handling", comp("DATA-ISOLATION-AND-LIFECYCLE.md", "Import and restore authority expansion")
    + comp("WEB-PROTOCOL-AND-AUTH.md", "API-key exposure and unsafe transport", "Certificate lifecycle fallback"),
    ex(NOT_NATIVE,))

# ---------------- agent tooling ----------------
add(".claude/settings.json SessionStart hooks + scripts/graft.sh + scripts/update_superpowers.sh", "pinned package versions / skills-lock.json / manifest", "agent tooling", "SUPPLY-CHAIN-AND-RELEASE.md#Plugin and extension trust expansion",
    {"surface": "hooks executed at every agent session start; graft MCP launcher; skill updater", "boundary": "version pins, integrity locks, CLAUDE_CODE_REMOTE gate",
     "subsystem": AG, "attack_class": "Plugin and extension trust expansion / mutable inputs at session start"},
    [".claude/settings.json", ".claude/hooks", "scripts/graft.sh", "scripts/update_superpowers.sh", "skills-lock.json", ".claude/skills/.superpowers-manifest.json", "tests/session-start-hook.test.mjs"],
    None, comp("SUPPLY-CHAIN-AND-RELEASE.md", "Plugin and extension trust expansion", "Mutable and unbound build inputs"),
    ex(("SUPPLY-CHAIN-AND-RELEASE.md#Build-to-promotion substitution", "Hooks do not promote build outputs."),))

add("agent model context from repo files, GitHub issues, MCP tool results", ".mcp.json/.codex/config.toml MCP server identity + read_only", "agent tooling", "AI-AND-LLM.md#Indirect injection through retrieved or ingested content",
    {"surface": "CLAUDE.md/AGENTS.md/skills/hook-injected text, GitHub issue bodies read by agents, MCP results", "boundary": "MCP server identity/scope (read_only URL flag, deleted project ref), agent instruction routing",
     "subsystem": AG, "attack_class": "Indirect injection / MCP identity confusion / excessive agency"},
    [".mcp.json", ".codex/config.toml", "AGENTS.md", "CLAUDE.md", "docs/agents", ".claude/hooks/superpowers-session-start.sh", ".claude/skills", ".agents/skills"],
    None, comp("AI-AND-LLM.md", "Indirect injection through retrieved or ingested content", "MCP server and tool identity confusion", "Excessive agency and confused-deputy authority", "Sub-agent and MCP trust inheritance"),
    ex(("AI-AND-LLM.md#Cross-session or cross-tenant context bleed", "No multi-tenant LLM service in the repo; agents run per developer."),))

add(".claude/skills/brainstorming/scripts/server.cjs local HTTP/WebSocket", "session key + Origin check + 127.0.0.1 bind", "agent tooling", "DESKTOP-MOBILE-AND-LOCAL-IPC.md#IPC peer-authentication gaps",
    {"surface": "skill-shipped local HTTP/WS server and other executable skill helpers", "boundary": "loopback bind, token, Origin check",
     "subsystem": AG, "attack_class": "IPC peer-authentication gaps / local file ownership"},
    [".claude/skills/brainstorming/scripts", ".agents/skills", ".claude/skills"],
    None, comp("DESKTOP-MOBILE-AND-LOCAL-IPC.md", "IPC peer-authentication gaps", "Local file ownership and TOCTOU"),
    ex(("DESKTOP-MOBILE-AND-LOCAL-IPC.md#Over-broad native bridge capabilities", "No webview/native bridge."),))

# ---------------- cross-cutting ordinary ----------------
add("whole repository and git history", "secret hygiene (.gitignore, history)", "repository", AC + "Cryptography and secrets",
    {"surface": "tracked files, git history, CI logs/summaries written by scripts", "boundary": ".gitignore, secret handling in scripts/workflows",
     "subsystem": "repository (all paths + git history)", "attack_class": "Cryptography and secrets"},
    ["app.js", "src", "supabase", "tests", ".github", ".claude", ".codex", ".mcp.json", "vercel.json", ".gitignore", "scripts", ".github/workflows", "docs"],
    AC + "Cryptography and secrets", comp("WEB-PROTOCOL-AND-AUTH.md", "API-key exposure and unsafe transport"),
    ex(NOT_NATIVE,))

add("whole repository", "basic exposure checklist", "repository", AC + "Obvious things",
    {"surface": "all tracked files", "boundary": "checklist controls (debug gates, CORS, redirects, eval, pinned deps)",
     "subsystem": "repository (all paths)", "attack_class": "Obvious things"},
    ["app.js", "index.html", "src", "supabase", "docs", "scripts", "tests", ".github", ".claude", ".agents", ".codex", ".mcp.json", "vercel.json", ".vercelignore", ".gitignore", "vendor"], AC + "Obvious things", [], ex(NOT_NATIVE,))

add("whole repository", "unassigned / strange code paths", "repository", AC + "Wildcard",
    {"surface": "all tracked files", "boundary": "any boundary not covered by other units",
     "subsystem": "repository (all paths)", "attack_class": "Wildcard"},
    ["app.js", "index.html", "src", "supabase", "docs", "scripts", "tests", ".github", ".claude", ".agents", ".codex", ".mcp.json", "vercel.json", ".vercelignore", ".gitignore", "vendor"], AC + "Wildcard", [], ex(NOT_NATIVE,))

# sanity: every block must resolve verbatim
for u in U:
    for b in ([u["ordinary_attack_class_block"]] if u["ordinary_attack_class_block"] else []) + u["selected_companion_blocks"]:
        extract(b)
    for e in u["excluded_blocks"]:
        extract(e["block"])
print(len(U), "units")
rc = save(U)
sys.exit(rc)
