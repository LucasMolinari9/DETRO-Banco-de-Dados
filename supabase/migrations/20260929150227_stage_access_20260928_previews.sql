
create view stage_access_20260928.vista_cadastro_previa
with (security_invoker = true) as
with origem as (
  select row_number() over (order by source_page, source_slot) + 1 as ordem_importacao,
         source_page, source_slot, record_sha256, row_data
  from stage_access_20260928.source_record
  where source_table = 'Vista'
)
select o.ordem_importacao, o.source_page, o.source_slot, o.record_sha256,
       (o.row_data->>'ID')::integer as id_access,
       o.row_data->>'CodLinha' as codlinha_access,
       o.row_data->>'Linha' as linha_access,
       v.codlinha as codlinha_atual,
       case when v.codlinha = '' and o.row_data->>'CodLinha' like 'C103%'
            then o.row_data->>'CodLinha' else v.codlinha end as codlinha_proposto,
       v.codempresa, v.numero_ligacao, v.nome_ligacao, v.tipo,
       v.cancelado, v.paralisado, v.transferido, v.sub_judice,
       o.row_data->>'Observação' as observacao_access,
       (v.id = (o.row_data->>'ID')::integer
        and v.codempresa = o.row_data->>'Cod Empresa'
        and v.cancelado = coalesce((o.row_data->>'Cancelado')::boolean,false)
        and v.paralisado = coalesce((o.row_data->>'Paralisado')::boolean,false)
        and v.transferido = coalesce((o.row_data->>'Transferida')::boolean,false)
        and v.sub_judice = coalesce((o.row_data->>'SubJudice')::boolean,false)) as identidade_e_status_conferidos
from origem o
join public.tabela_vista_teste v on v.ordem_importacao = o.ordem_importacao;

create view stage_access_20260928.tarifa_promocional_previa
with (security_invoker = true) as
select r.source_page, r.source_slot, r.record_sha256,
       r.row_data->>'CodSeção' as codsecao,
       left(r.row_data->>'CodSeção',9) as codlinha_candidata,
       (r.row_data->>'TarifaPromocional')::numeric(18,4) as tarifa_promocional,
       (r.row_data->>'Prazo')::integer as prazo_original,
       (r.row_data->>'DataInicial')::timestamp::date as data_inicial,
       r.row_data->>'Processo' as processo,
       (r.row_data->>'TarifaPromocional') is not null as possui_valor,
       exists (select 1 from public.tarifa_atual_teste t where t.codsecao = r.row_data->>'CodSeção') as secao_no_cadastro_atual,
       exists (select 1 from public.tabela_vista_teste v where v.codlinha = left(r.row_data->>'CodSeção',9)) as linha_no_cadastro_atual
from stage_access_20260928.source_record r
where r.source_table = 'Tarifa Promocional';

create view stage_access_20260928.observacoes_previa
with (security_invoker = true) as
with v as (
  select row_number() over (order by source_page, source_slot) + 1 as ordem_importacao,
         source_page, source_slot
  from stage_access_20260928.source_record
  where source_table = 'Vista'
), base as (
  select r.source_table, r.source_page, r.source_slot, r.record_sha256,
         case r.source_table
           when 'Vista' then r.row_data->>'CodLinha'
           when 'Tabela Quadro de Horários' then coalesce(r.row_data->>'CodLinha', r.row_data->>'Linha')
           when 'Data de alteração de itinerários' then r.row_data->>'CodLinha'
           when 'Local Ponto' then r.row_data->>'linha'
         end as codlinha,
         case r.source_table
           when 'Vista' then r.row_data->>'Cod Empresa'
           when 'Tabela Quadro de Horários' then r.row_data->>'CodEmpresa'
           when 'Local Ponto' then r.row_data->>'Cod Empresa'
         end as codempresa,
         case r.source_table
           when 'Vista' then r.row_data->>'ID'
           when 'Tabela Quadro de Horários' then r.row_data->>'ID'
           when 'Local Ponto' then r.row_data->>'ID'
         end as id_origem,
         case r.source_table
           when 'Vista' then r.row_data->>'Observação'
           when 'Tabela Quadro de Horários' then r.row_data->>'Obs'
           when 'Data de alteração de itinerários' then r.row_data->>'Obs'
           when 'Local Ponto' then r.row_data->>'Observação'
         end as texto_bruto
  from stage_access_20260928.source_record r
  where r.source_table in ('Vista','Tabela Quadro de Horários',
                           'Data de alteração de itinerários','Local Ponto')
)
select b.source_table, b.source_page, b.source_slot, b.record_sha256,
       b.codlinha, b.codempresa, b.id_origem,
       v.ordem_importacao,
       case when b.texto_bruto ~ '^[0-9a-f]{24}$' then null else b.texto_bruto end as observacao_texto,
       case when b.texto_bruto ~ '^[0-9a-f]{24}$' then b.texto_bruto end as memo_pointer
from base b
left join v on b.source_table = 'Vista'
           and b.source_page = v.source_page and b.source_slot = v.source_slot
where nullif(b.texto_bruto,'') is not null;

revoke all on stage_access_20260928.vista_cadastro_previa,
              stage_access_20260928.tarifa_promocional_previa,
              stage_access_20260928.observacoes_previa
from public, anon, authenticated;
