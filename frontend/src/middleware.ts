import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Public routes: the sign-in screen and the OAuth callback. Everything else in
// the app requires a signed-in Clerk session (invite-only; no self-serve sign-up,
// so /sign-up is public only to serve its redirect to /sign-in).
const isPublic = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)", "/sso-callback(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublic(req)) await auth.protect();
});

export const config = {
  matcher: [
    // Skip Next internals and static files; run on everything else + API.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
