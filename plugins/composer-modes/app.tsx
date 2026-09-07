// @ts-nocheck
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { definePluginApp, useRealtime, useRpc, useComposerView } from "@get-bb/plugin-sdk/app";
import type { composerModesRpcContract } from "./server.js";
import type { ComposerMode } from "./types.js";

type ModesResult = { modes: ComposerMode[]; activeModeId: string };
const STORAGE_PREFIX = "composer-modes:active:";

function threadKey(): string {
  try {
    const url = window.location.pathname;
    const m = url.match(/\/threads\/([^/]+)/);
    if (m) return m[1]!;
  } catch {}
  return "global";
}
function loadLocalActive(): string | null {
  try {
    return localStorage.getItem(STORAGE_PREFIX + threadKey());
  } catch {
    return null;
  }
}
function saveLocalActive(id: string) {
  try {
    localStorage.setItem(STORAGE_PREFIX + threadKey(), id);
  } catch {}
}

const colorClass: Record<string, string> = {
  slate: "bg-slate-500",
  emerald: "bg-emerald-600",
  amber: "bg-amber-500",
  violet: "bg-violet-600",
  sky: "bg-sky-600",
  rose: "bg-rose-600",
  orange: "bg-orange-500",
};

function ModePill({ mode, active }: { mode: ComposerMode; active?: boolean }) {
  return (
    <span
      style={mode.color?.startsWith("#") ? { background: mode.color } : undefined}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-white ${mode.color?.startsWith("#") ? "" : (colorClass[mode.color] ?? "bg-slate-500")} ${active ? "ring-2 ring-offset-1 ring-slate-300" : ""}`}
      title={mode.description}
    >
      <span>{mode.icon}</span>
      <span>{mode.name}</span>
    </span>
  );
}

function ComposerModePicker() {
  const rpc = useRpc<typeof composerModesRpcContract>();
  const view = useComposerView();
  const [data, setData] = useState<ModesResult | null>(null);
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{top:number;left:number;up?:boolean}>({top:0,left:0});
  const pickerRef = useRef<HTMLDivElement>(null);
  useEffect(()=>{ if(open && btnRef.current){
    const r=btnRef.current.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const estH = Math.min(320, Math.max(200, (pickerRef.current?.offsetHeight || 320)));
    const spaceBelow = vh - r.bottom - 8;
    const up = spaceBelow < estH && r.top > spaceBelow;
    const top = up ? Math.max(8, r.top - estH - 8) : r.bottom + 8;
    const left = Math.min(Math.max(8, r.left), vw - 288 - 8);
    setPos({top,left,up});
    // re-measure after render for accurate height
    requestAnimationFrame(()=>{
      if(pickerRef.current){
        const h = pickerRef.current.offsetHeight;
        const up2 = (vh - r.bottom - 8) < h && r.top > (vh - r.bottom - 8);
        const top2 = up2 ? Math.max(8, r.top - h - 8) : r.bottom + 8;
        if(top2 !== top) setPos({top:top2,left,up:up2});
      }
    });
  } },[open]);

  const load = useCallback(async () => {
    try {
      const res = await rpc.call("getModes", null);
      setData(res);
    } catch {}
  }, [rpc]);

  useEffect(() => {
    void load();
  }, [load]);

  useRealtime("composer-modes:changed", () => void load());

  const activeId = data?.activeModeId ?? "agent";
  const activeMode = data?.modes.find((m) => m.id === activeId) ?? data?.modes[0] ?? null;
  // legacy per-thread override retained for migration but global active is now authoritative so Settings Active syncs immediately
  void loadLocalActive;

  const filtered = useMemo(() => data?.modes.filter((m) => m.isEnabled) ?? [], [data]);

  const builtins = filtered.filter((m) => m.isBuiltin);
  const customs = filtered.filter((m) => !m.isBuiltin);

  const [pendingSwitch, setPendingSwitch] = useState<{
    modeId: string;
    targetModel: string;
    targetModelLabel: string;
    currentModelLabel: string;
  } | null>(null);

  const executeSwitch = useCallback(
    async (id: string, switchModel: boolean) => {
      setPendingSwitch(null);
      saveLocalActive(id);
      try {
        const tid = (view as any)?.scope?.threadId as string | undefined;
        const m = data?.modes.find((x) => x.id === id) as any;
        const pref = m?.preferredModel;

        if (switchModel && pref?.model) {
          const modelString =
            pref.routeProviderId && !pref.model.includes("/")
              ? `${pref.routeProviderId}/${pref.model}`
              : pref.model;
          const searchPart = (pref.model.split("/").pop() || pref.model).toLowerCase();

          try {
            localStorage.setItem("bb.promptbox.provider", "pi");
            localStorage.setItem("bb.promptbox.model-pi-1", modelString);
            localStorage.setItem("bb.promptbox.model", modelString);
            window.dispatchEvent(
              new StorageEvent("storage", {
                key: "bb.promptbox.model-pi-1",
                newValue: modelString,
                storageArea: localStorage,
              }),
            );
            window.dispatchEvent(
              new StorageEvent("storage", {
                key: "bb.promptbox.provider",
                newValue: "pi",
                storageArea: localStorage,
              }),
            );
            window.dispatchEvent(
              new CustomEvent("bb:select-model", {
                detail: { model: modelString },
              }),
            );
          } catch {}
        }
        await rpc.call("setActiveMode", tid ? { id, threadId: tid } : { id });
      } catch {}
      setOpen(false);
      void load();
    },
    [rpc, load, data, view],
  );

  const selectMode = useCallback(
    (id: string) => {
      const m = data?.modes.find((x) => x.id === id) as any;
      const pref = m?.preferredModel;

      if (pref?.model) {
        const root =
          btnRef.current?.closest("form") ||
          btnRef.current?.closest("[data-app-composer]") ||
          document;
        const btns = Array.from(root.querySelectorAll("button"));
        const modelBtn = btns.find(
          (b) =>
            b !== btnRef.current &&
            b.textContent &&
            (b.textContent.includes("Low") ||
              b.textContent.includes("Medium") ||
              b.textContent.includes("High") ||
              b.textContent.includes("None") ||
              b.textContent.includes("Max") ||
              b.textContent.includes("Extra High")),
        );

        const rawLabel = modelBtn
          ? (modelBtn.innerText || modelBtn.textContent || "")
          : localStorage.getItem("bb.promptbox.model") || "Current Model";
        const currentModelLabel = rawLabel
          .split(/[\n\r]+/)[0]
          ?.replace(/(None|Low|Medium|High|Extra High|Max|xhigh|ultracode)$/i, "")
          .trim() || "Current Model";
        const searchPart = (pref.model.split("/").pop() || pref.model).toLowerCase();
        const targetModelLabel = pref.model
          .split("/")
          .pop()
          ?.split("-")
          .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(" ") || pref.model;

        // If the model is different, prompt for cache-invalidation confirmation
        if (currentModelLabel && !currentModelLabel.toLowerCase().includes(searchPart)) {
          setOpen(false);
          setPendingSwitch({
            modeId: id,
            targetModel: pref.model,
            targetModelLabel,
            currentModelLabel,
          });
          return;
        }
      }

      // No model change or already matching: switch immediately
      void executeSwitch(id, true);
    },
    [data, executeSwitch],
  );

  if (!data || !activeMode) {
    return (
      <button type="button" className="rounded-full border border-border px-2 py-1 text-xs text-muted-foreground" onClick={() => void load()}>
        Modes…
      </button>
    );
  }

  return (
    <div className="relative">
      <button ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1 text-xs font-medium hover:bg-muted transition-colors"
        aria-expanded={open}
        title={activeMode.description}
      >
        <span>{activeMode.icon}</span>
        <span>{activeMode.name}</span>
      </button>
      {open ? createPortal((
        <>
          <div className="fixed inset-0 z-40" onClick={()=>setOpen(false)} />
          <div ref={pickerRef} style={{top:pos.top,left:pos.left}} className="fixed z-50 w-80 rounded-xl border border-border bg-popover p-2.5 shadow-xl">
          <div className="max-h-80 overflow-auto text-xs space-y-0.5">
            {builtins.length ? <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Built-in</div> : null}
            {builtins.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => void selectMode(m.id)}
                className={`flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-muted transition-colors ${m.id === activeId ? "bg-muted" : ""}`}
              >
                <span className="text-sm mt-0.5">{m.icon}</span>
                <span className="flex-1 leading-snug">
                  <span className="font-medium text-foreground">{m.name}</span>
                  <span className="ml-1.5 text-muted-foreground">— {m.description}</span>
                </span>
              </button>
            ))}
            {customs.length ? <div className="mt-2.5 pt-2 border-t border-border/60 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Custom Personas</div> : null}
            {customs.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => void selectMode(m.id)}
                className={`flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-muted transition-colors ${m.id === activeId ? "bg-muted" : ""}`}
              >
                <span className="text-sm mt-0.5">{m.icon}</span>
                <span className="flex-1 leading-snug">
                  <span className="font-medium text-foreground">{m.name}</span>
                  <span className="ml-1.5 text-muted-foreground">— {m.description}</span>
                </span>
              </button>
            ))}

          </div>
          <div className="mt-2.5 border-t border-border pt-2">
            <a href="#settings" onClick={() => setOpen(false)} className="block rounded-md px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
              Configure personas in Settings →
            </a>
          </div>

          </div>
        </>
      ), document.body) : null}

      {pendingSwitch ? createPortal((
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs" onClick={() => setPendingSwitch(null)}>
          <div
            className="w-full max-w-md rounded-2xl border border-border bg-popover p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-base font-semibold text-foreground">
              Switch model to {pendingSwitch.targetModelLabel}?
            </div>
            <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">
              This persona recommends <strong className="text-foreground font-semibold">{pendingSwitch.targetModelLabel}</strong>, but this thread is currently using <strong className="text-foreground font-semibold">{pendingSwitch.currentModelLabel}</strong>. Switching models resets prompt caching for this thread, so previous turns will be processed as new input tokens.
            </p>
            <div className="mt-6 flex flex-col gap-2.5">
              <button
                type="button"
                onClick={() => void executeSwitch(pendingSwitch.modeId, true)}
                className="w-full rounded-lg bg-primary py-2.5 px-4 text-xs font-medium text-primary-foreground hover:opacity-90 transition-opacity shadow-xs"
              >
                Switch to {pendingSwitch.targetModelLabel} &amp; Reset Cache
              </button>
              <button
                type="button"
                onClick={() => void executeSwitch(pendingSwitch.modeId, false)}
                className="w-full rounded-lg border border-border bg-background py-2.5 px-4 text-xs font-medium text-foreground hover:bg-muted transition-colors"
              >
                Keep {pendingSwitch.currentModelLabel} (Preserve Cache)
              </button>
              <button
                type="button"
                onClick={() => setPendingSwitch(null)}
                className="w-full py-1.5 text-center text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ), document.body) : null}
    </div>
  );
}


const STATIC_PI_SKILLS: string[] = ["ab-testing", "accessibility-review", "ad-creative", "ads", "agent-browser", "agents-sdk", "ai-seo", "analytics", "aso", "attribution", "bb-cli", "bb-plugin-authoring", "churn-prevention", "claude-handoff", "cloudflare", "cloudflare-email-service", "cloudflare-one", "cloudflare-one-migrations", "co-marketing", "codebase-design", "cold-email", "community-marketing", "competitor-profiling", "competitors", "composio", "content-strategy", "copy-editing", "copywriting", "create-verification-skill", "cro", "customer-research", "deslop", "diagnosing-bugs", "directory-submissions", "domain-modeling", "durable-objects", "emails", "free-tools", "git-guardrails-claude-code", "grill-me", "grill-with-docs", "grilling", "handoff", "image", "implement", "improve-codebase-architecture", "influencer-marketing", "launch", "lead-magnets", "loop-me", "maintain-verification-skill", "make-interfaces-feel-better", "marketing-council", "marketing-ideas", "marketing-loops", "marketing-plan", "marketing-psychology", "offers", "onboarding", "payload", "paywalls", "plugin-guide-maintenance", "popups", "pricing", "product-marketing", "programmatic-seo", "prospecting", "prototype", "public-relations", "referrals", "research", "resolving-merge-conflicts", "revops", "sales-enablement", "sandbox-migrate-to-next", "sandbox-next", "sandbox-stable", "schema", "seo-audit", "signup", "site-architecture", "skill-creator", "sms", "social", "submit-a-plugin", "tdd", "teach", "to-questionnaire", "to-spec", "to-tickets", "triage", "turnstile-spin", "verify-bb", "video", "wait-what", "wayfinder", "web-perf", "wizard", "workers-best-practices", "wrangler", "writing-for-agents"];
function useAvailableSkills(): string[] {
  const [skills, setSkills] = useState<string[]>(STATIC_PI_SKILLS);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pr = await fetch("/api/v1/projects?perPage=20", { credentials: "same-origin" });
        if (!pr.ok) return;
        const pj = await pr.json();
        const pid = pj.projects?.[0]?.id ?? pj.data?.[0]?.id;
        if (!pid) return;
        const sr = await fetch(`/api/v1/projects/${pid}/skills`, { credentials: "same-origin" });
        if (!sr.ok) return;
        const sj = await sr.json();
        const list: string[] = (sj.skills ?? []).map((s: any) => s.name).filter(Boolean);
        const uniq = [...new Set([...STATIC_PI_SKILLS, ...list])].sort();
        if (!cancelled && uniq.length) setSkills(uniq);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, []);
  return skills;
}
function useAvailableModels(): { models: { model: string; label: string; provider: string; routeProviderId?: string }[]; loading: boolean } {
  const [models, setModels] = useState<{ model: string; label: string; provider: string; routeProviderId?: string }[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(()=>{ let c=false; (async()=>{ try{
    const r = await fetch("/api/v1/system/execution-options", { credentials: "same-origin" });
    if(!r.ok) return;
    const j = await r.json();
    const list: any[] = j.models ?? [];
    const mapped = list.map((m:any)=>({ model: m.model, label: m.displayName || m.model, provider: m.id?.split?.("/")?.[0] ?? m.routeProviderId ?? "", routeProviderId: m.routeProviderId }));
    if(!c) setModels(mapped);
  }catch{} finally{ if(!c) setLoading(false); } })(); return ()=>{c=true}; },[]);
  return { models, loading };
}
function SkillsPillsInput({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const available = useAvailableSkills();
  const [filter, setFilter] = useState("");
  const opts = available.filter(s => !value.includes(s) && s.toLowerCase().includes(filter.toLowerCase())).slice(0, 100);
  return (
    <div className="space-y-1.5">
      <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1.5">
        {value.length === 0 ? <span className="text-xs text-muted-foreground">No skills selected</span> : value.map(s => (
          <span key={s} className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs">
            {s}<button type="button" onClick={() => onChange(value.filter(x => x !== s))} className="ml-1 rounded-full hover:bg-muted px-0.5 leading-none">×</button>
          </span>
        ))}
        <input value={filter} onChange={e=>setFilter(e.target.value)} placeholder={value.length? "add…" : "Select skills…"} className="min-w-[80px] flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
      </div>
      {filter || opts.length ? (
        <div className="max-h-48 overflow-auto rounded-md border border-border bg-popover p-1 shadow-sm">
          {opts.length ? opts.map(o => (
            <button key={o} type="button" onClick={()=>{ onChange([...value, o]); setFilter(""); }} className="block w-full rounded px-2 py-1 text-left text-xs hover:bg-muted">{o}</button>
          )) : <div className="px-2 py-1 text-xs text-muted-foreground">No match in installed PI skills</div>}
        </div>
      ) : null}
    </div>
  );
}

function SettingsSection() {
  const rpc = useRpc<typeof composerModesRpcContract>();
  const [data, setData] = useState<ModesResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [form, setForm] = useState<Partial<ComposerMode>>({
    id: "",
    name: "",
    icon: "🎨",
    color: "violet",
    description: "",
    promptPrefix: "",
    permissionMode: "full",
    skills: [],
    preferredModel: null,
  } as any);
  const { models: availableModels, loading: modelsLoading } = useAvailableModels();

  const load = useCallback(async () => {
    try {
      const res = await rpc.call("getModes", null);
      setData(res);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [rpc]);

  useEffect(() => {
    void load();
  }, [load]);
  useRealtime("composer-modes:changed", () => void load());

  const save = async () => {
    if (!form.id || !form.name) {
      setError("ID and Name required");
      return;
    }
    { const ids=new Set((data?.modes ?? []).filter(m=>m.id!==form.id).map(m=>m.id.toLowerCase())); const names=new Set((data?.modes ?? []).filter(m=>m.name!==form.name).map(m=>m.name.toLowerCase())); const editing=data?.modes?.find(m=>m.id===form.id); if(!editing && ids.has(form.id!.toLowerCase())){ setError(`ID "${form.id}" already exists — pick another.`); return; } if(names.has(form.name!.toLowerCase()) && (!editing || editing.name.toLowerCase()!==form.name!.toLowerCase())){ setError(`Name "${form.name}" already exists — pick another.`); return; } }
    try {
      await rpc.call("saveMode", {
        id: form.id!,
        name: form.name!,
        icon: form.icon ?? "🎨",
        color: (form.color as ComposerMode["color"]) ?? "violet",
        description: form.description ?? "",
        promptPrefix: form.promptPrefix ?? "",
        permissionMode: (form.permissionMode as "full" | "readOnly") ?? "full",
        skills: form.skills ?? [],
        preferredModel: (form as any).preferredModel ?? null,
        isEnabled: true,
      } as any);
      setShowNew(false);
      setForm({ id: "", name: "", icon: "🎨", color: "violet", description: "", promptPrefix: "", permissionMode: "full", skills: [], preferredModel: null } as any);
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const generate = () => {
    if (!aiPrompt.trim()) return;
    setGenerating(true);
    let slug = aiPrompt.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "custom-persona";
    const existingIds = new Set((data?.modes ?? []).map((m) => m.id.toLowerCase()));
    const existingNames = new Set((data?.modes ?? []).map((m) => m.name.toLowerCase()));
    let n = 1; const base = slug; while (existingIds.has(slug.toLowerCase())) slug = `${base}-${n++}`;
    let name = aiPrompt
      .split(/[^a-zA-Z0-9]+/)
      .filter(Boolean)
      .slice(0, 4)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ") || "Custom Persona";
    { let nn=1; const nb=name; while(existingNames.has(name.toLowerCase())) name=`${nb} ${nn++}`; }
    setForm({
      id: slug,
      name: name || "Custom Persona",
      icon: "✨",
      color: "violet",
      description: aiPrompt.slice(0, 180),
      promptPrefix: `You are ${aiPrompt}. Follow best practices, be concise, and produce high-quality output for this persona.`,
      permissionMode: "full",
      skills: [],
      preferredModel: null,
    } as any);
    setShowNew(true);
    setGenerating(false);
  };

  if (!data) return <p className="text-sm text-muted-foreground">Loading modes…</p>;

  return (
    <div className="space-y-4">
      {error ? <p className="rounded bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p> : null}
      <div className="flex gap-2">
        <input
          placeholder="Describe persona e.g. 'Security auditor OWASP'"
          value={aiPrompt}
          onChange={(e) => setAiPrompt(e.target.value)}
          className="flex-1 rounded-md border border-input px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={generate}
          disabled={generating || !aiPrompt.trim()}
          className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          From prompt
        </button>
        <button type="button" onClick={() => setShowNew((v) => !v)} className="rounded-md border border-border px-3 py-2 text-sm">
          {showNew ? "Cancel" : "New Persona"}
        </button>
      </div>

      {showNew ? (
        <div className="rounded-md border border-border p-3 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs">Name<input value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value, id: form.id || e.target.value.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") })} className="mt-1 w-full rounded border border-input px-2 py-1.5 text-sm" /></label>
            <label className="text-xs">ID<input value={form.id ?? ""} onChange={(e) => setForm({ ...form, id: e.target.value })} className="mt-1 w-full rounded border border-input px-2 py-1.5 text-sm" placeholder="tailwind-designer" /></label>
            <label className="text-xs">Icon<input value={form.icon ?? ""} onChange={(e) => setForm({ ...form, icon: e.target.value })} className="mt-1 w-full rounded border border-input px-2 py-1.5 text-sm" /></label>
            <label className="text-xs flex items-center gap-2">Color <span className="inline-block h-2.5 w-2.5 rounded-full border" style={{ background: (form.color?.startsWith("#") ? form.color : ({slate:"#64748b",emerald:"#10b981",amber:"#f59e0b",violet:"#8b5cf6",sky:"#0ea5e9",rose:"#f43f5e",orange:"#f97316"} as Record<string,string>)[form.color ?? "violet"] ?? "#64748b") }} /> <span className="font-mono text-[11px]">{form.color}</span>
              <input type="color" value={form.color?.startsWith("#") ? form.color : ({slate:"#64748b",emerald:"#10b981",amber:"#f59e0b",violet:"#8b5cf6",sky:"#0ea5e9",rose:"#f43f5e",orange:"#f97316"} as Record<string,string>)[form.color ?? "violet"] ?? "#8b5cf6"} onChange={(e)=>setForm({...form, color: e.target.value})} className="ml-auto h-8 w-10 rounded border border-input p-1" />
            </label>
          </div>
          <label className="block text-xs">Description<input value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={200} className="mt-1 w-full rounded border border-input px-2 py-1.5 text-sm" /></label>
          <label className="block text-xs">System prompt <span className={`ml-1 text-[11px] ${(form.promptPrefix?.length ?? 0) > 4096 ? "text-destructive font-medium" : "text-muted-foreground"}`}>{form.promptPrefix?.length ?? 0}/4096</span><textarea value={form.promptPrefix ?? ""} onChange={(e) => setForm({ ...form, promptPrefix: e.target.value.slice(0, 4096) })} maxLength={4096} rows={4} className="mt-1 w-full rounded border border-input px-2 py-1.5 text-sm" /></label>
          <label className="block text-xs">Preferred model <span className="font-normal text-muted-foreground">— same list thread sees</span>
            <select
              value={(form as any).preferredModel ? `${(form as any).preferredModel.routeProviderId ?? ""}:${(form as any).preferredModel.model}` : ""}
              onChange={(e)=>{
                const v=e.target.value;
                if(!v) setForm({...form, preferredModel: null} as any);
                else {
                  const idx=v.lastIndexOf(":");
                  const rp=v.slice(0,idx) || undefined;
                  const m=v.slice(idx+1);
                  setForm({...form, preferredModel:{ model:m, ...(rp?{routeProviderId:rp}:{}) } } as any);
                }
              }}
              className="mt-1 w-full rounded border border-input bg-background px-2 py-1.5 text-sm"
            >
              <option value="">No preference — use thread default</option>
              {modelsLoading ? <option disabled>Loading models…</option> : null}
              {availableModels.map(mm=>(
                <option key={`${mm.routeProviderId ?? ""}:${mm.model}`} value={`${mm.routeProviderId ?? ""}:${mm.model}`}>{mm.label} {mm.routeProviderId ? `(${mm.routeProviderId})` : ""} — {mm.model}</option>
              ))}
            </select>
          </label>
          <label className="block text-xs">Skills (installed PI only)
            <div className="mt-1"><SkillsPillsInput value={form.skills ?? []} onChange={(v)=>setForm({ ...form, skills: v })} /></div>
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowNew(false)} className="rounded-md border px-3 py-1.5 text-sm">Cancel</button>
            <button type="button" onClick={() => void save()} className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground">Save Persona</button>
          </div>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full table-fixed text-sm">
          <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
            <tr><th className="px-3 py-2">Mode</th><th className="w-20 px-3 py-2">Active</th><th className="w-24 px-3 py-2">Enabled</th><th className="w-28 px-3 py-2 text-right">Actions</th></tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data.modes.map((m) => (
              <tr key={m.id} className={data.activeModeId === m.id ? "bg-muted/30" : ""}>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2"><ModePill mode={m} /><span className={`ml-1 text-[10px] ${m.isBuiltin ? "text-muted-foreground" : "text-violet-600"}`}>{m.isBuiltin ? "builtin" : "custom"}</span>{data.activeModeId === m.id ? <span className="rounded bg-primary px-1.5 py-0.5 text-[10px] text-primary-foreground">active</span> : null}</div>
                  <div className="mt-1 text-xs text-muted-foreground line-clamp-2">{m.description}</div>
                </td>
                <td className="px-3 py-2">
                  <input type="radio" name="activeMode" checked={data.activeModeId === m.id} onChange={() => void rpc.call("setActiveMode", { id: m.id }).then(() => void load()).catch((err) => setError(String(err)))} className="h-4 w-4" />
                </td>
                <td className="px-3 py-2">
                  <label className="inline-flex items-center cursor-pointer">
                    <input type="checkbox" checked={m.isEnabled} onChange={(e) => { const v = e.target.checked; setData((prev) => prev ? { ...prev, modes: prev.modes.map((x) => x.id === m.id ? { ...x, isEnabled: v } : x) } : prev); void rpc.call("toggleMode", { id: m.id, isEnabled: v }).then(() => void load()).catch((err) => setError(String(err))); }} className="sr-only peer" />
                    <div className="h-5 w-9 rounded-full bg-muted peer-checked:bg-primary relative after:absolute after:top-0.5 after:left-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-all peer-checked:after:translate-x-4" />
                  </label>
                </td>
                <td className="px-3 py-2 text-right">
                  {!m.isBuiltin ? (
                    <button type="button" onClick={() => { if (confirm(`Delete ${m.name}?`)) void rpc.call("deleteMode", { id: m.id }).then(() => void load()).catch((e) => setError(String(e))); }} className="text-xs text-destructive hover:underline">Delete</button>
                  ) : (
                    <button type="button" onClick={() => { setForm({ ...m }); setShowNew(true); }} className="text-xs text-muted-foreground hover:underline">Edit</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">Active = default mode for new threads / instruction injection. Enabled = shown in composer left pill menu (toggle off hides it).</p>
    </div>
  );
}

export default definePluginApp((app) => {
  app.composer.customize({
    id: "mode-picker",
    actions: [{ id: "mode-picker", component: ComposerModePicker }],
  });
  app.slots.settingsSection({
    id: "modes",
    title: "Modes & Personas",
    description: "Per-turn Plan/Ask/Agent modes and custom AI personas.",
    component: SettingsSection,
  });
});
