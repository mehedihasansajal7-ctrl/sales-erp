"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type RatePoint = { date: string; productName: string; ratePerMt: number };

/** Rate history chart — one line per product (spec Section 7.2). */
export function RateTrendChart({ data, products }: { data: RatePoint[]; products: string[] }) {
  const dates = [...new Set(data.map((point) => point.date))].sort();
  const rows = dates.map((date) => {
    const row: Record<string, string | number> = { date };
    for (const product of products) {
      const match = data.find((point) => point.date === date && point.productName === product);
      if (match) row[product] = match.ratePerMt;
    }
    return row;
  });

  if (rows.length === 0) {
    return <p className="py-8 text-center text-sm text-slate-500">No rate changes in the last 30 days.</p>;
  }

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="date" fontSize={11} />
          <YAxis fontSize={11} width={70} tickFormatter={(value: number) => value.toLocaleString()} />
          <Tooltip formatter={(value) => `৳ ${Number(value).toLocaleString()}`} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {products.map((product, index) => (
            <Line
              key={product}
              type="stepAfter"
              dataKey={product}
              stroke={["#059669", "#2563eb", "#d97706", "#7c3aed", "#dc2626"][index % 5]}
              strokeWidth={2}
              dot={{ r: 2 }}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export type StockPoint = { label: string; onHand: number; reserved: number };

export function StockByWarehouseChart({ data }: { data: StockPoint[] }) {
  if (data.length === 0) {
    return <p className="py-8 text-center text-sm text-slate-500">No stock recorded yet.</p>;
  }
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="label" fontSize={11} />
          <YAxis fontSize={11} width={70} />
          <Tooltip formatter={(value) => `${Number(value).toLocaleString()} MT`} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="onHand" name="On hand (MT)" fill="#059669" radius={[3, 3, 0, 0]} />
          <Bar dataKey="reserved" name="Reserved (MT)" fill="#f59e0b" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
