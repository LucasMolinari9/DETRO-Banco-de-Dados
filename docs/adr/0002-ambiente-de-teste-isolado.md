# Ambientes do portal e banco único

## Decisão vigente

Em 30/09/2026, o dono determinou não criar outro banco. O projeto
`divat - TESTE` (`gontnlfmothfglssbyyk`) permanece como único banco Supabase oficial nesta entrega.
Não provisionar outro projeto ou branch do banco como parte do plano de correção.

Uma branch do Git separa código, não dados. Produção, previews e desenvolvimento compartilham
esse projeto; previews não são ambientes isolados para experimentar com dados ou ACLs.

## Histórico e estado atual

A decisão de 28/07/2026 previa projetos distintos para teste e produção. O dono informou que
a antiga produção `lwzsxuaqqeoamukduhev` foi apagada, e adotou o projeto em uso como oficial.
A orientação de criar novo teste foi retirada do escopo por sua decisão de 30/09/2026.

`SITE_USA_TESTE_TEMPORARIAMENTE = true` direciona todos os hosts a `SB_TESTE_URL`/
`SB_TESTE_KEY`: os três domínios de `HOSTS_PROD`, previews e `localhost` usam o mesmo banco.
`SB_URL`/`SB_KEY` também apontam a ele. Preservar essa configuração; desligar a flag
isoladamente não criaria isolamento de dados.

O endpoint apagado foi removido de `vercel.json` e `.mcp.json`. O MCP principal permanece
somente leitura. A ordem das correções e as conferências de contas pertencem ao
[plano de promoção](../planos/fase-3-promocao-producao.md). O backup foi adiado pelo dono.

## Contratos de automação

Preserve as declarações literais `const SB_URL`, `const SB_KEY`, `const SB_TESTE_URL` e
`const SB_TESTE_KEY` usadas pelos testes. Qualquer alteração de formato exige adaptar os
consumidores na mesma entrega. `HOSTS_PROD` mantém os domínios oficiais cadastrados na Vercel.

Os gates vivos usam `scripts/lib/audit-database.mjs` e o login mínimo `divat_auditor_ci`,
fixados em `gontnlfmothfglssbyyk`. O nome histórico do secret
`SUPABASE_TEST_AUDIT_DATABASE_URL` não comprova separação. Não trocar esse alvo por causa do nome.
Testes de seleção de ambiente e smoke real devem confirmar a configuração compartilhada,
sem declarar isolamento a partir de um deploy aprovado.

## Consequências

Não criar novo banco nem inventar endpoint de teste. Experimentos que alterem dados, estrutura
ou permissões exigem avaliação do impacto no banco oficial e autorização correspondente.
Schemas privados de importação e histórico permanecem privados; a decisão de banco único não
amplia grants nem autoriza apagá-los. A evidência de preview de julho é histórica e não
comprova separação na configuração atual.
