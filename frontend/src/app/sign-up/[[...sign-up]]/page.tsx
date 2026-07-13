import { redirect } from "next/navigation";
import { SignUpScreen } from "@/components/auth/sign-up-screen";

export const metadata = { title: "Join your workspace" };

// Orbit is invite-only: there is no self-serve sign-up. The ONLY way in is an
// organization invitation, whose email links here with a `__clerk_ticket`.
// With a ticket we render the acceptance screen; without one we send the user
// to sign-in. We must read the ticket here — a bare redirect would drop the
// query string and strand invitees.
export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ __clerk_ticket?: string | string[] }>;
}) {
  const { __clerk_ticket } = await searchParams;
  const ticket = Array.isArray(__clerk_ticket) ? __clerk_ticket[0] : __clerk_ticket;
  if (!ticket) redirect("/sign-in");
  return <SignUpScreen ticket={ticket} />;
}
