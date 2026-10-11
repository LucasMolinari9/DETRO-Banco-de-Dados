// Contrato offline de migrações (scripts/check_migrations.mjs) contra SQL adversarial.
//
// Por que existe: a revisão do Codex de 11/10/2026 (AUD-03) mostrou que o gate procurava
// PALAVRAS, não permissões. Uma migração que concedia INSERT/UPDATE/DELETE/TRUNCATE a anon com
// uma policy PERMISSIVE FOR ALL USING(true) passava verde, assim como um REVOKE de PUBLIC seguido
// de GRANT EXECUTE TO PUBLIC. Com banco único, migração aprovada aqui vai direto ao banco oficial
// — o gate vivo de grants só enxerga o estrago depois de aplicado.
//
// Cada caso roda o script REAL, copiado para um diretório temporário com uma única migração,
// porque o script lê `supabase/migrations/` relativo a si mesmo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(ROOT, 'scripts', 'check_migrations.mjs');

function rodar(sql) {
  const dir = mkdtempSync(join(tmpdir(), 'divat-migracoes-'));
  try {
    mkdirSync(join(dir, 'scripts'));
    mkdirSync(join(dir, 'supabase', 'migrations'), { recursive: true });
    copyFileSync(SCRIPT, join(dir, 'scripts', 'check_migrations.mjs'));
    writeFileSync(join(dir, 'supabase', 'migrations', '20990101000000_caso.sql'), sql);
    const r = spawnSync(process.execPath, [join(dir, 'scripts', 'check_migrations.mjs')], { encoding: 'utf8' });
    return { status: r.status, saida: r.stdout + r.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const recusa = (sql, motivo) => {
  const r = rodar(sql);
  assert.equal(r.status, 1, `deveria reprovar:\n${sql}\n--- saída ---\n${r.saida}`);
  assert.match(r.saida, motivo);
};
const aceita = sql => {
  const r = rodar(sql);
  assert.equal(r.status, 0, `deveria aprovar:\n${sql}\n--- saída ---\n${r.saida}`);
};

// Tabela pública nascida fechada do jeito que o CLAUDE.md pede.
const TABELA_FECHADA = `
create table public.caso (id integer primary key);
alter table public.caso enable row level security;
revoke all on table public.caso from anon, authenticated;
`;

test('as migrações reais do repositório continuam aprovadas', () => {
  const r = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('tabela pública fechada com leitura anônima explícita é aprovada', () => {
  aceita(`${TABELA_FECHADA}
grant select on table public.caso to anon;
create policy caso_leitura on public.caso for select to anon using (true);`);
});

test('bloqueio RESTRICTIVE de escrita (padrão do hardening) é aprovado', () => {
  aceita(`${TABELA_FECHADA}
create policy caso_bloqueio on public.caso as restrictive for all to anon, authenticated using (false) with check (false);`);
});

test('GRANT EXECUTE de RPC da allowlist para anon é aprovado', () => {
  aceita(`grant execute on function public.divat_busca_logradouro(text, integer) to anon;`);
});

// ---- AUD-03, exemplo 1 do Codex, aberto em duas peças ----
test('AUD-03: escrita concedida a anon é recusada', () => {
  recusa(`${TABELA_FECHADA}
grant insert, update, delete, truncate on table public.caso to anon;`, /escrita[^\n]*anon/i);
});

test('AUD-03: policy PERMISSIVE FOR ALL para anon é recusada', () => {
  recusa(`${TABELA_FECHADA}
create policy caso_escrita on public.caso for all to anon using (true) with check (true);`, /policy[^\n]*caso_escrita/i);
});

test('AUD-03: REVOKE só de SELECT não fecha a tabela nova', () => {
  recusa(`create table public.caso (id integer);
alter table public.caso enable row level security;
revoke select on all tables in schema public from anon, authenticated;`, /public\.caso[^\n]*REVOKE/i);
});

// ---- AUD-03, exemplo 2 do Codex ----
test('AUD-03: GRANT EXECUTE TO PUBLIC depois do REVOKE é recusado', () => {
  recusa(`create function public.caso() returns text language sql as $$ select 'x'::text $$;
revoke execute on function public.caso() from public;
grant execute on function public.caso() to public;`, /PUBLIC/);
});

// ---- furos achados ao reproduzir o AUD-03 ----
test('anon numa lista de grantees não escapa da allowlist', () => {
  recusa(`create function public.fora() returns int language sql as $$ select 1 $$;
revoke execute on function public.fora() from public;
grant execute on function public.fora() to anon, service_role;`, /public\.fora[^\n]*allowlist/);
});

test('GRANT EXECUTE ON ALL FUNCTIONS para anon é recusado', () => {
  recusa(`grant execute on all functions in schema public to anon;`, /ALL FUNCTIONS|todas as funções/i);
});

// ---- variações do mesmo defeito que a correção precisa cobrir ----
test('GRANT ALL em tabela para authenticated é recusado', () => {
  recusa(`${TABELA_FECHADA}
grant all on table public.caso to authenticated;`, /escrita[^\n]*authenticated/i);
});

test('escrita em massa e por default privileges é recusada', () => {
  recusa(`grant update on all tables in schema public to anon;`, /escrita/i);
  recusa(`alter default privileges in schema public grant insert on tables to authenticated;`, /escrita/i);
});

test('policy de escrita sem TO vale para PUBLIC e é recusada', () => {
  recusa(`${TABELA_FECHADA}
create policy caso_insere on public.caso for insert with check (true);`, /policy[^\n]*caso_insere/i);
});

test('policy sem FOR vale para ALL e é recusada', () => {
  recusa(`${TABELA_FECHADA}
create policy caso_tudo on public.caso to anon using (true);`, /policy[^\n]*caso_tudo/i);
});
