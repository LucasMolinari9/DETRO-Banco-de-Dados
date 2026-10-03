-- Recuperada em 03/10/2026 de supabase_migrations.schema_migrations (aplicada em 30/09/2026
-- direto no banco, sem arquivo no repo). Corpo abaixo idêntico ao registrado no banco.
-- Preserve the existing anonymous, read-only catalog.
-- Internal data and backups remain inaccessible to client roles.
DO $security$
DECLARE
  t record;
  s text;
  op text;
  public_catalog text[] := ARRAY[
    'codempresa_teste','evento_empresa_teste','evento_linha_teste','evento_teste',
    'itinerario_teste','localidades_teste','municipio_teste','origem_teste',
    'portaria_teste','qh_intervalo_teste','qh_predeterminado_teste','qh_teste',
    'tabela_vista_teste','tarifa_atual_teste','tarifa_promocional_exibicao_teste'
  ];
  internal_schemas text[] := ARRAY[
    'codex_backup_20260924','bkp_divat_teste_20260928_1944',
    'codex_import_20260924','divat_integracao','divat_historico','stage_access_20260928'
  ];
BEGIN
  FOR t IN
    SELECT n.nspname AS schema_name, c.relname AS table_name
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r','p')
      AND (n.nspname = 'public' OR n.nspname = ANY(internal_schemas))
    ORDER BY n.nspname, c.relname
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', t.schema_name, t.table_name);
    IF t.schema_name = 'public' AND t.table_name = ANY(public_catalog) THEN
      -- RLS plus privileges prevent client writes, even if another permissive policy is added.
      EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE %I.%I FROM PUBLIC, anon, authenticated', t.schema_name, t.table_name);
      FOREACH op IN ARRAY ARRAY['INSERT','UPDATE','DELETE']
      LOOP
        IF NOT EXISTS (
          SELECT 1 FROM pg_catalog.pg_policies
          WHERE schemaname = t.schema_name AND tablename = t.table_name
            AND policyname = 'divat_block_client_' || lower(op)
        ) THEN
          IF op = 'INSERT' THEN
            EXECUTE format('CREATE POLICY %I ON %I.%I AS RESTRICTIVE FOR INSERT TO anon, authenticated WITH CHECK (false)',
              'divat_block_client_insert', t.schema_name, t.table_name);
          ELSIF op = 'UPDATE' THEN
            EXECUTE format('CREATE POLICY %I ON %I.%I AS RESTRICTIVE FOR UPDATE TO anon, authenticated USING (false) WITH CHECK (false)',
              'divat_block_client_update', t.schema_name, t.table_name);
          ELSE
            EXECUTE format('CREATE POLICY %I ON %I.%I AS RESTRICTIVE FOR DELETE TO anon, authenticated USING (false)',
              'divat_block_client_delete', t.schema_name, t.table_name);
          END IF;
        END IF;
      END LOOP;
    ELSE
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %I.%I FROM PUBLIC, anon, authenticated', t.schema_name, t.table_name);
      IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_policies
        WHERE schemaname = t.schema_name AND tablename = t.table_name
          AND policyname = 'divat_internal_no_client_access'
      ) THEN
        EXECUTE format('CREATE POLICY divat_internal_no_client_access ON %I.%I AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)',
          t.schema_name, t.table_name);
      END IF;
    END IF;
  END LOOP;
  FOREACH s IN ARRAY internal_schemas LOOP
    EXECUTE format('REVOKE ALL PRIVILEGES ON SCHEMA %I FROM PUBLIC, anon, authenticated', s);
    EXECUTE format('REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA %I FROM PUBLIC, anon, authenticated', s);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA %I REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated', s);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA %I REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated', s);
  END LOOP;
  REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon, authenticated;
END
$security$;
