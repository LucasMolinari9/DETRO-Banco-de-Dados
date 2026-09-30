// Respostas locais para exercitar o CLI do smoke sem servidor ou acesso à rede.
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const scenario = process.env.DIVAT_SMOKE_SCENARIO || 'current';
const official = 'https://gontnlfmothfglssbyyk.supabase.co';
const retired = 'https://lwzsxuaqqeoamukduhev.supabase.co';
const jwt = (ref, role = 'anon') => `header.${Buffer.from(JSON.stringify({ ref, role })).toString('base64url')}.signature`;
let app = readFileSync(new URL('app.js', root), 'utf8');
let csp = JSON.parse(readFileSync(new URL('vercel.json', root), 'utf8')).headers[0].headers
  .find(header => header.key === 'Content-Security-Policy').value;

if (scenario === 'retired-config') {
  app = app.replace(/const SB_URL\s*=\s*'[^']*'/, `const SB_URL = '${retired}'`)
    .replace(/const SB_KEY\s*=\s*'[^']*'/, `const SB_KEY = '${jwt('lwzsxuaqqeoamukduhev')}'`);
}
if (scenario === 'missing-preview') app = app.replace(/const SB_TESTE_URL\s*=\s*'[^']*'/, "const SB_TESTE_URL = ''");
if (scenario === 'wrong-ref-key') app = app.replace(/const SB_TESTE_KEY\s*=\s*'[^']*'/, `const SB_TESTE_KEY = '${jwt('outro-projeto')}'`);
if (scenario === 'admin-key') app = app.replace(/const SB_KEY\s*=\s*'[^']*'/, `const SB_KEY = '${jwt('gontnlfmothfglssbyyk', 'service_role')}'`);
if (scenario === 'missing-csp') csp = csp.replace(official, '');
if (scenario === 'retired-csp') csp += `; connect-src ${retired}`;

const headers = Object.fromEntries(JSON.parse(readFileSync(new URL('vercel.json', root), 'utf8'))
  .headers[0].headers.map(header => [header.key, header.value]));
headers['Content-Security-Policy'] = csp;

globalThis.fetch = async input => {
  const pathname = new URL(input).pathname;
  if (pathname === '/') return new Response('<!doctype html><title>Portal DIVAT</title>', { headers });
  if (pathname === '/app.js') return new Response(app);
  if (pathname === '/src/data/rest.mjs') return new Response(scenario === 'missing-guard' ? '' : readFileSync(new URL('src/data/rest.mjs', root), 'utf8'));
  if (pathname === '/.mcp.json' && scenario === 'exposed-file') return new Response('{}');
  if (/^\/(?:CLAUDE\.md|CONTEXT\.md|\.git\/|\.mcp\.json|\.codex\/|\.github\/|docs\/|scripts\/|tests\/)/.test(pathname)) return new Response('', { status: 404 });
  return new Response('asset local');
};
