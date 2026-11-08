# Testes — módulos reais e contratos do portal

O gate usa Node, Git e shell POSIX, sem pacotes npm adicionais. Use Node.js 22.12+ ou 20.19+:
os harnesses CommonJS carregam os módulos `.mjs` reais com `require()`. O CI seleciona Node 20.
Não há cópias de funções de produção: o `fetch` é mockado e os testes que invocam PostgreSQL
usam `psql` falso. Alguns testes criam processos ou servidores locais; o ambiente deve permiti-los.

## Como rodar

**Recomendado — roda tudo de uma vez (é o gate de pré-publicação):**
```bash
node tests/check.js
```
Esse comando: (1) valida a **sintaxe** do `app.js` sem executar a página;
(2) confere assets publicados, CSP e deriva docs × código;
(3) roda todos os `*.test.js` e `*.test.mjs`. Sai com código ≠ 0 se algo
falhar — **rode-o antes de cada publicação**.

As bancadas com servidor/processo filho ficam separadas e também rodam no workflow `ci.yml`:

```bash
NO_PROXY=127.0.0.1 node tests/backup_rest.rig.mjs
NO_PROXY=127.0.0.1 node tests/restore_rest.rig.mjs
```

Avulso (um arquivo só), se quiser:
```bash
cd tests
node sbFetch.test.js    # casos de sbFetch / marcarTrunc / bannerTrunc
node pure.test.js       # lógica pura (formatação, busca, filtros de negócio)
node realtime.test.js   # VIEW_TABLES ⊆ RT_TABLES + mapa canônico
```
O runner informa sucesso ou falha por arquivo. Parte da suíte imprime `==== PLACAR: N/N ====`,
e parte usa o relatório nativo de `node:test`; o `check.js` não soma um total global de casos.

## O que é coberto
- **`sbFetch`** — sucesso; retry em 5xx e 429; 4xx que **não** repete (lança a
  mensagem do corpo); erro de rede (`TypeError`) que repete até o limite; e
  **timeout** via `AbortController` (não trava).
- **`marcarTrunc`** — marca arrays cortados (`limit>=50` que veio cheia) com a flag
  **não-enumerável** `_trunc`/`_limite`; não marca quando o limite é pequeno (<50),
  ausente, ou a lista não encheu; confirma que a flag **não vaza** em
  `JSON.stringify`/`Object.keys`/`spread`/`map`.
- **`bannerTrunc`** — gera o aviso "Resultado parcial…" só quando há truncagem.
- **Formatação:** `fmtCode`, `fmtTime`, `fmtDate`, `fmtMoney`, `orDash`, `boolChip`.
- **Segurança/busca:** `esc` (escape HTML / XSS), `enc`, `norm` (acento+caixa).
- **Lógica de negócio:** `matchEvent` (filtro do histórico por texto/processo/ano),
  `groupBy`/`countBy` (agregação dos relatórios), `tabMatchesEvent`/`dispatchRealtime`
  (dispatch do Realtime por aba: a aba ativa recarrega ao vivo, as de segundo plano só
  ficam marcadas como desatualizadas).
- **Sincronização do Realtime** (`realtime.test.js`): `VIEW_TABLES` bate com o mapa canônico,
  toda tabela citada em `VIEW_TABLES` está em `RT_TABLES`, e `RT_TABLES` == a publicação esperada
  (a checagem **viva** contra o banco fica em `scripts/check_realtime.mjs`, que precisa de rede).

## Arquivos
- `check.js` — **runner / gate de pré-publicação** (sintaxe, allowlist, deriva docs×código e testes).
- `harness.js` — ponte CommonJS para os módulos reais usados por `sbFetch.test.js`: REST, banner de truncagem e cache de lookup.
- `sbFetch.test.js` — casos de `sbFetch`/`marcarTrunc`/`bannerTrunc`/`preencherLookup`.
- `pure.harness.js` — ponte CommonJS para `src/domain/*.mjs`: desde a Sessão 4 não copia mais
  nada, só faz `require` dos módulos reais (era cópia verbatim de 30 funções, 305 linhas).
- `pure.test.js` — casos das funções puras.
- `domain-module.test.mjs` — os módulos de `src/domain/` pelo caminho ESM (o mesmo `import` do
  navegador), provando que carregam e exportam o que prometem.
- `ui-data-module.test.mjs` — o mesmo, para `src/ui/`, `src/data/` e contratos de `src/documentos/`: markup de documento, caches
  de lookup e o que a família de listas tem de markup puro. Inclui as guardas de configuração de `configurarRest`, `configurarDoc` e `configurarListas`. O que escreve no DOM não cabe
  aqui — Node não tem `document` e o repo é zero-dependência — e fica com os gates de navegador.
- `realtime.test.js` — guarda a sincronização `VIEW_TABLES`/`RT_TABLES` (extrai os literais do `app.js`).
- `check_deriva.test.mjs` — executa o gate com `psql` falso; cobre RPCs do shell e de módulos
  aninhados, incluindo reprovação quando a API simulada deixa de expor uma chamada.
- `backup_rest.rig.mjs` — paginação keyset, contagem, SHA-256 e headers das chaves opacas.
- `restore_rest.rig.mjs` — corrupção, confirmação do ref, destino vazio, ordem da FK e contagem final.

## Gates de navegador

Requerem o pacote Node Playwright e Chromium, além das bibliotecas de sistema do navegador.
O workflow `views.yml` usa Playwright 1.56.1. Em ambiente local preparado para essa versão:

```bash
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install -g playwright@1.56.1
playwright install chromium
node scripts/check_views.mjs
node scripts/check_abas.mjs
node scripts/check_selecao_linha.mjs
node scripts/check_corrida_abas.mjs
node scripts/check_resultados.mjs
```

Em Linux sem as bibliotecas necessárias, siga o passo `playwright install --with-deps chromium`
do CI com a permissão administrativa correspondente. `DIVAT_CHROMIUM_EXECUTABLE` permite usar
um Chromium já instalado. O servidor e as fixtures vêm de `scripts/lib/rig.mjs`; os gates cobrem
renderização, abas, seleção, concorrência e completude/PDF. Não comprovam o banco real nem DR.

## Outras verificações

- `python3 -m unittest discover -s tests -p 'backup_private_test.py'`: guardas offline do backup
  integral; requer Python 3 e não realiza dump ou restauração real.
- `node scripts/check_migrations.mjs`: contrato estático das migrations, sem aplicá-las.
- `node tests/check_grants.rig.mjs`: cenários de permissões com auditor simulado.
- Os gates vivos de banco exigem `psql`, conectividade e `SUPABASE_TEST_AUDIT_DATABASE_URL`.
  Preparação em [hardening moderado](../docs/planos/fase-3-hardening-moderado.md). O alvo é o
  banco oficial; não executar esses comandos como se fossem simulações locais.
