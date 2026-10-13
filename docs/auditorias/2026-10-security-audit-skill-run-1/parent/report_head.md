# Relatório de auditoria de segurança — DETRO-Banco-de-Dados (run-1)

Metodologia: skill [`cloudflare/security-audit-skill`](https://github.com/cloudflare/security-audit-skill), commit `c1c8a8c`.
Os arquivos de máquina são `findings.json` e `coverage-ledger.json`. Este texto deriva deles e não altera nenhum veredito, severidade ou bloqueio.

## 1. Escopo, perfil e como a auditoria rodou

- **Alvo:** repositório inteiro no commit `539abe2ac670cd2c36e67aa5d4578d248eb0fd9a` (branch `ccr-82845698-yw5n79`), com a árvore de trabalho limpa. O frontend, as migrações e baseline do Supabase, os 12 workflows, os scripts e testes e as ferramentas de agente (`.claude`, `.agents`, `.codex`, `.mcp.json`) entraram no escopo.
- **Perfil:** `standard`, sem orçamento fixo de agentes. É a primeira run desta skill no repositório. Revisões anteriores (Codex AUD-*, issue #121, SEC-*) serviram só de contexto, não de cobertura.
- **Execução:** só código-fonte e testes locais. Nada foi enviado ao banco Supabase, à Vercel, ao GitHub ou a qualquer endpoint publicado. Todo código do alvo rodou num sandbox imposto pelo sistema operacional, com estas restrições:
  - namespaces novos de mount, rede, pid, ipc e uts, sem rede externa (loopback isolado só quando pedido);
  - sistema de arquivos somente leitura, exceto um tmpfs de 64 MiB como área de rascunho;
  - uid 65534, sem capabilities e com `no_new_privs`;
  - ambiente vazio, com uma lista de variáveis permitidas;
  - limites de memória (2 GiB), processos (256), CPU, tamanho de arquivo e tempo.

  As evidências locais foram promovidas com verificação no-follow, só para arquivo regular com um único link e dentro de um limite de bytes. O sandbox foi testado antes do uso: escrita fora da área de rascunho e rede foram negadas; symlink, FIFO, hard link e arquivo grande foram recusados na promoção.
- **Agentes:** 45 lançados e 29 concluídos.
  - 4 de reconhecimento;
  - 25 caçadores, dos quais 13 concluíram, 8 foram derrubados pelo limite de uso da API e 4 foram parados na pausa pedida pelo dono;
  - 3 críticos de cobertura;
  - 5 verificadores da Fase 3;
  - 8 da Fase 5, dos quais 4 foram derrubados pelo limite de uso.

  Toda unidade e todo registro cujo agente caiu foram refeitos por um agente novo. Nenhuma evidência de agente interrompido entrou no ledger.
- **Cobertura:** 22 unidades. 15 estão `covered`, 5 `candidate` e 2 `blocked` (ver §7). Nenhuma ficou `deferred` ou `out_of_scope`.
- **Críticos:**
  - o crítico pós-onda 1 acrescentou 1 unidade (assinaturas Realtime anônimas), que foi caçada na onda 2;
  - o crítico pós-onda 2 e o crítico final independente não acharam lacunas.

  Com os dois críticos limpos, a regra da skill permite declarar cobertura completa *desta passada*. Isso não quer dizer que o alvo esteja esgotado. A própria skill observa que repetir runs encontra mais coisas.

## 2. Postura geral

A superfície pública (visitante anônimo → site estático → PostgREST/Realtime) está bem defendida:
- `esc()` em todos os pontos de `innerHTML`;
- CSP sem `unsafe-inline`;
- `anon` só com SELECT, com escrita bloqueada por policies RESTRICTIVE, o que foi comprovado aplicando a migração num Postgres local;
- RPCs com `SECURITY INVOKER` e `search_path` fixo.

Nenhuma falha permite a um visitante ler ou alterar algo além do catálogo público. Os riscos reais estão nos bastidores operacionais:
- credenciais de CI e de backup, quanto ao transporte e a quem consegue rodar código com elas;
- o workflow de *deploy smoke*;
- o custo do Realtime anônimo sobre o banco único.

Três desses quatro itens dependem de configurações de painel (GitHub, Vercel, Supabase) que o código não mostra, e por isso estão como `needs_validation`.
