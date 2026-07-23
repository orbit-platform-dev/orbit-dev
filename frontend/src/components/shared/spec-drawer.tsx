"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import {
  Check,
  CheckCircle2,
  Code,
  Copy,
  ExternalLink,
  FileText,
  FolderGit2,
  Hammer,
  Link2,
  MessagesSquare,
  RefreshCw,
  Scale,
  Search,
  Sparkles,
  Users,
  Wand2,
  X,
} from "lucide-react";
import { generateSpec, type GeneratedSpec } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export interface SpecSource {
  title: string;
  description?: string;
  findingId?: string;
}

// What Orbit decided the finding needs → how the drawer presents it.
const ACTION_META: Record<string, { key: string; icon: typeof FileText }> = {
  code: { key: "spec.typeCode", icon: Code },
  investigate: { key: "spec.typeInvestigate", icon: Search },
  coordinate: { key: "spec.typeCoordinate", icon: Users },
  communicate: { key: "spec.typeCommunicate", icon: MessagesSquare },
  decision: { key: "spec.typeDecision", icon: Scale },
};

// Clipboard API needs a secure context AND a focused document; a parent modal's
// focus trap can break it. Fall back to a hidden-textarea execCommand copy.
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export function SpecDrawer({
  open,
  onOpenChange,
  source,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  source: SpecSource | null;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = React.useState<"overview" | "agent">("overview");
  const [spec, setSpec] = React.useState<GeneratedSpec | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  const run = React.useCallback(async () => {
    if (!source) return;
    setLoading(true);
    setSpec(null);
    try {
      setSpec(await generateSpec({ title: source.title, description: source.description, findingId: source.findingId }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("spec.error"));
    } finally {
      setLoading(false);
    }
  }, [source, t]);

  // Generate once per open (ref-guarded) so a changing source identity can't loop.
  const openedRef = React.useRef(false);
  React.useEffect(() => {
    if (open && source && !openedRef.current) {
      openedRef.current = true;
      setTab("overview");
      run();
    } else if (!open) {
      openedRef.current = false;
    }
  }, [open, source, run]);

  const doCopy = React.useCallback(async () => {
    if (!spec) return false;
    const ok = await copyToClipboard(spec.agentSpec);
    if (!ok) toast.error(t("spec.copyFailed"));
    return ok;
  }, [spec, t]);

  const copy = async () => {
    if (await doCopy()) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const openInCursor = async () => {
    if (!(await doCopy())) return;
    try {
      window.location.href = "cursor://"; // bring Cursor forward if installed
    } catch {
      /* no-op — the spec is already on the clipboard */
    }
    toast.success(t("spec.openedCursor"));
  };


  if (!open || typeof document === "undefined") return null;

  const isCode = spec?.actionType === "code";
  const meta = spec ? ACTION_META[spec.actionType] ?? ACTION_META.coordinate : null;

  return createPortal(
    <>
      <div
        onClick={() => onOpenChange(false)}
        aria-hidden
        className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-[2px] animate-in fade-in duration-200"
      />
      <div className="fixed inset-y-0 right-0 z-[60] flex w-full max-w-xl flex-col border-l border-border bg-card shadow-2xl animate-in slide-in-from-right duration-300 ease-out">
        {/* Header */}
        <div className="flex items-start gap-3 border-b border-border p-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-violet-500 text-white shadow-sm shadow-primary/30">
            <Wand2 className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <div className="text-sm font-semibold">{t("spec.title")}</div>
              {meta && (
                <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                  <meta.icon className="h-3 w-3" /> {t(meta.key)}
                </span>
              )}
            </div>
            <div className="truncate text-xs text-muted-foreground">{source?.title}</div>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={() => onOpenChange(false)} aria-label={t("spec.close")}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-border px-3 pt-2">
          <TabButton active={tab === "overview"} onClick={() => setTab("overview")} icon={FileText}>
            {t("spec.overview")}
          </TabButton>
          <TabButton active={tab === "agent"} onClick={() => setTab("agent")} icon={Sparkles}>
            {isCode ? t("spec.agentTab") : t("spec.actionTab")}
          </TabButton>
        </div>

        {/* Content */}
        <div className="no-scrollbar flex-1 overflow-y-auto p-4">
          {loading ? (
            <SpecSkeleton label={t("spec.crafting")} />
          ) : !spec ? (
            <p className="text-sm text-muted-foreground">{t("spec.empty")}</p>
          ) : (
            <div key={tab} className="animate-in fade-in slide-in-from-bottom-1 duration-300">
              {tab === "overview" ? <Overview spec={spec} t={t} /> : <AgentSpec markdown={spec.agentSpec} isCode={isCode} t={t} />}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 border-t border-border p-3">
          <Button variant="ghost" size="sm" onClick={run} disabled={loading} className="gap-2">
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} /> {t("spec.regenerate")}
          </Button>
          <div className="ml-auto flex items-center gap-2">
            {isCode && (
              <Button variant="outline" size="sm" onClick={openInCursor} disabled={!spec} className="gap-2">
                <ExternalLink className="h-4 w-4" /> {t("spec.openCursor")}
              </Button>
            )}
            <Button size="sm" onClick={copy} disabled={!spec} className="gap-2">
              {copied ? (
                <span className="flex items-center gap-2 animate-in zoom-in-50 duration-200">
                  <Check className="h-4 w-4" /> {t("spec.copied")}
                </span>
              ) : (
                <><Copy className="h-4 w-4" /> {isCode ? t("spec.copyAgent") : t("spec.copyAction")}</>
              )}
            </Button>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}

function TabButton({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof FileText;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-t-lg border-b-2 px-3 py-2 text-sm font-medium transition-colors",
        active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {children}
    </button>
  );
}

function Overview({ spec, t }: { spec: GeneratedSpec; t: (k: string) => string }) {
  return (
    <div className="space-y-5">
      <Section icon={Link2} label={t("spec.why")}>
        <p className="text-sm leading-relaxed text-foreground/90">{spec.why || "—"}</p>
      </Section>
      <Section icon={Hammer} label={t("spec.what")}>
        <p className="text-sm leading-relaxed text-foreground/90">{spec.what || "—"}</p>
      </Section>
      <Section icon={CheckCircle2} label={t("spec.doneWhen")}>
        {spec.doneWhen.length ? (
          <ul className="space-y-2">
            {spec.doneWhen.map((d, i) => (
              <li key={i} className="flex items-start gap-2.5 text-sm text-foreground/90">
                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border border-border bg-muted/40" />
                <span className="leading-relaxed">{d}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">—</p>
        )}
      </Section>
      <Section icon={FolderGit2} label={t("spec.context")}>
        {spec.context.length ? (
          <div className="flex flex-wrap gap-1.5">
            {spec.context.map((c, i) => (
              <span
                key={i}
                className="inline-flex max-w-full items-center gap-1 truncate rounded-md border border-border bg-muted/40 px-2 py-1 font-mono text-[11px] text-muted-foreground"
              >
                {c}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">—</p>
        )}
      </Section>
    </div>
  );
}

function Section({ icon: Icon, label, children }: { icon: typeof FileText; label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      {children}
    </div>
  );
}

// Rendered (not gray-text) markdown so the agent spec reads like a real editor.
const MD: Components = {
  h1: ({ children }) => <h1 className="mb-2 mt-0 text-sm font-bold text-foreground">{children}</h1>,
  h2: ({ children }) => (
    <h2 className="mb-1.5 mt-4 text-[11px] font-semibold uppercase tracking-wider text-primary">{children}</h2>
  ),
  h3: ({ children }) => <h3 className="mb-1 mt-3 text-xs font-semibold text-foreground">{children}</h3>,
  p: ({ children }) => <p className="my-1.5 text-xs leading-relaxed text-foreground/90">{children}</p>,
  ul: ({ children }) => <ul className="my-1.5 space-y-1">{children}</ul>,
  ol: ({ children }) => <ol className="my-1.5 list-decimal space-y-1 pl-4">{children}</ol>,
  li: ({ children }) => (
    <li className="text-xs leading-relaxed text-foreground/90 marker:text-muted-foreground">{children}</li>
  ),
  code: ({ children }) => (
    <code className="rounded bg-primary/10 px-1 py-0.5 font-mono text-[11px] text-primary">{children}</code>
  ),
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">
      {children}
    </a>
  ),
  input: (props) => <input {...props} className="mr-1.5 translate-y-[1px] accent-primary" />,
};

function AgentSpec({ markdown, isCode, t }: { markdown: string; isCode: boolean; t: (k: string) => string }) {
  return (
    <div className="space-y-2.5">
      <p className="text-xs text-muted-foreground">{isCode ? t("spec.agentHint") : t("spec.actionHint")}</p>
      <div className="overflow-hidden rounded-lg border border-border">
        <div className="flex items-center gap-2 border-b border-border bg-muted/60 px-3 py-1.5">
          <FileText className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="font-mono text-[11px] text-muted-foreground">{isCode ? "spec.md" : "action.md"}</span>
          {isCode && (
            <span className="ml-auto flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
              <Sparkles className="h-3 w-3" /> {t("spec.agentReady")}
            </span>
          )}
        </div>
        <div className="bg-muted/20 p-3.5">
          <Markdown remarkPlugins={[remarkGfm]} components={MD}>
            {markdown}
          </Markdown>
        </div>
      </div>
    </div>
  );
}

function SpecSkeleton({ label }: { label: string }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Wand2 className="h-4 w-4 animate-pulse text-primary" /> {label}
      </div>
      <div className="space-y-2.5">
        {[92, 78, 85, 60].map((w, i) => (
          <div
            key={i}
            className="h-3 animate-pulse rounded bg-muted"
            style={{ width: `${w}%`, animationDelay: `${i * 120}ms` }}
          />
        ))}
      </div>
      <div className="mt-4 space-y-2.5">
        {[70, 88, 55].map((w, i) => (
          <div
            key={i}
            className="h-3 animate-pulse rounded bg-muted"
            style={{ width: `${w}%`, animationDelay: `${(i + 4) * 120}ms` }}
          />
        ))}
      </div>
    </div>
  );
}
