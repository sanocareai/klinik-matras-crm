import React, { useEffect, useState, useCallback } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from "recharts";
import { Users, ShoppingCart, Wallet, TrendingUp, MessageSquare, CheckCircle, Clock, Percent } from "lucide-react";

import { api } from "../api.js";
import KpiCard from "../components/KpiCard.jsx";
import ProgressBar from "../components/ProgressBar.jsx";
import RecentConversations from "../components/RecentConversations.jsx";
import DateRangePicker from "../components/DateRangePicker.jsx";
import { formatRupiah, formatTanggalIndo, labelBulan, SOURCE_LABELS, formatDuration, getDatePreset } from "../utils/format.js";

const TARGET_BULANAN = 500_000_000;

const INTENT_DATA = [
  { label: "Tanya Harga",   pct: 38, color: "#2563eb" },
  { label: "Tanya Produk",  pct: 27, color: "#7c3aed" },
  { label: "After Sales",   pct: 16, color: "#16a34a" },
  { label: "Komplain",      pct: 11, color: "#dc2626" },
  { label: "Lainnya",       pct: 8,  color: "#6b7280" },
];

const STAGE_LABEL = { LEAD: "Lead", QUALIFIED: "Prospek", QUOTED: "Offers/Negosiasi", WON: "Berhasil", LOST: "Gagal" };
const STAGE_COLOR = { LEAD: "#f59e0b", QUALIFIED: "#2563eb", QUOTED: "#7c3aed", WON: "#16a34a", LOST: "#dc2626" };

export default function Dashboard({ user }) {
  const now = new Date();

  const [dateRange, setDateRange] = useState(getDatePreset("30d"));
  const [overview, setOverview]   = useState(null);
  const [perf, setPerf]           = useState(null);
  const [csPerf, setCsPerf]       = useState([]);
  const [funnel, setFunnel]       = useState([]);
  const [sourcePerf, setSourcePerf] = useState([]);
  const [salesPerf, setSalesPerf] = useState([]);
  const [error, setError]         = useState("");
  const [loading, setLoading]     = useState(true);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = { from: dateRange.from, to: dateRange.to };
      const thisYear  = now.getFullYear();
      const thisMonth = now.getMonth() + 1;
      const [ov, pf, cs, fn, sp, spf] = await Promise.all([
        api.getAnalyticsOverview(params),
        api.getAnalyticsPerformance(params).catch(() => null),
        api.getAnalyticsCsPerformance(params).catch(() => []),
        api.getAnalyticsPipelineFunnel().catch(() => []),
        api.getAnalyticsSourcePerformance(params).catch(() => []),
        api.getSalesPerformance({ year: thisYear, month: thisMonth }).catch(() => []),
      ]);
      setOverview(ov);
      setPerf(pf);
      setCsPerf(cs || []);
      setFunnel(fn || []);
      setSourcePerf(sp || []);
      // Urutkan dari yang paling perform (totalOrderValue tertinggi)
      const sorted = (spf || []).slice().sort((a, b) => b.totalOrderValue - a.totalOrderValue);
      setSalesPerf(sorted);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [dateRange.from, dateRange.to]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  if (error) return (
    <div className="page-loading">
      <p style={{ color: "var(--color-danger)", fontWeight: 600 }}>Gagal memuat dashboard</p>
      <p style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 8 }}>{error}</p>
      <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
        Pastikan backend (port 4000) dan database (PostgreSQL via Docker) sudah jalan.
      </p>
    </div>
  );

  const userName = user?.name?.split(" ")[0] || "Anda";

  const trafficData = (overview?.monthlyTraffic || []).map((d) => ({
    bulan: labelBulan(d.month),
    Percakapan: d.count,
  }));

  return (
    <div className="page">
      {/* Header + Date Range */}
      <div className="page-header" style={{ alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
        <div className="page-header-left">
          <h1 className="page-greeting">Halo, {userName}! 👋</h1>
          <p className="page-date">{formatTanggalIndo()}</p>
        </div>
        <DateRangePicker value={dateRange} onChange={setDateRange} />
      </div>

      {/* KPI Row 1 — volume */}
      {loading ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16, marginBottom: 24 }}>
          {[...Array(4)].map((_, i) => <div key={i} className="skeleton skeleton-card" />)}
        </div>
      ) : (
        <div className="kpi-grid">
          <KpiCard label="Total Pelanggan"    value={overview?.totalCustomers || 0}                  color="purple" Icon={Users}        growth={overview?.growthCustomers} />
          <KpiCard label="Total Order"        value={overview?.totalOrders || 0}                      color="blue"   Icon={ShoppingCart} growth={overview?.growthOrders} />
          <KpiCard label="Total Nilai Order"  value={formatRupiah(overview?.totalOrderValue || 0)}    color="pink"   Icon={Wallet}       growth={overview?.growthOrderValue} />
          <KpiCard label="Penjualan Periode"  value={formatRupiah(overview?.thisMonthValue || 0)}    color="green"  Icon={TrendingUp} />
        </div>
      )}

      {/* Progress bar target */}
      {!loading && <ProgressBar current={overview?.thisMonthValue || 0} target={TARGET_BULANAN} />}

      {/* KPI Row 2 — performa CS */}
      {perf && (
        <div className="kpi-mini-grid">
          <div className="kpi-mini">
            <div className="kpi-mini-label">Total Percakapan</div>
            <div className="kpi-mini-value">{perf.totalConversations || 0}</div>
            <div className="kpi-mini-sub">{perf.openCount || 0} masih terbuka</div>
          </div>
          <div className="kpi-mini">
            <div className="kpi-mini-label">Closing Rate</div>
            <div className="kpi-mini-value">{perf.closingRate || 0}%</div>
            <div className="kpi-mini-sub">{perf.resolvedCount || 0} diselesaikan</div>
          </div>
          <div className="kpi-mini">
            <div className="kpi-mini-label">Avg. Response Time</div>
            <div className="kpi-mini-value">{formatDuration(perf.avgResponseMinutes)}</div>
            <div className="kpi-mini-sub">waktu respons pertama</div>
          </div>
          <div className="kpi-mini">
            <div className="kpi-mini-label">Status Terbuka</div>
            <div className="kpi-mini-value" style={{ color: perf.openCount > 10 ? "var(--color-danger)" : "var(--color-success)" }}>
              {perf.openCount || 0}
            </div>
            <div className="kpi-mini-sub">perlu ditangani</div>
          </div>
        </div>
      )}

      {/* Funnel Horizontal */}
      {funnel.length > 0 && (
        <div className="chart-card funnel-section">
          <h3>Pipeline Funnel</h3>
          <div className="funnel-wrap">
            {funnel.map((step, i) => (
              <React.Fragment key={step.stage}>
                <div className="funnel-step">
                  <div className="funnel-step-name">{STAGE_LABEL[step.stage] || step.stage}</div>
                  <div className="funnel-step-count">{step.count}</div>
                  <div className="funnel-step-value">{formatRupiah(step.value)}</div>
                  <div className="funnel-step-bar" style={{ background: STAGE_COLOR[step.stage] || "#94a3b8" }} />
                </div>
                {i < funnel.length - 1 && (
                  <div className="funnel-arrow">▶</div>
                )}
              </React.Fragment>
            ))}
          </div>
        </div>
      )}

      {/* Charts row */}
      <div className="chart-grid">
        {/* Traffic Bulanan */}
        <div className="chart-card">
          <h3>Traffic Bulanan (Percakapan Baru)</h3>
          {trafficData.length === 0 ? (
            <p className="muted">Belum ada data percakapan.</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={trafficData} margin={{ top: 4, right: 4, bottom: 0, left: -10 }}>
                <XAxis dataKey="bulan" fontSize={12} tick={{ fill: "#6b7280" }} axisLine={false} tickLine={false} />
                <YAxis fontSize={12} tick={{ fill: "#6b7280" }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb", boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}
                  cursor={{ fill: "rgba(37,99,235,0.06)" }}
                />
                <Bar dataKey="Percakapan" fill="#2563eb" radius={[5, 5, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Intent Distribution (dummy) */}
        <div className="chart-card">
          <h3>Distribusi Intent <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 400 }}>(estimasi)</span></h3>
          <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 12px" }}>
            Pelabelan AI belum aktif — data berdasarkan estimasi manual.
          </p>
          <div className="intent-grid">
            {INTENT_DATA.map((item) => (
              <div key={item.label} className="intent-item">
                <span className="intent-label">{item.label}</span>
                <div className="intent-bar-wrap">
                  <div className="intent-bar" style={{ width: item.pct + "%", background: item.color }} />
                </div>
                <span className="intent-pct">{item.pct}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Sales Performance — Target Bulanan */}
      {salesPerf.length > 0 && (
        <div className="chart-card" style={{ marginBottom: 24 }}>
          <h3>
            Target Sales Bulan {now.toLocaleDateString("id-ID", { month: "long", year: "numeric" })}
          </h3>
          <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 16px" }}>
            Progress nilai order per Sales Person terhadap target bulanan masing-masing.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {salesPerf.map((row) => {
              const pct = row.percentToTarget ?? 0;
              const hasTarget = row.target > 0;
              const barColor = pct >= 100 ? "#16a34a" : pct >= 50 ? "#2563eb" : "#f59e0b";
              const barWidth  = Math.min(pct, 100);
              return (
                <div key={row.userId} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{row.name}</span>
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      {formatRupiah(row.totalOrderValue)}
                      {hasTarget && <> / {formatRupiah(row.target)}</>}
                    </span>
                  </div>
                  <div style={{ height: 10, background: "#f3f4f6", borderRadius: 99, overflow: "hidden" }}>
                    <div style={{
                      height: "100%", borderRadius: 99,
                      background: hasTarget ? barColor : "#d1d5db",
                      width: hasTarget ? barWidth + "%" : "0%",
                      transition: "width 0.4s ease",
                    }} />
                  </div>
                  <div style={{ fontSize: 11, color: hasTarget ? barColor : "var(--text-muted)", fontWeight: 600 }}>
                    {hasTarget ? `${pct.toFixed(0)}%` : "Target belum diset"}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Performance per Sumber Lead */}
      {sourcePerf.length > 0 && (
        <div className="chart-card" style={{ marginBottom: 24 }}>
          <h3>Performance per Sumber Lead</h3>
          <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 12px" }}>
            Gunakan data ini untuk menghitung ROI per channel iklan.
          </p>
          <table className="cs-table">
            <thead>
              <tr>
                <th>Sumber</th>
                <th>Lead</th>
                <th>Closing</th>
                <th>Conv. Rate</th>
                <th>Total Nilai Order</th>
              </tr>
            </thead>
            <tbody>
              {sourcePerf.map((row) => (
                <tr key={row.source}>
                  <td style={{ fontWeight: 600 }}>
                    {SOURCE_LABELS[row.source] || row.source || "-"}
                  </td>
                  <td>{row.leads}</td>
                  <td>{row.won}</td>
                  <td>
                    <span className={row.convRate >= 30 ? "growth-up" : "growth-down"}>
                      {row.convRate}%
                    </span>
                  </td>
                  <td>{formatRupiah(row.totalValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Recent conversations */}
      <RecentConversations />
    </div>
  );
}
