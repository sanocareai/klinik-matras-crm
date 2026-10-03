import { formatUkuranLabel } from "@/utils/ukuranKasur.js";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ClipboardList, RefreshCw, ExternalLink } from "lucide-react";
import { api } from "@/api.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Card } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import {
  TableWrap, Table, THead, TBody, TR, TH, TD, TableSkeletonRows,
} from "@/components/ui/table.jsx";
import { cn } from "@/lib/utils.js";
import { formatTanggal, formatDurasiDetik } from "@/utils/formatDate.js";
import { describeRowCount } from "@/lib/workOrderCounts.js";
import {
  UNIT_STATUS_REAL, SERVICE_LINE_REAL, IN_WORKSHOP_STATUSES,
  PRODUCTION_STATUS_REAL, PRODUCTION_PRIORITY_REAL, STAGE_LOG_STATUS,
} from "@/features/bengkel/unitStatus.js";

// "Elapsed" per baris (Production Core Slice 3P) — STATIS per-muat, BUKAN
// ticking langsung (halaman ini daftar SAMPAI 500 unit, timer per baris akan
// jadi 500 interval sekaligus — di luar lingkup "no per-row timers"). Segar
// lagi begitu "Muat Ulang"/filter dipakai. Timer LIVE yang sungguhan ada di
// Detail Unit (satu unit, satu timer) — lihat ProductionUnitDetail.jsx.
function elapsedSejak(iso) {
  if (!iso) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
}

// Work Order — Production Tahap 1. DATA NYATA.
//
// Daftar SELURUH unit, lebih lebar dari Papan Produksi (yang sengaja cuma
// menampilkan unit di bengkel hari ini). Gunanya: menelusuri "kasur si A
// sekarang di mana" tanpa harus tahu unit itu sedang dikerjakan atau tidak.
//
// ⚠️ KOLOM LAYANAN & TAHAP AKAN KOSONG untuk hampir semua unit. Itu JUJUR:
// 199 unit di database di-backfill dari Order dan BELUM PERNAH masuk stage
// engine (unit_stage_logs masih 0 baris) — lihat catatan lengkap di
// features/bengkel/unitStatus.js. Mengisinya dengan tebakan akan membuat
// papan produksi berbohong soal di mana kasur sebenarnya berada.
const TABS = [
  { key: "",             label: "Semua" },
  { key: "__WORKSHOP",   label: "Di Bengkel" },
  { key: "AWAITING_PICKUP",    label: "Menunggu Dijemput" },
  { key: "READY_FOR_DELIVERY", label: "Siap Dikirim" },
  { key: "DELIVERED",          label: "Terkirim" },
];

// `initialStatus` (P8.1, opsional) — tab awal saat dibuka dari luar (mis.
// menu "Riwayat" via ProductionOrdersHub.jsx, pra-filter "Terkirim"). Default
// "" mempertahankan perilaku lama persis untuk SEMUA pemanggil yang sudah ada.
// `scope` (P12B.2, hub Order Produksi): "aktif" = semua unit KECUALI Terkirim (tab Terkirim disembunyikan), "riwayat" = hanya Terkirim
// (tanpa tab status). Kosong = perilaku lama persis. Endpoint & data sama (getWorkOrders); hanya penyaringan tampilan.
export default function ProductionWorkOrders({ initialStatus = "", scope = "" } = {}) {
  const navigate = useNavigate();
  const [tab, setTab] = useState(scope === "riwayat" ? "DELIVERED" : initialStatus);
  const tabsShown = scope === "riwayat" ? [] : scope === "aktif" ? TABS.filter((t) => t.key !== "DELIVERED").map((t) => (t.key === "" ? { ...t, label: "Semua Aktif" } : t)) : TABS;
  const [cari, setCari] = useState("");
  const [fServiceLine, setFServiceLine] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Drawer detail (P8.2, UI Polish) — laporan owner dari screenshot live:
  // tabel 14 kolom terlalu padat, kode unit sampai pecah 2 baris. Kolom
  // dipangkas ke 5 prioritas (Unit/Pelanggan/Status/Tahap/PIC); sisanya
  // (Order, Kasur, Lini, Layanan, Eksekusi, Prioritas, Target, Update
  // Terakhir, Progres) pindah ke drawer ini, dibuka lewat klik baris —
  // TIDAK ada data yang hilang, cuma dipindah dari tabel ke drawer.
  const [detailUnit, setDetailUnit] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    // Tab "__WORKSHOP" mencakup DUA status, jadi tidak bisa dikirim sebagai
    // filter status tunggal ke backend — disaring di klien setelahnya.
    api.getWorkOrders({
      status: tab && tab !== "__WORKSHOP" ? tab : undefined,
      serviceLine: fServiceLine || undefined,
      q: cari.trim() || undefined,
    })
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [tab, fServiceLine, cari]);

  useEffect(() => {
    const t = setTimeout(load, cari ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, cari]);

  const rows = useMemo(() => {
    if (!data) return null;
    if (tab === "__WORKSHOP") return data.units.filter((u) => IN_WORKSHOP_STATUSES.includes(u.status));
    if (scope === "aktif" && tab === "") return data.units.filter((u) => u.status !== "DELIVERED");
    return data.units;
  }, [data, tab, scope]);

  const countFor = useCallback((key) => {
    if (!data) return null;
    const map = Object.fromEntries(data.statusCounts.map((s) => [s.status, s.count]));
    if (key === "") return data.statusCounts.reduce((n, s) => n + (scope === "aktif" && s.status === "DELIVERED" ? 0 : s.count), 0);
    if (key === "__WORKSHOP") return IN_WORKSHOP_STATUSES.reduce((n, s) => n + (map[s] || 0), 0);
    return map[key] || 0;
  }, [data, scope]);

  const kosong = !loading && rows && rows.length === 0;
  const belumAdaYangDiEngine = rows?.every((u) => !u.currentStage && !u.service);
  const hasActiveFilter = (scope ? false : tab !== "") || !!fServiceLine || !!cari.trim();

  return (
    <PageContainer>
      <PageHeader
        title={scope === "riwayat" ? "Riwayat Order Produksi" : scope === "aktif" ? "Order Produksi Aktif" : "Work Order"}
        subtitle={scope === "riwayat" ? "Unit yang sudah terkirim ke pelanggan." : scope === "aktif" ? "Unit yang masih berjalan — belum terkirim." : "Seluruh unit kasur beserta status dan tahap pengerjaannya."}
        actions={
          <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Muat Ulang
          </Button>
        }
      />

      <PageBody>
        {rows?.length > 0 && belumAdaYangDiEngine && (
          <div className="rounded-btn border-l-[3px] border-orange bg-orangebg px-3 py-2.5 text-[12px] leading-relaxed text-ink">
            Kolom <strong>Layanan</strong> dan <strong>Tahap</strong> masih kosong karena unit-unit ini
            di-backfill dari data Order dan belum pernah masuk alur tahap produksi.
            Statusnya nyata, tahapnya belum — akan terisi setelah unit diadopsi ke
            alur produksi di tahap berikutnya.
          </div>
        )}

        <div role="tablist" aria-label="Saring status unit" className="flex flex-wrap gap-1 border-b border-line pb-2">
          {tabsShown.map((t) => {
            const n = countFor(t.key);
            return (
              <button
                key={t.key}
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
                className={cn("rounded-chip px-3 py-1.5 text-[12.5px] font-semibold transition-colors",
                  tab === t.key ? "bg-accentbg text-accent" : "text-ink3 hover:bg-hovertint hover:text-ink2")}
              >
                {t.label}{n != null && <span className="ml-1 text-[11px] opacity-70">{n}</span>}
              </button>
            );
          })}
          {rows && (
            <span
              className="ml-auto self-center text-[11.5px] text-ink3"
              title="Angka pada tab di atas (Semua, Di Bengkel, dst) adalah TOTAL seluruh unit per status, tidak mengikuti pencarian/filter lini layanan. Jumlah di sini mengikuti filter yang aktif, dibatasi maksimum 500 baris."
            >
              {describeRowCount({ rowCount: rows.length, hasActiveFilter })}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search" value={cari} onChange={(e) => setCari(e.target.value)}
            placeholder="Cari kode unit, no. order, atau nama pelanggan…" aria-label="Cari unit"
            className="h-9 min-w-[240px] flex-1 rounded-btn border border-border bg-surface px-3 text-[12.5px] text-ink outline-none placeholder:text-ink3 focus:border-accent"
          />
          <select
            value={fServiceLine} onChange={(e) => setFServiceLine(e.target.value)} aria-label="Filter lini layanan"
            className="h-9 rounded-btn border border-border bg-surface px-2.5 text-[12.5px] text-ink outline-none focus:border-accent"
          >
            <option value="">Semua lini</option>
            {Object.entries(SERVICE_LINE_REAL).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
          </select>
        </div>

        {error && <div className="rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red">{error}</div>}

        <Card className="overflow-hidden">
          {kosong ? (
            <EmptyState
              icon={ClipboardList}
              title="Tidak ada unit yang cocok"
              description="Coba ubah kata kunci pencarian, tab status, atau filter lini layanan."
            />
          ) : (
            <>
              {/* P8.2 (UI Polish) — 5 kolom prioritas (Unit/Pelanggan/Status/
                  Tahap/PIC), Unit sticky-kiri + header sticky-atas (TH/TD
                  `sticky`, lihat components/ui/table.jsx), kode unit SATU
                  baris (`whitespace-nowrap`, bukan truncate — kode harus
                  utuh terbaca, bukan terpotong). Kolom lain (Order, Kasur,
                  Lini, Layanan, Eksekusi, Prioritas, Target, Update Terakhir,
                  Progres) pindah ke drawer klik-baris — data SAMA, cuma
                  tempatnya beda. `truncate` (ellipsis) + tooltip OTOMATIS
                  dari `autoTitle` di TD (lihat table.jsx) untuk sel teks
                  panjang (Pelanggan/Tahap/PIC). */}
              <TableWrap className="hidden lg:block">
                <Table>
                  <THead>
                    <TR>
                      <TH sticky>Unit</TH><TH>Pelanggan</TH><TH>Status</TH><TH>Tahap</TH><TH>PIC</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {loading && <TableSkeletonRows rows={8} cols={5} />}
                    {!loading && rows?.map((u) => (
                      <TR key={u.id} clickable onClick={() => setDetailUnit(u)}>
                        <TD sticky className="whitespace-nowrap font-semibold text-ink">{u.unitCode}</TD>
                        <TD truncate>{u.order?.customer?.name || "—"}</TD>
                        <TD>
                          <Badge variant={UNIT_STATUS_REAL[u.status]?.tone || "neutral"}>
                            {UNIT_STATUS_REAL[u.status]?.label || u.status}
                          </Badge>
                        </TD>
                        <TD truncate className="text-ink2">{u.currentStage?.labelId || <span className="text-ink3">—</span>}</TD>
                        {/* PIC (Ditugaskan, Production Core Slice 4O) — Operator +
                            Work Center, SATU kolom gabungan. Sudah batch-loaded
                            di backend (routes/production.js), bukan query per baris. */}
                        <TD truncate>
                          {u.assignedOperator?.name || <span className="text-ink3">Belum ditugaskan</span>}
                          {u.workCenter?.name && <span className="block text-[10px] text-ink3">{u.workCenter.name}</span>}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableWrap>

              <ul className="divide-y divide-line lg:hidden">
                {!loading && rows?.map((u) => (
                  <li key={u.id}>
                    <button
                      type="button"
                      onClick={() => setDetailUnit(u)}
                      className="w-full px-4 py-3 text-left transition-colors hover:bg-hovertint focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset"
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-[12.5px] font-semibold text-ink">{u.unitCode}</span>
                        {u.priority && u.priority !== "NORMAL" && (
                          <Badge variant={PRODUCTION_PRIORITY_REAL[u.priority]?.tone || "neutral"} className="shrink-0">
                            {PRODUCTION_PRIORITY_REAL[u.priority]?.label || u.priority}
                          </Badge>
                        )}
                        <Badge variant={UNIT_STATUS_REAL[u.status]?.tone || "neutral"} className="ml-auto shrink-0">
                          {UNIT_STATUS_REAL[u.status]?.label || u.status}
                        </Badge>
                      </div>
                      <div className="mt-0.5 truncate text-[13px] text-ink">{u.order?.customer?.name || "—"}</div>
                      <div className="mt-0.5 truncate text-[11px] text-ink2">
                        {u.order?.orderNumber || "—"}
                        {(u.merk || u.ukuran) && ` · ${[u.merk, formatUkuranLabel(u.ukuran)].filter(Boolean).join(" ")}`}
                        {u.currentStage?.labelId && ` · ${u.currentStage.labelId}`}
                        {u.executionState === "PAUSED" && " · Dijeda"}
                        {u.currentSegmentStartedAt && ` · Berjalan ${formatDurasiDetik(elapsedSejak(u.currentSegmentStartedAt))}`}
                        {u.assignedOperator?.name && ` · ${u.assignedOperator.name}`}
                        {` · ${formatTanggal(u.updatedAt)}`}
                        {u.productionDueAt && ` · Target ${formatTanggal(u.productionDueAt)}`}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </PageBody>

      {/* Drawer detail (P8.2) — field yang dipangkas dari tabel utama.
          "Buka Detail Unit Lengkap" tetap mengarah ke halaman lama
          (/bengkel/units/:id, TIDAK diubah) untuk pengguna yang butuh
          riwayat/aksi lengkap unit itu. */}
      <Modal open={!!detailUnit} onOpenChange={(v) => !v && setDetailUnit(null)}
        title={detailUnit?.unitCode} description={detailUnit?.order?.customer?.name || "—"} className="w-[520px]">
        {detailUnit && (
          <div className="space-y-3 px-6 pb-4">
            <dl className="m-0 grid grid-cols-2 gap-2 text-[12.5px]">
              {[
                ["Order", detailUnit.order?.orderNumber || "—"],
                ["Kasur", [detailUnit.merk, formatUkuranLabel(detailUnit.ukuran)].filter(Boolean).join(" · ") || "—"],
                ["Lini", detailUnit.serviceLine ? SERVICE_LINE_REAL[detailUnit.serviceLine]?.label : "—"],
                ["Layanan", detailUnit.service?.labelId || "—"],
                ["Prioritas", detailUnit.priority && detailUnit.priority !== "NORMAL" ? (PRODUCTION_PRIORITY_REAL[detailUnit.priority]?.label || detailUnit.priority) : "Normal"],
                ["Target", detailUnit.productionDueAt ? formatTanggal(detailUnit.productionDueAt) : "—"],
                ["Update Terakhir", formatTanggal(detailUnit.updatedAt)],
                ["Progres", detailUnit.productionStatus ? (PRODUCTION_STATUS_REAL[detailUnit.productionStatus]?.label || detailUnit.productionStatus) : "—"],
              ].map(([k, v]) => (
                <div key={k} className="rounded-btn bg-inset px-3 py-2">
                  <dt className="m-0 text-ink3">{k}</dt>
                  <dd className="m-0 truncate font-semibold text-ink" title={typeof v === "string" ? v : undefined}>{v}</dd>
                </div>
              ))}
            </dl>
            {detailUnit.executionState && detailUnit.executionState !== "NOT_STARTED" && (
              <div className="flex items-center gap-1.5 rounded-btn bg-inset px-3 py-2 text-[12.5px]">
                <span className="text-ink3">Eksekusi:</span>
                <Badge variant={STAGE_LOG_STATUS[detailUnit.executionState]?.tone || "neutral"}>
                  {STAGE_LOG_STATUS[detailUnit.executionState]?.label || detailUnit.executionState}
                </Badge>
                {detailUnit.currentSegmentStartedAt && (
                  <span className="text-[11px] text-ink3">{formatDurasiDetik(elapsedSejak(detailUnit.currentSegmentStartedAt))}</span>
                )}
              </div>
            )}
            <Button size="sm" variant="secondary" onClick={() => navigate(`/bengkel/units/${detailUnit.id}`)}>
              <ExternalLink size={13} aria-hidden /> Buka Detail Unit Lengkap
            </Button>
          </div>
        )}
      </Modal>
    </PageContainer>
  );
}
