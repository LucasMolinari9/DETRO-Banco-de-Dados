create schema divat_integracao;
revoke all on schema divat_integracao from public, anon, authenticated;
create table divat_integracao.tarifa_promocional_origem (
  id bigint generated always as identity primary key,
  codsecao text not null,
  tarifa_promocional numeric(14,4),
  prazo_origem integer,
  data_inicial date,
  processo_origem text,
  fonte_esquema text not null,
  fonte_tabela text not null,
  source_page integer not null,
  source_slot integer not null,
  record_sha256 text not null check (record_sha256 ~ '^[0-9a-f]{64}$'),
  row_data_original jsonb not null,
  capturado_em timestamptz not null default now(),
  unique (fonte_esquema,fonte_tabela,source_page,source_slot)
);
create index tarifa_promocional_origem_codsecao_idx on divat_integracao.tarifa_promocional_origem (codsecao);
alter table divat_integracao.tarifa_promocional_origem enable row level security;
