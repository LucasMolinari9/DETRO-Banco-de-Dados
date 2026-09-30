-- Portal sem Auth: fechar a exceção SELECT de authenticated sem alterar dados.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
LOCK TABLE public.tarifa_promocional_exibicao_teste IN ACCESS EXCLUSIVE MODE;

DO $hardening$
DECLARE
  rows_before bigint;
BEGIN
  SELECT count(*) INTO rows_before FROM public.tarifa_promocional_exibicao_teste;
  IF NOT has_table_privilege('anon', 'public.tarifa_promocional_exibicao_teste', 'SELECT') THEN
    RAISE EXCEPTION 'Leitura anonima esperada ausente; nenhuma permissao sera alterada';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class
          WHERE oid = 'public.tarifa_promocional_exibicao_teste'::regclass) THEN
    RAISE EXCEPTION 'RLS esperado ausente; nenhuma permissao sera alterada';
  END IF;

  REVOKE SELECT ON TABLE public.tarifa_promocional_exibicao_teste FROM authenticated;
  ALTER POLICY "Consulta publica das tarifas promocionais selecionadas"
    ON public.tarifa_promocional_exibicao_teste TO anon;

  IF has_table_privilege('authenticated', 'public.tarifa_promocional_exibicao_teste', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated ainda tem SELECT herdado; abortar sem ampliar o escopo';
  END IF;
  IF NOT has_table_privilege('anon', 'public.tarifa_promocional_exibicao_teste', 'SELECT') THEN
    RAISE EXCEPTION 'Leitura anonima foi alterada; abortar';
  END IF;
  IF (SELECT count(*) FROM public.tarifa_promocional_exibicao_teste) <> rows_before THEN
    RAISE EXCEPTION 'Contagem divergiu; abortar';
  END IF;
END
$hardening$;
COMMIT;
