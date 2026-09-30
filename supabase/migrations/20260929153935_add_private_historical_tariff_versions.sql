create table divat_integracao.tarifa_versao_origem (
  id bigint generated always as identity primary key,
  versao_origem text not null,
  codsecao text not null,
  codlinha text not null,
  codempresa text,
  tarifa numeric(14,4),
  tarifa_promocional numeric(14,4),
  source_page integer not null,
  source_slot integer not null,
  record_sha256 text not null check (record_sha256 ~ '^[0-9a-f]{64}$'),
  row_data_original jsonb not null,
  capturado_em timestamptz not null default now(),
  unique (versao_origem,source_page,source_slot)
);
create index tarifa_versao_origem_codsecao_idx on divat_integracao.tarifa_versao_origem (codsecao);
create index tarifa_versao_origem_codlinha_idx on divat_integracao.tarifa_versao_origem (codlinha);
alter table divat_integracao.tarifa_versao_origem enable row level security;
