import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexarPolicies, detalhePolicy, bloqueiaEscrita } from '../scripts/lib/security-policies.mjs';

const bloqueio = (cmd = 'w') => ({
  tabela: 'tabela_vista_teste', nome: 'divat_block_client_update', cmd,
  permissive: false, qual: cmd === 'a' ? null : 'false', with_check: cmd === 'd' ? null : 'false',
});
const forma = () => ({
  tabelas: [{ nome: 'tabela_vista_teste', policies: [{ nome: 'divat_block_client_update', cmd: 'w' }] }],
  policy_details: [bloqueio()],
});

for (const cmd of ['a', 'w', 'd', '*']) {
  test(`RESTRICTIVE/FALSE bloqueia ${cmd}`, () => assert.equal(bloqueiaEscrita(bloqueio(cmd)), true));
  test(`mesma condição PERMISSIVE não recebe exceção (${cmd})`, () => {
    assert.equal(bloqueiaEscrita({ ...bloqueio(cmd), permissive: true }), false);
  });
}

test('nome de bloqueio não justifica condição que permite escrita', () => {
  assert.equal(bloqueiaEscrita({ ...bloqueio(), qual: 'true', with_check: 'true' }), false);
});
test('UPDATE e ALL exigem bloqueio nas duas condições', () => {
  for (const cmd of ['w', '*']) {
    for (const campo of ['qual', 'with_check']) {
      assert.equal(bloqueiaEscrita({ ...bloqueio(cmd), [campo]: null }), false);
      assert.equal(bloqueiaEscrita({ ...bloqueio(cmd), [campo]: 'true' }), false);
    }
  }
});
test('expressões arbitrárias não são interpretadas como FALSE', () => {
  for (const qual of ['NOT true', 'false OR true', 'false; SELECT true', undefined, false]) {
    assert.equal(bloqueiaEscrita({ ...bloqueio(), qual }), false);
  }
});
test('comandos desconhecidos ou metadados ausentes nunca recebem exceção', () => {
  assert.equal(bloqueiaEscrita({ ...bloqueio(), cmd: '?' }), false);
  assert.equal(bloqueiaEscrita({ ...bloqueio(), permissive: undefined }), false);
  assert.equal(bloqueiaEscrita(null), false);
});
test('catálogo completo corresponde ao diagnóstico por tabela e nome', () => {
  const f = forma();
  const indice = indexarPolicies(f);
  assert.deepEqual(detalhePolicy(indice, 'tabela_vista_teste', 'divat_block_client_update'), bloqueio());
  assert.equal(detalhePolicy(indice, 'outra_tabela', 'divat_block_client_update'), undefined);
});
test('diagnóstico sem policies e catálogo vazio é válido', () => {
  assert.equal(indexarPolicies({ tabelas: [{ nome: 'x', policies: [] }], policy_details: [] }).size, 0);
});

const incompletos = [
  ['catálogo ausente', f => { delete f.policy_details; }],
  ['catálogo vazio com policy no diagnóstico', f => { f.policy_details = []; }],
  ['lista do diagnóstico ausente', f => { delete f.tabelas[0].policies; }],
  ['policy omitida pelo diagnóstico', f => { f.tabelas[0].policies = []; }],
  ['comando divergente', f => { f.policy_details[0].cmd = 'd'; }],
  ['tabela divergente', f => { f.policy_details[0].tabela = 'outra_tabela'; }],
  ['policy duplicada no catálogo', f => { f.policy_details.push({ ...f.policy_details[0] }); }],
  ['policy duplicada no diagnóstico', f => { f.tabelas[0].policies.push({ ...f.tabelas[0].policies[0] }); }],
];
for (const campo of ['permissive', 'qual', 'with_check']) {
  incompletos.push([`campo ${campo} ausente`, f => { delete f.policy_details[0][campo]; }]);
}
for (const [nome, mutar] of incompletos) {
  test(`${nome} aborta em vez de aceitar uma policy sem evidência`, () => {
    const f = forma();
    mutar(f);
    assert.throws(() => indexarPolicies(f));
  });
}
