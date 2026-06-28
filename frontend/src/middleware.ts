import { NextResponse } from "next/server";

// When Clerk is configured, protect the authenticated app. Otherwise this is a
// no-op so the product runs in demo mode without any auth setup.
const clerkEnabled =
  !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && !!process.env.CLERK_SECRET_KEY;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let handler: (...args: any[]) => any = () => NextResponse.next();

if (clerkEnabled) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { clerkMiddleware, createRouteMatcher } = require("@clerk/nextjs/server");
  const isPublic = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)"]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler = clerkMiddleware(async (auth: any, req: any) => {
    if (!isPublic(req)) await auth.protect();
  });
}

export default handler;

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)"],
};
