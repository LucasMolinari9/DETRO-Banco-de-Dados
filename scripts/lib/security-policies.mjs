// Complementa o diagnóstico existente com catálogo público, na mesma consulta/snapshot.
// O auditor já pode ler estes metadados; não recebe SELECT de dados nem grants novos.
export const SECURITY_SHAPE_SQL = `
select audit.divat_security_shape() || pg_catalog.jsonb_build_object(
  'auditor', (
    select pg_catalog.jsonb_build_object(
      'login', r.rolname, 'can_login', r.rolcanlogin,
      'valid_until', r.rolvaliduntil, 'checked_at', current_timestamp
    ) from pg_catalog.pg_roles r where r.rolname = 'divat_auditor_ci'
  ),
  'internal_functions', coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'schema', n.nspname,
      'signature', n.nspname || '.' || p.proname || '(' || pg_catalog.oidvectortypes(p.proargtypes) || ')',
      'security_definer', p.prosecdef,
      'anon_execute', pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE'),
      'authenticated_execute', pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
    ) order by n.nspname, p.proname, p.oid)
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('private', 'audit')
  ), '[]'::jsonb),
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

// Fora do baseline: perder a validade do login não é uma exceção de ACL aceitável.
export function validarValidadeAuditora(auditor) {
  if (!auditor || auditor.login !== 'divat_auditor_ci' || auditor.can_login !== true
      || typeof auditor.valid_until !== 'string' || typeof auditor.checked_at !== 'string') {
    throw new Error('Catálogo de validade do auditor ausente ou inválido.');
  }
  const fim = Date.parse(auditor.valid_until);
  const agora = Date.parse(auditor.checked_at);
  if (!Number.isFinite(fim) || !Number.isFinite(agora)) {
    throw new Error('Datas de validade do auditor inválidas; não assumir credencial sem expiração.');
  }
  const restante = fim - agora;
  if (restante <= 0) throw new Error('A validade de divat_auditor_ci expirou; renovar sem ampliar privilégios.');
  return { expiraEm: new Date(fim).toISOString(), diasRestantes: Math.ceil(restante / 86_400_000),
    avisar: restante <= 30 * 86_400_000 };
}

// Confere o estado efetivo, inclusive funções movidas/renomeadas ou alteradas pelo painel.
// Os diagnósticos DEFINER de audit permanecem privados; só o helper INVOKER é público.
export function validarFuncoesInternas(funcoes) {
  if (!Array.isArray(funcoes) || !funcoes.length) throw new Error('Catálogo de funções internas ausente ou vazio.');
  const vistas = new Set();
  for (const f of funcoes) {
    if (!f || !['private', 'audit'].includes(f.schema) || typeof f.signature !== 'string'
        || !f.signature.startsWith(f.schema + '.') || vistas.has(f.signature)
        || ['security_definer', 'anon_execute', 'authenticated_execute'].some(k => typeof f[k] !== 'boolean')) {
      throw new Error('Metadados de funções internas incompletos ou contraditórios.');
    }
    vistas.add(f.signature);
    if ((f.schema === 'private' && f.security_definer) || f.authenticated_execute
        || (f.anon_execute && f.signature !== 'private.f_unaccent(text)')) {
      throw new Error('Privilégios ou SECURITY DEFINER de função interna divergiram; revisar private/audit.');
    }
  }
  if (!vistas.has('private.f_unaccent(text)')) throw new Error('Helper privado da busca ausente do catálogo.');
}

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
