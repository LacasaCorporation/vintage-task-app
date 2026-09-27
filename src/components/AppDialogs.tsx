import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  HelpCircle,
  Info,
  Pencil,
  Settings2,
} from "lucide-react";
import { cn } from "@/lib/utils";

/* ────────────────────────────────────────────────────────────────────
   In-app dialog system — professional replacement for window.confirm
   and window.prompt. Fully styled, promise-based, with icons, danger
   highlighting, keyboard support (Enter / Escape) and backdrop blur.
   ──────────────────────────────────────────────────────────────────── */

export type ConfirmOptions = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  icon?: "danger" | "question" | "info";
};

export type PromptOptions = {
  title: string;
  message?: string;
  placeholder?: string;
  initial?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Field label; omit for a borderless prompt. */
  label?: string;
  required?: boolean;
  inputType?: "text" | "number";
  /** Validation: return an error string to block submit. */
  validate?: (value: string) => string | null;
};

export type PromptField = {
  key: string;
  label: string;
  placeholder?: string;
  initial?: string;
  type?: "text" | "number" | "date";
  required?: boolean;
  /** Span the full dialog width (useful in 2-column layouts). */
  full?: boolean;
  /** Overrides the field-level error message. */
  validate?: (value: string) => string | null;
};

export type PromptMultiOptions = {
  title: string;
  message?: string;
  fields: PromptField[];
  confirmLabel?: string;
  cancelLabel?: string;
  /** 1 = single column, 2 = two columns on wider screens. */
  columns?: 1 | 2;
};

type Pending =
  | { kind: "confirm"; options: ConfirmOptions; resolve: (v: boolean) => void }
  | { kind: "prompt"; options: PromptOptions; resolve: (v: string | null) => void }
  | {
      kind: "promptMulti";
      options: PromptMultiOptions;
      resolve: (v: Record<string, string> | null) => void;
    };

export type DialogsApi = {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  prompt: (options: PromptOptions) => Promise<string | null>;
  promptMulti: (options: PromptMultiOptions) => Promise<Record<string, string> | null>;
};

const DialogsContext = createContext<DialogsApi | null>(null);

/** Access confirm()/prompt()/promptMulti() anywhere in the app. */
export function useAppDialogs(): DialogsApi {
  const ctx = useContext(DialogsContext);
  if (!ctx) throw new Error("useAppDialogs must be used inside <AppDialogsProvider>");
  return ctx;
}

export function AppDialogsProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);

  const resolveCurrent = useCallback((value: unknown) => {
    const current = pendingRef.current;
    if (!current) return;
    pendingRef.current = null;
    setPending(null);
    if (current.kind === "confirm") current.resolve(value as boolean);
    else if (current.kind === "prompt") current.resolve(value as string | null);
    else current.resolve(value as Record<string, string> | null);
  }, []);

  const confirm = useCallback(
    (options: ConfirmOptions) => {
      if (pendingRef.current) resolveCurrent(pendingRef.current.kind === "confirm" ? false : null);
      return new Promise<boolean>((resolve) => {
        pendingRef.current = { kind: "confirm", options, resolve };
        setPending(pendingRef.current);
      });
    },
    [resolveCurrent],
  );

  const prompt = useCallback(
    (options: PromptOptions) => {
      if (pendingRef.current) resolveCurrent(pendingRef.current.kind === "confirm" ? false : null);
      return new Promise<string | null>((resolve) => {
        pendingRef.current = { kind: "prompt", options, resolve };
        setPending(pendingRef.current);
      });
    },
    [resolveCurrent],
  );

  const promptMulti = useCallback(
    (options: PromptMultiOptions) => {
      if (pendingRef.current) resolveCurrent(pendingRef.current.kind === "confirm" ? false : null);
      return new Promise<Record<string, string> | null>((resolve) => {
        pendingRef.current = { kind: "promptMulti", options, resolve };
        setPending(pendingRef.current);
      });
    },
    [resolveCurrent],
  );

  const api = useMemo<DialogsApi>(
    () => ({ confirm, prompt, promptMulti }),
    [confirm, prompt, promptMulti],
  );

  return (
    <DialogsContext.Provider value={api}>
      {children}
      {pending && <DialogSurface pending={pending} onClose={(v) => resolveCurrent(v)} />}
    </DialogsContext.Provider>
  );
}

/* ── Shared surface ─────────────────────────────────────────────────── */

type FieldState = { value: string; error: string | null };

function DialogSurface({
  pending,
  onClose,
}: {
  pending: Pending;
  onClose: (value: boolean | string | Record<string, string> | null) => void;
}) {
  const isPrompt = pending.kind === "prompt";
  const isMulti = pending.kind === "promptMulti";

  // Single-field prompt state
  const [value, setValue] = useState(
    pending.kind === "prompt" ? pending.options.initial ?? "" : "",
  );
  const [error, setError] = useState<string | null>(null);

  // Multi-field prompt state — initialised from field definitions.
  const fields = isMulti ? pending.options.fields : [];
  const [multi, setMulti] = useState<Record<string, FieldState>>(() =>
    Object.fromEntries(
      fields.map((f) => [f.key, { value: f.initial ?? "", error: null }]),
    ),
  );

  const inputRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  const danger = pending.kind === "confirm" && (pending.options.danger ?? false);
  const confirmLabel = (() => {
    if (pending.kind === "confirm")
      return pending.options.confirmLabel ?? (danger ? "Delete" : "Confirm");
    return pending.options.confirmLabel ?? "Save";
  })();
  const cancelLabel = pending.options.cancelLabel ?? "Cancel";

  // Autofocus: first input for prompts, confirm button for confirms.
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (isPrompt || isMulti) {
        inputRef.current?.focus();
        inputRef.current?.select();
      } else {
        confirmRef.current?.focus();
      }
    }, 20);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cancel = () =>
    onClose(
      pending.kind === "confirm" ? false : null,
    );

  const submit = () => {
    if (pending.kind === "confirm") {
      onClose(true);
      return;
    }
    if (pending.kind === "prompt") {
      const v = value.trim();
      const validationError = pending.options.validate?.(v) ?? null;
      if (validationError) return setError(validationError);
      if (pending.options.required && !v) return setError("This field is required.");
      onClose(v);
      return;
    }
    // promptMulti — validate every field, then submit.
    const next: Record<string, FieldState> = {};
    let firstInvalid: string | null = null;
    for (const f of pending.options.fields) {
      const v = (multi[f.key]?.value ?? "").trim();
      let err = f.validate?.(v) ?? null;
      if (!err && f.required && !v) err = "Required.";
      next[f.key] = { value: multi[f.key]?.value ?? "", error: err };
      if (err && !firstInvalid) firstInvalid = f.key;
    }
    setMulti(next);
    if (firstInvalid) return;
    const result: Record<string, string> = {};
    for (const f of pending.options.fields) result[f.key] = next[f.key].value;
    onClose(result);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  };

  const iconEl = (() => {
    if (isMulti) return <Settings2 className="size-4 text-primary" />;
    if (isPrompt) return <Pencil className="size-4 text-primary" />;
    if (pending.kind === "confirm") {
      const icon = pending.options.icon ?? (danger ? "danger" : "question");
      if (icon === "danger") return <AlertTriangle className="size-4 text-destructive" />;
      if (icon === "info") return <Info className="size-4 text-primary" />;
      return <HelpCircle className="size-4 text-primary" />;
    }
    return null;
  })();

  const inputCls = (invalid: boolean) =>
    cn(
      "w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none transition-shadow placeholder:text-muted-foreground/60 focus:ring-2",
      invalid ? "border-destructive focus:ring-destructive/30" : "focus:ring-primary/30",
    );

  return createPortal(
    <div
      className="fixed inset-0 z-[100] grid place-items-center bg-foreground/20 p-4 backdrop-blur-sm animate-in fade-in duration-150"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) cancel();
      }}
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={cn(
          "w-full max-w-md overflow-hidden rounded-2xl border bg-card shadow-2xl ring-1 ring-black/5 animate-in fade-in zoom-in-95 duration-150",
          danger && "border-destructive/30",
        )}
      >
        {/* accent header strip */}
        <div className={cn("h-1 w-full", danger ? "bg-destructive" : "bg-primary")} />
        <div className="p-5">
          <div className="flex items-start gap-3">
            <span
              className={cn(
                "grid size-9 shrink-0 place-items-center rounded-xl",
                danger ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary",
              )}
            >
              {iconEl}
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-[15px] font-semibold leading-snug text-foreground">
                {pending.options.title}
              </h2>
              {pending.options.message && (
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  {pending.options.message}
                </p>
              )}
            </div>
          </div>

          {/* single prompt */}
          {isPrompt && (
            <div className="mt-4">
              {pending.options.label && (
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  {pending.options.label}
                </label>
              )}
              <input
                ref={inputRef}
                type={pending.options.inputType ?? "text"}
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  if (error) setError(null);
                }}
                onKeyDown={handleKeyDown}
                placeholder={pending.options.placeholder}
                className={inputCls(error !== null)}
              />
              {error && <p className="mt-1.5 text-xs text-destructive">{error}</p>}
            </div>
          )}

          {/* multi-field prompt */}
          {isMulti && (
            <div
              className={cn(
                "mt-4 grid gap-3",
                pending.options.columns === 2 && "sm:grid-cols-2",
              )}
            >
              {fields.map((f) => (
                <div key={f.key} className={cn(f.full && "sm:col-span-2")}>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">
                    {f.label}
                    {f.required && <span className="text-destructive"> *</span>}
                  </label>
                  <input
                    ref={fields[0].key === f.key ? inputRef : undefined}
                    type={f.type ?? "text"}
                    value={multi[f.key]?.value ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      setMulti((m) => ({ ...m, [f.key]: { value: v, error: null } }));
                    }}
                    onKeyDown={handleKeyDown}
                    placeholder={f.placeholder}
                    className={inputCls(Boolean(multi[f.key]?.error))}
                  />
                  {multi[f.key]?.error && (
                    <p className="mt-1 text-xs text-destructive">{multi[f.key]!.error}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={cancel}
              className="rounded-lg border bg-background px-3.5 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              ref={confirmRef}
              onClick={submit}
              className={cn(
                "rounded-lg px-3.5 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90",
                danger ? "bg-destructive" : "bg-primary",
              )}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
