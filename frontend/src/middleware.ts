import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// Public routes: the sign-in screen, the invitation-acceptance page, and the
// OAuth callback. Everything else requires a signed-in Clerk session (invite-only,
// no self-serve sign-up).
const isPublic = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)", "/sso-callback(.*)"]);
// The auth screens themselves — a signed-in user must never sit on these.
const isAuthPage = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  const { userId } = await auth();

  // Already signed in? Keep them out of the auth pages; send them into the app.
  // (Invitation acceptance runs on /sign-up while still signed OUT, so it is
  // unaffected — the redirect only fires once a session exists.)
  if (userId && isAuthPage(req)) {
    return NextResponse.redirect(new URL("/feed", req.url));
  }

  // Everything that isn't explicitly public requires authentication.
  if (!isPublic(req)) await auth.protect();
});

export const config = {
  matcher: [
    // Skip Next internals and static files; run on everything else + API.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
