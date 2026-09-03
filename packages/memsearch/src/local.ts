// ponytail: per-project portable memsearch — FTS only first, vec (bge-small) when recall misses
// Source of truth: <project>/.bb/memsearch/memories.jsonl (human editable)
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export type MemoryEntry = { id: string; text: string; threadId?: string; ts: string };

const memDir = (projectPath: string) => join(projectPath, ".bb", "memsearch");
const memFile = (projectPath: string) => join(memDir(projectPath), "memories.jsonl");

export function ensureMemDir(projectPath: string) {
  if (!existsSync(memDir(projectPath))) mkdirSync(memDir(projectPath), { recursive: true });
}

export function loadMemories(projectPath: string): MemoryEntry[] {
  const f = memFile(projectPath);
  if (!existsSync(f)) return [];
  return readFileSync(f, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
}

export function insertMemory(projectPath: string, text: string, threadId?: string) {
  ensureMemDir(projectPath);
  const e: MemoryEntry = { id: Math.random().toString(36).slice(2), text, threadId, ts: new Date().toISOString() };
  const line = JSON.stringify(e) + "\n";
  writeFileSync(memFile(projectPath), (existsSync(memFile(projectPath)) ? readFileSync(memFile(projectPath),"utf8") : "") + line);
  return e;
}

// naive FTS5-like: score by term overlap + recency (ponytail: no vec yet)
export function searchMemories(projectPath: string, query: string, k = 5): MemoryEntry[] {
  const mems = loadMemories(projectPath);
  if (!mems.length || !query.trim()) return [];
  const q = query.toLowerCase().split(/\s+/).filter(Boolean);
  const scored = mems.map(m => {
    const t = m.text.toLowerCase();
    let score = 0;
    for (const w of q) if (t.includes(w)) score += 1;
    // small recency boost
    score += 0.01 * (Date.parse(m.ts) / 1e12);
    return { m, score };
  }).filter(x => x.score > 0).sort((a,b)=> b.score - a.score);
  return scored.slice(0,k).map(x=>x.m);
}

export function memoriesContext(projectPath: string, query: string, k = 5): string {
  const hits = searchMemories(projectPath, query, k);
  if (!hits.length) return "";
  return "## Relevant memories\n" + hits.map(h => `- [${h.ts.slice(0,10)}] ${h.text}`).join("\n");
}
