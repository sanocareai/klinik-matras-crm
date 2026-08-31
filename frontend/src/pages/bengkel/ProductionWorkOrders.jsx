import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
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
import { formatTanggal } from "@/utils/formatDate.js";
import {
  UNIT_STATUS_REAL, SERVICE_LINE_REAL, IN_WORKSHOP_STATUSES,
} from "@/features/bengkel/unitStatus.js";

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

export default function ProductionWorkOrders() {
  const navigate = useNavigate();
  const [tab, setTab] = useState("");
  const [cari, setCari] = useState("");
  const [fServiceLine, setFServiceLine] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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
    return data.units;
  }, [data, tab]);

  const countFor = useCallback((key) => {
    if (!data) return null;
    const map = Object.fromEntries(data.statusCounts.map((s) => [s.status, s.count]));
    if (key === "") return data.statusCounts.reduce((n, s) => n + s.count, 0);
    if (key === "__WORKSHOP") return IN_WORKSHOP_STATUSES.reduce((n, s) => n + (map[s] || 0), 0);
    return map[key] || 0;
  }, [data]);

  const kosong = !loading && rows && rows.length === 0;
  const belumAdaYangDiEngine = rows?.every((u) => !u.currentStage && !u.service);

  return (
    <PageContainer>
      <PageHeader
        title="Work Order"
        subtitle="Seluruh unit kasur beserta status dan tahap pengerjaannya."
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
          {TABS.map((t) => {
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
          {rows && <span className="ml-auto self-center text-[11.5px] text-ink3">{rows.length} unit</span>}
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
              <TableWrap className="hidden lg:block">
                <Table>
                  <THead>
                    <TR>
                      <TH>Kode Unit</TH><TH>Order</TH><TH>Pelanggan</TH>
                      <TH>Kasur</TH><TH>Lini</TH><TH>Layanan</TH><TH>Tahap</TH><TH>Update Terakhir</TH><TH>Status</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {loading && <TableSkeletonRows rows={8} cols={9} />}
                    {!loading && rows?.map((u) => (
                      <TR key={u.id} clickable onClick={() => navigate(`/bengkel/units/${u.id}`)}>
                        <TD className="font-semibold text-ink">{u.unitCode}</TD>
                        <TD className="text-ink2">{u.order?.orderNumber || "—"}</TD>
                        <TD truncate>{u.order?.customer?.name || "—"}</TD>
                        <TD truncate className="text-ink2">
                          {[u.merk, u.ukuran].filter(Boolean).join(" · ") || "—"}
                        </TD>
                        <TD>
                          {u.serviceLine
                            ? <Badge variant="accent">{SERVICE_LINE_REAL[u.serviceLine]?.label}</Badge>
                            : <span className="text-ink3">—</span>}
                        </TD>
                        <TD truncate className="text-ink2">{u.service?.labelId || <span className="text-ink3">—</span>}</TD>
                        <TD truncate className="text-ink2">{u.currentStage?.labelId || <span className="text-ink3">—</span>}</TD>
                        <TD className="whitespace-nowrap text-ink2">{formatTanggal(u.updatedAt)}</TD>
                        <TD>
                          <Badge variant={UNIT_STATUS_REAL[u.status]?.tone || "neutral"}>
                            {UNIT_STATUS_REAL[u.status]?.label || u.status}
                          </Badge>
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
                      onClick={() => navigate(`/bengkel/units/${u.id}`)}
                      className="w-full px-4 py-3 text-left transition-colors hover:bg-hovertint focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset"
                    >
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[12.5px] font-semibold text-ink">{u.unitCode}</span>
                        <Badge variant={UNIT_STATUS_REAL[u.status]?.tone || "neutral"} className="ml-auto shrink-0">
                          {UNIT_STATUS_REAL[u.status]?.label || u.status}
                        </Badge>
                      </div>
                      <div className="mt-0.5 truncate text-[13px] text-ink">{u.order?.customer?.name || "—"}</div>
                      <div className="mt-0.5 truncate text-[11px] text-ink2">
                        {u.order?.orderNumber || "—"}
                        {(u.merk || u.ukuran) && ` · ${[u.merk, u.ukuran].filter(Boolean).join(" ")}`}
                        {u.currentStage?.labelId && ` · ${u.currentStage.labelId}`}
                        {` · ${formatTanggal(u.updatedAt)}`}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </PageBody>
    </PageContainer>
  );
}
