import { NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";

export async function POST(req: Request) {
  const { userId, orgId, has } = await auth();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!orgId) return NextResponse.json({ error: "No active workspace." }, { status: 400 });
  if (!has({ role: "org:admin" })) {
    return NextResponse.json(
      { error: "Only workspace admins can invite members." },
      { status: 403 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    emailAddress?: string;
    role?: string;
    origin?: string;
  };
  const email = body.emailAddress?.trim().toLowerCase();
  const role = body.role === "org:admin" ? "org:admin" : "org:member";
  if (!email) return NextResponse.json({ error: "An email address is required." }, { status: 400 });

  const base =
    typeof body.origin === "string" && /^https?:\/\//.test(body.origin)
      ? body.origin.replace(/\/$/, "")
      : new URL(req.url).origin;

  try {
    const client = await clerkClient();
    await client.organizations.createOrganizationInvitation({
      organizationId: orgId,
      inviterUserId: userId,
      emailAddress: email,
      role,
      redirectUrl: `${base}/sign-up`,
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
