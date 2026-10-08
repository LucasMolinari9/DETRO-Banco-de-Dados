#!/usr/bin/env bash
# Launcher de desenvolvimento: versão única para a CLI, MCP e GitHub Actions.
# Não cria package.json na raiz nem instala dependências do site.
set -euo pipefail

readonly GRAFT_PACKAGE='@nanonets/graft@0.21.1'
GRAFT_REPO_ROOT="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$GRAFT_REPO_ROOT"

# O cache já está no .gitignore; não reescrever arquivos de configuração ao consultar.
export DO_NOT_TRACK=1
export GRAFT_NO_GITIGNORE=1
export GRAFT_NO_IGNORE=1
export npm_config_cache="$GRAFT_REPO_ROOT/.graft/npm"

node -e 'if (Number(process.versions.node.split(".")[0]) < 22) {
  console.error("Graft: use Node.js 22 ou mais recente.");
  process.exit(1);
}'

# Binário global na versão fixada (o .claude/hooks/session-start.sh instala) evita o
# download do npx (~20s), que sozinho estourava o timeout de 30s do handshake MCP.
# Versão diferente ou ausente: cai no npx, que sempre respeita a fixada acima.
GRAFT_CMD=(npx --yes --package="$GRAFT_PACKAGE" graft)
if command -v graft >/dev/null 2>&1 \
  && [[ "$(graft --version 2>/dev/null)" == "${GRAFT_PACKAGE##*@}" ]]; then
  GRAFT_CMD=(graft)
fi

# Sem grafo, o servidor upstream anuncia zero ferramentas. Preparar a primeira
# cópia antes do handshake; stdout fica reservado ao protocolo MCP.
if [[ "${1:-}" == 'mcp' && ! -f graft/.graph/wiring.json ]]; then
  "${GRAFT_CMD[@]}" build >&2
fi

exec "${GRAFT_CMD[@]}" "$@"
