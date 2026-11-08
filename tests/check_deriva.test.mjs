// Regressão offline: a modularização não pode esconder RPCs do gate docs × banco.
// O processo completo usa um psql falso; nenhum endpoint PostgreSQL é acessado.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const real = fileURLToPath(new URL('../', import.meta.url));
const temporario = mkdtempSync(join(tmpdir(), 'divat-deriva-'));
after(() => rmSync(temporario, { recursive: true, force: true }));

function executar(rpcs) {
  const raiz = mkdtempSync(join(temporario, 'caso-'));
  for (const dir of ['scripts/lib', 'docs', 'src/documentos/aninhado', 'bin']) {
    mkdirSync(join(raiz, dir), { recursive: true });
  }
  for (const arquivo of ['scripts/check_deriva.mjs', 'scripts/lib/audit-database.mjs']) {
    copyFileSync(join(real, arquivo), join(raiz, arquivo));
  }
  writeFileSync(join(raiz, 'app.js'), "sbFetch('rpc/consulta_shell');\n");
  writeFileSync(join(raiz, 'src/documentos/linha.mjs'), "sbFetch('rpc/consulta_documento');\n");
  writeFileSync(join(raiz, 'src/documentos/aninhado/localidade.js'),
    'sbFetch("rpc/consulta_aninhada"); sbFetch(`rpc/consulta_documento`);\n');
  writeFileSync(join(raiz, 'src/documentos/nota.md'), "'rpc/nao_e_javascript'\n");
  writeFileSync(join(raiz, 'CLAUDE.md'), 'Tabela tabela_demo_teste.\n');
  writeFileSync(join(raiz, 'docs/schema.md'), [
    '```mermaid', 'erDiagram', '  tabela_demo_teste {', '    varchar codlinha', '  }', '```',
    'consulta_shell consulta_documento consulta_aninhada',
  ].join('\n'));

  const shape = { tables: { tabela_demo_teste: ['codlinha'] }, rpcs };
  writeFileSync(join(raiz, 'bin/psql'),
    `#!${process.execPath}\nprocess.stdout.write(${JSON.stringify(JSON.stringify(shape))});\n`,
    { mode: 0o755 });
  const url = new URL('postgresql://db.gontnlfmothfglssbyyk.supabase.co/postgres?sslmode=require');
  url.username = 'divat_auditor_ci';
  url.password = 'senha-ficticia-do-teste';
  const resultado = spawnSync(process.execPath, ['scripts/check_deriva.mjs'], {
    cwd: raiz,
    env: { ...process.env, PATH: `${join(raiz, 'bin')}:${process.env.PATH}`,
      SUPABASE_TEST_AUDIT_DATABASE_URL: url.href },
    encoding: 'utf8', timeout: 10000,
  });
  assert.ifError(resultado.error);
  return { status: resultado.status, output: resultado.stdout + resultado.stderr };
}

const todas = ['consulta_shell', 'consulta_documento', 'consulta_aninhada'];

test('confere RPCs do shell, módulos mjs e js aninhados sem contar duplicatas ou Markdown', () => {
  const r = executar(todas);
  assert.equal(r.status, 0, r.output);
  assert.match(r.output, /3 RPCs em app\.js e src\//);
});

for (const [rpc, arquivo] of [
  ['consulta_shell', 'app.js'],
  ['consulta_documento', 'src/documentos/linha.mjs'],
  ['consulta_aninhada', 'src/documentos/aninhado/localidade.js'],
]) {
  test(`RPC ausente reprova e identifica o consumidor: ${rpc}`, () => {
    const r = executar(todas.filter(nome => nome !== rpc));
    assert.equal(r.status, 1, r.output);
    assert(r.output.includes(arquivo), r.output);
    assert(r.output.includes(`rpc/${rpc}`), r.output);
  });
}
