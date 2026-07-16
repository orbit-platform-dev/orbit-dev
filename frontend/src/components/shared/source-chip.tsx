import { ArrowUpRight, FileText } from "lucide-react";
import { IntegrationLogo } from "@/components/shared/integration-logo";
import { sourceKey } from "@/lib/sources";

/** One evidence reference: connector logo + title, deep-linked when a URL exists.
 *  The shared trust primitive — used wherever Orbit shows its receipts. */
export function SourceChip({ source, title, url }: { source: string; title: string; url?: string | null }) {
  const key = sourceKey(source);
  const body = (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs shadow-sm transition-all hover:border-primary/40 hover:bg-accent/60">
      {key ? (
        <IntegrationLogo k={key} className="h-4 w-4 rounded-[4px] border-0" />
      ) : (
        <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      )}
      <span className="max-w-[240px] truncate font-medium">{title}</span>
      {url ? <ArrowUpRight className="h-3 w-3 shrink-0 text-muted-foreground" /> : null}
    </span>
  );
  return url ? (
    <a href={url} target="_blank" rel="noreferrer" title={title} className="max-w-full">{body}</a>
  ) : (
    <span title={title} className="max-w-full">{body}</span>
  );
}
