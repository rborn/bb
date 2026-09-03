# TODO

- [ ] distro: universal build Intel→Silicon — `pnpm --filter @bb/desktop run desktop:build:both` (unsigned, dual dmg). Added scripts `desktop:build:both` / `desktop:build:universal`. Verify on arm64 target.

- [ ] sidebar: Projects isolation — hard cwd/file sandbox originally considered (block `read`/`bash` outside `project.source.path`). **May not be needed — decided to keep filesystem open by design** (memory/session isolated, files remain loadable from anywhere). Revisit only if real leak/abuse.
- [ ] projects: git init handling for new projects (local folder `+ Add project` should detect missing git and offer `git init` / `git clone` flow). Deferred per user.

- [ ] [cowork][v1] plugin: pi slash commands in BB / menu — expose pi-native `/reload`, `/model`, `/help`, `/skills` etc. via provider-bridge autocomplete (like codex `/plan`), package as publishable plugin

- [ ] [cowork][v1] composer: per-turn Plan/Ask/Agent mode switch (Cursor-like) — move mode from thread-level (--plan at spawn) to per-message draftModeAtom + queue permissionMode, add bb thread update --permission-mode, colored pill (Agent default/gray, Ask green/emerald, Plan yellow/amber) in thread header + composer segmented control

- [ ] [cowork][v1] thread-view: handle ponytail-mode + context-prune-stats custom events as collapsed CustomEntry row (no Working... hang) — emit outside turn or auto turn-ended, render as tiny muted row (Ponytail: ultra / cost $0.02)

- [ ] [cowork][v1] plugin: GDrive as project source (remote) — projectSource {type:"gdrive", folderId}, OAuth drive.readonly in auth.json, picker dialog, bb file list/read via drive.files.list/export on-demand (not auto-ingested to context — only @-mentioned or agent read files load)


- [ ] [cowork][v1] memsearch: portable per-project local (no cloud) — human-readable .bb/memsearch/memories.jsonl + memories.md (source of truth) + sqlite-vec/lancedb .bb/memsearch/memories.db (derived index); strict isolation per project (no global fallback, no cross-thread taint; move/delete project = move/delete memory); model: bge-small-en-v1.5 (384d, transformers.js ONNX) or nomic-embed-text v1.5 quantized (768d) local on host-daemon; hybrid FTS5 + vector search (ponytail: start FTS5 only, add embed when recall weak); TS module packages/memsearch/src/local.ts: embed(), insert(projectId), search(projectId, q, k), rebuild-from-jsonl on corruption; on-demand only (only @-mentioned or agent read files land in memory, no auto bulk ingest)
- [ ] [cowork][v1] watcher (single per-project chokidar): roots = [project.source.path, .bb/memsearch/**] + dynamic watched-externals.json (auto-add on first read/@ of outside absolute path or gdrive:// id used in that project, debounced 300ms, unwatch after 30d idle); one instance handles both (a) cowork proactive: *.md/*.ts change -> trigger bb automation/suggest, and (b) mems: .bb/memsearch/memories.jsonl change -> incremental re-embed; ignore node_modules/.git; gdrive externals: per-file poll via drive.changes.list(pageToken) piggy-backed on watcher tick (poll ponytail, push via drive.changes.watch webhook later when bb has public https)

- [ ] [cowork][later] plugin: mini-apps framework — dedicated BB panels/windows per-task (SEO analyzer as example), Panel tab or New Tab surface, plugin-scoped skills preloaded (e.g. seo-audit), example: SEO mini-app (URL input + web-perf/analyze_image, skill-locked, project-scoped memory)

- [ ] [cowork][v1] desktop: notifications + tray/mac menu mini-app — surface watcher/automation hits (file changed, mem re-embed) via OS notify + Tray popover, reuse for proactive cowork nudges