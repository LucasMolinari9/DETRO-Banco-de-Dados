-- Campos do Access de 28/09 que não tinham coluna nas tabelas finais (pedido do dono, 21/10/2026).
-- Só acrescenta colunas anuláveis. Não altera PK, grants, RLS, policies nem a publicação Realtime.
-- As três tabelas públicas concedem SELECT a anon na tabela inteira, então as colunas novas ficam
-- legíveis pela Data API como as demais: são dados do mesmo cadastro público. O portal não as
-- seleciona (as listas de `src/data/campos.mjs` são explícitas), logo nenhuma tela muda.
-- O preenchimento sai de stage_access_20260928 em operação de dados separada.
SET LOCAL lock_timeout = '10s';

ALTER TABLE public.tabela_vista_teste
  ADD COLUMN hierarquia text,
  ADD COLUMN metropolitana boolean,
  ADD COLUMN observacao text;
COMMENT ON COLUMN public.tabela_vista_teste.hierarquia IS 'Access Vista.Hierarquização (MS, MTr, MTe, NMS, NMTr, NMTe). Difere de qh_teste.hierarquia em parte das linhas.';
COMMENT ON COLUMN public.tabela_vista_teste.metropolitana IS 'Access Vista.Metropolitana.';
COMMENT ON COLUMN public.tabela_vista_teste.observacao IS 'Access Vista.Observação (texto do cadastro de origem).';

ALTER TABLE public.evento_teste
  ADD COLUMN tipo_alteracao_linha text,
  ADD COLUMN tipo_parecer text,
  ADD COLUMN tipo_alteracao_empresa text;
COMMENT ON COLUMN public.evento_teste.tipo_alteracao_linha IS 'Access Eventos.TipoAlteracaoLinha (código; a tabela de significados não está no ACCDB).';
COMMENT ON COLUMN public.evento_teste.tipo_parecer IS 'Access Eventos.TipoParecer (código; a tabela de significados não está no ACCDB).';
COMMENT ON COLUMN public.evento_teste.tipo_alteracao_empresa IS 'Access Eventos.TipoAlteracaoEmpresa (texto livre).';

-- Staging de dados dos eventos: mesma informação, mesma coluna (docs/etl.md §3 e §4).
ALTER TABLE public.evento_dados
  ADD COLUMN tipo_alteracao_linha text,
  ADD COLUMN tipo_parecer text,
  ADD COLUMN tipo_alteracao_empresa text;

ALTER TABLE public.tarifa_atual_teste
  ADD COLUMN observacao text,
  ADD COLUMN piso_ii numeric;
COMMENT ON COLUMN public.tarifa_atual_teste.observacao IS 'Access Tarifa Atual.Obs (texto do cadastro de origem).';
COMMENT ON COLUMN public.tarifa_atual_teste.piso_ii IS 'Access Tarifa Atual.Piso II (quilometragem, como piso_i).';
