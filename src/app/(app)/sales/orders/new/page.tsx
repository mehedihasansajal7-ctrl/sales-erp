import { requirePermission } from "@/lib/auth";
import { toDateTimeLocalValue } from "@/lib/dates";
import { currentRates } from "@/server/services/rate.service";
import { listCustomers } from "@/server/services/master-data.service";
import { PageHeader } from "@/components/page-header";
import { OrderCreateForm } from "@/components/forms/order-form";

export const dynamic = "force-dynamic";

export default async function NewOrderPage() {
  const user = await requirePermission("order.create");

  const [customers, products] = await Promise.all([listCustomers({ isActive: true }), currentRates()]);

  return (
    <div>
      <PageHeader
        title="New order"
        description="The current published rate is copied into the order and locked permanently. Later rate changes never affect this order."
        breadcrumb={[
          { href: "/dashboard", label: "Dashboard" },
          { href: "/sales/orders", label: "Orders" },
        ]}
      />

      <OrderCreateForm
        customers={customers.map((customer) => ({
          code: customer.code,
          name: customer.name,
          creditLimit: customer.creditLimit,
        }))}
        products={products.map((entry) => ({
          code: entry.product.code,
          name: entry.product.name,
          category: entry.product.category,
          ratePerMt: entry.ratePerMt,
          effectiveFrom: entry.effectiveFrom ? entry.effectiveFrom.toISOString() : null,
          hasRate: entry.hasRate,
        }))}
        defaultOrderDate={toDateTimeLocalValue()}
        canBackdate={user.role === "ADMIN"}
      />
    </div>
  );
}
