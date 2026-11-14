# Visibilidade do repositório

## Estado observado e decisão pendente

Em 14/11/2026, a API do GitHub informou `visibility: public`, `main.protected=true` e o
ruleset `21211640` ativo. Em 08/11/2026 a resposta era `private`; não foram determinadas
as datas ou motivações das mudanças de visibilidade. Nenhuma delas foi realizada nesta correção.

Esta ADR fica **reaberta para conciliação com o dono**. Preserve a visibilidade existente;
corrigir a documentação não autoriza tornar o repo público ou alterar o plano da conta.
As proteções de merge comprovadas pela consulta atual e as pendências de revisão humana e
secret scanning estão em [seguranca.md](../seguranca.md) §5; não inferir recursos adicionais
somente da visibilidade pública.

## Decisão histórica de 31/07/2026

O repositório — na época `LucasMolinari9/LucasCTEC`, hoje `LucasMolinari9/DETRO-Banco-de-Dados`
— já foi privado. O `docs/seguranca.md` chegou a listar "tornar o
repositório privado" entre as ações de maior ganho para o dono, com o passo a passo do painel do
GitHub — uma instrução acionável, escrita quando essa era a postura vigente. A postura mudou e a
instrução ficou; o manual de segurança passou a mandar fazer o oposto da decisão em vigor. Esta
ADR existe para que a decisão tenha um lugar próprio, em vez de sobreviver como ausência de
instrução contrária.

**Decisão então registrada:** manter o repositório **público**. Essa diretriz histórica está
em revisão após as mudanças de visibilidade observadas; não é uma instrução para mudá-la.

**Por quê:** a segurança do portal nunca dependeu do sigilo do código. Ela está no banco — RLS
ligado em todas as tabelas, `anon` com SELECT e nada além, objeto novo nascendo fechado — e isso
é verificado contra o banco vivo pelos gates, não presumido. A chave `anon` é pública por
projeto, e o `app.js` é servido a todo visitante: o código já era legível por qualquer um antes
da mudança de visibilidade. O que um repo privado escondia era a **prosa**, não a superfície de
ataque.

O ganho operacional considerado era a disponibilidade de Actions e Code Scanning em repositório
público. Custos e recursos efetivamente habilitados precisam ser conferidos no plano.

**O que a decisão custa, e é aceito:** documentação de arquitetura, runbooks e a lista de riscos
residuais passam a ser legíveis por qualquer pessoa.

Na maior parte isso não entrega nada — a documentação descreve controles que já são observáveis de
fora (a chave `anon` e o `app.js` são servidos a todo visitante) ou comportamento público do
Postgres e do Supabase. **A exceção é a capacidade de resposta a incidente:** que não há como
aplicar rate limit sem mudar a arquitetura (§ 9.2) e que o restore nunca foi concluído, com RTO/RPO
sem medição (§ 9.3), não são fatos deriváveis de fora. **A resposta certa a isso não é redigir a
prosa — é fechar o SEC-06.** Enquanto o RTO for desconhecido, a frase é verdadeira esteja ela no
git ou na pasta de backups; tirá-la do git protegeria o texto, não o portal.

**O que a decisão NÃO justifica:** apagar do repositório a explicação de por que um controle
existe. O `CLAUDE.md` continua registrando, por inteiro e com a medição que o originou, o motivo de
o gate `check_grants.mjs` rodar diariamente e de o `backup_schema.sql` revogar tudo que não é
SELECT. Regra sem lastro é regra que a próxima faxina apaga por parecer redundante — foi assim que
a versão anterior daquele parágrafo pôde afirmar o oposto do medido por dois dias. Sigilo não é o
que protege o banco aqui; o gate diário é.

## Regras que permanecem

- `docs/seguranca.md` §5 distingue evidência histórica de proteção atualmente comprovada.
- `--metrics=off` do Semgrep continua evitando telemetria de código, independentemente da
  visibilidade. O backup REST também continua sem credencial administrativa.
- `LICENSE` segue **proprietária** (todos os direitos reservados). Uma eventual visibilidade
  pública permite leitura do repo, mas não concede licença de uso, cópia ou obra derivada.

## Status

Accepted em 31/07/2026; reaberta em 08/11/2026 por divergência com a configuração observada.
A decisão histórica substituía a recomendação de repo privado do manual de 27/07/2026.
