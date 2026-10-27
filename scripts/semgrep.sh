#!/usr/bin/env sh
# semgrep.sh — roda o Semgrep (análise estática) neste repo. Ver docs/semgrep.md.
#
# Por que um wrapper: o scan tem TRÊS fontes de regra, com requisitos diferentes de REDE.
#   - regras LOCAIS  (.semgrep/rules/) — invariantes deste projeto; rodam offline, sempre.
#   - rulesets VENDORIZADOS (.semgrep/vendor/) — cópia versionada dos rulesets do registry.
#     Rodam offline também. É o que faz o modo padrão valer tanto quanto o CI.
#   - rulesets do REGISTRY ao vivo (p/javascript, p/xss…) — baixados de semgrep.dev; precisam
#     de rede. No CI isso funciona; no ambiente do agente Claude a saída pra semgrep.dev é
#     bloqueada, igual ao `vercel` CLI (ver CLAUDE.md § Publicação).
#
# POR QUE VENDORIZAR (09/08/2026, e o motivo é um episódio real): enquanto o padrão rodava só
# as 5 regras locais e o CI rodava o conjunto completo, "verde local" não era evidência de
# "verde no CI" — e **3 achados de `run-shell-injection` passaram batido para o CI** no
# `atualizar-baseline.yml`. Cachear fora do git não resolveria para ninguém aqui: nem o agente
# nem o dono (que opera pelo celular, sem terminal) alcançam semgrep.dev. A cópia no git é a
# única forma de os dois rodarem o mesmo conjunto. Mesma disciplina do supabase-js e das fontes.
#
# A cópia se atualiza pelo workflow `atualizar-semgrep-rulesets` (aba Actions → Run workflow),
# que busca, regrava `.semgrep/vendor/` + o manifesto e abre um PR com o diff. Nunca à mão.
#
# Uso:
#   ./scripts/semgrep.sh            # locais + vendorizados (offline) — o padrão
#   ./scripts/semgrep.sh --full     # locais + registry AO VIVO (precisa de rede)
#   ./scripts/semgrep.sh --test     # testa as REGRAS contra .semgrep/tests/
#   ./scripts/semgrep.sh --so-locais  # SÓ as regras locais — cobertura reduzida, pedida às claras
#   ./scripts/semgrep.sh --baseline-commit=origin/main   # só o que a SUA branch introduziu
#
# O padrão FALHA (sai 2) se `.semgrep/vendor/` estiver incompleto, em vez de cair sozinho para
# as regras locais: até 25/10/2026 ele avisava e seguia, e um "saiu 0" com cobertura menor que a
# do CI é o falso verde de 14/08 de novo (achado A04 da revisão estática de 25/10/2026).
# Quem quer mesmo rodar só as locais pede `--so-locais`, e a linha "conjuntos:" diz o que rodou.
#
# `--full` continua existindo como conferência de FRESCOR: se ele acusar o que o padrão não
# acusou, a cópia vendorizada está velha — rode o workflow.
#
# Argumento extra vai direto pro `semgrep scan` (é o caso do --baseline-commit acima).
#
# Sai != 0 se houver achado (--error), pra servir de gate.
#
# Instalação do binário (não é dependência do projeto — o gate `node tests/check.js`
# continua Node puro e sem dependências):
#   pipx install semgrep      (recomendado)
#   python3 -m venv .venv-semgrep && .venv-semgrep/bin/pip install semgrep
# O .venv-semgrep/ está no .gitignore; este script o encontra sozinho.

set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"

# --- acha o binário: PATH, senão a venv local ---
if command -v semgrep >/dev/null 2>&1; then
  SEMGREP=semgrep
elif [ -e "$ROOT/.venv-semgrep/.instalando" ]; then
  # Marca do .claude/hooks/session-start.sh: a venv ainda está sendo montada em segundo plano,
  # e um binário pela metade pode existir antes de as dependências chegarem.
  echo "semgrep ainda está sendo instalado em segundo plano pelo hook de início de sessão." >&2
  echo "Acompanhe em .venv-semgrep.log e rode de novo em meio minuto. Se o log parou," >&2
  echo "refaça com: CLAUDE_CODE_REMOTE=true .claude/hooks/session-start.sh" >&2
  exit 127
elif [ -x "$ROOT/.venv-semgrep/bin/semgrep" ]; then
  SEMGREP="$ROOT/.venv-semgrep/bin/semgrep"
else
  echo "semgrep não encontrado. Instale com:" >&2
  echo "  pipx install semgrep" >&2
  echo "ou, sem pipx:" >&2
  echo "  python3 -m venv .venv-semgrep && .venv-semgrep/bin/pip install semgrep" >&2
  exit 127
fi

# --metrics=off: a razão NÃO é a visibilidade do repo (ele é público desde 31/07/2026, ver
# docs/adr/0003) — é não mandar dado do projeto para terceiro sem necessidade.
COMMON="--metrics=off --error"
LOCAL_RULES="--config=$ROOT/.semgrep/rules"

# Rulesets do registry. Escolhidos pelo que este portal É: JS de navegador que monta HTML
# por concatenação de string (xss), com chave Supabase em arquivo servido (secrets) e os
# workflows do Actions (github-actions). Sem p/react, p/nodejs etc. — não há nada disso aqui.
#
# Esta lista aparece em TRÊS lugares (aqui, no semgrep.yml e no atualizar-semgrep-rulesets.yml)
# e o `tests/check.js` §[2b] reprova se divergirem — sem essa guarda, editar só um faria o scan
# local, o CI e o atualizador operarem sobre conjuntos diferentes, em silêncio.
REGISTRY_IDS="javascript xss secrets github-actions"
REGISTRY=""
for _R in $REGISTRY_IDS; do REGISTRY="$REGISTRY --config=p/$_R"; done

# Cópia vendorizada dos rulesets acima. Exigimos o conjunto COMPLETO: um `.yml` solto não
# autoriza o modo offline. Se um arquivo se perder (merge malfeito, remoção acidental), o scan
# rodaria um subconjunto e devolveria verde — que é EXATAMENTE o falso verde que a vendorização
# existe para matar, e num repo limpo o parcial e o completo acham zero do mesmo jeito.
VENDOR_DIR="$ROOT/.semgrep/vendor"
VENDOR_RULES=""
VENDOR_FALTANDO=""
for _R in $REGISTRY_IDS; do
  [ -f "$VENDOR_DIR/$_R.yml" ] || VENDOR_FALTANDO="$VENDOR_FALTANDO p/$_R"
done
# `if` e não `x && y`: sob `set -e`, uma AND-OR list cujo lado esquerdo falha devolve não-zero
# e pode abortar o script — e quem decide o que fazer com o "faltando" é o modo, lá embaixo.
if [ -z "$VENDOR_FALTANDO" ]; then
  VENDOR_RULES="--config=$VENDOR_DIR"
fi

# Versão do binário × versão do CI. O CI fixa `semgrep==1.171.0`; a instrução de instalação do
# repo é `pipx install semgrep`, sem versão. Binário mais velho PULA regra que não entende, mais
# novo a interpreta diferente — e aí o mesmo `.semgrep/vendor/` dá verde aqui e vermelho no CI,
# reconstruindo o problema por outro caminho. A versão do CI é lida do próprio workflow (mesma
# fonte única que o hook de sessão usa), não copiada para um segundo lugar.
# AVISA, não falha: travar aqui quebraria a instalação do dono e o hook, e o risco é de
# divergência, não de dano.
aviso_versao() {
  [ -f "$ROOT/.github/workflows/semgrep.yml" ] || return 0
  V_CI=$(sed -n 's/.*pip install semgrep==\([0-9][0-9.]*\).*/\1/p' \
    "$ROOT/.github/workflows/semgrep.yml" | head -n 1)
  V_LOCAL=$("$SEMGREP" --version 2>/dev/null | head -n 1 | tr -d '\r')
  [ -n "$V_CI" ] && [ -n "$V_LOCAL" ] || return 0
  [ "$V_CI" = "$V_LOCAL" ] && return 0
  echo "AVISO: seu semgrep é $V_LOCAL; o CI roda $V_CI." >&2
  echo "       Versões diferentes leem os rulesets vendorizados de formas diferentes —" >&2
  echo "       verde aqui pode virar vermelho lá. Para alinhar:" >&2
  echo "         pipx install 'semgrep==$V_CI' --force" >&2
}

falha_sem_vendor() {
  echo "ERRO: .semgrep/vendor/ está incompleto — falta:$VENDOR_FALTANDO" >&2
  echo "      Sem o conjunto completo, um scan verde aqui NÃO é evidência de verde no CI." >&2
  echo "      Restaure os arquivos (git checkout -- .semgrep/vendor) ou rode a aba Actions →" >&2
  echo "      'Atualizar rulesets do Semgrep' → Run workflow (ele abre um PR com o diff)." >&2
  echo "      Para rodar só as regras locais sabendo que a cobertura é menor: --so-locais" >&2
  exit 2
}

case "${1:-}" in
  --test)
    # Offline de verdade: --metrics=off não desliga a consulta de versão a semgrep.dev.
    export SEMGREP_ENABLE_VERSION_CHECK=0
    exec "$SEMGREP" --test --metrics=off --config="$ROOT/.semgrep/rules" "$ROOT/.semgrep/tests"
    ;;
  --full)
    shift
    # shellcheck disable=SC2086
    exec "$SEMGREP" scan $COMMON $LOCAL_RULES $REGISTRY "$@" .
    ;;
  --so-locais)
    shift
    export SEMGREP_ENABLE_VERSION_CHECK=0
    echo "semgrep.sh: conjuntos: SÓ regras locais (--so-locais) — NÃO equivale ao CI" >&2
    # shellcheck disable=SC2086
    exec "$SEMGREP" scan $COMMON $LOCAL_RULES "$@" .
    ;;
  *)
    # O padrão usa apenas arquivos locais; não espere pelo timeout de um version check de rede.
    export SEMGREP_ENABLE_VERSION_CHECK=0
    if [ -z "$VENDOR_RULES" ]; then falha_sem_vendor; fi
    aviso_versao
    # shellcheck disable=SC2086
    echo "semgrep.sh: conjuntos: regras locais + vendorizados ($(echo $REGISTRY | sed 's/--config=//g'))" >&2
    # shellcheck disable=SC2086
    exec "$SEMGREP" scan $COMMON $LOCAL_RULES $VENDOR_RULES "$@" .
    ;;
esac
