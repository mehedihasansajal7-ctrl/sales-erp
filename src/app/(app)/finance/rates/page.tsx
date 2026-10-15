import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { roleHasPermission } from "@/lib/rbac";
import { toDateTimeLocalValue, formatDateTime } from "@/lib/dates";
import { currentRates, rateTrend } from "@/server/services/rate.service";
import { listProducts } from "@/server/services/master-data.service";
import { formatBdt } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, PageHeader, StatusBadge, type Column } from "@/components/page-header";
import { RatePublishForm } from "@/components/forms/rate-form";
import { RateTrendChart } from "@/components/charts";

export const dynamic = "force-dynamic";

export default async function RatesPage() {
  const user = await requirePermission("rate.view");
  const canPublish = roleHasPermission(user.role, "rate.publish");

  const [rates, products, trend] = await Promise.all([
    currentRates(),
    listProducts(false),
    rateTrend(30),
  ]);

  type Row = (typeof rates)[number];
  const columns: Column<Row>[] = [
    {
      key: "product",
      label: "Product",
      render: (row) => (
        <span>
          <span className="font-medium">{row.product.name}</span>
          <span className="ml-1 text-xs text-slate-500">{row.product.code}</span>
        </span>
      ),
    },
    { key: "category", label: "Category", render: (row) => row.product.category },
    {
      key: "ratePerMt",
      label: "Current rate (৳/MT)",
      align: "right",
      render: (row) =>
        row.hasRate ? (
          <span className="font-semibold">{formatBdt(row.ratePerMt)}</span>
        ) : (
          <span className="text-xs font-medium text-amber-700">Not published</span>
        ),
    },
    {
      key: "effectiveFrom",
      label: "Effective from",
      render: (row) => (row.effectiveFrom ? formatDateTime(row.effectiveFrom) : "—"),
    },
    {
      key: "publishedBy",
      label: "Published by",
      render: (row) => row.rate?.publisher.name ?? "—",
    },
    {
      key: "status",
      label: "Status",
      render: (row) => <StatusBadge status={row.hasRate ? "ACTIVE" : "PENDING_APPROVAL"} label={row.hasRate ? "Live" : "Missing"} />,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Product selling rates"
        description="Finance publishes the daily product-wise selling rate. Publishing a new rate never changes an existing order."
        breadcrumb={[{ href: "/dashboard", label: "Dashboard" }]}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/finance/rates/history">Full rate history</Link>
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[420px_1fr]">
        {canPublish ? (
          <Card>
            <CardHeader>
              <CardTitle>Publish a new rate</CardTitle>
            </CardHeader>
            <CardContent>
              <RatePublishForm
                products={products.map((product) => ({
                  code: product.code,
                  name: product.name,
                  category: product.category,
                }))}
                defaultEffectiveFrom={toDateTimeLocalValue()}
              />
            </CardContent>
          </Card>
        ) : null}

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Current rates</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <DataTable
                columns={columns}
                rows={rates}
                rowKey={(row) => row.product.code}
                emptyMessage="No products configured yet."
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Rate changes — last 30 days</CardTitle>
            </CardHeader>
            <CardContent>
              <RateTrendChart
                data={trend}
                products={[...new Set(trend.map((point) => point.productName))]}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
