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
