// check_corrida_abas.mjs — a BANCADA DE CORRIDA entre abas do modal (navegador headless).
//
// O que ela guarda: o contrato `ctx = { view, gen, pane, host, line }`. Todo render/loader do
// modal recebe esse contexto no início da tentativa e escreve NELE — nunca em `currentView`/
// `activeLine`/`modalBody`, que apontam para a aba que está na tela AGORA. Sem isso, uma resposta
// que chega depois de o usuário trocar de aba pinta o documento na aba errada e sobrescreve o
// `pdfHTML` de um documento que não é o dela.
//
// Por que ela precisou existir: nenhum outro gate deste repo CRIA a ordenação que define o bug.
//   - check_views.mjs abre cada view numa página limpa, uma de cada vez;
//   - check_abas.mjs espera cada ação assentar (waitForTimeout) antes de trocar de aba;
//   - check_selecao_linha.mjs espera o pane parar de girar antes de seguir;
//   - e o stub do PostgREST respondia SÍNCRONO, sem atraso nenhum.
// Os três ficavam verdes enquanto um render atrasado pintava o pane errado. Aqui o stub segura a
// resposta (`segurar` em scripts/lib/rig.mjs) até a troca de aba ter acontecido, e só então
// libera — a ordenação passa a ser construída, não esperada.
//
// As três asserções, em cada ato:
//   (a) o pane da aba 2 NÃO foi pintado pelo trabalho atrasado da aba 1;
//   (b) o `pdfHTML` da aba 2 NÃO foi sobrescrito;
//   (c) o pane DA ABA 1 e o `pdfHTML` DELA recebem a resposta atrasada.
// A (c) não é decoração: sem ela, uma implementação que simplesmente DESCARTASSE toda resposta
// pós-troca-de-aba passaria em (a) e (b) e deixaria a aba 1 eternamente sem o seu resultado.
//
// Cinco atos, porque são cinco pontos de escrita diferentes:
//   ATO 1 — um RENDER de documento (Itinerários): cobre (a), (b) e (c).
//   ATO 2 — a CASCA de um loader (Ligações por Logradouro), que monta o painel de busca DEPOIS
//           de um await. Era o ponto que de fato sangrava antes do contexto explícito: o
//           `searchPanel` escrevia no `modalBody` ao vivo. Cobre (a) e (c).
//   Os três seguintes vieram da auditoria de 25/10/2026 (DIVAT-01 e C01 do Codex):
//   ATO 3 — a BUSCA DE LINHA de um documento resolve com o usuário em outra aba: a linha vai para
//           a aba que pediu, não para a ativa. Cobre (a) e (c).
//   ATO 4 — duas buscas no MESMO documento, a mais velha respondendo por último: a tela fica com
//           a mais nova (o `gen` já protegia o PDF; a tela, não).
//   ATO 5 — troca de documento na MESMA aba com o loader anterior no ar: o anterior não pinta por
//           cima do novo.
//
// Uso:
//   node scripts/check_corrida_abas.mjs
// Servidor, fixtures e Chromium vêm de scripts/lib/rig.mjs. Sai 0 = tudo verde.

import { startServer, getChromium, launchPage, makeReporter, pdfDaAbaAtiva } from './lib/rig.mjs';

const PORT = 8101;
// O título do documento de Itinerários — o que distingue o PDF dele de qualquer outro.
const MARCA_ITINERARIO = /Cadastro de Linhas: Itiner/i;
// O campo de busca do `searchPanel`, que a CASCA do documento tem e o pdfHTML committado não.
const SPINPUT = /id="spInput"/;
const server = await startServer(PORT);
const { falhas, check } = makeReporter();

// Um portão: as requisições que casam ficam presas até `liberar()`.
function portao(casa) {
  let liberar;
  const preso = new Promise(r => { liberar = r; });
  let presas = 0;
  return {
    segurar: (tabela, qs) => (casa(tabela, qs) ? (presas++, preso) : null),
    liberar: () => liberar(),
    get presas(){ return presas; },
  };
}

// Abre uma aba nova pelo "+" e escolhe Portarias no seletor de documentos dela.
// Portarias é o vizinho ideal: não exige linha (nenhum acoplamento com a aba 1) e escreve
// `pdfHTML` próprio — sem isso a asserção (b) não teria o que proteger.
async function abrirPortariasEmAbaNova(page) {
  await page.click('#modalTabAdd');
  await page.waitForSelector('.modal-body.active #spHost', { timeout: 15000 });
  await page.click('.modal-body.active .card[data-view="portarias"]');
  await page.waitForSelector('.modal-body.active #pNum', { timeout: 15000 });
  await page.waitForSelector('.modal-body.active tbody tr', { timeout: 15000 });
}

/* ================================================================
   ATO 1 — render de documento (Itinerários)
   ================================================================ */
{
  const g = portao((tabela, qs) => tabela === 'itinerario_teste' && qs.includes('codlinha=eq.549000001'));
  const { browser, page } = await launchPage(getChromium(), { segurar: g.segurar });

  // aba 1: Itinerários da 549M — o fetch do itinerário fica PRESO no portão
  await page.goto(`http://127.0.0.1:${PORT}/#/linha/549000001/consulta/itinerarios`);
  await page.waitForSelector('#modalOverlay.open', { timeout: 15000 });
  await page.waitForSelector('.modal-body.active #spHost', { timeout: 15000 });
  check(g.presas > 0, 'ATO 1 · o portão prendeu o fetch do itinerário', `presas=${g.presas}`);
  check(await page.locator('.modal-body.active #itiResult').count() === 0,
    'ATO 1 · a aba 1 ainda NÃO tem o documento (a resposta está presa)');

  // aba 2: Portarias, aberta e concluída enquanto a aba 1 espera
  await abrirPortariasEmAbaNova(page);
  const pdfAba2Antes = await pdfDaAbaAtiva(page);
  // O marcador do documento de Itinerários é o TÍTULO dele, não a palavra "itinerário" solta: o
  // texto de uma das portarias da fixture fala em alteração de itinerário, e um teste que casasse
  // a palavra crua acusaria contaminação onde não há — falso vermelho é tão inútil quanto falso
  // verde.
  check(/portaria\(s\)/i.test(pdfAba2Antes) && !MARCA_ITINERARIO.test(pdfAba2Antes),
    'ATO 1 · a aba 2 tem o PDF dela antes da liberação', `${pdfAba2Antes.length}c`);

  // libera a resposta atrasada da aba 1 — a aba 2 é que está na tela
  g.liberar();
  await page.waitForTimeout(900);

  // (a) o pane da aba 2 não foi pintado pelo render da aba 1
  const aba2TemPortaria = await page.locator('.modal-body.active #pNum').count();
  const aba2TemItinerario = await page.locator('.modal-body.active #itiResult').count();
  check(aba2TemPortaria === 1 && aba2TemItinerario === 0,
    'ATO 1 · (a) o pane da aba 2 NÃO foi pintado pelo render da aba 1',
    `#pNum=${aba2TemPortaria} #itiResult=${aba2TemItinerario}`);

  // (b) o pdfHTML da aba 2 não foi sobrescrito
  const pdfAba2Depois = await pdfDaAbaAtiva(page);
  check(pdfAba2Depois === pdfAba2Antes && !MARCA_ITINERARIO.test(pdfAba2Depois),
    'ATO 1 · (b) o pdfHTML da aba 2 NÃO foi sobrescrito',
    `igual=${pdfAba2Depois === pdfAba2Antes}`);

  // (c) o pane DA ABA 1 e o pdfHTML DELA receberam a resposta atrasada
  await page.click('.modal-tab:first-child [data-select-tab]');
  await page.waitForTimeout(400);
  const linhasAba1 = await page.locator('.modal-body.active #itiResult tbody tr').count();
  check(linhasAba1 > 0, 'ATO 1 · (c) o pane da aba 1 recebeu a resposta atrasada',
    `linhas de itinerário=${linhasAba1}`);
  const pdfAba1 = await pdfDaAbaAtiva(page);
  // O `!SPINPUT` não é zelo: sem ele esta asserção NÃO distingue o pdfHTML committado da resposta
  // atrasada do FALLBACK do baixarPdf (`app.js:1088`–`:1089`, que clona o `.doc` vivo). O
  // `searchPanel` também chama `docHead(title)`, então a marca do título e as linhas da tabela
  // aparecem nos dois caminhos — medido na Fase C1, mutando o `commitViewResult` do
  // `renderItinerarios` para fora: a asserção continuava VERDE. O que só o pdfHTML tem é a
  // AUSÊNCIA do campo de busca: o PDF é o documento, não o painel em volta dele.
  check(MARCA_ITINERARIO.test(pdfAba1) && /TERMINAL MENEZES CORTES/i.test(pdfAba1)
        && !SPINPUT.test(pdfAba1),
    'ATO 1 · (c) o pdfHTML da aba 1 veio do commitViewResult, não do fallback do baixarPdf',
    `${pdfAba1.length}c`);

  await browser.close();
}

/* ================================================================
   ATO 2 — casca de loader que monta o painel DEPOIS de um await
   ================================================================ */
{
  // `getIbge()` (municipio_teste) é o await que o loader de Ligações por Logradouro faz ANTES de
  // montar o painel de busca. Página nova = cache de lookup vazio, então ele é um fetch de
  // verdade e o portão o alcança.
  const g = portao(tabela => tabela === 'municipio_teste');
  const { browser, page } = await launchPage(getChromium(), { segurar: g.segurar });

  await page.goto(`http://127.0.0.1:${PORT}/#/consulta/ligacoesPorLogradouro`);
  await page.waitForSelector('#modalOverlay.open', { timeout: 15000 });
  check(g.presas > 0, 'ATO 2 · o portão prendeu o lookup de municípios', `presas=${g.presas}`);

  await abrirPortariasEmAbaNova(page);
  const pdfAba2Antes = await pdfDaAbaAtiva(page);

  g.liberar();
  await page.waitForTimeout(900);

  // (a) a casca atrasada da aba 1 não pode ter montado o painel de busca sobre a aba 2
  const aba2TemPortaria = await page.locator('.modal-body.active #pNum').count();
  const aba2TemPainel = await page.locator('.modal-body.active #spInput').count();
  check(aba2TemPortaria === 1 && aba2TemPainel === 0,
    'ATO 2 · (a) o painel atrasado da aba 1 NÃO foi montado no pane da aba 2',
    `#pNum=${aba2TemPortaria} #spInput=${aba2TemPainel}`);
  const pdfAba2Depois = await pdfDaAbaAtiva(page);
  check(pdfAba2Depois === pdfAba2Antes,
    'ATO 2 · (b) o pdfHTML da aba 2 NÃO foi sobrescrito');

  // (c) o painel foi parar no pane da aba 1, que é quem o pediu
  await page.click('.modal-tab:first-child [data-select-tab]');
  await page.waitForTimeout(400);
  const aba1TemPainel = await page.locator('.modal-body.active #spInput').count();
  const tituloAba1 = (await page.textContent('#mtTitle')) || '';
  check(aba1TemPainel === 1 && /Logradouro/i.test(tituloAba1),
    'ATO 2 · (c) o pane da aba 1 recebeu o painel de busca', `título="${tituloAba1.trim()}"`);

  await browser.close();
}

/* Linha do banner (número da ligação) e se ele está visível — o que a aba ativa diz ser "a linha". */
const banner = page => page.evaluate(() => {
  const b = document.querySelector('#lineBanner');
  return b.classList.contains('is-hidden') ? null : (b.querySelector('.lb-num')?.textContent || '').trim();
});
const esperarPintura = page => page.waitForFunction(() => {
  const pane = document.querySelector('.modal-body.active');
  return !!pane && !pane.querySelector('.spin');
}, null, { timeout: 15000 });

/* ================================================================
   ATO 3 — busca de LINHA atrasada × troca de aba (DIVAT-01)
   ----------------------------------------------------------------
   O `lineSearchRun` resolvia o termo e chamava `selectLine`, que grava na aba ATIVA no instante
   da resposta. Com a busca da aba 1 no ar e o usuário na aba 2, a linha buscada caía na aba 2.
   ================================================================ */
{
  const g = portao((tabela, qs) => tabela === 'tabela_vista_teste' && qs.includes('or='));
  const { browser, page } = await launchPage(getChromium(), { segurar: g.segurar });

  // aba 1: Tarifas da 740D; busca "549M" dentro do documento — a busca fica PRESA
  await page.goto(`http://127.0.0.1:${PORT}/#/linha/740000001/consulta/tarifas`);
  await page.waitForSelector('#modalOverlay.open', { timeout: 15000 });
  await esperarPintura(page);
  await page.fill('.modal-body.active #spInput', '549M');
  await page.click('.modal-body.active #spBtn');
  await page.waitForTimeout(300);
  check(g.presas > 0, 'ATO 3 · o portão prendeu a busca de linha da aba 1', `presas=${g.presas}`);

  // aba 2: aberta em branco (sem linha) enquanto a busca da aba 1 espera
  await abrirPortariasEmAbaNova(page);
  const bannerAba2Antes = await banner(page);

  g.liberar();
  await page.waitForTimeout(900);

  // (a) a linha da aba 2 continua a dela — a resposta não é da aba que está na tela
  const bannerAba2Depois = await banner(page);
  check(bannerAba2Depois === bannerAba2Antes,
    'ATO 3 · (a) a busca atrasada da aba 1 NÃO mudou a linha da aba 2',
    `antes=${bannerAba2Antes} depois=${bannerAba2Depois}`);
  check(await page.locator('.modal-body.active #pNum').count() === 1,
    'ATO 3 · (a) o pane da aba 2 continua com as Portarias');

  // (c) a aba 1, que pediu, recebe a linha e o documento dela
  await page.click('.modal-tab:first-child [data-select-tab]');
  await page.waitForTimeout(400);
  const bannerAba1 = await banner(page);
  const telaAba1 = await page.evaluate(() => document.querySelector('.modal-body.active #spHost')?.innerText || '');
  check(bannerAba1 === '549M' && /7,50/.test(telaAba1),
    'ATO 3 · (c) a aba 1 recebeu a linha buscada e as tarifas dela', `banner=${bannerAba1}`);

  await browser.close();
}

/* ================================================================
   ATO 4 — duas buscas no MESMO documento, a mais velha responde por último (C01 do Codex)
   ----------------------------------------------------------------
   Busca "740D" (tarifas presas), depois "549M" (responde na hora). Quando a de 740 é liberada, o
   render dela escrevia no mesmo container: banner e PDF da 549, tela com as tarifas da 740.
   ================================================================ */
{
  const g = portao((tabela, qs) => tabela === 'tarifa_atual_teste' && qs.includes('codlinha=eq.740000001'));
  const { browser, page } = await launchPage(getChromium(), { segurar: g.segurar });

  await page.goto(`http://127.0.0.1:${PORT}/#/consulta/tarifas`);
  await page.waitForSelector('#modalOverlay.open', { timeout: 15000 });
  await esperarPintura(page);
  await page.fill('.modal-body.active #spInput', '740D');
  await page.click('.modal-body.active #spBtn');
  await page.waitForTimeout(400);
  check(g.presas > 0, 'ATO 4 · o portão prendeu as tarifas da 740D', `presas=${g.presas}`);
  await page.fill('.modal-body.active #spInput', '549M');
  await page.click('.modal-body.active #spBtn');
  await page.waitForTimeout(400);
  await esperarPintura(page);

  g.liberar();
  await page.waitForTimeout(900);

  const tela = await page.evaluate(() => document.querySelector('.modal-body.active #spHost')?.innerText || '');
  check(/7,50/.test(tela) && !/19,90/.test(tela),
    'ATO 4 · a tela fica com a busca MAIS NOVA (549M), não com a resposta atrasada (740D)',
    `549=${/7,50/.test(tela)} 740=${/19,90/.test(tela)}`);
  check(await banner(page) === '549M', 'ATO 4 · o banner fica na 549M');
  const pdf = await pdfDaAbaAtiva(page);
  check(/7,50/.test(pdf) && !/19,90/.test(pdf), 'ATO 4 · o PDF é o da 549M');

  await browser.close();
}

/* ================================================================
   ATO 5 — trocar de documento na MESMA aba com o loader anterior no ar (C01 do Codex)
   ----------------------------------------------------------------
   Empresas Regulares fica presa; a rota troca para Portarias na mesma aba. A geração da view
   substituída não era invalidada, e o loader dela pintava o pane por cima das Portarias.
   ================================================================ */
{
  const g = portao((tabela, qs) => tabela === 'tabela_vista_teste' && qs.includes('select=codempresa,cancelado'));
  const { browser, page } = await launchPage(getChromium(), { segurar: g.segurar });

  await page.goto(`http://127.0.0.1:${PORT}/#/consulta/empresasRegulares`);
  await page.waitForSelector('#modalOverlay.open', { timeout: 15000 });
  await page.waitForTimeout(300);
  check(g.presas > 0, 'ATO 5 · o portão prendeu o loader de Empresas Regulares', `presas=${g.presas}`);

  await page.evaluate(() => { location.hash = '#/consulta/portarias'; });
  await page.waitForSelector('.modal-body.active #pNum', { timeout: 15000 });
  await page.waitForSelector('.modal-body.active tbody tr', { timeout: 15000 });

  g.liberar();
  await page.waitForTimeout(900);

  const temPortaria = await page.locator('.modal-body.active #pNum').count();
  const temEmpresas = await page.locator('.modal-body.active #empSit').count();
  check(temPortaria === 1 && temEmpresas === 0,
    'ATO 5 · o loader da view substituída NÃO pintou por cima do documento novo',
    `#pNum=${temPortaria} #empSit=${temEmpresas}`);

  await browser.close();
}

server.close();
console.log(falhas.length ? `\n${falhas.length} falha(s).` : '\nCorrida entre abas OK.');
process.exit(falhas.length ? 1 : 0);
