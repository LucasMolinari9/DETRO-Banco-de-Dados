// Complementa o diagnóstico existente com catálogo público, na mesma consulta/snapshot.
// O auditor já pode ler estes metadados; não recebe SELECT de dados nem grants novos.
export const SECURITY_SHAPE_SQL = `
select audit.divat_security_shape() || pg_catalog.jsonb_build_object(
  'policy_details', coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'tabela', c.relname, 'nome', p.polname, 'cmd', p.polcmd::text,
      'permissive', p.polpermissive,
      'qual', pg_catalog.pg_get_expr(p.polqual, p.polrelid),
      'with_check', pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid)
    ) order by c.relname, p.polname)
    from pg_catalog.pg_policy p
    join pg_catalog.pg_class c on c.oid = p.polrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
  ), '[]'::jsonb)
);`;

const chave = (tabela, nome) => JSON.stringify([tabela, nome]);
const textoOuNull = valor => valor === null || typeof valor === 'string';

// Cobertura tem de ser exata: catálogo ausente, incompleto ou contraditório nunca é sucesso.
export function indexarPolicies(forma) {
  if (!Array.isArray(forma.policy_details)) throw new Error('Catálogo de policies ausente.');
  const detalhes = new Map();
  for (const d of forma.policy_details) {
    if (!d || typeof d.tabela !== 'string' || typeof d.nome !== 'string'
        || !['r', 'a', 'w', 'd', '*'].includes(d.cmd) || typeof d.permissive !== 'boolean'
        || !textoOuNull(d.qual) || !textoOuNull(d.with_check)) {
      throw new Error('Metadados de policy incompletos ou inválidos.');
    }
    const k = chave(d.tabela, d.nome);
    if (detalhes.has(k)) throw new Error('Policy duplicada no catálogo.');
    detalhes.set(k, d);
  }
  const conferidos = new Set();
  for (const t of forma.tabelas) {
    if (!Array.isArray(t.policies)) throw new Error('Lista de policies ausente no diagnóstico.');
    for (const p of t.policies) {
      const k = chave(t.nome, p?.nome);
      const d = detalhes.get(k);
      if (!d || d.cmd !== p.cmd || conferidos.has(k)) {
        throw new Error('Diagnóstico e catálogo de policies divergem.');
      }
      conferidos.add(k);
    }
  }
  if (conferidos.size !== detalhes.size) throw new Error('Policy do catálogo ausente no diagnóstico.');
  return detalhes;
}

export function detalhePolicy(detalhes, tabela, nome) {
  return detalhes.get(chave(tabela, nome));
}

// Exceção estreita: RESTRICTIVE com FALSE literal, nunca pelo nome da policy.
// Condições parciais, permissivas ou desconhecidas continuam sendo achados.
export function bloqueiaEscrita(p) {
  if (!p || p.permissive !== false) return false;
  if (p.cmd === 'a') return p.qual === null && p.with_check === 'false';
  if (p.cmd === 'd') return p.qual === 'false' && p.with_check === null;
  if (p.cmd === 'w' || p.cmd === '*') return p.qual === 'false' && p.with_check === 'false';
  return false;
}
