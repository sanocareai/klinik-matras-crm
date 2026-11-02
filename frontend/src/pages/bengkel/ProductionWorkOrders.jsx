import { formatUkuranLabel } from "@/utils/ukuranKasur.js";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ClipboardList, Download, ListChecks, RefreshCw, Search, SlidersHorizontal } from "lucide-react";
import { FilterDropdown } from "@/components/ui/filter-dropdown.jsx";
import DateRangePicker from "@/components/DateRangePicker.jsx";
import SalinKode from "@/features/production/SalinKode.jsx";
import { teksJumlah, tindakanBaris, unitBerjalan } from "@/features/production/orderListModel.js";
import { api } from "@/api.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Card } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { bisaCatatBahan } from "@/lib/roles.js";
import { useHubRange } from "@/hooks/useHubParam.js";
const bacaPengguna = () => { try { return JSON.parse(localStorage.getItem("user")); } catch { return null; } };
import { Badge } from "@/components/ui/badge.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import {
  TableWrap, Table, THead, TBody, TR, TH, TD, TableSkeletonRows,
} from "@/components/ui/table.jsx";
import { cn } from "@/lib/utils.js";
import { formatTanggal } from "@/utils/formatDate.js";
import { UnitOverviewDrawer } from "@/features/production/UnitOverviewDrawer.jsx";
import OrderProduksiPanel from "@/features/production/OrderProduksiPanel.jsx";
import PkrRujukan from "@/features/production/PkrRujukan.jsx";
import { DELAY_TITLE, DISPLAY_STATUS_TABS, priorityOf, salesServicesText, statusOf } from "@/features/production/productionLabels.js";
import { KERJA_FILTER, URUTAN_DAFTAR, bacaHitungKelengkapan, nadaBadge, parameterDaftar, ringkasAdopsi, sumberKerjaText, sasaranLengkapi, toggleKelengkapan, kunciKelengkapan, periodeDariUrl, periodeKeUrl, paramPeriode, periodeSemuaWaktu } from "@/features/production/orderProduksiModel.js";
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
  const [lainnyaBuka, setLainnyaBuka] = useState(false); const pemicuRef = useRef(null);
  const [fokusPanel, setFokusPanel] = useState(null); // "bahan" = masuk untuk mencatat bahan: panel langsung ke Pemakaian aktual (tanpa melewati Status & target)
  const setDetailUnit = (u) => (onUnitChange ? onUnitChange(u?.id || null) : setLocalUnitId(u?.id || null));
  // Membuka panel unit tidak menulis apa pun. `el` = pemicu (baris/tombol) untuk mengembalikan fokus saat panel ditutup; `tab` = "bahan" | "pekerjaan" (selain itu tab bawaan).
  const bukaPanel = (u, el, tab) => { pemicuRef.current = el || document.activeElement; setFokusPanel(tab === "bahan" ? "bahan" : tab === "pekerjaan" ? "pekerjaan" : null); setDetailUnit(u); };
  const bukaLengkapi = (u, sasaran) => { pemicuRef.current = document.activeElement; setFokusPanel(sasaran === "bahan" ? "bahan" : "kelengkapan"); setDetailUnit(u); };
  const unitAktif = (u) => !["CANCELLED", "DELIVERED"].includes(u.status);
  // Akun hanya-lihat tidak boleh melihat tombol yang berbunyi "Catat bahan": labelnya "Lihat bahan" (isi panel tetap sama; server menolak tulis).
  const bisaCatat = bisaCatatBahan(bacaPengguna()); const labelBahan = bisaCatat ? "Catat bahan" : "Lihat bahan";
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
  const subtitle = scope === "riwayat" ? "Unit yang sudah terkirim ke pelanggan." : "Pantau posisi, pekerjaan, dan tindakan berikutnya tiap unit.";
  const jumlahFilterLain = (kelengkapan.length ? 1 : 0);
  const opsiStatusOrder = [{ value: "", label: `Semua status order${rows ? ` · ${countOf("")}` : ""}` }, ...tabsShown.map((t) => ({ value: t.key, label: `${t.label}${rows ? ` · ${countOf(t.key)}` : ""}` }))];
  const opsiKerja = KERJA_FILTER.map((k) => ({ value: k.key, label: k.label }));
  const opsiUrut = URUTAN_DAFTAR.map((u) => ({ value: u.key, label: u.label }));
  const hapusFilter = () => { setCari(""); setKerja(""); setKelengkapan([]); setPeriode(periodeSemuaWaktu()); setTab(scope === "riwayat" ? "TERKIRIM" : ""); };
  const bukaBaris = (u, el) => bukaPanel(u, el);

  return (
    <PageContainer fluid className="prod-halaman">
      <PageHeader
        title={onScopeChange || scope ? "Order Produksi" : "Work Order"}
        subtitle={subtitle}
        actions={
          <>
            {headerExtra}
            <Button variant="neutral" size="sm" className="min-h-[44px]" data-testid="order-export-excel" onClick={unduhExcel} disabled={ekspor.sibuk || loading || !rows?.length} title="Unduh .xlsx sesuai filter dan pencarian yang sedang aktif">
              <Download size={16} aria-hidden /> {ekspor.sibuk ? "Menyiapkan…" : "Export Excel"}
            </Button>
            <Button variant="ghost" size="sm" className="min-h-[44px]" onClick={reload} disabled={loading}>
              <RefreshCw size={16} className={loading ? "animate-spin motion-reduce:animate-none" : ""} aria-hidden /> <span className="max-sm:sr-only">Muat ulang</span>
            </Button>
          </>
        }
      />

      <PageBody className="prod-stack">
        {ekspor.ok && <p role="status" data-testid="order-export-ok" className="prod-umpan ok m-0">{ekspor.ok}</p>}
        {ekspor.galat && <p role="alert" data-testid="order-export-galat" className="prod-umpan galat m-0">{ekspor.galat}</p>}

        <section className="prod-ol" aria-label="Daftar order produksi">
          {/* Baris 1: antrean (Aktif / Semua / Riwayat) + pencarian */}
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
              <Search size={17} className="prod-ol-cari-ikon" aria-hidden />
              <input type="search" value={cari} onChange={(e) => setCari(e.target.value)} placeholder="Cari pelanggan, kode unit, atau no. order" aria-label="Cari unit" />
            </label>
          </div>

          {/* Baris 2: filter utama + periode + urutan + Filter lainnya */}
          <div className="prod-ol-baris2" data-testid="periode-urutan">
            {tabsShown.length > 0 && <FilterDropdown value={tab} onChange={setTab} options={opsiStatusOrder} placeholder={opsiStatusOrder[0].label} ariaLabel="Saring status order" triggerClassName="prod-filter-pemicu" />}
            <FilterDropdown value={kerja} onChange={setKerja} options={opsiKerja} placeholder="Semua status kerja" ariaLabel="Saring status kerja" triggerClassName="prod-filter-pemicu" icon={ListChecks} />
            <span data-testid="periode-picker" className="prod-ol-periode"><DateRangePicker value={periode} onChange={setPeriode} showCompare={false} /></span>
            <FilterDropdown value={urut} onChange={(v) => setUrut(v || "terbaru")} options={opsiUrut} placeholder={opsiUrut[0].label} ariaLabel="Urutan daftar" triggerClassName="prod-filter-pemicu" />
            <button type="button" className={cn("prod-ol-lainnya", (lainnyaBuka || jumlahFilterLain > 0) && "aktif")} aria-expanded={lainnyaBuka} aria-controls="prod-ol-lainnya-isi" data-testid="filter-lainnya" onClick={() => setLainnyaBuka((v) => !v)}>
              <SlidersHorizontal size={16} aria-hidden /> Filter lainnya{jumlahFilterLain > 0 && <span className="prod-ol-lainnya-n">{jumlahFilterLain}</span>}
              {hitung && !lainnyaBuka && hitung.unik > 0 && <span className="prod-ol-lainnya-ringkas" data-testid="kel-unik-ringkas">{hitung.unik} unit berkekurangan</span>}
            </button>
            {adaFilter && <button type="button" className="prod-ol-hapus" onClick={hapusFilter} data-testid="hapus-semua-filter">Hapus filter</button>}
          </div>
          {lainnyaBuka && (
            <div id="prod-ol-lainnya-isi" className="prod-ol-lainnya-isi">
              <KelengkapanFilter hitung={hitung} memuat={hitungMemuat} terpilih={kelengkapan} onToggle={(k) => setKelengkapan((t) => toggleKelengkapan(t, k))} onBersih={() => setKelengkapan([])} scope={scope} onLihatRiwayat={onScopeChange ? () => onScopeChange("riwayat") : null} />
            </div>
          )}

          {error && (
            <div role="alert" className="prod-umpan galat flex flex-wrap items-center justify-between gap-2">
              <span>{error}</span><Button variant="secondary" size="sm" className="min-h-[44px]" onClick={reload}>Coba lagi</Button>
            </div>
          )}

          <div className="prod-ol-meta" data-testid="order-rowcount" title="Angka pada status order adalah TOTAL unit per status (tidak mengikuti pencarian dan status kerja). Daftar dimuat bertahap dari server.">
            {rows ? teksJumlah({ dimuat: rows.length, total: meta.total, hasMore: meta.hasMore }) : "Memuat…"}
          </div>

          {kosong ? (
            <EmptyState icon={ClipboardList} title="Tidak ada unit yang cocok"
              description={adaFilter ? "Tidak ada unit dengan filter ini. Ubah kata kunci, status order, atau status kerja." : "Belum ada unit di lingkup ini."}
              action={adaFilter ? <Button variant="secondary" size="sm" className="min-h-[44px]" onClick={hapusFilter}>Hapus filter</Button> : null} />
          ) : (
            <>
              <div className="prod-ol-tabel hidden lg:block" role="table" aria-label="Order produksi" aria-rowcount={rows ? rows.length + 1 : undefined}>
                <div className="prod-ol-kepala" role="row">
                  <span role="columnheader">Pelanggan &amp; unit</span><span role="columnheader">Posisi unit</span><span role="columnheader">Pekerjaan</span><span role="columnheader">Target &amp; PIC</span><span role="columnheader">Tindakan</span>
                </div>
                {loading && !rows && [0, 1, 2, 3, 4].map((i) => <div key={i} className="prod-ol-baris prod-ol-skel" role="row" aria-hidden><span /><span /><span /><span /><span /></div>)}
                {rows?.map((u) => <BarisUnit key={u.id} u={u} bisaCatat={bisaCatat} onBuka={bukaBaris} onLengkapi={bukaLengkapi} />)}
              </div>

              <ul className="prod-ol-kartu m-0 list-none p-0 lg:hidden" aria-label="Order produksi">
                {loading && !rows && [0, 1, 2, 3].map((i) => <li key={i} className="prod-ol-kartu-item prod-ol-skel" aria-hidden><span /><span /></li>)}
                {rows?.map((u) => <KartuUnitMobil key={u.id} u={u} bisaCatat={bisaCatat} onBuka={bukaBaris} onLengkapi={bukaLengkapi} />)}
              </ul>

              {meta.hasMore && (
                <div className="prod-ol-lagi">
                  <Button variant="secondary" size="sm" className="min-h-[44px]" data-testid="order-load-more" disabled={loading} onClick={() => fetchPage(meta.page + 1, { append: true })}>
                    {loading ? "Memuat…" : `Muat lagi (${Math.max(0, meta.total - (rows?.length || 0))} tersisa)`}
                  </Button>
                </div>
              )}
            </>
          )}
        </section>
      </PageBody>

      {/* Klik baris → panel samping ruang kerja unit. Tahap, dokumentasi, biaya & QC tetap lengkap di Unit 360 (tombol di tab Pekerjaan). */}
      <OrderProduksiPanel unitId={openUnitId} fokus={fokusPanel} onClose={() => { setFokusPanel(null); setDetailUnit(null); }} onChanged={reload} onBukaUnit360={(id) => { setDetailUnit(null); setUnit360Id(id); }} onKembaliFokus={() => { const el = pemicuRef.current; if (el && document.contains(el)) el.focus({ preventScroll: true }); }} />
      <UnitOverviewDrawer unitId={unit360Id} onClose={() => setUnit360Id(null)} onChanged={reload} />
    </PageContainer>
  );
}

// ───────────── baris desktop ─────────────
function PosisiSel({ a }) {
  if (!a.ada) return <span className="prod-ol-redup">—</span>;
  const nada = nadaBadge(a.posisi?.tone);
  return (
    <span className="prod-ol-sel" data-testid="posisi-unit">
      <span className={`prod-ol-titik ${nada}`} aria-hidden /><span className="prod-ol-nilai">{a.posisi?.label || "—"}</span>
      {a.posisi?.detail && <span className="prod-ol-redup prod-ol-baris-kecil">{a.posisi.detail}</span>}
    </span>
  );
}
function PekerjaanSel({ u, a, onLengkapi }) {
  return (
    <span className="prod-ol-sel">
      {a.ada ? <span className="prod-ol-nilai" data-testid="kerja-badge"><span className={`prod-ol-titik ${nadaBadge(a.kerja.tone)}`} aria-hidden />{a.kerja.label}</span> : <span className="prod-ol-redup">—</span>}
      {a.ada && sumberKerjaText(a.kerja) && <span className="prod-ol-redup prod-ol-baris-kecil" data-testid="kerja-sumber">{sumberKerjaText(a.kerja)}</span>}
      {u.productionStatus === "BLOCKED" && <span className="prod-ol-label merah">{DELAY_TITLE}</span>}
      <KelengkapanBaris row={u} onLengkapi={onLengkapi} />
    </span>
  );
}
function TargetPicSel({ a }) {
  return (
    <span className="prod-ol-sel">
      <span className="prod-ol-nilai" data-testid="target-selesai">{a.target ? formatTanggal(a.target.at) : <span className="prod-ol-redup">Target belum ada</span>}</span>
      <span className="prod-ol-redup prod-ol-baris-kecil" data-testid="pic-meja">{a.pic?.nama || "PIC belum ditugaskan"}{a.meja ? ` · ${a.meja}` : ""}</span>
    </span>
  );
}
// Pintasan "Catat bahan" untuk unit berjalan yang tindakan utamanya BUKAN bahan dan kelengkapannya tidak sudah mengarah ke bahan (perilaku lama dipertahankan; hanya tampilannya tertier).
function CatatBahanCepat({ u, t, bisaCatat, onBuka }) {
  if (!unitBerjalan(u) || t.tombol?.tab === "bahan" || sasaranLengkapi(kunciKelengkapan(u)) === "bahan") return null;
  return <button type="button" className="prod-ol-aksi tertier" data-testid="catat-bahan-baris" data-aksi={bisaCatat ? "catat" : "lihat"} onClick={(e) => { e.stopPropagation(); onBuka(u, e.currentTarget, "bahan"); }} onKeyDown={(e) => e.stopPropagation()}>{bisaCatat ? "Catat bahan" : "Lihat bahan"}</button>;
}
function TindakanSel({ u, a, bisaCatat, onBuka }) {
  const t = tindakanBaris(u, u.adopsi, { bisaCatat });
  return (
    <span className="prod-ol-sel" data-testid="tindakan-berikutnya">
      {t.teks && <span className="prod-ol-nilai">{t.teks}</span>}
      {t.aktor && <span className="prod-ol-redup prod-ol-baris-kecil">{t.aktor}</span>}
      {t.tombol && (
        <button type="button" className={cn("prod-ol-aksi", t.tombol.utama && "utama")} data-testid="tindakan-tombol" data-tab={t.tombol.tab}
          onClick={(e) => { e.stopPropagation(); onBuka(u, e.currentTarget, t.tombol.tab); }} onKeyDown={(e) => e.stopPropagation()}>{t.tombol.label}</button>
      )}
      <CatatBahanCepat u={u} t={t} bisaCatat={bisaCatat} onBuka={onBuka} />
    </span>
  );
}
function IdentitasSel({ u, st, pr, a }) {
  return (
    <span className="prod-ol-sel prod-ol-identitas">
      <span className="prod-ol-nama">{u.order?.customer?.name || "—"}{pr.key !== "NORMAL" && <Badge variant={pr.tone} className="ml-2 align-middle" data-testid="priority-badge">{pr.label}</Badge>}</span>
      <span className="prod-ol-kode"><span>Unit {u.unitCode}</span><SalinKode teks={u.unitCode} /><span className="prod-ol-redup">· {u.order?.orderNumber || "—"}</span></span>
      <span className="prod-ol-layanan" data-testid="sales-services">{salesServicesText((u.order?.items || []).map((i) => i.layananName).filter(Boolean))}{(u.merk || u.ukuran) ? ` · ${[u.merk, formatUkuranLabel(u.ukuran)].filter(Boolean).join(" ")}` : ""}</span>
      <span className="prod-ol-order" data-testid="status-order-sekunder">Status order: <b data-testid="status-badge">{a.ada ? a.statusOrder?.label : st.label}</b></span>
      <PkrRujukan pkr={u.penjualanKaryawan} className="mt-0.5" />
    </span>
  );
}
function BarisUnit({ u, bisaCatat, onBuka, onLengkapi }) {
  const st = statusOf(u); const pr = priorityOf(u); const a = ringkasAdopsi(u);
  const buka = (e) => onBuka(u, e.currentTarget);
  return (
    <div className="prod-ol-baris" role="row" tabIndex={0} data-testid="order-row" data-unit-code={u.unitCode} data-priority={pr.key} onClick={buka}
      onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); buka(e); } }} aria-label={`Buka unit ${u.unitCode} ${u.order?.customer?.name || ""}`}>
      <span role="cell"><IdentitasSel u={u} st={st} pr={pr} a={a} /></span>
      <span role="cell"><PosisiSel a={a} /></span>
      <span role="cell"><PekerjaanSel u={u} a={a} onLengkapi={onLengkapi} /></span>
      <span role="cell"><TargetPicSel a={a} /></span>
      <span role="cell"><TindakanSel u={u} a={a} bisaCatat={bisaCatat} onBuka={onBuka} /></span>
    </div>
  );
}

// ───────────── kartu HP ─────────────
function KartuUnitMobil({ u, bisaCatat, onBuka, onLengkapi }) {
  const st = statusOf(u); const pr = priorityOf(u); const a = ringkasAdopsi(u);
  const t = tindakanBaris(u, u.adopsi, { bisaCatat });
  const buka = (e) => onBuka(u, e.currentTarget);
  return (
    <li className="prod-ol-kartu-item" data-testid="order-row" data-unit-code={u.unitCode} data-priority={pr.key} tabIndex={0} onClick={buka}
      onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); buka(e); } }} aria-label={`Buka unit ${u.unitCode} ${u.order?.customer?.name || ""}`}>
      <IdentitasSel u={u} st={st} pr={pr} a={a} />
      <dl className="prod-ol-fakta">
        <div><dt>Posisi unit</dt><dd><PosisiSel a={a} /></dd></div>
        <div><dt>Pekerjaan</dt><dd><PekerjaanSel u={u} a={a} onLengkapi={onLengkapi} /></dd></div>
        <div><dt>Target &amp; PIC</dt><dd><TargetPicSel a={a} /></dd></div>
      </dl>
      <div className="prod-ol-kartu-aksi" data-testid="tindakan-berikutnya">
        <span className="prod-ol-redup">{t.teks ? `Berikutnya: ${t.teks}${t.aktor ? ` · ${t.aktor}` : ""}` : ""}</span>
        {t.tombol && <button type="button" className={cn("prod-ol-aksi", t.tombol.utama && "utama")} data-testid="tindakan-tombol" onClick={(e) => { e.stopPropagation(); onBuka(u, e.currentTarget, t.tombol.tab); }}>{t.tombol.label}</button>}
        <CatatBahanCepat u={u} t={t} bisaCatat={bisaCatat} onBuka={onBuka} />
      </div>
    </li>
  );
}

// Nada Status order: peta yang sama dengan Sales/Delivery (UNIT_STATUS_REAL via statusOf) — label dari server (unitStatusDisplay).
function statusTone(u, a) {
  return statusOf({ status: u.status, unitStatusDisplay: a.statusOrder }).tone;
}
