# Segurança do Portal DIVAT — manual do dono

Fonte vigente para controles do banco, verificações das contas e riscos residuais.
O procedimento de recuperação fica em [backup.md](backup.md); a promoção do banco em uso
fica no [plano de promoção](planos/fase-3-promocao-producao.md).

## 1. Banco atualmente em uso

O portal usa `divat - TESTE` (`gontnlfmothfglssbyyk`). Segundo o dono, a antiga produção
`lwzsxuaqqeoamukduhev` foi apagada. O nome TESTE não significa que os dados sejam descartáveis:
o projeto já serve o portal e foi adotado como oficial. Em 30/09/2026, o dono determinou não
criar outro banco. Previews e desenvolvimento continuam compartilhando o banco oficial.

Com `SITE_USA_TESTE_TEMPORARIAMENTE = true`, produção, previews e desenvolvimento consultam
esse mesmo banco. Uma branch do Git não isola dados; ver [ADR-0002](adr/0002-ambiente-de-teste-isolado.md).
Não reaplicar a Fase 3 nem executar rollback histórico sobre ele.

## 2. Acesso público conferido em 30/09/2026

A conferência leu catálogo, grants, policies, funções e publicação Realtime; não executou
ataques de escrita nem mudou ACLs. O estado observado foi:

- 19 tabelas em `public`, todas com RLS; 15 legíveis por `anon`, quatro stagings fechadas.
- Nenhum grant de escrita em tabelas/colunas ou sequências para `anon`/`authenticated`, nem
  policies que autorizem escrita no schema público. Policies RESTRICTIVE com FALSE explícito
  bloqueiam escrita e são preservadas pelo gate.
- `authenticated` não tem SELECT de tabela pública nem EXECUTE de função pública. A exceção
  da projeção de tarifas foi fechada em `20260930172521`; a policy agora permite somente `anon`.
- As duas RPCs de produto, `divat_busca_logradouro(text,integer)` e
  `divat_linhas_regiao(text,text)`, usam `SECURITY INVOKER` e `search_path` fixo.
- Helpers ficam em `private`; diagnósticos ficam em `audit`, sem EXECUTE de `anon` ou
  `authenticated`. O helper de normalização necessário à busca continua acessível a `anon`.
- Schemas de importação, conciliação e backups históricos não concedem acesso público.
  Tabelas privadas sem RLS não devem receber USAGE/SELECT de roles públicas.
- Realtime publica as 15 tabelas consumidas pelo portal. Novas tabelas privadas não entram
  nessa publicação.

Essa evidência demonstra as permissões observadas; não comprova MFA, configuração de signup
ou ausência de toda vulnerabilidade no código/histórico. A proteção do Git foi conferida separadamente.

### Conferência de 14/11/2026 e fechamento preparado

O catálogo contém 22 tabelas públicas, todas com RLS. Três tabelas adicionais,
`dias_semana_teste`, `itinerario_alteracao_teste` e `tarifa_historico_teste`, tinham SELECT
para `anon` e nove policies FALSE criadas como PERMISSIVE. O dono confirmou que os dados são
privados. Elas não são consumidas pelo portal nem por RPCs/views/funções, FKs externas ou
Realtime. A migration `20261114110844` revoga acesso público de tabela/coluna, remove as
policies de leitura e recria os nove bloqueios como RESTRICTIVE/FALSE, sem alterar dados.
Está **preparada, não aplicada**, aguardando backup integral recuperável. A baseline de
segurança permanece intacta; as nove policies explicam a falha do gate vivo examinada.

`GET /auth/v1/settings` respondeu `disable_signup=false`, email habilitado e login anônimo
desabilitado. Não houve tentativa de cadastro nem envio de email. Fechar signup continua
pendente de acesso legítimo à configuração Auth (painel → Authentication → Sign In / Providers
→ desativar **Allow new users to sign up**). O portal não usa sessões ou login. Confirmar depois
`disable_signup=true` pela mesma consulta pública; alteração SQL de ACL não muda Auth.

## 3. Modelo de ameaça e segredos

A JWT `anon` legada é pública: o navegador precisa dela para consultar os dados publicados.
A segurança depende de grants mínimos, RLS e allowlist de funções. RLS sozinho não bloqueia
TRUNCATE ou todos os privilégios administrativos.

Senhas PostgreSQL, `service_role`, chaves secretas e a chave privada de recuperação nunca vão
para arquivos servidos, Git, logs ou chat. Secret administrativo de Actions fica em Environment
com acesso restrito, não em *Repository secrets* (o do backup integral: §9.6). O certificado de criptografia pode ser público; sua chave privada fica com o dono,
fora do Git e dos artifacts de Actions.

As contas Supabase, GitHub e Vercel controlam o serviço. Proteja cada uma com senha única e MFA;
revise membros, tokens, integrações e acesso de pessoas que não precisam mais operar o projeto.
O repositório foi observado como privado em 08/11/2026; a decisão histórica de visibilidade
pública foi reaberta em [ADR-0003](adr/0003-repositorio-publico.md).

## 4. Evidências históricas

A auditoria de 23/07/2026 registrou testes transacionais de SQL injection e de
INSERT/UPDATE/DELETE/SELECT de staging como `anon`, todos sem caminho de escrita. Essa evidência
é histórica e pertence ao ambiente daquela data; não é um novo pentest do banco atual.
Os relatos integrais permanecem no histórico do Git.

Da mesma forma, a confirmação de signup fechado em 22/08/2026 foi feita no projeto antigo.
Ela não comprova a configuração de `gontnlfmothfglssbyyk`.

A auditoria independente de 25/10/2026 (Codex + Semgrep, Gitleaks e OSV sobre um snapshot da
`main`, sem acesso ao banco nem navegador) não achou vulnerabilidade de acesso. Os cinco achados
eram defeitos de consistência entre tela, PDF e dados, todos corrigidos com teste (detalhe no
`docs/CHANGELOG.md`). Ela também não comprova o estado do banco vivo — isso continua com os gates
`seguranca`/`deriva` e com as conferências do §5.

## 5. Conferências necessárias nos painéis

Em 30/09/2026 foi registrada proteção da `main` por ruleset. Essa evidência é histórica.
Na consulta de 08/11/2026, a API retornou repositório privado e `main.protected=false`; a
listagem de rulesets respondeu HTTP 403 solicitando upgrade do plano ou visibilidade pública.
Não foi testado um merge nem comprovada a vigência de todas as restrições pelo painel.

Os workflows existem, mas sua execução não prova que impeçam merge. Conferir no plano atual
PR obrigatório, bloqueio de exclusão/force-push, resolução de discussões, branch atualizada,
bypass e os checks `check`, `views`, `semgrep`, `migration-contract`, `seguranca`, `qualidade`,
`realtime` e `deriva`. Até confirmar, a barreira automática de merge é pendência operacional.
Visibilidade ou plano não devem ser alterados como efeito de uma correção documental.

Estas verificações dependem de acesso ao painel; ainda não estão comprovadas nesta auditoria:

1. Supabase, GitHub e Vercel: MFA, membros e permissões das integrações.
2. No projeto em uso: manter **Allow new users to sign up** e **Allow anonymous sign-ins**
   desativados enquanto o produto não usa Auth. Zero registros em `auth.users` não prova isso.
3. Rever os avisos de Auth e recursos disponíveis no plano. Não mudar de plano nem introduzir
   login somente para eliminar um aviso de Leaked Password Protection.
4. GitHub: confirmar proteções de branch/ruleset e disponibilidade de secret scanning/push
   protection no plano e visibilidade atuais; registrar o que está efetivamente habilitado.
5. A preservação integral foi adiada pelo dono; sua cobertura permanece explícita em [backup.md](backup.md).

## 6. Rotina de verificação

O workflow `DB checks` verifica grants diariamente; qualidade e Realtime seguem as frequências
configuradas no workflow. `Deriva` compara as RPCs usadas pelo frontend. Todos consultam
`gontnlfmothfglssbyyk` pelo login mínimo `divat_auditor_ci`; o nome histórico do secret
`SUPABASE_TEST_AUDIT_DATABASE_URL` não altera o alvo.

Após importar dados ou alterar estrutura, execute esses workflows na aba Actions do site do
GitHub e confirme jobs executados e verdes. Um job pulado não valida o banco. O workflow
`Phase 3 database security` em PR verifica migrations sem credencial. A auditoria viva roda
após push relevante na `main` e por despacho manual, comparando Realtime por nomes. Nunca roda
em PR, e somente consulta os diagnósticos pelo auditor mínimo.

O smoke de deploy verifica cabeçalhos, arquivos públicos/privados e URL/JWT `anon` do banco
oficial, rejeitando o endpoint apagado na CSP. Sua aprovação não comprova isolamento: previews
ainda compartilham o banco oficial e o script registra essa limitação.

Trimestralmente, revise membros, configurações de Auth, advisors, artifacts e o exercício de
restauração. Não reduza a frequência diária do gate de grants enquanto os defaults herdados
persistirem. Nos advisors, examine cada objeto e permissão: INFO de staging/backup privado sem
policy não justifica criar leitura pública. O inventário atual tem mais objetos privados que
em julho; não esperar sempre apenas quatro INFO.

## 7. Resposta a incidente

Revogue a credencial comprometida, troque as senhas afetadas e revise MFA/sessões das contas.
Preserve logs do Supabase, histórico de Actions e deploys. Rotação de chaves exige atualizar os
consumidores correspondentes; não publique a nova chave administrativa no frontend.

Confira grants, policies, funções e dados antes de recuperar. Qualquer restauração ou operação
destrutiva segue [backup.md](backup.md), primeiro em ambiente isolado. Preserve o original e a
procedência para investigar o incidente.

## 8. Regras permanentes

- Nenhuma escrita pública nem policy `ALL USING(true)` para `anon`/`authenticated`.
- Estrutura, ACLs e Realtime passam pela skill `db-change` e migrations versionadas.
- DROP/DELETE/TRUNCATE/REVOKE/migração exigem backup fresco e recuperável.
- Publicação só para tabelas e funções de produto aprovadas; staging fica privada.
- Não apagar registros históricos órfãos para fazer um gate passar.

## 9. Riscos residuais

**9.1 — Defaults herdados de `supabase_admin` (SEC-01, parcial).** `postgres` gerenciado não
consegue alterar todos os defaults da plataforma. O controle combina revokes + RLS explícitos
nas migrations e o gate diário de grants no banco em uso. As três exceções de defaults e a
função de event trigger constam da baseline revisada; não aumentar a baseline para ocultar drift.

**9.2 — Abuso da API pública (SEC-02).** O navegador acessa Supabase diretamente, portanto a
Vercel não intercepta essas consultas. Timeouts, teto de linhas e limites do plano reduzem a
carga; memoização do frontend não é rate limiting. Quotas mais fortes exigem projeto próprio
de gateway/Edge Function, sem prometer proteção já implantada.

**9.3 — Recuperação ainda pendente (SEC-06).** A exportação REST semanal é parcial, sem snapshot
consistente, e o último run examinado falhou sem artifact. Ela não cobre os schemas privados.
Não houve dump completo nem ensaio isolado. Essa pendência foi adiada pelo dono e não bloqueou
as correções desta entrega. RTO/RPO continuam sem medição; cobertura em [backup.md](backup.md).

**9.4 — `rls_auto_enable()` como `SECURITY DEFINER`.** Exceção revisada: o event trigger liga
RLS em tabelas públicas novas, sem conceder acesso público. Não substitui RLS explícito e
revokes na migration. `anon`/`authenticated` não devem poder executar essa função.

**9.5 — TLS do auditor sem verificação do servidor (AUD-02, revisão Codex de 11/10/2026).**
`scripts/lib/audit-database.mjs` aceita `sslmode=require`, que cifra sem conferir o certificado.
Pendente por decisão do dono. Não basta exigir `verify-full` no validador: sem trocar o secret
junto, os checks de banco `realtime`, `seguranca`, `deriva` e `qualidade` ficam vermelhos.
A documentação da Supabase usa o certificado baixado do painel, e não há confirmação de que
`sslrootcert=system` funcione. Caminho: versionar o certificado público,
apontar `PGSSLROOTCERT` para ele, validar num run manual e só então trocar o secret e recusar
`require`. O `PGSSLROOTCERT` tem de entrar no `env` que o `executarConsulta` monta do zero para
o psql: posto só no `env:` do workflow, não chega ao processo filho (revisão estática de
25/10/2026, A01, que reconfirmou o achado). A auditoria de 13/10/2026 confirmou o achado (C-1, severidade baixa) e sugeriu um
passo intermediário: `PGREQUIREAUTH=scram-sha-256` impede a entrega da senha em texto claro
sem trocar o secret, mas também precisa de um run manual antes, porque o pooler pode não aceitar.

**9.6 — Pendências da auditoria de 13/10/2026 que só o painel responde.** O relatório
(metodologia `cloudflare/security-audit-skill`, commit auditado `539abe2`) não testou nada
contra o ambiente real; as checagens abaixo são leituras do dono, sem mudar nada.
- **Validade do `divat_auditor_ci`: 30/11/2026 23:59:59 UTC** (medido em 25/10/2026; o exemplo
  do `scripts/bootstrap_phase3_auditor.sql` diz 31/10, mas não foi o valor aplicado). Sem
  renovar, os quatro checks de banco falham fechados a partir de 01/12. Conferir:
  `select rolvaliduntil from pg_roles where rolname = 'divat_auditor_ci';`
- **NV-1, deploy smoke.** O `deploy-smoke.yml` roda o código do commit implantado com
  `VERCEL_AUTOMATION_BYPASS_SECRET` a cada `deployment_status`. Depende de a Vercel implantar
  PR de fork (*Git Fork Protection*, em Settings → Security) e da visibilidade do repositório.
  **Fixar o `actions/checkout` na `main` não fecha isto**, e por isso não foi feito (proposta
  da revisão de 25/10/2026, A02): no `deployment_status` o `GITHUB_SHA` é o commit implantado, e
  o próprio YAML do workflow vem desse commit, então um commit hostil reescreve o checkout, o
  `if:` ou o passo inteiro. A barreira está fora do repo: o que a Vercel aceita implantar. Quem
  tem escrita já alcança os secrets do repositório por qualquer workflow de branch.
- **NV-2, segredo do backup integral.** Se `SUPABASE_BACKUP_DATABASE_URL` estiver em
  *Repository secrets*, qualquer branch enviada por quem tem escrita, agentes inclusive, alcança
  a senha `postgres`. Correção: mover para um Environment restrito à `main`, com o dono como
  revisor, e usar um login de backup somente leitura. **Desde 25/10/2026 o job já referencia
  o Environment `backup-integral`** (lado do código); falta o painel — criar as regras, mover o
  secret e apagar a cópia de repositório, passo a passo em [backup](backup.md). O login de
  backup somente leitura continua pendente.
- **NV-3, custo do Realtime anônimo.** Cotas do plano, spend cap e o uso nas importações em massa.

Corrigidos na mesma data: o gate de migrações passou a recusar papel concedido a público,
`OWNER TO` público, `DISABLE ROW LEVEL SECURITY`, remoção das policies de bloqueio, `SECURITY
DEFINER` em `public`, default privileges que concedem a público, tabela sem schema, `SET SCHEMA
public`, view de `public` sem `security_invoker`, materialized view em `public` e papel
montado por `format()`. O
[CHANGELOG](CHANGELOG.md) lista o resto.

O compartilhamento entre previews e o banco oficial é uma decisão registrada na
[ADR-0002](adr/0002-ambiente-de-teste-isolado.md), sem criação de outro banco nesta entrega.
Previews não são ambientes isolados para experimentar com dados ou ACLs.

## 10. Auditor mínimo

O owner das funções diagnósticas, `divat_audit_owner`, é `NOLOGIN`, sem poderes administrativos,
e herda somente `anon`. O papel `divat_auditor` executa os diagnósticos de `audit`, sem SELECT
direto de dados. O login externo `divat_auditor_ci` pertence apenas a esse papel. O gate de grants
complementa o diagnóstico com `pg_policy`, `pg_class` e `pg_namespace`, já legíveis pelo auditor,
na mesma consulta somente leitura. Confere cobertura exata; metadados ausentes ou divergentes
abortam a auditoria. Só aceita policies de escrita RESTRICTIVE com FALSE explícito nas condições
exigidas pelo comando. Grants de escrita continuam proibidos, inclusive com essas policies.

Os validadores exigem login e projeto exatos, senha não vazia e TLS; não imprimem URL, senha
ou stderr do cliente. Consulte [hardening moderado](planos/fase-3-hardening-moderado.md) para
rotacionar esse login. Não usar credencial administrativa como substituta do auditor de CI.
