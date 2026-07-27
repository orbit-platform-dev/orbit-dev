"use client";

import * as React from "react";
import { useUser } from "@clerk/nextjs";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import * as api from "@/lib/api";
import { useCredits } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const LOW_WATER = 2;
const TIP_KEY = "orbit-credits-tip";

export function CreditsChip() {
  const { t } = useTranslation();
  const { data } = useCredits();
  const [open, setOpen] = React.useState(false);

  if (!data) return null;
  const { balance, granted, exhausted } = data;

  return (
    <div className="relative">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label={t("credits.aria", { balance, granted })}
            className={cn(
              "flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium tabular-nums transition-colors",
              exhausted
                ? "border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/15"
                : balance < LOW_WATER
                  ? "border-amber-500/40 bg-amber-500/10 text-amber-600 hover:bg-amber-500/15 dark:text-amber-400"
                  : "border-border bg-card/60 text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <Sparkles className="h-3.5 w-3.5" />
            {exhausted ? (
              <span className="hidden sm:inline">{t("credits.request")}</span>
            ) : (
              <span>{balance}</span>
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent>
          {exhausted ? t("credits.outTooltip") : t("credits.tooltip", { balance, granted })}
        </TooltipContent>
      </Tooltip>

      <CreditsTip balance={balance} granted={granted} dismissed={open} />
      <RequestCreditsDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}

function CreditsTip({
  balance,
  granted,
  dismissed,
}: {
  balance: number;
  granted: number;
  dismissed: boolean;
}) {
  const { t } = useTranslation();
  const [show, setShow] = React.useState(false);

  React.useEffect(() => {
    try {
      if (localStorage.getItem(TIP_KEY)) return;
    } catch {
      return;
    }
    const appear = setTimeout(() => setShow(true), 900); // let the page settle first
    return () => clearTimeout(appear);
  }, []);

  const close = React.useCallback(() => {
    setShow(false);
    try {
      localStorage.setItem(TIP_KEY, "1");
    } catch {}
  }, []);

  React.useEffect(() => {
    if (dismissed) close();
  }, [dismissed, close]);

  React.useEffect(() => {
    if (!show) return;
    const hide = setTimeout(close, 15_000);
    return () => clearTimeout(hide);
  }, [show, close]);

  if (!show || balance <= 0) return null;

  return (
    <div className="absolute right-0 top-full z-40 mt-2.5 w-64 animate-in fade-in slide-in-from-top-1 duration-300">
      <div className="relative rounded-xl border border-border bg-card p-3.5 shadow-xl">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <Sparkles className="h-4 w-4 text-primary" />
          {t("credits.tipTitle", { balance })}
        </div>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {t("credits.tipBody", { granted })}
        </p>
        <button onClick={close} className="mt-2 text-xs font-medium text-primary hover:underline">
          {t("credits.tipCta")}
        </button>
        {/* points up at the chip */}
        <div className="absolute -top-1.5 right-6 h-3 w-3 rotate-45 border-l border-t border-border bg-card" />
      </div>
    </div>
  );
}

export function OutOfCreditsNotice() {
  const { t } = useTranslation();
  const { data } = useCredits();
  const [open, setOpen] = React.useState(false);

  return (
    <div className="mb-2 flex items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3">
      <Sparkles className="h-4 w-4 shrink-0 text-destructive" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{t("credits.outTitle")}</p>
        <p className="text-xs text-muted-foreground">
          {t("credits.outBody", { granted: data?.granted ?? 0 })}
        </p>
      </div>
      <Button size="sm" variant="outline" className="shrink-0" onClick={() => setOpen(true)}>
        {t("credits.request")}
      </Button>
      <RequestCreditsDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}

function RequestCreditsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useTranslation();
  const { data } = useCredits();
  const { user } = useUser();
  const [busy, setBusy] = React.useState(false);
  const [sent, setSent] = React.useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await api.requestCredits({
        email: user?.primaryEmailAddress?.emailAddress,
        name: user?.fullName ?? undefined,
      });
      setSent(true);
      toast.success(t("credits.sent"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("credits.sendFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("credits.title")}</DialogTitle>
        </DialogHeader>
        <p className="-mt-1 text-sm text-muted-foreground">
          {t("credits.usage", { used: data?.used ?? 0, granted: data?.granted ?? 0 })}
        </p>
        <p className="text-sm text-muted-foreground">{t("credits.explainer")}</p>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("credits.close")}
          </Button>
          <Button onClick={submit} disabled={busy || sent}>
            {sent ? t("credits.requested") : busy ? t("credits.sending") : t("credits.request")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
