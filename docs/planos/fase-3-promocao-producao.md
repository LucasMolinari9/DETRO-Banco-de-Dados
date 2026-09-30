# Adoção do banco em uso e conclusão das correções

O banco oficial é `gontnlfmothfglssbyyk`, ainda chamado `divat - TESTE` no painel. Segundo o
dono, a antiga produção `lwzsxuaqqeoamukduhev` foi apagada. A Fase 3 já estava aplicada;
este plano não manda repetir migrations ou rollback no banco oficial.

O dono decidiu prosseguir sem gerar backup nesta entrega. Essa pendência não bloqueia a
conciliação do Git nem as correções de acesso e configuração autorizadas. A cobertura parcial
e a falta de recuperação comprovada continuam descritas em [backup.md](../backup.md).

## Etapa 1 — Conciliação do histórico

Recuperar as 11 migrations ausentes, alinhar os dois identificadores divergentes e versionar
a nova correção de acesso `20260930172521`. O histórico aplicado tem 18 entradas; mapa e
pré-requisitos em [schema.md](../schema.md). Copiar arquivos não executa novamente SQL nem
recupera snapshots históricos de dados.

**Saída:** Git representa as migrations aplicadas e a baseline antiga fica marcada como
histórica, sem instrução de reconstruir o estado atual apenas com ela.

## Etapa 2 — Acesso e auditoria

Retirar SELECT de `authenticated` na projeção promocional e restringir a policy a `anon`.
Verificar ausência de acesso público de escrita, RLS em todas as tabelas públicas, leitura
anônima e execução das duas RPCs. Não alterar registros, staging ou histórico.

Corrigir `check_phase3_audit.mjs` para comparar Realtime pelos nomes de `RT_TABLES`, usar o
transporte mínimo compartilhado, TLS e login exato. Verificar `DB checks`, `Deriva`, CI,
Semgrep e os testes de navegador no GitHub. Job pulado não comprova auditoria viva.

**Saída:** permissões verificadas no banco e checks executados e verdes nas entregas.

## Etapa 3 — Configuração e documentação vigentes

Apontar `SB_URL`/`SB_KEY` e MCP ao banco oficial, retirar o endpoint apagado da CSP e preservar
a flag temporária enquanto não existir outro teste. O site continua consultando o mesmo banco
que já usava; não criar fallback para a instância apagada.

Conciliar CLAUDE, manual de segurança, ETL, ADR e skill `db-change`. A exportação REST existente
fica corretamente identificada como parcial de public, com 15/19 tabelas, sem exigir um novo
dump nesta entrega. Documentação, processo e código ficam em entregas separadas.

**Saída:** configuração ativa e instruções não descrevem a produção apagada como disponível
nem presumem isolamento de previews ou rebuild automático de ETL.

## Etapa 4 — Conferências de contas e manutenção do banco único

A proteção da `main` foi comprovada pela API em 30/09/2026, com PR e checks obrigatórios,
sem exclusão, force-push ou bypass; detalhes em [seguranca.md](../seguranca.md).
Conferir MFA, membros, integrações, signup/anonymous sign-ins e secret scanning nos painéis.
Esses controles não foram comprovados pelo catálogo SQL; zero usuários não comprova signup fechado.

Em 30/09/2026, o dono determinou não criar outro banco. Não provisionar projeto Supabase
adicional ou branch do banco nesta entrega. Preservar `SB_URL`/`SB_KEY`, `SB_TESTE_URL`/
`SB_TESTE_KEY`, flag, CSP e MCP no projeto oficial vigente, com chave pública `anon` no navegador.
Produção, previews e localhost continuam compartilhando dados; validar essa configuração
pelos testes offline e pelo smoke real, sem afirmar isolamento.

**Saída:** banco único documentado, configuração verificada e conferências de contas registradas. A cópia integral
e o exercício de recuperação permanecem trabalho adiado, sem declaração falsa de conclusão.

## Critério de interrupção

Se checks ou leituras divergirem, interrompa a mudança correspondente e preserve os dados.
Uma reversão de frontend mantém o projeto em uso; não reativa o endpoint apagado.
`rollback_phase3_test.sql` é histórico e não deve remover a proteção do banco oficial.
