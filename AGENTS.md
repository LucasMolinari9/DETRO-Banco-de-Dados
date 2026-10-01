# AGENTS.md — Portal DIVAT

Leia `CLAUDE.md` para as regras e o contexto vigente do projeto. A entrada da
documentação é `docs/README.md`; o domínio está em `CONTEXT.md`. Esses arquivos
continuam sendo as fontes canônicas, inclusive para os agentes Codex.

## Navegar pelo código com Graft

Use `bash scripts/graft.sh` para executar a versão fixada do
[Graft](https://github.com/trailhq/Graft). O procedimento completo e o caminho
pelo celular estão em `README.md`, seção “Graft — contexto para agentes”.

1. Ao iniciar numa cópia nova, execute `bash scripts/graft.sh build` e depois
   `bash scripts/graft.sh map` para orientar a investigação.
2. Para localizar código, use `bash scripts/graft.sh ask "<pergunta ou símbolo>" --source`.
   Para todas as ocorrências, use `bash scripts/graft.sh grep "<padrão>"`.
3. Para examinar uma API, use `bash scripts/graft.sh skeleton <arquivo>`;
   para dependências, `bash scripts/graft.sh callers <símbolo>`.
4. Confirme os trechos relevantes no código antes de editar. As consultas
   atualizam o índice estrutural quando os arquivos mudam; após uma alteração
   grande, execute `bash scripts/graft.sh build` novamente.

O MCP de projeto em `.codex/config.toml` disponibiliza as mesmas operações quando
o cliente suporta servidores locais e o projeto é confiável. O launcher gera o
grafo antes de iniciar o MCP numa cópia nova. Use a CLI se o MCP não estiver disponível.

O grafo cobre JavaScript, módulos `.mjs` e Python. HTML, CSS, SQL, documentação,
diretórios ocultos e código vendorado devem ser investigados com `rg` e leitura
direta. Se Node/npm ou a rede inicial estiverem indisponíveis, prossiga com essas
ferramentas e registre a limitação. Graft auxilia a investigação; os testes e as
regras de `CLAUDE.md` continuam valendo.

Os caches `graft/` e `.graft/` não são versionados. O modo padrão é estrutural,
sem chamadas a modelos. Não execute `--deep` nem envie o histórico ao Trail sem
uma solicitação específica do dono.
