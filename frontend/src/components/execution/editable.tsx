"use client";

// Reusable inline editors for the Review Screen. Everything Orbit generates is a
// first draft — these primitives let a user correct any field before approval,
// so the same add/edit/remove behavior is consistent across Intent, PRD and Timeline.

import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Edit a list of plain strings (goals, requirements, criteria, …). */
export function StringList({
  value,
  onChange,
  placeholder,
  addLabel = "Add",
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  addLabel?: string;
}) {
  const set = (i: number, v: string) => onChange(value.map((x, idx) => (idx === i ? v : x)));
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i));
  const add = () => onChange([...value, ""]);

  return (
    <div className="space-y-1.5">
      {value.map((item, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <Input value={item} onChange={(e) => set(i, e.target.value)} placeholder={placeholder} className="h-8 text-sm" />
          <Button type="button" variant="ghost" size="icon-sm" onClick={() => remove(i)} aria-label="Remove">
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={add}>
        <Plus className="h-3.5 w-3.5" /> {addLabel}
      </Button>
    </div>
  );
}

/** Edit a list of typed objects with per-row remove + add, rendering custom fields per row. */
export function ObjectList<T>({
  value,
  onChange,
  blank,
  addLabel,
  children,
}: {
  value: T[];
  onChange: (next: T[]) => void;
  blank: () => T;
  addLabel: string;
  children: (item: T, set: (patch: Partial<T>) => void, index: number) => React.ReactNode;
}) {
  const setItem = (i: number, patch: Partial<T>) =>
    onChange(value.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i));
  const add = () => onChange([...value, blank()]);

  return (
    <div className="space-y-2">
      {value.map((item, i) => (
        <div key={i} className="flex items-start gap-1.5 rounded-lg border border-border bg-background/40 p-2">
          <div className="min-w-0 flex-1 space-y-1.5">{children(item, (patch) => setItem(i, patch), i)}</div>
          <Button type="button" variant="ghost" size="icon-sm" onClick={() => remove(i)} aria-label="Remove">
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={add}>
        <Plus className="h-3.5 w-3.5" /> {addLabel}
      </Button>
    </div>
  );
}
