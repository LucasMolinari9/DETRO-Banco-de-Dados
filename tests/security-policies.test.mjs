import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexarPolicies, detalhePolicy, bloqueiaEscrita, validarValidadeAuditora, validarFuncoesInternas } from '../scripts/lib/security-policies.mjs';

const helper = () => ({ schema: 'private', signature: 'private.f_unaccent(text)',
  security_definer: false, anon_execute: true, authenticated_execute: false });
const diagnostico = () => ({ schema: 'audit', signature: 'audit.divat_security_shape()',
  security_definer: true, anon_execute: false, authenticated_execute: false });

test('catálogo vivo preserva helper INVOKER e diagnóstico DEFINER privado', () => {
  assert.doesNotThrow(() => validarFuncoesInternas([helper(), diagnostico()]));
});

test('estado vivo recusa helper elevado, função privada movida e diagnóstico exposto', () => {
  for (const f of [{ ...helper(), security_definer: true },
    { ...helper(), signature: 'private.funcao_movida(text)', security_definer: true },
    { ...diagnostico(), anon_execute: true }, { ...diagnostico(), authenticated_execute: true }]) {
    assert.throws(() => validarFuncoesInternas([helper(), f]));
  }
  for (const funcoes of [undefined, [], [diagnostico()], [{ ...helper(), anon_execute: undefined }]]) {
    assert.throws(() => validarFuncoesInternas(funcoes));
  }
});

const auditor = (valid_until = '2027-02-12T23:59:59+00:00') => ({
  login: 'divat_auditor_ci', can_login: true,
  checked_at: '2026-11-14T12:00:00+00:00', valid_until,
});

test('validade auditora usa o relógio do banco e avisa com 30 dias de antecedência', () => {
  assert.equal(validarValidadeAuditora(auditor()).avisar, false);
  const proxima = validarValidadeAuditora(auditor('2026-11-30T23:59:59Z'));
  assert.equal(proxima.avisar, true);
  assert.equal(proxima.diasRestantes, 17);
  assert.equal(validarValidadeAuditora(auditor('2026-12-14T12:00:00Z')).avisar, true);
  assert.equal(validarValidadeAuditora(auditor('2026-12-14T12:00:01Z')).avisar, false);
});

test('validade vencida, indefinida ou catálogo inválido não passam silenciosamente', () => {
  for (const valid_until of ['2026-11-14T12:00:00Z', '2026-11-13T23:59:59Z', 'infinity', null, undefined, 'inválido']) {
    assert.throws(() => validarValidadeAuditora({ ...auditor(), valid_until }), /validade|expir/i);
  }
  for (const alterado of [null, {}, { ...auditor(), login: 'postgres' },
    { ...auditor(), can_login: false }, { ...auditor(), checked_at: 'inválido' }]) {
    assert.throws(() => validarValidadeAuditora(alterado));
  }
});

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
