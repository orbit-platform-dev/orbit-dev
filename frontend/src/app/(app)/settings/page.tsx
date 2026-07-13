import { PageHeader } from "@/components/shared/page-header";
import { MembersSection } from "@/components/settings/members-section";

export const metadata = { title: "Settings" };

// A workspace is a Clerk organization; Settings is a single surface — the team.
// (The old Workspace tab was a non-functional mock, and Integrations lives on
// its own top-level page, so both were removed rather than duplicated here.)
export default function SettingsPage() {
  return (
    <div>
      <PageHeader title="Settings" description="Manage who has access to your workspace." />
      <div className="max-w-3xl space-y-6">
        <MembersSection />
      </div>
    </div>
  );
}
