# Issue tracker: GitHub

Issues e PRDs deste repo vivem como GitHub issues em **`LucasMolinari9/DETRO-Banco-de-Dados`**.
O repo se chamava `LucasMolinari9/LucasCTEC`; issues, PRs e números vieram junto na renomeação
(a #121, aberta com o nome antigo, responde no nome novo). Use sempre o nome atual.

## Qual ferramenta usar

O dono opera pelo celular, então as sessões rodam na nuvem do Claude Code. Lá:

- **Use as ferramentas MCP do GitHub** (`mcp__github__*`), sempre com `owner: "LucasMolinari9"`
  e `repo: "DETRO-Banco-de-Dados"`. Se aparecerem só pelo nome, carregue-as pelo ToolSearch.
- **A CLI `gh` existe no container, mas não está autenticada** — o `GH_TOKEN` dela é recusado
  (conferido em 25/10/2026). Não conte com ela. Numa máquina com `gh auth login` feito, os
  comandos `gh` equivalentes servem.
- O acesso da sessão ao GitHub é restrito a este repo pelo nome atual; chamadas com o nome antigo
  podem ser recusadas.

## Convenções

- **Buscar antes de criar** (evita duplicata): `search_issues` com `owner`/`repo` e o termo em
  linguagem natural.
- **Criar issue**: `issue_write` com `method: "create"`, `title`, `body` e, se for o caso,
  `labels`.
- **Ler issue**: `issue_read` com `method: "get"` (corpo, labels, estado, assignees) e
  `method: "get_comments"` para os comentários.
- **Listar issues**: `list_issues` com `state: "OPEN"`, `labels: [...]` para filtrar e `fields`
  para enxugar a resposta (ex.: `["number", "title", "labels", "assignees", "updated_at"]`). A
  paginação é por cursor: `after` recebe o `endCursor` da página anterior.
- **Comentar numa issue**: `add_issue_comment` com `issue_number` e `body`.
- **Aplicar / remover labels**: `issue_write` com `method: "update"` e `labels`. **`labels`
  substitui o conjunto inteiro, não acrescenta:** leia as atuais com `issue_read`
  `method: "get_labels"`, monte a lista nova (atuais + a nova, ou atuais − a removida) e mande a
  lista completa. Mandar só a label nova apaga as outras.
- **Fechar**: comente o motivo com `add_issue_comment` e depois `issue_write` `update` com
  `state: "closed"` e `state_reason` (`"completed"`, `"not_planned"`, ou `"duplicate"` junto de
  `duplicate_of`).

## PRs como superfície de triagem

**PRs como superfície de pedido: não.** _(Ligar para `sim` se este repo tratar PRs externos como
pedidos de feature; o `/triage` lê essa flag.)_

Quando ligado (`sim`), PRs passam pelos mesmos labels e estados que issues:

- **Ler um PR**: `pull_request_read` com `method: "get"`, `"get_comments"` e `"get_diff"`.
- **Listar PRs externos para triagem**: `search_pull_requests` com `query: "is:open"`,
  `owner`/`repo` e `fields` incluindo `author_association`, mantendo só `CONTRIBUTOR`,
  `FIRST_TIME_CONTRIBUTOR` ou `NONE` (descartar `OWNER`/`MEMBER`/`COLLABORATOR`). O
  `list_pull_requests` não devolve esse campo.
- **Comentar / rotular / fechar**: `add_issue_comment` (aceita número de PR), `issue_write`
  `update` com `labels` (mesma regra: lista completa) e `update_pull_request` com
  `state: "closed"`.

O GitHub compartilha um único espaço de números entre issues e PRs, então um `#42` isolado pode
ser qualquer um dos dois — resolva com `pull_request_read` `get` no 42, com fallback para
`issue_read` `get`.

## Quando uma skill disser "publicar no rastreador de issues"

Criar uma issue no GitHub (`issue_write` com `method: "create"`).

## Quando uma skill disser "buscar o ticket relevante"

`issue_read` com `method: "get"` e depois `method: "get_comments"`.

## Operações do wayfinder

Usadas por `/wayfinder`. O **mapa** é uma issue única com issues **filhas** como tickets.

- **Mapa**: uma issue com label `wayfinder:map`, contendo o corpo Notes / Decisions-so-far /
  Fog. `issue_write` `create` com `labels: ["wayfinder:map"]`.
- **Ticket filho**: crie-o já pendurado no mapa, com `issue_write` `create` e
  `parent_issue_number: <mapa>` — cria e liga como sub-issue numa operação só. Pendurar uma issue
  que já existe exige `sub_issue_write` `method: "add"` com `sub_issue_id`, o **id numérico** da
  issue (não o `#number`), que o `issue_read` não mostra; sem ele, adicionar o filho a uma task
  list no corpo do mapa e colocar `Part of #<map>` no topo do corpo do filho. Labels:
  `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). Uma vez reivindicado, o ticket
  é atribuído ao dev que está conduzindo.
- **Bloqueio**: a representação canônica seriam as **dependências nativas de issue** do GitHub,
  visíveis na UI — mas as ferramentas MCP desta sessão não as leem nem as escrevem (conferido em
  25/10/2026), e o `gh api` não está autenticado. Na nuvem, então, o bloqueio é a linha
  `Blocked by: #<n>, #<n>` no topo do corpo do filho. Numa máquina com `gh` autenticado, a aresta
  nativa sai com `gh api --method POST
  repos/LucasMolinari9/DETRO-Banco-de-Dados/issues/<child>/dependencies/blocked_by -F
  issue_id=<blocker-db-id>`, onde `<blocker-db-id>` é o **database id** numérico do bloqueador
  (`gh api repos/LucasMolinari9/DETRO-Banco-de-Dados/issues/<n> --jq .id`, _não_ o `#number` nem
  o `node_id`); quem criar aresta nativa escreve **também** a linha `Blocked by:`, senão uma
  sessão na nuvem não enxerga o bloqueio. Um ticket é desbloqueado quando todo bloqueador estiver
  fechado.
- **Query de fronteira**: listar os filhos do mapa com `issue_read` `method: "get_sub_issues"`
  (ou a task list do corpo do mapa), manter os abertos e descartar qualquer um com assignee ou
  com bloqueador aberto — para cada `#n` da linha `Blocked by:`, `issue_read` `get` e conferir o
  `state`. O primeiro na ordem do mapa vence.
- **Reivindicar**: `issue_write` `update` com `assignees: ["<seu login>"]` (o login vem de
  `get_me`) — a primeira escrita da sessão. `assignees` também substitui o conjunto inteiro.
- **Resolver**: `add_issue_comment` com a resposta, depois `issue_write` `update` com
  `state: "closed"` e `state_reason: "completed"`, depois anexar um ponteiro de contexto (gist +
  link) ao Decisions-so-far do mapa: releia o corpo do mapa com `issue_read` `get` logo antes de
  gravar, acrescente a linha e mande o corpo inteiro com `issue_write` `update` `body` — outras
  sessões podem estar editando o mapa ao mesmo tempo.
