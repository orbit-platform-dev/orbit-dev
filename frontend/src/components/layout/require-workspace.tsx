"use client";

import * as React from "react";
import { RefreshCw } from "lucide-react";
import { useAuth, useOrganization, useOrganizationList } from "@clerk/nextjs";
import { clerkEnabled } from "@/lib/auth";
import { OrbitWordmark } from "@/components/shared/logo";
import { CreateWorkspace } from "@/components/workspace/create-workspace";

export function RequireWorkspace({ children }: { children: React.ReactNode }) {
  const { isLoaded: authLoaded, isSignedIn } = useAuth();
  const { isLoaded: orgLoaded, organization } = useOrganization();
  const { isLoaded: listLoaded, setActive, userMemberships } = useOrganizationList({
    userMemberships: true,
  });

  const firstOrgId = userMemberships?.data?.[0]?.organization.id;

  // No active org but the user already belongs to one → activate it silently.
  React.useEffect(() => {
    if (!clerkEnabled || organization || !setActive || !firstOrgId) return;
    void setActive({ organization: firstOrgId });
  }, [organization, setActive, firstOrgId]);

  if (!clerkEnabled) return <>{children}</>;
  if (!authLoaded || !orgLoaded) return <GateSpinner />;
  // Unauthenticated requests are redirected by middleware; render nothing here.
  if (!isSignedIn) return <>{children}</>;
  if (organization) return <>{children}</>;
  // No active org: decide from the membership list (avoid waiting on it above).
  if (!listLoaded) return <GateSpinner />;
  if (firstOrgId) return <GateSpinner />; // membership exists; effect is activating it


  return (
    <div className="mx-auto flex min-h-[75vh] w-full max-w-lg flex-col justify-center gap-8 py-10">
      <OrbitWordmark />
      <CreateWorkspace
        heading="Welcome to Orbit"
        subheading="Create your workspace to get started. It holds your company's memory, connections and members, fully isolated from every other company. You can invite your team right after."
      />
    </div>
  );
}

function GateSpinner() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  );
}
