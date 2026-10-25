# FINDINGS-DETAIL — run-1

Pela regra da skill, este arquivo detalha só os achados `confirmed` de severidade **medium, high ou critical**.
Nesta run há 1 confirmado(s), nenhum acima de `low`. O registro completo do achado de severidade baixa
está abaixo, copiado de `findings.json` sem alteração de veredito, severidade ou impacto, para quem for corrigir.

## The auditor DB credential can be sent over unauthenticated TLS (sslmode=require), so an impersonating peer receives it in cleartext

- **fingerprint:** `scripts/lib/audit-database.mjs:SSLMODES_ACEITOS:sslmode-require-unverified-server`
- **severidade:** low (probabilidade low, impacto low) · confiança medium
- **verificação independente (Fase 5):** verified

### Descrição

scripts/lib/audit-database.mjs is the only transport for the CI auditor credential SUPABASE_TEST_AUDIT_DATABASE_URL. The credential is injected at db-checks.yml:83/101/131, deriva.yml:64, phase3-security.yml:66 and atualizar-baseline.yml:100. The gates check_realtime, check_data_quality, check_grants, check_deriva and check_phase3_audit, plus atualizar-baseline, all reach psql through carregarConfiguracaoAuditora. validarConexaoAuditora accepts sslmode=require, and executarConsulta hands it to psql as PGSSLMODE. The child env is rebuilt from scratch with no PGSSLROOTCERT, PGREQUIREAUTH or PGCHANNELBINDING, and no workflow provisions a root certificate. Under require with no root.crt, libpq encrypts the connection but does not authenticate the server. It also answers whatever authentication method the peer requests. A peer that can stand in for db.gontnlfmothfglssbyyk.supabase.co (or the pooler host) through DNS or routing control can present any certificate, request AuthenticationCleartextPassword, and receive the divat_auditor_ci password. The verifier reproduced this independently. The real module, run with psql 16.15 under sslmode=require, sent a dummy password to a loopback peer presenting a self-signed CN=attacker.invalid certificate. In the same run, verify-full and verify-ca sent nothing. The live secret's sslmode is not directly observable. Two facts at the pinned commit establish that it is require. docs/seguranca.md §9.5 says refusing require would turn the four mandatory checks red. And with no root certificate provisioned anywhere, verify-ca and verify-full abort before authentication, as observed locally, so only require can work on a stock runner. The sibling privileged path, scripts/backup_private.py, forces verify-full against system roots.

### Causa raiz

SSLMODES_ACEITOS (audit-database.mjs:37) includes 'require', and executarConsulta (lines 122-132) passes the chosen mode to libpq. It sets no PGSSLROOTCERT and pins no Supabase CA, and it sets no PGREQUIREAUTH or PGCHANNELBINDING. The control meant to bind the credential to the real Supabase endpoint therefore fails open in two places: server certificate verification, and the authentication method the client will answer. 'verify-ca' is also accepted. It does verify a chain, but not the hostname, so it is weaker than verify-full. It is not the decisive mode here, because without a configured root it fails closed.

### Comportamento esperado

The auditor credential should be released only to a server that has proved it is the Supabase endpoint for gontnlfmothfglssbyyk. That means sslmode=verify-full against a pinned, versioned Supabase CA passed through PGSSLROOTCERT, matching the verify-full posture in scripts/backup_private.py:59,153. Password exposure should also be bounded by refusing cleartext and MD5 authentication (PGREQUIREAUTH=scram-sha-256), with channel binding required where the endpoint supports it.

### Trace

| # | tipo | local | escopo | descrição |
|---|---|---|---|---|
| 1 | entrypoint | `.github/workflows/db-checks.yml:83` | jobs.realtime.env | The repository secret SUPABASE_TEST_AUDIT_DATABASE_URL is injected into the gate job on a GitHub-hosted ubuntu-latest runner. The same injection appears at db-checks.yml:101 and :131, deriva.yml:64, phase3-security.yml:66 and atualizar-baseline.yml:100. No step provisions a PostgreSQL root certificate. |
| 2 | propagation | `scripts/check_realtime.mjs:41` | top-level gate | The gate loads the credential through carregarConfiguracaoAuditora(). The other gates do the same at check_data_quality.mjs:85, check_deriva.mjs:95, check_grants.mjs:55 and check_phase3_audit.mjs:66. |
| 3 | propagation | `scripts/lib/audit-database.mjs:112` | carregarConfiguracaoAuditora | Reads env[ENV_VAR] and passes it to validarConexaoAuditora. |
| 4 | propagation | `scripts/lib/audit-database.mjs:96` | validarConexaoAuditora | The only transport check is membership in SSLMODES_ACEITOS (line 37: require, verify-ca, verify-full). 'require' passes, with no root certificate and no auth-method requirement. |
| 5 | propagation | `scripts/lib/audit-database.mjs:100` | validarConexaoAuditora | Returns a frozen config carrying the password and sslmode='require'. |
| 6 | sink | `scripts/lib/audit-database.mjs:129` | executarConsulta | Spawns psql with a freshly built env: PGPASSWORD (line 128) and PGSSLMODE=require, with no PGSSLROOTCERT, PGREQUIREAUTH or PGCHANNELBINDING. libpq completes TLS with any server certificate and sends the password in a PasswordMessage when the peer requests cleartext authentication. |

### Evidência

- `scripts/lib/audit-database.mjs:37` — SSLMODES_ACEITOS = new Set(['require', 'verify-ca', 'verify-full']). An unauthenticated TLS mode is accepted.
- `scripts/lib/audit-database.mjs:16` — The module's documented security contract presents 'require' as acceptable transport for the credential.
- `tests/audit-database.test.mjs:187` — The test loop asserts that sslmode=require is accepted, so the fail-open mode is part of the guarded contract.
- `docs/seguranca.md:148` — §9.5 (AUD-02) records that the validator accepts require, 'que cifra sem conferir o certificado'. It adds that refusing require without changing the secret would turn the realtime, seguranca, deriva and qualidade checks red, so the live secret relies on require.
- `scripts/backup_private.py:59` — The sibling privileged credential path forces PGSSLMODE=verify-full and PGSSLROOTCERT=system regardless of the URL. This is the stronger control the auditor path lacks.
- `scripts/check_phase3_audit.mjs:50` — Impact bound: the auditor login is asserted to have no direct table SELECT. What leaks is a minimal but persistent login to the shared database, valid until rotated.
- `agents/v02-sslmode/artifacts/check-01.out:12` — Verifier reproduction. With the real module and psql 16.15 under sslmode=require, the loopback peer (self-signed CN=attacker.invalid) logged TLSv1.3, startup_user divat_auditor_ci, msg_type 'p' and password_received 'DUMMY-V02-REQUIRE'. Lines 13-14 are the verify-full and verify-ca controls: TLS aborted and no password was received. Line 4 shows the validator accepting the real host with sslmode=require.

### Condições

- **system_configuration:** The SUPABASE_TEST_AUDIT_DATABASE_URL secret uses sslmode=require. The value itself is unobservable. docs/seguranca.md:147-154 records this, and source implies it: no root certificate is provisioned in any workflow and executarConsulta sets no PGSSLROOTCERT, so verify-ca and verify-full abort on a stock runner. The runner also has no ~/.postgresql/root.crt, which is the default on GitHub-hosted images.
- **network_routing:** The attacker can intercept or redirect TCP traffic, or DNS resolution, between a GitHub-hosted runner and db.gontnlfmothfglssbyyk.supabase.co or the Supabase pooler. The gates run on a schedule, on dispatch, and on same-repo PRs.
- **third_party_dependency:** libpq from postgresql-client 16 on ubuntu-latest: under sslmode=require with no root certificate it does not verify the server, and with require_auth unset it answers AuthenticationCleartextPassword. Observed locally with psql 16.15.

### Reprodução local (sandbox, dados fictícios)

- **perspectiva:** An on-path network or DNS attacker between the CI runner and Supabase poses as the PostgreSQL server for db.gontnlfmothfglssbyyk.supabase.co, presents any self-signed certificate, and requests cleartext password authentication.
- **entradas:**
  - `postgresql://divat_auditor_ci:DUMMY-V02-REQUIRE@db.gontnlfmothfglssbyyk.supabase.co:5432/postgres?sslmode=require`
  - `Fake peer: reply 'S' to SSLRequest; TLS handshake with self-signed CN=attacker.invalid; after StartupMessage send AuthenticationCleartextPassword = b'R' + int32(8) + int32(3)`
  - `Controls: the same URL with sslmode=verify-full and with sslmode=verify-ca`
- **passos:**
  1. Inside the OS sandbox (uid 65534, new network namespace with loopback only, read-only target, HOME without .postgresql/root.crt), generate a self-signed certificate for CN=attacker.invalid with /usr/bin/openssl.
  2. Start scratch/peer.py on 127.0.0.1:54331. For each connection it answers SSLRequest with 'S', wraps TLS, parses the StartupMessage, requests AuthenticationCleartextPassword, logs any PasswordMessage, then sends an ErrorResponse.
  3. In scratch/harness.mjs, import the real validarConexaoAuditora and executarConsulta from /home/user/DETRO-Banco-de-Dados/scripts/lib/audit-database.mjs. Validate the payload URL and confirm it is accepted with sslmode=require.
  4. Call executarConsulta with the validated config, changing only host/port to 127.0.0.1:54331 to stand in for DNS or route redirection, with psqlBin=/usr/bin/psql (16.15).
  5. Repeat with sslmode=verify-full and sslmode=verify-ca as controls.
  6. Command: python3 -I run_check.py --agent-dir <v02-sslmode> --check 01 --loopback --timeout 120 --cwd /sbx/scratch -- /bin/sh /sbx/scratch/run.sh
- **resultado observado:** The validator accepted host db.gontnlfmothfglssbyyk.supabase.co with sslmode=require. The fake peer logged sslrequest=true, TLSv1.3, startup_user divat_auditor_ci, msg_type 'p' and password_received 'DUMMY-V02-REQUIRE'. executarConsulta then threw AuditDatabaseError (status 2). In both controls (verify-full, verify-ca) the client aborted TLS (SSLEOFError at the peer) and no password was received. Promoted as agents/v02-sslmode/artifacts/check-01.out.

### Correção

Accept only sslmode=verify-full. Version the public Supabase CA certificate in the repo and always pass it to psql through PGSSLROOTCERT. Always set PGREQUIREAUTH=scram-sha-256, which stops cleartext and MD5 password disclosure on its own. Set PGCHANNELBINDING=require if the endpoint supports it, after confirming that in a manual dispatch run. Following docs/seguranca.md §9.5, validate the new CA path in a manual run first, then switch the secret to verify-full, then refuse require, and then rotate the divat_auditor_ci password. Regression tests: replace the 'require is accepted' loop in tests/audit-database.test.mjs with assertions that require and verify-ca are refused, and that the env given to psql contains PGSSLMODE=verify-full, PGSSLROOTCERT and PGREQUIREAUTH=scram-sha-256. Add a loopback fake-peer test asserting that no PasswordMessage reaches an unverified peer.

`scripts/lib/audit-database.mjs`:

```js
const SSLMODES_ACEITOS = new Set(['verify-full']);
const SUPABASE_CA = new URL('./supabase-ca.crt', import.meta.url).pathname; // certificado público versionado
// em executarConsulta, env do psql:
      PGSSLMODE: 'verify-full',
      PGSSLROOTCERT: SUPABASE_CA,
      PGREQUIREAUTH: 'scram-sha-256',
      PGCHANNELBINDING: 'require', // só após confirmar suporte do endpoint em run manual
```

**Severidade — probabilidade:** Requires an on-path or DNS-level position between a GitHub-hosted runner and Supabase, which is hard to obtain. The credential is exercised on a schedule and on same-repo PRs, which widens the window but does not lower that bar.

**Severidade — impacto:** Exposes a protected CI secret: a persistent login to the shared, sole production database, valid until rotated. divat_auditor_ci is minimal: audit diagnostics and catalog metadata, with no direct table SELECT (asserted at check_phase3_audit.mjs:50) and no writes. The gain is metadata disclosure and resource use within the role's limits.

**Confiança:** The fail-open transport is source-visible, and the verifier reproduced it independently against the real module and psql 16.15, with verify-full and verify-ca controls. The live secret's sslmode is not directly observed. It is established by docs/seguranca.md §9.5 and by the absence of any root certificate provisioning, which makes require the only accepted mode that can work on a stock runner.

