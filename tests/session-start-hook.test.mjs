import assert from 'node:assert/strict';
import {
  chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

// O hook de sessão roda ANTES de a sessão abrir: tudo o que ele espera, o usuário espera junto.
// Duas esperas já custaram caro (medidas em 10/10/2026):
//   - `semgrep --version` sem SEMGREP_ENABLE_VERSION_CHECK=0 consultava semgrep.dev, bloqueado
//     pela rede do ambiente, e levava ~99s em toda abertura;
//   - a instalação da venv (~25s) segurava a primeira abertura de cada container — e terminava
//     com outro `semgrep --version`, somando os mesmos ~99s.
// Este teste roda o hook REAL contra python3/pip/semgrep falsos e cobra que ele só confere,
// dispara a instalação em segundo plano e sai — e que o scripts/semgrep.sh não usa a venv pela
// metade enquanto isso.
const raiz = resolve(import.meta.dirname, '..');
const projeto = mkdtempSync(join(tmpdir(), 'divat-session-start-'));
const bin = join(projeto, 'bin');
const venv = join(projeto, '.venv-semgrep');
const marca = join(venv, '.instalando');
const log = join(projeto, '.venv-semgrep.log');
const registro = join(projeto, 'chamadas.log');
const liberar = join(projeto, 'liberar');
const falhar = join(projeto, 'falhar');

// Cópias reais das fontes que o hook e o wrapper leem, para o teste não fixar número.
mkdirSync(join(projeto, 'scripts'));
mkdirSync(join(projeto, '.github/workflows'), { recursive: true });
copyFileSync(join(raiz, 'scripts/graft.sh'), join(projeto, 'scripts/graft.sh'));
copyFileSync(join(raiz, 'scripts/semgrep.sh'), join(projeto, 'scripts/semgrep.sh'));
copyFileSync(join(raiz, '.github/workflows/semgrep.yml'), join(projeto, '.github/workflows/semgrep.yml'));

const versaoGraft = readFileSync(join(raiz, 'scripts/graft.sh'), 'utf8')
  .match(/^readonly GRAFT_PACKAGE='.*@([^@']+)'$/m)[1];
const versaoSemgrep = readFileSync(join(raiz, '.github/workflows/semgrep.yml'), 'utf8')
  .match(/semgrep==([0-9][0-9.]*)/)[1];

function falso(caminho, corpo) {
  writeFileSync(caminho, `#!/bin/sh\n${corpo}\n`);
  chmodSync(caminho, 0o755);
}

const semgrepFalso = `printf '%s\\t%s\\n' "\${SEMGREP_ENABLE_VERSION_CHECK-<ausente>}" "$*" >> "${registro}"
if [ "\${1-}" = "--version" ]; then printf '%s\\n' '${versaoSemgrep}'; fi`;

// pip falso: segura a "instalação" até o teste criar `liberar` (ou falha com `falhar`), para o
// teste observar o estado DURANTE a instalação sem depender de relógio. No fim põe o semgrep
// falso ao lado de si mesmo, como o pip de verdade faz no bin/ da venv.
const semgrepModelo = join(projeto, 'semgrep-modelo');
const pipModelo = join(projeto, 'pip-modelo');
falso(semgrepModelo, semgrepFalso);
falso(pipModelo, `i=0
while [ ! -e "${liberar}" ]; do
  if [ -e "${falhar}" ] || [ "$i" -ge 300 ]; then exit 1; fi
  sleep 0.1; i=$((i + 1))
done
cp "${semgrepModelo}" "$(dirname "$0")/semgrep"`);

mkdirSync(bin);
// graft já na versão fixada: o hook não tenta `npm install -g`.
falso(join(bin, 'graft'), `printf '%s\\n' '${versaoGraft}'`);
// python3 falso: só o `-m venv DIR`, que é o único uso no hook.
falso(join(bin, 'python3'), `[ "$1 $2" = "-m venv" ] || exit 2
mkdir -p "$3/bin"
cp "${pipModelo}" "$3/bin/pip"`);

const env = {
  ...process.env,
  PATH: `${bin}:${process.env.PATH}`,
  CLAUDE_CODE_REMOTE: 'true',
  CLAUDE_PROJECT_DIR: projeto,
};
delete env.SEMGREP_ENABLE_VERSION_CHECK;

// spawnSync só volta quando o hook sai E os pipes fecham: se o processo de segundo plano
// herdasse o stdout, o hook "não terminaria" e o timeout acusaria.
function hook() {
  const r = spawnSync(join(raiz, '.claude/hooks/session-start.sh'), [], {
    env, encoding: 'utf8', timeout: 10000,
  });
  assert.equal(r.error, undefined, `hook não voltou a tempo: ${r.error}`);
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}

function dormir(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function esperar(condicao, descricao) {
  for (let i = 0; i < 300; i++) {
    if (condicao()) return;
    dormir(50);
  }
  assert.fail(`tempo esgotado esperando: ${descricao}\nlog:\n${existsSync(log) ? readFileSync(log, 'utf8') : '(sem log)'}`);
}

function chamadasSemgrep() {
  return existsSync(registro) ? readFileSync(registro, 'utf8').trim().split('\n') : [];
}

try {
  // 1. Container novo: dispara a instalação e sai sem esperar o pip.
  assert.match(hook(), /segundo plano/, 'venv ausente deve instalar em segundo plano');
  assert.ok(existsSync(marca), 'a marca de instalação em andamento deve existir');

  // 2. Nova abertura durante a instalação: não refaz nem apaga a venv.
  assert.match(hook(), /ainda instalando/, 'instalação viva deve ser respeitada');
  assert.ok(existsSync(marca));

  // 3. O wrapper não usa a venv pela metade (sem semgrep no PATH, só sh e dirname).
  const binMinimo = join(projeto, 'bin-minimo');
  mkdirSync(binMinimo);
  for (const ferramenta of ['sh', 'dirname']) {
    const real = spawnSync('sh', ['-c', `command -v ${ferramenta}`], { encoding: 'utf8' }).stdout.trim();
    symlinkSync(real, join(binMinimo, ferramenta));
  }
  const wrapper = spawnSync(join(projeto, 'scripts/semgrep.sh'), [], {
    env: { PATH: binMinimo }, encoding: 'utf8',
  });
  assert.equal(wrapper.status, 127, wrapper.stderr);
  assert.match(wrapper.stderr, /segundo plano/, 'o wrapper deve dizer que a instalação está em andamento');

  // 4. Instalação termina: marca some, log registra, próxima abertura só confere.
  writeFileSync(liberar, '');
  esperar(() => !existsSync(marca), 'a instalação terminar');
  assert.match(readFileSync(log, 'utf8'), /pronto/);
  assert.match(hook(), /já instalado/, 'venv na versão do CI deve ser aceita sem reinstalar');
  assert.ok(chamadasSemgrep().length > 0);
  for (const chamada of chamadasSemgrep()) {
    assert.match(chamada, /^0\t--version$/, 'toda conferência de versão deve desligar o version check de rede');
  }

  // 5. Container reciclado no meio da instalação: marca sem dono é refeita, não aceita.
  rmSync(liberar);
  writeFileSync(marca, '');
  assert.match(hook(), /segundo plano/, 'marca sem processo vivo deve reinstalar');

  // 6. Falha no pip: nada de venv pela metade, e o motivo fica no log.
  writeFileSync(falhar, '');
  esperar(() => !existsSync(venv), 'a venv falha ser removida');
  assert.match(readFileSync(log, 'utf8'), /falha/);
} finally {
  writeFileSync(falhar, '');   // nenhum pip falso fica esperando depois do teste
}

console.log('✓ session-start-hook: semgrep instala em segundo plano, sem version check de rede');
