create schema divat_historico;
revoke all on schema divat_historico from public, anon, authenticated;
create table divat_historico.linha_estado_cadastral (
  id bigint generated always as identity primary key,
  linha_id integer not null,
  codlinha text not null,
  codempresa text not null,
  cancelado boolean,
  paralisado boolean,
  transferido boolean,
  suspenso boolean,
  observacao_original text,
  tipo_registro text not null default 'estado_cadastral' check (tipo_registro = 'estado_cadastral'),
  fonte_esquema text not null,
  fonte_tabela text not null,
  source_page integer not null,
  source_slot integer not null,
  record_sha256 text not null check (record_sha256 ~ '^[0-9a-f]{64}$'),
  data_efetiva date,
  processo_comprovado text,
  capturado_em timestamptz not null default now(),
  unique (fonte_esquema, fonte_tabela, source_page, source_slot)
);
create index linha_estado_cadastral_codlinha_idx on divat_historico.linha_estado_cadastral (codlinha);
alter table divat_historico.linha_estado_cadastral enable row level security;
