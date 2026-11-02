import { formatUkuranLabel } from "@/utils/ukuranKasur.js";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CalendarDays, ChevronDown, ChevronRight, ClipboardList, Download, Info, RefreshCw, Search, SlidersHorizontal, User } from "lucide-react";
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
import { KELENGKAPAN_BUKAN, KERJA_FILTER, URUTAN_DAFTAR, bacaHitungKelengkapan, parameterDaftar, ringkasAdopsi, sumberKerjaText, toggleKelengkapan, periodeDariUrl, periodeKeUrl, paramPeriode, periodeSemuaWaktu } from "@/features/production/orderProduksiModel.js";
import KelengkapanFilter from "@/features/production/KelengkapanFilter.jsx";
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
  const [lainnyaBuka, setLainnyaBuka] = useState(false); const [kelBuka, setKelBuka] = useState(false); const pemicuRef = useRef(null);
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
  const paramDaftar = useMemo(() => parameterDaftar({ q: qDebounced || undefined, kerja: kerja ? [kerja] : [], kelengkapan, urut, ...rentang }), [qDebounced, kerja, kelengkapan, urut, rentang]);
  // hitungan kelengkapan: lingkup + pencarian + status kerja + periode (TANPA pilihan kelengkapan itu sendiri), seluruh unit yang cocok di server
  const paramHitung = useMemo(() => ({ displayStatus: displayParam, q: qDebounced || undefined, statusKerja: kerja || undefined, ...rentang }), [displayParam, qDebounced, kerja, rentang]);
  useEffect(() => {
    const id = ++hitungReq.current; setHitungMemuat(true);
    api.getKelengkapanHitung(paramHitung).then((h) => { if (id === hitungReq.current) setHitung(bacaHitungKelengkapan(h)); }).catch(() => { if (id === hitungReq.current) setHitung(null); }).finally(() => { if (id === hitungReq.current) setHitungMemuat(false); });
  }, [paramHitung, versiHitung]);
  const queryServer = useCallback((page) => ({ displayStatus: displayParam, ...paramDaftar, page: String(page), pageSize: String(PAGE_SIZE) }), [displayParam, paramDaftar]);

  useEffect(() => { setEkspor({ sibuk: false, ok: "", galat: "" }); }, [displayParam, paramDaftar]); // pesan ekspor lama tidak boleh menempel setelah filter berubah
  const fetchPage = useCallback(async (page, { append }) => {
    const id = ++reqRef.current;
    setLoading(true); setError("");
    try {
      const d = await api.getWorkOrders(queryServer(page));
      if (id !== reqRef.current) return;
      setRows((prev) => (append && prev ? prev.concat(d.units || []) : d.units || []));
      setMeta({ total: d.total ?? (d.units || []).length, hasMore: !!d.hasMore, page, counts: d.displayStatusCounts || {} });
    } catch (e) { if (id === reqRef.current) setError(e.message); } finally { if (id === reqRef.current) setLoading(false); }
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
  const adaFilter = !!(qDebounced || kerja || tab || kelengkapan.length || dari || sampai);
  const subtitle = scope === "riwayat" ? "Unit yang sudah terkirim ke pelanggan." : "Pantau unit dan lanjutkan pekerjaan.";
  const jumlahFilterLain = (kelengkapan.length ? 1 : 0) + (urut !== "terbaru" ? 1 : 0);
  const opsiStatusOrder = tabsShown.map((t) => ({ value: t.key, label: `${t.label}${rows ? ` · ${countOf(t.key)}` : ""}` }));
  const opsiKerja = KERJA_FILTER.map((k) => ({ value: k.key, label: k.label }));
  const hapusFilter = () => { setCari(""); setKerja(""); setKelengkapan([]); setPeriode(periodeSemuaWaktu()); setTab(scope === "riwayat" ? "TERKIRIM" : ""); setUrut("terbaru"); };
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

        <section className="prod-ol" aria-label="Daftar order produksi">
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
            {tabsShown.length > 0 && <FilterDropdown value={tab} onChange={setTab} options={opsiStatusOrder} placeholder={`Status order${rows ? ` · ${countOf("")}` : ""}`} ariaLabel="Saring status order" triggerClassName="prod-filter-pemicu" />}
            <FilterDropdown value={kerja} onChange={setKerja} options={opsiKerja} placeholder="Status kerja" ariaLabel="Saring status kerja" triggerClassName="prod-filter-pemicu" />
            <span data-testid="periode-picker" className="prod-ol-periode" title="Periode memakai tanggal order masuk (unit dibuat), WIB"><DateRangePicker value={periode} onChange={setPeriode} showCompare={false} /></span>
            <button type="button" className={cn("prod-ol-lainnya", (lainnyaBuka || jumlahFilterLain > 0) && "aktif")} aria-expanded={lainnyaBuka} aria-controls="prod-ol-lainnya-isi" data-testid="filter-lainnya" onClick={() => setLainnyaBuka((v) => !v)}>
              <SlidersHorizontal size={17} aria-hidden /> Filter lainnya{jumlahFilterLain > 0 && <span className="prod-ol-lainnya-n">{jumlahFilterLain}</span>}
            </button>
            {adaFilter && <button type="button" className="prod-ol-hapus" onClick={hapusFilter} data-testid="hapus-semua-filter">Hapus filter</button>}
          </div>
          {lainnyaBuka && (
            <div id="prod-ol-lainnya-isi" className="prod-ol-lainnya-isi">
              <label className="prod-ol-urut"><span>Urutan</span>
                <FilterDropdown value={urut} onChange={(v) => setUrut(v || "terbaru")} options={URUTAN_DAFTAR.map((u) => ({ value: u.key, label: u.label }))} placeholder={URUTAN_DAFTAR[0].label} ariaLabel="Urutan daftar" triggerClassName="prod-filter-pemicu" />
              </label>
            </div>
          )}

          {/* Ringkasan kelengkapan: satu baris, rincian bisa dibuka (angka & definisi tetap tersedia) */}
          {(unikKurang > 0 || belumDinilai > 0 || kelengkapan.length > 0) && (
            <div className={cn("prod-ol-bar", unikKurang > 0 ? "kurang" : "netral")} data-testid="kel-bar">
              <AlertCircle size={20} aria-hidden />
              <span className="prod-ol-bar-teks" data-testid="kel-unik-ringkas">{unikKurang > 0 ? `${unikKurang} unit perlu dilengkapi` : `${belumDinilai} unit belum dinilai kelengkapannya`}</span>
              <button type="button" className="prod-ol-bar-rincian" aria-expanded={kelBuka} aria-controls="prod-ol-kel-isi" data-testid="kel-rincian" onClick={() => setKelBuka((v) => !v)}>Rincian <ChevronDown size={16} className={kelBuka ? "rotate-180" : undefined} aria-hidden /></button>
            </div>
          )}
          {kelBuka && (
            <div id="prod-ol-kel-isi" className="prod-ol-kel-isi">
              <KelengkapanFilter hitung={hitung} memuat={hitungMemuat} terpilih={kelengkapan} onToggle={(k) => setKelengkapan((t) => toggleKelengkapan(t, k))} onBersih={() => setKelengkapan([])} scope={scope} onLihatRiwayat={onScopeChange ? () => onScopeChange("riwayat") : null} />
            </div>
          )}

          {error && (
            <div role="alert" className="prod-umpan galat flex flex-wrap items-center justify-between gap-2">
              <span>{error}</span><Button variant="secondary" size="sm" className="min-h-[44px]" onClick={reload}>Coba lagi</Button>
            </div>
          )}

          {kosong ? (
            <EmptyState icon={ClipboardList} title="Tidak ada unit yang cocok"
              description={adaFilter ? "Tidak ada unit dengan filter ini. Ubah kata kunci, status order, atau status kerja." : "Belum ada unit di lingkup ini."}
              action={adaFilter ? <Button variant="secondary" size="sm" className="min-h-[44px]" onClick={hapusFilter}>Hapus filter</Button> : null} />
          ) : (
            <>
              <div className="prod-ol-tabel hidden lg:block" role="table" aria-label="Order produksi" aria-rowcount={rows ? rows.length + 1 : undefined}>
                <div className="prod-ol-kepala" role="row">
                  <span role="columnheader">Pelanggan &amp; unit</span><span role="columnheader">Posisi unit</span><span role="columnheader">Pekerjaan</span><span role="columnheader">Target &amp; PIC</span><span role="columnheader" className="prod-sr">Buka</span>
                </div>
                {loading && !rows && [0, 1, 2, 3, 4].map((i) => <div key={i} className="prod-ol-baris prod-ol-skel" role="row" aria-hidden><span /><span /><span /><span /><span /></div>)}
                {rows?.map((u) => <BarisUnit key={u.id} u={u} aktifId={openUnitId} onBuka={bukaBaris} />)}
              </div>

              <ul className="prod-ol-kartu m-0 list-none p-0 lg:hidden" aria-label="Order produksi">
                {loading && !rows && [0, 1, 2, 3].map((i) => <li key={i} className="prod-ol-kartu-item prod-ol-skel" aria-hidden><span /><span /></li>)}
                {rows?.map((u) => <KartuUnitMobil key={u.id} u={u} aktifId={openUnitId} onBuka={bukaBaris} />)}
              </ul>

              <div className="prod-ol-kaki" data-testid="order-rowcount" title="Angka pada status order adalah TOTAL unit per status (tidak mengikuti pencarian dan status kerja). Daftar dimuat bertahap dari server.">
                <span>{rows ? teksJumlah({ dimuat: rows.length, total: meta.total, hasMore: meta.hasMore }) : "Memuat…"}</span>
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
      <span className="prod-ol-layanan" data-testid="sales-services">{salesServicesText((u.order?.items || []).map((i) => i.layananName).filter(Boolean))}{(u.merk || u.ukuran) ? ` · ${[u.merk, formatUkuranLabel(u.ukuran)].filter(Boolean).join(" ")}` : ""}</span>
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
