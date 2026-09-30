# Ambiente de teste deve usar um projeto Supabase isolado

## Decisão

Uma branch separa código, não dados. Previews e desenvolvimento devem consultar um projeto
Supabase distinto do oficial. `HOSTS_PROD` é a allowlist dos três domínios oficiais; hosts
não reconhecidos devem escolher o projeto de teste e falhar fechado se faltar configuração.

## Estado vigente

A decisão foi adotada em 28/07/2026, mas está **temporariamente sem isolamento de dados**.
O dono informou que a produção `lwzsxuaqqeoamukduhev` foi apagada. O projeto
`divat - TESTE` (`gontnlfmothfglssbyyk`) já serve o portal e foi adotado como oficial.

No código atual, `SITE_USA_TESTE_TEMPORARIAMENTE = true` direciona todos os hosts a
`SB_TESTE_URL`/`SB_TESTE_KEY`. Isso inclui os três domínios de `HOSTS_PROD`, previews e
`localhost`. O comportamento é uma exceção temporária, não isolamento comprovado.

`SB_URL`/`SB_KEY` agora apontam ao banco em uso, e o endpoint apagado foi removido de
`vercel.json` e `.mcp.json`. O MCP principal permanece somente leitura. Não desligar a flag
isoladamente: `SB_TESTE_URL` ainda é o mesmo projeto, e isso não criaria isolamento.

## Implantação da separação

Os critérios e a ordem de execução pertencem ao
[plano de promoção](../planos/fase-3-promocao-producao.md). O dono adiou o backup nesta entrega.
Configure um novo projeto de teste, com credenciais próprias; altere o endpoint de teste,
a flag, CSP e MCP na mesma entrega. O oficial permanece em `gontnlfmothfglssbyyk`.

`HOSTS_PROD` deve continuar contendo todos os domínios oficiais cadastrados na Vercel.
O domínio novo entra nessa lista junto da mudança de configuração. Testes offline de seleção
de ambiente e smoke real devem provar os alvos de produção, preview e localhost.

## Contratos de automação

Preserve as declarações literais `const SB_URL`, `const SB_KEY`, `const SB_TESTE_URL` e
`const SB_TESTE_KEY` usadas pelos testes. Qualquer alteração de formato exige adaptar os
consumidores na mesma entrega.

Os quatro gates vivos usam `scripts/lib/audit-database.mjs` e o login `divat_auditor_ci`,
fixados em `gontnlfmothfglssbyyk`. O nome histórico do secret
`SUPABASE_TEST_AUDIT_DATABASE_URL` não comprova separação. Criar outro projeto não muda esse
alvo automaticamente; revisar também a configuração da auditoria do novo teste.

## Consequências

Até a separação, não tratar previews como ambiente seguro para experimentar com dados ou ACLs.
Schemas privados de importação/backup continuam privados; não publicá-los ao copiar o projeto.
A nova instância deve receber apenas dados e configurações adequados ao teste.

A decisão termina de ser implantada quando os três caminhos forem verificados contra projetos
distintos e os gates cobrirem o banco oficial. A evidência de preview de julho é histórica e
não comprova a matriz temporária atual.
