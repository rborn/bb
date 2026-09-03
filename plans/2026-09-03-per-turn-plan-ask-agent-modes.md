# Per-turn Plan/Ask/Agent modes (Cursor-like)

## Decisions
- Mode is per-message (thread can switch turn-to-turn), not per-thread spawn (--plan)
- Colors: Agent default/gray, Ask green/emerald, Plan yellow/amber
- UI: dropdown left of Muse Spark, per-thread persistence via composerModeByThreadAtom
- Plan writes only to plans/ (read-only elsewhere); AGENTS.md auto gets ## Plans section
- Naming: plans/2026-09-03-<slug>.md (slug from prompt, 6 words max)

## TODO C
- [x] Helpers: planFileNameFromPrompt, ensurePlansSection (apps/app/src/lib/planMode.ts)
- [x] UI hint → plans/<date>-<slug>.md when in Plan + message present
- [ ] Enforcement: Plan → permission read-only except plans/ + hidden instruction (no prompt leak)
- [ ] AGENTS.md hook: after first plans/ write, ensure ## Plans snippet
- [ ] Follow-up: Ask ↔ accept-edits, Agent ↔ full already wired
