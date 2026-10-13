# Relatório de auditoria de segurança — DETRO-Banco-de-Dados (run-1)

Metodologia: skill [`cloudflare/security-audit-skill`](https://github.com/cloudflare/security-audit-skill), commit `c1c8a8c`.
Os arquivos de máquina são `findings.json` e `coverage-ledger.json`. Este texto deriva deles e não altera nenhum veredito, severidade ou bloqueio.

## 1. Escopo, perfil e como a auditoria rodou

- **Alvo:** repositório inteiro no commit `539abe2ac670cd2c36e67aa5d4578d248eb0fd9a` (branch `ccr-82845698-yw5n79`), com a árvore de trabalho limpa. O frontend, as migrações e baseline do Supabase, os 12 workflows, os scripts e testes e as ferramentas de agente (`.claude`, `.agents`, `.codex`, `.mcp.json`) entraram no escopo.
- **Perfil:** `standard`, sem orçamento fixo de agentes. É a primeira run desta skill no repositório. Revisões anteriores (Codex AUD-*, issue #121, SEC-*) serviram só de contexto, não de cobertura.
- **Execução:** só código-fonte e testes locais. Nada foi enviado ao banco Supabase, à Vercel, ao GitHub ou a qualquer endpoint publicado. Todo código do alvo rodou num sandbox imposto pelo sistema operacional, com estas restrições:
  - namespaces novos de mount, rede, pid, ipc e uts, sem rede externa (loopback isolado só quando pedido);
  - sistema de arquivos somente leitura, exceto um tmpfs de 64 MiB como área de rascunho;
  - uid 65534, sem capabilities e com `no_new_privs`;
  - ambiente vazio, com uma lista de variáveis permitidas;
  - limites de memória (2 GiB), processos (256), CPU, tamanho de arquivo e tempo.

  As evidências locais foram promovidas com verificação no-follow, só para arquivo regular com um único link e dentro de um limite de bytes. O sandbox foi testado antes do uso: escrita fora da área de rascunho e rede foram negadas; symlink, FIFO, hard link e arquivo grande foram recusados na promoção.
- **Agentes:** 45 lançados e 29 concluídos.
  - 4 de reconhecimento;
  - 25 caçadores, dos quais 13 concluíram, 8 foram derrubados pelo limite de uso da API e 4 foram parados na pausa pedida pelo dono;
  - 3 críticos de cobertura;
  - 5 verificadores da Fase 3;
  - 8 da Fase 5, dos quais 4 foram derrubados pelo limite de uso.

  Toda unidade e todo registro cujo agente caiu foram refeitos por um agente novo. Nenhuma evidência de agente interrompido entrou no ledger.
- **Cobertura:** 22 unidades. 15 estão `covered`, 5 `candidate` e 2 `blocked` (ver §7). Nenhuma ficou `deferred` ou `out_of_scope`.
- **Críticos:**
  - o crítico pós-onda 1 acrescentou 1 unidade (assinaturas Realtime anônimas), que foi caçada na onda 2;
  - o crítico pós-onda 2 e o crítico final independente não acharam lacunas.

  Com os dois críticos limpos, a regra da skill permite declarar cobertura completa *desta passada*. Isso não quer dizer que o alvo esteja esgotado. A própria skill observa que repetir runs encontra mais coisas.

## 2. Postura geral

A superfície pública (visitante anônimo → site estático → PostgREST/Realtime) está bem defendida:
- `esc()` em todos os pontos de `innerHTML`;
- CSP sem `unsafe-inline`;
- `anon` só com SELECT, com escrita bloqueada por policies RESTRICTIVE, o que foi comprovado aplicando a migração num Postgres local;
- RPCs com `SECURITY INVOKER` e `search_path` fixo.

Nenhuma falha permite a um visitante ler ou alterar algo além do catálogo público. Os riscos reais estão nos bastidores operacionais:
- credenciais de CI e de backup, quanto ao transporte e a quem consegue rodar código com elas;
- o workflow de *deploy smoke*;
- o custo do Realtime anônimo sobre o banco único.

Três desses quatro itens dependem de configurações de painel (GitHub, Vercel, Supabase) que o código não mostra, e por isso estão como `needs_validation`.
## 3. Achados confirmados

| severidade | título | fronteira afetada | resultado observado (sandbox) |
|---|---|---|---|
| low | Credencial do auditor do banco enviada por TLS sem autenticar o servidor (`sslmode=require`) | segredo de CI `SUPABASE_TEST_AUDIT_DATABASE_URL` ↔ servidor Postgres que o runner contata | módulo real + `psql` 16.15 entregaram a senha fictícia em texto claro a um servidor falso com certificado autoassinado; `verify-full`/`verify-ca` não enviaram nada |

## 4. Detalhe do achado confirmado

**C-1 — `scripts/lib/audit-database.mjs:SSLMODES_ACEITOS:sslmode-require-unverified-server` (severidade baixa)**

- **Onde:**
  - `scripts/lib/audit-database.mjs:37` aceita `require`, `verify-ca` e `verify-full`;
  - `executarConsulta`, em `:122-132`, chama o `psql` só com `PGSSLMODE`, sem `PGSSLROOTCERT`, `PGREQUIREAUTH` ou `PGCHANNELBINDING`.

  Essa é a única via de transporte usada pelos gates `check_realtime`, `check_data_quality`, `check_grants`, `check_deriva` e `check_phase3_audit`, e pelo `atualizar-baseline`.
- **Quem explora:** um atacante com posição de rede ou de DNS entre o runner do GitHub e `db.gontnlfmothfglssbyyk.supabase.co` (ou o pooler). Ele não precisa de nenhuma credencial.
- **Reprodução (local, dados fictícios):** o validador real aceitou a URL do projeto com `sslmode=require`. A chamada real a `executarConsulta`, redirecionada a um servidor falso em loopback com certificado `CN=attacker.invalid` que pede `AuthenticationCleartextPassword`, entregou a senha fictícia. Os controles `verify-full` e `verify-ca` abortaram o TLS antes da autenticação. A reprodução foi feita duas vezes, pelo caçador h10 e pelo verificador v02 (`agents/v02-sslmode/artifacts/check-01.out`).
- **Condições:**
  - o segredo usa `require`. O `docs/seguranca.md` §9.5 registra isso, e o código confirma: nenhum workflow fornece certificado raiz, então só `require` funciona no runner padrão;
  - o atacante consegue interceptar o tráfego de rede ou a resolução de DNS.
- **Impacto:** vazamento de um login persistente no banco único, válido até ser rotacionado. O papel `divat_auditor_ci` é mínimo: diagnósticos e metadados de catálogo, sem SELECT direto em tabela e sem escrita.
- **Por que baixa:** a probabilidade é baixa porque exige posição de rede contra um runner hospedado, e o impacto é baixo porque o papel exposto é mínimo.
- **Correção mínima:**
  1. aceitar só `verify-full`, com um CA do Supabase versionado em `PGSSLROOTCERT`;
  2. sempre definir `PGREQUIREAUTH=scram-sha-256`, que já impede a entrega em texto claro mesmo antes de trocar o segredo;
  3. definir `PGCHANNELBINDING=require` se o endpoint suportar;
  4. recusar host com vírgula;
  5. depois de trocar o segredo, rotacionar a senha do `divat_auditor_ci`.

  Regressão: em `tests/audit-database.test.mjs`, trocar o laço "require é aceito" por recusas de `require` e `verify-ca`, e acrescentar um servidor falso em loopback que não pode receber `PasswordMessage`. A sequência de troca sem quebrar os checks obrigatórios está em `docs/seguranca.md` §9.5. O registro completo está em `FINDINGS-DETAIL.md`.

## 5. Precisa de validação (sem severidade)

| # | pista | bloqueio decisivo | checagem local | checagem pelo dono (só leitura) |
|---|---|---|---|---|
| NV-1 | `deploy-smoke.yml` roda o código do commit implantado com `VERCEL_AUTOMATION_BYPASS_SECRET` em todo `deployment_status` de sucesso, sem filtro de fork, criador ou ref confiável (`.github/workflows/deploy-smoke.yml:8,30,41,61,100` → `scripts/check_deploy.mjs:41,61`) | se a Vercel implanta PRs de fork (*Git Fork Protection*), se o GitHub dispara o workflow com segredos para esse SHA, de onde vem a definição do workflow, e a visibilidade do repositório | renderizar a matriz do workflow e exigir que o passo com o segredo rode só código da branch padrão, com o segredo no escopo do passo e um `environment:` com revisor | Vercel → Settings → Security → *Git Fork Protection*; GitHub → visibilidade; payload de um run antigo do *Deploy smoke* (`deployment.creator`, `sha`, `ref`); opcionalmente, um PR de fork de uma conta própria que imprima só `Boolean(...)` do segredo |
| NV-2 | A credencial `postgres` do backup completo (`SUPABASE_BACKUP_DATABASE_URL`) alcança código de qualquer ref que um agente ou outro escritor envie ou dispare: é segredo de repositório, sem `environment:` nem trava de ref (`backup-private.yml:6,70,73,78`, `backup_private.py:19,45`, `db-checks.yml:66`) | onde o segredo está (repositório/organização ou um Environment restrito à `main` com revisor) e as permissões (Contents, Workflows, Actions) da identidade usada pelos agentes e por outros escritores | renderizar a matriz e exigir `environment:` protegido em `jobs.backup` e nenhum job alcançável por PR ou dispatch livre que referencie o segredo | GitHub → Settings → Secrets and variables → Actions: aparece em *Repository secrets*? Settings → Collaborators/Apps: permissões do agente. Correção: mover para um Environment `backup-integral` restrito à `main` com o dono como revisor, rotacionar a senha e usar um login de backup somente leitura |
| NV-3 | Assinaturas Realtime anônimas (chave pública) multiplicam cada importação em massa do dono no projeto único, limitadas só por cotas do plano que o código não mostra (`app.js:149,1526,1609,1612`, migração `20260930213009:29`, `20261003115732:43`) | cotas do Realtime e plano, algoritmo do servidor Realtime (uma checagem de RLS por assinatura?), contagem de mensagens e o custo real da importação de 03/10 (87.686 linhas) | numa pilha Supabase local isolada, medir o custo com K = 1, 10, 100 e 1000 assinaturas para um INSERT de 10 mil linhas | Supabase → plano, spend cap e Settings → Realtime; Reports/Usage em 03/10; `select entity, count(*) from realtime.subscription group by entity`; lag do slot de replicação durante as importações |

Trace completo, evidências e planos estão em `NEEDS-VALIDATION.md`. **Nenhuma checagem deve ser feita testando o ambiente real "de fora".** Todas são leituras do próprio painel pelo dono, ou testes em ambiente isolado.

**Candidato rejeitado:** `scripts/check_grants.mjs:--atualizar-baseline:grave-findings-baselined-without-refusal`. O workflow "Atualizar baseline" afirma uma recusa que `check_grants.mjs` não implementa. A mecânica se reproduz no sandbox, mas exige um escritor que dispare o workflow e o dono que faça o merge, e esses dois já podem editar o baseline diretamente. Não há ator de menor confiança nem efeito novo, então o item foi para reforço (§6.2, item 11).

**Observação operacional:** durante a auditoria, `tests/session-start-hook.test.mjs` falhou 2 vezes com a máquina carregada e passou isolado (3 de 3). O teste espera até 30 s por um processo em segundo plano. É um teste instável sob carga, sem relação com segurança.
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
## 7. Cobertura (resumo do `coverage-ledger.json`)

| status | unidades |
|---|---|
| covered | 15 |
| candidate | 5 (decididos na Fase 3: 1 confirmed, 3 needs_validation, 1 rejected) |
| blocked | 2 |
| deferred / out_of_scope | 0 |

**Unidades bloqueadas.** Nelas a revisão foi parcial, e o fato que falta não é observável a partir do código.
1. **Papéis privilegiados do banco (`divat_audit_owner`, `divat_auditor`, `divat_auditor_ci`).** O que se vê no código não mostra caminho de um papel de menor confiança até um papel de auditoria. Faltam dois fatos ao vivo:
   - o `proconfig` (`search_path`) de `audit.divat_security_digest()`, cujo DDL não está versionado;
   - se PUBLIC tem `CREATE` em algum schema do `search_path` das funções *definer*.

   Para conferir, como dono, rodar somente leitura:
   ```sql
   select n.nspname, a.privilege_type from pg_namespace n, aclexplode(n.nspacl) a where a.grantee = 0 and a.privilege_type = 'CREATE';
   select p.oid::regprocedure, p.proconfig from pg_proc p where p.pronamespace = 'audit'::regnamespace;
   ```
2. **Segredos no histórico do git.** As 144 revisões alcançáveis foram varridas e não têm nenhum segredo privilegiado: só JWTs `anon` (do projeto atual e do projeto apagado) e fixtures fictícias. Mas o clone local é raso (a partir de 08/08/2026), e o projeto existe desde julho. Para conferir: rodar `gitleaks` ou `trufflehog` num clone completo, ou olhar os alertas de *secret scanning* do GitHub.

**Classes de ataque não selecionadas:** MEMORY-SAFETY-AND-BINARY. Não há código nativo, e o único parser binário (`scripts/recover_access_memos.py`) é Python. As exclusões de cada unidade, com motivo, estão no ledger.

**Como reproduzir ou continuar:** `tools/` contém o sandbox (`run_check.py`, `sandbox_inner.sh`) e os scripts do coordenador. Uma próxima run desta skill pode ler este ledger e este `findings.json` como "prior run", conforme as regras da skill: as unidades que tiverem o código alterado viram trabalho atual, e os registros `needs_validation` são revalidados.
