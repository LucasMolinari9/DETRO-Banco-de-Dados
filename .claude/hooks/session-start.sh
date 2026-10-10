#!/bin/bash
# session-start.sh — prepara o ambiente de uma sessão do Claude Code na WEB.
#
# Por que existe: o container das sessões web é EFÊMERO (é reciclado depois de um tempo de
# inatividade), e o repo é zero-build de propósito — não há `package.json`, e o gate
# `node tests/check.js` é Node puro sem dependências. Essa decisão vale a pena e não muda;
# o preço é que as ferramentas de fora (Semgrep e Graft) precisam ser reinstaladas a cada
# sessão. Sem isso, `./scripts/semgrep.sh` sai 127 e o agente conferia os padrões proibidos
# à mão — foi exatamente o que aconteceu no PR #93.
#
# O que NÃO instala, porque a imagem já traz:
#   - Node 22 e Chromium (/opt/pw-browsers)
#   - Playwright 1.56.1 global — a MESMA versão fixada no .github/workflows/views.yml.
#     Se um dia divergirem, o certo é acertar o workflow, não instalar por cima aqui:
#     subir o Playwright é decisão, não efeito colateral (ver o cabeçalho do views.yml).
#
# Contratos que este script respeita:
#   - idempotente: rodar de novo com a venv pronta é um no-op barato;
#   - não bloqueia: a venv é montada em segundo plano (ver abaixo), o hook só confere e sai;
#   - não-interativo: nada de prompt;
#   - só no ambiente REMOTO: na máquina do dono, quem manda na instalação é o dono
#     (docs/semgrep.md § instalação recomenda pipx, que sobrevive entre sessões);
#   - nunca derruba a sessão: sai 0 sempre; se o PyPI estiver fora do ar, o motivo fica no
#     .venv-semgrep.log. Sessão sem Semgrep é pior que com, mas sessão que não abre é pior
#     que as duas.
set -euo pipefail

# Fora do ambiente remoto (máquina do dono, CI) este hook não tem o que fazer.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

ROOT="${CLAUDE_PROJECT_DIR:-$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)}"
cd "$ROOT"

# Graft (servidor MCP do .mcp.json): instalado GLOBAL para o scripts/graft.sh não depender
# do npx, cujo download estourava o timeout do handshake. A versão sai do próprio
# scripts/graft.sh (GRAFT_PACKAGE) — um lugar só para atualizar. Falha não derruba a sessão.
GRAFT_PACKAGE=$(sed -n "s/^readonly GRAFT_PACKAGE='\(.*\)'$/\1/p" "$ROOT/scripts/graft.sh")
if [ -n "$GRAFT_PACKAGE" ] \
  && [ "$(graft --version 2>/dev/null)" != "${GRAFT_PACKAGE##*@}" ]; then
  echo "session-start: instalando $GRAFT_PACKAGE…"
  npm install -g --silent "$GRAFT_PACKAGE" >/dev/null 2>&1 \
    || echo "session-start: falha ao instalar o Graft; scripts/graft.sh cai no npx." >&2
fi

VENV="$ROOT/.venv-semgrep"          # o caminho que scripts/semgrep.sh procura sozinho
WORKFLOW="$ROOT/.github/workflows/semgrep.yml"

# `semgrep --version` consulta semgrep.dev; com o host bloqueado pela rede do ambiente, cada
# conferência abaixo esperava ~99s, e a sessão só abre depois deste hook (medido em 10/10/2026).
# O scripts/semgrep.sh já desliga o mesmo check nos modos offline.
export SEMGREP_ENABLE_VERSION_CHECK=0

# A versão sai do WORKFLOW, não daqui: ela já é fixa lá (`pip install semgrep==X`) e o CI é
# quem dá o veredito. Repetir o número neste arquivo criaria um segundo lugar para atualizar
# — e o que diverge sem ninguém ver é justamente o que o repo passa o tempo todo caçando.
# Se o formato da linha mudar, o script diz isso em vez de instalar uma versão qualquer.
VERSAO=$(sed -n 's/.*semgrep==\([0-9][0-9.]*\).*/\1/p' "$WORKFLOW" | head -n 1)
if [ -z "$VERSAO" ]; then
  echo "session-start: não achei 'semgrep==<versão>' em $WORKFLOW — pulando o Semgrep." >&2
  echo "session-start: rode './scripts/semgrep.sh' para ver a mensagem de instalação." >&2
  exit 0
fi

# Instalação em SEGUNDO PLANO: o pip leva ~25s, e a sessão só abre quando este hook sai
# (medido em 10/10/2026: a primeira abertura de um container esperava a venv inteira). O hook
# só confere e dispara; quem precisar do Semgrep antes de terminar recebe o aviso do
# scripts/semgrep.sh. A marca `.instalando` diz "venv incompleta" e é também a trava (flock):
# o processo de segundo plano a segura até o fim, então marca sem dono é instalação que morreu
# no meio (container reciclado) e é refeita, nunca aceita.
MARCA="$VENV/.instalando"
LOG="$ROOT/.venv-semgrep.log"

instalar_semgrep() {
  local versao=$1 venv=$2
  echo "session-start: instalando semgrep==$versao em $venv ($(date -u +%FT%TZ))"
  if python3 -m venv "$venv" \
    && "$venv/bin/pip" install --quiet --disable-pip-version-check "semgrep==$versao" \
    && "$venv/bin/semgrep" --version 2>/dev/null | grep -qx "$versao"; then
    rm -f "$venv/.instalando"
    echo "session-start: semgrep $versao pronto — use ./scripts/semgrep.sh ($(date -u +%FT%TZ))"
  else
    rm -rf "$venv"    # venv pela metade engana o scripts/semgrep.sh, que só testa se o binário existe
    echo "session-start: falha ao instalar o Semgrep (rede/PyPI?). A sessão segue sem ele;"
    echo "session-start: o gate do CI continua cobrindo essa análise."
    return 1
  fi
}

if ! command -v flock >/dev/null 2>&1; then
  echo "session-start: sem 'flock' (util-linux) não há trava para a instalação — pulando o Semgrep." >&2
  exit 0
fi

# Idempotência: já está na versão certa? Não faz nada. (A comparação é com a versão do CI,
# então uma venv velha de uma sessão anterior é REFEITA em vez de aceita — local divergindo
# do CI é como um PR passa verde aqui e vermelho lá.)
if [ -e "$MARCA" ]; then
  if ! flock -n "$MARCA" true; then
    echo "session-start: semgrep==$VERSAO ainda instalando em segundo plano (log: .venv-semgrep.log)."
    exit 0
  fi
elif [ -x "$VENV/bin/semgrep" ] && "$VENV/bin/semgrep" --version 2>/dev/null | grep -qx "$VERSAO"; then
  echo "session-start: semgrep $VERSAO já instalado."
  exit 0
fi

rm -rf "$VENV"
mkdir -p "$VENV"
exec 9>"$MARCA"
if ! flock -n 9; then
  echo "session-start: outra abertura já está instalando o semgrep (log: .venv-semgrep.log)."
  exit 0
fi
# setsid + todos os fds redirecionados: o filho sai do grupo do hook e não segura o stdout que
# o Claude Code lê — senão o hook "não terminaria" até o pip acabar. O fd 9 (a trava) é herdado.
export -f instalar_semgrep
setsid bash -c 'instalar_semgrep "$@"' _ "$VERSAO" "$VENV" >"$LOG" 2>&1 </dev/null &
exec 9>&-
echo "session-start: instalando semgrep==$VERSAO em segundo plano (~30s; log: .venv-semgrep.log)."
echo "session-start: a sessão não espera; ./scripts/semgrep.sh avisa enquanto não terminar."
