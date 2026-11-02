import { formatUkuranLabel } from "@/utils/ukuranKasur.js";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CalendarDays, ChevronDown, ChevronRight, ClipboardList, Download, Info, RefreshCw, Search, SlidersHorizontal, User } from "lucide-react";
import { PanelSamping } from "@/components/ui/panel-samping.jsx";
import { FilterDropdown } from "@/components/ui/filter-dropdown.jsx";
import DateRangePicker from "@/components/DateRangePicker.jsx";
import SalinKode from "@/features/production/SalinKode.jsx";
import { teksJumlah, warnaKerja, warnaPosisi } from "@/features/production/orderListModel.js";
import { api } from "@/api.js";
import { PageContainer, PageHeader } from "@/components/ui/page.jsx";
import { Button } from "@/components/ui/button.jsx";
import { useHubRange } from "@/hooks/useHubParam.js";
import { Badge } from "@/components/ui/badge.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { cn } from "@/lib/utils.js";
import { formatTanggal } from "@/utils/formatDate.js";
import { UnitOverviewDrawer } from "@/features/production/UnitOverviewDrawer.jsx";
import OrderProduksiPanel from "@/features/production/OrderProduksiPanel.jsx";
import PkrRujukan from "@/features/production/PkrRujukan.jsx";
import { DELAY_TITLE, DISPLAY_STATUS_TABS, priorityOf, salesServicesText, statusOf } from "@/features/production/productionLabels.js";
import { KELENGKAPAN_BUKAN, KERJA_FILTER, bacaHitungKelengkapan, chipFilterAktif, jumlahFilterLainnya, parameterDaftar, ringkasAdopsi, sumberKerjaText, periodeDariUrl, periodeKeUrl, paramPeriode, periodeSemuaWaktu, PERIODE_BAWAAN } from "@/features/production/orderProduksiModel.js";
import FilterLainnya from "@/features/production/FilterLainnya.jsx";
import PilihanUrutan from "@/features/production/PilihanUrutan.jsx";
import ChipFilterAktif from "@/features/production/ChipFilterAktif.jsx";
import KelengkapanBaris from "@/features/production/KelengkapanBaris.jsx";

// Order Produksi (daftar unit) — adopsi Admin. TIGA status yang dipisah jelas dan berlabel teks:
//   Status order (sama dengan Sales/Delivery) · Posisi unit (fakta dokumen; tampil bila perlu perhatian) · Status kerja (pekerjaan Produksi).
// Tab saring = STATUS ORDER (Pengambilan · Diproses · Siap Kirim · Terkirim) supaya hitungannya sama dengan workspace lain; "Status kerja" disaring terpisah.
// Filter dan PAGINASI dilakukan di SERVER (work-orders?displayStatus=&statusKerja=&q=&page=&pageSize=). Tombol Export Excel memakai parameter yang SAMA persis dengan daftar yang tampil.
//
// ⚠️ Unit lama yang belum pernah masuk alur tahap tampil "Belum dijadwalkan" pada Status kerja — jujur, bukan bug dan tidak diisi dengan tebakan.
export const ORDER_SCOPES = Object.freeze([{ key: "aktif", label: "Aktif" }, { key: "semua", label: "Semua" }, { key: "riwayat", label: "Riwayat" }]);
const PAGE_SIZE = 50;
const ACTIVE_KEYS = Object.freeze(["PENGAMBILAN", "DIPROSES", "SIAP_KIRIM"]); // semua status order kecuali Terkirim

// `scope`: "aktif" = semua status kecuali Terkirim, "semua" = seluruhnya, "riwayat" = hanya Terkirim. Tab status ("" = semua dalam lingkup) dikendalikan di sini.
// `unitId`/`onUnitChange`: unit yang dibuka di panel dikendalikan pemanggil (?unit= di URL).
export default function ProductionWorkOrders({ initialStatus = "", scope = "", onScopeChange = null, headerExtra = null, unitId: unitIdProp, onUnitChange = null } = {}) {
  const [tab, setTab] = useState(scope === "riwayat" ? "TERKIRIM" : initialStatus);
  const firstScope = useRef(true);
  useEffect(() => { if (firstScope.current) { firstScope.current = false; return; } setTab(scope === "riwayat" ? "TERKIRIM" : ""); }, [scope]);
  const tabsShown = scope === "riwayat" ? [] : scope === "aktif" ? DISPLAY_STATUS_TABS.filter((t) => t.key !== "TERKIRIM") : DISPLAY_STATUS_TABS;
  const [kerja, setKerja] = useState("");
  const [kelengkapan, setKelengkapan] = useState([]); // penyaring cepat (gabungan/OR) — dihitung server
  const [periode, setPeriode] = useHubRange(periodeDariUrl, periodeKeUrl); // periode = tanggal order masuk (unit dibuat); pemilih standar app, tersimpan di URL, diterapkan saat Terapkan
  const rentang = useMemo(() => paramPeriode(periode), [periode]); const dari = rentang.dari ?? ""; const sampai = rentang.sampai ?? "";
  const [urut, setUrut] = useState("terbaru");
  const [posisi, setPosisi] = useState([]); // posisi unit (fisik; pilihan ganda = ATAU) — disaring server
  const [pic, setPic] = useState(""); // nama PIC, atau PIC_TANPA ("~tanpa") = belum ditugaskan
  const [target, setTarget] = useState(""); // terlambat | hari_ini | tujuh_hari | belum_ada (hari menurut WIB)
  const [hitung, setHitung] = useState(null); const [hitungMemuat, setHitungMemuat] = useState(false); const [versiHitung, setVersiHitung] = useState(0); const hitungReq = useRef(0);
  const [cari, setCari] = useState(() => { try { return new URLSearchParams(window.location.search).get("q") ?? ""; } catch { return ""; } }); // ?q= dari tautan "Lengkapi" (Laporan Produksi)
  const [qDebounced, setQDebounced] = useState("");
  const [rows, setRows] = useState(null);
  const [meta, setMeta] = useState({ total: 0, hasMore: false, page: 0, counts: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const reqRef = useRef(0);
  const [localUnitId, setLocalUnitId] = useState(null);
  const [unit360Id, setUnit360Id] = useState(null);
  const openUnitId = onUnitChange ? (unitIdProp || null) : localUnitId;
  const [lainnyaBuka, setLainnyaBuka] = useState(false); const pemicuRef = useRef(null); const tombolFilterRef = useRef(null);
  // HP (<= 640px): filter tambahan memakai lembar samping (layar penuh); lebih lebar = panel inline di bawah toolbar.
  const [hp, setHp] = useState(() => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(max-width: 640px)").matches : false));
  useEffect(() => { if (!window.matchMedia) return undefined; const m = window.matchMedia("(max-width: 640px)"); const f = () => setHp(m.matches); m.addEventListener?.("change", f); return () => m.removeEventListener?.("change", f); }, []);
  // Lebar KONTAINER daftar (bukan lebar layar): saat panel unit menempel dan daftar menyempit, Status order/kerja pindah ke dalam popover Filter supaya toolbar tetap ≤ 2 baris.
  const [lebarKontainer, setLebarKontainer] = useState(1200); const kontainerRef = useRef(null); const wadahFilterRef = useRef(null);
  useEffect(() => { const el = kontainerRef.current; if (!el || typeof ResizeObserver === "undefined") return undefined; const ro = new ResizeObserver(([e]) => setLebarKontainer(Math.round(e.contentRect.width))); ro.observe(el); return () => ro.disconnect(); }, []);
  const sempit = hp || lebarKontainer < 900;
  const [muatBaru, setMuatBaru] = useState(false); // true = memuat HALAMAN PERTAMA untuk filter baru (daftar lama diredupkan; jumlah lama tidak ditampilkan)
  // Layar lebar (>= 1200px): panel unit menempel di kanan daftar (daftar tetap terlihat dan bisa dipakai); di bawah itu panel menjadi lembar samping / layar penuh.
  const [dock, setDock] = useState(() => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(min-width: 1200px)").matches : false));
  useEffect(() => { if (!window.matchMedia) return undefined; const m = window.matchMedia("(min-width: 1200px)"); const f = () => setDock(m.matches); m.addEventListener?.("change", f); return () => m.removeEventListener?.("change", f); }, []);
  const [fokusPanel, setFokusPanel] = useState(null); // "bahan" = masuk untuk mencatat bahan: panel langsung ke Pemakaian aktual (tanpa melewati Status & target)
  const setDetailUnit = (u) => (onUnitChange ? onUnitChange(u?.id || null) : setLocalUnitId(u?.id || null));
  // Membuka panel unit tidak menulis apa pun. `el` = pemicu (baris/tombol) untuk mengembalikan fokus saat panel ditutup; `tab` = "bahan" | "pekerjaan" (selain itu tab bawaan).
  const bukaPanel = (u, el, tab) => { pemicuRef.current = el || document.activeElement; setFokusPanel(tab === "bahan" ? "bahan" : tab === "pekerjaan" ? "pekerjaan" : tab === "kelengkapan" ? "kelengkapan" : null); setDetailUnit(u); };
  const unitAktif = (u) => !["CANCELLED", "DELIVERED"].includes(u.status);
  // Daftar tidak punya tombol "Catat bahan": mencatat hanya dari panel, dan tombol di sana mengikuti izin server (izin.pemakaianAktual) — akun hanya-lihat tidak melihatnya.
  const [ekspor, setEkspor] = useState({ sibuk: false, ok: "", galat: "" });

  useEffect(() => { const t = setTimeout(() => setQDebounced(cari.trim()), 300); return () => clearTimeout(t); }, [cari]);

  // Filter status order yang dikirim ke server: tab tertentu, atau (tanpa tab) seluruh lingkup.
  const displayParam = useMemo(() => {
    if (tab) return tab;
    if (scope === "riwayat") return "TERKIRIM";
    if (scope === "aktif") return ACTIVE_KEYS.join(",");
    return undefined;
  }, [tab, scope]);
  const paramDaftar = useMemo(() => parameterDaftar({ q: qDebounced || undefined, kerja: kerja ? [kerja] : [], kelengkapan, urut, posisi, pic, target, ...rentang }), [qDebounced, kerja, kelengkapan, urut, posisi, pic, target, rentang]);
  // hitungan kelengkapan: lingkup + pencarian + status kerja + periode (TANPA pilihan kelengkapan itu sendiri), seluruh unit yang cocok di server
  // (filter posisi/PIC/target IKUT: jumlah kategori kekurangan dan pilihan PIC mengikuti hasil yang sama dengan daftar)
  const paramHitung = useMemo(() => ({ displayStatus: displayParam, q: qDebounced || undefined, statusKerja: kerja || undefined, posisi: posisi.length ? posisi.join(",") : undefined, pic: pic || undefined, target: target || undefined, ...rentang }), [displayParam, qDebounced, kerja, posisi, pic, target, rentang]);
  useEffect(() => {
    const id = ++hitungReq.current; setHitungMemuat(true);
    api.getKelengkapanHitung(paramHitung).then((h) => { if (id === hitungReq.current) setHitung(bacaHitungKelengkapan(h)); }).catch(() => { if (id === hitungReq.current) setHitung(null); }).finally(() => { if (id === hitungReq.current) setHitungMemuat(false); });
  }, [paramHitung, versiHitung]);
  const queryServer = useCallback((page) => ({ displayStatus: displayParam, ...paramDaftar, page: String(page), pageSize: String(PAGE_SIZE) }), [displayParam, paramDaftar]);

  useEffect(() => { setEkspor({ sibuk: false, ok: "", galat: "" }); }, [displayParam, paramDaftar]); // pesan ekspor lama tidak boleh menempel setelah filter berubah
  const fetchPage = useCallback(async (page, { append }) => {
    const id = ++reqRef.current;
    setLoading(true); setError(""); setMuatBaru(!append);
    try {
      const d = await api.getWorkOrders(queryServer(page));
      if (id !== reqRef.current) return;
      setRows((prev) => (append && prev ? prev.concat(d.units || []) : d.units || []));
      setMeta({ total: d.total ?? (d.units || []).length, hasMore: !!d.hasMore, page, counts: d.displayStatusCounts || {} });
    } catch (e) { if (id === reqRef.current) setError(e.message); } finally { if (id === reqRef.current) { setLoading(false); setMuatBaru(false); } }
  }, [queryServer]);
  useEffect(() => { fetchPage(1, { append: false }); }, [fetchPage]); // filter/pencarian berubah -> halaman 1
  const reload = useCallback(() => {
    setVersiHitung((v) => v + 1); // hasil dan hitungan ikut diperbarui setelah data dilengkapi
    // muat ulang semua halaman yang sudah terbuka (urut) supaya posisi pengguna tidak hilang setelah aksi
    const pages = Math.max(1, meta.page); const id = ++reqRef.current;
    setLoading(true);
    (async () => {
      try {
        let acc = []; let last = null;
        for (let p = 1; p <= pages; p += 1) { last = await api.getWorkOrders(queryServer(p)); acc = acc.concat(last.units || []); if (!last.hasMore) break; }
        if (id !== reqRef.current) return;
        setRows(acc); setMeta({ total: last?.total ?? acc.length, hasMore: !!last?.hasMore, page: Math.max(1, Math.ceil(acc.length / PAGE_SIZE)), counts: last?.displayStatusCounts || {} });
      } catch (e) { if (id === reqRef.current) setError(e.message); } finally { if (id === reqRef.current) setLoading(false); }
    })();
  }, [meta.page, queryServer]);

  const countOf = (key) => (key === "" ? (scope === "aktif" ? ACTIVE_KEYS : DISPLAY_STATUS_TABS.map((t) => t.key)).reduce((n, k) => n + (meta.counts[k] || 0), 0) : meta.counts[key] ?? 0);
  const scopeCount = (key) => (key === "aktif" ? ACTIVE_KEYS.reduce((n, k) => n + (meta.counts[k] || 0), 0) : key === "riwayat" ? meta.counts.TERKIRIM || 0 : DISPLAY_STATUS_TABS.reduce((n, t) => n + (meta.counts[t.key] || 0), 0));

  async function unduhExcel() {
    setEkspor({ sibuk: true, ok: "", galat: "" });
    try {
      const { blob, namaFile } = await api.eksporOrderProduksiXlsx({ displayStatus: displayParam, ...paramDaftar, scope: scope || undefined });
      const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = namaFile; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      setEkspor({ sibuk: false, ok: `${namaFile} diunduh — ${meta.total} unit sesuai filter yang sedang aktif.`, galat: "" });
    } catch (e) { setEkspor({ sibuk: false, ok: "", galat: e.status === 413 ? `${e.message}` : e.message || "Export gagal. Coba lagi." }); }
  }

  const kosong = !loading && rows && rows.length === 0;
  const chip = useMemo(() => chipFilterAktif({ scope, tab, kerja, cari: qDebounced, dari, sampai, urut, posisi, pic, target, kelengkapan }, { statusOrderLabel: (k) => DISPLAY_STATUS_TABS.find((t) => t.key === k)?.label ?? k, fmtTgl: formatTanggal }), [scope, tab, kerja, qDebounced, dari, sampai, urut, posisi, pic, target, kelengkapan]);
  const adaFilter = chip.length > 0;
  const subtitle = scope === "riwayat" ? "Unit yang sudah terkirim ke pelanggan." : "Pantau unit dan lanjutkan pekerjaan.";
  const jumlahFilterLain = jumlahFilterLainnya({ posisi, pic, target, kelengkapan });
  const opsiStatusOrder = tabsShown.map((t) => ({ value: t.key, label: t.label }));
  const opsiKerja = KERJA_FILTER.map((k) => ({ value: k.key, label: k.label }));
  // Reset: semua filter daftar kembali ke bawaan (pencarian, status order/kerja, periode, posisi, PIC, target, kelengkapan, urutan). Antrean Aktif/Riwayat/Semua TIDAK berubah.
  const hapusFilter = () => { setCari(""); setQDebounced(""); setKerja(""); setKelengkapan([]); setPeriode(periodeSemuaWaktu()); setTab(scope === "riwayat" ? "TERKIRIM" : ""); setUrut("terbaru"); setPosisi([]); setPic(""); setTarget(""); };
  const hapusChip = (c) => {
    switch (c.kelompok) {
      case "cari": setCari(""); setQDebounced(""); break;
      case "statusOrder": setTab(""); break;
      case "kerja": setKerja(""); break;
      case "periode": setPeriode(periodeSemuaWaktu()); break;
      case "posisi": setPosisi((t) => t.filter((k) => k !== c.nilai)); break;
      case "pic": setPic(""); break;
      case "target": setTarget(""); break;
      case "kelengkapan": setKelengkapan((t) => t.filter((k) => k !== c.nilai)); break;
      case "urut": setUrut("terbaru"); break;
      default: break;
    }
  };
  const jumlahHasilTeks = rows && !muatBaru ? `${meta.total} unit` : "Memuat…";
  // Filter di popover/lembar memakai DRAF: berlaku hanya saat Terapkan; Batal/menutup membuang draf. Reset semua = definisi yang sama dengan Reset di baris chip (berlaku langsung).
  const tutupFilter = () => { setLainnyaBuka(false); tombolFilterRef.current?.focus({ preventScroll: true }); };
  const terapkanFilter = (d) => { setPosisi(d.posisi); setPic(d.pic); setTarget(d.target); setKelengkapan(d.kelengkapan); if (sempit) { setTab(d.tab); setKerja(d.kerja); } tutupFilter(); };
  const resetDariFilter = () => { hapusFilter(); tutupFilter(); };
  const isiFilter = (tanpaKepala) => (
    <FilterLainnya nilai={{ tab, kerja, posisi, pic, target, kelengkapan }} tabsShown={tabsShown} opsiKerja={opsiKerja} sempit={sempit} hitung={hitung} memuat={hitungMemuat} scope={scope}
      onLihatRiwayat={onScopeChange ? () => { setLainnyaBuka(false); onScopeChange("riwayat"); } : null} onTerapkan={terapkanFilter} onBatal={tutupFilter} onResetSemua={resetDariFilter} adaFilter={adaFilter} tanpaKepala={tanpaKepala} judulId="prod-ol-filter-judul" />
  );
  // popover: klik di luar dan Esc menutup (membuang draf); klik pada pemicu ditangani pemicunya sendiri
  useEffect(() => {
    if (!lainnyaBuka || hp) return undefined;
    const luar = (e) => { if (wadahFilterRef.current?.contains(e.target) || e.target.closest?.("[data-filter-pemicu]")) return; setLainnyaBuka(false); };
    const esc = (e) => { if (e.key === "Escape") { e.stopPropagation(); tutupFilter(); } };
    document.addEventListener("pointerdown", luar, true); document.addEventListener("keydown", esc, true);
    return () => { document.removeEventListener("pointerdown", luar, true); document.removeEventListener("keydown", esc, true); };
  }, [lainnyaBuka, hp]); // eslint-disable-line react-hooks/exhaustive-deps
  // tinggi popover mengikuti sisa layar di bawah pemicu (isi menggulir di dalam), supaya tidak melewati tepi bawah
  useEffect(() => {
    if (!lainnyaBuka || hp) return undefined;
    const ukur = () => { const el = wadahFilterRef.current; const p = el?.querySelector(".prod-ol-popover"); const bar = el?.parentElement; if (!el || !p || !bar) return; p.style.setProperty("--prod-pop-maks", `${Math.max(320, Math.floor(window.innerHeight - bar.getBoundingClientRect().bottom - 24))}px`); };
    ukur(); window.addEventListener("resize", ukur); window.addEventListener("scroll", ukur, true);
    return () => { window.removeEventListener("resize", ukur); window.removeEventListener("scroll", ukur, true); };
  }, [lainnyaBuka, hp]);
  useEffect(() => { if (lainnyaBuka && !hp) wadahFilterRef.current?.querySelector("[data-testid=filter-lainnya-isi] input, [data-testid=filter-lainnya-isi] select")?.focus({ preventScroll: true }); }, [lainnyaBuka, hp]);
  const bukaBaris = (u, el) => bukaPanel(u, el);
  const unikKurang = hitung?.unik ?? 0; const belumDinilai = hitung?.dataOrder?.belumDinilai ?? 0;

  const utama = (
    <>
      <PageHeader
        title={onScopeChange || scope ? "Order Produksi" : "Work Order"}
        subtitle={subtitle}
        actions={
          <>
            {headerExtra}
            <Button variant="neutral" size="sm" className="prod-ol-tombol-kepala" data-testid="order-export-excel" onClick={unduhExcel} disabled={ekspor.sibuk || loading || !rows?.length} title="Unduh .xlsx sesuai filter dan pencarian yang sedang aktif">
              <Download size={17} aria-hidden /> {ekspor.sibuk ? "Menyiapkan…" : "Export Excel"}
            </Button>
            <Button variant="neutral" size="sm" className="prod-ol-tombol-kepala" onClick={reload} disabled={loading}>
              <RefreshCw size={17} className={loading ? "animate-spin motion-reduce:animate-none" : ""} aria-hidden /> <span className="max-sm:sr-only">Muat ulang</span>
            </Button>
          </>
        }
      />

      <div className="prod-stack">
        {ekspor.ok && <p role="status" data-testid="order-export-ok" className="prod-umpan ok m-0">{ekspor.ok}</p>}
        {ekspor.galat && <p role="alert" data-testid="order-export-galat" className="prod-umpan galat m-0">{ekspor.galat}</p>}

        <section className="prod-ol" aria-label="Daftar order produksi" ref={kontainerRef}>
          {/* Baris 1: antrean (Aktif / Riwayat / Semua) + pencarian */}
          <div className="prod-ol-baris1">
            {onScopeChange && (
              <div role="tablist" aria-label="Antrean order produksi" className="prod-ol-scope" data-testid="order-filter">
                {ORDER_SCOPES.map((sc) => {
                  const n = rows ? scopeCount(sc.key) : null;
                  return (
                    <button key={sc.key} type="button" role="tab" aria-selected={scope === sc.key} data-testid={`order-scope-${sc.key}`} onClick={() => onScopeChange(sc.key)} className={cn("prod-ol-scope-item", scope === sc.key && "aktif")}>
                      {sc.label}{n != null && <span>{n}</span>}
                    </button>
                  );
                })}
              </div>
            )}
            <label className="prod-ol-cari">
              <span className="prod-sr">Cari kode unit, nomor order, atau nama pelanggan</span>
              <Search size={18} className="prod-ol-cari-ikon" aria-hidden />
              <input type="search" value={cari} onChange={(e) => setCari(e.target.value)} placeholder="Cari pelanggan, unit, atau order…" aria-label="Cari unit" />
            </label>
          </div>

          {/* Baris 2: filter utama (status order, status kerja, periode) + Filter lainnya (urutan, kelengkapan) */}
          <div className="prod-ol-baris2" data-testid="periode-urutan">
            {!sempit && tabsShown.length > 0 && <FilterDropdown value={tab} onChange={setTab} options={opsiStatusOrder} placeholder="Semua status order" ariaLabel="Saring status order" triggerClassName="prod-filter-pemicu" />}
            {!sempit && <FilterDropdown value={kerja} onChange={setKerja} options={opsiKerja} placeholder="Semua status kerja" ariaLabel="Saring status kerja" triggerClassName="prod-filter-pemicu" />}
            <span data-testid="periode-picker" className={cn("prod-ol-periode", periode?.preset === PERIODE_BAWAAN && "semua")} title="Periode memakai tanggal order masuk (unit dibuat), WIB"><DateRangePicker value={periode} onChange={setPeriode} showCompare={false} /></span>
            <PilihanUrutan value={urut} onChange={setUrut} ringkas={sempit} />
            <div className="prod-ol-filter-wadah" ref={wadahFilterRef}>
              <button type="button" ref={tombolFilterRef} data-filter-pemicu className={cn("prod-ol-lainnya", (lainnyaBuka || jumlahFilterLain > 0) && "aktif")} aria-expanded={lainnyaBuka} aria-controls={hp ? undefined : "prod-ol-lainnya-isi"} aria-haspopup="dialog" data-testid="filter-lainnya" onClick={() => setLainnyaBuka((v) => !v)}>
                <SlidersHorizontal size={17} aria-hidden /> Filter{jumlahFilterLain > 0 && <span className="prod-ol-lainnya-n" aria-label={`${jumlahFilterLain} filter aktif`}>{jumlahFilterLain}</span>}
              </button>
              {lainnyaBuka && !hp && <div id="prod-ol-lainnya-isi" className="prod-ol-popover" role="dialog" aria-label="Filter order produksi" data-testid="filter-popover">{isiFilter(false)}</div>}
            </div>
          </div>

          {/* Hasil + filter aktif (chip yang bisa dihapus) + Reset */}
          <ChipFilterAktif chip={chip} onHapus={hapusChip} onReset={hapusFilter} jumlah={jumlahHasilTeks} />

          {/* Ringkasan kelengkapan: satu baris, rincian bisa dibuka (angka & definisi tetap tersedia) */}
          {(unikKurang > 0 || belumDinilai > 0 || kelengkapan.length > 0) && (
            <div className={cn("prod-ol-bar", unikKurang > 0 ? "kurang" : "netral")} data-testid="kel-bar">
              <AlertCircle size={20} aria-hidden />
              <span className="prod-ol-bar-teks" data-testid="kel-unik-ringkas">{unikKurang > 0 ? `${unikKurang} unit perlu dilengkapi` : `${belumDinilai} unit belum dinilai kelengkapannya`}</span>
              <button type="button" className="prod-ol-bar-rincian" aria-expanded={lainnyaBuka} aria-controls={hp ? undefined : "prod-ol-lainnya-isi"} data-filter-pemicu data-testid="kel-rincian" onClick={() => setLainnyaBuka((v) => !v)}>Rincian <ChevronDown size={16} className={lainnyaBuka ? "rotate-180" : undefined} aria-hidden /></button>
            </div>
          )}
          {error && (
            <div role="alert" className="prod-umpan galat flex flex-wrap items-center justify-between gap-2">
              <span>{error}</span><Button variant="secondary" size="sm" className="min-h-[44px]" onClick={reload}>Coba lagi</Button>
            </div>
          )}

          {kosong ? (
            <EmptyState icon={ClipboardList} title="Tidak ada unit yang cocok"
              description={adaFilter ? "Tidak ada unit dengan kombinasi filter ini. Hapus salah satu chip filter di atas atau reset semuanya." : "Belum ada unit di lingkup ini."}
              action={adaFilter ? <Button variant="secondary" size="sm" className="min-h-[44px]" onClick={hapusFilter}>Reset filter</Button> : null} />
          ) : (
            <>
              <div className={cn("prod-ol-tabel hidden lg:block", muatBaru && "memuat")} role="table" aria-label="Order produksi" aria-busy={muatBaru || undefined} aria-rowcount={rows ? rows.length + 1 : undefined}>
                <div className="prod-ol-kepala" role="row">
                  <span role="columnheader">Pelanggan &amp; unit</span><span role="columnheader">Posisi unit</span><span role="columnheader">Pekerjaan</span><span role="columnheader">Target &amp; PIC</span><span role="columnheader" className="prod-sr">Buka</span>
                </div>
                {loading && !rows && [0, 1, 2, 3, 4].map((i) => <div key={i} className="prod-ol-baris prod-ol-skel" role="row" aria-hidden><span /><span /><span /><span /><span /></div>)}
                {rows?.map((u) => <BarisUnit key={u.id} u={u} aktifId={openUnitId} onBuka={bukaBaris} />)}
              </div>

              <ul className={cn("prod-ol-kartu m-0 list-none p-0 lg:hidden", muatBaru && "memuat")} aria-label="Order produksi" aria-busy={muatBaru || undefined}>
                {loading && !rows && [0, 1, 2, 3].map((i) => <li key={i} className="prod-ol-kartu-item prod-ol-skel" aria-hidden><span /><span /></li>)}
                {rows?.map((u) => <KartuUnitMobil key={u.id} u={u} aktifId={openUnitId} onBuka={bukaBaris} />)}
              </ul>

              <div className="prod-ol-kaki" data-testid="order-rowcount" title="Jumlah ini mengikuti semua filter yang aktif (dihitung server atas seluruh hasil). Angka pada Aktif/Riwayat/Semua adalah total unit per antrean. Daftar dimuat bertahap dari server.">
                <span>{rows && !muatBaru ? teksJumlah({ dimuat: rows.length, total: meta.total, hasMore: meta.hasMore }) : "Memuat…"}</span>
                {meta.hasMore && (
                  <Button variant="secondary" size="sm" className="prod-ol-lagi" data-testid="order-load-more" disabled={loading} onClick={() => fetchPage(meta.page + 1, { append: true })}>
                    {loading ? "Memuat…" : `Muat berikutnya`} <ChevronDown size={16} aria-hidden />
                  </Button>
                )}
              </div>
            </>
          )}

          <details className="prod-ol-tentang" data-testid="arti-status">
            <summary><Info size={18} aria-hidden /> Tentang status dan kelengkapan <ChevronRight size={18} className="prod-ol-tentang-panah" aria-hidden /></summary>
            <dl>
              <div><dt>Status order</dt><dd>Status di Sales (Pengambilan, Diproses, Siap Kirim, Terkirim). Dikelola Sales/Delivery; mengubahnya dari sini berlaku di semua workspace.</dd></div>
              <div><dt>Posisi unit</dt><dd>Di mana unit fisik sekarang, menurut dokumen jemput, terima, dan kirim. Tidak diturunkan dari status order.</dd></div>
              <div><dt>Status kerja</dt><dd>Pekerjaan Produksi: dicatat Admin atau dari aplikasi Meja. Mencatatnya tidak mengubah status order, QC, atau stok.</dd></div>
              <div><dt>Kelengkapan</dt><dd>{KELENGKAPAN_BUKAN} “Belum dinilai” berbeda dari “lengkap”.</dd></div>
            </dl>
          </details>
        </section>
      </div>
    </>
  );

  const lembarFilter = hp && (
    <PanelSamping open={lainnyaBuka} onOpenChange={setLainnyaBuka} judul="Filter" subjudul={<span data-testid="lembar-filter-ringkas">{jumlahFilterLain > 0 ? `${jumlahFilterLain} kelompok filter aktif` : "Belum ada filter tambahan"} · {jumlahHasilTeks}</span>} lebar={480} contentProps={{ "data-testid": "lembar-filter" }} onCloseAutoFocus={(e) => { e.preventDefault(); tombolFilterRef.current?.focus({ preventScroll: true }); }}>
      <div className="prod-fl-lembar">{isiFilter(true)}</div>
    </PanelSamping>
  );

  const panel = (
    <OrderProduksiPanel unitId={openUnitId} fokus={fokusPanel} dock={dock} onClose={() => { setFokusPanel(null); setDetailUnit(null); }} onChanged={reload} onBukaUnit360={(id) => { setDetailUnit(null); setUnit360Id(id); }} onKembaliFokus={() => { const el = pemicuRef.current; if (el && document.contains(el)) el.focus({ preventScroll: true }); }} />
  );

  return (
    <PageContainer fluid className="prod-halaman">
      <div className={cn("prod-ol-split", dock && openUnitId && "ada-panel")}>
        <div className="prod-ol-utama">{utama}</div>
        {dock && openUnitId && <aside className="prod-ol-dock" aria-label="Rincian unit">{panel}</aside>}
      </div>
      {!dock && panel}
      {lembarFilter}
      <UnitOverviewDrawer unitId={unit360Id} onClose={() => setUnit360Id(null)} onChanged={reload} />
    </PageContainer>
  );
}

// ───────────── baris desktop (mengikuti mockup: pelanggan & unit | posisi unit | pekerjaan | target & PIC | chevron) ─────────────
function IdentitasSel({ u, pr, a }) {
  return (
    <span className="prod-ol-sel prod-ol-identitas">
      <span className="prod-ol-nama">{u.order?.customer?.name || "—"}{pr.key !== "NORMAL" && <Badge variant={pr.tone} className="ml-2 align-middle" data-testid="priority-badge">{pr.label}</Badge>}</span>
      <span className="prod-ol-kode"><span>{u.unitCode}</span><SalinKode teks={u.unitCode} /></span>
      <span className="prod-ol-redup prod-ol-baris-kecil" data-testid="status-order-sekunder">{u.order?.orderNumber || "—"} · Status order: <b data-testid="status-badge">{a.ada ? a.statusOrder?.label : statusOf(u).label}</b></span>
      <PkrRujukan pkr={u.penjualanKaryawan} className="mt-0.5" />
    </span>
  );
}
function PosisiSel({ a }) {
  if (!a.ada) return <span className="prod-ol-redup">—</span>;
  return <span className="prod-ol-posisi" data-testid="posisi-unit"><span className={`prod-ol-titik ${warnaPosisi(a.posisi)}`} aria-hidden />{a.posisi?.label || "—"}</span>;
}
function PekerjaanSel({ u, a, onLengkapi }) {
  return (
    <span className="prod-ol-sel">
      <span className="prod-ol-layanan" data-testid="sales-services">
        <span className="prod-ol-layanan-nama" title={salesServicesText((u.order?.items || []).map((i) => i.layananName).filter(Boolean))}>{salesServicesText((u.order?.items || []).map((i) => i.layananName).filter(Boolean))}</span>
        {(u.merk || u.ukuran) && <span className="prod-ol-ukuran" data-testid="unit-ukuran">{[u.merk, formatUkuranLabel(u.ukuran)].filter(Boolean).join(" ")}</span>}
      </span>
      <span className="prod-ol-chips">
        {a.ada ? <span className={`prod-ol-chip ${warnaKerja(a.kerja)}`} data-testid="kerja-badge">{a.kerja.label}</span> : <span className="prod-ol-redup">—</span>}
        {u.productionStatus === "BLOCKED" && <span className="prod-ol-chip merah">{DELAY_TITLE}</span>}
      </span>
      {a.ada && sumberKerjaText(a.kerja) && <span className="prod-ol-redup prod-ol-baris-kecil" data-testid="kerja-sumber">{sumberKerjaText(a.kerja)}</span>}
      <KelengkapanBaris row={u} onLengkapi={onLengkapi} tampilTombol={false} />
    </span>
  );
}
function TargetPicSel({ a }) {
  return (
    <span className="prod-ol-sel prod-ol-tp">
      <span className={cn("prod-ol-tp-baris", !a.target && "kosong")} data-testid="target-selesai"><CalendarDays size={16} aria-hidden />{a.target ? formatTanggal(a.target.at) : "Belum ada"}</span>
      <span className={cn("prod-ol-tp-baris", !a.pic && "kosong")} data-testid="pic-meja"><User size={16} aria-hidden />{a.pic?.nama || "PIC belum ditugaskan"}{a.meja ? ` · ${a.meja}` : ""}</span>
    </span>
  );
}
function BarisUnit({ u, aktifId, onBuka }) {
  const pr = priorityOf(u); const a = ringkasAdopsi(u);
  const buka = (e) => onBuka(u, e.currentTarget);
  return (
    <div className={cn("prod-ol-baris", aktifId === u.id && "dipilih")} role="row" tabIndex={0} aria-selected={aktifId === u.id} data-testid="order-row" data-unit-code={u.unitCode} data-priority={pr.key} onClick={buka}
      onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); buka(e); } }} aria-label={`Buka unit ${u.unitCode} ${u.order?.customer?.name || ""}`}>
      <span role="cell"><IdentitasSel u={u} pr={pr} a={a} /></span>
      <span role="cell"><PosisiSel a={a} /></span>
      <span role="cell"><PekerjaanSel u={u} a={a} onLengkapi={() => onBuka(u, null, "kelengkapan")} /></span>
      <span role="cell"><TargetPicSel a={a} /></span>
      <span role="cell" className="prod-ol-panah"><ChevronRight size={20} aria-hidden /></span>
    </div>
  );
}

// ───────────── kartu HP ─────────────
function KartuUnitMobil({ u, aktifId, onBuka }) {
  const pr = priorityOf(u); const a = ringkasAdopsi(u);
  const buka = (e) => onBuka(u, e.currentTarget);
  return (
    <li className={cn("prod-ol-kartu-item", aktifId === u.id && "dipilih")} data-testid="order-row" data-unit-code={u.unitCode} data-priority={pr.key} tabIndex={0} onClick={buka}
      onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); buka(e); } }} aria-label={`Buka unit ${u.unitCode} ${u.order?.customer?.name || ""}`}>
      <div className="prod-ol-kartu-atas"><IdentitasSel u={u} pr={pr} a={a} /><ChevronRight size={20} className="prod-ol-panah" aria-hidden /></div>
      <dl className="prod-ol-fakta">
        <div><dt>Posisi unit</dt><dd><PosisiSel a={a} /></dd></div>
        <div><dt>Pekerjaan</dt><dd><PekerjaanSel u={u} a={a} onLengkapi={() => onBuka(u, null, "kelengkapan")} /></dd></div>
        <div><dt>Target &amp; PIC</dt><dd><TargetPicSel a={a} /></dd></div>
      </dl>
    </li>
  );
}
