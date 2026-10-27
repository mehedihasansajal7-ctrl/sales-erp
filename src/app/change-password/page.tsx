import { redirect } from "next/navigation";
import { getCurrentUser, homeFor } from "@/lib/auth";
import { ChangePasswordForm } from "@/components/forms/auth-forms";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

/**
 * Change password. Deliberately **outside** the (app) layout: that layout redirects
 * here whenever an administrator has reset the password, and a page inside the same
 * layout would redirect to itself.
 */
export default async function ChangePasswordPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=%2Fchange-password");

  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-md">
        <div className="mb-5 text-center">
          <h1 className="text-xl font-semibold text-slate-900">Sales &amp; Delivery ERP</h1>
          <p className="mt-1 text-sm text-slate-500">Signed in as {user.email}</p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Change password</CardTitle>
            <CardDescription>
              {user.mustChangePassword
                ? "An administrator reset your password - please choose a new one to continue."
                : "Choose a new password for your account."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {user.mustChangePassword ? (
              <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                You cannot use the rest of the system until the password is changed.
              </p>
            ) : null}
            <ChangePasswordForm />
            <p className="mt-4 text-center text-xs text-slate-400">
              <a className="underline-offset-4 hover:underline" href={homeFor(user.role)}>
                Back to {homeFor(user.role) === "/dashboard" ? "the dashboard" : "my work"}
              </a>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
