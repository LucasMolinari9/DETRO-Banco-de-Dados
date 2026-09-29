begin;
insert into divat_integracao.qh_operacional_origem
select r.source_page,r.source_slot,(r.row_data->>'ID')::integer,
       r.row_data->>'CodLinha',r.row_data->>'Linha',r.row_data->>'CodEmpresa',
       (r.row_data->>'DataUltimaAlteração')::timestamp::date,r.row_data->>'Processo',
       (r.row_data->>'PicoManhaInicio')::timestamp::time,case when r.row_data->>'PicoManhaFim' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} ' then (r.row_data->>'PicoManhaFim')::timestamp::time end,
       (r.row_data->>'PicoTardeInicio')::timestamp::time,(r.row_data->>'PicoTardeFim')::timestamp::time,
       (r.row_data->>'TempoManhaIda')::smallint,(r.row_data->>'TempoManhaVolta')::smallint,
       (r.row_data->>'TempoTardeIda')::smallint,(r.row_data->>'TempoTardeVolta')::smallint,
       null,coalesce(m.texto,r.row_data->>'Obs'),r.record_sha256,r.row_data
from stage_access_20260928.source_record r
left join divat_integracao.memo_texto_origem m on m.source_table=r.source_table
  and m.source_page=r.source_page and m.source_slot=r.source_slot and m.coluna='Obs'
where r.source_table='Tabela Quadro de Horários'
on conflict do nothing;

insert into divat_integracao.itinerario_alteracao_origem
select r.source_page,r.source_slot,r.row_data->>'CodLinha',
       (r.row_data->>'DataUltimaAlteração')::timestamp::date,r.row_data->>'Processo',
       coalesce(m.texto,r.row_data->>'Obs'),false,r.record_sha256,r.row_data
from stage_access_20260928.source_record r
left join divat_integracao.memo_texto_origem m on m.source_table=r.source_table
  and m.source_page=r.source_page and m.source_slot=r.source_slot and m.coluna='Obs'
where r.source_table='Data de alteração de itinerários'
on conflict do nothing;

insert into divat_integracao.qh_fragmento_origem
select r.source_table,r.source_page,r.source_slot,(r.row_data->>'ID')::numeric,
       r.row_data->>'CodLinha',r.row_data->>'Linha',(r.row_data->>'Periodo')::smallint,
       r.row_data->>'DSemana',r.row_data->>'Origem',r.row_data->>'OrigemNome',
       (r.row_data->>'HorInicio')::timestamp::time,(r.row_data->>'HorFim')::timestamp::time,
       (r.row_data->>'Intervalo_min')::numeric,(r.row_data->>'Saida')::timestamp::time,
       r.record_sha256,r.row_data
from stage_access_20260928.source_record r
where r.source_table in('TabQuadHorario_2','TabQuadHorario_3')
on conflict do nothing;

insert into divat_integracao.referencia_auxiliar_origem
select r.source_table,r.source_page,r.source_slot,(r.row_data->>'Cod')::integer,
       coalesce(r.row_data->>'Característica',r.row_data->>'NomeLigCresc'),r.record_sha256,r.row_data
from stage_access_20260928.source_record r
where r.source_table in('Tab Característica','Nome Ligação Crescente')
on conflict do nothing;

insert into divat_integracao.evento_importacao_conciliacao
select (r.row_data->>'NúmeroDoEvento')::integer,r.source_page,r.source_slot,
       r.record_sha256,r.row_data,r.row_data->>'Descrição',
       coalesce(m.texto,r.row_data->>'Observação'),
       case when r.row_data->>'NúmeroDoEvento'='19953' then 'conflito_data_e_vinculo'
            else 'novo_cadastro_origem' end,
       false,
       case when r.row_data->>'NúmeroDoEvento'='19953'
            then 'Publicacao 2027 no Access e 1927 no teste; observacao menciona 204001002 mas codigo vinculado e 204001000. Nenhuma data ou linha inferida.'
            else 'Registro importado fielmente do Access; ato original ainda nao conferido. Nao altera situacao, tarifa nem itinerario da linha.' end
from stage_access_20260928.source_record r
left join divat_integracao.memo_texto_origem m on m.source_table=r.source_table
  and m.source_page=r.source_page and m.source_slot=r.source_slot and m.coluna='Observação'
where r.source_table='Eventos' and r.row_data->>'NúmeroDoEvento' in('19953','21639','21640','21641')
on conflict do nothing;

do $$ begin
 if (select count(*) from divat_integracao.qh_operacional_origem)<>1495
 or (select count(*) from divat_integracao.itinerario_alteracao_origem)<>1618
 or (select count(*) from divat_integracao.qh_fragmento_origem)<>35301
 or (select count(*) from divat_integracao.referencia_auxiliar_origem)<>2208
 or (select count(*) from divat_integracao.evento_importacao_conciliacao)<>4 then
 raise exception 'Complementary origin count mismatch'; end if;
end $$;
commit;
select jsonb_build_object(
'qh_operacional', (select count(*) from divat_integracao.qh_operacional_origem),
'itinerario_alteracoes',(select count(*) from divat_integracao.itinerario_alteracao_origem),
'fragmentos_qh',(select count(*) from divat_integracao.qh_fragmento_origem),
'auxiliares',(select count(*) from divat_integracao.referencia_auxiliar_origem),
'eventos_conciliacao',(select count(*) from divat_integracao.evento_importacao_conciliacao)
) as inseridos;
