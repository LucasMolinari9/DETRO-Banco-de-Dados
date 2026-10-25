// LOOKUPS — os caches de referência que quase todo card lê por baixo: municípios (IBGE),
// origens/terminais do quadro de horários, terminais físicos do itinerário, o cadastro de
// empresas (nome ↔ RJ) e os dicionários de tipo de evento.
//
// O que este módulo esconde é o CACHE: quem chama pede `getEmpresas()` quantas vezes quiser e
// não sabe se foi à rede ou não. O que ele NÃO esconde é a invalidação — `INVALIDADORES_LOOKUP`
// é público de propósito, porque quem sabe QUANDO invalidar é o Realtime (app.js), e quem sabe
// O QUE invalidar é este módulo. Um cache que só ele soubesse limpar envelheceria em silêncio.
//
// O acesso à rede vem diretamente da fronteira única `src/data/rest.mjs`; este módulo esconde
// apenas os caches e não mantém um segundo slot de configuração.

import { dedupEmpresasPorRJ } from '../domain/agrupamento.mjs';
import { sbFetch } from './rest.mjs';

const buscar = (tabela, qs) => sbFetch(tabela, qs);

let ibgeMap   = null;    // { [codibge]: {nome,regiao,regiaoPrograma} }
let origemMap = null;    // { [cod_origem]: nome_origem }
let terminalRows = null; // itinerario_teste com tipo_logradouro='Terminal': [{nome_logradouro,codlinha,cod_municipio_origem}]
// caches carregados e invalidados JUNTOS → cada grupo num objeto só (ver INVALIDADORES_LOOKUP)
const evLookups = { emp:null, lin:null };  // lookups de evento: emp={[id]:evento_empresa}, lin={[id]:evento_linha}
const empresas  = { map:null, list:null, byCod:null }; // cadastro: map nome↔RJ, byCod registro deduplicado, list crua p/ busca
// ÉPOCA de cada cache: a invalidação a incrementa, e uma carga que começou ANTES dela entrega o
// resultado a quem a pediu mas não grava no cache. Sem isso, a carga velha que respondesse depois
// da nova repunha o dado antigo até a próxima invalidação (DIVAT-05, auditoria de 25/10/2026 —
// tests/ui-data-module.test.mjs). As chaves `emp`/`lin` são as do `evLookups`, porque o
// `preencherLookup` as recebe como `chave`.
const epoca = { ibge:0, origem:0, terminais:0, empresas:0, emp:0, lin:0 };

export async function getIbge() {
  if (ibgeMap) return ibgeMap;
  const e = epoca.ibge;
  const rows = await buscar('municipio_teste', 'select=cod_ibge,nome_municipio,regiao_municipio,regiao_novo&limit=2000');
  const m = {};
  // `regiao` = regionalização nova (usada na coluna "Região" dos outros cards);
  // `regiaoPrograma` = Região Programa clássica (regiao_municipio) — é a do print DETRO.
  rows.forEach(r => { m[r.cod_ibge] = { nome:r.nome_municipio, regiao:r.regiao_novo||r.regiao_municipio, regiaoPrograma:r.regiao_municipio }; });
  if (e === epoca.ibge) ibgeMap = m;
  return m;
}

export async function getOrigem() {
  if (origemMap) return origemMap;
  const e = epoca.origem;
  const rows = await buscar('origem_teste', 'select=cod_origem,nome_origem&limit=2000');
  const m = {}; rows.forEach(r => { m[r.cod_origem] = r.nome_origem; });
  if (e === epoca.origem) origemMap = m;
  return m;
}

// terminais físicos (ex.: "Rodoviário Menezes Côrtes") — trechos de itinerário do tipo "Terminal",
// conceito distinto de origem_teste (que é o ponto de origem do quadro de horários, quase sempre
// nome de município). Ver Ligações por Terminais.
export async function getTerminais() {
  if (terminalRows) return terminalRows;
  const e = epoca.terminais;
  const rows = await buscar('itinerario_teste', `tipo_logradouro=eq.Terminal&select=nome_logradouro,codlinha,cod_municipio_origem&limit=30000`);
  if (e === epoca.terminais) terminalRows = rows;
  return rows;
}

// O desempate do cadastro de empresas duplicadas (scoreEmpresa/dedupEmpresasPorRJ) vive em
// src/domain/agrupamento.mjs — definição única do getEmpresas e do LOADERS.empresasRegulares.
export async function getEmpresas() {
  if (empresas.map) return empresas.map;
  const e = epoca.empresas;
  const rows = await buscar('codempresa_teste', 'select=codempresa,nome_empresa,situacao,cassada,sob_intervencao&limit=2000');
  const map = {}, byCod = {};
  dedupEmpresasPorRJ(rows).forEach(r => {
    map[r.codempresa] = r.nome_empresa;
    byCod[r.codempresa] = r;
  });
  if (e === epoca.empresas) Object.assign(empresas, { list:rows, map, byCod });
  return map;
}

// nome da empresa (síncrono; cai no próprio código se o cache ainda não carregou)
export const empNome = cod => (empresas.map && empresas.map[cod]) ? empresas.map[cod] : (cod ?? '—');

/* Os três acessos abaixo existem porque o app.js precisa de mais do que "o nome desta empresa",
   e cada um tem um leitor concreto — nenhum é acessador especulativo:
   - `empresasMap()`  → o banner pergunta se o cadastro já chegou (`if (!empresasMap())`), e as
     Ligações por Empresa varrem nome→código para buscar por nome;
   - `empresasList()` → as Empresas Regulares re-agregam a lista CRUA (com duplicatas por RJ) e
     a busca de empresa do modal filtra sobre ela;
   - `empresaPorCod()` → a Frota por Empresa quer o registro deduplicado inteiro (situação,
     cassada), não só o nome.
   Devolvem `null`/`[]`/`undefined` quando o cache ainda não carregou, exatamente como a leitura
   direta do objeto fazia antes. */
export const empresasMap  = () => empresas.map;
export const empresasList = () => empresas.list || [];
export const empresaPorCod = cod => empresas.byCod ? empresas.byCod[cod] : undefined;

/* Preenche um cache de lookup {id → coluna}, gravando SÓ quando o fetch deu certo.
   A forma anterior (`.catch(()=>[])` seguido de `evLookups.emp={}` incondicional) tinha
   um bug silencioso: objeto vazio é TRUTHY, então o guard `if(!evLookups.emp)` nunca mais
   disparava — uma falha transitória de rede deixava os lookups vazios pela sessão INTEIRA,
   e o Histórico passava a mostrar ids crus no lugar dos nomes de evento, sem erro na tela.
   Os outros caches (getEmpresas/getIbge/getOrigem) não têm o problema porque NÃO engolem o
   erro: a exceção sobe e o cache continua null, então a próxima chamada refaz.
   Aqui o erro continua engolido de propósito — o Histórico deve renderizar mesmo sem os
   nomes de evento, caindo no '—' —, mas engolir não pode virar cachear. */
export async function preencherLookup(cache, chave, buscarRows, coluna){
  if (cache[chave]) return cache[chave];
  const e = epoca[chave];
  const rows = await buscarRows().catch(() => null);   // null = falhou; [] = veio vazio de verdade
  if (!rows) return null;                              // não cacheia falha
  const m = {};
  rows.forEach(x => { m[x.id] = x[coluna]; });
  if (e === epoca[chave]) cache[chave] = m;            // invalidado no meio: não grava (ver `epoca`)
  return m;
}

export async function getEvLookups() {
  await Promise.all([
    preencherLookup(evLookups, 'emp', () => buscar('evento_empresa_teste','select=id,evento_empresa'), 'evento_empresa'),
    preencherLookup(evLookups, 'lin', () => buscar('evento_linha_teste','select=id,evento_linha'), 'evento_linha'),
  ]);
  return evLookups;
}

/* tabela do Realtime → como invalidar o cache derivado dela. Declarativo em vez de cadeia de
   if: deixa o conjunto de caches invalidáveis visível num lugar só. O app.js espalha este
   objeto dentro do CACHE_INVALIDATORS dele (seção REALTIME), que acrescenta os caches que são
   dele (portarias, localidades). Cache de lookup NOVO entra aqui, não lá. */
export const INVALIDADORES_LOOKUP = {
  municipio_teste:      () => { epoca.ibge++; ibgeMap = null; },
  origem_teste:         () => { epoca.origem++; origemMap = null; },
  itinerario_teste:     () => { epoca.terminais++; terminalRows = null; },
  evento_empresa_teste: () => { epoca.emp++; evLookups.emp = null; },
  evento_linha_teste:   () => { epoca.lin++; evLookups.lin = null; },
  // recarrega já: o nome da empresa é lido por renderizadores SÍNCRONOS (banner, listas), que
  // não têm como esperar um await — sem o recarregamento eles cairiam no código cru.
  codempresa_teste:     () => { epoca.empresas++; empresas.map = null; empresas.list = null; empresas.byCod = null; getEmpresas().catch(()=>{}); },
};
