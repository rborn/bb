// ponytail: vec is best-effort enhancement; FTS stays primary. JSON cache, brute-force cosine.
// No native deps: transformers.js loads onnxruntime (wasm fallback); any load failure degrades to FTS.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ponytail: MiniLM over bge-small (23MB vs 130MB, same 384 dims). onnxruntime-web (wasm)
// runs on Intel dev AND both-arch distro; transformers.js/onnxruntime-node need native
// prebuilds that don't exist for darwin/x64, so they're out.
export const VEC_MODEL_DIR =
  process.env.MEMSEARCH_MODEL_DIR ?? `${process.env.HOME ?? "~"}/.bb-dev/memsearch-models/all-MiniLM-L6-v2`;
export const VEC_THRESHOLD = 0.3;
const VEC_MAX_TOKENS = 256;

export type EmbedFn = (texts: string[]) => Promise<number[][]>;

let sessionPromise: Promise<any> | null = null;
let vocabPromise: Promise<Map<string, number>> | null = null;
let vecUnavailable = false;

async function loadVocab(): Promise<Map<string, number>> {
  if (!vocabPromise) {
    vocabPromise = (async () => {
      const text = readFileSync(join(VEC_MODEL_DIR, "vocab.txt"), "utf8");
      const map = new Map<string, number>();
      text.split("\n").forEach((tok, i) => {
        if (tok) map.set(tok, i);
      });
      return map;
    })();
  }
  return vocabPromise;
}

// Minimal BERT basic+wordpiece tokenization (lowercase, strip accents, split punct, greedy longest-match).
function wordpiece(text: string, vocab: Map<string, number>): number[] {
  const unk = vocab.get("[UNK]") ?? 100;
  const clean = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/([^\p{L}\p{N} ])/gu, " $1 ")
    .split(/\s+/)
    .filter(Boolean);
  const ids: number[] = [vocab.get("[CLS]") ?? 101];
  for (const word of clean) {
    let start = 0;
    const wordIds: number[] = [];
    let ok = true;
    while (start < word.length) {
      let end = word.length;
      let found: number | undefined;
      while (start < end) {
        const sub = (start > 0 ? "##" : "") + word.slice(start, end);
        const id = vocab.get(sub);
        if (id !== undefined) {
          found = id;
          break;
        }
        end--;
      }
      if (found === undefined) {
        ok = false;
        break;
      }
      wordIds.push(found);
      start = end;
    }
    ids.push(...(ok ? wordIds : [unk]));
    if (ids.length >= VEC_MAX_TOKENS - 1) break;
  }
  ids.push(vocab.get("[SEP]") ?? 102);
  return ids.slice(0, VEC_MAX_TOKENS);
}

async function loadSession(): Promise<any> {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const ort = await import("onnxruntime-web");
      const buf = readFileSync(join(VEC_MODEL_DIR, "model_quantized.onnx"));
      return ort.InferenceSession.create(buf);
    })();
  }
  return sessionPromise;
}

export async function embedTexts(texts: string[], inject?: EmbedFn): Promise<number[][] | null> {
  if (inject) return inject(texts);
  if (vecUnavailable) return null;
  try {
    const [vocab, session] = await Promise.all([loadVocab(), loadSession()]);
    const ort = await import("onnxruntime-web");
    const out: number[][] = [];
    for (const t of texts) {
      const ids = wordpiece(t.slice(0, 1024), vocab);
      const mask = new Array(ids.length).fill(1);
      const zeros = new Array(ids.length).fill(0);
      const feeds: Record<string, any> = {
        input_ids: new ort.Tensor("int64", BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
        attention_mask: new ort.Tensor("int64", BigInt64Array.from(mask.map(BigInt)), [1, mask.length]),
      };
      if (session.inputNames.includes("token_type_ids")) {
        feeds.token_type_ids = new ort.Tensor("int64", BigInt64Array.from(zeros.map(BigInt)), [1, zeros.length]);
      }
      const res: any = await session.run(feeds);
      const hidden: number[] = Array.from(res.last_hidden_state.data);
      const dim = hidden.length / ids.length;
      const pooled = new Array(dim).fill(0);
      for (let i = 0; i < ids.length; i++) {
        for (let d = 0; d < dim; d++) pooled[d] += hidden[i * dim + d];
      }
      for (let d = 0; d < dim; d++) pooled[d] /= ids.length;
      const norm = Math.sqrt(pooled.reduce((s, x) => s + x * x, 0)) || 1;
      out.push(pooled.map((x) => x / norm));
    }
    return out;
  } catch {
    vecUnavailable = true;
    sessionPromise = null;
    vocabPromise = null;
    return null;
  }
}

export function vecHash(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}

function indexPath(projectPath: string): string {
  return join(projectPath, ".bb", "memsearch", "vec", "index.json");
}

function readIndex(projectPath: string): Record<string, number[]> {
  try {
    return JSON.parse(readFileSync(indexPath(projectPath), "utf8"));
  } catch {
    return {};
  }
}

/** Embed any new bullets, prune stale entries. Returns indexed count. Never throws. */
export async function ensureVecIndex(
  projectPath: string,
  bullets: string[],
  inject?: EmbedFn,
): Promise<number> {
  try {
    const idx = readIndex(projectPath);
    const want = new Map(bullets.map((b) => [vecHash(b), b] as const));
    let changed = false;
    for (const k of Object.keys(idx)) {
      if (!want.has(k)) {
        delete idx[k];
        changed = true;
      }
    }
    const missing = [...want.keys()].filter((k) => !idx[k]);
    if (missing.length > 0) {
      const vecs = await embedTexts(
        missing.map((k) => want.get(k)!),
        inject,
      );
      if (!vecs) return Object.keys(idx).length;
      missing.forEach((k, i) => {
        idx[k] = vecs[i];
      });
      changed = true;
    }
    if (changed) {
      mkdirSync(join(projectPath, ".bb", "memsearch", "vec"), { recursive: true });
      writeFileSync(indexPath(projectPath), JSON.stringify(idx));
    }
    return Object.keys(idx).length;
  } catch {
    return 0;
  }
}

export function cosine(a: number[], b: number[]): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s; // normalized vectors → dot product is cosine
}

/** Semantic search over indexed bullets. Empty array when the index is missing/unavailable. */
export async function vecSearch(
  projectPath: string,
  query: string,
  bullets: string[],
  k = 5,
  inject?: EmbedFn,
): Promise<string[]> {
  try {
    const idx = readIndex(projectPath);
    if (Object.keys(idx).length === 0) return [];
    const qv = await embedTexts([query], inject);
    if (!qv) return [];
    return bullets
      .map((t) => ({ t, s: idx[vecHash(t)] ? cosine(qv[0], idx[vecHash(t)]) : -1 }))
      .filter((x) => x.s > VEC_THRESHOLD)
      .sort((a, b) => b.s - a.s)
      .slice(0, k)
      .map((x) => x.t);
  } catch {
    return [];
  }
}
