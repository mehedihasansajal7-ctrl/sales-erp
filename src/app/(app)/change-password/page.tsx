import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChangePasswordForm } from "@/components/forms/auth-forms";

export const dynamic = "force-dynamic";

export default async function ChangePasswordPage() {
  const user = await requireUser();

  return (
    <div>
      <PageHeader
        title="Change password"
        description={`Signed in as ${user.email}.`}
        breadcrumb={[{ href: "/dashboard", label: "Dashboard" }]}
      />
      <Card>
        <CardHeader>
          <CardTitle>New password</CardTitle>
        </CardHeader>
        <CardContent>
          {user.mustChangePassword ? (
            <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              An administrator reset your password — please choose a new one now.
            </p>
          ) : null}
          <ChangePasswordForm />
        </CardContent>
      </Card>
    </div>
  );
}
