'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { spawnSync } = require('child_process');

const smoke = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'check_deploy.mjs'), 'utf8');

assert.match(
  smoke,
  /publicResponses\.get\(['"]\/src\/data\/rest\.mjs['"]\)/,
  'o smoke deve ler a guarda fail-closed do módulo REST publicado, não procurá-la no app.js'
);
assert.match(smoke, /Configuração Supabase ausente para o ambiente de/);
assert.match(smoke, /\.test\(restSource\)/, 'a guarda deve ser verificada no corpo de rest.mjs');
const root = path.join(__dirname, '..');
const fixture = path.join(__dirname, 'fixtures', 'deploy-smoke-fetch.mjs');
const run = (scenario, url = 'https://divatdetro.vercel.app', environment = 'production') => {
  const result = spawnSync(process.execPath, ['--import', fixture, 'scripts/check_deploy.mjs', url, environment], {
    cwd: root,
    env: { ...process.env, DIVAT_SMOKE_SCENARIO: scenario, VERCEL_AUTOMATION_BYPASS_SECRET: '' },
    encoding: 'utf8',
    timeout: 10_000,
  });
  assert.ifError(result.error);
  return { status: result.status, output: result.stdout + result.stderr };
};

for (const [url, environment] of [['https://divatdetro.vercel.app', 'production'], ['https://divat-preview.vercel.app', 'preview']]) {
  const current = run('current', url, environment);
  assert.strictEqual(current.status, 0, current.output);
  assert.match(current.output, /previews compartilham o banco oficial; isolamento pendente/);
  assert.doesNotMatch(current.output, /isolamento de ambiente estão coerentes/);
}

for (const [scenario, message] of [
  ['retired-config', /URL de produção inesperada/],
  ['missing-preview', /URL de preview inesperada/],
  ['wrong-ref-key', /preview: JWT aponta/],
  ['admin-key', /produção: JWT aponta para role=service_role/],
  ['missing-csp', /CSP sem https:\/\/gontnlfmothfglssbyyk/],
  ['retired-csp', /CSP permite o projeto Supabase apagado/],
  ['missing-guard', /não contém o throw fail-closed/],
  ['exposed-file', /\.mcp\.json: esperado HTTP 404, recebido 200/],
]) {
  const result = run(scenario);
  assert.strictEqual(result.status, 1, `${scenario}: ${result.output}`);
  assert.match(result.output, message, `${scenario}: ${result.output}`);
}
console.log('==== PLACAR: 13/13 ====');
