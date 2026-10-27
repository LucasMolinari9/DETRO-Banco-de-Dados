import assert from 'node:assert/strict';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const raiz = resolve(import.meta.dirname, '..');
const temporario = mkdtempSync(join(tmpdir(), 'divat-semgrep-wrapper-'));
const registro = join(temporario, 'chamadas.log');
const semgrepFalso = join(temporario, 'semgrep');

writeFileSync(semgrepFalso, `#!/bin/sh
printf '%s\\t%s\\n' "\${SEMGREP_ENABLE_VERSION_CHECK-<ausente>}" "$*" >> "${registro}"
if [ "\${1-}" = "--version" ]; then printf '%s\\n' '1.171.0'; fi
`);
chmodSync(semgrepFalso, 0o755);

function executar(projeto, ...args) {
  const env = { ...process.env, PATH: `${temporario}:${process.env.PATH}` };
  delete env.SEMGREP_ENABLE_VERSION_CHECK;
  return spawnSync(join(projeto, 'scripts/semgrep.sh'), args, {
    cwd: projeto,
    env,
    encoding: 'utf8',
  });
}

function chamadas() {
  try { return readFileSync(registro, 'utf8').trim().split('\n').filter(Boolean); }
  catch { return []; }
}

function executarOk(...args) {
  const resultado = executar(raiz, ...args);
  assert.equal(resultado.status, 0, resultado.stderr);
  return resultado;
}

try {
  // 1. Repo real, vendor completo: os três modos rodam, e só o --full consulta a rede.
  const padrao = executarOk();
  executarOk('--test');
  executarOk('--full');

  const feitas = chamadas();
  assert.equal(feitas.length, 4, feitas.join('\n'));
  assert.match(feitas[0], /^0\t--version$/, 'version check indireto do modo padrão deve ficar offline');
  assert.match(feitas[1], /^0\tscan /, 'scan padrão deve desativar version check');
  assert.match(feitas[1], /\.semgrep\/vendor /, 'scan padrão deve incluir os rulesets vendorizados');
  assert.match(feitas[2], /^0\t--test /, '--test deve desativar version check');
  assert.match(feitas[3], /^<ausente>\tscan /, '--full deve preservar o version check online');
  assert.match(padrao.stderr, /conjuntos: regras locais \+ vendorizados \(p\/javascript p\/xss p\/secrets p\/github-actions\)/,
    'o modo padrão deve dizer quais conjuntos rodou');

  // 2. Vendor incompleto: o padrão falha fechado em vez de cair sozinho para as regras locais
  //    (achado A04 de 25/10/2026). Cópia do script num projeto falso, porque o ROOT do wrapper
  //    é o diretório do próprio script.
  const projeto = join(temporario, 'projeto');
  mkdirSync(join(projeto, 'scripts'), { recursive: true });
  mkdirSync(join(projeto, '.semgrep', 'rules'), { recursive: true });
  mkdirSync(join(projeto, '.semgrep', 'vendor'), { recursive: true });
  copyFileSync(join(raiz, 'scripts/semgrep.sh'), join(projeto, 'scripts/semgrep.sh'));
  for (const id of ['javascript', 'xss', 'secrets']) writeFileSync(join(projeto, '.semgrep', 'vendor', `${id}.yml`), 'rules: []\n');
  rmSync(registro, { force: true });

  const incompleto = executar(projeto);
  assert.equal(incompleto.status, 2, 'vendor incompleto deve sair 2, não 0:\n' + incompleto.stderr);
  assert.match(incompleto.stderr, /falta: p\/github-actions/, 'o erro deve dizer o que falta');
  assert.match(incompleto.stderr, /--so-locais/, 'o erro deve dizer como aceitar cobertura reduzida');
  assert.ok(!chamadas().some(c => /\tscan /.test(c)), 'com vendor incompleto o scan não pode rodar');

  // 3. Cobertura reduzida só quando pedida às claras, e dita na saída.
  const soLocais = executar(projeto, '--so-locais');
  assert.equal(soLocais.status, 0, soLocais.stderr);
  assert.match(soLocais.stderr, /conjuntos: SÓ regras locais/, '--so-locais deve anunciar a cobertura reduzida');
  const scan = chamadas().filter(c => /\tscan /.test(c));
  assert.equal(scan.length, 1, scan.join('\n'));
  assert.match(scan[0], /^0\tscan /, '--so-locais é offline e deve desativar version check');
  assert.ok(!/vendor/.test(scan[0]), '--so-locais não pode passar o vendor parcial ao semgrep');
} finally {
  rmSync(temporario, { recursive: true, force: true });
}

console.log('✓ semgrep-wrapper: modos offline sem version check; --full preservado; vendor incompleto falha fechado');
