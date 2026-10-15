import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser, homeFor } from "@/lib/auth";
import { LoginForm } from "@/components/forms/auth-forms";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const user = await getCurrentUser();
  if (user) redirect(homeFor(user.role));

  const { next } = await searchParams;

  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-md">
        <div className="mb-5 text-center">
          <h1 className="text-xl font-semibold text-slate-900">Sales &amp; Delivery ERP</h1>
          <p className="mt-1 text-sm text-slate-500">
            Integrated sales, order, inventory and delivery management
          </p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Sign in</CardTitle>
            <CardDescription>Use your company email address and password.</CardDescription>
          </CardHeader>
          <CardContent>
            <LoginForm nextPath={next} />
          </CardContent>
        </Card>
        <p className="mt-4 text-center text-xs text-slate-400">
          All quantities in MT · currency in BDT · times in Asia/Dhaka
        </p>
      </div>
    </div>
  );
}
