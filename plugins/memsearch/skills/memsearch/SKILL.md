---
name: memsearch
description: Automatic project memory. Search prior project knowledge before answering, and save durable new learning through the bb memsearch CLI.
---

# Memsearch

Automatic project memory for agents. Daily Markdown files are the source of
truth (`<project>/.bb/memsearch/YYYY-MM-DD.md`); capture runs on thread idle,
recall injects at turn start. Hybrid recall: FTS first, local MiniLM embeddings
(onnxruntime-web, no native deps) when FTS finds <2 hits.

## Commands

- `bb memsearch search "<query>"` — ranked bullets (FTS, semantic fallback for paraphrases)
- `bb memsearch remember "<fact>"` — save explicitly (auto-capture usually handles it)
- `bb memsearch status` — list memory files for this project

## Rules

- Memory is **project-bound**: folder for unmanaged projects, main repo root
  for managed worktrees. Personal/global threads get no memory.
- Treat recalled facts as possibly stale; verify drift-prone facts when cheap.
- Save repo conventions, architecture, paths, quirks. Never save secrets.
