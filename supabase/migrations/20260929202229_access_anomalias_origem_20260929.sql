create table divat_integracao.campo_invalido_origem (
 source_table text not null,source_page integer not null,source_slot integer not null,
 coluna text not null,valor_original text not null,record_sha256 text not null,motivo text not null,
 primary key(source_table,source_page,source_slot,coluna)
);
alter table divat_integracao.campo_invalido_origem enable row level security;
revoke all on divat_integracao.campo_invalido_origem from public,anon,authenticated;
insert into divat_integracao.campo_invalido_origem
select source_table,source_page,source_slot,'PicoManhaFim',row_data->>'PicoManhaFim',record_sha256,
       'Valor de origem nao interpretavel como data/hora. Valor bruto preservado; campo tipado nulo.'
from stage_access_20260928.source_record
where source_table='Tabela Quadro de Horários'
and row_data->>'PicoManhaFim' is not null
and row_data->>'PicoManhaFim' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} ';
