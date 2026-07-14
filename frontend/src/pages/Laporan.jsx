import React, { useEffect, useState, useCallback } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Download, RefreshCw } from "lucide-react";
import { api } from "../api.js";
import DateRangePicker from "../components/DateRangePicker.jsx";
import { formatRupiah, formatDuration, getDatePreset, STAGE_LABELS } from "../utils/format.js";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs.jsx";
import { KpiRowSkeleton, ChartGridSkeleton } from "@/features/laporan/components/LaporanSkeleton.jsx";
import RingkasanTab from "@/features/laporan/components/RingkasanTab.jsx";
import PercakapanTab from "@/features/laporan/components/PercakapanTab.jsx";
import PenjualanTab from "@/features/laporan/components/PenjualanTab.jsx";
import PipelineTab from "@/features/laporan/components/PipelineTab.jsx";
// Lazy — lihat catatan yang sama di Customers.jsx: exportToExcel() (xlsx +
// file-saver, ~285KB) dynamic-import di titik pakai, bukan static di atas.

const TABS = ["Ringkasan", "Percakapan", "Penjualan", "Pipeline", "Performa CS"];

export default function Laporan() {
  const [tab, setTab] = useState("Ringkasan");
  const [range, setRange] = useState(getDatePreset("30d"));

  const [overview, setOverview] = useState(null);
  const [perf, setPerf]         = useState(null);
  const [csPerf, setCsPerf]     = useState([]);
  const [salesPerf, setSalesPerf] = useState([]);
  const [funnel, setFunnel]     = useState([]);
  const [loading, setLoading]   = useState(false);

  const loadData = useCallback(async () => {
    if (!range.from || !range.to) return;
    setLoading(true);
    try {
      // Target selalu pakai bulan saat ini (sama seperti Dashboard)
      const now = new Date();
      const [ov, pf, cs, fn, sp] = await Promise.all([
        api.getAnalyticsOverview(range),
        api.getAnalyticsPerformance(range),
        api.getAnalyticsCsPerformance(range),
        api.getAnalyticsPipelineFunnel(),
        api.getSalesPerformance({ year: now.getFullYear(), month: now.getMonth() + 1 }).catch(() => []),
      ]);
      setOverview(ov);
      setPerf(pf);
      setCsPerf(cs || []);
      setSalesPerf(sp || []);
      // pipeline-funnel returns an array [{stage, count, value}]
      setFunnel(
        (fn || []).map((item) => ({
          stage: item.stage,
          label: STAGE_LABELS[item.stage] || item.stage,
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

  async function handleExportRingkasan() {
    const { exportToExcel } = await import("../utils/export.js");
    exportToExcel([
      { Metrik: "Pelanggan Baru",    Nilai: overview?.newCustomers || 0 },
      { Metrik: "Total Order",       Nilai: overview?.totalOrders || 0 },
      { Metrik: "Nilai Penjualan",   Nilai: formatRupiah(overview?.totalOrderValue || 0) },
      { Metrik: "Total Percakapan",  Nilai: perf?.totalConversations || 0 },
      { Metrik: "Avg Response",      Nilai: Math.round(perf?.avgResponseMinutes || 0) + " mnt" },
      { Metrik: "Closing Rate",      Nilai: perf?.closingRate ? (perf.closingRate * 100).toFixed(1) + "%" : "0%" },
    ], `laporan-ringkasan-${range.from}-${range.to}`);
  }

  async function handleExportCS() {
    const { exportToExcel } = await import("../utils/export.js");
    const tMap = Object.fromEntries(salesPerf.map((r) => [r.userId, r]));
    exportToExcel(
      csPerf.map((r) => {
        const sp = tMap[r.userId];
        return {
          "Sales Person":       r.name,
          "Total Percakapan":   r.totalConversations,
          "Avg Response (mnt)": Math.round(r.avgResponseMinutes || 0),
          "Closing Rate":       r.closingRate != null ? `${r.closingRate}%` : "—",
          "Total Nilai Order":  formatRupiah(r.totalOrderValue || 0),
          "Target Bulanan":     sp?.target > 0 ? formatRupiah(sp.target) : "Belum Diset",
          "% Pencapaian":       sp?.percentToTarget != null ? `${sp.percentToTarget}%` : "—",
        };
      }),
      `laporan-cs-${range.from}-${range.to}`
    );
  }

  const monthlyRevenue   = overview?.monthlyRevenue || [];
  const monthlyCustomers = overview?.monthlyCustomers || [];
  const channelBreakdown = overview?.channelBreakdown || [];
  const targetMap = Object.fromEntries(salesPerf.map((r) => [r.userId, r]));

  return (
    <div style={{ padding: "0 0 40px" }}>
      {/* Header — TETAP CSS lama (belum migrasi Tailwind), konsisten dgn
          header halaman lain yang belum di-redesign. */}
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

      {/* Tabs — direstyle Tailwind (Radix Tabs, aksesibel), state & urutan
          tab SAMA PERSIS dengan sebelumnya. */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          {TABS.map((t) => (
            <TabsTrigger key={t} value={t}>{t}</TabsTrigger>
          ))}
        </TabsList>

        <div style={{ paddingTop: 24 }}>
          {loading ? (
            <div className="flex flex-col gap-5">
              <KpiRowSkeleton />
              <ChartGridSkeleton />
            </div>
          ) : (
            <>
              <TabsContent value="Ringkasan">
                <RingkasanTab
                  overview={overview} perf={perf}
                  monthlyRevenue={monthlyRevenue} monthlyCustomers={monthlyCustomers}
                  channelBreakdown={channelBreakdown}
                />
              </TabsContent>

              <TabsContent value="Percakapan">
                <PercakapanTab perf={perf} channelBreakdown={channelBreakdown} />
              </TabsContent>

              <TabsContent value="Penjualan">
                <PenjualanTab overview={overview} monthlyRevenue={monthlyRevenue} />
              </TabsContent>

              <TabsContent value="Pipeline">
                <PipelineTab funnel={funnel} />
              </TabsContent>

              {/* ── PERFORMA CS — SENGAJA TIDAK disentuh (sesi terpisah),
                  markup & styling lama dipertahankan apa adanya. ── */}
              <TabsContent value="Performa CS">
                <div>
                  <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
                    <button className="btn btn-ghost btn-sm" onClick={handleExportCS}>
                      <Download size={14} /> Export Excel
                    </button>
                  </div>

                  {csPerf.length > 0 && (
                    <div className="stat-row" style={{ gridTemplateColumns: "repeat(3, 1fr)", marginBottom: 24 }}>
                      <div className="stat-card" style={{ borderTop: "3px solid #6366f1" }}>
                        <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 6px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Anggota Tim Aktif</p>
                        <p style={{ fontSize: 26, fontWeight: 800, margin: 0, color: "var(--text-primary)" }}>{csPerf.length}</p>
                      </div>
                      <div className="stat-card" style={{ borderTop: "3px solid #3b82f6" }}>
                        <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 6px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Total Percakapan</p>
                        <p style={{ fontSize: 26, fontWeight: 800, margin: 0, color: "var(--text-primary)" }}>{csPerf.reduce((s, r) => s + (r.totalConversations || 0), 0)}</p>
                      </div>
                      <div className="stat-card" style={{ borderTop: "3px solid #22c55e" }}>
                        <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 6px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Total Nilai Order</p>
                        <p style={{ fontSize: 26, fontWeight: 800, margin: 0, color: "var(--text-primary)" }}>{formatRupiah(csPerf.reduce((s, r) => s + (r.totalOrderValue || 0), 0))}</p>
                      </div>
                    </div>
                  )}

                  <div className="settings-card laporan-performa-table-wrap" style={{ padding: 0, overflow: "hidden", marginBottom: 20 }}>
                    <table className="user-table" style={{ width: "100%" }}>
                      <thead>
                        <tr>
                          {["Nama", "Total Percakapan", "Avg Response", "Closing Rate", "Progress Target"].map((h) => (
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
                            <td style={{ minWidth: 180 }}>
                              {(() => {
                                const sp = targetMap[row.userId];
                                const target = sp?.target ?? 0;
                                const pct    = sp?.percentToTarget ?? null;
                                const barColor = !pct ? "#d1d5db"
                                               : pct >= 100 ? "#16a34a"
                                               : pct >= 50  ? "#2563eb"
                                               : "#f59e0b";
                                return (
                                  <div>
                                    <div style={{ fontSize: 12, marginBottom: 4 }}>
                                      <span style={{ fontWeight: 700 }}>{formatRupiah(row.totalOrderValue || 0)}</span>
                                      {target > 0 && (
                                        <span style={{ color: "var(--text-muted)" }}>{" / "}{formatRupiah(target)}</span>
                                      )}
                                    </div>
                                    <div style={{ height: 7, background: "#f3f4f6", borderRadius: 99, overflow: "hidden" }}>
                                      <div style={{
                                        height: "100%",
                                        width: `${Math.min(pct ?? 0, 100)}%`,
                                        background: barColor,
                                        borderRadius: 99,
                                        transition: "width 0.4s ease",
                                      }} />
                                    </div>
                                    <div style={{ fontSize: 11, marginTop: 3, fontWeight: 600, color: pct != null ? barColor : "var(--text-muted)" }}>
                                      {pct != null ? `${pct}%` : "Target belum diset"}
                                    </div>
                                  </div>
                                );
                              })()}
                            </td>
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
              </TabsContent>
            </>
          )}
        </div>
      </Tabs>
    </div>
  );
}
