import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import path, { join } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { ensureVecIndex, vecSearch } from "./vec.js";

// Automatic project memory. Daily Markdown files are the source of truth
// (<project>/.bb/memsearch/YYYY-MM-DD.md); recall is FTS over recent files.
// ponytail: FTS only first, transformers.js local embeds when recall misses
// on real data. ponytail: heuristic extractor only; cheap-LLM verify when
// heuristic proves noisy.

const DIR = ".bb/memsearch";
const MAX_BULLETS = 15;
const MAX_FILES = 2;
const MAX_CANDIDATE_CHARS = 280;

// ponytail: sync recall hook needs a cached path (contributeInstructions is
// sync). Filled on every idle event + CLI call. Stale entries just miss.
const pathCache = new Map<string, string>();

export function memDir(projectPath: string): string {
  return join(projectPath, DIR);
}

export function dayFile(projectPath: string, d = new Date()): string {
  return join(memDir(projectPath), `${d.toISOString().slice(0, 10)}.md`);
}

export function ensureMemDir(projectPath: string): string {
  const dir = memDir(projectPath);
  mkdirSync(dir, { recursive: true });
  return dir;
}

const DURABLE = /(remember|don't forget|do not forget|prefer|my .{1,40} is|we use|we always|convention|i (have|own|like|use))/i;

export function extractCandidates(...texts: (string | undefined)[]): string[] {
  const out: string[] = [];
  for (const text of texts) {
    if (!text) continue;
    for (const sentence of text.split(/(?<=[.!?\n])\s+/)) {
      const s = sentence.trim().replace(/\s+/g, " ");
      if (s.length > 12 && s.length < 600 && DURABLE.test(s)) {
        out.push(s.length > MAX_CANDIDATE_CHARS ? `${s.slice(0, MAX_CANDIDATE_CHARS)}…` : s);
      }
    }
  }
  return [...new Set(out)];
}

export function appendBullets(projectPath: string, threadId: string, bullets: string[]): number {
  if (bullets.length === 0) return 0;
  ensureMemDir(projectPath);
  const time = new Date().toISOString().slice(11, 16);
  const lines = bullets.map((b) => `- [${time}] (${threadId}) ${b}`).join("\n");
  appendFileSync(dayFile(projectPath), `${lines}\n`, "utf8");
  return bullets.length;
}

export function recentBullets(projectPath: string): string[] {
  const dir = memDir(projectPath);
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
    .sort()
    .slice(-MAX_FILES);
  const bullets: string[] = [];
  for (const f of files) {
    const lines = readFileSync(join(dir, f), "utf8").split("\n");
    for (const line of lines) {
      const t = line.trim();
      if (t.startsWith("- ")) bullets.push(t);
    }
  }
  return bullets.slice(-MAX_BULLETS);
}

const STOP = new Set("a,an,the,is,are,was,were,be,been,to,of,in,on,for,with,and,or,not,no,do,does,did,i,you,it,this,that,what,how,my".split(","));

function terms(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w));
}

export function searchBullets(projectPath: string, query: string, k = 5): string[] {
  const dir = memDir(projectPath);
  if (!existsSync(dir)) return [];
  const q = new Set(terms(query));
  if (q.size === 0) return [];
  const scored: { b: string; s: number }[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".md"))) {
    for (const line of readFileSync(join(dir, f), "utf8").split("\n")) {
      const t = line.trim();
      if (!t.startsWith("- ")) continue;
      const bt = new Set(terms(t));
      let s = 0;
      for (const w of q) if (bt.has(w)) s += 1;
      if (s > 0) scored.push({ b: t, s });
    }
  }
  return scored.sort((a, b) => b.s - a.s).slice(0, k).map((x) => x.b);
}

async function resolveEnvPath(bb: BbPluginApi, environmentId: string): Promise<string | null> {
  try {
    const res = (await (bb.sdk.environments as any).get({ environmentId })) as any;
    const p: string | undefined =
      res?.path ?? res?.environment?.path ?? res?.workspace?.path ?? res?.workspacePath;
    return p ?? null;
  } catch {
    return null;
  }
}

// Bucket for a workspace dir: git worktrees resolve to the main repo root
// (git-common-dir), plain dirs (unmanaged) are their own bucket. No copies.
function bucketFor(cwd: string): string {
  try {
    const gitDir = execFileSync("git", ["rev-parse", "--git-common-dir"], { cwd, timeout: 3000, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    const abs = path.isAbsolute(gitDir) ? gitDir : path.join(cwd, gitDir);
    if (abs.endsWith(".git")) return path.dirname(abs);
  } catch { /* not a git checkout */ }
  return cwd;
}

async function resolveProjectPath(bb: BbPluginApi, projectId: string): Promise<string | null> {
  const cached = pathCache.get(projectId);
  if (cached) return cached;
  try {
    const res = (await (bb.sdk.projects as any).get({ projectId })) as any;
    const p: string | undefined = res?.project?.path ?? res?.path;
    if (p) pathCache.set(projectId, p);
    return p ?? null;
  } catch {
    return null;
  }
}

function textOf(msg: any): string | undefined {
  if (!msg) return undefined;
  if (typeof msg.text === "string") return msg.text;
  if (typeof msg.preview === "string") return msg.preview;
  const blocks = msg.content ?? msg.parts ?? [];
  if (Array.isArray(blocks)) {
    const t = blocks.map((c: any) => c?.text).filter((x: any) => typeof x === "string").join("\n");
    if (t) return t;
  }
  return undefined;
}

export function textsFromTimeline(timeline: any, role: "user" | "assistant", max = 2): string[] {
  const out: string[] = [];
  try {
    const turns = timeline?.turns ?? [];
    for (let i = turns.length - 1; i >= 0 && out.length < max; i--) {
      const msgs = turns[i]?.messages ?? turns[i]?.items ?? [];
      for (let j = msgs.length - 1; j >= 0 && out.length < max; j--) {
        if (msgs[j]?.role === role) {
          const t = textOf(msgs[j]);
          if (t) out.push(t);
        }
      }
    }
    // outline fallback: { items: [{ role, preview }] }
    if (out.length === 0) {
      const items = timeline?.items ?? timeline?.outline?.items ?? [];
      for (let i = items.length - 1; i >= 0 && out.length < max; i--) {
        if (items[i]?.role === role && typeof items[i]?.preview === "string") out.push(items[i].preview);
      }
    }
  } catch { /* fall through */ }
  return out;
}

export function userTextsFromTimeline(timeline: any, max = 2): string[] {
  return textsFromTimeline(timeline, "user", max);
}

export function userPreviewsFromOutline(outline: any, max = 3): string[] {
  const out: string[] = [];
  try {
    const items = outline?.items ?? [];
    for (let i = items.length - 1; i >= 0 && out.length < max; i--) {
      if (items[i]?.role === "user" && typeof items[i]?.preview === "string") out.push(items[i].preview);
    }
  } catch { /* fall through */ }
  return out;
}

export function buildExtractorPrompt(args: { intent?: string; candidates: string[]; recent: string[] }): string {
  const lines = [
    "You are a memory note-taker. Decide which statements are worth remembering across sessions.",
    "Durable: user facts, preferences, decisions with reasons, repo conventions, gotchas.",
    "Forgettable: chatter, one-off questions, already-saved items below.",
    "Lines prefixed USER: are user-stated facts (trust them). Lines prefixed ASSISTANT: are the assistant's own words — keep only if the user confirmed them or they restate a USER line. Never store assistant guesses (colors, names, details the user never said).",
    "Write each durable item as one line: `- <what> (<why, if known)>`. Max 8 lines.",
    "If nothing is durable, reply exactly: NONE",
  ];
  if (args.intent) lines.push(`\nThread intent: ${args.intent.slice(0, 500)}`);
  lines.push(`\nCandidate statements:\n${args.candidates.slice(0, 5).join("\n")}`);
  if (args.recent.length > 0) lines.push(`\nAlready saved (do not repeat):\n${args.recent.slice(-15).join("\n")}`);
  return lines.join("\n");
}

export function parseExtractorOutput(text: string | undefined): string[] {
  if (!text) return [];
  return text.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("- ")).map((l) => l.slice(2).trim()).filter((l) => l.length > 0 && !/^none\.?$/i.test(l)).slice(0, 8);
}

export default function plugin(bb: BbPluginApi): void {
  const log = (...a: any[]) => (bb.log as any)?.info?.(`[memsearch] ${a.map((x) => String(x)).join(" ")}`);
  bb.events.on("thread.idle", (async (...args: any[]) => {
    log("idle fired", JSON.stringify(args[0] ?? null).slice(0, 200));
    const { thread, lastAssistantText } = args[0] ?? {};
    if (thread?.title === "memsearch extractor") return; // never process our own extractor threads
    const projectId = thread?.projectId ?? thread?.project?.id;
    if (!projectId || typeof projectId !== "string") { log("skip: no projectId", thread?.id); return; }
    if (String(projectId).startsWith("proj_personal")) { log("skip: personal", thread?.id); return; }
    let projectPath = pathCache.get(projectId) ?? null;
    const environmentId = thread?.environmentId;
    if (environmentId) {
      const envPath = await resolveEnvPath(bb, String(environmentId));
      if (envPath) {
        projectPath = bucketFor(envPath);
        pathCache.set(projectId, projectPath);
      }
    }
    if (!projectPath) projectPath = await resolveProjectPath(bb, projectId);
    if (!projectPath) { log("skip: no projectPath", projectId, thread?.id); return; }
    let userTexts: string[] = [];
    try {
      const outline = await (bb.sdk.threads as any).conversationOutline({ threadId: thread.id });
      userTexts = userPreviewsFromOutline(outline, 3);
    } catch (e) { log("outline failed", thread?.id, String((e as any)?.message ?? e).slice(0, 120)); }
    if (userTexts.length === 0) {
      try {
        const timeline = await (bb.sdk.threads as any).timeline({ threadId: thread.id });
        userTexts = userTextsFromTimeline(timeline, 3);
      } catch (e) { log("timeline failed", thread?.id, String((e as any)?.message ?? e).slice(0, 120)); }
    }
    const candidates = [
      ...extractCandidates(...userTexts).map((c) => `USER: ${c}`),
      ...extractCandidates(lastAssistantText).map((c) => `ASSISTANT: ${c}`),
    ];
    if (candidates.length === 0) { log("skip: no candidates", thread?.id, `userTexts=${userTexts.length}`); return; }
    const recent = recentBullets(projectPath);
    let bullets = candidates; // v2 fallback: heuristic only
    try {
      const extracted = await runExtractor({
        projectId,
        thread,
        environmentId: thread?.environmentId,
        intent: userTexts[userTexts.length - 1],
        candidates,
        recent,
      });
      if (extracted.length > 0) bullets = extracted;
      else if (extracted.length === 0 && userTexts.length > 0) { log("skip: extractor judged nothing durable", thread?.id); return; }
    } catch (e) { log("extractor failed, heuristic fallback", thread?.id, String((e as any)?.message ?? e).slice(0, 120)); }
    const n = appendBullets(projectPath, thread.id, bullets);
    log(`saved ${n} bullets`, thread?.id, projectPath);
    // fire-and-forget: embed new bullets for semantic search (never blocks the turn)
    ensureVecIndex(projectPath, recentBullets(projectPath)).then(
      (c) => log(`vec index: ${c} bullets`, thread?.id),
      () => {},
    );
  }) as never);

  const settings = bb.settings.define({
    extractorModel: {
      type: "string",
      label: "Extractor model",
      description: "Optional provider/model override for the memory extractor (e.g. pi/muse-spark-1.2). Empty = same provider/model as the originating thread.",
      default: "",
    },
  });

  async function runExtractor(opts: {
    projectId: string;
    thread: any;
    environmentId?: string;
    intent?: string;
    candidates: string[];
    recent: string[];
  }): Promise<string[]> {
    const prompt = buildExtractorPrompt({ intent: opts.intent, candidates: opts.candidates, recent: opts.recent });
    let override = "";
    try {
      const values = await (settings as any)?.get?.();
      override = String(values?.extractorModel ?? "").trim();
    } catch { /* defaults */ }
    const [overrideProvider, ...overrideRest] = override.split("/");
    const spawnArgs: any = {
      projectId: opts.projectId,
      origin: "plugin",
      visibility: "hidden",
      title: "memsearch extractor",
      prompt,
    };
    if (overrideRest.length > 0) {
      spawnArgs.providerId = overrideProvider;
      spawnArgs.model = overrideRest.join("/");
    } else {
      if (opts.thread?.providerId) spawnArgs.providerId = opts.thread.providerId;
      if (opts.thread?.model) spawnArgs.model = opts.thread.model;
    }
    if (opts.environmentId) spawnArgs.environment = { type: "reuse", environmentId: opts.environmentId };
    const spawned = (await (bb.sdk.threads as any).spawn(spawnArgs)) as any;
    const extractorId = spawned?.threadId ?? spawned?.thread?.id ?? spawned?.id;
    if (!extractorId) { log("extractor: no id in spawn result"); return []; }
    try {
      await Promise.race([
        (bb.sdk.threads as any).wait({ threadId: extractorId }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("extractor timeout")), 120_000)),
      ]);
    } catch { /* fall through to whatever text exists */ }
    let answer: string | undefined;
    try {
      const out = await (bb.sdk.threads as any).output({ threadId: extractorId });
      answer = typeof out?.output === "string" ? out.output : undefined;
    } catch { /* fall through */ }
    if (!answer) {
      const timeline = await (bb.sdk.threads as any).timeline({ threadId: extractorId });
      answer = textsFromTimeline(timeline, "assistant", 1)[0];
    }
    try {
      await (bb.sdk.threads as any).archive({ threadId: extractorId });
    } catch { /* best effort cleanup */ }
    return parseExtractorOutput(answer);
  }

  bb.agents.contributeInstructions(({ projectId }) => {
    if (!projectId || String(projectId).startsWith("proj_personal")) return null;
    const projectPath = pathCache.get(String(projectId));
    if (!projectPath) return null;
    const bullets = recentBullets(projectPath);
    if (bullets.length === 0) return null;
    return `## Relevant memories (auto-captured project notes)\n${bullets.join("\n")}\nTreat as possibly stale; verify when cheap. If a bullet doesn't fully answer, run: bb memsearch transcript <threadId> (id in parens).`;
  });

  bb.cli.register({
    name: "memsearch",
    summary: "Search and maintain automatic project memory",
    commands: [
      { name: "search", summary: "Search project memory", usage: "bb memsearch search <query...> [--json]" },
      { name: "remember", summary: "Save a memory explicitly", usage: "bb memsearch remember <text...> [--reason TEXT] [--json]" },
      { name: "transcript", summary: "Dump a thread transcript for full-fidelity recall", usage: "bb memsearch transcript <threadId> [--limit N] [--json]" },
      { name: "backfill", summary: "Extract memories from an older thread", usage: "bb memsearch backfill <threadId> [--json]" },
      { name: "status", summary: "Show memory files for this project", usage: "bb memsearch status [--json]" },
    ],
    async run(argv, ctx) {
      const [command, ...rest] = argv;
      const wantsJson = rest.includes("--json");
      const args = rest.filter((a) => !a.startsWith("--"));
      const projectId = (ctx as any)?.projectId as string | undefined;
      if (!projectId) {
        return { exitCode: 1, stdout: "", stderr: "memsearch needs a project thread" };
      }
      const projectPath = await resolveProjectPath(bb, projectId);
      if (!projectPath) {
        return { exitCode: 1, stdout: "", stderr: "cannot resolve project path" };
      }
      const out = (obj: unknown, text: string) =>
        wantsJson
          ? { exitCode: 0, stdout: JSON.stringify(obj), stderr: "" }
          : { exitCode: 0, stdout: text, stderr: "" };
      if (command === "search") {
        const q = args.join(" ");
        const hits = searchBullets(projectPath, q, 8);
        if (hits.length < 2) {
          // FTS miss → semantic fallback (paraphrases FTS can't see).
          // Builds the index on first use so old bullets need no re-save.
          const all = recentBullets(projectPath);
          await ensureVecIndex(projectPath, all).catch(() => 0);
          const sem = await vecSearch(projectPath, q, all, 5);
          for (const s of sem) if (!hits.includes(s)) hits.push(s);
        }
        return out({ hits }, hits.length > 0 ? hits.join("\n") : "no memories found");
      }
      if (command === "backfill") {
        const targetId = args[0] ?? (ctx as any)?.threadId;
        if (!targetId) return { exitCode: 1, stdout: "", stderr: "usage: bb memsearch backfill <threadId>" };
        let userTexts: string[] = [];
        try {
          const outline = await (bb.sdk.threads as any).conversationOutline({ threadId: targetId });
          userTexts = userPreviewsFromOutline(outline, 10);
        } catch (e) {
          return { exitCode: 1, stdout: "", stderr: `cannot read thread: ${String((e as any)?.message ?? e).slice(0, 120)}` };
        }
        const candidates = extractCandidates(...userTexts);
        if (candidates.length === 0) return out({ saved: 0 }, "no durable content found");
        const recent = recentBullets(projectPath);
        let bullets = candidates;
        try {
          const extracted = await runExtractor({
            projectId, thread: { id: targetId }, intent: userTexts[userTexts.length - 1], candidates, recent,
          });
          if (extracted.length > 0) bullets = extracted;
          else return out({ saved: 0 }, "extractor judged nothing durable");
        } catch { /* keep heuristic bullets */ }
        const n = appendBullets(projectPath, targetId, bullets);
        if (n > 0) ensureVecIndex(projectPath, recentBullets(projectPath)).catch(() => {});
        return out({ saved: n }, n > 0 ? `backfilled ${n} from ${targetId}` : "nothing to save");
      }
      if (command === "remember") {
        const n = appendBullets(projectPath, (ctx as any)?.threadId ?? "cli", [args.join(" ")]);
        if (n > 0) ensureVecIndex(projectPath, recentBullets(projectPath)).catch(() => {});
        return out({ saved: n }, n > 0 ? `saved: ${args.join(" ")}` : "nothing to save");
      }
      if (command === "transcript") {
        const targetId = args[0];
        if (!targetId) return { exitCode: 1, stdout: "", stderr: "usage: bb memsearch transcript <threadId>" };
        try {
          const target = await (bb.sdk.threads as any).get({ threadId: targetId });
          const owner = target?.projectId ?? target?.project?.id;
          if (owner && owner !== projectId) {
            return { exitCode: 1, stdout: "", stderr: "transcript: thread belongs to another project" };
          }
        } catch { /* unresolvable: fall through to timeline attempt */ }
        const limIdx = rest.indexOf("--limit");
        const limit = limIdx >= 0 ? Number(rest[limIdx + 1]) || 10 : 10;
        const timeline = await (bb.sdk.threads as any).timeline({ threadId: targetId });
        const turns = (timeline?.turns ?? []).slice(-limit);
        const chunks: string[] = [];
        for (const t of turns) {
          for (const m of t?.messages ?? t?.items ?? []) {
            const text = textOf(m);
            if (text) chunks.push(`[${m?.role ?? "?"}] ${text.slice(0, 2000)}`);
          }
        }
        const body = chunks.join("\n\n").slice(0, 12000);
        return out({ threadId: targetId, transcript: body }, body || "no transcript found");
      }
      const dir = memDir(projectPath);
      const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".md")) : [];
      let vecIndexed = 0;
      try {
        const raw = readFileSync(join(dir, "vec", "index.json"), "utf8");
        vecIndexed = Object.keys(JSON.parse(raw)).length;
      } catch { /* no index yet */ }
      const summary = { files, bullets: recentBullets(projectPath).length, vecIndexed };
      const text = [
        `files: ${files.length > 0 ? files.join(", ") : "none"}`,
        `bullets: ${summary.bullets}`,
        `vecIndexed: ${vecIndexed}`,
      ].join("\n");
      return out(summary, files.length > 0 ? text : "no memory files yet");
    },
  });
}
