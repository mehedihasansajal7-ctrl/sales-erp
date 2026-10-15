import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { REPORT_LIST } from "@/server/services/report.service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  await requirePermission("report.view");

  return (
    <div>
      <PageHeader
        title="Reports"
        description="Every report opens with filters and can be exported to Excel or PDF in one click."
        breadcrumb={[{ href: "/dashboard", label: "Dashboard" }]}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {REPORT_LIST.map((report) => (
          <Card key={report.key}>
            <CardHeader>
              <CardTitle>
                <Link href={`/reports/${report.key}`} className="text-emerald-700 hover:underline">
                  {report.title}
                </Link>
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-slate-600">{report.description}</CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
