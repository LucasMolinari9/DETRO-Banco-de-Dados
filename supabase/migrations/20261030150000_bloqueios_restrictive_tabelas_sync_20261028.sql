-- Bloqueio de escrita das três tabelas do sync de 28/10/2026 no formato do hardening.
--
-- A migração 20261028194532_tarifa_historico_dias_semana_itinerario_alteracao, aplicada no banco
-- e não versionada neste repositório (ver docs/seguranca.md §9.7), criou divat_block_client_insert,
-- _update e _delete em tarifa_historico_teste, dias_semana_teste e itinerario_alteracao_teste
-- sem AS RESTRICTIVE. PERMISSIVE com false não concede nada, mas também não segura nada: a escrita
-- fica barrada só pela falta de GRANT. AS RESTRICTIVE, o formato de 20260930213009, barra mesmo
-- se uma policy permissiva ou um GRANT voltar, e é o que o check_grants.mjs exige.
-- Nenhum dado muda, e a leitura anônima das três tabelas fica como está.
--
-- A versão no nome deste arquivo é provisória: ao aplicar, renomeie-o para a versão que o banco
-- registrar em supabase_migrations.schema_migrations.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $antes$
BEGIN
  IF (SELECT count(*) FROM pg_catalog.pg_policies
      WHERE schemaname = 'public'
        AND tablename IN ('tarifa_historico_teste', 'dias_semana_teste', 'itinerario_alteracao_teste')
        AND policyname IN ('divat_block_client_insert', 'divat_block_client_update', 'divat_block_client_delete')
        AND permissive = 'PERMISSIVE') <> 9 THEN
    RAISE EXCEPTION 'Estado inesperado: as 9 policies PERMISSIVE de 28/10 nao estao todas presentes; nada foi alterado';
  END IF;
END
$antes$;

DROP POLICY divat_block_client_insert ON public.tarifa_historico_teste;
CREATE POLICY divat_block_client_insert ON public.tarifa_historico_teste AS RESTRICTIVE FOR INSERT TO anon, authenticated WITH CHECK (false);
DROP POLICY divat_block_client_update ON public.tarifa_historico_teste;
CREATE POLICY divat_block_client_update ON public.tarifa_historico_teste AS RESTRICTIVE FOR UPDATE TO anon, authenticated USING (false) WITH CHECK (false);
DROP POLICY divat_block_client_delete ON public.tarifa_historico_teste;
CREATE POLICY divat_block_client_delete ON public.tarifa_historico_teste AS RESTRICTIVE FOR DELETE TO anon, authenticated USING (false);

DROP POLICY divat_block_client_insert ON public.dias_semana_teste;
CREATE POLICY divat_block_client_insert ON public.dias_semana_teste AS RESTRICTIVE FOR INSERT TO anon, authenticated WITH CHECK (false);
DROP POLICY divat_block_client_update ON public.dias_semana_teste;
CREATE POLICY divat_block_client_update ON public.dias_semana_teste AS RESTRICTIVE FOR UPDATE TO anon, authenticated USING (false) WITH CHECK (false);
DROP POLICY divat_block_client_delete ON public.dias_semana_teste;
CREATE POLICY divat_block_client_delete ON public.dias_semana_teste AS RESTRICTIVE FOR DELETE TO anon, authenticated USING (false);

DROP POLICY divat_block_client_insert ON public.itinerario_alteracao_teste;
CREATE POLICY divat_block_client_insert ON public.itinerario_alteracao_teste AS RESTRICTIVE FOR INSERT TO anon, authenticated WITH CHECK (false);
DROP POLICY divat_block_client_update ON public.itinerario_alteracao_teste;
CREATE POLICY divat_block_client_update ON public.itinerario_alteracao_teste AS RESTRICTIVE FOR UPDATE TO anon, authenticated USING (false) WITH CHECK (false);
DROP POLICY divat_block_client_delete ON public.itinerario_alteracao_teste;
CREATE POLICY divat_block_client_delete ON public.itinerario_alteracao_teste AS RESTRICTIVE FOR DELETE TO anon, authenticated USING (false);

DO $depois$
DECLARE
  t text;
BEGIN
  IF (SELECT count(*) FROM pg_catalog.pg_policies
      WHERE schemaname = 'public'
        AND tablename IN ('tarifa_historico_teste', 'dias_semana_teste', 'itinerario_alteracao_teste')
        AND policyname IN ('divat_block_client_insert', 'divat_block_client_update', 'divat_block_client_delete')
        AND permissive = 'RESTRICTIVE'
        AND ((cmd = 'INSERT' AND qual IS NULL AND with_check = 'false')
          OR (cmd = 'UPDATE' AND qual = 'false' AND with_check = 'false')
          OR (cmd = 'DELETE' AND qual = 'false' AND with_check IS NULL))) <> 9 THEN
    RAISE EXCEPTION 'As 9 policies RESTRICTIVE nao ficaram no formato esperado; abortar';
  END IF;
  FOREACH t IN ARRAY ARRAY['public.tarifa_historico_teste', 'public.dias_semana_teste', 'public.itinerario_alteracao_teste']
  LOOP
    IF NOT has_table_privilege('anon', t, 'SELECT') THEN
      RAISE EXCEPTION 'A leitura anonima de % mudou; abortar', t;
    END IF;
    IF has_table_privilege('anon', t, 'INSERT, UPDATE, DELETE, TRUNCATE')
       OR has_table_privilege('authenticated', t, 'INSERT, UPDATE, DELETE, TRUNCATE') THEN
      RAISE EXCEPTION 'Papel publico com escrita em %; abortar', t;
    END IF;
  END LOOP;
END
$depois$;

COMMIT;
