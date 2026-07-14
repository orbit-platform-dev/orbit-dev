import { PageHeader } from "@/components/shared/page-header";
import { MembersSection } from "@/components/settings/members-section";
import { InviteCustomer } from "@/components/settings/onboard-customer";

export const metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <div>
      <PageHeader title="Settings" description="Manage who has access to your workspace." />
      <div className="max-w-3xl space-y-10">
        <MembersSection />
        <InviteCustomer />
      </div>
    </div>
  );
}
