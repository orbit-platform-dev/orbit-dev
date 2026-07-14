import { NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { disableOrgCreation } from "@/lib/clerk-admin";

// A user creates THEIR OWN workspace, exactly once, on first sign-in. Allowed
// only when the caller currently has zero workspaces, so nobody can create a
// second one or create one "for" someone else. Client-side org creation stays
// disabled; this server route (Backend API) is the only creation path.
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { name?: string };
  const name = body.name?.trim();
  if (!name) return NextResponse.json({ error: "A workspace name is required." }, { status: 400 });

  try {
    const client = await clerkClient();
    const memberships = await client.users.getOrganizationMembershipList({ userId });
    const count = memberships.totalCount ?? memberships.data.length;
    if (count > 0) {
      return NextResponse.json({ error: "You already have a workspace." }, { status: 409 });
    }
    const org = await client.organizations.createOrganization({ name, createdBy: userId });
    // They now have their one workspace; block creating any more (client SDK).
    await disableOrgCreation(userId);
    return NextResponse.json({ id: org.id, name: org.name });
  } catch (e) {
    const msg =
      (e as { errors?: { longMessage?: string; message?: string }[] })?.errors?.[0]?.longMessage ||
      (e as { errors?: { message?: string }[] })?.errors?.[0]?.message ||
      "Couldn't create the workspace.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
