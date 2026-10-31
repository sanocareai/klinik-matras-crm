import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { useTabs, useTabVisibility, useTabId } from "@/lib/TabsContext.jsx";
import { Download, RefreshCw } from "lucide-react";
import { api } from "../api.js";
import DateRangePicker from "../components/DateRangePicker.jsx";
import { STAGE_LABELS } from "../utils/format.js";
import { makeRange, makeCustomRange, toApiParams, formatRangeText } from "../lib/dateRange.js";
import { bacaUrlLaporan, tulisUrlLaporan, samaRentang } from "@/features/laporan/periodeLaporan.js";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs.jsx";
import { KpiRowSkeleton, ChartGridSkeleton } from "@/features/laporan/components/LaporanSkeleton.jsx";
import RingkasanTab from "@/features/laporan/components/RingkasanTab.jsx";
import PerformaTimTab from "@/features/laporan/components/PerformaTimTab.jsx";
import PipelineTab from "@/features/laporan/components/PipelineTab.jsx";
import SalesReportTab from "@/features/laporan/components/SalesReportTab.jsx";
import MarketingTab from "@/features/laporan/components/MarketingTab.jsx";
// Lazy — lihat catatan yang sama di Customers.jsx: workbook export (xlsx +
// file-saver, ~285KB) dynamic-import di titik pakai, bukan static di atas.

// "Performa CS" → "Sales": tab ini bukan lagi tabel performa 4 kolom, tapi
// laporan penjualan per orang (beban percakapan → funnel → uang). Lihat
// features/laporan/components/SalesReportTab.jsx.
// "Percakapan" + "Penjualan" DIGABUNG jadi "Performa Tim" (25 Agustus 2026,
// permintaan owner) — lihat features/laporan/components/PerformaTimTab.jsx.
// "Sales" ditaruh persis setelah "Ringkasan" (25 Agustus 2026, permintaan
// owner) — laporan sales (fokus penjualan) jadi tab kedua yang paling sering
// dibuka, bukan di ujung.
// "Marketing" (Okt 2026) MENGGANTIKAN tab Traffic + Akuisisi + Iklan: ringkasan semua sumber → detail sumber → Meta campaign → ad set → ad. Memuat laporan atribusinya sendiri
// dengan SATU filter periode (halaman ini); tren/pola lead memakai data traffic yang sudah dimuat di bawah. URL lama ?tab=Traffic|Akuisisi|Iklan dipetakan ke Marketing (lihat marketingLogic#petaTab).
const TABS = ["Ringkasan", "Sales", "Marketing", "Performa Tim", "Pipeline"];

// Sufiks nama file export. Preset "Semua" tidak punya from/to, jadi jangan
// sampai jadi "laporan-null-null.xlsx".
const namaFile = (r) => (r?.from && r?.to ? `${r.from}-${r.to}` : "semua");

function useOptionalTabs() { try { return useTabs(); } catch { return null; } }
// Tab shell lain boleh membiarkan Laporan tetap terpasang (hidden). replaceActivePath selalu menulis ke tab AKTIF, jadi efek yang memanggilnya hanya boleh jalan saat tab ini yang aktif.
function useTabIniAktif() { try { return useTabVisibility(); } catch { return true; } }
function useIdTab() { try { return useTabId(); } catch { return null; } }
// Penanda kepemilikan entri riwayat: tiap entri yang dibuat/ditempati halaman ini diberi id tab shell-nya, sehingga Back/Forward hanya menyinkronkan entri MILIK tab ini.
// Tanpa ini, Back dari tab shell lain membawa URL entri tab Laporan lain dan menimpa path tab yang sedang aktif.
const PENANDA = "tabShellId";
const tandaiRiwayat = (id) => { if (id == null) return; try { window.history.replaceState({ ...(window.history.state || {}), [PENANDA]: id }, ""); } catch { /* riwayat tidak tersedia */ } };

export default function Laporan() {
  // SATU sumber state untuk tab, periode, dan detail sumber Akuisisi: URL (?tab&dari&sampai&sumber). Refresh, tombol Back, berpindah tab, dan membuka detail sumber tidak mengubah periode.
  // Sebelumnya tab Akuisisi (30 hari) dan Iklan (7 hari) memegang rentang sendiri sehingga bisa berbeda dari filter global (bug 26 Okt 2026: global 1–26 Okt vs Akuisisi 26 Sep–25 Okt).
  const [searchParams, setSearchParams] = useSearchParams();
  const dariUrl = useMemo(() => bacaUrlLaporan(searchParams, TABS), [searchParams]);
  const tab = dariUrl.tab || "Ringkasan";
  // Default "Hari ini" (26 Agustus 2026, permintaan owner) — konsisten
  // dengan Dashboard yang sudah lama begini. Charts otomatis ikut per JAM
  // untuk rentang 1 hari (lihat seriesWindow() di routes/analytics.js).
  // rangeLokal menyimpan preset (label picker) dan kasus tanpa batas ('Semua'); bila URL membawa dari/sampai, URL yang menang.
  const [rangeLokal, setRangeLokal] = useState(() => makeRange("today"));
  const range = useMemo(() => {
    if (!dariUrl.dari) return rangeLokal;
    return samaRentang(rangeLokal, { from: dariUrl.dari, to: dariUrl.sampai }) ? rangeLokal : makeCustomRange(dariUrl.dari, dariUrl.sampai);
  }, [dariUrl.dari, dariUrl.sampai, rangeLokal]);
  // Di dalam shell bertab, halaman membaca lokasi milik TAB (TabbedContent), bukan URL browser — setSearchParams saja tidak
  // memperbarui path tab sehingga klik Sales/Traffic/Akuisisi/Iklan tidak berpindah (bug 28 Okt 2026). Pola sama dengan TabbedHub.
  const tabsCtx = useOptionalTabs();
  const tabIniAktif = useTabIniAktif();
  const idTab = useIdTab();
  const location = useLocation();
  // Keadaan Marketing yang tersimpan di URL (sumber, urutan, kolom, banding, drilldown Meta, peringkat, umur) — dibaca dari URL, diubah lewat ubahMarketing.
  const marketingKini = useMemo(() => ({ sumber: dariUrl.sumber, urut: dariUrl.urut, kolom: dariUrl.kolom, banding: dariUrl.banding, level: dariUrl.level, campaign: dariUrl.campaign, adset: dariUrl.adset, rank: dariUrl.rank, umur: dariUrl.umur }), [dariUrl]);
  const perbaruiUrl = useCallback((patch, { ganti = true } = {}) => {
    const p = tulisUrlLaporan(searchParams, {
      tab: patch.tab ?? tab, range: patch.range ?? range, marketing: patch.marketing === undefined ? ((patch.tab ?? tab) === "Marketing" ? marketingKini : {}) : patch.marketing,
    });
    if (tabsCtx?.replaceActivePath) {
      const q = p.toString();
      const tujuan = location.pathname + (q ? `?${q}` : "");
      // Navigasi Marketing (buka sumber/campaign/ad set) harus bisa ditutup dengan tombol Back, padahal replaceActivePath hanya REPLACE: tambahkan SATU entri riwayat dulu
      // (pushState), lalu replaceActivePath mengisi isinya (tab + router). Sinkron balik saat Back ada di efek popstate di bawah. Perubahan lain (periode, urutan, kolom) tetap replace.
      if (!ganti) { try { window.history.pushState({ ...(window.history.state || {}), [PENANDA]: idTab }, "", tujuan); } catch { /* riwayat tidak tersedia: tetap replace */ } }
      tabsCtx.replaceActivePath(tujuan);
      tandaiRiwayat(idTab);   // replaceActivePath mengganti objek state router: pasang lagi penanda pada entri ini
    } else {
      setSearchParams(p, { replace: ganti });
    }
  }, [searchParams, setSearchParams, tab, range, marketingKini, tabsCtx, location.pathname, idTab]);
  const setTab = useCallback((t) => perbaruiUrl({ tab: t, marketing: {} }, { ganti: false }), [perbaruiUrl]);
  const setRange = useCallback((r) => { setRangeLokal(r); perbaruiUrl({ range: r }); }, [perbaruiUrl]);
  // Ubah keadaan Marketing di URL. Navigasi (sumber, drilldown) = push sehingga tombol Back menutup detail; urutan/kolom/peringkat = replace. Periode selalu dipertahankan.
  const ubahMarketing = useCallback((patch, opsi = {}) => {
    const navigasi = "sumber" in patch || "level" in patch;
    perbaruiUrl({ tab: "Marketing", marketing: { ...marketingKini, ...patch } }, { ganti: opsi.ganti ?? !navigasi });
  }, [perbaruiUrl, marketingKini]);
  // Back/Forward browser pada halaman ini: router mengganti URL-nya, tetapi path TAB (yang dibaca halaman) harus disamakan — hanya bila URL kembali ke Laporan.
  useEffect(() => {
    if (!tabsCtx?.replaceActivePath || !tabIniAktif) return undefined;
    const sinkron = () => {
      // Hanya entri bertanda tab INI yang disinkronkan; entri tab lain/tanpa tanda dibiarkan agar path tab aktif tidak tertimpa.
      if (idTab == null || window.history.state?.[PENANDA] !== idTab) return;
      if (window.location.pathname === location.pathname) tabsCtx.replaceActivePath(window.location.pathname + window.location.search);
    };
    window.addEventListener("popstate", sinkron);
    return () => window.removeEventListener("popstate", sinkron);
  }, [tabsCtx, location.pathname, tabIniAktif, idTab]);
  // Back/Forward yang mendarat di entri milik tab Laporan yang sedang di BACKGROUND: aktifkan tab itu (isinya path tab yang tersimpan) alih-alih menimpa tab aktif.
  useEffect(() => {
    if (!tabsCtx?.switchTab || tabIniAktif || idTab == null) return undefined;
    const ke = () => { if (window.history.state?.[PENANDA] === idTab) tabsCtx.switchTab(idTab); };
    window.addEventListener("popstate", ke);
    return () => window.removeEventListener("popstate", ke);
  }, [tabsCtx, tabIniAktif, idTab]);
  // Entri riwayat yang sedang ditempati tab ini (saat dibuka/diaktifkan atau URL-nya berubah) diberi penanda.
  useEffect(() => {
    if (!tabIniAktif || idTab == null) return;
    if (window.location.pathname + window.location.search === location.pathname + location.search) tandaiRiwayat(idTab);
  }, [tabIniAktif, idTab, location.pathname, location.search]);
  // URL lama (?tab=Traffic|Akuisisi|Iklan) → ganti ke bentuk kanonik Marketing sekali (replace), periode dipertahankan.
  useEffect(() => { if (dariUrl.tabLama && tabIniAktif) perbaruiUrl({ tab: "Marketing", marketing: marketingKini }, { ganti: true }); }, [dariUrl.tabLama, tabIniAktif]); // eslint-disable-line react-hooks/exhaustive-deps

  const [overview, setOverview] = useState(null);
  const [summary, setSummary]   = useState(null);
  const [perf, setPerf]         = useState(null);
  const [salesReport, setSalesReport] = useState(null);
  // Dipakai untuk SEMUA metrik "% Target"/progres target bulanan — kartu
  // "Target Bulanan Tim" di RingkasanTab.jsx DAN kartu "Target Tim" +
  // leaderboard + tabel rincian di SalesReportTab.jsx — TIDAK BOLEH ikut
  // `range` yang dipilih user (26 Agustus 2026, laporan owner: begitu default
  // Laporan jadi "Hari ini", angka-angka ini jadi salah total — closing HARI
  // INI dibandingkan ke target SEBULAN PENUH, kelihatan seperti nyaris 0%
  // padahal sudah jauh lebih tinggi). Target itu sendiri sudah otomatis
  // "bulan berjalan" (SalesTarget dicari dari nowPartsWIB() di backend, bukan
  // dari `from`/`to`) — cuma progres pencapaiannya yang harus SELALU
  // month-to-date juga, apa pun rentang yang sedang dipilih (hari ini/
  // mingguan/bulanan/custom) untuk sisa halaman. Metrik LAIN yang memang
  // seharusnya ikut range (Nilai Penjualan, Konversi, Order per sales, dst)
  // TETAP baca dari `salesReport` biasa — tidak disentuh oleh state ini.
  const [salesReportBulanIni, setSalesReportBulanIni] = useState(null);
  const [funnel, setFunnel]     = useState([]);
  const [velocity, setVelocity] = useState(null);
  const [respTimeSeries, setRespTimeSeries] = useState(null);
  const [traffic, setTraffic] = useState(null);
  const [sourceDetail, setSourceDetail] = useState(null);
  const [loading, setLoading]   = useState(false);
  const [exporting, setExporting] = useState(false);
  const tokenData = useRef(0);
  const marketingRef = useRef(null);   // data Marketing yang sedang tampil, untuk Export XLSX
  const simpanMarketing = useCallback((d) => { marketingRef.current = d; }, []);
  const [versiRefresh, setVersiRefresh] = useState(0);   // menyegarkan juga laporan atribusi tab Marketing

  const loadData = useCallback(async () => {
    // Preset "Semua" sengaja mengirim from/to kosong (= tanpa filter tanggal),
    // jadi JANGAN pakai `if (!range.from) return` seperti dulu — itu membuat
    // "Semua" tidak pernah memuat apa pun. Yang ditolak hanya rentang
    // setengah jadi (satu sisi terisi, sisi lain kosong).
    const params = toApiParams(range);
    const setengahJadi = (!!range.from) !== (!!range.to);
    if (setengahJadi) return;
    const token = ++tokenData.current; const basi = () => token !== tokenData.current;   // ganti periode saat request berjalan: hasil lama dibuang
    setLoading(true);
    try {
      const [ov, sm, pf, fn, sr, vl, rts, tr, lsd, srBulanIni] = await Promise.all([
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
        // Lihat catatan panjang di useState salesReportBulanIni — SENGAJA
        // pakai preset "this_month", BUKAN `params`/`range` yang sedang aktif.
        api.getSalesReport(toApiParams(makeRange("this_month"))).catch(() => null),
      ]);
      if (basi()) return;
      setOverview(ov);
      setSummary(sm);
      setPerf(pf);
      setSalesReport(sr);
      setSalesReportBulanIni(srBulanIni);
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
      if (!basi()) console.error("Gagal muat laporan:", e);
    } finally {
      if (!basi()) setLoading(false);
    }
  }, [range]);

  useEffect(() => { loadData(); }, [loadData]);

  // SATU tombol export untuk SELURUH laporan (bukan per-tab seperti dulu:
  // Ringkasan mengekspor 6 baris, Performa CS punya tombolnya sendiri, dan
  // tab lain tidak bisa diexport sama sekali). Isinya sheet terpisah per
  // bagian — lihat utils/exportLaporan.js.
  // `extra.rekonSales` (tab Sales): payload rekonsiliasi Sales–Finance yang SAMA dengan yang tampil di layar — berkas = layar.
  async function handleExport(extra) {
    if (tab === "Marketing" && !marketingRef.current?.lap) { alert("Laporan Marketing belum selesai dimuat — tunggu sampai angka tampil, lalu Export lagi."); return; }
    const rekonSales = extra && !extra.nativeEvent && extra.rekonSales ? extra.rekonSales : null;
    setExporting(true);
    try {
      const { exportLaporanWorkbook } = await import("../utils/exportLaporan.js");
      // Definisi angka dari kontrak server (sheet "Definisi Angka"); bila gagal dimuat, berkas tetap dibuat tanpa sheet itu.
      const { muatKontrak } = await import("../features/finance/kontrakData.jsx");
      const kontrak = await muatKontrak().catch(() => null);
      // `tab` menentukan isi file — tiap tab punya sheet-nya sendiri, tidak
      // lagi menulis semua sheet apa pun tab yang dibuka (lihat catatan bug
      // di utils/exportLaporan.js#SHEET_PER_TAB). Nama file ikut menyebut
      // tab-nya supaya beberapa file export tidak tertukar di folder Download.
      exportLaporanWorkbook({
        tab,
        periode: formatRangeText(range),
        namaFile: `laporan-${tab.toLowerCase()}-${namaFile(range)}`,
        summary, overview, perf, funnel, velocity, salesReport, traffic, sourceDetail, rekonSales, kontrak,
        marketing: tab === "Marketing" ? marketingRef.current : null,
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
          <h1 className="t-page-title" style={{ margin: 0 }}>Laporan Analitik</h1>
          <p style={{ margin: "4px 0 0", color: "var(--text-muted)", fontSize: 13 }}>
            Periode: {formatRangeText(range)}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button className="btn btn-ghost btn-sm" onClick={() => { loadData(); setVersiRefresh((v) => v + 1); }} disabled={loading}>
            <RefreshCw size={14} /> Refresh
          </button>
          <button className="btn btn-primary btn-sm" onClick={handleExport} disabled={loading || exporting}>
            <Download size={14} /> {exporting ? "Menyiapkan…" : `Export ${tab}`}
          </button>
          <DateRangePicker value={range} onChange={setRange} />
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="crm-pills">
          {TABS.map((t) => (
            <TabsTrigger key={t} value={t}>{t}</TabsTrigger>
          ))}
        </TabsList>

        <div style={{ paddingTop: 24 }}>
          {tab === "Marketing" ? (
            // Marketing memuat laporan atribusinya sendiri dengan periode global di atas; tidak ikut skeleton agar state (urutan, drilldown, bagian yang dibuka) tidak hilang saat data traffic dimuat ulang.
            <TabsContent value="Marketing">
              <MarketingTab range={range} onUbahRentang={setRange} url={dariUrl} onUbah={ubahMarketing} traffic={loading ? null : traffic} memuatTraffic={loading} sourceDetail={sourceDetail} rangeParams={toApiParams(range)} versiRefresh={versiRefresh} onData={simpanMarketing} />
            </TabsContent>
          ) : loading ? (
            <div className="flex flex-col gap-5">
              <KpiRowSkeleton />
              <ChartGridSkeleton />
            </div>
          ) : (
            <>
              <TabsContent value="Ringkasan">
                <RingkasanTab
                  summary={summary} overview={overview} perf={perf}
                  funnel={funnel} onGoTab={setTab} range={range}
                  targetReport={salesReportBulanIni}
                />
              </TabsContent>

              <TabsContent value="Sales">
                <SalesReportTab
                  report={salesReport}
                  targetReport={salesReportBulanIni}
                  grossTotalPerusahaan={summary?.uang?.grossValue}
                  onExport={handleExport} range={range}
                />
              </TabsContent>

              <TabsContent value="Performa Tim">
                <PerformaTimTab
                  perf={perf} summary={summary}
                  respTimeSeries={respTimeSeries}
                  channelBreakdown={overview?.channelBreakdown || []}
                  salesReport={salesReport} range={range}
                />
              </TabsContent>

              <TabsContent value="Pipeline">
                <PipelineTab funnel={funnel} velocity={velocity} />
              </TabsContent>
            </>
          )}
        </div>
      </Tabs>
    </div>
  );
}
