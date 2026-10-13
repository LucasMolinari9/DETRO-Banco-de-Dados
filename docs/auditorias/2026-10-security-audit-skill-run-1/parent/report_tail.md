## 7. Cobertura (resumo do `coverage-ledger.json`)

| status | unidades |
|---|---|
| covered | 15 |
| candidate | 5 (decididos na Fase 3: 1 confirmed, 3 needs_validation, 1 rejected) |
| blocked | 2 |
| deferred / out_of_scope | 0 |

**Unidades bloqueadas.** Nelas a revisão foi parcial, e o fato que falta não é observável a partir do código.
1. **Papéis privilegiados do banco (`divat_audit_owner`, `divat_auditor`, `divat_auditor_ci`).** O que se vê no código não mostra caminho de um papel de menor confiança até um papel de auditoria. Faltam dois fatos ao vivo:
   - o `proconfig` (`search_path`) de `audit.divat_security_digest()`, cujo DDL não está versionado;
   - se PUBLIC tem `CREATE` em algum schema do `search_path` das funções *definer*.

   Para conferir, como dono, rodar somente leitura:
   ```sql
   select n.nspname, a.privilege_type from pg_namespace n, aclexplode(n.nspacl) a where a.grantee = 0 and a.privilege_type = 'CREATE';
   select p.oid::regprocedure, p.proconfig from pg_proc p where p.pronamespace = 'audit'::regnamespace;
   ```
2. **Segredos no histórico do git.** As 144 revisões alcançáveis foram varridas e não têm nenhum segredo privilegiado: só JWTs `anon` (do projeto atual e do projeto apagado) e fixtures fictícias. Mas o clone local é raso (a partir de 08/08/2026), e o projeto existe desde julho. Para conferir: rodar `gitleaks` ou `trufflehog` num clone completo, ou olhar os alertas de *secret scanning* do GitHub.

**Classes de ataque não selecionadas:** MEMORY-SAFETY-AND-BINARY. Não há código nativo, e o único parser binário (`scripts/recover_access_memos.py`) é Python. As exclusões de cada unidade, com motivo, estão no ledger.

**Como reproduzir ou continuar:** `tools/` contém o sandbox (`run_check.py`, `sandbox_inner.sh`) e os scripts do coordenador. Uma próxima run desta skill pode ler este ledger e este `findings.json` como "prior run", conforme as regras da skill: as unidades que tiverem o código alterado viram trabalho atual, e os registros `needs_validation` são revalidados.
