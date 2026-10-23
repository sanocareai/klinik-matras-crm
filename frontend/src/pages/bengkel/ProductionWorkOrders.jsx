import { formatUkuranLabel } from "@/utils/ukuranKasur.js";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, ClipboardList, Download, RefreshCw } from "lucide-react";
import { api } from "@/api.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Card } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
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
import { KERJA_FILTER, nadaBadge, parameterDaftar, ringkasAdopsi, sumberKerjaText } from "@/features/production/orderProduksiModel.js";

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
  const [cari, setCari] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [rows, setRows] = useState(null);
  const [meta, setMeta] = useState({ total: 0, hasMore: false, page: 0, counts: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const reqRef = useRef(0);
  const [localUnitId, setLocalUnitId] = useState(null);
  const [unit360Id, setUnit360Id] = useState(null);
  const openUnitId = onUnitChange ? (unitIdProp || null) : localUnitId;
  const [fokusPanel, setFokusPanel] = useState(null); // "bahan" = masuk untuk mencatat bahan: panel langsung ke Pemakaian aktual (tanpa melewati Status & target)
  const setDetailUnit = (u) => (onUnitChange ? onUnitChange(u?.id || null) : setLocalUnitId(u?.id || null));
  const bukaPanel = (u) => { setFokusPanel(null); setDetailUnit(u); };
  const bukaBahan = (u) => { setFokusPanel("bahan"); setDetailUnit(u); };
  const unitAktif = (u) => !["CANCELLED", "DELIVERED"].includes(u.status);
  const [ekspor, setEkspor] = useState({ sibuk: false, ok: "", galat: "" });

  useEffect(() => { const t = setTimeout(() => setQDebounced(cari.trim()), 300); return () => clearTimeout(t); }, [cari]);

  // Filter status order yang dikirim ke server: tab tertentu, atau (tanpa tab) seluruh lingkup.
  const displayParam = useMemo(() => {
    if (tab) return tab;
    if (scope === "riwayat") return "TERKIRIM";
    if (scope === "aktif") return ACTIVE_KEYS.join(",");
    return undefined;
  }, [tab, scope]);
  const paramDaftar = useMemo(() => parameterDaftar({ q: qDebounced || undefined, kerja: kerja ? [kerja] : [] }), [qDebounced, kerja]);
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
  const adaFilter = !!(qDebounced || kerja || tab);
  const subtitle = scope === "riwayat" ? "Unit yang sudah terkirim ke pelanggan." : "Satu daftar untuk memantau status order, posisi, dan pekerjaan setiap unit. Klik baris untuk mengelola unit.";

  return (
    <PageContainer>
      <PageHeader
        title={onScopeChange || scope ? "Order Produksi" : "Work Order"}
        subtitle={subtitle}
        actions={
          <>
            {headerExtra}
            <Button variant="neutral" size="sm" className="min-h-[40px]" data-testid="order-export-excel" onClick={unduhExcel} disabled={ekspor.sibuk || loading || !rows?.length} title="Unduh .xlsx sesuai filter dan pencarian yang sedang aktif">
              <Download size={14} aria-hidden /> {ekspor.sibuk ? "Menyiapkan…" : "Export Excel"}
            </Button>
            <Button variant="ghost" size="sm" className="min-h-[40px]" onClick={reload} disabled={loading}>
              <RefreshCw size={14} className={loading ? "animate-spin motion-reduce:animate-none" : ""} aria-hidden /> <span className="max-sm:sr-only">Muat Ulang</span>
            </Button>
          </>
        }
      />

      <PageBody>
        {ekspor.ok && <p role="status" data-testid="order-export-ok" className="m-0 rounded-btn bg-greenbg px-3 py-2 text-[12.5px] text-green">{ekspor.ok}</p>}
        {ekspor.galat && <p role="alert" data-testid="order-export-galat" className="m-0 rounded-btn bg-redbg px-3 py-2 text-[12.5px] text-red">{ekspor.galat}</p>}

        <div role="tablist" aria-label="Saring status order" className="flex flex-wrap items-center gap-1 border-b border-line pb-2 max-sm:flex-nowrap max-sm:overflow-x-auto max-sm:[&>*]:shrink-0" data-testid="order-filter">
          {onScopeChange && ORDER_SCOPES.map((sc) => {
            const n = rows ? scopeCount(sc.key) : null;
            return (
              <button key={sc.key} type="button" role="tab" aria-selected={scope === sc.key} data-testid={`order-scope-${sc.key}`} onClick={() => onScopeChange(sc.key)}
                className={cn("min-h-[40px] rounded-chip px-3 py-1.5 text-[13px] font-semibold transition-colors motion-reduce:transition-none", scope === sc.key ? "bg-accent text-white" : "text-ink2 hover:bg-hovertint")}>
                {sc.label}{n != null && <span className="ml-1 text-[12px] opacity-80">{n}</span>}
              </button>
            );
          })}
          {onScopeChange && tabsShown.length > 0 && <span className="mx-1 h-5 w-px bg-line" aria-hidden />}
          {tabsShown.length > 0 && (
            <button role="tab" aria-selected={tab === ""} data-testid="order-status-all" onClick={() => setTab("")}
              className={cn("min-h-[40px] rounded-chip px-3 py-1.5 text-[13px] font-semibold transition-colors motion-reduce:transition-none", tab === "" ? "bg-accentbg text-accent" : "text-ink3 hover:bg-hovertint hover:text-ink2")}>
              Semua status order{rows && <span className="ml-1 text-[12px] opacity-70">{countOf("")}</span>}
            </button>
          )}
          {tabsShown.map((t) => (
            <button key={t.key} role="tab" aria-selected={tab === t.key} data-testid={`order-status-${t.key}`} onClick={() => setTab(t.key)}
              className={cn("min-h-[40px] rounded-chip px-3 py-1.5 text-[13px] font-semibold transition-colors motion-reduce:transition-none", tab === t.key ? "bg-accentbg text-accent" : "text-ink3 hover:bg-hovertint hover:text-ink2")}>
              {t.label}{rows && <span className="ml-1 text-[12px] opacity-70">{countOf(t.key)}</span>}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search" value={cari} onChange={(e) => setCari(e.target.value)}
            placeholder="Cari kode unit, no. order, atau nama pelanggan…" aria-label="Cari unit"
            className="h-11 min-w-[240px] flex-1 rounded-btn border border-line bg-surface px-3 text-[14px] text-ink outline-none placeholder:text-ink3 focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
          />
          <label className="flex items-center gap-2 text-[13px] text-ink2">
            <span className="shrink-0">Status kerja</span>
            <select value={kerja} onChange={(e) => setKerja(e.target.value)} data-testid="order-filter-kerja" aria-label="Saring status kerja"
              className="h-11 rounded-btn border border-line bg-surface px-3 text-[14px] text-ink outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30">
              <option value="">Semua</option>
              {KERJA_FILTER.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
            </select>
          </label>
          {rows && (
            <span className="ml-auto self-center text-[12.5px] text-ink3" data-testid="order-rowcount"
              title="Angka pada tab adalah TOTAL unit per status order (tidak mengikuti pencarian dan status kerja). Daftar dimuat bertahap dari server — tekan 'Muat lagi' untuk halaman berikutnya.">
              {rows.length} dari {meta.total} unit
            </span>
          )}
        </div>

        {error && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-btn bg-redbg px-3 py-2.5 text-[13px] text-red">
            <span>{error}</span><Button variant="secondary" size="sm" className="min-h-[40px]" onClick={reload}>Coba lagi</Button>
          </div>
        )}

        <Card className="overflow-hidden">
          {kosong ? (
            <EmptyState icon={ClipboardList} title="Tidak ada unit yang cocok"
              description={adaFilter ? "Tidak ada unit dengan filter ini. Ubah kata kunci, tab status order, atau status kerja." : "Belum ada unit di lingkup ini."}
              action={adaFilter ? <Button variant="secondary" size="sm" className="min-h-[44px]" onClick={() => { setCari(""); setKerja(""); setTab(scope === "riwayat" ? "TERKIRIM" : ""); }}>Hapus filter</Button> : null} />
          ) : (
            <>
              <TableWrap className="hidden lg:block">
                <Table>
                  <THead>
                    <TR>
                      <TH sticky>Unit</TH><TH>Pelanggan &amp; layanan</TH><TH>Status order</TH><TH>Status kerja</TH><TH>Target selesai</TH><TH>PIC</TH><TH>Tindakan berikutnya</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {loading && !rows && <TableSkeletonRows rows={8} cols={7} />}
                    {rows?.map((u) => {
                      const st = statusOf(u); const pr = priorityOf(u); const a = ringkasAdopsi(u);
                      const perluPosisi = a.ada && a.posisi?.tone === "orange";
                      return (
                        <TR key={u.id} clickable data-testid="order-row" data-unit-code={u.unitCode} data-priority={pr.key} onClick={() => bukaPanel(u)}>
                          <TD sticky className="whitespace-nowrap">
                            <span className="font-semibold text-ink">{u.unitCode}</span>{pr.key !== "NORMAL" && <Badge variant={pr.tone} className="ml-1.5 align-middle" data-testid="priority-badge">{pr.label}</Badge>}
                            <span className="block text-[12px] text-ink3">{u.order?.orderNumber || "—"}</span>
                          </TD>
                          <TD>
                            <span className="block break-words text-ink">{u.order?.customer?.name || "—"}</span>
                            <span className="block text-[12px] text-ink3" data-testid="sales-services">{salesServicesText((u.order?.items || []).map((i) => i.layananName).filter(Boolean))}</span>
                            <PkrRujukan pkr={u.penjualanKaryawan} className="mt-0.5" />
                          </TD>
                          <TD>
                            <Badge variant={a.ada ? statusTone(u, a) : st.tone} data-testid="status-badge">{a.ada ? a.statusOrder?.label : st.label}</Badge>
                            {perluPosisi && <span className="mt-1 block text-[12px] font-medium text-orange" data-testid="posisi-perhatian">{a.posisi.label}</span>}
                          </TD>
                          <TD>
                            {a.ada ? <><Badge variant={nadaBadge(a.kerja.tone)} data-testid="kerja-badge">{a.kerja.label}</Badge>{sumberKerjaText(a.kerja) && <span className="mt-1 block max-w-[220px] text-[12px] text-ink3" data-testid="kerja-sumber">{sumberKerjaText(a.kerja)}</span>}</> : <span className="text-ink3">—</span>}
                            {u.productionStatus === "BLOCKED" && <Badge variant="red" className="mt-1">{DELAY_TITLE}</Badge>}
                          </TD>
                          <TD className="whitespace-nowrap text-ink2" data-testid="target-selesai">{a.target ? formatTanggal(a.target.at) : <span className="text-ink3">Belum ada</span>}</TD>
                          <TD className="text-ink2">{a.pic?.nama || <span className="text-ink3">Belum ditugaskan</span>}{a.meja && <span className="block text-[12px] text-ink3">{a.meja}</span>}</TD>
                          <TD data-testid="tindakan-berikutnya">
                            <span className="flex items-center gap-1 font-medium text-ink">{a.tindakan?.label || "—"}<ChevronRight size={14} className="shrink-0 text-ink3" aria-hidden /></span>
                            {a.tindakan?.aktor && a.tindakan.aktor !== "—" && <span className="block text-[12px] text-ink3">{a.tindakan.aktor}</span>}
                            {unitAktif(u) && <Button variant="secondary" size="sm" className="mt-1.5 min-h-[36px]" data-testid="catat-bahan-baris" onClick={(e) => { e.stopPropagation(); bukaBahan(u); }}>Catat bahan</Button>}
                          </TD>
                        </TR>
                      );
                    })}
                  </TBody>
                </Table>
              </TableWrap>

              <ul className="m-0 list-none divide-y divide-line p-0 lg:hidden">
                {loading && !rows && [0, 1, 2, 3].map((i) => <li key={i} className="px-4 py-4"><div className="h-4 w-1/3 animate-pulse rounded bg-inset motion-reduce:animate-none" /><div className="mt-2 h-4 w-2/3 animate-pulse rounded bg-inset motion-reduce:animate-none" /></li>)}
                {rows?.map((u) => {
                  const st = statusOf(u); const pr = priorityOf(u); const a = ringkasAdopsi(u);
                  return (
                    <li key={u.id}>
                      <button
                        type="button" data-testid="order-row" data-unit-code={u.unitCode} data-priority={pr.key}
                        onClick={() => bukaPanel(u)}
                        className="w-full px-4 py-3.5 text-left transition-colors hover:bg-hovertint focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset motion-reduce:transition-none"
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-[14px] font-semibold text-ink">{u.unitCode}</span>
                          {pr.key !== "NORMAL" && <Badge variant={pr.tone} className="shrink-0">{pr.label}</Badge>}
                          <Badge variant={a.ada ? statusTone(u, a) : st.tone} className="ml-auto shrink-0">{a.ada ? a.statusOrder?.label : st.label}</Badge>
                        </div>
                        <div className="mt-0.5 truncate text-[14px] text-ink">{u.order?.customer?.name || "—"}</div>
                        <PkrRujukan pkr={u.penjualanKaryawan} className="mt-0.5" />
                        <div className="mt-0.5 break-words text-[12.5px] text-ink3">
                          {u.order?.orderNumber || "—"} · {salesServicesText((u.order?.items || []).map((i) => i.layananName).filter(Boolean))}
                          {(u.merk || u.ukuran) && ` · ${[u.merk, formatUkuranLabel(u.ukuran)].filter(Boolean).join(" ")}`}
                        </div>
                        {a.ada && (
                          <dl className="m-0 mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[12.5px]">
                            <div><dt className="text-ink3">Status kerja</dt><dd className="m-0 font-medium text-ink">{a.kerja.label}</dd></div>
                            <div><dt className="text-ink3">Target selesai</dt><dd className="m-0 font-medium text-ink">{a.target ? formatTanggal(a.target.at) : "Belum ada"}</dd></div>
                            <div><dt className="text-ink3">PIC</dt><dd className="m-0 font-medium text-ink">{a.pic?.nama || "Belum ditugaskan"}</dd></div>
                            {a.posisi?.tone === "orange" && <div><dt className="text-ink3">Posisi</dt><dd className="m-0 font-medium text-orange">{a.posisi.label}</dd></div>}
                          </dl>
                        )}
                        <div className="mt-2 flex items-center gap-1 rounded-btn bg-inset px-3 py-2 text-[13px] font-medium text-ink" data-testid="tindakan-berikutnya">
                          <span className="text-ink3">Berikutnya:</span> <span className="min-w-0 flex-1 truncate">{a.tindakan?.label || "—"}</span><ChevronRight size={14} className="shrink-0 text-ink3" aria-hidden />
                        </div>
                      </button>
                      {unitAktif(u) && <div className="px-4 pb-3"><Button variant="secondary" size="sm" className="min-h-[44px] w-full" data-testid="catat-bahan-baris" onClick={() => bukaBahan(u)}>Catat bahan</Button></div>}
                    </li>
                  );
                })}
              </ul>
              {meta.hasMore && (
                <div className="border-t border-line p-3 text-center">
                  <Button variant="secondary" size="sm" className="min-h-[44px]" data-testid="order-load-more" disabled={loading} onClick={() => fetchPage(meta.page + 1, { append: true })}>
                    {loading ? "Memuat…" : `Muat lagi (${Math.max(0, meta.total - (rows?.length || 0))} tersisa)`}
                  </Button>
                </div>
              )}
            </>
          )}
        </Card>
      </PageBody>

      {/* Klik baris → panel fokus Order Produksi. Tahap, dokumentasi, biaya & QC tetap lengkap di Unit 360 (tombol di bagian "Lanjutan"). */}
      <OrderProduksiPanel unitId={openUnitId} fokus={fokusPanel} onClose={() => { setFokusPanel(null); setDetailUnit(null); }} onChanged={reload} onBukaUnit360={(id) => { setDetailUnit(null); setUnit360Id(id); }} />
      <UnitOverviewDrawer unitId={unit360Id} onClose={() => setUnit360Id(null)} onChanged={reload} />
    </PageContainer>
  );
}

// Nada Status order: peta yang sama dengan Sales/Delivery (UNIT_STATUS_REAL via statusOf) — label dari server (unitStatusDisplay).
function statusTone(u, a) {
  return statusOf({ status: u.status, unitStatusDisplay: a.statusOrder }).tone;
}
