# TODO

- [ ] distro: universal build Intel→Silicon — `pnpm --filter @bb/desktop run desktop:build:both` (unsigned, dual dmg). Added scripts `desktop:build:both` / `desktop:build:universal`. Verify on arm64 target.
- [ ] composer modes: real tool gating for pi — Ask=read-only, Plan=plans/**+AGENTS.md only (enforce via bb-pi-extension activeTools filter), Agent=full. Reverted — needs proper testing, currently prompt-only Ask still edits.
- [ ] composer modes: permissionMode UI hidden — prompt-only now; re-enable readOnly/full gating + bb-pi-extension activeTools filter (Ask read-only, Plan plans/**+AGENTS.md) when proper testing lands.

- [ ] sidebar: Projects isolation — hard cwd/file sandbox originally considered (block `read`/`bash` outside `project.source.path`). **May not be needed — decided to keep filesystem open by design** (memory/session isolated, files remain loadable from anywhere). Revisit only if real leak/abuse.
- [ ] projects: git init handling for new projects (local folder `+ Add project` should detect missing git and offer `git init` / `git clone` flow). Deferred per user.

- [ ] [cowork][v1] plugin: pi slash commands in BB / menu — expose pi-native `/reload`, `/model`, `/help`, `/skills` etc. via provider-bridge autocomplete (like codex `/plan`), package as publishable plugin

- [x] [cowork][v1] composer: per-turn Plan/Ask/Agent mode switch — moved to `plugins/composer-modes` (Cursor-like left pill + per-thread localStorage + kv `composer-modes:v1` + Settings Modes & Personas). Core stub `ComposerModePicker` removed.

- [ ] [cowork][v1] thread-view: handle ponytail-mode + context-prune-stats custom events as collapsed CustomEntry row (no Working... hang) — emit outside turn or auto turn-ended, render as tiny muted row (Ponytail: ultra / cost $0.02)

- [ ] [cowork][v1] plugin: GDrive as project source (remote) — projectSource {type:"gdrive", folderId}, OAuth drive.readonly in auth.json, picker dialog, bb file list/read via drive.files.list/export on-demand (not auto-ingested to context — only @-mentioned or agent read files load)


- [x] [cowork][v1] memsearch: REMOVED 2026-09-04 — superseded by bundled `memory` plugin (FTS5, global+project scopes, contributeInstructions). Our code deleted: packages/memsearch/, server turn.submit seed, bb-pi-extension mem_save/mem_search. To migrate demo data: `bb memory add --scope project --name <n> --summary "<text>" --kind fact --importance 60`.
- [ ] [cowork][v1] watcher (single per-project chokidar): roots = [project.source.path, .bb/memsearch/**] + dynamic watched-externals.json (auto-add on first read/@ of outside absolute path or gdrive:// id used in that project, debounced 300ms, unwatch after 30d idle); one instance handles both (a) cowork proactive: *.md/*.ts change -> trigger bb automation/suggest, and (b) mems: .bb/memsearch/memories.jsonl change -> incremental re-embed; ignore node_modules/.git; gdrive externals: per-file poll via drive.changes.list(pageToken) piggy-backed on watcher tick (poll ponytail, push via drive.changes.watch webhook later when bb has public https)

- [ ] [cowork][later] plugin: mini-apps framework — dedicated BB panels/windows per-task (SEO analyzer as example), Panel tab or New Tab surface, plugin-scoped skills preloaded (e.g. seo-audit), example: SEO mini-app (URL input + web-perf/analyze_image, skill-locked, project-scoped memory)

- [ ] [cowork][v1] desktop: notifications + tray/mac menu mini-app — surface watcher/automation hits (file changed, mem re-embed) via OS notify + Tray popover, reuse for proactive cowork nudges