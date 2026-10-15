import { requirePermission } from "@/lib/auth";
import { zonedToUtc } from "@/lib/dates";
import { listAuditLogs } from "@/server/services/audit.service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DetailList, FilterBar, PageHeader, Pagination, StatusBadge } from "@/components/page-header";

export const dynamic = "force-dynamic";

/** Rule 8 — read-only audit log viewer. */
export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePermission("audit.view");
  const params = await searchParams;
  const get = (key: string) => {
    const value = params[key];
    return typeof value === "string" && value !== "" ? value : undefined;
  };

  const page = Math.max(1, Number(get("page") ?? 1));
  const logs = await listAuditLogs({
    q: get("q"),
    entity: get("entity"),
    action: get("action"),
    from: get("from") ? zonedToUtc(get("from") as string) : undefined,
    to: get("to") ? zonedToUtc(`${get("to")}T23:59:59`) : undefined,
    page,
    pageSize: 30,
  });

  return (
    <div>
      <PageHeader
        title="Audit log"
        description="Append-only: the database itself rejects any UPDATE, DELETE or TRUNCATE on this table."
        breadcrumb={[{ href: "/dashboard", label: "Dashboard" }]}
      />

      <FilterBar
        action="/admin/audit"
        q={get("q")}
        placeholder="Search entity id, user or action"
        selects={[
          {
            name: "entity",
            label: "Entity",
            value: get("entity"),
            options: [
              "rate",
              "order",
              "order_item",
              "delivery_order",
              "dispatch",
              "stock",
              "stock_transfer",
              "stock_count",
              "user",
              "product",
              "customer",
              "warehouse",
              "system_setting",
              "auth",
            ].map((value) => ({ value, label: value.replace(/_/g, " ") })),
          },
          {
            name: "action",
            label: "Action",
            value: get("action"),
            options: [
              "CREATE",
              "UPDATE",
              "APPROVE",
              "REJECT",
              "CANCEL",
              "SHORT_CLOSE",
              "DISPATCH",
              "OVERRIDE",
              "PUBLISH",
              "LOGIN",
              "LOGOUT",
              "LOGIN_FAILED",
              "PASSWORD_CHANGE",
              "TRANSFER_REQUEST",
              "TRANSFER_APPROVE",
              "TRANSFER_REJECT",
              "TRANSFER_IN_TRANSIT",
              "TRANSFER_RECEIVE",
              "COUNT_SUBMIT",
              "COUNT_APPROVE",
              "COUNT_REJECT",
            ].map((value) => ({ value, label: value.replace(/_/g, " ") })),
          },
        ]}
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="from" className="text-xs font-medium text-slate-500">
            From
          </label>
          <input
            id="from"
            type="date"
            name="from"
            defaultValue={get("from") ?? ""}
            className="h-9 rounded-md border border-slate-300 px-3 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="to" className="text-xs font-medium text-slate-500">
            To
          </label>
          <input
            id="to"
            type="date"
            name="to"
            defaultValue={get("to") ?? ""}
            className="h-9 rounded-md border border-slate-300 px-3 text-sm"
          />
        </div>
      </FilterBar>

      <div className="flex flex-col gap-3">
        {logs.rows.length === 0 ? (
          <Card>
            <CardContent className="pt-4 text-sm text-slate-500">
              No audit entries match the filter.
            </CardContent>
          </Card>
        ) : (
          logs.rows.map((row) => (
            <Card key={row.id}>
              <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <StatusBadge status={row.action === "LOGIN_FAILED" ? "REJECTED" : "ACTIVE"} label={row.action} />
                  <span className="text-slate-700">{row.entity.replace(/_/g, " ")}</span>
                </CardTitle>
                <span className="text-xs text-slate-500">
                  {row.createdAtLabel} · {row.userName} {row.ip ? `· ${row.ip}` : ""}
                </span>
              </CardHeader>
              <CardContent className="grid gap-3 lg:grid-cols-3">
                <DetailList
                  items={[
                    { label: "Entity id", value: row.entityId ?? "—" },
                    { label: "User", value: row.userName },
                  ]}
                  columns={2}
                />
                {row.oldValue ? (
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Before</p>
                    <pre className="mt-1 max-h-40 overflow-auto rounded bg-slate-50 p-2 text-xs">
                      {row.oldValue}
                    </pre>
                  </div>
                ) : null}
                {row.newValue ? (
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">After</p>
                    <pre className="mt-1 max-h-40 overflow-auto rounded bg-slate-50 p-2 text-xs">
                      {row.newValue}
                    </pre>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <div className="mt-3">
        <Pagination
          page={logs.page}
          pageCount={logs.pageCount}
          total={logs.total}
          basePath="/admin/audit"
          searchParams={{
            q: get("q"),
            entity: get("entity"),
            action: get("action"),
            from: get("from"),
            to: get("to"),
          }}
        />
      </div>
    </div>
  );
}
