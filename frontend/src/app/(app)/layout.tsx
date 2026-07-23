import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { CommandMenu } from "@/components/layout/command-menu";
import { AppAmbient } from "@/components/layout/ambient";
import { RequireWorkspace } from "@/components/layout/require-workspace";
import { SyncEffects } from "@/components/shared/sync-effects";
import { FeedbackWidget } from "@/components/shared/feedback-widget";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex h-screen overflow-hidden bg-background">
      <AppAmbient />
      <aside className="relative z-10 hidden shrink-0 lg:block">
        <Sidebar />
      </aside>
      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="no-scrollbar flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8">
            <SyncEffects />
            <RequireWorkspace>{children}</RequireWorkspace>
          </div>
        </main>
      </div>
      <CommandMenu />
      <FeedbackWidget />
    </div>
  );
}
