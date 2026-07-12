"use client";

import { AuthenticateWithRedirectCallback } from "@clerk/nextjs";

// Where Google (and any OAuth) redirects back to. Clerk finishes the handshake
// and forwards to the app. Must be a public route (see middleware).
export default function SSOCallbackPage() {
  return <AuthenticateWithRedirectCallback signInFallbackRedirectUrl="/feed" signUpFallbackRedirectUrl="/feed" />;
}
