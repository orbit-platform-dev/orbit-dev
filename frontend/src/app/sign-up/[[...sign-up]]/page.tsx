import { AuthScreen } from "@/components/auth/auth-screen";

export const metadata = { title: "Sign up" };

export default function SignUpPage() {
  return <AuthScreen mode="sign-up" />;
}
