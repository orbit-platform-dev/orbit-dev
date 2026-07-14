import { clerkClient } from "@clerk/nextjs/server";

// Server-side superadmin check (source of truth for gating admin-only routes).
// Reads Clerk publicMetadata.superadmin from the Backend API so it can't be
// spoofed by the client. Import ONLY from server routes.
export async function isSuperadmin(userId: string): Promise<boolean> {
  const client = await clerkClient();
  const user = await client.users.getUser(userId);
  return user.publicMetadata?.superadmin === true;
}
