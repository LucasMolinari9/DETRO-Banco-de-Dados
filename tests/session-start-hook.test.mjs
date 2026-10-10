import assert from 'node:assert/strict';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

// O hook de sessão confere a venv com `semgrep --version`. Sem SEMGREP_ENABLE_VERSION_CHECK=0
// o semgrep consulta semgrep.dev, e no ambiente remoto com o host bloqueado isso esperava ~99s
// a cada início de sessão (medido em 10/10/2026) — a sessão só abre depois do hook.
const raiz = resolve(import.meta.dirname, '..');
const projeto = mkdtempSync(join(tmpdir(), 'divat-session-start-'));
const bin = join(projeto, 'bin');
const registro = join(projeto, 'chamadas.log');

// Cópias reais das duas fontes de versão que o hook lê, para o teste não fixar número.
mkdirSync(join(projeto, 'scripts'));
mkdirSync(join(projeto, '.github/workflows'), { recursive: true });
copyFileSync(join(raiz, 'scripts/graft.sh'), join(projeto, 'scripts/graft.sh'));
copyFileSync(join(raiz, '.github/workflows/semgrep.yml'), join(projeto, '.github/workflows/semgrep.yml'));

const versaoGraft = readFileSync(join(raiz, 'scripts/graft.sh'), 'utf8')
  .match(/^readonly GRAFT_PACKAGE='.*@([^@']+)'$/m)[1];
const versaoSemgrep = readFileSync(join(raiz, '.github/workflows/semgrep.yml'), 'utf8')
  .match(/semgrep==([0-9][0-9.]*)/)[1];

function falso(caminho, corpo) {
  writeFileSync(caminho, `#!/bin/sh\n${corpo}\n`);
  chmodSync(caminho, 0o755);
}

// graft já na versão fixada: o hook não tenta `npm install -g`.
mkdirSync(bin);
falso(join(bin, 'graft'), `printf '%s\\n' '${versaoGraft}'`);
// venv já pronta na versão do CI: o hook só confere e sai.
mkdirSync(join(projeto, '.venv-semgrep/bin'), { recursive: true });
falso(join(projeto, '.venv-semgrep/bin/semgrep'), `printf '%s\\t%s\\n' "\${SEMGREP_ENABLE_VERSION_CHECK-<ausente>}" "$*" >> "${registro}"
if [ "\${1-}" = "--version" ]; then printf '%s\\n' '${versaoSemgrep}'; fi`);

const env = {
  ...process.env,
  PATH: `${bin}:${process.env.PATH}`,
  CLAUDE_CODE_REMOTE: 'true',
  CLAUDE_PROJECT_DIR: projeto,
};
delete env.SEMGREP_ENABLE_VERSION_CHECK;

const resultado = spawnSync(join(raiz, '.claude/hooks/session-start.sh'), [], {
  env,
  encoding: 'utf8',
});
assert.equal(resultado.status, 0, resultado.stderr);
assert.match(resultado.stdout, /já instalado/, 'venv na versão do CI deve ser aceita sem reinstalar');

const chamadas = readFileSync(registro, 'utf8').trim().split('\n');
assert.deepEqual(chamadas, ['0\t--version'],
  'a conferência de versão do hook deve desligar o version check de rede');

console.log('✓ session-start-hook: conferência do semgrep sem version check de rede');
