# Codebase Guidelines

## Task Completion

- Carry the requested change through implementation, relevant verification, and fixes for failures it causes. Continue authorized, reversible local work without asking for approval at each step; ask when a missing user decision blocks progress.
- Match verification to the change. Once relevant checks pass, broaden or repeat them only for new changes, failures, or unresolved concerns.
- Read the linked guidance when its topic applies to the task.

## Code And Contracts

- Code comments are forbidden, except for semantic tool directives and Plugin SDK declaration comments.
- When renaming a domain concept, search project-wide for stale names in variables, files, query keys, constants, tests, and docs; TypeScript only catches type references.
- Parse and validate data at system boundaries, then pass typed values internally. Restrict `unknown` and `as X` casts to genuinely unknowable boundaries and narrow immediately.
- Keep one-off types local; share types only for real cross-package contracts.
- Optional or nullable fields must represent meaningful absence. Fill defaults once at the server boundary and pass explicit values through internal routes, commands, and persisted events.
- Delete accepted-but-ignored route or command fields, or implement them end to end. Document route and command behavior when it is non-obvious.

## Server And Daemon

- The server owns product policy: defaults, instructions, manager behavior, tool lists, and thread behavior. The host daemon owns host-local primitives, provider translation, runtime/session management, and workspace execution.
- Return raw host-local data from the daemon; assemble product behavior on the server. Move responsibility across this boundary only when the change requires it.
- Increment `HOST_DAEMON_PROTOCOL_VERSION` for changes to server/daemon wire fields, including their types, requiredness, defaults, or meaning, unless compatibility with the previously shipped daemon is deliberately preserved and tested. This covers session payloads, WebSocket messages, and host RPC commands/results. Shared TypeScript builds do not verify compatibility with enrolled machines; the version bump triggers their update.

## CLI, Plugins, And Repository Skills

- When creating or modifying plugins, read `apps/server/src/services/skills/builtin-skills/bb-plugin-authoring/SKILL.md`.
- When inspecting BB state or testing via CLI, read `apps/server/src/services/skills/builtin-skills/bb-cli/SKILL.md`.
- To verify user journeys against the dev app, read `.bb/skills/verify-bb/SKILL.md`.
- To clean up AI-generated code slop before committing, read `.bb/skills/deslop/SKILL.md`.
- Never scrape or mutate React DOM nodes in plugins (`MutationObserver`, `appendChild`, `insertBefore` on app elements). The app's `foreignDomMutationGuard` detects and blocks React host node tampering to prevent fiber corruption.
- For UI customization in plugins, use sanctioned plugin slots, custom CSS properties, or data-layer interception (`window.fetch`), never DOM surgery.
- Model catalogs (`/api/v1/system/execution-options`) return a flat top-level `models` array with `routeProviderId`, not nested under `groups[].models`.
- Build official plugins with `node --conditions=source --import tsx scripts/build-official-plugins.mjs <plugin-name>`.
- Always verify plugin and UI behavior against the running dev instance (`http://127.0.0.1:14462` / `22462` via `agent-browser` or DevTools/curl), never by isolated unit-test mocking alone.
- When a plugin triggers mutations (e.g. updating a thread's model, title, or settings), a raw background `fetch('/api/v1/threads/:id', { method: 'PATCH' })` DOES NOT update the UI because TanStack Query caches thread state and will not re-render. Coordinate with app state or dispatch query invalidation events, never blind network calls.
- Never invent custom DOM events (e.g. `bb:set-model`, `bb:thread-updated`), fake window signals, or hallucinated `localStorage` keys (e.g. `bb-selected-model`). Always grep the codebase for existing keys and listeners before writing state logic.
- To update an existing thread's model from a plugin, perform the update on the server using `await bb.sdk.threads.update({ threadId, model })` and notify the client via `bb.realtime.publish("threads-changed", { id: threadId })`. The server's WebSocket message is what invalidates TanStack Query; DOM `window.dispatchEvent` is ignored.
- For new threads, the composer model preference is stored in `localStorage` under exact keys:
  - `bb.promptbox.provider`: provider id string (e.g. `"pi"`).
  - `bb.promptbox.model-${providerId}-1`: JSON-encoded model string (e.g. `JSON.stringify("cursor/auto")`).
  - `bb.promptbox.model`: fallback model string.
- New threads have no thread ID before the first turn is submitted (`scope.threadId` is undefined or local). Model and execution preferences for new threads live in client state and `localStorage`, not backend thread rows.
- When removing or changing UI badges or labels, remove them cleanly across triggers, dropdown items, tooltips, and banners. Never leave commented-out `{/* hidden */ null}` artifacts, and never wipe backend entity descriptions to mask UI labels.
- Every end-user feature must also be usable through the SDK and `bb` CLI; ship and document these surfaces with the UI.
- For changes to CLI commands/flags or user-facing configuration (env vars, `.bb/` workspace files, settings), update the discoverable surfaces listed in [docs/cli-guide-and-skill.md](docs/cli-guide-and-skill.md).
- New public plugin API members (`@get-bb/plugin-sdk/app` exports, `app.slots.*` methods, or `BbPluginApi` properties) require an `experimental_` prefix and an entry in [docs/api_to_audit.md](docs/api_to_audit.md) describing behavior and stabilization criteria. Stabilization includes the audit, a project-wide rename, and removal of the entry.
- The Plugin Guide is the only plugin API documentation. Add new surfaces to `packages/plugin-api-map/src/surfaces.ts` with their SDK symbols.

## Data Access

- Use targeted `WHERE`/`JOIN` queries instead of loading all rows and filtering in JavaScript. Add indexes only when required by the query.
- Change Drizzle schemas and regenerate migrations/snapshots; never edit snapshot JSON manually.
- Never mock the database in tests. Use `createConnection(":memory:")` and `migrate(db)`.

## UI

- Use sanctioned typography tokens instead of arbitrary `text-[Npx]` classes.
- Derive theme colors from `--canvas`/`--ink` or other derived tokens; never use achromatic `oklch(L 0 0)` literals. Mix opaque steps in `oklch` and translucent steps in `oklab`. See `apps/app/src/components/ui/theme.css` and `theme.test.ts`.
- Never use CSS `@scope`; it causes severe WebKit style-recalculation costs. Confine styles with zero-specificity `:where(<roots>)` descendant and compound selector arms, as implemented in `packages/plugin-build/src/scope-plugin-utilities.ts`.
- Use the shared persistent responsive drawer for compact slide-out menus, pickers, popovers, and dialogs. Avoid modal primitives that add `inert` or `aria-hidden` to the app root. Start the transform before heavy content; realize content after two animation frames with a timeout fallback, then retain it. Verify representative drawers in iOS Simulator Safari and test app-root and deferred-realization behavior.

## Build And Test

- Use Turbo for builds, typechecks, and tests so upstream dependencies run first: `pnpm exec turbo run <task> --filter=@bb/<pkg>`. Use the package's actual name for other scopes. Bypass orchestration only for deliberate investigation; do not invoke package scripts or raw `tsc` routinely.
- Generated modules are gitignored: `packages/templates/src/generated/`, `packages/plugin-build/src/generated/`, and `packages/plugin-sdk/bundled-types/`. Never commit them or add a `--check` mode. New generated modules need Turbo tasks with explicit inputs, outputs, and consumer dependencies.
- If a plugin cannot resolve `@get-bb/plugin-sdk`, run `pnpm exec turbo run build:types --filter=@get-bb/plugin-sdk`.
- Test plausible failure modes; avoid trivial getters/setters and framework wiring. Pipe slow test output to a file and inspect it.
- Build Vitest projects with `sharedWorkerProjects` from `vitest.shared.ts`. Node tests share workers (`isolate: false`); DOM tests and files/helpers that mutate worker-global state receive isolated workers. Restore any global state a test changes.

## Issues, Pull Requests, And Debugging

- When filing issues, follow [docs/filing-issues.md](docs/filing-issues.md): reproduce first, check for duplicates, and include versions, copy-pasteable steps, verbatim expected/actual output, commit-permalink evidence, and what you ruled out. Add evidence to an existing issue when applicable.
- Use [.github/PULL_REQUEST_TEMPLATE.md](.github/PULL_REQUEST_TEMPLATE.md): root cause, change, verification that demonstrates the fix, and `Fixes #N` when applicable.
- End every agent-created issue and PR body with `> AGENT GENERATED`.
- Ground debugging in observed state: logs, database queries, server APIs, or CLI output. For dev ports, data directories, entity IDs, and the local QA launcher, see [docs/debugging-and-qa.md](docs/debugging-and-qa.md).

## Plans
Before starting work, check `plans/` for current plan docs and follow them.
