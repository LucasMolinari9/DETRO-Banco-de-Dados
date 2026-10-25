# Backup e recuperação — Portal DIVAT

## Estado vigente

O banco em uso é `divat - TESTE` (`gontnlfmothfglssbyyk`), agora adotado como oficial.
Segundo o dono, a antiga produção `lwzsxuaqqeoamukduhev` foi apagada. Em 03/10/2026 o dono
cancelou a execução do novo backup externo e autorizou remover os três schemas antigos.
Antes da limpeza, foram recuperadas três tabelas públicas já vazias: 52.385 itinerários,
9.553 intervalos e 25.748 partidas do snapshot público de 28/09. Conteúdo e leitura `anon`
foram conferidos. Depois foram removidos somente `codex_backup_20260924`,
`bkp_divat_teste_20260928_1944` e `codex_import_20260924`, sem dependências externas.
O banco ficou com 438.037.651 bytes (417,7 MiB), com contagens públicas e privadas preservadas.

O workflow integral permanece descrito no Caminho A. Não houve run, artifact criptografado
ou chave privada entregue nesta operação. Sua existência e a recuperação parcial acima
não comprovam um dump integral, ensaio completo de restauração ou guarda fora do GitHub.
Até registrar um run verde e a confirmação de guarda externa, essas etapas continuam pendentes.
RTO/RPO permanecem sem medição. Não criar outro projeto Supabase.

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

## Caminho A — dump integral, restaurado e criptografado

O workflow [backup-private.yml](../.github/workflows/backup-private.yml), **Backup completo
criptografado**, aceita somente `workflow_dispatch`, com `contents: read`, checkout sem
credenciais persistidas e actions presas ao SHA. Não modifica a origem.

O job referencia o Environment **`backup-integral`**. A senha administrativa mora **só** nele,
nunca em *Repository secrets*: secret de repositório chega a qualquer branch que alguém com
escrita envie (agentes inclusive), e o Environment é o que restringe à `main` e exige a
aprovação do dono (NV-2 em [segurança](seguranca.md) §9.6). Pelo navegador do celular, no site
do GitHub (o app não mostra estas telas):

1. **Settings → Environments → `backup-integral`** (se não existir, **New environment** com esse
   nome exato — o GitHub também o cria vazio na primeira execução, sem proteção nenhuma).
2. **Required reviewers:** marque e adicione a sua conta. Deixe *Prevent self-review* desmarcado,
   senão você não aprova um backup que você mesmo disparou.
3. **Deployment branches and tags → Selected branches and tags → Add rule → `main`**.
4. **Environment secrets → Add secret**, com os dois abaixo.
5. Em **Settings → Secrets and variables → Actions → Repository secrets**, **apague**
   `SUPABASE_BACKUP_DATABASE_URL` se ele estiver lá. Sem este passo os anteriores não protegem
   nada: o job lê o do Environment, mas uma branch que tire o `environment:` do YAML lê o do
   repositório.

- `SUPABASE_BACKUP_DATABASE_URL`: URI do **Connect → Session pooler**, porta **5432**, do
  projeto oficial, com sua senha. Só o dono cadastra; nunca enviar a URI ao agente/chat.
- `BACKUP_AGE_PUBLIC_KEY`: destinatário público age X25519. A chave privada correspondente
  fica exclusivamente com o dono, fora do GitHub. Sem ela o backup não abre. É pública, mas
  fica no mesmo Environment para os dois secrets do job andarem juntos.

Com o revisor configurado, toda execução para em **Waiting for review** até o dono tocar em
**Review deployments → Approve** na página do run.

O agente dispara o workflow na `main`, o dono aprova e o agente acompanha. Ele instala o
cliente PostgreSQL 17, faz `pg_dump
-Fc` **sem filtro de schema ou tabela** e `pg_dumpall --roles-only --no-role-passwords`.
Contagens e dump compartilham um snapshot `REPEATABLE READ READ ONLY` exportado. A contagem
cobre cada tabela de cada schema, incluindo vazias, partições e schemas internos do Supabase;
erro de privilégio/RLS aborta em vez de omitir tabela. Os roles são capturados separadamente;
senhas de roles não fazem parte do pacote.

A restauração usa um service container `postgres:17` efêmero no runner. A extensão
`supabase_vault` 0.3.1 é compilada do commit fixado no workflow; as demais extensões atuais
estão no PostgreSQL 17. Primeiro restaura roles, depois o dump, com owners e ACLs, em transação
e com parada no primeiro erro. Tabela ausente/extra ou contagem divergente reprova o job.
Não remover objetos do dump nem ignorar erros para obter verde.

O `manifest.json` registra data do snapshot, versão do servidor, tamanho da origem, commit/run,
schemas, extensões, SHA-256 dos arquivos, contagens de origem/restauração e resultado aprovado.
Ele fica **dentro** do pacote criptografado, junto com `database.dump` e `roles.sql`.
Secret ausente/inválido, dump, restauração, comparação ou criptografia falhos impedem o upload.
O único arquivo publicado é `divat-backup.tar.age`, no artifact `divat-backup-completo-<run_id>`,
com **retention-days: 30**. Nenhuma conexão/credencial é escrita no manifest ou log.

Pelo celular, o dono abre o link da execução verde, desce até **Artifacts**, toca no artifact
e baixa o ZIP. Guarda esse ZIP e a chave privada no **Google Drive**, em pasta privada.
Para futuras limpezas, a guarda externa deve ser confirmada antes de remover cópias locais.
A remoção dos três schemas em 03/10/2026 foi uma exceção expressamente autorizada pelo dono,
que dispensou o backup. O workflow não exige que schemas já removidos existam; continua
exportando o banco inteiro sem filtros e exigindo os schemas ativos de produto/procedência.
`stage_access_20260928` permanece: há FK de `divat_integracao.memo_texto_origem` para ele.

### Descriptografar e restaurar (o agente executa)

Extrair o ZIP do artifact fora do repo. Com age e cliente PostgreSQL 17:

```bash
age -d -i chave.txt -o divat-backup.tar divat-backup.tar.age
tar -xf divat-backup.tar
```

Conferir SHA-256 de `database.dump` e `roles.sql` contra `manifest.json` antes de usar.
Preparar um PostgreSQL 17 **local/descartável**, vazio, com as extensões nas versões do manifest
e um superusuário temporário diferente dos roles da origem. Não criar projeto Supabase nem
usar o banco oficial como destino do exercício. O agente fornece a conexão somente por
variáveis `PG*` privadas em memória, sem URI/senha em arquivo, comando ou chat:

```bash
psql -X --set=ON_ERROR_STOP=1 --file=roles.sql
pg_restore --exit-on-error --single-transaction --dbname=divat_restore database.dump
```

Recontar todas as tabelas e comparar com `source_counts` do manifest. Conferir também RLS,
owners/ACLs, funções, publicação Realtime e leituras do portal antes de declarar recuperação.
O dump já preserva sequências; não executar a baseline histórica junto dele. O pacote cobre
o banco PostgreSQL, não arquivos externos de Storage, Edge Functions ou configurações do painel.

## Recuperação parcial e baseline histórica

`docs/backup_schema.sql` é anterior à Fase 3 e às cargas privadas recentes. Não reconstrói o
estado atual nem recupera snapshots históricos de dados. O histórico de 21 migrations está
em [schema.md](schema.md); não reaplicá-las sobre o banco em uso.

Qualquer exercício de reconstrução será feito em PostgreSQL local/descartável, sem sobrepor o banco
oficial nem criar outro projeto Supabase. O dump completo traz sua própria estrutura e não deve ser combinado com
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

O Caminho A inclui os schemas privados no mesmo dump consistente; a rotina REST não satisfaz
esse requisito. A execução aprovada e a guarda externa ainda precisam ser comprovadas antes
da limpeza de schemas. O dossiê histórico permanece em
[planos/fase-3-promocao-producao.md](planos/fase-3-promocao-producao.md).
