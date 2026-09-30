// Executa as RPCs diagnósticas pelo login PostgreSQL mínimo da Fase 3.
// A URL nunca é passada na linha de comando nem impressa.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { carregarConfiguracaoAuditora, auditarJson, AuditDatabaseError } from './lib/audit-database.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const query = String.raw`
with payload as (
  select
    audit.divat_api_shape() as api,
    audit.divat_security_shape() as security,
    (select coalesce(jsonb_agg(t order by t), '[]'::jsonb) from audit.realtime_tables() t) as realtime,
    (select count(*) from audit.divat_data_quality()) as data_quality_rows
)
select jsonb_build_object(
  'api_rpcs', api->'rpcs',
  'public_objects', jsonb_array_length(security->'tabelas'),
  'all_rls', not exists (
    select 1 from jsonb_array_elements(security->'tabelas') t where not (t->>'rls')::boolean
  ),
  'anon_rpcs', coalesce((
    select jsonb_agg(f->>'assinatura' order by f->>'assinatura')
    from jsonb_array_elements(security->'funcoes') f where (f->>'anon_execute')::boolean
  ), '[]'::jsonb),
  'authenticated_exec_count', (
    select count(*) from jsonb_array_elements(security->'funcoes') f
    where (f->>'authenticated_execute')::boolean
  ),
  'realtime_tables', realtime,
  'data_quality_rows', data_quality_rows,
  'direct_table_select', has_table_privilege(current_user, 'public.tabela_vista_teste', 'select'),
  'session_user', session_user
)
from payload;
`;

export function validarShapeAuditor(shape, expectedRealtime) {
  const actualRealtime = Array.isArray(shape.realtime_tables) ? [...shape.realtime_tables].sort() : [];
  const expectedRpcs = ['divat_busca_logradouro', 'divat_linhas_regiao'];
  const expectedSignatures = ['divat_busca_logradouro(text,integer)', 'divat_linhas_regiao(text,text)'];
  const checks = [
    [JSON.stringify([...(shape.api_rpcs || [])].sort()) === JSON.stringify(expectedRpcs), 'API expõe RPCs além da allowlist'],
    [JSON.stringify(shape.anon_rpcs) === JSON.stringify(expectedSignatures), 'grants anônimos de função divergiram'],
    [shape.authenticated_exec_count === 0, 'authenticated voltou a executar função pública'],
    [shape.public_objects >= 19 && shape.all_rls === true, 'objeto público sem RLS ou catálogo incompleto'],
    [JSON.stringify(actualRealtime) === JSON.stringify([...expectedRealtime].sort()), 'publicação Realtime divergiu de RT_TABLES'],
    [shape.direct_table_select === false, 'credencial auditora ganhou leitura direta de tabela'],
    [typeof shape.data_quality_rows === 'number', 'RPC de qualidade não pôde ser executada'],
    [shape.session_user === 'divat_auditor_ci', 'checagem não executou com o login auditor dedicado'],
  ];

  return checks.filter(([ok]) => !ok).map(([, message]) => message);
}

function main() {
  try {
    const app = readFileSync(join(ROOT, 'app.js'), 'utf8');
    const block = /const RT_TABLES\s*=\s*\[([\s\S]*?)\]/.exec(app)?.[1];
    const expectedRealtime = [...(block || '').matchAll(/'([^']+)'/g)].map(m => m[1]);
    if (!expectedRealtime.length || new Set(expectedRealtime).size !== expectedRealtime.length) {
      throw new Error('RT_TABLES ausente ou duplicado; não assumir publicação vazia.');
    }
    const config = carregarConfiguracaoAuditora();
    const shape = auditarJson(config, query);
    const failed = validarShapeAuditor(shape, expectedRealtime);
    if (failed.length) {
      console.error('✗ Auditoria PostgreSQL da Fase 3 falhou:');
      for (const message of failed) console.error('  - ' + message);
      return 1;
    }
    console.log('✓ Auditor mínimo: ' + shape.public_objects + ' objetos públicos, ' + expectedRealtime.length + ' tabelas Realtime, RPCs anônimas na allowlist.');
    return 0;
  } catch (error) {
    console.error(error instanceof AuditDatabaseError ? error.message : 'Auditoria interrompida: catálogo ou configuração inválidos.');
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
