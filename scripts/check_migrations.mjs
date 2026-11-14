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
// Aspas em identificador simples saem: `"public"."caso"` é a mesma tabela que public.caso, e sem
// isso nenhuma regra abaixo a reconhecia.
const compact = sql => sql.replace(/--.*$/gm, '').replace(/"([a-z0-9_]+)"/gi, '$1').replace(/\s+/g, ' ').trim();

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
// `to %I` dentro de format(): o papel só existe na execução, e o gate não pode afirmar que não é anon.
const dinamico = lista => lista.some(p => p.includes('%'));
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

  // Sem schema, a tabela cai no primeiro do search_path — public — e escapa da regra abaixo.
  // TEMP não casa aqui: mora em pg_temp e some no fim da sessão.
  for (const [nome] of comandos(sql, /\bcreate\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?([a-z0-9_]+)(?![a-z0-9_.])/gi)) {
    fail(file, `CREATE TABLE ${nome} sem schema explícito — escreva o schema (public.${nome}, divat_integracao.${nome}, …)`);
  }
  if (/\bset\s+schema\s+public\b/i.test(sql)) {
    fail(file, 'SET SCHEMA public — objeto entra em public sem passar pelo contrato de criação');
  }

  // View comum roda com os direitos do DONO: um SELECT para anon nela atravessa o RLS e o REVOKE
  // da tabela de baixo. Em public, só security_invoker.
  for (const [view, opcoes] of comandos(sql, /\bcreate\s+(?:or\s+replace\s+)?(?:recursive\s+)?view\s+(public\.[a-z0-9_]+)([^;]*?)\bas\b/gi)) {
    if (!/\bsecurity_invoker\s*(?:=\s*'?(?:true|on|1)\b|[,)])/i.test(opcoes)) {
      fail(file, `VIEW ${view.toLowerCase()} sem security_invoker — view de public não pode ler com os direitos do dono`);
    }
  }
  // Materialized view não aceita RLS nem security_invoker: em public, um SELECT expõe a cópia inteira.
  for (const [view] of comandos(sql, /\bcreate\s+materialized\s+view\s+(?:if\s+not\s+exists\s+)?(public\.[a-z0-9_]+)/gi)) {
    fail(file, `MATERIALIZED VIEW ${view.toLowerCase()} — não tem RLS; em public, use tabela com RLS ou view security_invoker`);
  }

  const tables = [...sql.matchAll(/\bcreate\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?public\.([a-z0-9_]+)/gi)]
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

  // GRANT sem ON é de PAPEL: `grant service_role to anon` dá ao visitante tudo o que o papel
  // pode. O sentido inverso (`grant anon to divat_audit_owner`, Fase 3) não amplia nada público.
  for (const [concedidos, para] of comandos(sql, /\bgrant\s+([^;]+?)\s+to\s+([^;]+)/gi)) {
    if (/\son\s/i.test(` ${concedidos} `)) continue;
    if (dinamico(papeis(para))) fail(file, `GRANT de papel com papel dinâmico — em format(), escreva o papel literal`);
    const alvo = publicos(papeis(para));
    if (alvo.length) fail(file, `GRANT de papel (${concedidos.trim()}) para ${alvo.join(', ')} — papel público não herda outro papel`);
  }

  // Dono não passa por GRANT nem por RLS (sem FORCE): é escrita total por outro caminho.
  for (const [dono] of comandos(sql, /\bowner\s+to\s+([a-z_%]+)/gi)) {
    if (dono.includes('%')) fail(file, 'OWNER TO com papel dinâmico — em format(), escreva o papel literal');
    else if (PAPEIS_PUBLICOS.has(dono.toLowerCase())) fail(file, `OWNER TO ${dono} — papel público não pode ser dono de objeto`);
  }

  // As 19 tabelas de public têm RLS, e as stagings ficam fechadas por ele; nenhuma migração desliga.
  if (/\bdisable\s+row\s+level\s+security\b/i.test(sql)) {
    fail(file, 'DISABLE ROW LEVEL SECURITY — RLS não se desliga por migração');
  }

  // As RESTRICTIVE de 20260930213009 seguram a escrita mesmo se um GRANT voltar; sem elas, sobra
  // só o GRANT. Os nomes são os que aquela migração cria.
  // Reparo das três tabelas privadas: o painel criou estes nomes como PERMISSIVE.
  // Só admite DROP imediatamente seguido da recriação literal RESTRICTIVE/FALSE do
  // mesmo comando, nome e tabela. ALTER, remoção isolada e tabelas de produto seguem proibidos.
  const reparoPrivado = /\bdrop policy (divat_block_client_(insert|update|delete)) on public\.(dias_semana_teste|itinerario_alteracao_teste|tarifa_historico_teste); create policy \1 on public\.\3 as restrictive for \2 to anon, authenticated (using \(false\)(?: with check \(false\))?|with check \(false\));/gi;
  const semReparos = sql.replace(reparoPrivado, (trecho, nome, comando) => {
    const condicao = comando.toLowerCase() === 'insert' ? 'with check (false)'
      : comando.toLowerCase() === 'delete' ? 'using (false)' : 'using (false) with check (false)';
    return trecho.toLowerCase().endsWith(`${condicao};`) ? '' : trecho;
  });
  for (const [acao, nome] of comandos(semReparos, /\b(drop|alter)\s+policy\s+(?:if\s+exists\s+)?(divat_block_client_[a-z0-9_]+|divat_internal_no_client_access)\b/gi)) {
    fail(file, `${acao.toUpperCase()} POLICY ${nome} — policy de bloqueio do hardening não se remove nem se altera`);
  }

  // public é exposto pela Data API: função DEFINER ali roda com o dono para quem a chamar. As de
  // produto são INVOKER; diagnóstico DEFINER mora em audit. O corpo $tag$…$tag$ sai antes, porque
  // tem `;` próprio e o SECURITY DEFINER pode vir depois dele.
  const semCorpos = sql.replace(/\$([a-z_]*)\$[\s\S]*?\$\1\$/gi, '$$$$');
  for (const [funcao] of comandos(semCorpos, /\b(?:create\s+(?:or\s+replace\s+)?|alter\s+)(?:function|procedure)\s+(public\.[a-z0-9_]+)[^;]*?\bsecurity\s+definer\b/gi)) {
    fail(file, `SECURITY DEFINER em ${funcao.toLowerCase()} — função de public é INVOKER (DEFINER só em audit)`);
  }

  // Default privileges valem para o objeto que AINDA vai nascer: até um SELECT abriria a próxima
  // staging a anon sem que migração nenhuma a mencionasse. Para papel público, só REVOKE.
  for (const [para] of comandos(sql, /\balter\s+default\s+privileges\b[^;]*?\bgrant\b[^;]*?\bto\s+([^;]+)/gi)) {
    const alvo = publicos(papeis(para));
    if (alvo.length) fail(file, `ALTER DEFAULT PRIVILEGES … GRANT para ${alvo.join(', ')} — objetos futuros nascem fechados`);
  }

  for (const { privs, para } of grants) {
    if (dinamico(para)) fail(file, `GRANT com papel dinâmico (${para.join(', ')}) — em format(), escreva o papel literal`);
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
    if (para && dinamico(papeis(para[1]))) {
      fail(file, `policy ${nome} com papel dinâmico — em format(), escreva o papel literal`);
      continue;
    }
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
