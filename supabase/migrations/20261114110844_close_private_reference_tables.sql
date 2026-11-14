-- Privadas por decisão do dono: não têm consumidores no portal, RPCs/views,
-- FKs externas, sequências owned nem participação no Realtime (14/11/2026).
-- Pré-requisito operacional: backup integral recuperável conforme docs/backup.md.
-- Não altera registros, PKs, owners, service_role ou as 15 tabelas de produto.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $preconditions$
declare
  tabela text;
  colunas text;
begin
  foreach tabela in array array['dias_semana_teste', 'itinerario_alteracao_teste', 'tarifa_historico_teste'] loop
    if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = tabela and c.relkind = 'r' and c.relrowsecurity) then
      raise exception 'Tabela alvo ausente ou sem RLS: %', tabela;
    end if;
    if exists (select 1 from pg_publication_tables where schemaname = 'public' and tablename = tabela) then
      raise exception 'Publicação inesperada; revisar dependências antes de fechar %', tabela;
    end if;
    -- REVOKE de tabela não elimina grants concedidos diretamente às colunas.
    select string_agg(format('%I', a.attname), ', ' order by a.attnum) into colunas
    from pg_attribute a where a.attrelid = format('public.%I', tabela)::regclass
      and a.attnum > 0 and not a.attisdropped;
    execute format('revoke all (%s) on table public.%I from public, anon, authenticated', colunas, tabela);
  end loop;
end
$preconditions$;

revoke all on table public.dias_semana_teste, public.itinerario_alteracao_teste,
  public.tarifa_historico_teste from public, anon, authenticated;

drop policy anon_read_dias_semana_teste on public.dias_semana_teste;
drop policy anon_read_itinerario_alteracao_teste on public.itinerario_alteracao_teste;
drop policy anon_read_tarifa_historico_teste on public.tarifa_historico_teste;

drop policy divat_block_client_insert on public.dias_semana_teste;
create policy divat_block_client_insert on public.dias_semana_teste as restrictive for insert to anon, authenticated with check (false);
drop policy divat_block_client_update on public.dias_semana_teste;
create policy divat_block_client_update on public.dias_semana_teste as restrictive for update to anon, authenticated using (false) with check (false);
drop policy divat_block_client_delete on public.dias_semana_teste;
create policy divat_block_client_delete on public.dias_semana_teste as restrictive for delete to anon, authenticated using (false);

drop policy divat_block_client_insert on public.itinerario_alteracao_teste;
create policy divat_block_client_insert on public.itinerario_alteracao_teste as restrictive for insert to anon, authenticated with check (false);
drop policy divat_block_client_update on public.itinerario_alteracao_teste;
create policy divat_block_client_update on public.itinerario_alteracao_teste as restrictive for update to anon, authenticated using (false) with check (false);
drop policy divat_block_client_delete on public.itinerario_alteracao_teste;
create policy divat_block_client_delete on public.itinerario_alteracao_teste as restrictive for delete to anon, authenticated using (false);

drop policy divat_block_client_insert on public.tarifa_historico_teste;
create policy divat_block_client_insert on public.tarifa_historico_teste as restrictive for insert to anon, authenticated with check (false);
drop policy divat_block_client_update on public.tarifa_historico_teste;
create policy divat_block_client_update on public.tarifa_historico_teste as restrictive for update to anon, authenticated using (false) with check (false);
drop policy divat_block_client_delete on public.tarifa_historico_teste;
create policy divat_block_client_delete on public.tarifa_historico_teste as restrictive for delete to anon, authenticated using (false);

commit;
