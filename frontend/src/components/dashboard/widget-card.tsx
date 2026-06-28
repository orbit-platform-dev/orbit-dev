import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function WidgetCard({
  title,
  icon,
  href,
  action,
  children,
  className,
  bodyClassName,
}: {
  title: string;
  icon?: React.ReactNode;
  href?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <Card className={cn("flex flex-col", className)}>
      <div className="flex items-center justify-between gap-2 px-4 pb-3 pt-4">
        <div className="flex items-center gap-2">
          {icon ? <span className="text-muted-foreground">{icon}</span> : null}
          <h3 className="text-sm font-semibold">{title}</h3>
        </div>
        {action ??
          (href ? (
            <Link href={href} className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground">
              View all <ArrowRight className="h-3 w-3" />
            </Link>
          ) : null)}
      </div>
      <div className={cn("flex-1 px-4 pb-4", bodyClassName)}>{children}</div>
    </Card>
  );
}
