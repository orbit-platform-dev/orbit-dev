// ============================================================================
// Auth abstraction.
// Orbit integrates Clerk for authentication. To keep the product fully runnable
// without any external setup, when Clerk keys are absent the app falls back to a
// demo identity. Set NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY + CLERK_SECRET_KEY to
// activate real Clerk auth + route protection (see middleware.ts).
// ============================================================================

export const clerkEnabled = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  title: string;
  avatarUrl?: string;
}

export const demoUser: CurrentUser = {
  id: "u_1",
  name: "Yash Pandey",
  email: "yash@tryorbit.pro",
  title: "Founder & CEO",
};
