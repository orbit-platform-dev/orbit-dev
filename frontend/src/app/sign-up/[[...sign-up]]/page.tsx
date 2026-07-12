import { redirect } from "next/navigation";

// Orbit is invite-only: there is no self-serve sign-up. Anyone landing here
// (old links, Clerk defaults) is sent to sign-in. Access is granted by a
// workspace admin inviting the user in Clerk.
export default function SignUpPage() {
  redirect("/sign-in");
}
