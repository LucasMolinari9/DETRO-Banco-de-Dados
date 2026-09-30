import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validarShapeAuditor } from '../scripts/check_phase3_audit.mjs';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const block = /const RT_TABLES\s*=\s*\[([\s\S]*?)\]/.exec(app)[1];
const realtime = [...block.matchAll(/'([^']+)'/g)].map(m => m[1]);
const shape = {
  api_rpcs: ['divat_busca_logradouro', 'divat_linhas_regiao'],
  anon_rpcs: ['divat_busca_logradouro(text,integer)', 'divat_linhas_regiao(text,text)'],
  authenticated_exec_count: 0, public_objects: 19, all_rls: true,
  realtime_tables: [...realtime].reverse(), data_quality_rows: 1,
  direct_table_select: false, session_user: 'divat_auditor_ci',
};

test('auditor aceita a lista atual nominal de Realtime, independente da ordem', () => {
  assert.deepEqual(validarShapeAuditor(shape, realtime), []);
});

test('mesma quantidade com tabela trocada não satisfaz a auditoria', () => {
  const altered = { ...shape, realtime_tables: [...realtime.slice(1), 'unexpected_private_table'] };
  assert(validarShapeAuditor(altered, realtime).includes('publicação Realtime divergiu de RT_TABLES'));
});

test('auditor com leitura direta ou login parecido é recusado', () => {
  assert(validarShapeAuditor({ ...shape, direct_table_select: true }, realtime).length);
  assert(validarShapeAuditor({ ...shape, session_user: 'divat_auditor_ci_extra' }, realtime).length);
});
