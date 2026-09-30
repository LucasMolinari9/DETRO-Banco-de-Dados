CREATE SCHEMA codex_import_20260924;
REVOKE ALL ON SCHEMA codex_import_20260924 FROM PUBLIC, anon, authenticated, service_role;
CREATE TABLE codex_import_20260924.tabela_vista_teste (LIKE public.tabela_vista_teste INCLUDING ALL);
CREATE TABLE codex_import_20260924.codempresa_teste (LIKE public.codempresa_teste INCLUDING ALL);
CREATE TABLE codex_import_20260924.tarifa_atual_teste (LIKE public.tarifa_atual_teste INCLUDING ALL);
CREATE TABLE codex_import_20260924.qh_teste (LIKE public.qh_teste INCLUDING ALL);
CREATE TABLE codex_import_20260924.qh_intervalo_teste (LIKE public.qh_intervalo_teste INCLUDING ALL);
CREATE TABLE codex_import_20260924.qh_predeterminado_teste (LIKE public.qh_predeterminado_teste INCLUDING ALL);
CREATE TABLE codex_import_20260924.itinerario_teste (LIKE public.itinerario_teste INCLUDING ALL);
CREATE TABLE codex_import_20260924.evento_teste (LIKE public.evento_teste INCLUDING ALL);
CREATE TABLE codex_import_20260924.evento_dados (LIKE public.evento_dados INCLUDING ALL);
CREATE TABLE codex_import_20260924.evento_textos (LIKE public.evento_textos INCLUDING ALL);
CREATE TABLE codex_import_20260924.evento_linha_teste (LIKE public.evento_linha_teste INCLUDING ALL);
CREATE TABLE codex_import_20260924.evento_empresa_teste (LIKE public.evento_empresa_teste INCLUDING ALL);
CREATE TABLE codex_import_20260924.localidades_teste (LIKE public.localidades_teste INCLUDING ALL);
CREATE TABLE codex_import_20260924.municipio_teste (LIKE public.municipio_teste INCLUDING ALL);
CREATE TABLE codex_import_20260924.origem_teste (LIKE public.origem_teste INCLUDING ALL);
CREATE TABLE codex_import_20260924.eventos_access_complemento (
  id integer PRIMARY KEY,
  linha_original text,
  codlinha_original text,
  tipo_alteracao_linha text,
  tipo_alteracao_empresa text,
  tipo_parecer text,
  data_reg_original timestamp without time zone,
  data_public_original timestamp without time zone,
  observacao_1 text,
  publicacao_do text,
  publicacao_do_2 text
);
CREATE TABLE codex_import_20260924.alteracao_itinerario_access (
  codlinha text PRIMARY KEY,
  data_ultima_alteracao timestamp without time zone,
  processo text,
  obs text
);
ALTER TABLE codex_import_20260924.tabela_vista_teste ENABLE ROW LEVEL SECURITY;
ALTER TABLE codex_import_20260924.codempresa_teste ENABLE ROW LEVEL SECURITY;
ALTER TABLE codex_import_20260924.tarifa_atual_teste ENABLE ROW LEVEL SECURITY;
ALTER TABLE codex_import_20260924.qh_teste ENABLE ROW LEVEL SECURITY;
ALTER TABLE codex_import_20260924.qh_intervalo_teste ENABLE ROW LEVEL SECURITY;
ALTER TABLE codex_import_20260924.qh_predeterminado_teste ENABLE ROW LEVEL SECURITY;
ALTER TABLE codex_import_20260924.itinerario_teste ENABLE ROW LEVEL SECURITY;
ALTER TABLE codex_import_20260924.evento_teste ENABLE ROW LEVEL SECURITY;
ALTER TABLE codex_import_20260924.evento_dados ENABLE ROW LEVEL SECURITY;
ALTER TABLE codex_import_20260924.evento_textos ENABLE ROW LEVEL SECURITY;
ALTER TABLE codex_import_20260924.evento_linha_teste ENABLE ROW LEVEL SECURITY;
ALTER TABLE codex_import_20260924.evento_empresa_teste ENABLE ROW LEVEL SECURITY;
ALTER TABLE codex_import_20260924.localidades_teste ENABLE ROW LEVEL SECURITY;
ALTER TABLE codex_import_20260924.municipio_teste ENABLE ROW LEVEL SECURITY;
ALTER TABLE codex_import_20260924.origem_teste ENABLE ROW LEVEL SECURITY;
ALTER TABLE codex_import_20260924.eventos_access_complemento ENABLE ROW LEVEL SECURITY;
ALTER TABLE codex_import_20260924.alteracao_itinerario_access ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA codex_import_20260924 FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA codex_import_20260924 FROM PUBLIC, anon, authenticated, service_role;
