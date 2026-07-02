import React, { useEffect, useState, useCallback } from "react";
import {
  BarChart, Bar, AreaChart, Area, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { TrendingUp, TrendingDown, Minus, Download, RefreshCw } from "lucide-react";
import { api } from "../api.js";
import DateRangePicker from "../components/DateRangePicker.jsx";
import { formatRupiah, formatDuration, labelBulan, getDatePreset } from "../utils/format.js";
import { exportToExcel } from "../utils/export.js";

const TABS = ["Ringkasan", "Percakapan", "Penjualan", "Pipeline", "Performa CS"];

const STAGE_COLORS = {
  LEAD: "#6366f1", QUALIFIED: "#3b82f6", QUOTED: "#f59e0b", WON: "#22c55e", LOST: "#ef4444",
};
const STAGE_NAMES = {
  LEAD: "Lead", QUALIFIED: "Prospek", QUOTED: "Penawaran", WON: "Berhasil", LOST: "Gagal",
};
const CHANNEL_COLORS = { WHATSAPP: "#22c55e", INSTAGRAM: "#e1306c" };

function KpiBox({ label, value, sub, growth, color }) {
  const growthColor = growth > 0 ? "#22c55e" : growth < 0 ? "#ef4444" : "#6b7280";
  const GrowthIcon = growth > 0 ? TrendingUp : growth < 0 ? TrendingDown : Minus;
  return (
    <div className="stat-card" style={{ borderTop: `3px solid ${color || "#6366f1"}` }}>
      <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 6px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</p>
      <p style={{ fontSize: 26, fontWeight: 800, margin: "0 0 4px", color: "var(--text-primary)" }}>{value}</p>
      {sub && <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>{sub}</p>}
      {growth !== undefined && (
        <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 6, fontSize: 12, color: growthColor, fontWeight: 700 }}>
          <GrowthIcon size={13} /> {growth > 0 ? "+" : ""}{growth}% vs periode sebelumnya
        </div>
      )}
    </div>
  );
}

export default function Laporan() {
  const [tab, setTab] = useState("Ringkasan");
  const [range, setRange] = useState(getDatePreset("30d"));

  const [overview, setOverview] = useState(null);
  const [perf, setPerf]         = useState(null);
  const [csPerf, setCsPerf]     = useState([]);
  const [funnel, setFunnel]     = useState([]);
  const [loading, setLoading]   = useState(false);

  const loadData = useCallback(async () => {
    if (!range.from || !range.to) return;
    setLoading(true);
    try {
      const [ov, pf, cs, fn] = await Promise.all([
        api.getAnalyticsOverview(range),
        api.getAnalyticsPerformance(range),
        api.getAnalyticsCsPerformance(range),
        api.getAnalyticsPipelineFunnel(),
      ]);
      setOverview(ov);
      setPerf(pf);
      setCsPerf(cs || []);
      // pipeline-funnel returns an array [{stage, count, value}]
      setFunnel(
        (fn || []).map((item) => ({
          stage: item.stage,
          label: STAGE_NAMES[item.stage] || item.stage,
          count: item.count || 0,
          value: item.value || 0,
        }))
      );
    } catch (e) {
      console.error("Gagal muat laporan:", e);
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => { loadData(); }, [loadData]);

  function handleExportRingkasan() {
    exportToExcel([
      { Metrik: "Pelanggan Baru",    Nilai: overview?.newCustomers || 0 },
      { Metrik: "Total Order",       Nilai: overview?.totalOrders || 0 },
      { Metrik: "Nilai Penjualan",   Nilai: formatRupiah(overview?.totalOrderValue || 0) },
      { Metrik: "Total Percakapan",  Nilai: perf?.totalConversations || 0 },
      { Metrik: "Avg Response",      Nilai: Math.round(perf?.avgResponseMinutes || 0) + " mnt" },
      { Metrik: "Closing Rate",      Nilai: perf?.closingRate ? (perf.closingRate * 100).toFixed(1) + "%" : "0%" },
    ], `laporan-ringkasan-${range.from}-${range.to}`);
  }

  function handleExportCS() {
    exportToExcel(
      csPerf.map((r) => ({
        "Sales Person":        r.name,
        "Total Percakapan":    r.totalConversations,
        "Avg Response (mnt)":  Math.round(r.avgResponseMinutes || 0),
        "Closing Rate (%)":    r.closingRate ? (r.closingRate * 100).toFixed(1) : 0,
        "Total Nilai Order":   formatRupiah(r.totalOrderValue || 0),
      })),
      `laporan-cs-${range.from}-${range.to}`
    );
  }

  const monthlyRevenue   = overview?.monthlyRevenue || [];
  const monthlyCustomers = overview?.monthlyCustomers || [];
  const channelBreakdown = overview?.channelBreakdown || [];

  return (
    <div style={{ padding: "0 0 40px" }}>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Laporan Analitik</h1>
          <p style={{ margin: "4px 0 0", color: "var(--text-muted)", fontSize: 13 }}>
            Data dinamis berdasarkan periode yang dipilih
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button className="btn btn-ghost btn-sm" onClick={loadData} disabled={loading}>
            <RefreshCw size={14} /> Refresh
          </button>
          <button className="btn btn-ghost btn-sm" onClick={handleExportRingkasan}>
            <Download size={14} /> Export
          </button>
          <DateRangePicker value={range} onChange={setRange} />
        </div>
      </div>

      {/* Tabs */}
      <div className="laporan-tabs">
        {TABS.map((t) => (
          <button key={t} className={`laporan-tab ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>

      <div style={{ paddingTop: 24 }}>
        {loading && (
          <div style={{ textAlign: "center", padding: "60px 0", color: "var(--text-muted)" }}>
            <p>Memuat data laporan...</p>
          </div>
        )}

        {!loading && (
          <>
            {/* ── RINGKASAN ── */}
            {tab === "Ringkasan" && (
              <div>
                <div className="stat-row" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginBottom: 24 }}>
                  <KpiBox label="Pelanggan Baru" value={(overview?.newCustomers || 0).toLocaleString("id-ID")} growth={overview?.growthCustomers} color="#6366f1" />
                  <KpiBox label="Total Order" value={(overview?.totalOrders || 0).toLocaleString("id-ID")} growth={overview?.growthOrders} color="#3b82f6" />
                  <KpiBox label="Nilai Penjualan" value={formatRupiah(overview?.totalOrderValue || 0)} growth={overview?.growthOrderValue} color="#22c55e" />
                  <KpiBox label="Closing Rate" value={perf?.closingRate != null ? `${perf.closingRate}%` : "—"} sub="percakapan selesai / total" color="#f59e0b" />
                </div>

                <div className="laporan-grid" style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 20, marginBottom: 20 }}>
                  <div className="settings-card">
                    <h3 style={{ marginTop: 0, fontSize: 15, fontWeight: 700 }}>Pendapatan Bulanan</h3>
                    {monthlyRevenue.length === 0 ? <p style={{ color: "var(--text-muted)" }}>Belum ada data.</p> : (
                      <ResponsiveContainer width="100%" height={200}>
                        <AreaChart data={monthlyRevenue}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                          <XAxis dataKey="month" tickFormatter={labelBulan} style={{ fontSize: 11 }} />
                          <YAxis tickFormatter={(v) => `${(v / 1_000_000).toFixed(0)}jt`} style={{ fontSize: 11 }} />
                          <Tooltip formatter={(v) => [formatRupiah(v), "Pendapatan"]} />
                          <Area type="monotone" dataKey="value" stroke="#6366f1" fill="#ede9fe" strokeWidth={2} />
                        </AreaChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                  <div className="settings-card">
                    <h3 style={{ marginTop: 0, fontSize: 15, fontWeight: 700 }}>Channel Masuk</h3>
                    {channelBreakdown.length === 0 ? <p style={{ color: "var(--text-muted)" }}>Belum ada data.</p> : (
                      <ResponsiveContainer width="100%" height={200}>
                        <PieChart>
                          <Pie data={channelBreakdown} dataKey="count" nameKey="channel"
                            cx="50%" cy="50%" outerRadius={72}
                            label={({ channel, percent }) => `${channel === "WHATSAPP" ? "WA" : "IG"} ${(percent * 100).toFixed(0)}%`}>
                            {channelBreakdown.map((e) => (
                              <Cell key={e.channel} fill={CHANNEL_COLORS[e.channel] || "#6366f1"} />
                            ))}
                          </Pie>
                          <Tooltip formatter={(v) => [v, "Percakapan"]} />
                        </PieChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </div>

                <div className="settings-card">
                  <h3 style={{ marginTop: 0, fontSize: 15, fontWeight: 700 }}>Pelanggan Baru per Bulan</h3>
                  {monthlyCustomers.length === 0 ? <p style={{ color: "var(--text-muted)" }}>Belum ada data.</p> : (
                    <ResponsiveContainer width="100%" height={180}>
                      <BarChart data={monthlyCustomers}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="month" tickFormatter={labelBulan} style={{ fontSize: 11 }} />
                        <YAxis style={{ fontSize: 11 }} />
                        <Tooltip />
                        <Bar dataKey="count" fill="#6366f1" name="Pelanggan Baru" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>
            )}

            {/* ── PERCAKAPAN ── */}
            {tab === "Percakapan" && (
              <div>
                <div className="stat-row" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginBottom: 24 }}>
                  <KpiBox label="Total Percakapan" value={(perf?.totalConversations || 0).toLocaleString("id-ID")} color="#6366f1" />
                  <KpiBox label="Open" value={(perf?.openCount || 0).toLocaleString("id-ID")} color="#f59e0b" />
                  <KpiBox label="Avg Response Time" value={formatDuration(perf?.avgResponseMinutes)} sub="waktu respons rata-rata" color="#3b82f6" />
                  <KpiBox label="Resolved" value={(perf?.resolvedCount || 0).toLocaleString("id-ID")} sub="percakapan selesai" color="#22c55e" />
                </div>
                <div className="laporan-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
                  <div className="settings-card">
                    <h3 style={{ marginTop: 0, fontSize: 15, fontWeight: 700 }}>Breakdown Channel</h3>
                    {channelBreakdown.length === 0 ? <p style={{ color: "var(--text-muted)" }}>Belum ada data.</p>
                      : channelBreakdown.map((row) => (
                        <div key={row.channel} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <div style={{ width: 10, height: 10, borderRadius: "50%", background: CHANNEL_COLORS[row.channel] || "#6366f1" }} />
                            <span style={{ fontWeight: 600 }}>{row.channel === "WHATSAPP" ? "WhatsApp" : "Instagram"}</span>
                          </div>
                          <span style={{ fontWeight: 700, fontSize: 18 }}>{row.count}</span>
                        </div>
                      ))}
                  </div>
                  <div className="settings-card">
                    <h3 style={{ marginTop: 0, fontSize: 15, fontWeight: 700 }}>Status Percakapan</h3>
                    {(perf?.statusBreakdown || []).length === 0
                      ? <p style={{ color: "var(--text-muted)" }}>Belum ada data.</p>
                      : (perf?.statusBreakdown || []).map((row) => (
                        <div key={row.status} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
                          <span className={`badge badge-${row.status?.toLowerCase()}`}>{row.status}</span>
                          <span style={{ fontWeight: 700, fontSize: 18 }}>{row.count}</span>
                        </div>
                      ))}
                  </div>
                </div>
              </div>
            )}

            {/* ── PENJUALAN ── */}
            {tab === "Penjualan" && (
              <div>
                <div className="stat-row" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginBottom: 24 }}>
                  <KpiBox label="Total Order" value={(overview?.totalOrders || 0).toLocaleString("id-ID")} color="#22c55e" />
                  <KpiBox label="Nilai Penjualan" value={formatRupiah(overview?.totalOrderValue || 0)} growth={overview?.growthOrderValue} color="#6366f1" />
                  <KpiBox label="Rata-rata per Order"
                    value={(overview?.totalOrders || 0) > 0 ? formatRupiah(Math.round((overview.totalOrderValue || 0) / overview.totalOrders)) : "—"}
                    sub="per transaksi" color="#f59e0b" />
                  <KpiBox label="Pelanggan Bertransaksi" value={(overview?.customersWithOrders || 0).toLocaleString("id-ID")} color="#3b82f6" />
                </div>
                <div className="settings-card">
                  <h3 style={{ marginTop: 0, fontSize: 15, fontWeight: 700 }}>Tren Pendapatan Bulanan</h3>
                  {monthlyRevenue.length === 0 ? <p style={{ color: "var(--text-muted)" }}>Belum ada data.</p> : (
                    <ResponsiveContainer width="100%" height={260}>
                      <BarChart data={monthlyRevenue}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="month" tickFormatter={labelBulan} style={{ fontSize: 11 }} />
                        <YAxis tickFormatter={(v) => `${(v / 1_000_000).toFixed(0)}jt`} style={{ fontSize: 11 }} />
                        <Tooltip formatter={(v) => [formatRupiah(v), "Pendapatan"]} />
                        <Bar dataKey="value" fill="#6366f1" name="Pendapatan" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>
            )}

            {/* ── PIPELINE ── */}
            {tab === "Pipeline" && (
              <div>
                <div className="settings-card" style={{ marginBottom: 20 }}>
                  <h3 style={{ marginTop: 0, fontSize: 15, fontWeight: 700 }}>Sales Pipeline Funnel</h3>
                  {funnel.length === 0 ? <p style={{ color: "var(--text-muted)" }}>Belum ada data pipeline.</p> : (
                    <div style={{ display: "flex", gap: 2, borderRadius: 10, overflow: "hidden" }}>
                      {funnel.map((item, i) => (
                        <div key={item.stage} style={{ flex: 1, background: STAGE_COLORS[item.stage], padding: "18px 14px", position: "relative" }}>
                          <p style={{ color: "#fff", fontWeight: 800, fontSize: 24, margin: "0 0 4px" }}>{item.count}</p>
                          <p style={{ color: "rgba(255,255,255,0.9)", fontSize: 12, margin: "0 0 6px", fontWeight: 700 }}>{item.label}</p>
                          <p style={{ color: "rgba(255,255,255,0.75)", fontSize: 11, margin: 0 }}>{formatRupiah(item.value)}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="settings-card" style={{ padding: 0, overflow: "hidden" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ background: "var(--bg-secondary)" }}>
                        {["Stage", "Jumlah", "Total Nilai", "Persentase"].map((h) => (
                          <th key={h} style={{ padding: "10px 16px", textAlign: "left", fontSize: 12, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {funnel.map((item) => {
                        const total = funnel.reduce((s, f) => s + f.count, 0);
                        const pct = total > 0 ? ((item.count / total) * 100).toFixed(1) : "0";
                        return (
                          <tr key={item.stage} style={{ borderBottom: "1px solid var(--border)" }}>
                            <td style={{ padding: "12px 16px" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <div style={{ width: 10, height: 10, borderRadius: "50%", background: STAGE_COLORS[item.stage] }} />
                                <span style={{ fontWeight: 700 }}>{item.label}</span>
                              </div>
                            </td>
                            <td style={{ padding: "12px 16px", fontWeight: 800, fontSize: 18 }}>{item.count}</td>
                            <td style={{ padding: "12px 16px" }}>{formatRupiah(item.value)}</td>
                            <td style={{ padding: "12px 16px" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <div style={{ width: 80, background: "#f3f4f6", borderRadius: 4, height: 6 }}>
                                  <div style={{ width: `${pct}%`, background: STAGE_COLORS[item.stage], height: 6, borderRadius: 4 }} />
                                </div>
                                <span style={{ fontSize: 12, fontWeight: 700 }}>{pct}%</span>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ── PERFORMA CS ── */}
            {tab === "Performa CS" && (
              <div>
                <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
                  <button className="btn btn-ghost btn-sm" onClick={handleExportCS}>
                    <Download size={14} /> Export Excel
                  </button>
                </div>

                {csPerf.length > 0 && (
                  <div className="stat-row" style={{ gridTemplateColumns: "repeat(3, 1fr)", marginBottom: 24 }}>
                    <KpiBox label="Anggota Tim Aktif" value={csPerf.length} color="#6366f1" />
                    <KpiBox label="Total Percakapan" value={csPerf.reduce((s, r) => s + (r.totalConversations || 0), 0)} color="#3b82f6" />
                    <KpiBox label="Total Nilai Order" value={formatRupiah(csPerf.reduce((s, r) => s + (r.totalOrderValue || 0), 0))} color="#22c55e" />
                  </div>
                )}

                <div className="settings-card" style={{ padding: 0, overflow: "hidden", marginBottom: 20 }}>
                  <table className="user-table" style={{ width: "100%" }}>
                    <thead>
                      <tr>
                        {["Nama", "Total Percakapan", "Avg Response", "Closing Rate", "Nilai Order"].map((h) => (
                          <th key={h}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {csPerf.map((row) => (
                        <tr key={row.userId}>
                          <td style={{ fontWeight: 700 }}>{row.name}</td>
                          <td style={{ textAlign: "center" }}>{row.totalConversations || 0}</td>
                          <td>{formatDuration(row.avgResponseMinutes)}</td>
                          <td>
                            <span style={{ fontWeight: 700, color: (row.closingRate || 0) >= 50 ? "#22c55e" : "#f59e0b" }}>
                              {row.closingRate != null ? `${row.closingRate}%` : "—"}
                            </span>
                          </td>
                          <td style={{ fontWeight: 600 }}>{formatRupiah(row.totalOrderValue || 0)}</td>
                        </tr>
                      ))}
                      {csPerf.length === 0 && (
                        <tr>
                          <td colSpan={5} style={{ textAlign: "center", padding: "32px 16px", color: "var(--text-muted)" }}>
                            Belum ada data performa CS pada periode ini.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {csPerf.length > 0 && (
                  <div className="settings-card">
                    <h3 style={{ marginTop: 0, fontSize: 15, fontWeight: 700 }}>Percakapan per CS</h3>
                    <ResponsiveContainer width="100%" height={Math.max(180, csPerf.length * 44)}>
                      <BarChart data={csPerf} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis type="number" style={{ fontSize: 11 }} />
                        <YAxis type="category" dataKey="name" style={{ fontSize: 12 }} width={100} />
                        <Tooltip />
                        <Bar dataKey="totalConversations" fill="#6366f1" name="Percakapan" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
