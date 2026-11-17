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

// ---- auditoria de segurança de 13/10/2026 (relatório run-1, §6.1 item 1) ----
// O gate olhava só GRANT ... ON, CREATE TABLE public.x, policy e EXECUTE. Cada caso abaixo
// passava com exit 0 (reproduzido numa cópia do repositório antes de corrigir) e abriria o banco
// único inteiro a quem tem a chave anon pública.
test('papel privilegiado concedido a anon/authenticated/PUBLIC é recusado', () => {
  recusa(`grant service_role to anon;`, /papel[^\n]*anon/i);
  recusa(`grant pg_write_all_data to authenticated;`, /papel[^\n]*authenticated/i);
  recusa(`grant postgres to public;`, /papel[^\n]*public/i);
});

test('anon como papel-membro de outro papel continua aprovado (padrão da Fase 3)', () => {
  aceita(`grant anon to divat_audit_owner;
grant divat_audit_owner, divat_auditor to postgres;`);
});

test('objeto transferido para dono público é recusado', () => {
  recusa(`alter table public.tabela_vista_teste owner to anon;`, /OWNER[^\n]*anon/i);
  recusa(`alter function public.divat_linhas_regiao(text) owner to authenticated;`, /OWNER[^\n]*authenticated/i);
});

test('desligar RLS é recusado em qualquer tabela', () => {
  recusa(`alter table public.tabela_vista_teste disable row level security;`, /DISABLE ROW LEVEL SECURITY/i);
  recusa(`alter table if exists divat_integracao.tarifa_versao_origem disable row level security;`, /DISABLE ROW LEVEL SECURITY/i);
});

test('apagar ou alterar as policies de bloqueio do hardening é recusado', () => {
  recusa(`drop policy divat_block_client_insert on public.tabela_vista_teste;`, /divat_block_client_insert/);
  recusa(`drop policy if exists divat_internal_no_client_access on divat_integracao.memo_texto_origem;`, /divat_internal_no_client_access/);
  recusa(`alter policy divat_block_client_update on public.qh_teste using (true);`, /divat_block_client_update/);
});

test('reparo de PERMISSIVE exige recriação imediata RESTRICTIVE/FALSE na mesma tabela privada', () => {
  for (const tabela of ['dias_semana_teste', 'itinerario_alteracao_teste', 'tarifa_historico_teste']) {
    for (const comando of ['insert', 'update', 'delete']) {
      const drop = `drop policy divat_block_client_${comando} on public.${tabela};`;
      const condicao = comando === 'insert' ? 'with check (false)' : comando === 'delete'
        ? 'using (false)' : 'using (false) with check (false)';
      const create = `create policy divat_block_client_${comando} on public.${tabela} as restrictive for ${comando} to anon, authenticated ${condicao};`;
      aceita(`${drop}\n${create}`);
      recusa(drop, /policy de bloqueio/);
      recusa(`${drop}\n${create.replace('as restrictive', 'as permissive')}`, /policy de bloqueio/);
      recusa(`${drop}\n${create.replaceAll('(false)', '(true)')}`, /policy de bloqueio/);
      recusa(`${drop}\n${create.replace(`on public.${tabela}`, 'on public.outra')}`, /policy de bloqueio/);
      recusa(`${drop}\nselect 1;\n${create}`, /policy de bloqueio/);
      recusa(`${drop}\n${create}`.replaceAll(tabela, 'tabela_vista_teste'), /policy de bloqueio/);
    }
  }
  recusa(`drop policy divat_block_client_update on public.dias_semana_teste;
create policy divat_block_client_update on public.dias_semana_teste as restrictive for update to anon, authenticated using (false);`, /policy de bloqueio/);
});

test('SECURITY DEFINER em função de public é recusado; em audit continua aprovado', () => {
  recusa(`alter function public.divat_linhas_regiao(text) security definer;`, /SECURITY DEFINER[^\n]*public/i);
  recusa(`create function public.caso() returns int language plpgsql security definer as $$ begin return 1; end $$;
revoke execute on function public.caso() from public;`, /SECURITY DEFINER[^\n]*public\.caso/i);
  recusa(`create or replace function public.caso() returns int language plpgsql as $f$ begin return 1; end $f$ security definer;
revoke execute on function public.caso() from public;`, /SECURITY DEFINER[^\n]*public\.caso/i);
  aceita(`alter function audit.divat_api_shape() security definer;`);
});

test('default privileges que concedem a papel público são recusados, mesmo só leitura', () => {
  recusa(`alter default privileges in schema public grant select on tables to anon;`, /DEFAULT PRIVILEGES[^\n]*anon/i);
  recusa(`alter default privileges for role postgres in schema private grant usage on sequences to authenticated;`, /DEFAULT PRIVILEGES[^\n]*authenticated/i);
  aceita(`alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;`);
});

test('tabela pública escrita com aspas ou UNLOGGED também precisa nascer fechada', () => {
  recusa(`create table "public"."caso" (id integer);`, /public\.caso[^\n]*ROW LEVEL/i);
  recusa(`create unlogged table public.caso (id integer);`, /public\.caso[^\n]*ROW LEVEL/i);
  recusa(`alter table public.caso owner to "anon";`, /OWNER[^\n]*anon/i);
  aceita(`create table "public"."caso" (id integer primary key);
alter table "public"."caso" enable row level security;
revoke all on table "public"."caso" from anon, authenticated;`);
});

test('tabela sem schema explícito e SET SCHEMA public são recusados', () => {
  recusa(`create table caso (id integer);`, /schema explícito/i);
  recusa(`alter table divat_integracao.memo_texto_origem set schema public;`, /SET SCHEMA public/i);
  aceita(`create temporary table caso_tmp (id integer);`);
});

test('view em public sem security_invoker é recusada (leria a staging com os direitos do dono)', () => {
  recusa(`create view public.caso as select * from divat_integracao.memo_texto_origem;
grant select on public.caso to anon;`, /VIEW public\.caso[^\n]*security_invoker/i);
  recusa(`create or replace view public.caso with (security_barrier) as select 1;`, /VIEW public\.caso[^\n]*security_invoker/i);
  aceita(`create view public.caso with (security_invoker = true) as select 1;`);
  aceita(`create view stage_access_20260928.caso as select 1;`);
});

test('GRANT ou policy com papel montado por format() é recusado (o gate não sabe quem recebe)', () => {
  recusa(`do $$ begin
  execute format('grant insert on table %I.%I to %I', 'public', 'caso', 'anon');
end $$;`, /dinâmico/i);
  recusa(`do $$ begin
  execute format('create policy caso_tudo on public.caso for all to %s using (true)', 'anon');
end $$;`, /dinâmico/i);
});

test('papel concedido ou dono montado por format() também é recusado', () => {
  recusa(`do $$ begin
  execute format('grant %I to %I', 'service_role', 'anon');
end $$;`, /dinâmico/i);
  recusa(`do $$ begin
  execute format('alter table public.caso owner to %I', 'anon');
end $$;`, /dinâmico/i);
});

test('materialized view em public é recusada (não tem RLS); security_invoker entre aspas vale', () => {
  recusa(`create materialized view public.caso as select * from divat_integracao.memo_texto_origem;`, /MATERIALIZED VIEW public\.caso/i);
  aceita(`create view public.caso with (security_invoker = 'true') as select 1;`);
});
