import { Suspense } from "react";
import { AcceptInvitation } from "@/components/auth/accept-invitation";

// Orbit is invite-only: /sign-up exists only to accept invitations (it consumes
// the Clerk ticket). Without a ticket, AcceptInvitation sends the user to /sign-in.
export default function SignUpPage() {
  return (
    <Suspense>
      <AcceptInvitation />
    </Suspense>
  );
}
