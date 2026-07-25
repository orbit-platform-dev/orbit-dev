"use client";

import * as React from "react";
import { useAuth, useUser } from "@clerk/nextjs";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Bug, ImagePlus, Lightbulb, MessageSquare, Plus, Send, Sparkles, X } from "lucide-react";
import { submitFeedback, type FeedbackInput } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// Stores the Clerk session id that has seen the hint, so it re-appears on every
// fresh login (log out → back in = new session) but not on mere page refreshes.
const HINT_SESSION_KEY = "orbit-feedback-hint-session";
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

type Category = FeedbackInput["category"];

export function FeedbackWidget() {
  const { t } = useTranslation();
  const { user } = useUser();
  const [open, setOpen] = React.useState(false);
  const email = user?.primaryEmailAddress?.emailAddress ?? "";

  return (
    <>
      <CoachMark onOpen={() => setOpen(true)} />

      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("feedback.open")}
        title={t("feedback.open")}
        className="fixed bottom-6 right-6 z-[45] flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30 outline-none transition-all hover:scale-105 hover:shadow-primary/50 focus-visible:ring-2 focus-visible:ring-ring active:scale-95"
      >
        <Plus className="h-5 w-5" />
      </button>

      <FeedbackDialog open={open} onOpenChange={setOpen} email={email} />
    </>
  );
}

function FeedbackDialog({
  open,
  onOpenChange,
  email,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  email: string;
}) {
  const { t } = useTranslation();
  const [category, setCategory] = React.useState<Category>("bug");
  const [description, setDescription] = React.useState("");
  const [image, setImage] = React.useState<{ dataUrl: string; name: string } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const categories: { key: Category; icon: typeof Bug; label: string }[] = [
    { key: "bug", icon: Bug, label: t("feedback.bug") },
    { key: "feature", icon: Lightbulb, label: t("feedback.feature") },
    { key: "other", icon: MessageSquare, label: t("feedback.other") },
  ];

  const reset = () => {
    setCategory("bug");
    setDescription("");
    setImage(null);
    setBusy(false);
  };

  const pickImage = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast.error(t("feedback.imageOnly"));
    if (file.size > MAX_IMAGE_BYTES) return toast.error(t("feedback.imageTooBig"));
    const reader = new FileReader();
    reader.onload = () => setImage({ dataUrl: reader.result as string, name: file.name });
    reader.readAsDataURL(file);
  };

  const submit = async () => {
    if (description.trim().length < 3 || busy) return;
    setBusy(true);
    try {
      await submitFeedback({
        category,
        description: description.trim(),
        email,
        image: image?.dataUrl ?? null,
        imageName: image?.name ?? null,
      });
      toast.success(t("feedback.success"));
      onOpenChange(false);
      reset();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("feedback.error"));
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("feedback.title")}</DialogTitle>
        </DialogHeader>
        <p className="-mt-1 text-sm text-muted-foreground">{t("feedback.subtitle")}</p>

        {/* Category — segmented control */}
        <div className="grid grid-cols-3 gap-2">
          {categories.map(({ key, icon: Icon, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setCategory(key)}
              className={cn(
                "flex flex-col items-center gap-1.5 rounded-lg border px-2 py-3 text-xs font-medium transition-colors",
                category === key
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>

        {/* Description */}
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t("feedback.descPlaceholder")}
          className="min-h-28 resize-none"
          autoFocus
        />

        {/* Screenshot */}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => pickImage(e.target.files?.[0])}
        />
        {image ? (
          <div className="flex items-center gap-3 rounded-lg border border-border p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={image.dataUrl} alt={image.name} className="h-12 w-12 rounded object-cover" />
            <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
              {image.name}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setImage(null)}
              aria-label={t("feedback.remove")}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-border py-3 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
          >
            <ImagePlus className="h-4 w-4" /> {t("feedback.addScreenshot")}
          </button>
        )}

        {/* Identity + submit */}
        <div className="flex items-center justify-between gap-3 pt-1">
          <span className="min-w-0 truncate text-xs text-muted-foreground">
            {email ? t("feedback.sendingAs", { email }) : ""}
          </span>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              {t("feedback.cancel")}
            </Button>
            <Button
              onClick={submit}
              disabled={busy || description.trim().length < 3}
              className="gap-2"
            >
              {busy ? (
                t("feedback.sending")
              ) : (
                <>
                  {t("feedback.send")} <Send className="h-4 w-4" />
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CoachMark({ onOpen }: { onOpen: () => void }) {
  const { t } = useTranslation();
  const { sessionId } = useAuth();
  const [show, setShow] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === "undefined" || !sessionId) return;
    if (localStorage.getItem(HINT_SESSION_KEY) === sessionId) return; // already seen this session
    const appear = setTimeout(() => setShow(true), 800); // let the page settle first
    return () => clearTimeout(appear);
  }, [sessionId]);

  const dismiss = React.useCallback(() => {
    setShow(false);
    try {
      if (sessionId) localStorage.setItem(HINT_SESSION_KEY, sessionId);
    } catch {}
  }, [sessionId]);

  React.useEffect(() => {
    if (!show) return;
    const hide = setTimeout(dismiss, 15_000); // auto-vanish
    return () => clearTimeout(hide);
  }, [show, dismiss]);

  if (!show) return null;

  return (
    <>
      {/* Dim the whole app to draw the eye; the FAB (z-45) stays spotlit above it. */}
      <div
        onClick={dismiss}
        aria-hidden
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px] animate-in fade-in duration-300"
      />
      <div className="fixed bottom-20 right-6 z-[46] w-72 animate-in fade-in slide-in-from-bottom-2 duration-300">
        <div className="relative rounded-xl border border-border bg-card p-3.5 shadow-xl">
          <button
            onClick={dismiss}
            aria-label={t("feedback.dismissHint")}
            className="absolute right-2 top-2 text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
          <div className="flex items-center gap-1.5 text-sm font-medium">
            <Sparkles className="h-4 w-4 text-primary" /> {t("feedback.hintTitle")}
          </div>
          <p className="mt-1 pr-3 text-xs text-muted-foreground">{t("feedback.hintBody")}</p>
          <button
            onClick={() => {
              dismiss();
              onOpen();
            }}
            className="mt-2 text-xs font-medium text-primary hover:underline"
          >
            {t("feedback.hintCta")}
          </button>
          {/* little arrow pointing down at the FAB */}
          <div className="absolute -bottom-1.5 right-6 h-3 w-3 rotate-45 border-b border-r border-border bg-card" />
        </div>
      </div>
    </>
  );
}
