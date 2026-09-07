# Implementation Plan: Composer Modes & AI Personas Plugin (`composer-modes`)

## Summary
Build a self-contained BB plugin (`plugins/composer-modes`) that provides:
1. **Cursor-like Modes**: Built-in **Agent** (full coding), **Plan** (read-only except `plans/<name>.md` and `AGENTS.md`), and **Ask** (strict read-only Q&A).
2. **Custom Personas**: User-defined and AI-defined roles (e.g. *Writer*, *SEO Specialist*, *Tailwind Designer*, *Security Auditor*) with custom prompt instructions, tool permissions, and skill bindings.
3. **In-Thread AI Persona Creation**: Native agent tool (`save_composer_mode`) so agents can create, refine, and save personas directly during a chat session upon user request.
4. **Settings Management & AI Generator**: A dedicated section in **Settings (`⌘ ,`) → Modes** to create, edit, toggle, and AI-generate personas.
5. **Portability**: 100% self-contained plugin with zero core BB modifications, compatible with official upstream BB installations.

---

## Technical Context & Architectural Guardrails

### 1. The DOM Safety Guardrail
- **Rule**: Never use `MutationObserver`, `document.querySelector`, or `appendChild` to manipulate React DOM elements.
- **Why**: BB enforces `foreignDomMutationGuard.ts` in the app shell. Tampering with React host nodes causes mutations to be rejected and triggers console warnings.
- **Mechanism**: Use the Plugin SDK's official `builder.composer.customize()` slot and standard React components registered via `@get-bb/plugin-sdk/app`.

### 2. Agent Tool Registration
- Use `bb.agents.registerTool({ name: "save_composer_mode", ... })` in `server.ts`.
- Parameters must use `zod` schema (v4).
- When invoked in a thread, the tool persists the persona to `bb.storage.kv` and emits a realtime notification so the UI updates instantly.

### 3. Persistence & Realtime
- Config key: `composer-modes:v1` in `bb.storage.kv`.
- Realtime channel: `composer-modes:changed` emitted via `bb.realtime.publish()` to synchronize client state across windows.

---

## Data Schema (`types.ts`)

```ts
import { z } from "zod";

export const composerModeSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/, "ID must be lowercase alphanumeric with hyphens"),
  name: z.string().min(1).max(50),
  icon: z.string().min(1).max(30), // Emoji (e.g. "📋", "🔍", "🎨") or Lucide icon name
  color: z.enum(["slate", "emerald", "amber", "violet", "sky", "rose", "orange"]),
  description: z.string().max(200),
  promptPrefix: z.string().max(8000), // Instructions injected into the turn
  permissionMode: z.enum(["full", "readOnly"]).default("full"),
  skills: z.array(z.string()).default([]), // Recommended skills to suggest or load
  isBuiltin: z.boolean().default(false), // Built-ins cannot be deleted
  isEnabled: z.boolean().default(true),
});

export type ComposerMode = z.infer<typeof composerModeSchema>;

export const composerModesConfigSchema = z.object({
  modes: z.array(composerModeSchema),
  activeModeId: z.string().default("agent"),
});

export type ComposerModesConfig = z.infer<typeof composerModesConfigSchema>;
```

---

## Built-in Presets (`default-modes.ts`)

1. **🤖 Agent (Default)**:
   - ID: `agent`
   - Description: Full coding agent with all tools enabled.
   - Prompt: Empty (standard system prompt).
   - Permission: `full`
2. **📋 Plan**:
   - ID: `plan`
   - Description: Cursor-style planning. Writes exclusively to `plans/<name>.md` and `AGENTS.md`.
   - Prompt:
     ```
     PLAN MODE — STRICT: You are a software architect creating a plan.
     1. Write the plan to plans/<date>-<topic>.md.
     2. Do NOT edit code, run build commands, or modify files outside plans/ and AGENTS.md.
     3. Present options clearly and request explicit user consent before implementation.
     ```
   - Permission: `full` (gated by prompt and target path)
3. **🔍 Ask**:
   - ID: `ask`
   - Description: Pure codebase exploration and Q&A.
   - Prompt:
     ```
     ASK MODE — STRICT: You are an advisor answering questions.
     1. Do NOT call file modification tools (edit, write, apply_patch).
     2. Explain the architecture, trace execution flows, and present concrete solutions.
     ```
   - Permission: `readOnly` (physical tool ceiling enforced)
4. **✍️ Technical Writer**:
   - ID: `writer`
   - Description: Technical documentation, architecture guides, and user manuals.
   - Prompt:
     ```
     WRITER MODE: You are a principal technical writer. Focus on clarity, concise markdown, exact code blocks, and consistent technical terminology. Avoid fluff, filler, and unnecessary adjectives.
     ```
   - Permission: `full`
5. **🌐 SEO & AI Discoverability**:
   - ID: `seo`
   - Description: Search engine and AI answer engine optimization.
   - Prompt:
     ```
     SEO SPECIALIST: Analyze page hierarchy, structured data (JSON-LD), AI answer citations (Perplexity/ChatGPT), and content relevance. Apply high-relevance keyword architecture without keyword stuffing.
     ```
   - Skills: `["seo-audit", "ai-seo", "schema"]`
   - Permission: `full`

---

## Plugin File Structure

```
plugins/composer-modes/
├── package.json                   # Manifest with bb.server, bb.app, and metadata
├── tsconfig.json                  # Strict TypeScript configuration
├── vitest.config.ts               # Test suite runner
├── types.ts                       # Schemas and TypeScript interfaces
├── default-modes.ts               # Built-in mode definitions
├── server.ts                      # Backend factory: RPC, agent tool, CLI, storage
├── server.test.ts                 # Backend unit & RPC tests
├── app.tsx                        # Frontend: Composer dropdown pill & Settings UI
├── app.css                        # Radix popover & badge styles
├── README.md                      # Documentation & install instructions
└── references/
    └── personas.md                # Reference guide for designing personas
```

---

## Detailed Implementation Steps

### Phase 1: Package Manifest & Backend Engine (`server.ts`)

1. **Manifest (`package.json`)**:
   - Name: `bb-plugin-composer-modes`
   - Version: `0.1.0`
   - Manifest field `bb`:
     ```json
     {
       "bb": {
         "server": "./server.ts",
         "app": "./app.tsx",
         "displayName": "Composer Modes & Personas",
         "description": "Per-turn Plan/Ask/Agent modes and custom AI personas with tool permissions."
       }
     }
     ```

2. **RPC Handlers**:
   - `getModes()`: Returns all active and custom modes.
   - `saveMode(mode)`: Validates and saves custom mode; publishes `composer-modes:changed`.
   - `deleteMode({ id })`: Deletes non-builtin modes.
   - `toggleMode({ id, isEnabled })`: Enables/disables a mode.

3. **Agent Tool Registration**:
   ```ts
   bb.agents.registerTool({
     name: "save_composer_mode",
     description: "Create or update a composer mode or persona in BB. Use this whenever the user asks to create or save a new persona, role, or mode.",
     parameters: z.object({
       id: z.string().describe("Lowercase slug, e.g. 'tailwind-designer'"),
       name: z.string().describe("Display name, e.g. 'Tailwind Designer'"),
       icon: z.string().describe("Emoji or icon, e.g. '🎨'"),
       color: z.enum(["slate", "emerald", "amber", "violet", "sky", "rose", "orange"]),
       description: z.string().describe("What this persona specializes in"),
       promptPrefix: z.string().describe("The system instructions injected for this persona"),
       permissionMode: z.enum(["full", "readOnly"]).optional().default("full"),
       skills: z.array(z.string()).optional().default([]),
     }),
     async execute(params) {
       await saveModeToStorage(bb.storage.kv, params);
       bb.realtime.publish("composer-modes:changed", { id: params.id });
       return {
         content: [{
           type: "text",
           text: `Successfully created persona "${params.name}" (${params.id}). It is now available in the composer mode selector.`
         }]
       };
     }
   });
   ```

4. **CLI Commands (`bb modes`)**:
   - `bb modes list`: Prints available modes in table or JSON.
   - `bb modes get <id>`: Prints details and system prompt for a mode.
   - `bb modes delete <id>`: Removes a custom mode.

---

### Phase 2: Frontend Composer Action & Settings UI (`app.tsx`)

1. **Composer Mode Dropdown (`builder.composer.customize`)**:
   - Registered under `actions` in `builder.composer.customize({ id: "mode-picker", ... })`.
   - Renders a compact button next to the model picker displaying:
     - Active mode icon (e.g. `📋 Plan`, `🔍 Ask`, `🎨 Tailwind`).
     - Distinctive color pill (`emerald` for Ask, `amber` for Plan, `violet` for custom).
   - Clicking opens a Radix Popover with:
     - Search input to quickly filter personas.
     - Section for **Built-in Modes** (Agent, Plan, Ask).
     - Section for **Custom Personas** (Writer, SEO, Tailwind, etc.).
     - Shortcut link to **"Configure Personas in Settings →"**.
   - Selection persists per-thread using `localStorage` and synchronized React state.

2. **Prompt Injection & Permission Ceiling**:
   - When a mode is active:
     - It prepends the `promptPrefix` into the turn submission before sending.
     - If `permissionMode === "readOnly"`, sets thread submission `permissionMode: "readOnly"`.

3. **Settings Page (`builder.settings.register`)**:
   - Section Title: **Modes & Personas**
   - Renders a list of all modes with badges, descriptions, and active switches.
   - **"New Persona" Button**: Opens a modal with manual fields:
     - Name, ID, Icon, Color palette picker.
     - System prompt textarea.
     - Multi-select for installed skills (scanned from `.agents/skills` and `.bb/skills`).
     - Tool safety radio (`Full Access` vs `Read-Only`).
   - **"Generate with AI" Button**:
     - Input field: *"Describe the persona you want to create (e.g. 'Security auditor specialized in OWASP and auth tokens')".*
     - Generates the complete persona and prefills the form for user review.

---

### Phase 3: Build, Packaging & Distribution

1. **Compile**:
   ```bash
   node --conditions=source --import tsx scripts/build-official-plugins.mjs composer-modes
   ```
2. **Package**:
   Add `"composer-modes"` to `plugins.config.json` and run:
   ```bash
   pnpm run plugins:package
   ```
   Outputs `release/plugins/composer-modes.zip`.
3. **Distribution**:
   Users can install on any BB environment via:
   ```bash
   bb plugin install git:https://github.com/rborn/bb@main --subdirectory plugins/composer-modes
   ```

---

## Verification & QA Checklist

- [ ] **Compilation**: TypeScript typecheck passes cleanly with zero errors (`pnpm exec turbo run typecheck --filter=bb-plugin-composer-modes`).
- [ ] **Unit Tests**: RPC and storage tests pass (`pnpm exec turbo run test --filter=bb-plugin-composer-modes`).
- [ ] **Live UI Check**: Run dev app (`pnpm dev:desktop` or `scripts/bb-dev-app current`).
  - [ ] Dropdown appears in composer toolbar with correct badges.
  - [ ] Switching to **Ask** mode forces `readOnly` and disables file edits.
  - [ ] Switching to **Plan** mode instructs writing to `plans/`.
- [ ] **AI In-Thread Creation**:
  - [ ] Open a thread and prompt: *"Create a persona named 'Doc Writer' that writes clean markdown."*
  - [ ] Verify agent executes `save_composer_mode`.
  - [ ] Verify 'Doc Writer' immediately appears in the dropdown without app restart.
- [ ] **Settings Section**:
  - [ ] Edit persona prompt in Settings and verify changes take effect on the next turn.
  - [ ] Toggle off a persona and confirm it hides from the composer dropdown.
