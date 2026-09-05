export function buildFuzzyRegex(query: string): RegExp {
  const pattern = query
    .split("")
    .map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(pattern, "i");
}

export function fuzzyFilter<T>(
  options: readonly T[],
  normalizedQuery: string,
  getText: (option: T) => string,
): readonly T[] {
  if (!normalizedQuery) return options;
  const regex = buildFuzzyRegex(normalizedQuery);
  return options.filter((option) => regex.test(getText(option)));
}
