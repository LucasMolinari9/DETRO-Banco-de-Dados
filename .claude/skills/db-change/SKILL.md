---
name: db-change
description: Use para mudanças de schema, RLS/GRANT, Realtime, índices ou loaders que dependam de estrutura nova no Supabase do Portal DIVAT. Não usar para ajuste isolado de CSS/texto/UI.
---

# Mudança estrutural no banco (Portal DIVAT)

Pipeline para mudanças de estrutura e permissões. Leia `CLAUDE.md`, `docs/schema.md`,
`docs/seguranca.md` e `docs/backup.md` apenas nas partes relevantes à alteração.
O alvo atualmente em uso é `gontnlfmothfglssbyyk`, oficial; não é banco descartável.
Previews ainda usam esse mesmo projeto. Uma branch não autoriza experimentar DDL no banco.

## Etapa 1 — Levantar pré-requisitos

Responda com o código e o catálogo disponíveis; peça informação ao dono apenas se ela faltar:

1. Qual projeto, schema e tabela serão alterados? O banco antigo foi apagado segundo o dono;
   não executar migrations nele nem desligar a flag temporária sem configurar outro teste.
2. O objeto é de consulta pública ou privado/staging? Objeto novo nasce fechado. As tabelas
   públicas exigem PK adequada, RLS explícito e revokes na mesma migration. Conceda SELECT e
   policy de SELECT a `anon` apenas se os dados forem públicos e necessários ao portal.
   Não conceda a `authenticated` por padrão; o produto não usa sessões.
3. Uma RPC nova é necessária? Prefira `SECURITY INVOKER`, `search_path` fixo e tipos explícitos;
   remova EXECUTE implícito de `PUBLIC` e revise a allowlist antes de conceder EXECUTE a `anon`.
   Diagnósticos permanecem em `audit`; helpers em `private`. Nunca abrir diagnóstico público.
4. Quais loaders, filtros, joins e lookups mudam? Decida índices por consultas e evidência;
   atualize `RT_TABLES`/`VIEW_TABLES` somente para objetos públicos que o portal consome.
5. Existe staging correspondente? Não há rebuild automático de ETL. Preserve procedência e
   mantenha cópias coerentes por operação explícita, sem presumir que um job fará isso depois.
6. Existe backup fresco e recuperável antes de aplicar DDL/ACLs? A exportação REST não cobre
   os schemas privados nem oferece snapshot consistente; siga o dump privado do runbook.

Não criar policies para eliminar INFO de staging/backup privado. Não abrir USAGE/SELECT de
schemas privados a roles públicas. RLS não substitui revokes de TRUNCATE e outros privilégios.

## Etapa 2 — Especificação curta

Registre no chat ou na descrição da entrega: alvo, DDL, PK/FK, grants/policies estritamente
necessários, índices, consumidores, Realtime, impacto nos dados e recuperação prevista.
Versão e nome da migration devem corresponder ao histórico aplicado. Não versionar senhas.

Para leituras acima do teto atual, prefira paginação. Alterar o teto exige avaliar a carga,
conciliar `pgrst.db_max_rows`, `SB_MAX_ROWS` e a documentação na mesma entrega, com backup antes
da alteração administrativa. Não aumentar limites automaticamente por haver um `limit` maior.

## Etapa 3 — Implementar e verificar em ordem

1. Prepare a migration versionada, sem executá-la no banco em uso. Verifique
   `node scripts/check_migrations.mjs` e o diff de privilégios.
2. Preserve backup e ensaie em projeto isolado. Se ele ainda não existe, conclua os arquivos
   revisáveis e registre a dependência; não tratar preview do frontend como isolamento.
3. Na aplicação, crie estrutura, RLS e revokes de forma atômica; publique somente os grants
   indispensáveis. Índices e publicação Realtime acompanham os consumidores aprovados.
4. Atualize loaders/cards, `RT_TABLES`, `VIEW_TABLES`, mapa em `docs/schema.md` e fatos vigentes
   em `CLAUDE.md`. A baseline `docs/backup_schema.sql` é histórica, não dump atual.
5. Rode o gate do repositório e as verificações vivas de grants, Realtime, deriva e qualidade
   no alvo certo. Não ampliar baselines para esconder falhas e não apagar órfãos históricos.
6. Abra a entrega em branch, valide preview e revise o diff antes de merge. Mudança na `main`
   pode disparar deploy; confirme os pré-requisitos do banco antes de publicar código dependente.

Nunca executar um `pg_restore` completo junto da baseline histórica. Reconciliação de arquivos
de migrations já aplicadas não significa executá-las novamente no banco oficial.

## Etapa 4 — Revisão e encerramento

A revisão registra comportamento resultante, testes realmente executados e dependências
pendentes. Não afirmar backup ou restauração concluídos a partir de testes sintéticos.
Uma operação no banco termina quando ACLs/dados/leituras foram verificados após sua aplicação;
uma preparação no Git termina com arquivos revisáveis, sem confundir as duas entregas.
