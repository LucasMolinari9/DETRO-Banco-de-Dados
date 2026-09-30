create table divat_integracao.qh_observacao_conciliacao (
  qh_id integer primary key,
  codlinha text not null,
  observacao_access text,
  observacao_teste text,
  source_page integer not null,
  source_slot integer not null,
  record_sha256 text not null check (record_sha256 ~ '^[0-9a-f]{64}$'),
  tratamento_proposto text not null check (tratamento_proposto in ('conferir_documento_antes_de_preencher','preservar_texto_teste')),
  conferido_documentalmente boolean not null default false,
  capturado_em timestamptz not null default now()
);
alter table divat_integracao.qh_observacao_conciliacao enable row level security;
