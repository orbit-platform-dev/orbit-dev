"use client";

import { useUser } from "@clerk/nextjs";

// Superadmin = the Orbit vendor team (CEO/CTO). Marked by Clerk publicMetadata
// { superadmin: true }. Superadmins can create/switch workspaces and onboard
// customers. Everyone else (customer admins/members) is scoped to their one
// workspace. This gates UI only; the server routes verify it independently.
export function useIsSuperadmin(): boolean {
  const { user, isLoaded } = useUser();
  if (!isLoaded) return false;
  return user?.publicMetadata?.superadmin === true;
}
