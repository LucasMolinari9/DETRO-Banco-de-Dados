-- Private snapshot of promotional sections absent from the current tariff table.
-- No fare, status, validity date or line association is promoted by this migration.
do $$ begin
  if (select count(*) from stage_access_20260928.source_record) <> 209004 then
    raise exception 'Access source is incomplete';
  end if;
  if (select count(*) from divat_integracao.tarifa_promocional_origem p
      where p.tarifa_promocional is not null and not exists
        (select 1 from public.tarifa_promocional_exibicao_teste e where e.codsecao=p.codsecao)) <> 390 then
    raise exception 'Promotional reconciliation population changed';
  end if;
end $$;

create table divat_integracao.tarifa_promocional_conciliacao_20260929 (
  codsecao text primary key,
  codlinha_prefixo text not null,
  secao_prefixo smallint not null,
  motivo text not null check(motivo in (
    'linha_sem_secao_tarifaria_atual',
    'secao_00_ausente_na_tabela_atual',
    'secao_nao_cadastrada_na_tabela_atual')),
  linhas_historicas text[] not null,
  qtd_registros_historicos integer not null check(qtd_registros_historicos > 0),
  qtd_versoes_historicas integer not null check(qtd_versoes_historicas > 0),
  qtd_valor_promocional_igual integer not null check(qtd_valor_promocional_igual >= 0),
  vinculo_historico_divergente boolean not null,
  conferido_documentalmente boolean not null default false,
  vigencia_confirmada boolean not null default false,
  publicada_na_projecao boolean not null default false,
  record_sha256 text not null,
  conferido_em timestamptz not null default now()
);
alter table divat_integracao.tarifa_promocional_conciliacao_20260929 enable row level security;
revoke all on divat_integracao.tarifa_promocional_conciliacao_20260929 from public,anon,authenticated;
create index tarifa_promocional_conciliacao_20260929_codlinha_idx
  on divat_integracao.tarifa_promocional_conciliacao_20260929(codlinha_prefixo);

with pendentes as (
  select p.* from divat_integracao.tarifa_promocional_origem p
  where p.tarifa_promocional is not null and not exists
    (select 1 from public.tarifa_promocional_exibicao_teste e where e.codsecao=p.codsecao)
), historico as (
  select p.codsecao,
    array_agg(distinct h.codlinha order by h.codlinha) as linhas_historicas,
    count(*)::integer as qtd_registros,
    count(distinct h.versao_origem)::integer as qtd_versoes,
    count(*) filter(where h.tarifa_promocional=p.tarifa_promocional)::integer as qtd_valor_igual,
    count(*) filter(where h.codlinha is distinct from left(p.codsecao,9)) > 0 as vinculo_divergente
  from pendentes p join divat_integracao.tarifa_versao_origem h using(codsecao)
  group by p.codsecao,p.tarifa_promocional
)
insert into divat_integracao.tarifa_promocional_conciliacao_20260929
  (codsecao,codlinha_prefixo,secao_prefixo,motivo,linhas_historicas,
   qtd_registros_historicos,qtd_versoes_historicas,qtd_valor_promocional_igual,
   vinculo_historico_divergente,record_sha256)
select p.codsecao,left(p.codsecao,9),right(p.codsecao,2)::smallint,
  case when not exists(select 1 from public.tarifa_atual_teste t where t.codlinha=left(p.codsecao,9))
    then 'linha_sem_secao_tarifaria_atual'
    when right(p.codsecao,2)='00' then 'secao_00_ausente_na_tabela_atual'
    else 'secao_nao_cadastrada_na_tabela_atual' end,
  h.linhas_historicas,h.qtd_registros,h.qtd_versoes,h.qtd_valor_igual,h.vinculo_divergente,p.record_sha256
from pendentes p join historico h using(codsecao);

do $$ begin
  if (select count(*) from divat_integracao.tarifa_promocional_conciliacao_20260929) <> 390
    or exists(select 1 from divat_integracao.tarifa_promocional_conciliacao_20260929
      where conferido_documentalmente or vigencia_confirmada or publicada_na_projecao) then
    raise exception 'Promotional reconciliation snapshot is incomplete or misclassified';
  end if;
end $$;

comment on table divat_integracao.tarifa_promocional_conciliacao_20260929 is
  'Snapshot privado de 29/09/2026. Prefixos nao confirmam vinculos; versoes historicas nao comprovam vigencia. Nenhum dado publico alterado.';
