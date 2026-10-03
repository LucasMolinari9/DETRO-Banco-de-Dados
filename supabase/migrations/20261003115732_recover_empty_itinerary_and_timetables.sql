-- Recuperação autorizada: três tabelas públicas já estavam vazias em 03/10/2026.
-- Usa o último snapshot público (28/09), sem promover alterações do Access bruto.
-- Não modifica outras tabelas, colunas, políticas, grants ou publicações.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $recovery$
DECLARE
  item record;
  source_count bigint;
  target_count bigint;
  next_row_id bigint;
BEGIN
  LOCK TABLE bkp_divat_teste_20260928_1944.itinerario_teste,
             bkp_divat_teste_20260928_1944.qh_intervalo_teste,
             bkp_divat_teste_20260928_1944.qh_predeterminado_teste IN SHARE MODE;
  LOCK TABLE public.itinerario_teste, public.qh_intervalo_teste,
             public.qh_predeterminado_teste IN SHARE ROW EXCLUSIVE MODE;

  FOR item IN SELECT * FROM (VALUES
    ('itinerario_teste', 52385::bigint),
    ('qh_intervalo_teste', 9553::bigint),
    ('qh_predeterminado_teste', 25748::bigint)
  ) AS expected(table_name, row_count)
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', item.table_name) INTO target_count;
    IF target_count <> 0 THEN
      RAISE EXCEPTION 'Recuperação abortada: public.% não está vazia', item.table_name;
    END IF;
    EXECUTE format('SELECT count(*) FROM bkp_divat_teste_20260928_1944.%I',
                   item.table_name) INTO source_count;
    IF source_count <> item.row_count THEN
      RAISE EXCEPTION 'Recuperação abortada: contagem da origem % mudou', item.table_name;
    END IF;
    EXECUTE format('SELECT count(*) - count(DISTINCT row_id) '
                   'FROM bkp_divat_teste_20260928_1944.%I', item.table_name)
      INTO source_count;
    IF source_count <> 0 THEN
      RAISE EXCEPTION 'Recuperação abortada: row_id ausente ou repetido em %', item.table_name;
    END IF;
  END LOOP;

  INSERT INTO public.itinerario_teste
    (id, codlinha, tipo_logradouro, nome_logradouro, cod_municipio_origem,
     sentido, codempresa, row_id)
  SELECT id, codlinha, tipo_logradouro, nome_logradouro, cod_municipio_origem,
         sentido, codempresa, row_id
  FROM bkp_divat_teste_20260928_1944.itinerario_teste;

  INSERT INTO public.qh_intervalo_teste
    (id, codlinha, dia_semana, cod_origem, nome_origem, hora_inicio,
     hora_fim, intervalo, row_id)
  SELECT id, codlinha, dia_semana, cod_origem, nome_origem, hora_inicio,
         hora_fim, intervalo, row_id
  FROM bkp_divat_teste_20260928_1944.qh_intervalo_teste;

  INSERT INTO public.qh_predeterminado_teste
    (id, codlinha, dia_semana, cod_origem, nome_origem, saida, row_id)
  SELECT id, codlinha, dia_semana, cod_origem, nome_origem, saida, row_id
  FROM bkp_divat_teste_20260928_1944.qh_predeterminado_teste;

  FOR item IN SELECT * FROM (VALUES
    ('itinerario_teste', 52385::bigint),
    ('qh_intervalo_teste', 9553::bigint),
    ('qh_predeterminado_teste', 25748::bigint)
  ) AS expected(table_name, row_count)
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', item.table_name) INTO target_count;
    IF target_count <> item.row_count THEN
      RAISE EXCEPTION 'Recuperação abortada: contagem final de % divergiu', item.table_name;
    END IF;
    -- EXCEPT ALL verifica também multiplicidades, não apenas totais ou IDs.
    EXECUTE format(
      'SELECT count(*) FROM ('
      '(SELECT to_jsonb(t) %s FROM public.%I t '
      'EXCEPT ALL SELECT to_jsonb(s) FROM bkp_divat_teste_20260928_1944.%I s) '
      'UNION ALL '
      '(SELECT to_jsonb(s) FROM bkp_divat_teste_20260928_1944.%I s '
      'EXCEPT ALL SELECT to_jsonb(t) %s FROM public.%I t)) difference',
      CASE WHEN item.table_name = 'itinerario_teste' THEN '- ''observacao'' - ''bairro''' ELSE '' END,
      item.table_name, item.table_name, item.table_name,
      CASE WHEN item.table_name = 'itinerario_teste' THEN '- ''observacao'' - ''bairro''' ELSE '' END,
      item.table_name) INTO source_count;
    IF source_count <> 0 THEN
      RAISE EXCEPTION 'Recuperação abortada: conteúdo final de % divergiu', item.table_name;
    END IF;

    EXECUTE format('SELECT max(row_id) + 1 FROM public.%I', item.table_name) INTO next_row_id;
    -- RESTART é transacional; setval não seria revertido por uma falha posterior.
    EXECUTE format('ALTER SEQUENCE %s RESTART WITH %s',
                   pg_get_serial_sequence(format('public.%I', item.table_name), 'row_id'),
                   next_row_id);
  END LOOP;
END
$recovery$;
