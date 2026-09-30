# Segurança do Portal DIVAT — manual do dono

Fonte vigente para controles do banco, verificações das contas e riscos residuais.
O procedimento de recuperação fica em [backup.md](backup.md); a promoção do banco em uso
fica no [plano de promoção](planos/fase-3-promocao-producao.md).

## 1. Banco atualmente em uso

O portal usa `divat - TESTE` (`gontnlfmothfglssbyyk`). Segundo o dono, a antiga produção
`lwzsxuaqqeoamukduhev` foi apagada. O nome TESTE não significa que os dados sejam descartáveis:
o projeto já serve o portal e foi adotado como oficial. O isolamento de previews permanece pendente.

Com `SITE_USA_TESTE_TEMPORARIAMENTE = true`, produção, previews e desenvolvimento consultam
esse mesmo banco. Uma branch do Git não isola dados; ver [ADR-0002](adr/0002-ambiente-de-teste-isolado.md).
Não reaplicar a Fase 3 nem executar rollback histórico sobre ele.

## 2. Acesso público conferido em 30/09/2026

A conferência leu catálogo, grants, policies, funções e publicação Realtime; não executou
ataques de escrita nem mudou ACLs. O estado observado foi:

- 19 tabelas em `public`, todas com RLS; 15 legíveis por `anon`, quatro stagings fechadas.
- Nenhum grant de escrita em tabelas/colunas ou sequências para `anon`/`authenticated`, nem
  policies de escrita no schema público.
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

Essa evidência demonstra as permissões observadas; não comprova MFA, configuração de signup,
proteção de branch ou ausência de toda vulnerabilidade no código/histórico.

## 3. Modelo de ameaça e segredos

A JWT `anon` legada é pública: o navegador precisa dela para consultar os dados publicados.
A segurança depende de grants mínimos, RLS e allowlist de funções. RLS sozinho não bloqueia
TRUNCATE ou todos os privilégios administrativos.

Senhas PostgreSQL, `service_role`, chaves secretas e a chave privada de recuperação nunca vão
para arquivos servidos, Git, logs ou chat. Secrets de Actions ficam em environments com acesso
restrito. O certificado de criptografia pode ser público; sua chave privada fica com o dono,
fora do Git e dos artifacts de Actions.

As contas Supabase, GitHub e Vercel controlam o serviço. Proteja cada uma com senha única e MFA;
revise membros, tokens, integrações e acesso de pessoas que não precisam mais operar o projeto.
O repositório permanece público conforme [ADR-0003](adr/0003-repositorio-publico.md).

## 4. Evidências históricas

A auditoria de 23/07/2026 registrou testes transacionais de SQL injection e de
INSERT/UPDATE/DELETE/SELECT de staging como `anon`, todos sem caminho de escrita. Essa evidência
é histórica e pertence ao ambiente daquela data; não é um novo pentest do banco atual.
Os relatos integrais permanecem no histórico do Git.

Da mesma forma, a confirmação de signup fechado em 22/08/2026 foi feita no projeto antigo.
Ela não comprova a configuração de `gontnlfmothfglssbyyk`.

## 5. Conferências necessárias nos painéis

Estas verificações dependem de acesso ao painel; ainda não estão comprovadas nesta auditoria:

1. Supabase, GitHub e Vercel: MFA, membros e permissões das integrações.
2. No projeto em uso: manter **Allow new users to sign up** e **Allow anonymous sign-ins**
   desativados enquanto o produto não usa Auth. Zero registros em `auth.users` não prova isso.
3. Rever os avisos de Auth e recursos disponíveis no plano. Não mudar de plano nem introduzir
   login somente para eliminar um aviso de Leaked Password Protection.
4. GitHub: proteção da `main`, bloqueio de force-push, checks obrigatórios e disponibilidade
   de secret scanning/push protection. A conexão atual não comprova essas configurações.
5. A preservação integral foi adiada pelo dono; sua cobertura permanece explícita em [backup.md](backup.md).

## 6. Rotina de verificação

O workflow `DB checks` verifica grants diariamente; qualidade e Realtime seguem as frequências
configuradas no workflow. `Deriva` compara as RPCs usadas pelo frontend. Todos consultam
`gontnlfmothfglssbyyk` pelo login mínimo `divat_auditor_ci`; o nome histórico do secret
`SUPABASE_TEST_AUDIT_DATABASE_URL` não altera o alvo.

Após importar dados ou alterar estrutura, execute esses workflows na aba Actions do site do
GitHub e confirme jobs executados e verdes. Um job pulado não valida o banco. O workflow
`Phase 3 database security` em PR verifica migrations; sua auditoria viva é manual e precisa
ser executada após publicar a correção que compara Realtime por nomes.

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

A falta de separação entre previews e o banco oficial é uma pendência de implantação tratada
no plano de promoção, não uma garantia resolvida por renomear o projeto.

## 10. Auditor mínimo

O owner das funções diagnósticas, `divat_audit_owner`, é `NOLOGIN`, sem poderes administrativos,
e herda somente `anon`. O papel `divat_auditor` executa os diagnósticos de `audit`, sem SELECT
direto. O login externo `divat_auditor_ci` pertence apenas a esse papel.

Os validadores exigem login e projeto exatos, senha não vazia e TLS; não imprimem URL, senha
ou stderr do cliente. Consulte [hardening moderado](planos/fase-3-hardening-moderado.md) para
rotacionar esse login. Não usar credencial administrativa como substituta do auditor de CI.
