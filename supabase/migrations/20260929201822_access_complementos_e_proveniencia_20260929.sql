-- Additive integration for divat - TESTE. Source rows remain immutable.
do $$ begin
  if (select count(*) from stage_access_20260928.source_record) <> 209004
     or (select count(*) from stage_access_20260928.source_table) <> 43 then
    raise exception 'Access source is incomplete';
  end if;
end $$;

create table divat_integracao.atualizacao_auditoria_20260929 (
  tabela text not null,
  chave text not null,
  antes jsonb,
  depois jsonb,
  motivo text not null,
  aplicado_em timestamptz,
  primary key (tabela, chave)
);
alter table divat_integracao.atualizacao_auditoria_20260929 enable row level security;
revoke all on divat_integracao.atualizacao_auditoria_20260929 from public, anon, authenticated;

insert into divat_integracao.atualizacao_auditoria_20260929(tabela,chave,antes,motivo)
select 'qh_teste',id::text,to_jsonb(q),'Completar observacao vazia com texto exato do Access'
from public.qh_teste q where id in(256,571);
insert into divat_integracao.atualizacao_auditoria_20260929(tabela,chave,antes,motivo)
select 'evento_teste',id::text,to_jsonb(e),'Sinalizar conflito de data sem inferir data ou vinculo'
from public.evento_teste e where id=19953;

alter table public.evento_teste
  add column fonte_registro text,
  add column conferido_documentalmente boolean,
  add column data_publicacao_suspeita boolean;
alter table public.qh_teste
  add column observacao_fonte text,
  add column observacao_conferida_documentalmente boolean;

create table divat_integracao.memo_texto_origem (
  source_table text not null,
  source_page integer not null,
  source_slot integer not null,
  coluna text not null,
  ponteiro text not null,
  texto text not null,
  record_sha256 text not null,
  bytes_sha256 text not null,
  tamanho_bytes integer not null,
  primary key(source_table,source_page,source_slot,coluna),
  foreign key(source_table,source_page,source_slot)
    references stage_access_20260928.source_record(source_table,source_page,source_slot)
);
alter table divat_integracao.memo_texto_origem enable row level security;
revoke all on divat_integracao.memo_texto_origem from public,anon,authenticated;

create table divat_integracao.qh_operacional_origem (
  source_page integer not null, source_slot integer not null,
  qh_id integer not null, codlinha text, linha_origem text, codempresa text,
  ultima_alteracao date, processo_origem text,
  pico_manha_inicio time, pico_manha_fim time,
  pico_tarde_inicio time, pico_tarde_fim time,
  tempo_manha_ida_origem smallint, tempo_manha_volta_origem smallint,
  tempo_tarde_ida_origem smallint, tempo_tarde_volta_origem smallint,
  unidade_tempo_confirmada text,
  observacao_origem text,
  record_sha256 text not null, row_data_original jsonb not null,
  primary key(source_page,source_slot)
);
create index qh_operacional_origem_codlinha_idx on divat_integracao.qh_operacional_origem(codlinha);
alter table divat_integracao.qh_operacional_origem enable row level security;
revoke all on divat_integracao.qh_operacional_origem from public,anon,authenticated;

create table divat_integracao.itinerario_alteracao_origem (
  source_page integer not null, source_slot integer not null,
  codlinha text, ultima_alteracao_registrada date,
  processo_origem text, observacao_origem text,
  conferido_documentalmente boolean not null default false,
  record_sha256 text not null, row_data_original jsonb not null,
  primary key(source_page,source_slot)
);
create index itinerario_alteracao_origem_codlinha_idx on divat_integracao.itinerario_alteracao_origem(codlinha);
alter table divat_integracao.itinerario_alteracao_origem enable row level security;
revoke all on divat_integracao.itinerario_alteracao_origem from public,anon,authenticated;

create table divat_integracao.qh_fragmento_origem (
  source_table text not null check(source_table in('TabQuadHorario_2','TabQuadHorario_3')),
  source_page integer not null, source_slot integer not null,
  id_access numeric, codlinha text, linha_origem text, periodo_origem smallint,
  dia_semana text, cod_origem text, nome_origem text,
  hora_inicio time, hora_fim time, intervalo_origem numeric, saida time,
  record_sha256 text not null, row_data_original jsonb not null,
  primary key(source_table,source_page,source_slot)
);
create index qh_fragmento_origem_codlinha_idx on divat_integracao.qh_fragmento_origem(codlinha);
alter table divat_integracao.qh_fragmento_origem enable row level security;
revoke all on divat_integracao.qh_fragmento_origem from public,anon,authenticated;

create table divat_integracao.referencia_auxiliar_origem (
  source_table text not null check(source_table in('Tab Característica','Nome Ligação Crescente')),
  source_page integer not null, source_slot integer not null,
  codigo_origem integer, descricao text,
  record_sha256 text not null, row_data_original jsonb not null,
  primary key(source_table,source_page,source_slot)
);
alter table divat_integracao.referencia_auxiliar_origem enable row level security;
revoke all on divat_integracao.referencia_auxiliar_origem from public,anon,authenticated;

create table divat_integracao.evento_importacao_conciliacao (
  evento_id integer primary key,
  source_page integer not null, source_slot integer not null,
  record_sha256 text not null, row_data_original jsonb not null,
  descricao_recuperada text, observacao_recuperada text,
  situacao text not null,
  conferido_documentalmente boolean not null default false,
  observacao_conferencia text not null
);
alter table divat_integracao.evento_importacao_conciliacao enable row level security;
revoke all on divat_integracao.evento_importacao_conciliacao from public,anon,authenticated;

notify pgrst,'reload schema';
