# Retomada da run-1 (pausada em 13/10/2026)

> **Histórico:** a run foi retomada e **concluída em 13/10/2026** — este roteiro registra só como a pausa foi tratada.

**Por que pausou:** o dono pediu para pausar com 77% do limite de uso consumido. Nada foi perdido do que
terminou: tudo o que está no `coverage-ledger.json` como `covered`/`candidate`/`blocked` tem evidência
salva aqui.

## Onde parou
- **Fase 1 (reconhecimento):** concluída — `architecture.md` + ledger com 21 unidades.
- **Fase 2 (caçadores):** 14 de 21 unidades fechadas por 8 caçadores. **7 unidades voltaram para `planned`**
  (caçadores parados a pedido): filtros PostgREST + custo de consulta (2), insumos de supply chain + hooks (2),
  segredos/histórico git + "obvious things" (2), wildcard (1).
- Ainda não rodaram: crítico pós-onda, crítico final, Fases 3–6.

## Candidatos aguardando verificação independente (Fase 3)
Arquivos em `parent/candidates/`. Nenhum é achado confirmado até passar pela Fase 3.

## Passos para retomar (na ordem da skill)
1. Recriar o ambiente: clonar `cloudflare/security-audit-skill` no commit `c1c8a8c1471069fb0e188eeaff69b8e8db6564a8`;
   copiar `tools/` deste diretório para o scratchpad; gravar `tools/out_root` (diretório da run) e
   `tools/skill_dir`; restaurar a run a partir desta pasta (ledger, metadata, architecture, parent/, artifacts).
2. Re-testar o sandbox (`run_check.py` com o probe de escrita/rede) — ele depende de namespaces + cgroups.
3. Caçadores novos (IDs nunca usados, ex. `h21…`) para as 7 unidades `planned`, em lotes de até 4,
   checkpoint no git ao fim de cada lote.
4. Crítico de cobertura pós-onda, recebendo também `parent/uncovered.json` (4 lacunas sugeridas pelos caçadores).
5. Crítico final ("final-clean").
6. Fase 3: um verificador novo por candidato; Fase 4: `findings.json` + os dois validadores;
   Fase 5: verificador novo por registro; Fase 6: `REPORT.md`, `FINDINGS-DETAIL.md`, `NEEDS-VALIDATION.md`.

**Custo estimado da retomada:** ~4 caçadores para as 7 unidades + 2 críticos + ~2 verificadores por candidato
(hoje 4 candidatos ⇒ ~8) ⇒ ~14 agentes de ~200–250 mil tokens cada.
