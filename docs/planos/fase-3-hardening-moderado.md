# Fase 3 — endurecimento moderado

## Estado vigente

O hardening está aplicado em `gontnlfmothfglssbyyk`, banco atualmente usado pelo portal e
adotado como oficial. Segundo o dono, a antiga produção `lwzsxuaqqeoamukduhev` foi apagada.
A continuidade do trabalho segue o [plano de promoção](fase-3-promocao-producao.md), sem
reaplicar a Fase 3 ou executar rollback no banco em uso.

## Decisões e limites

- O produto permanece público, sem Supabase Auth/sessões. Zero usuários observados não prova
  signup desativado; a configuração precisa ser conferida no painel atual.
- `anon` executa somente as duas RPCs de produto em `public`, ambas `SECURITY INVOKER`:
  `divat_busca_logradouro(text,integer)` e `divat_linhas_regiao(text,text)`.
- Helpers internos ficam em `private`; diagnósticos ficam em `audit`, sem acesso público.
- `divat_audit_owner` é `NOLOGIN`, herda somente `anon` e limita os direitos das funções
  diagnósticas `SECURITY DEFINER`. `divat_auditor` é `NOLOGIN`, sem SELECT direto.
- `divat_auditor_ci` é o login externo mínimo para executar esses diagnósticos. Não usar
  `postgres` ou `service_role` como substituto do auditor no CI.
- Na conferência de 30/09/2026: 19 tabelas públicas com RLS, 15 legíveis por `anon`, quatro
  stagings fechadas, sem escrita pública. `authenticated` não tem SELECT de tabela pública nem
  EXECUTE de função pública; a exceção promocional foi fechada pela migration `20260930172521`.

A garantia atual e os riscos residuais pertencem a [seguranca.md](../seguranca.md).
O histórico de 18 migrations e suas dependências pertencem a [schema.md](../schema.md).
As migrations iniciais pressupõem schema e dados existentes; não são reconstrução de um
projeto vazio nem recuperação dos snapshots privados históricos.

## Credencial auditora

O secret de Actions mantém o nome `SUPABASE_TEST_AUDIT_DATABASE_URL`. Os validadores exigem
`gontnlfmothfglssbyyk`, login exato `divat_auditor_ci` (direto) ou
`divat_auditor_ci.gontnlfmothfglssbyyk` (pooler), senha não vazia e TLS. O transporte não
imprime URL, senha ou stderr do `psql`; usa transações somente leitura e timeout.

Criação/rotação da senha é separada das migrations, para não versionar segredo. Quando necessário, use `scripts/bootstrap_phase3_auditor.sql` em ambiente privado e configure o
secret de Actions. Informe senha e validade por variáveis privadas; não coloque esses valores
no Git, em tickets ou em mensagens. O comando administrativo não deve ser executado por um
job de auditoria regular.

Pelo celular, o SQL Editor pode executar a parte SQL do bootstrap, sem metacomandos exclusivos
de `psql`, preservando atributos mínimos do papel. Registre a nova validade e verifique os jobs
vivos após atualizar o secret. Não redefinir a senha enquanto o acesso existente funciona
somente para marcar a etapa como concluída.

## Verificações permanentes

| Gate | Diagnóstico | Execução |
|---|---|---|
| `check_grants.mjs` | `audit.divat_security_shape()` | diária em `DB checks` |
| `check_data_quality.mjs` | `audit.divat_data_quality()` | semanal e manual em `DB checks` |
| `check_realtime.mjs` | `audit.realtime_tables()` | semanal e manual em `DB checks` |
| `check_deriva.mjs` | `audit.divat_api_shape()` | semanal e push/PR em `Deriva` |
| `check_phase3_audit.mjs` | combinação dos diagnósticos e login | push relevante na `main` e manual em `Phase 3 database security` |

O alvo de todos é o banco em uso. O nome TESTE no secret não cria isolamento. A checagem
agregada compara os nomes de Realtime com `RT_TABLES`, sem fixar a contagem histórica de 14.
Jobs verdes que pularam a auditoria viva não comprovam o estado do banco.

`scripts/check_migrations.mjs` rejeita tabela pública sem RLS/`REVOKE ALL`, EXECUTE implícito
público, RPC anônima fora da allowlist e senha versionada. Desde 11/10/2026 avalia o que cada
GRANT/POLICY concede: recusa escrita para anon/authenticated/PUBLIC, policy de escrita PERMISSIVE
e `GRANT EXECUTE` para PUBLIC (achado AUD-03 da revisão Codex). Defaults controláveis de `postgres`
estão fechados; defaults de `supabase_admin` persistem e exigem o gate vivo complementar.

## Evidência histórica

A migration inicial foi registrada em julho; em agosto, reparos moveram novamente diagnósticos
para `audit` e fecharam grants públicos divergentes. Os identificadores aplicados são
`20260822144625` e `20260822151732`, conciliados com os arquivos do Git. Não repetir essas
migrations porque uma instrução antiga citava timestamps diferentes.

Os runs manuais de 22/08/2026 comprovaram o auditor mínimo naquela data:
[Phase 3](https://github.com/LucasMolinari9/LucasCTEC/actions/runs/32585853817),
[DB checks](https://github.com/LucasMolinari9/LucasCTEC/actions/runs/32585854923) e
[Deriva](https://github.com/LucasMolinari9/LucasCTEC/actions/runs/32585856069).
Eles são evidência datada, não substituem uma nova execução depois das correções atuais.

## Rollback histórico

`scripts/rollback_phase3_test.sql` restaura ACLs anteriores e remove papéis/diagnósticos.
Seu ensaio transacional histórico não o torna seguro para o banco que hoje serve o portal.
Não executar no candidato oficial. Qualquer recuperação atual começa por dump validado e
ensaio isolado de [backup.md](../backup.md), preservando a instância em uso.
