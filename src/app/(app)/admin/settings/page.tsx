import { requirePermission } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { listWarehouses } from "@/server/services/master-data.service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { SettingsForm } from "@/components/forms/admin-forms";

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  await requirePermission("admin.settings");

  const [settings, warehouses] = await Promise.all([getSettings(), listWarehouses()]);

  return (
    <div>
      <PageHeader
        title="System settings"
        description="Business switches that change how the rules behave. Every change is audited."
        breadcrumb={[{ href: "/dashboard", label: "Dashboard" }]}
      />

      <Card>
        <CardHeader>
          <CardTitle>Business rules</CardTitle>
        </CardHeader>
        <CardContent>
          <SettingsForm
            settings={settings}
            warehouses={warehouses.map((warehouse) => ({ code: warehouse.code, name: warehouse.name }))}
          />
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Read-only system information</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
          <p>
            Timezone: <strong>{process.env.APP_TIMEZONE ?? "Asia/Dhaka"}</strong> — all date logic
            (today, this month, document number years) uses this zone.
          </p>
          <p>
            Currency: <strong>BDT (৳)</strong> · quantities in <strong>MT</strong> with 3 decimals.
          </p>
          <p>
            Session lifetime:{" "}
            <strong>{Number(process.env.SESSION_MAX_AGE_SECONDS ?? 43200) / 3600} hours</strong>.
          </p>
          <p>
            PDF font:{" "}
            <strong>{process.env.PDF_FONT_PATH ? "Unicode font configured" : "built-in (BDT marker)"}</strong>{" "}
            — see docs/HUMAN_TODO.md to enable ৳ and Bangla in PDFs.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
