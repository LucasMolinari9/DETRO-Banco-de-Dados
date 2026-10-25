// check_resultados.mjs — o que a tela e o PDF AFIRMAM bate com o que o banco devolveu?
// (navegador headless)
//
// Os outros gates de navegador perguntam se a view pinta (check_views), se as abas se comportam
// (check_abas), se a seleção sobrevive ao histórico (check_selecao_linha) e se uma resposta
// atrasada acerta a aba certa (check_corrida_abas). Nenhum pergunta se o resultado está
// COMPLETO, nem se o PDF diz o mesmo que a tela — e foi aí que a auditoria de 25/10/2026
// (DIVAT-03, DIVAT-04 e o C04 do Codex) achou defeitos que todos os gates deixavam verdes,
// porque com 3 linhas de fixture nenhum corte é atingido e nenhuma lista fica vazia.
//
// §1 LINHAS NO MUNICÍPIO. O documento lia só 4.000 trechos de itinerário (o Rio tem ~13,5 mil)
//    e chamava de "Total" o que coubesse neles, sem aviso. Aqui o município tem mais de 4.000
//    trechos, e o Total tem de contar todas as linhas.
// §2 MUNICÍPIO A → B. A busca direcional consultava a ordem dos trechos só para os 200
//    primeiros candidatos e afirmava "nenhuma linha" sobre o resto. Aqui a única linha que vai
//    de A para B é a 202ª candidata.
// §3 PDF EM ESTADO VAZIO. Lista vazia, filtro sem correspondência e filtro textual sem
//    correspondência deixavam o `pdfHTML` da consulta ANTERIOR no lugar: a tela dizia "nenhuma",
//    o PDF saía com as linhas de antes.
//
// Uso:
//   node scripts/check_resultados.mjs
// Servidor, fixtures e Chromium vêm de scripts/lib/rig.mjs. Sai 0 = tudo verde.

import { startServer, getChromium, launchPage, makeReporter, pdfDaAbaAtiva, FIXTURES } from './lib/rig.mjs';

/* Fixtures EXTRAS, locais a este processo (mesmo padrão do check_selecao_linha.mjs: o rig é um
   módulo, mutá-lo aqui não vaza para os outros gates). */
const RIO = '3304557', NITEROI = '3303302';
let idSeq = 10000;
const trecho = (codlinha, sentido, nome_logradouro, cod_municipio_origem) => ({
  id: idSeq++, codlinha, codempresa: '101', sentido, tipo_logradouro: 'Rua', nome_logradouro, cod_municipio_origem,
});
// §1: mais de 4.000 trechos no Rio, todos da 549M — sozinhos eles enchem o corte antigo.
for (let i = 0; i < 4001; i++) FIXTURES.itinerario_teste.push(trecho('549000001', 'IDA', 'RUA DO VOLUME', RIO));
// §2: 200 candidatas que passam pelos dois municípios na ordem CONTRÁRIA (Niterói → Rio)…
for (let i = 1; i <= 200; i++){
  const cod = `61000${String(i).padStart(4, '0')}`;
  FIXTURES.itinerario_teste.push(trecho(cod, 'IDA', 'RUA DE NITEROI', NITEROI), trecho(cod, 'IDA', 'RUA DO RIO', RIO));
}
// …e a ÚNICA que vai do Rio para Niterói, por último — a 202ª candidata (a 549M é a 1ª).
const ALVO = { cod: '620000001', nome: 'ALVO DIRECIONAL X NITEROI' };
FIXTURES.itinerario_teste.push(trecho(ALVO.cod, 'IDA', 'RUA DO RIO', RIO), trecho(ALVO.cod, 'IDA', 'RUA DE NITEROI', NITEROI));
FIXTURES.tabela_vista_teste.push({
  ...FIXTURES.tabela_vista_teste[0], codlinha: ALVO.cod, numero_ligacao: '620A', nome_ligacao: ALVO.nome,
  nome_lig_cresc: ALVO.nome,
});
// §3: logradouro cujo único trecho é de uma codlinha ÓRFÃ (o banco real tem 17 — ver CLAUDE.md
// 2e): a busca acha código, mas `fetchLinesByCods` volta vazio e a lista chega vazia.
FIXTURES.itinerario_teste.push(trecho('404000001', 'IDA', 'RUA ORFA', RIO));

const LINHA_549 = /RIO DE JANEIRO X NITEROI/;

const PORT = 8102;
const server = await startServer(PORT);
const { browser, page } = await launchPage(getChromium());
const { falhas, check } = makeReporter();
const erros = [];
page.on('pageerror', e => erros.push('pageerror: ' + e.message));

// `fmtLineName` troca espaço por &nbsp; no nome da linha — normaliza antes de comparar.
const textoDoPane = () => page.evaluate(() =>
  (document.querySelector('.modal-body.active')?.innerText || '').replace(/ /g, ' '));
const esperarPintura = () => page.waitForFunction(() => {
  const pane = document.querySelector('.modal-body.active');
  return !!pane && !pane.querySelector('.spin');
}, null, { timeout: 20000 });
async function abrir(view){
  await page.goto('about:blank');
  await page.goto(`http://127.0.0.1:${PORT}/#/consulta/${view}`);
  await page.waitForSelector('#modalOverlay.open', { timeout: 20000 });
  await esperarPintura();
}
async function buscar(termo){
  await page.fill('.modal-body.active #spInput', termo);
  await page.click('.modal-body.active #spBtn');
  await page.waitForTimeout(500);
  await esperarPintura();
}

/* ================================================================
   §1 — Linhas no Município conta TODAS as linhas
   ================================================================ */
{
  const esperado = new Set(FIXTURES.itinerario_teste.filter(r => r.cod_municipio_origem === RIO).map(r => r.codlinha)).size;
  await abrir('municipioRegiao');
  await buscar('Rio de Janeiro');
  await page.waitForSelector('.modal-body.active #munScope', { timeout: 20000 });
  await esperarPintura();
  // o rótulo sai em CAIXA ALTA pelo CSS (`TOTAL:`), por isso o `i`
  const total = Number((/Total:\s*(\d+) linha/i.exec(await textoDoPane()) || [])[1]);
  check(total === esperado, '§1 · o Total do município conta as linhas de todos os trechos, não só dos 4.000 primeiros',
    `Total=${total} esperado=${esperado}`);
}

/* ================================================================
   §2 — Município A → B examina todas as candidatas
   ================================================================ */
{
  await abrir('localidades');
  await page.click('.modal-body.active .loc-filter-btn[data-idx="3"]');
  await page.fill('.modal-body.active #locA', 'Rio de Janeiro');
  await page.fill('.modal-body.active #locB', 'Niteroi');
  await page.click('.modal-body.active #locGo');
  await page.waitForTimeout(500);
  await esperarPintura();
  const txt = await textoDoPane();
  check(txt.includes(ALVO.nome), '§2 · a linha que vai de A para B é achada mesmo depois da 200ª candidata',
    txt.includes('Nenhuma linha encontrada') ? 'a tela afirmou "nenhuma linha"' : '');
}

/* ================================================================
   §3 — estado vazio não exporta o resultado anterior
   ================================================================ */
{
  // (a) filtro de situação sem correspondência: a empresa 101 não tem linha cancelada
  await abrir('ligacoesPorEmpresa');
  await buscar('alfa');
  await page.waitForSelector('.modal-body.active #lrStatus', { timeout: 20000 });
  check(LINHA_549.test(await pdfDaAbaAtiva(page)), '§3a · antes do filtro, o PDF traz a lista');
  await page.selectOption('.modal-body.active #lrStatus', 'canceladas');
  await page.waitForTimeout(300);
  const telaA = await textoDoPane();
  const pdfA = await pdfDaAbaAtiva(page);
  check(/Nenhuma linha com esse filtro/.test(telaA) && !LINHA_549.test(pdfA),
    '§3a · filtro "Canceladas" sem resultado: a tela diz "nenhuma" e o PDF não traz as linhas de antes');

  // (b) lista vazia DEPOIS de uma busca com resultado: o logradouro só tem codlinha órfã
  await abrir('ligacoesPorLogradouro');
  await buscar('vargas');
  check(LINHA_549.test(await pdfDaAbaAtiva(page)), '§3b · a primeira busca exporta a linha encontrada');
  await buscar('orfa');
  const telaB = await textoDoPane();
  const pdfB = await pdfDaAbaAtiva(page);
  check(/Nenhuma ligação encontrada/.test(telaB) && !LINHA_549.test(pdfB),
    '§3b · busca nova com lista vazia: o PDF não traz a linha da busca anterior');

  // (c) filtro textual sem correspondência em Seções por Empresa
  await abrir('secoesPorEmpresa');
  await buscar('101');
  await page.waitForSelector('.modal-body.active #secF', { timeout: 20000 });
  check(LINHA_549.test(await pdfDaAbaAtiva(page)), '§3c · antes do filtro, o PDF traz as seções');
  await page.fill('.modal-body.active #secF', 'zzz');
  await page.waitForTimeout(600);
  const telaC = await textoDoPane();
  const pdfC = await pdfDaAbaAtiva(page);
  check(/Nenhuma seção com esse filtro/.test(telaC) && !LINHA_549.test(pdfC),
    '§3c · filtro textual sem resultado: o PDF não traz as seções de antes');

  // (d) Empresas Regulares: nenhuma empresa da fixture é cassada
  await abrir('empresasRegulares');
  await page.waitForSelector('.modal-body.active #empSit', { timeout: 20000 });
  check(/VIACAO ALFA/.test(await pdfDaAbaAtiva(page)), '§3d · antes do filtro, o PDF traz as empresas');
  await page.selectOption('.modal-body.active #empSit', 'cassada');
  await page.waitForTimeout(300);
  const telaD = await textoDoPane();
  const pdfD = await pdfDaAbaAtiva(page);
  check(/Nenhuma empresa com esse filtro/.test(telaD) && !/VIACAO ALFA/.test(pdfD),
    '§3d · filtro "Cassadas" sem resultado: o PDF não traz as empresas de antes');
}

check(!erros.length, 'nenhum erro de página', erros.join(' | '));

await browser.close();
server.close();
console.log(falhas.length ? `\n${falhas.length} falha(s).` : '\nResultados íntegros.');
process.exit(falhas.length ? 1 : 0);
