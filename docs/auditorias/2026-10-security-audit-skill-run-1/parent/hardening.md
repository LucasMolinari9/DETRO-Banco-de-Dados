## 6. Reforços (não são vulnerabilidades) e padrões positivos

As notas abaixo vêm do campo `hardening` de cada caçador, e também da decisão `rejected` da Fase 3, que reclassificou um candidato como reforço. Nenhuma tem um ator de menor confiança atravessando uma fronteira com efeito demonstrado. Por isso nenhuma tem severidade. Estão agrupadas por área e ordenadas pelo que mais reduz risco.

### 6.1 Banco de dados e migrações
1. **O gate `scripts/check_migrations.mjs` deixa passar padrões perigosos.** Isso foi medido duas vezes, por h05 em `evidence-02.txt` e por h16 em `check-02.out`. O gate aceita com exit 0:
   - `GRANT service_role|pg_write_all_data TO anon` e `GRANT anon TO <papel>`;
   - `ALTER TABLE public.<t> OWNER TO anon`;
   - `DISABLE ROW LEVEL SECURITY` e `DROP POLICY divat_block_client_*`;
   - `CREATE TABLE` sem o prefixo `public.`, com aspas, `UNLOGGED` ou `SET SCHEMA public`;
   - `CREATE VIEW public.*` sem `security_invoker` sobre uma tabela de staging, com `GRANT SELECT` para anon;
   - GRANTs montados com `execute format(...)`;
   - `ALTER DEFAULT PRIVILEGES … GRANT … TO anon`;
   - `ALTER FUNCTION public.* SECURITY DEFINER`;
   - um REVOKE de função cuja assinatura não bate com a da função criada.

   Correção: rejeitar cada padrão e acrescentar um caso `recusa()` por padrão em `tests/migrations-contract.test.mjs`. Hoje nenhuma migração usa essas formas, e o dono aplica as migrações manualmente.
2. **O EXECUTE global para PUBLIC não é fechado por migração.** Isso foi medido num Postgres 16 local por h16. O `ALTER DEFAULT PRIVILEGES … IN SCHEMA … REVOKE EXECUTE ON FUNCTIONS FROM public` de `20260729034018:95-97` não remove o EXECUTE global de PUBLIC: uma função nova em `public`/`private` continua executável por anon. Correção: versionar `alter default privileges for role postgres revoke execute on functions from public;`, que hoje só existe em `docs/backup_schema.sql:691-692`. Fechar também os defaults de tabela e sequence em `private` e `audit`.
3. **Os gates vivos só olham o schema `public`.** São eles `check_grants.mjs`/`divat_security_shape` e `check_phase3_audit.mjs`. Correção: estendê-los a `private` (onde anon tem USAGE), `audit`, `divat_integracao`, `divat_historico` e `stage_access_20260928`. Devem cobrir as ACLs de schema (CREATE/USAGE para PUBLIC/anon) e o owner, `prosecdef` e `proconfig` das funções em `audit` e `private`.
4. **`20260930213009` deixa duas brechas.** Ela não revoga `MAINTAIN` (PG17) dos papéis cliente. E reconhece uma policy de bloqueio só pelo nome, sem checar se ela é `RESTRICTIVE` com `false`.
5. **`audit.divat_security_digest()` não tem DDL versionado.** Ela vira `SECURITY DEFINER` em `20260822151732:28` sem assertar o `search_path`. Correção: versionar o corpo dela com `search_path` fixo. Esta é a unidade bloqueada, ver §7.
6. **O login `divat_auditor_ci` só tem limites do lado do cliente.** Correções:
   - `ALTER ROLE … SET default_transaction_read_only=on`, `statement_timeout` e `CONNECTION LIMIT`.
   - No `scripts/bootstrap_phase3_auditor.sql`, não passar a senha em argv nem em texto de DDL; usar `\password` ou um verificador SCRAM.
   - Assertar que as memberships são exatamente `{divat_auditor}`.
   - Atenção: o exemplo de `valid until` (31/10/2026) vence em breve. Se ele foi usado literalmente, os 4 checks obrigatórios vão falhar fechados.
7. **`scripts/rollback_phase3_test.sql` está desatualizado.** Se rodasse com sucesso, reconcederia os diagnósticos e `f_unaccent` a anon e authenticated, e SELECT em 14 tabelas a authenticated. Hoje ele aborta por acaso. Apagar ou reescrever.
8. **`docs/backup_schema.sql` (caminho B de restauração) recria grants antigos.** Correção: marcar esses GRANTs como superados, ou exigir a postura da Fase 3 antes de expor a Data API.
9. **Ciclo de migrações.** `20260930213009` foi aplicada direto no banco e versionada depois. A tabela `tarifa_promocional_exibicao_teste` não tem `CREATE` versionado. As configurações de role (anon 3 s, `pgrst.db_max_rows`) só existem na baseline e nenhum gate as confere.
10. **As tabelas `itinerario_teste`, `qh_intervalo_teste` e `qh_predeterminado_teste` foram encontradas vazias em 03/10 sem causa registrada** (`docs/CHANGELOG.md:46`). Nenhum caminho do repositório as apaga, o que sugere uma sessão privilegiada. Correção: registrar a causa a partir dos logs e considerar uma guarda contra DELETE/TRUNCATE em massa.

### 6.2 GitHub Actions / CI
11. **"Atualizar baseline" promete uma recusa que não existe.** O cabeçalho do workflow (`atualizar-baseline.yml:19-21`) e o corpo do PR (`:159`) dizem que `check_grants.mjs` recusa colocar indicadores graves no baseline. Ele não recusa. Este foi o candidato rejeitado na Fase 3: exige um escritor que dispare o workflow e o dono que faça o merge. Correção: implementar a lista de recusa nas duas pontas, escrita e leitura, com casos no rig. Ou, no mínimo, corrigir o texto do workflow, do PR e de `check_grants.mjs:24`. `DIVAT_ALVO` nunca é lido, então o "slot por alvo" também não existe.
12. **Tokens de escrita persistidos no checkout.** Usar `persist-credentials: false` em `atualizar-baseline.yml:73` e `atualizar-semgrep-rulesets.yml:58`, e entregar o token só ao passo de push/PR.
13. **Escopo dos segredos.** Os segredos ficam em `env` de job (auditor em `db-checks.yml`/`deriva.yml`, bypass em `deploy-smoke.yml:41`). Correção: passar cada um para o `env` do único passo que o usa.
14. **`deploy-smoke`:**
    - o `GITHUB_OUTPUT` usa delimitador fixo, então uma URL com quebra de linha injeta chaves extras;
    - o conteúdo servido é impresso no log sem escape, o que permite emitir `::workflow-command::`;
    - uma porta explícita é aceita;
    - a regex de preview é mais larga que os nomes que a Vercel gera.
15. **Checks obrigatórios pulados contam como aprovados.** Em PR de fork, os jobs com segredo são pulados pelo `if:` e o GitHub os conta como aprovados. PRs abertos pelos workflows de atualização, via `GITHUB_TOKEN`, não disparam os checks.
16. **`backup-private`:**
    - fixar a imagem `postgres:17` por digest;
    - usar `--require-hashes` no pip;
    - usar um login de backup dedicado e somente leitura em vez de `postgres`, o que também reduz o impacto do registro de needs_validation sobre o segredo do backup.
17. **Insumos de dependência:**
    - travar as dependências transitivas (`npm install -g` do graft no hook com scripts de lifecycle, e `pip install semgrep`);
    - exportar `DO_NOT_TRACK=1` no hook;
    - registrar e verificar o sha256 esperado de `vendor/supabase-js-2.110.7.min.js`;
    - verificar `skills-lock.json` ou documentá-lo como mera proveniência;
    - conferir se cada SHA de action pertence à tag citada no comentário.

### 6.3 Frontend
18. **`fmtDate`/`fmtTime` (`src/domain/core.mjs:12-13`) devolvem a entrada crua quando ela não casa com o padrão.** Sete chamadas inserem `fmtDate(campo)` no HTML sem `esc()`: `src/ui/blocos.mjs:132,139`, `estrutura-tarifas-portaria.mjs:181,187`, `quadro-empresas.mjs:100,294` e `frota-historico-itinerarios.mjs:124`. Isso só é seguro porque essas colunas são do tipo `date`. Correção: fazer o fallback retornar `esc(String(d))` e criar um teste de regressão.
19. **Rotas com chaves de protótipo.** `#/consulta/__proto__`, `constructor` e `toString` abrem um modal quebrado, e uma aba assim faz `tabMatchesEvent` lançar exceção a cada evento Realtime. `#/topico/<qualquer>` deixa a página sem nenhum card. Correção: usar `Map` ou `Object.hasOwn`, adicionar um guarda `Array.isArray` e incluir esses casos no `check_selecao_linha.mjs`.
20. **`ilikeTerm`/`orIlike`.** Vírgula e aspas no termo quebram o `or=()`, mas só na requisição do próprio visitante. Correção: pôr os valores entre aspas e escapar `%` e `_`, com tamanho mínimo de termo.
21. **`sbFetch` repete o timeout determinístico 57014 e outros 500.** Correção: repetir só 502, 503, 504 e 429, com jitter e respeitando `Retry-After`.
22. **Realtime:**
    - o invalidador de `codempresa_teste` refaz o GET completo a cada evento, sem debounce;
    - as tabelas grandes ficam publicadas durante as importações;
    - o canal público `divat-rt` aceita broadcast de terceiros, que consome cota;
    - `eventsPerSecond:5` não é limite;
    - `window.__divatReload` é um global sujeito a DOM clobbering.

### 6.4 Scripts
23. **`scripts/lib/audit-database.mjs`.** Além do achado confirmado, recusar host com vírgula: hoje `127.0.0.1,aws-0-…pooler.supabase.com` passa na validação.
24. **`scripts/lib/rig.mjs` (só usado em teste).** Serve o repositório inteiro, incluindo `.git/` e backups ignorados pelo git, para qualquer `Host` nas portas fixas 8098–8101. Uma requisição `/%00` derruba o processo.
25. **`scripts/update_superpowers.sh`.** Validar os nomes antes do `rm -rf` (hoje `../..` apagaria fora da pasta), tratar colisão com as skills de outra origem e recusar symlinks.
26. **`restore_rest.mjs` e `backup_rest.mjs`:**
    - recusar o ref oficial;
    - usar `redirect: 'error'` quando enviar chave;
    - calcular o hash durante o `--apply`;
    - não ecoar o corpo de erro;
    - abrir arquivos com a flag `wx`;
    - pôr aspas nos valores do keyset.
27. **`recover_access_memos.py`.** As validações por `assert` somem com `python -O`, e o caminho que vem do manifesto não é confinado.
28. **`scripts/check_grants.mjs` tem bytes NUL literais.** Por isso o `grep` trata esse gate de segurança como binário. Correção: escrever `'\0'` como escape.

### 6.5 Repositório e ferramentas de agente
29. **`.gitignore`.** Incluir `*.pem`, `*.key`, `*.p12`, `credentials*.json`, `service-account*.json`, `*.age`, `.claude/settings.local.json` e `.superpowers/`.
30. **`.codex/config.toml:2` ainda aponta para o projeto apagado `lwzsxuaqqeoamukduhev`.** A skill vendorada `supabase` manda criar um `.mcp.json` sem `project_ref` e sem `read_only`. Correção: fixar a URL com escopo no `CLAUDE.md` e no `AGENTS.md`.
31. **Texto de issues e comentários.** Tratar o de não colaboradores como dado não confiável nas skills `/triage` e `/wayfinder`.
32. **Registrar no `docs/seguranca.md` as cotas e configurações do Realtime** observadas no painel.

### 6.6 Padrões positivos observados
- **Escape consistente:** `esc()` cobre os ~135 pontos de `innerHTML`. Um teste em Chromium com a CSP real injetou payloads em 21 telas, incluindo o container de PDF, e nada foi interpretado como HTML. A CSP não tem `unsafe-inline` nem `unsafe-eval`, e o site manda `frame-ancestors 'none'`, `X-Frame-Options: DENY` e HSTS.
- **Publicação mínima:** `.vercelignore` em modo deny-all publica só 37 arquivos, sem nenhum segredo além da chave anon pública.
- **Escrita anônima bloqueada:** `anon` só tem SELECT. A migração `20260930213009` foi aplicada num Postgres local, e as policies RESTRICTIVE bloquearam INSERT/UPDATE/DELETE/TRUNCATE mesmo depois de o GRANT ser reintroduzido.
- **RPCs anônimas:** são `SECURITY INVOKER`, com `search_path` fixo e sem SQL dinâmico.
- **Actions:** todas fixadas por SHA, sem `pull_request_target`, e com PRs de fork excluídos dos jobs que usam segredo.
- **Backup completo:** `backup_private.py` força `verify-full`, abre um snapshot somente leitura, criptografa com `age` e não tem fallback em texto puro.
- **Allowlist do *deploy smoke*:** a do AUD-01 resistiu a 14 truques de URL e usa redirect manual.
- **Servidor local da skill brainstorming:** exige token e confere a Origin.
