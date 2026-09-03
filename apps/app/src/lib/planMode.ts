const datePart = () => new Date().toISOString().slice(0, 10);

export function planFileNameFromPrompt(prompt: string): string {
  const slug = prompt
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .split(/\s+/)
    .slice(0, 6)
    .join("-")
    .replace(/-+/g, "-")
    .slice(0, 48) || "plan";
  return `plans/${datePart()}-${slug}.md`;
}

export const PLANS_AGENTS_SNIPPET = `## Plans
Before starting work, check \`plans/\` for current plan docs and follow them.
`;

export function ensurePlansSection(content: string): string {
  if (content.includes("## Plans")) return content;
  return content.trimEnd() + "\n\n" + PLANS_AGENTS_SNIPPET;
}
