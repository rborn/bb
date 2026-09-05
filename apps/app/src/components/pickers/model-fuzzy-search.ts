export function buildFuzzyRegex(query: string): RegExp {
  const pattern = query
    .split("")
    .map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(pattern, "i");
}

export function scoreFuzzyMatch(text: string, query: string): number {
  const t = text.toLowerCase();
  const q = query.toLowerCase().trim();
  if (!q) return 0;
  if (t === q) return 1000;

  const queryTerms = q.split(/\s+/).filter(Boolean);
  if (queryTerms.length > 1) {
    let allMatch = true;
    let totalScore = 0;
    for (const term of queryTerms) {
      const idx = t.indexOf(term);
      if (idx === -1) {
        allMatch = false;
        break;
      }
      totalScore += (idx === 0 ? 300 : 200) - Math.min(idx, 50);
    }
    if (allMatch) return 500 + totalScore;
  }

  const words = t.split(/[\s/._-]+/);
  for (const w of words) {
    if (w === q) return 800;
  }
  for (const w of words) {
    if (w.startsWith(q)) return 600;
  }

  const idx = t.indexOf(q);
  if (idx !== -1) {
    return 400 - Math.min(idx, 100);
  }

  let qIdx = 0;
  let score = 0;
  let lastMatch = -1;
  let consecutive = 0;
  for (let i = 0; i < t.length && qIdx < q.length; i++) {
    if (t[i] === q[qIdx]) {
      qIdx++;
      if (lastMatch === i - 1) {
        consecutive++;
        score += 20 * consecutive;
      } else {
        consecutive = 0;
        score += 5;
        if (lastMatch !== -1) {
          score -= Math.min(i - lastMatch, 20);
        }
      }
      lastMatch = i;
    }
  }

  if (qIdx === q.length && score > 0) {
    return Math.max(score, 1);
  }

  return 0;
}

export function fuzzyFilter<T>(
  options: readonly T[],
  normalizedQuery: string,
  getText: (option: T) => string,
): readonly T[] {
  const trimmed = normalizedQuery.trim();
  if (!trimmed) return options;

  const scored = options
    .map((option, index) => ({
      option,
      index,
      score: scoreFuzzyMatch(getText(option), trimmed),
    }))
    .filter((item) => item.score > 0);

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.index - b.index;
  });

  return scored.map((item) => item.option);
}
