# Composer Modes & Personas

Per-turn Plan/Ask/Agent modes and custom AI personas. Strictly plugin — no core BB changes.

## Modes
- **Agent** full, **Plan** writes to `plans/*.md`, **Ask** readOnly, **Writer**, **SEO** (skills: seo-audit, ai-seo, schema)

## Usage
- Composer pill next to model picker — search, pick mode, per-thread localStorage + `setActiveMode` RPC for instruction injection.
- Settings → Modes & Personas: toggle, delete custom, New Persona, Generate with AI (prefills form).

## Agent tool
`save_composer_mode` — agent creates persona in-thread, publishes `composer-modes:changed`.

## CLI
`bb modes list [--json]`, `bb modes get <id> [--json]`, `bb modes delete <id>`

## Storage
`composer-modes:v1` kv, realtime `composer-modes:changed`, instructions via `bb.agents.contributeInstructions`.
