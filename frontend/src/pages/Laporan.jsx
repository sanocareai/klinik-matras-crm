import React, { useEffect, useState, useCallback } from "react";
import { Download, RefreshCw } from "lucide-react";
import { api } from "../api.js";
import DateRangePicker from "../components/DateRangePicker.jsx";
import { STAGE_LABELS } from "../utils/format.js";
import { makeRange, toApiParams, formatRangeText } from "../lib/dateRange.js";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs.jsx";
import { KpiRowSkeleton, ChartGridSkeleton } from "@/features/laporan/components/LaporanSkeleton.jsx";
import RingkasanTab from "@/features/laporan/components/RingkasanTab.jsx";
import PercakapanTab from "@/features/laporan/components/PercakapanTab.jsx";
import PenjualanTab from "@/features/laporan/components/PenjualanTab.jsx";
import PipelineTab from "@/features/laporan/components/PipelineTab.jsx";
import SalesReportTab from "@/features/laporan/components/SalesReportTab.jsx";
import TrafficTab from "@/features/laporan/components/TrafficTab.jsx";
// Lazy — lihat catatan yang sama di Customers.jsx: workbook export (xlsx +
// file-saver, ~285KB) dynamic-import di titik pakai, bukan static di atas.

// "Performa CS" → "Sales": tab ini bukan lagi tabel performa 4 kolom, tapi
// laporan penjualan per orang (beban percakapan → funnel → uang). Lihat
// features/laporan/components/SalesReportTab.jsx.
const TABS = ["Ringkasan", "Traffic", "Percakapan", "Penjualan", "Pipeline", "Sales"];

// Sufiks nama file export. Preset "Semua" tidak punya from/to, jadi jangan
// sampai jadi "laporan-null-null.xlsx".
const namaFile = (r) => (r?.from && r?.to ? `${r.from}-${r.to}` : "semua");

export default function Laporan() {
  const [tab, setTab] = useState("Ringkasan");
  const [range, setRange] = useState(() => makeRange("last_30_days"));

  const [overview, setOverview] = useState(null);
  const [summary, setSummary]   = useState(null);
  const [perf, setPerf]         = useState(null);
  const [salesReport, setSalesReport] = useState(null);
  const [funnel, setFunnel]     = useState([]);
  const [velocity, setVelocity] = useState(null);
  const [respTimeSeries, setRespTimeSeries] = useState(null);
  const [traffic, setTraffic] = useState(null);
  const [sourceDetail, setSourceDetail] = useState(null);
  const [loading, setLoading]   = useState(false);
  const [exporting, setExporting] = useState(false);

  const loadData = useCallback(async () => {
    // Preset "Semua" sengaja mengirim from/to kosong (= tanpa filter tanggal),
    // jadi JANGAN pakai `if (!range.from) return` seperti dulu — itu membuat
    // "Semua" tidak pernah memuat apa pun. Yang ditolak hanya rentang
    // setengah jadi (satu sisi terisi, sisi lain kosong).
    const params = toApiParams(range);
    const setengahJadi = (!!range.from) !== (!!range.to);
    if (setengahJadi) return;
    setLoading(true);
    try {
      const [ov, sm, pf, fn, sr, vl, rts, tr, lsd] = await Promise.all([
        api.getAnalyticsOverview(params),
        api.getBusinessSummary(params),
        api.getAnalyticsPerformance(params),
        // BUG YANG DIPERBAIKI: dulu dipanggil TANPA argumen, jadi corong
        // Pipeline selalu menampilkan data SEPANJANG WAKTU sementara header
        // halaman menyebut periode tertentu — tiga jendela waktu berbeda
        // dalam satu laporan. Sekarang semuanya memakai `params` yang sama.
        api.getAnalyticsPipelineFunnel(params),
        api.getSalesReport(params).catch(() => null),
        // .catch(null) — endpoint baru; kalau backend belum ter-deploy, tab
        // Pipeline tetap tampil (corong jalan) dan widget kecepatan jatuh ke
        // empty state, bukan menggagalkan seluruh halaman Laporan.
        api.getAnalyticsPipelineVelocity(params).catch(() => null),
        api.getResponseTimeSeries(params).catch(() => null),
        api.getTrafficReport(params).catch(() => null),
        api.getLeadSourceDetail(params).catch(() => null),
      ]);
      setOverview(ov);
      setSummary(sm);
      setPerf(pf);
      setSalesReport(sr);
      setVelocity(vl);
      setRespTimeSeries(rts);
      setTraffic(tr);
      setSourceDetail(lsd);
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

  // SATU tombol export untuk SELURUH laporan (bukan per-tab seperti dulu:
  // Ringkasan mengekspor 6 baris, Performa CS punya tombolnya sendiri, dan
  // tab lain tidak bisa diexport sama sekali). Isinya sheet terpisah per
  // bagian — lihat utils/exportLaporan.js.
  async function handleExport() {
    setExporting(true);
    try {
      const { exportLaporanWorkbook } = await import("../utils/exportLaporan.js");
      // `tab` menentukan isi file — tiap tab punya sheet-nya sendiri, tidak
      // lagi menulis semua sheet apa pun tab yang dibuka (lihat catatan bug
      // di utils/exportLaporan.js#SHEET_PER_TAB). Nama file ikut menyebut
      // tab-nya supaya beberapa file export tidak tertukar di folder Download.
      exportLaporanWorkbook({
        tab,
        periode: formatRangeText(range),
        namaFile: `laporan-${tab.toLowerCase()}-${namaFile(range)}`,
        summary, overview, perf, funnel, velocity, salesReport, traffic,
      });
    } catch (e) {
      alert(e.message || "Gagal membuat file export.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="dash-page" style={{ paddingBottom: 40 }}>
      <div className="page-header">
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Laporan Analitik</h1>
          <p style={{ margin: "4px 0 0", color: "var(--text-muted)", fontSize: 13 }}>
            Periode: {formatRangeText(range)}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button className="btn btn-ghost btn-sm" onClick={loadData} disabled={loading}>
            <RefreshCw size={14} /> Refresh
          </button>
          <button className="btn btn-ghost btn-sm" onClick={handleExport} disabled={loading || exporting}>
            <Download size={14} /> {exporting ? "Menyiapkan…" : `Export ${tab}`}
          </button>
          <DateRangePicker value={range} onChange={setRange} />
        </div>
      </div>

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
                  summary={summary} overview={overview} perf={perf}
                  funnel={funnel} onGoTab={setTab}
                />
              </TabsContent>

              <TabsContent value="Traffic">
                <TrafficTab traffic={traffic} sourceDetail={sourceDetail} />
              </TabsContent>

              <TabsContent value="Percakapan">
                <PercakapanTab perf={perf} channelBreakdown={overview?.channelBreakdown || []} />
              </TabsContent>

              <TabsContent value="Penjualan">
                <PenjualanTab overview={overview} summary={summary} />
              </TabsContent>

              <TabsContent value="Pipeline">
                <PipelineTab funnel={funnel} velocity={velocity} />
              </TabsContent>

              <TabsContent value="Sales">
                <SalesReportTab
                  report={salesReport}
                  respTimeSeries={respTimeSeries}
                  grossTotalPerusahaan={summary?.uang?.grossValue}
                  onExport={handleExport}
                />
              </TabsContent>
            </>
          )}
        </div>
      </Tabs>
    </div>
  );
}
