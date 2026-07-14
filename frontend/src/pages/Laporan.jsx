import React, { useEffect, useState, useCallback } from "react";
import { Download, RefreshCw } from "lucide-react";
import { api } from "../api.js";
import DateRangePicker from "../components/DateRangePicker.jsx";
import { formatRupiah, getDatePreset, STAGE_LABELS } from "../utils/format.js";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs.jsx";
import { KpiRowSkeleton, ChartGridSkeleton } from "@/features/laporan/components/LaporanSkeleton.jsx";
import RingkasanTab from "@/features/laporan/components/RingkasanTab.jsx";
import PercakapanTab from "@/features/laporan/components/PercakapanTab.jsx";
import PenjualanTab from "@/features/laporan/components/PenjualanTab.jsx";
import PipelineTab from "@/features/laporan/components/PipelineTab.jsx";
import PerformaCsTab from "@/features/laporan/components/PerformaCsTab.jsx";
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
    <div className="dash-page" style={{ paddingBottom: 40 }}>
      {/* BUG (fix): wrapper sebelumnya cuma punya paddingBottom (0 kiri/
          kanan/atas) — konten nempel rata ke tepi sidebar/browser, beda
          dari halaman lain (Dashboard dst pakai .dash-page, 28px/32px
          desktop, 16px mobile). Reuse class yang sama di sini. */}
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

              <TabsContent value="Performa CS">
                <PerformaCsTab csPerf={csPerf} targetMap={targetMap} onExport={handleExportCS} />
              </TabsContent>
            </>
          )}
        </div>
      </Tabs>
    </div>
  );
}
