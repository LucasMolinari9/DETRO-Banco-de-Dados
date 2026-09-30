# Backup e recuperação — Portal DIVAT

## Estado vigente

O banco em uso é `divat - TESTE` (`gontnlfmothfglssbyyk`), agora adotado como oficial.
Segundo o dono, a antiga produção `lwzsxuaqqeoamukduhev` foi apagada. A preservação completa
foi adiada por decisão do dono; não é pré-requisito da conciliação e do ajuste de acesso desta
entrega. Não houve dump completo nem restauração nesta sessão. RTO/RPO permanecem sem medição.

A rotina existente de Actions é uma **exportação parcial de public**, sem snapshot consistente.
Não cobre os schemas privados de importação, auditoria de dados, conciliação e backups históricos.
O run público de 28/09/2026 examinado falhou sem artifact; conferir o resultado dos próximos runs.

## Exportação REST existente

| Modo | Cobertura | Limitação |
|---|---|---|
| público/anon | as **15 tabelas públicas** de consulta | somente dados, sem consistência entre requisições |
| administrativo (`public_schema`) | as **19 tabelas**, inclusive staging | não exporta schemas privados nem estrutura |

`tarifa_promocional_exibicao_teste` está incluída, com paginação por sua PK `codsecao`.
O manifest formato 2 registra `escopo: public`, `consistent_snapshot: false` e o resultado de
integridade. Contagem indisponível ou divergente não produz um manifest de sucesso.
Pasta existente com arquivos não é reutilizada para misturar execuções.

Manifests antigos de 14/18 tabelas continuam validáveis, com aviso de cobertura histórica.
O rótulo legado `modo: completo` significa public com staging; não significa o banco inteiro.
CSV também é parcial e não preserva funções, ACLs, RLS, sequências ou histórico privado.

O workflow [backup.yml](../.github/workflows/backup.yml) consulta o projeto em uso com a chave
pública; não publica credencial administrativa. Senhas e chaves secretas ficam fora do Git,
logs e chat. Artifacts de Actions têm retenção limitada, não armazenamento permanente.

## Recuperação parcial e baseline histórica

`docs/backup_schema.sql` é anterior à Fase 3 e às cargas privadas recentes. Não reconstrói o
estado atual nem recupera snapshots históricos de dados. O histórico de 18 migrations está
em [schema.md](schema.md); não reaplicá-las sobre o banco em uso.

Qualquer exercício de reconstrução será feito em projeto novo e isolado, sem sobrepor o banco
oficial. Um dump completo futuro traz sua própria estrutura e não deve ser combinado com
execução da baseline histórica no mesmo destino. Copiar as migrations não recria snapshots
originais nem os dados privados que alimentaram CTAS/importações.

### Caminho B — NDJSON legado, somente recuperação parcial

```bash
node scripts/restore_rest.mjs /PASTA/DO/NDJSON
```

O modo padrão é dry-run: valida formato, SHA-256 e contagens sem escrita. Aplicação exige o
endpoint/chave administrativa do destino nas variáveis privadas aceitas pelo script e
`--apply --confirm-ref=<ref>`. O importador recusa o projeto de origem e destino ocupado.
O destino precisa ter estrutura compatível previamente revisada; a baseline histórica não
inclui automaticamente todos os objetos atuais. Não chamar esse caminho de recuperação completa.

Após inserir IDs explícitos, execute o **Passo comum 2** no destino isolado.

### Passo comum 2 — sequências depois de NDJSON/CSV

Somente no destino isolado, depois da conferência de estrutura e dados:

```sql
select setval(pg_get_serial_sequence('public.itinerario_teste','row_id'), coalesce((select max(row_id) from public.itinerario_teste),1), exists(select 1 from public.itinerario_teste));
select setval(pg_get_serial_sequence('public.evento_empresa_teste','row_id'), coalesce((select max(row_id) from public.evento_empresa_teste),1), exists(select 1 from public.evento_empresa_teste));
select setval(pg_get_serial_sequence('public.evento_linha_teste','row_id'), coalesce((select max(row_id) from public.evento_linha_teste),1), exists(select 1 from public.evento_linha_teste));
select setval(pg_get_serial_sequence('public.qh_intervalo_teste','row_id'), coalesce((select max(row_id) from public.qh_intervalo_teste),1), exists(select 1 from public.qh_intervalo_teste));
select setval(pg_get_serial_sequence('public.qh_predeterminado_teste','row_id'), coalesce((select max(row_id) from public.qh_predeterminado_teste),1), exists(select 1 from public.qh_predeterminado_teste));
```

Confirme também outras sequências criadas no estado restaurado. O Caminho A já as inclui no dump;
o procedimento REST fala PostgREST e não reposiciona sequências sozinho.

## Critérios de recuperação futura

Confirme estrutura, contagens, hashes, PK/FK, identities, owners/ACLs, RLS, funções, Realtime,
procedência e leituras do portal. Meça RTO/RPO em restauração isolada. Não apagar órfãos históricos
nem inferir vigência tarifária para fazer verificações passarem.

Os schemas privados precisam de exportação própria consistente antes de uma recuperação integral;
a rotina REST acima não satisfaz esse requisito. A pendência permanece documentada, sem bloquear
as correções autorizadas desta entrega. Etapas seguintes em
[planos/fase-3-promocao-producao.md](planos/fase-3-promocao-producao.md).
