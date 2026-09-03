import { cn } from "@bb/shared-ui/lib/utils";

export type ComposerMode = "plan" | "ask" | "agent";

const MODES: { value: ComposerMode; label: string; color: string }[] = [
  { value: "agent", label: "Agent", color: "default" },
  { value: "ask", label: "Ask", color: "green" },
  { value: "plan", label: "Plan", color: "yellow" },
];

export function ComposerModePicker({
  value,
  onChange,
  disabled,
}: {
  value: ComposerMode;
  onChange: (v: ComposerMode) => void;
  disabled?: boolean;
}) {
  return (
    <div
      data-testid="composer-mode-picker"
      className={cn(
        "inline-flex items-center rounded-full border border-border bg-muted p-0.5 gap-0.5",
        disabled && "opacity-50 pointer-events-none"
      )}
    >
      {MODES.map((m) => {
        const active = m.value === value;
        return (
          <button
            key={m.value}
            type="button"
            onClick={() => onChange(m.value)}
            aria-pressed={active}
            className={cn(
              "rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
              active
                ? m.value === "plan"
                  ? "bg-amber-500 text-black"
                  : m.value === "ask"
                    ? "bg-emerald-500 text-white"
                    : "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {m.label}
          </button>
        );
      })}
    </div>
  );
}
