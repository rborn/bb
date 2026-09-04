# Memsearch

Automatic project memory for bb agents.

- **Truth:** `<project>/.bb/memsearch/YYYY-MM-DD.md` (human-readable, portable)
- **Capture:** `thread.idle` event → heuristic extract → append bullet
- **Recall:** `contributeInstructions` → last 15 bullets from 2 most recent files
- **Explicit:** `bb memsearch search|remember|status` + bundled skill

Roadmap: cheap-LLM verify when heuristic proves noisy; transformers.js local
embeds when FTS recall misses on real data.
