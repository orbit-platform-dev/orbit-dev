import { NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { isSuperadmin } from "@/lib/superadmin-server";

// Invite a customer (superadmin only). Sends a Clerk application invitation email
// whose link points back to Orbit's OWN /sign-up page (redirect_url), never the
// hosted portal. On acceptance the customer's account is created; they then
// create their OWN workspace on first run. The vendor is never in their data.
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!(await isSuperadmin(userId))) {
    return NextResponse.json({ error: "Only Orbit admins can invite customers." }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as { emailAddress?: string; origin?: string };
  const email = body.emailAddress?.trim().toLowerCase();
  if (!email) return NextResponse.json({ error: "An email address is required." }, { status: 400 });

  // Send the invitee back to our own page; must be an allowed redirect origin in
  // the Clerk dashboard for production instances.
  const base =
    typeof body.origin === "string" && /^https?:\/\//.test(body.origin)
      ? body.origin.replace(/\/$/, "")
      : new URL(req.url).origin;

  try {
    const client = await clerkClient();
    await client.invitations.createInvitation({
      emailAddress: email,
      redirectUrl: `${base}/sign-up`,
      ignoreExisting: true,
    });
    return NextResponse.json({ ok: true, email });
  } catch (e) {
    const msg =
      (e as { errors?: { longMessage?: string; message?: string }[] })?.errors?.[0]?.longMessage ||
      (e as { errors?: { message?: string }[] })?.errors?.[0]?.message ||
      "Couldn't send the invitation.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
