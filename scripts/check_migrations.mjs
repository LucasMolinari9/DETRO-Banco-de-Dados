// Gate estrutural para migrações: novos objetos públicos precisam nascer fechados.
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'supabase', 'migrations');
const ALLOWED_ANON_EXECUTE = new Set([
  'public.divat_busca_logradouro',
  'public.divat_linhas_regiao',
  // Helper necessário à função INVOKER, mas invisível na Data API porque private não é exposto.
  'private.f_unaccent',
]);

// PUBLIC alcança anon e authenticated; os três recebem no máximo leitura. EXECUTE tem regra
// própria (allowlist) logo abaixo.
const PAPEIS_PUBLICOS = new Set(['anon', 'authenticated', 'public']);
const PRIVILEGIOS_LEITURA = new Set(['select', 'usage', 'execute']);

const failures = [];
const fail = (file, message) => failures.push(`${file}: ${message}`);
const compact = sql => sql.replace(/--.*$/gm, '').replace(/\s+/g, ' ').trim();

// O gate avalia o que cada GRANT/REVOKE/POLICY concede, não a presença de palavras: até a revisão
// AUD-03 (11/10/2026), `revoke select … ; grant insert … to anon` e uma policy PERMISSIVE FOR ALL
// USING(true) passavam verdes. O hardening monta SQL dinâmico com format('… TO anon', …), por
// isso a lista de papéis é cortada na primeira aspa ou parêntese.
const papeis = trecho => trecho
  .replace(/\s+(?:with\s+grant\s+option|granted\s+by)\b.*$/i, '')
  .split(/['()]/)[0]
  .split(',')
  .map(p => p.trim().replace(/^"|"$/g, '').toLowerCase())
  .filter(Boolean);
const privilegios = trecho => trecho
  .replace(/\([^)]*\)/g, '')
  .split(',')
  .map(p => p.trim().split(/\s+/)[0].toLowerCase())
  .filter(Boolean);
const publicos = lista => lista.filter(p => PAPEIS_PUBLICOS.has(p));
const comandos = (sql, re) => [...sql.matchAll(re)].map(m => m.slice(1));

let files;
try {
  files = (await readdir(DIR)).filter(name => name.endsWith('.sql')).sort();
} catch (error) {
  console.error(`Não foi possível ler ${DIR}: ${error.message}`);
  process.exit(1);
}

if (!files.length) {
  console.error('Nenhuma migração SQL encontrada; abortando em vez de passar sem cobertura.');
  process.exit(1);
}

for (const file of files) {
  const sql = compact(await readFile(join(DIR, file), 'utf8'));

  if (/\bcreate\s+role\b[\s\S]*?\bpassword\b/i.test(sql) || /\balter\s+role\b[\s\S]*?\bpassword\b/i.test(sql)) {
    fail(file, 'credenciais/senhas não podem ser versionadas em migrações');
  }

  const grants = comandos(sql, /\bgrant\s+([^;]+?)\s+on\s+([^;]+?)\s+to\s+([^;]+)/gi)
    .map(([privs, objeto, para]) => ({ privs: privilegios(privs), objeto: objeto.trim(), para: papeis(para) }));
  const revokes = comandos(sql, /\brevoke\s+([^;]+?)\s+on\s+([^;]+?)\s+from\s+([^;]+)/gi)
    .map(([privs, objeto, de]) => ({ privs: privilegios(privs), objeto: objeto.trim().toLowerCase(), de: papeis(de) }));

  const tables = [...sql.matchAll(/\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?public\.([a-z0-9_]+)/gi)]
    .map(match => match[1]);
  for (const table of tables) {
    const escaped = table.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rls = new RegExp(`alter table(?: if exists)? public\\.${escaped} enable row level security`, 'i');
    if (!rls.test(sql)) fail(file, `public.${table} é criada sem ENABLE ROW LEVEL SECURITY na mesma migração`);
    // REVOKE só de SELECT deixaria a escrita herdada de default privileges: precisa ser ALL.
    const fecha = revokes.some(({ privs, objeto, de }) =>
      privs[0] === 'all'
      && (objeto === 'all tables in schema public'
        || objeto.replace(/^table\s+/, '').split(/\s*,\s*/).includes(`public.${table.toLowerCase()}`))
      && de.includes('anon') && de.includes('authenticated'));
    if (!fecha) {
      fail(file, `public.${table} é criada sem REVOKE ALL explícito de anon/authenticated na mesma migração`);
    }
  }

  for (const { privs, para } of grants) {
    const alvo = publicos(para);
    const escrita = privs.filter(p => !PRIVILEGIOS_LEITURA.has(p));
    if (alvo.length && escrita.length) {
      fail(file, `GRANT de escrita (${escrita.join(', ')}) para ${alvo.join(', ')} — papéis públicos só recebem SELECT/USAGE/EXECUTE`);
    }
  }

  for (const [nome, resto] of comandos(sql, /\bcreate\s+policy\s+(\S+)\s+on\s+\S+([^;]*)/gi)) {
    // Só o cabeçalho (antes de USING/WITH CHECK) declara AS/FOR/TO; sem FOR vale ALL, sem TO vale PUBLIC.
    const cabecalho = resto.split(/\busing\b|\bwith\s+check\b/i)[0];
    if (/^\s*as\s+restrictive\b/i.test(cabecalho)) continue;
    const comando = (cabecalho.match(/\bfor\s+(all|select|insert|update|delete)\b/i)?.[1] || 'all').toLowerCase();
    const para = cabecalho.match(/\bto\s+(.+)$/i);
    const alvo = publicos(para ? papeis(para[1]) : ['public']);
    if (comando !== 'select' && alvo.length) {
      fail(file, `policy ${nome} é PERMISSIVE para ${comando.toUpperCase()} e alcança ${alvo.join(', ')} — escrita só com policy AS RESTRICTIVE`);
    }
  }

  const createsPublicFunction = /\bcreate\s+(?:or\s+replace\s+)?function\s+public\./i.test(sql);
  const closesFunctionDefaults = /revoke\s+execute\s+on\s+(?:all\s+functions\s+in\s+schema\s+public|function\s+[^;]+)\s+from\s+public/i.test(sql);
  if (createsPublicFunction && !closesFunctionDefaults) {
    fail(file, 'função public é criada sem REVOKE EXECUTE de PUBLIC na mesma migração');
  }

  for (const { privs, objeto, para } of grants) {
    if (!privs.includes('execute')) continue;
    if (para.includes('public')) {
      fail(file, `GRANT EXECUTE para PUBLIC em ${objeto} — PUBLIC inclui anon e authenticated`);
      continue;
    }
    if (!para.includes('anon')) continue;
    if (para.includes('authenticated')) fail(file, 'authenticated não pode acompanhar anon em GRANT EXECUTE');
    if (/^all\s+(?:functions|routines|procedures)\b/i.test(objeto)) {
      fail(file, 'GRANT EXECUTE ON ALL FUNCTIONS para anon — conceda função a função, pela allowlist');
      continue;
    }
    const targets = [...objeto.matchAll(/((?:public|audit|private)\.[a-z0-9_]+)\s*\(/gi)]
      .map(target => target[1].toLowerCase());
    if (!/^function\s/i.test(objeto) || !targets.length) {
      fail(file, 'GRANT EXECUTE TO anon não pôde ser interpretado de forma segura');
    }
    for (const target of targets) {
      if (!ALLOWED_ANON_EXECUTE.has(target)) fail(file, `${target} não está na allowlist anônima de execução`);
    }
  }
}

if (failures.length) {
  console.error('✗ Migrações violam o contrato de segurança:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(`✓ ${files.length} migração(ões): RLS/revokes e allowlist de RPC validados.`);
