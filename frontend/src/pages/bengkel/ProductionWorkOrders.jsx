import { formatUkuranLabel } from "@/utils/ukuranKasur.js";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ClipboardList, RefreshCw } from "lucide-react";
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
import { formatTanggal, formatDurasiDetik } from "@/utils/formatDate.js";
import { UnitOverviewDrawer } from "@/features/production/UnitOverviewDrawer.jsx";
import { DELAY_TITLE, DISPLAY_STATUS_TABS, presenceTone, priorityOf, salesServicesText, statusOf } from "@/features/production/productionLabels.js";

// "Elapsed" per baris (Production Core Slice 3P) — STATIS per-muat, BUKAN ticking langsung (timer LIVE ada di Detail Unit).
function elapsedSejak(iso) {
  if (!iso) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
}

// Order Produksi (daftar unit) — simplifikasi Production slice 1. Satu kosakata status: Pengambilan · Diproses · Siap Kirim · Terkirim.
// Filter status dan PAGINASI dilakukan di SERVER (work-orders?displayStatus=&q=&page=&pageSize=) — tidak berhenti di 500 unit; "Muat lagi" menambah halaman.
// Tanpa label/filter sumber (V1/V2) dan tanpa filter lini teknis: hanya Layanan Sales. Histori (Terkirim) tetap utuh di tab "Riwayat"/"Semua".
//
// ⚠️ KOLOM TAHAP bisa kosong untuk unit lama yang belum pernah masuk alur tahap (di-backfill dari Order): itu jujur, bukan bug — tidak diisi dengan tebakan.
export const ORDER_SCOPES = Object.freeze([{ key: "aktif", label: "Aktif" }, { key: "semua", label: "Semua" }, { key: "riwayat", label: "Riwayat" }]);
const PAGE_SIZE = 50;
const ACTIVE_KEYS = ["PENGAMBILAN", "DIPROSES", "SIAP_KIRIM"];

// `scope`: "aktif" = semua status kecuali Terkirim, "semua" = seluruhnya, "riwayat" = hanya Terkirim. Tab status rinci ("" = semua dalam lingkup) dikendalikan di sini.
// `unitId`/`onUnitChange`: unit yang dibuka di drawer Unit 360 dikendalikan pemanggil (?unit= di URL).
export default function ProductionWorkOrders({ initialStatus = "", scope = "", onScopeChange = null, headerExtra = null, unitId: unitIdProp, onUnitChange = null } = {}) {
  const [tab, setTab] = useState(scope === "riwayat" ? "TERKIRIM" : initialStatus);
  const firstScope = useRef(true);
  useEffect(() => { if (firstScope.current) { firstScope.current = false; return; } setTab(scope === "riwayat" ? "TERKIRIM" : ""); }, [scope]);
  const tabsShown = scope === "riwayat" ? [] : scope === "aktif" ? DISPLAY_STATUS_TABS.filter((t) => t.key !== "TERKIRIM") : DISPLAY_STATUS_TABS;
  const [cari, setCari] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [rows, setRows] = useState(null);
  const [meta, setMeta] = useState({ total: 0, hasMore: false, page: 0, counts: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const reqRef = useRef(0);
  const [localUnitId, setLocalUnitId] = useState(null);
  const openUnitId = onUnitChange ? (unitIdProp || null) : localUnitId;
  const setDetailUnit = (u) => (onUnitChange ? onUnitChange(u?.id || null) : setLocalUnitId(u?.id || null));

  useEffect(() => { const t = setTimeout(() => setQDebounced(cari.trim()), 300); return () => clearTimeout(t); }, [cari]);

  // Filter status tampilan yang dikirim ke server: tab tertentu, atau (tanpa tab) seluruh lingkup.
  const displayParam = useMemo(() => {
    if (tab) return tab;
    if (scope === "riwayat") return "TERKIRIM";
    if (scope === "aktif") return ACTIVE_KEYS.join(",");
    return undefined;
  }, [tab, scope]);

  const fetchPage = useCallback(async (page, { append }) => {
    const id = ++reqRef.current;
    setLoading(true); setError("");
    try {
      const d = await api.getWorkOrders({ displayStatus: displayParam, q: qDebounced || undefined, page: String(page), pageSize: String(PAGE_SIZE) });
      if (id !== reqRef.current) return;
      setRows((prev) => (append && prev ? prev.concat(d.units || []) : d.units || []));
      setMeta({ total: d.total ?? (d.units || []).length, hasMore: !!d.hasMore, page, counts: d.displayStatusCounts || {} });
    } catch (e) { if (id === reqRef.current) setError(e.message); } finally { if (id === reqRef.current) setLoading(false); }
  }, [displayParam, qDebounced]);
  useEffect(() => { fetchPage(1, { append: false }); }, [fetchPage]); // filter/pencarian berubah -> halaman 1
  const reload = useCallback(() => {
    // muat ulang semua halaman yang sudah terbuka (urut) supaya posisi pengguna tidak hilang setelah aksi
    const pages = Math.max(1, meta.page); const id = ++reqRef.current;
    setLoading(true);
    (async () => {
      try {
        let acc = []; let last = null;
        for (let p = 1; p <= pages; p += 1) { last = await api.getWorkOrders({ displayStatus: displayParam, q: qDebounced || undefined, page: String(p), pageSize: String(PAGE_SIZE) }); acc = acc.concat(last.units || []); if (!last.hasMore) break; }
        if (id !== reqRef.current) return;
        setRows(acc); setMeta({ total: last?.total ?? acc.length, hasMore: !!last?.hasMore, page: Math.max(1, Math.ceil(acc.length / PAGE_SIZE)), counts: last?.displayStatusCounts || {} });
      } catch (e) { if (id === reqRef.current) setError(e.message); } finally { if (id === reqRef.current) setLoading(false); }
    })();
  }, [meta.page, displayParam, qDebounced]);

  const countOf = (key) => (key === "" ? (scope === "aktif" ? ACTIVE_KEYS : DISPLAY_STATUS_TABS.map((t) => t.key)).reduce((n, k) => n + (meta.counts[k] || 0), 0) : meta.counts[key] ?? 0);
  const scopeCount = (key) => (key === "aktif" ? ACTIVE_KEYS.reduce((n, k) => n + (meta.counts[k] || 0), 0) : key === "riwayat" ? meta.counts.TERKIRIM || 0 : DISPLAY_STATUS_TABS.reduce((n, t) => n + (meta.counts[t.key] || 0), 0));

  const kosong = !loading && rows && rows.length === 0;
  const subtitle = scope === "riwayat" ? "Unit yang sudah terkirim ke pelanggan." : scope === "aktif" ? "Unit yang masih berjalan — belum terkirim. Klik baris untuk membuka Unit 360." : scope === "semua" ? "Seluruh unit, termasuk yang sudah terkirim. Klik baris untuk membuka Unit 360." : "Seluruh unit kasur beserta status dan tahap pengerjaannya.";

  return (
    <PageContainer>
      <PageHeader
        title={onScopeChange || scope ? "Order Produksi" : "Work Order"}
        subtitle={subtitle}
        actions={
          <>
            {headerExtra}
            <Button variant="ghost" size="sm" onClick={reload} disabled={loading}>
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Muat Ulang
            </Button>
          </>
        }
      />

      <PageBody>
        <div role="tablist" aria-label="Saring status unit" className="flex flex-wrap items-center gap-1 border-b border-line pb-2" data-testid="order-filter">
          {onScopeChange && ORDER_SCOPES.map((sc) => {
            const n = rows ? scopeCount(sc.key) : null;
            return (
              <button key={sc.key} type="button" role="tab" aria-selected={scope === sc.key} data-testid={`order-scope-${sc.key}`} onClick={() => onScopeChange(sc.key)}
                className={cn("rounded-chip px-3 py-1.5 text-[12.5px] font-semibold transition-colors", scope === sc.key ? "bg-accent text-white" : "text-ink2 hover:bg-hovertint")}>
                {sc.label}{n != null && <span className="ml-1 text-[11px] opacity-80">{n}</span>}
              </button>
            );
          })}
          {onScopeChange && tabsShown.length > 0 && <span className="mx-1 h-5 w-px bg-line" aria-hidden />}
          {tabsShown.length > 0 && (
            <button role="tab" aria-selected={tab === ""} data-testid="order-status-all" onClick={() => setTab("")}
              className={cn("rounded-chip px-3 py-1.5 text-[12.5px] font-semibold transition-colors", tab === "" ? "bg-accentbg text-accent" : "text-ink3 hover:bg-hovertint hover:text-ink2")}>
              Semua status{rows && <span className="ml-1 text-[11px] opacity-70">{countOf("")}</span>}
            </button>
          )}
          {tabsShown.map((t) => (
            <button key={t.key} role="tab" aria-selected={tab === t.key} data-testid={`order-status-${t.key}`} onClick={() => setTab(t.key)}
              className={cn("rounded-chip px-3 py-1.5 text-[12.5px] font-semibold transition-colors", tab === t.key ? "bg-accentbg text-accent" : "text-ink3 hover:bg-hovertint hover:text-ink2")}>
              {t.label}{rows && <span className="ml-1 text-[11px] opacity-70">{countOf(t.key)}</span>}
            </button>
          ))}
          {rows && (
            <span className="ml-auto self-center text-[11.5px] text-ink3" data-testid="order-rowcount"
              title="Angka pada tab adalah TOTAL unit per status (tidak mengikuti pencarian). Daftar dimuat bertahap dari server — tekan 'Muat lagi' untuk halaman berikutnya.">
              Menampilkan {rows.length} dari {meta.total} unit
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search" value={cari} onChange={(e) => setCari(e.target.value)}
            placeholder="Cari kode unit, no. order, atau nama pelanggan…" aria-label="Cari unit"
            className="h-9 min-w-[240px] flex-1 rounded-btn border border-border bg-surface px-3 text-[12.5px] text-ink outline-none placeholder:text-ink3 focus:border-accent"
          />
        </div>

        {error && <div role="alert" className="rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red">{error}</div>}

        <Card className="overflow-hidden">
          {kosong ? (
            <EmptyState icon={ClipboardList} title="Tidak ada unit yang cocok" description="Coba ubah kata kunci pencarian atau tab status." />
          ) : (
            <>
              <TableWrap className="hidden lg:block">
                <Table>
                  <THead>
                    <TR>
                      <TH sticky>Unit</TH><TH>Pelanggan</TH><TH>Layanan Sales</TH><TH>Status</TH><TH>Tahap</TH><TH>PIC</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {loading && !rows && <TableSkeletonRows rows={8} cols={6} />}
                    {rows?.map((u) => {
                      const st = statusOf(u); const pr = priorityOf(u);
                      return (
                        <TR key={u.id} clickable data-testid="order-row" data-unit-code={u.unitCode} data-priority={pr.key} onClick={() => setDetailUnit(u)}>
                          <TD sticky className="whitespace-nowrap font-semibold text-ink">{u.unitCode}{pr.key !== "NORMAL" && <Badge variant={pr.tone} className="ml-1.5 align-middle" data-testid="priority-badge">{pr.label}</Badge>}</TD>
                          <TD truncate>{u.order?.customer?.name || "—"}</TD>
                          <TD truncate className="text-ink2" data-testid="sales-services">{salesServicesText((u.order?.items || []).map((i) => i.layananName).filter(Boolean))}</TD>
                          <TD>
                            <Badge variant={st.tone} data-testid="status-badge">{st.label}</Badge>
                            {st.detail && <span className="block text-[10px] text-ink3">{st.detail}</span>}
                            {u.presence?.key === "NOT_ARRIVED" && <span className="block text-[10px] font-semibold text-orange">{u.presence.label}</span>}
                            {u.productionStatus === "BLOCKED" && <Badge variant="red" className="mt-0.5">{DELAY_TITLE}</Badge>}
                          </TD>
                          <TD truncate className="text-ink2">{u.currentStage?.labelId || <span className="text-ink3">—</span>}</TD>
                          <TD truncate>
                            {u.assignedOperator?.name || <span className="text-ink3">Belum ditugaskan</span>}
                            {u.workCenter?.name && <span className="block text-[10px] text-ink3">{u.workCenter.name}</span>}
                          </TD>
                        </TR>
                      );
                    })}
                  </TBody>
                </Table>
              </TableWrap>

              <ul className="m-0 list-none divide-y divide-line p-0 lg:hidden">
                {rows?.map((u) => {
                  const st = statusOf(u); const pr = priorityOf(u);
                  return (
                    <li key={u.id}>
                      <button
                        type="button" data-testid="order-row" data-unit-code={u.unitCode} data-priority={pr.key}
                        onClick={() => setDetailUnit(u)}
                        className="w-full px-4 py-3 text-left transition-colors hover:bg-hovertint focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset"
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-[12.5px] font-semibold text-ink">{u.unitCode}</span>
                          {pr.key !== "NORMAL" && <Badge variant={pr.tone} className="shrink-0">{pr.label}</Badge>}
                          <Badge variant={st.tone} className="ml-auto shrink-0">{st.label}</Badge>
                        </div>
                        <div className="mt-0.5 truncate text-[13px] text-ink">{u.order?.customer?.name || "—"}</div>
                        <div className="mt-0.5 break-words text-[11.5px] text-ink2"><span className="font-semibold text-ink3">Layanan Sales: </span>{salesServicesText((u.order?.items || []).map((i) => i.layananName).filter(Boolean))}</div>
                        <div className="mt-0.5 truncate text-[11px] text-ink2">
                          {u.order?.orderNumber || "—"}
                          {(u.merk || u.ukuran) && ` · ${[u.merk, formatUkuranLabel(u.ukuran)].filter(Boolean).join(" ")}`}
                          {u.currentStage?.labelId && ` · ${u.currentStage.labelId}`}
                          {u.executionState === "PAUSED" && " · Dijeda"}
                          {u.productionStatus === "BLOCKED" && ` · ${DELAY_TITLE}`}
                          {u.currentSegmentStartedAt && ` · Berjalan ${formatDurasiDetik(elapsedSejak(u.currentSegmentStartedAt))}`}
                          {u.assignedOperator?.name && ` · ${u.assignedOperator.name}`}
                          {` · ${formatTanggal(u.updatedAt)}`}
                          {u.productionDueAt && ` · Target ${formatTanggal(u.productionDueAt)}`}
                        </div>
                        {u.presence?.key === "NOT_ARRIVED" && <div className={cn("mt-0.5 text-[11px] font-semibold", presenceTone(u.presence) === "orange" && "text-orange")}>{u.presence.label}</div>}
                      </button>
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

      {/* Klik baris → Unit 360 di drawer yang SAMA. Unit tanpa rencana tetap terbaca di drawer ini (data order asli), bukan halaman/tab terpisah. */}
      <UnitOverviewDrawer unitId={openUnitId} onClose={() => setDetailUnit(null)} onChanged={reload} />
    </PageContainer>
  );
}
