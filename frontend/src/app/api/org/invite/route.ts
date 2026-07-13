import { NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";

// Organization invitations are created HERE (server-side) rather than with the
// client-side `organization.inviteMember()`, because only the Backend API lets
// us set `redirectUrl`. Without it, Clerk's invitation email links to the hosted
// Account Portal (…accounts.dev/sign-up); with it, the email links back to
// Orbit's own /sign-up, which reads the `__clerk_ticket` and accepts inline.
export async function POST(req: Request) {
  const { userId, orgId, has } = await auth();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!orgId) return NextResponse.json({ error: "No active workspace." }, { status: 400 });
  // Invites are an admin-only action (Clerk also enforces this server-side).
  if (!has({ role: "org:admin" })) {
    return NextResponse.json({ error: "Only workspace admins can invite members." }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    emailAddress?: string;
    role?: string;
    origin?: string;
  };
  const emailAddress = body.emailAddress?.trim();
  const role = body.role === "org:admin" ? "org:admin" : "org:member";
  if (!emailAddress) return NextResponse.json({ error: "An email address is required." }, { status: 400 });

  // Use the caller's origin so this works on any host/port (localhost:3001,
  // preview deploys, prod). The origin must be an allowed redirect URL in the
  // Clerk dashboard for production instances.
  const base =
    typeof body.origin === "string" && /^https?:\/\//.test(body.origin)
      ? body.origin.replace(/\/$/, "")
      : new URL(req.url).origin;

  try {
    const client = await clerkClient();
    const invitation = await client.organizations.createOrganizationInvitation({
      organizationId: orgId,
      inviterUserId: userId,
      emailAddress,
      role,
      redirectUrl: `${base}/sign-up`,
    });
    return NextResponse.json({ ok: true, id: invitation.id });
  } catch (e) {
    const msg =
      (e as { errors?: { longMessage?: string; message?: string }[] })?.errors?.[0]?.longMessage ||
      (e as { errors?: { message?: string }[] })?.errors?.[0]?.message ||
      "Couldn't send the invitation.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
