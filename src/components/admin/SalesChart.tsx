import { fmtMoney } from "@/lib/i18n";

type Day = { day: string; totalMinor: number; orders: number };

/** Simple bar chart drawn as SVG (no chart library). A hidden table gives screen-reader users the same numbers. */
export default function SalesChart({ days, currency }: { days: Day[]; currency: string }) {
  const max = Math.max(...days.map((d) => d.totalMinor), 1);
  const total = days.reduce((n, d) => n + d.totalMinor, 0);
  const W = 560, H = 160, pad = 24, bw = (W - pad * 2) / days.length;
  const label = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  if (total === 0) return <p className="mt-3 text-sm text-muted">No sales in the last 7 days yet. They will show up here as bars.</p>;
  return (
    <div className="mt-3">
      <p className="text-sm text-muted">Total: <strong className="text-base text-slate-900">{fmtMoney(total, currency, "en")}</strong> from {days.reduce((n, d) => n + d.orders, 0)} orders</p>
      <svg viewBox={`0 0 ${W} ${H + 28}`} className="mt-2 w-full" role="img" aria-label={`Sales per day for the last 7 days. Total ${fmtMoney(total, currency, "en")}.`}>
        <line x1={pad} x2={W - pad} y1={H} y2={H} stroke="#e2e8f0" />
        {days.map((d, i) => {
          const h = Math.max((d.totalMinor / max) * (H - 24), d.totalMinor > 0 ? 3 : 0);
          const x = pad + i * bw + bw * 0.18, w = bw * 0.64;
          return (
            <g key={d.day}>
              <title>{`${d.day}: ${fmtMoney(d.totalMinor, currency, "en")} from ${d.orders} order${d.orders === 1 ? "" : "s"}`}</title>
              <rect className="chart-bar" x={x} y={H - h} width={w} height={h} rx={5} />
              {d.totalMinor > 0 && <text x={x + w / 2} y={H - h - 5} textAnchor="middle" fontSize="10" fill="#475569">{Math.round(d.totalMinor / 100).toLocaleString("en-US")}</text>}
              <text x={x + w / 2} y={H + 16} textAnchor="middle" fontSize="11" fill="#64748b">{label(d.day)}</text>
            </g>
          );
        })}
      </svg>
      <table className="sr-only">
        <caption>Sales per day</caption>
        <thead><tr><th>Day</th><th>Sales</th><th>Orders</th></tr></thead>
        <tbody>{days.map((d) => <tr key={d.day}><td>{d.day}</td><td>{fmtMoney(d.totalMinor, currency, "en")}</td><td>{d.orders}</td></tr>)}</tbody>
      </table>
    </div>
  );
}
