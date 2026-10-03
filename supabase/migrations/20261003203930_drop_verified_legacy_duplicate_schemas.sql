-- Limpeza autorizada pelo dono sem novo backup externo.
-- Remove exclusivamente os três schemas antigos após a recuperação pública conferida.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $cleanup$
DECLARE
  item record;
  blocked_objects text;
  job_count bigint;
  schema_names constant text[] := ARRAY[
    'codex_backup_20260924',
    'bkp_divat_teste_20260928_1944',
    'codex_import_20260924'
  ];
  reference_pattern constant text :=
    '\m(codex_backup_20260924|bkp_divat_teste_20260928_1944|codex_import_20260924)\M';
BEGIN
  IF (SELECT count(*) FROM pg_namespace WHERE nspname = ANY(schema_names)) <> 3 THEN
    RAISE EXCEPTION 'Limpeza abortada: os três schemas esperados não estão presentes';
  END IF;
  IF (SELECT count(*) FROM public.itinerario_teste) <> 52385
     OR (SELECT count(*) FROM public.qh_intervalo_teste) <> 9553
     OR (SELECT count(*) FROM public.qh_predeterminado_teste) <> 25748 THEN
    RAISE EXCEPTION 'Limpeza abortada: contagens da recuperação pública mudaram';
  END IF;

  -- Estabiliza as relações antes de verificar views/regras/FKs e suas dependências.
  FOR item IN
    SELECT n.nspname, c.relname FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = ANY(schema_names) AND c.relkind IN ('r', 'p')
    ORDER BY c.oid
  LOOP
    EXECUTE format('LOCK TABLE %I.%I IN ACCESS EXCLUSIVE MODE', item.nspname, item.relname);
  END LOOP;

  -- Segue dependências transitivas, incluindo referências a colunas.
  -- Policies, regras, triggers e TOAST são classificados pelo schema da tabela dona.
  with recursive targets as (
select oid,nspname from pg_namespace where nspname in ('codex_backup_20260924','bkp_divat_teste_20260928_1944','codex_import_20260924')
), objects(classid,objid,objsubid) as (
select 'pg_namespace'::regclass::oid,oid,0 from targets
union
select d.classid,d.objid,d.objsubid from pg_depend d join objects o
on d.refclassid=o.classid and d.refobjid=o.objid and (o.objsubid=0 or d.refobjsubid=o.objsubid)
), located as (
select o.*,i.type,i.identity,
case
when o.classid='pg_policy'::regclass then (select n.nspname from pg_policy x join pg_class c on c.oid=x.polrelid join pg_namespace n on n.oid=c.relnamespace where x.oid=o.objid)
when o.classid='pg_constraint'::regclass then (select n.nspname from pg_constraint x join pg_namespace n on n.oid=x.connamespace where x.oid=o.objid)
when o.classid='pg_rewrite'::regclass then (select n.nspname from pg_rewrite x join pg_class c on c.oid=x.ev_class join pg_namespace n on n.oid=c.relnamespace where x.oid=o.objid)
when o.classid='pg_trigger'::regclass then (select n.nspname from pg_trigger x join pg_class c on c.oid=x.tgrelid join pg_namespace n on n.oid=c.relnamespace where x.oid=o.objid)
when o.classid='pg_attrdef'::regclass then (select n.nspname from pg_attrdef x join pg_class c on c.oid=x.adrelid join pg_namespace n on n.oid=c.relnamespace where x.oid=o.objid)
when o.classid='pg_default_acl'::regclass then (select n.nspname from pg_default_acl x join pg_namespace n on n.oid=x.defaclnamespace where x.oid=o.objid)
when o.classid='pg_class'::regclass and i.schema='pg_toast' then (select n.nspname from pg_class toast left join pg_index ix on ix.indexrelid=toast.oid join pg_class owner on owner.reltoastrelid=coalesce(ix.indrelid,toast.oid) join pg_namespace n on n.oid=owner.relnamespace where toast.oid=o.objid)
else i.schema end as object_schema
from objects o cross join lateral pg_identify_object(o.classid,o.objid,o.objsubid) i
), outside as (
select distinct type,identity,object_schema from located
where not(classid='pg_namespace'::regclass and objid in(select oid from targets))
and (object_schema is null or object_schema not in(select nspname from targets))
)

  SELECT string_agg(type || ': ' || identity, '; ' ORDER BY identity)
  INTO blocked_objects FROM outside;
  IF blocked_objects IS NOT NULL THEN
    RAISE EXCEPTION 'Limpeza abortada: dependências externas: %', blocked_objects;
  END IF;

  -- Corpos textuais/dynamic SQL e search_path nem sempre estão em pg_depend.
  SELECT string_agg(n.nspname || '.' || p.proname, ', ' ORDER BY n.nspname, p.proname)
  INTO blocked_objects
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE NOT (n.nspname = ANY(schema_names))
    AND (p.prosrc ~* reference_pattern
         OR array_to_string(p.proconfig, ' ') ~* reference_pattern);
  IF blocked_objects IS NOT NULL THEN
    RAISE EXCEPTION 'Limpeza abortada: referência em função/configuração: %', blocked_objects;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint f
             JOIN pg_class child ON child.oid = f.conrelid
             JOIN pg_namespace child_ns ON child_ns.oid = child.relnamespace
             JOIN pg_class parent ON parent.oid = f.confrelid
             JOIN pg_namespace parent_ns ON parent_ns.oid = parent.relnamespace
             WHERE f.contype = 'f' AND parent_ns.nspname = ANY(schema_names)
               AND NOT (child_ns.nspname = ANY(schema_names))) THEN
    RAISE EXCEPTION 'Limpeza abortada: FK externa aponta para schema antigo';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_publication_tables WHERE schemaname = ANY(schema_names)) THEN
    RAISE EXCEPTION 'Limpeza abortada: schema antigo participa de publicação';
  END IF;
  IF to_regclass('cron.job') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM cron.job WHERE command ~* $1'
    INTO job_count USING reference_pattern;
    IF job_count <> 0 THEN
      RAISE EXCEPTION 'Limpeza abortada: job cron referencia schema antigo';
    END IF;
  END IF;

  DROP SCHEMA codex_backup_20260924 CASCADE;
  DROP SCHEMA bkp_divat_teste_20260928_1944 CASCADE;
  DROP SCHEMA codex_import_20260924 CASCADE;
END
$cleanup$;
