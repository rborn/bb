import { useState } from "react";
import { atom } from "jotai";
import { useAtom } from "jotai/react";
import { cn } from "@bb/shared-ui/lib/utils";

export const composerModeAtom = atom<ComposerMode>("agent");

export type ComposerMode = "plan" | "ask" | "agent";

const MODES: { value: ComposerMode; label: string; dot: string }[] = [
  { value: "agent", label: "Agent", dot: "bg-foreground" },
  { value: "ask", label: "Ask", dot: "bg-emerald-500" },
  { value: "plan", label: "Plan", dot: "bg-amber-500" },
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
  const [open, setOpen] = useState(false);
  const current = MODES.find((m) => m.value === value)!;
  return (
    <div className="relative">
      <button
        type="button"
        data-testid="composer-mode-picker"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-medium hover:bg-accent",
          disabled && "opacity-50 pointer-events-none"
        )}
      >
        <span className={cn("h-2 w-2 rounded-full", current.dot)} />
        {current.label}
        <span className="ml-1 text-[10px] leading-none opacity-60">▾</span>
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-50 mb-1 w-32 rounded-md border border-border bg-popover p-1 shadow-md">
          {MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => {
                onChange(m.value);
                setOpen(false);
              }}
              className={cn(
                "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-accent",
                m.value === value && "bg-accent font-semibold"
              )}
            >
              <span className={cn("h-2 w-2 rounded-full", m.dot)} />
              {m.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
