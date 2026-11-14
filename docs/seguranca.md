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
A visibilidade retornada pela API em 14/11/2026 é pública; a configuração não foi alterada
nesta correção. Estado e histórico da decisão em [ADR-0003](adr/0003-repositorio-publico.md).

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

Em 14/11/2026, Gitleaks **8.30.1** percorreu o histórico Git disponível com
`gitleaks git --log-opts=--all --redact=100`
e saída redigida: 607 commits com alterações examinadas, aproximadamente 8,54 MB e 23
ocorrências. A triagem identificou chaves públicas `anon`/publishable, valores fictícios de
testes, nomes de armazenamento local e exemplos das regras vendorizadas; nenhum segredo
administrativo foi identificado nessas ocorrências. Isso não prova a ausência de todos os
segredos, nem cobre commits inacessíveis à cópia do Git. Não rotacionar chaves públicas só
por terem sido sinalizadas pelo scanner.

## 5. Conferências necessárias nos painéis

Na consulta de 14/11/2026, o GitHub retornou repositório público, `main.protected=true` e o
ruleset **Proteção da main** (`21211640`) ativo na branch padrão. As regras exigem PR,
resolução de discussões, branch atualizada e os checks `check`, `views`, `semgrep`,
`migration-contract`, `seguranca`, `qualidade`, `realtime` e `deriva`; bloqueiam exclusão e
force-push. A lista de atores com bypass estava vazia. Isso substitui a observação de
08/11/2026, quando a API retornava repositório privado e `main.protected=false`.

O ruleset exige **zero aprovações humanas** e não exige revisão por code owner. O
`.github/CODEOWNERS` identifica o responsável por automação, instruções de agentes e SQL,
mas não cria essa obrigação. Exigir aprovação do próprio dono bloquearia seus PRs; uma
segunda pessoa confiável deve estar definida antes de tornar a revisão humana obrigatória.
Não foi tentado um merge para testar as restrições. Não alterar visibilidade ou plano para
fazer uma correção documental.

Hooks de `.claude/settings.json` executam código do checkout quando aceitos pelo runtime.
Revisar `.claude/`, `.agents/`, `.codex/`, `.mcp.json`, `CLAUDE.md`, `AGENTS.md`, `.github/`
e `scripts/` antes de iniciar um agente em código de terceiros. Para examinar um PR externo,
usar cópia sem credenciais administrativas e com hooks/MCP desabilitados pelas configurações
confiáveis do cliente; não trocar uma sessão privilegiada para o checkout desse PR.

Estas verificações dependem de acesso ao painel; ainda não estão comprovadas nesta auditoria:

1. Supabase, GitHub e Vercel: MFA, membros e permissões das integrações.
2. No projeto em uso: manter **Allow new users to sign up** e **Allow anonymous sign-ins**
   desativados enquanto o produto não usa Auth. Zero registros em `auth.users` não prova isso.
3. Rever os avisos de Auth e recursos disponíveis no plano. Não mudar de plano nem introduzir
   login somente para eliminar um aviso de Leaked Password Protection.
4. GitHub: acompanhar mudanças no ruleset e conferir secret scanning/push protection;
   a leitura do ruleset não comprova que essas duas proteções estejam habilitadas.
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
Vercel não intercepta essas consultas. Em 14/11/2026, o catálogo confirmou `statement_timeout`
de **3s** para `anon`, **8s** para `authenticated`/`authenticator` e
`authenticator.pgrst.db_max_rows = 30000`. O teto não limita todo o trabalho de uma agregação
nem impede paginação ou requisições repetidas. Memoização do frontend não é rate limiting.
Quotas mais fortes exigem projeto próprio de gateway/Edge Function **e controle na origem**:
se a API direta continuar aceitando a chave pública, um proxy pode ser contornado. Medir custo
e planos das RPCs antes de alterar índices, limites ou o comportamento da busca.

Na mesma conferência, somente `private.f_unaccent(text)` era executável por `anon` em
`private`, como INVOKER; as cinco funções diagnósticas de `audit` não permitiam EXECUTE a
`anon`/`authenticated`. O default global de funções de `postgres` não concedia EXECUTE a
PUBLIC. Não repetir `ALTER DEFAULT PRIVILEGES IN SCHEMA private REVOKE ...` como se removesse
um grant global: defaults por schema só acrescentam ao global. O gate exige fechamento por
assinatura das rotinas novas de `public`/`private`/`audit` e recusa DEFINER em `public`/`private`;
diagnósticos fechados de `audit` continuam permitidos. O gate é análise estática, não um
interpretador completo de SQL dinâmico. O gate vivo de grants também confere `private`/`audit`
pelo catálogo: helper elevado, diagnóstico exposto e função DEFINER movida para `private`
abortam a auditoria, sem novas credenciais, grants ou exceções no baseline.

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

**9.6 — Credencial auditora e fronteiras externas do CI.** Parte das pendências da auditoria
de 13/10/2026 foi reconferida pelas integrações em 14/11/2026; escopo de secrets, regras de
Environment e Git Fork Protection continuam sem comprovação.
- **Validade do `divat_auditor_ci`: 12/02/2027 23:59:59 UTC.** Em 14/11/2026 foi alterado
  somente `VALID UNTIL`; senha não foi redefinida. Atributos mínimos e a associação exclusiva
  a `divat_auditor` foram conferidos antes/depois. O gate diário `seguranca` consulta a validade
  usando o relógio do banco, avisa quando faltam até 30 dias e recusa catálogo inválido ou
  validade vencida, fora do mecanismo de baseline. Renovação é manutenção da credencial,
  separada de migrations e sem executar o bootstrap inteiro. Conferir:
  `select rolvaliduntil from pg_roles where rolname = 'divat_auditor_ci';`
- **NV-1, deploy smoke (parcial).** O checkout do `deploy-smoke.yml` está fixado na `main`
  para buscar checker e allowlist local confiáveis; o bypass só entra no passo que consulta
  a URL. O grafo de imports é lido do deploy como texto, sem executá-lo, para conferir também
  módulos exclusivos do preview; requisições não saem da origem e há teto de 256 módulos.
  Não executar scripts servidos pelo deploy. Esse reforço não
  comprova a origem do próprio YAML: `GITHUB_SHA` identifica o commit implantado, mas a revisão
  do workflow deve ser conferida por `GITHUB_WORKFLOW_SHA`/`GITHUB_WORKFLOW_REF`, não inferida.
  **Checkout e `if:` não protegem um segredo que um YAML hostil possa solicitar.** Conferir
  *Git Fork Protection* na Vercel e escopo do bypass no GitHub; antes de levar o secret a um
  Environment, definir o fluxo confiável que testa previews, a branch permitida e os revisores.
  Remover qualquer cópia de Repository secrets ao concluir essa migração. Não considerar NV-1
  encerrado apenas por fixar o checkout. Quem tem escrita pode criar outros workflows de branch.
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
