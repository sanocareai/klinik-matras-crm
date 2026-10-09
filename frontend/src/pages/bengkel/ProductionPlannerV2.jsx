import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertTriangle, CalendarDays, CheckCircle2, ClipboardList, FileText, LayoutGrid, List, PackageX, RefreshCw, Truck } from "lucide-react";
import { unitDetailPath } from "@/lib/legacyProductionRoutes.js";
import { V1UnitCard, useV1Units } from "@/features/production/v1Source.jsx";
import { delayStatusText, presenceTone, priorityOf, salesServicesText, viewPresence, viewStatus } from "@/features/production/productionLabels.js";
import { api } from "@/api.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Card } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { rolesOf } from "@/lib/roles.js";
import {
  bucketStyle, formatMinutes, friendlyError, indicatorList, wibDate,
} from "@/features/production/experience.js";
import { UnitPhotoPanel } from "@/features/production/UnitPhotoThumb.jsx";
import MorningPriorityApprovalPanel from "@/features/production/MorningPriorityApprovalPanel.jsx";
import { UnitOverviewDrawer } from "@/features/production/UnitOverviewDrawer.jsx";
import { UnitCard, UpcomingCard, PicChips } from "@/features/production/UnitCard.jsx";
import PkrRujukan from "@/features/production/PkrRujukan.jsx";
import { ScheduleModal } from "@/features/production/ScheduleModals.jsx";
import { mejaLabel, pipelineChips, stageText } from "@/features/production/unitCardModel.js";

// Status Produksi (P9 UX Realignment) — HANYA pipeline: di mana posisi setiap unit sekarang. BUKAN planner: tidak ada
// navigator tanggal, KPI kedua, Kalender, atau drop-target di sini (KPI ada di Ringkasan; jadwal/meja/PIC di Rencana
// Produksi). Kartu foto-pertama yang SAMA dengan Rencana & QC; klik kartu = Unit 360. Kolom = keadaan fisik unit
// (payload Command Center P9B.1 apa adanya — tidak ada perhitungan paralel). URL TETAP /bengkel/production-v2.
// Jalan pintas tulis lama (Jadwalkan/Pindahkan, tetapkan layanan, Unit Tiba) tetap ada, dijangkau dari Unit 360.

const user = (() => { try { return JSON.parse(localStorage.getItem("user") || "null"); } catch { return null; } })();
const canRoute = rolesOf(user).some((r) => ["ADMIN", "OWNER", "PRODUCTION_LEAD"].includes(r));
const TONE_CLS = { green: "bg-greenbg text-green", red: "bg-redbg text-red", orange: "bg-orangebg text-orange", neutral: "bg-inset text-ink3" };

function RunDrawer({ item, refs, onClose, onSchedule, onConfirmArrival, onChanged }) {
  const c = item.customer;
  return (
    <Modal open onOpenChange={(v) => !v && onClose()} title={item.unit.unitCode} description={`${c.name || "—"} · ${c.orderNumber || "tanpa nomor order"}`} className="w-[640px]">
      <div className="space-y-4 px-6 pb-4">
        <div className="flex flex-wrap gap-1.5">
          <Badge variant={bucketStyle(item.bucket).badge}>{bucketStyle(item.bucket).label}</Badge>
          <Badge variant="neutral">{item.plan?.stationLabel || "Belum dijadwalkan"}</Badge>
          <Badge variant={viewStatus(item).tone} data-testid="status-badge">{viewStatus(item).label}</Badge>
          {viewPresence(item) && <Badge variant={presenceTone(viewPresence(item))}>{viewPresence(item).label}</Badge>}
          {priorityOf(item).key !== "NORMAL" && <Badge variant={priorityOf(item).tone} data-testid="priority-badge">{priorityOf(item).label}</Badge>}
          {item.timer.late && <Badge variant="red">Terlambat</Badge>}
        </div>
        <dl className="m-0 grid grid-cols-2 gap-2 text-[12.5px] sm:grid-cols-3">
          {[
            ["Layanan Sales", salesServicesText(c.salesServices)], ["Merk & ukuran", [item.unit.merk, item.unit.ukuran].filter(Boolean).join(" ") || "—"],
            ["Berat badan", c.weightKg ? `${c.weightKg} kg${c.weightEntries?.length > 1 ? ` (+${c.weightEntries.length - 1})` : ""}` : "—"], ["Posisi tidur", c.sleepPosition || "Belum dicatat Sales"],
            ["Keluhan", c.complaints?.join(", ") || "—"], ["Request", c.request || "—"],
            ["PIC meja", item.plan?.operator?.name || "—"], ["PIC Corner", item.plan?.cornerOperator?.name || (item.plan?.operator ? "Sama dengan PIC meja" : "—")],
            ["Waktu berjalan", formatMinutes(item.timer.elapsedMinutes)],
          ].map(([k, v]) => <div key={k} className="rounded-btn bg-inset px-3 py-2"><dt className="m-0 text-ink3">{k}</dt><dd className="m-0 font-semibold text-ink">{v}</dd></div>)}
        </dl>
        <div className="flex flex-wrap gap-1.5" aria-label="Indikator kesiapan">
          {indicatorList(item.indicators).map((i) => <span key={i.key} className={`rounded-chip px-2 py-1 text-[11.5px] font-medium ${TONE_CLS[i.tone]}`}>{i.label}: {i.value.replaceAll("_", " ").toLowerCase()}</span>)}
        </div>
        {item.warnings?.some((w) => w.code !== "KEKURANGAN") && <ul className="m-0 list-none p-0 space-y-1">{item.warnings.filter((w) => w.code !== "KEKURANGAN").map((w) => <li key={w.code} className="flex items-center gap-1.5 rounded-btn bg-orangebg px-3 py-2 text-[12.5px] text-orange"><AlertTriangle size={13} aria-hidden /> {w.text}</li>)}</ul>}
        {item.shortage && <p data-testid="delay-status" className="flex items-center gap-1.5 rounded-btn bg-redbg px-3 py-2 text-[12.5px] text-red"><PackageX size={13} aria-hidden /> {delayStatusText("MATERIAL_SHORTAGE")}: {item.shortage.items.map((i) => i.name).join(", ")}</p>}
        <ol className="m-0 list-none p-0 grid grid-cols-2 gap-1 sm:grid-cols-3" aria-label="12 tahap">
          {item.steps.map((s) => (
            <li key={s.no} className={`flex items-center gap-1.5 rounded-btn px-2 py-1.5 text-[12px] ${s.status === "DONE" ? "bg-greenbg text-green" : s.status === "CURRENT" ? "bg-accentbg font-semibold text-accent" : s.status === "WAITING" ? "bg-orangebg text-orange" : s.status === "NA" ? "text-ink3 line-through" : "bg-inset text-ink3"}`}>
              {s.status === "DONE" ? <CheckCircle2 size={12} aria-hidden /> : <span className="w-3 text-center tabular-nums">{s.no}</span>} {s.label}
            </li>
          ))}
        </ol>
        <UnitPhotoPanel unitId={item.unit.id} photoUrl={item.unit.photoUrl} canUpload={canRoute} onUploaded={() => onChanged("Foto identitas unit disimpan.")} />
        <div className="flex flex-wrap gap-2">
          {item.bucket === "DALAM_PERJALANAN" && onConfirmArrival && <Button size="sm" data-mutates onClick={() => onConfirmArrival(item)}><Truck size={14} aria-hidden /> Unit Tiba di Workshop</Button>}
          <Button size="sm" data-mutates onClick={() => onSchedule(item)}><CalendarDays size={14} aria-hidden /> {item.plan?.stationCode ? "Pindah / Ubah Jadwal" : "Jadwalkan"}</Button>
          {item.plan && <Button size="sm" variant="secondary" asChild><Link to={`/bengkel/production-v2/laporan/${item.runId}`}><FileText size={14} aria-hidden /> Laporan</Link></Button>}
          <Button size="sm" variant="neutral" asChild><Link to={unitDetailPath(item.unit.id)}>Buka Unit 360</Link></Button>
        </div>
      </div>
    </Modal>
  );
}

function ArrivalButton({ item, onConfirm }) {
  return <Button size="sm" variant="secondary" data-mutates className="min-h-[44px] w-full" onClick={() => onConfirm(item)}><Truck size={13} aria-hidden /> Unit Tiba di Workshop</Button>;
}

function renderCard(item, { openOverview, setArrival, today, tomorrow }) {
  if (item.kind === "UPCOMING_PICKUP") return <UpcomingCard key={`${item.jobId}-${item.unit.id}`} item={item} onOpen={openOverview} />;
  if (item.kind === "AWAITING_ARRIVAL_LEGACY") {
    return <UpcomingCard key={item.handoffId} item={item} onOpen={openOverview} badgeLabel="Dalam perjalanan · data lama" footer={<ArrivalButton item={item} onConfirm={setArrival} />} />;
  }
  return (
    <UnitCard key={item.runId} view={item} today={today} tomorrow={tomorrow} onOpen={(v) => openOverview(v.unit.id)}
      footer={item.bucket === "DALAM_PERJALANAN" ? <ArrivalButton item={item} onConfirm={setArrival} /> : null} />
  );
}

function PipelineColumn({ col, children }) {
  return (
    <section aria-label={col.label} data-testid="pipeline-column" data-column={col.key} className="flex w-[284px] shrink-0 flex-col gap-2 rounded-card bg-inset p-2.5">
      <div className="flex items-center justify-between px-1">
        <p className="m-0 text-[13.5px] font-bold text-ink" title={col.key === "AKAN_MASUK" ? "Perkiraan kedatangan — bukan WIP, target, atau selesai" : "Tahap berubah setelah proses dan bukti disimpan"}>{col.label}</p>
        <span className="rounded-chip bg-surface px-2 py-0.5 text-[12px] font-bold tabular-nums text-ink2">{col.count}</span>
      </div>
      {col.key === "AKAN_MASUK" && <p data-testid="forecast-note" className="m-0 px-1 text-[11px] text-ink3">Forecast kedatangan · hanya-baca, bukan WIP/target/selesai</p>}
      {col.items.length === 0
        ? <p className="flex min-h-[72px] items-center justify-center rounded-card border-2 border-dashed border-line text-center text-[11.5px] text-ink3">Tidak ada unit</p>
        : children}
    </section>
  );
}

export default function ProductionPlannerV2() {
  const [board, setBoard] = useState(null);
  const [cc, setCc] = useState(null);
  const [refs, setRefs] = useState({ workCenters: [], operators: [], services: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [view, setView] = useState("pipeline");
  const [mobileCol, setMobileCol] = useState(null);
  const [drawer, setDrawer] = useState(null);
  const [schedule, setSchedule] = useState(null);
  // Slice 2: "Unit Tiba di Workshop" = SATU aksi, tanpa pilihan lokasi (lokasi workshop bawaan dari Pengaturan Admin). Belum dikonfigurasi -> pesan kebutuhan konfigurasi untuk Admin; tidak ada tiba palsu.
  const [arrivalBusy, setArrivalBusy] = useState(false);
  const setArrival = async (item) => {
    if (arrivalBusy) return;
    setArrivalBusy(true); setError("");
    try { await api.confirmProductionV2UnitArrival(item.unit.id, {}); setNotice(`${item.unit.unitCode} tercatat tiba di workshop.`); load(); }
    catch (e) { setError(e.code === "WORKSHOP_DEFAULT_LOCATION_NOT_CONFIGURED" || e.code === "WORKSHOP_DEFAULT_LOCATION_INVALID" ? e.message : friendlyError(e)); }
    finally { setArrivalBusy(false); }
  };
  const today = wibDate(0);
  const tomorrow = wibDate(1);

  // Unit 360 = aksi utama klik kartu; deep-link ?unit=<id> dibuang saat ditutup (pola sama Orders.jsx).
  const [searchParams, setSearchParams] = useSearchParams();
  const [overviewUnitId, setOverviewUnitId] = useState(() => searchParams.get("unit") || null);
  const openOverview = useCallback((unitId) => {
    setOverviewUnitId(unitId);
    setSearchParams((prev) => { const next = new URLSearchParams(prev); next.set("unit", unitId); return next; }, { replace: false });
  }, [setSearchParams]);
  const closeOverview = useCallback(() => {
    setOverviewUnitId(null);
    setSearchParams((prev) => { const next = new URLSearchParams(prev); next.delete("unit"); return next; }, { replace: true });
  }, [setSearchParams]);

  // cc = SATU sumber data pipeline (sama dengan Ringkasan). board (per-tanggal) hanya untuk kapasitas meja di ScheduleModal.
  const load = useCallback(() => {
    setLoading(true); setError("");
    return Promise.all([api.getProductionV2Board(today), api.getProductionV2CommandCenter()])
      .then(([b, c]) => { setBoard(b); setCc(c); })
      .catch((e) => setError(friendlyError(e))).finally(() => setLoading(false));
  }, [today]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    // Referensi jadwal (workshop/operator/layanan) hanya dibutuhkan peran yang boleh menjadwalkan; peran lain (PIC/Gudang) mendapat
    // 403 dan menimbulkan galat konsol/jaringan di setiap pembukaan halaman (ditemukan lewat sandbox QA).
    if (!canRoute) return;
    Promise.all([
      api.getWorkCenters().catch(() => ({ workCenters: [] })),
      api.getProductionOperators().catch(() => ({ operators: [] })),
      api.getServiceCatalog().catch(() => ({ services: [] })),
    ]).then(([w, o, s]) => setRefs({
      workCenters: (w.workCenters || []).filter((x) => x.active !== false),
      operators: (o.operators || []).filter((x) => x.active !== false),
      services: s.services || [],
    }));
  }, []);
  useEffect(() => { if (!notice) return undefined; const t = setTimeout(() => setNotice(""), 5000); return () => clearTimeout(t); }, [notice]);

  const { v1, total: offTotal, hasMore: offMore, reload: reloadV1 } = useV1Units(); // order Diproses yang belum masuk papan (tanpa label sumber)
  const columns = cc?.columns || [];
  const chips = useMemo(() => pipelineChips(columns), [columns]);
  const activeMobileCol = mobileCol || chips.find((c) => c.count > 0)?.key || chips[0]?.key || (offTotal ? "BELUM_MASUK_PAPAN" : undefined);
  const allItems = useMemo(() => columns.flatMap((c) => c.items.map((i) => ({ ...i, __col: c.label }))), [columns]);
  const totalUnits = allItems.length;
  const ctx = { openOverview, setArrival, today, tomorrow };
  const reader = cc?.readerMode;
  // Unit Diproses yang belum masuk papan tampil di papan yang SAMA (kolom "Belum masuk papan"), tanpa label sumber; hanya halaman pertama dimuat, total dari server.
  const offCol = useMemo(() => ({ key: "BELUM_MASUK_PAPAN", label: "Belum masuk papan", count: offTotal, items: [] }), [offTotal]);
  const chipsAll = useMemo(() => (offTotal ? [...chips, { key: "BELUM_MASUK_PAPAN", label: "Belum masuk papan", count: offTotal }] : chips), [chips, offTotal]);

  return (
    <PageContainer fluid>
      <PageHeader title="Status Produksi" subtitle="Posisi setiap unit di jalur produksi — klik kartu untuk membuka Unit 360. Tahap berubah setelah proses dan bukti disimpan (kartu tidak bisa diseret antar tahap)."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div role="tablist" aria-label="Tampilan" className="flex rounded-btn bg-inset p-0.5">
              {[["pipeline", "Pipeline", LayoutGrid], ["list", "Daftar", List]].map(([k, l, Icon]) => (
                <button key={k} type="button" role="tab" aria-selected={view === k} onClick={() => setView(k)}
                  className={`flex min-h-[40px] items-center gap-1.5 rounded-btn px-3 text-[13px] font-semibold ${view === k ? "bg-surface text-accent shadow-sm" : "text-ink3"}`}><Icon size={14} aria-hidden /> {l}</button>
              ))}
            </div>
            <Button variant="neutral" size="sm" className="min-h-[40px]" onClick={load} disabled={loading}><RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Muat Ulang</Button>
          </div>
        } />
      <PageBody>
        {notice && <div role="status" className="rounded-btn bg-greenbg px-3 py-2.5 text-[12.5px] text-green">{notice}</div>}
        {error && <div role="alert" className="rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red">{error}</div>}

        {/* Usulan Prioritas Pagi dari Dispatcher (3 Oktober 2026) — lihat MorningPriorityApprovalPanel.jsx.
            Komponen sembunyi diri sendiri kalau akun ini tidak berhak (403) atau tidak ada usulan PENDING.
            Hanya dipasang untuk peran pemegang izin (ADMIN/OWNER/PRODUCTION_LEAD): PIC Meja yang mendarat di halaman ini sesudah login TIDAK boleh memicu request yang pasti 403. */}
        {canRoute && <MorningPriorityApprovalPanel />}

        {reader === "OFF" && offTotal === 0 ? (
          <Card className="p-0"><EmptyState icon={ClipboardList} title="Papan produksi belum aktif" description="Papan tampil setelah Production Lead mengaktifkannya untuk unit terkait. Sementara itu, gunakan Order Produksi." action={<Button size="sm" variant="secondary" asChild><Link to="/bengkel/work-orders">Buka Work Order</Link></Button>} /></Card>
        ) : loading && !cc ? (
          <div className="flex gap-3 overflow-hidden">{[1, 2, 3].map((n) => <Card key={n} className="h-72 w-[284px] shrink-0 animate-pulse bg-inset" />)}</div>
        ) : (
          <>
            <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-ink3">
              <span data-testid="pipeline-total"><b className="text-ink">{totalUnits}</b> unit di jalur</span>
              {offTotal > 0 && <span data-testid="offboard-total" className="flex items-center gap-1"><b className="text-ink">{offTotal}</b> unit Diproses belum masuk papan — dikerjakan dari Unit 360</span>}
              <Link to="/bengkel/ringkasan" className="font-semibold text-accent underline">Target &amp; KPI di Ringkasan →</Link>
              <Link to="/bengkel/rencana-produksi" className="font-semibold text-accent underline">Atur jadwal di Rencana Produksi →</Link>
            </p>

            {view === "pipeline" ? (
              <>
                {/* Layar sempit: chip tahap + satu kolom (tanpa scroll horizontal halaman). */}
                <div className="md:hidden">
                  <div role="tablist" aria-label="Tahap pipeline" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-2">
                    {chipsAll.map((c) => (
                      <button key={c.key} type="button" role="tab" aria-selected={activeMobileCol === c.key} onClick={() => setMobileCol(c.key)}
                        className={`flex min-h-[44px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-chip border px-3 text-[12.5px] font-semibold ${activeMobileCol === c.key ? "border-accent bg-accentbg text-accent" : "border-line bg-surface text-ink2"}`}>
                        {c.label} <span className="rounded-chip bg-inset px-1.5 text-[11px] tabular-nums text-ink2">{c.count}</span>
                      </button>
                    ))}
                  </div>
                  <div className="space-y-3" data-testid="mobile-column">
                    {activeMobileCol === "BELUM_MASUK_PAPAN" ? v1.map((u) => <V1UnitCard key={u.id} unit={u} onOpen={openOverview} />) : columns.filter((c) => c.key === activeMobileCol).map((col) => (
                      col.items.length === 0
                        ? <p key={col.key} className="rounded-card border-2 border-dashed border-line p-6 text-center text-[12px] text-ink3">Tidak ada unit di tahap {col.label}</p>
                        : col.items.map((item) => renderCard(item, ctx))
                    ))}
                  </div>
                </div>
                {/* Desktop: pipeline horizontal — semua tahap berdampingan, scroll di dalam kontainer. */}
                <div className="hidden gap-3 overflow-x-auto pb-3 md:flex" data-testid="pipeline">
                  {columns.map((col) => <PipelineColumn key={col.key} col={col}>{col.items.map((item) => renderCard(item, ctx))}</PipelineColumn>)}
                  {offTotal > 0 && <PipelineColumn col={{ ...offCol, count: offTotal, items: v1 }}>{v1.map((u) => <V1UnitCard key={u.id} unit={u} onOpen={openOverview} />)}{offMore && <p className="m-0 px-1 text-[11.5px] text-ink3" data-testid="offboard-more">+{offTotal - v1.length} unit lainnya — lihat Order Produksi.</p>}</PipelineColumn>}
                </div>
              </>
            ) : (
              <Card className="overflow-x-auto p-0">
                <table className="w-full min-w-[860px] text-left text-[12.5px]">
                  <thead className="bg-inset text-ink3"><tr>{["Unit", "Customer", "Layanan Sales", "Status", "Tahap", "Meja", "PIC", "Prioritas"].map((h) => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}</tr></thead>
                  <tbody>
                    {allItems.map((i) => {
                      const pri = i.runId ? priorityOf(i) : null;
                      return (
                        <tr key={i.runId || i.handoffId || `${i.jobId}-${i.unit.id}`} className="cursor-pointer border-t border-line hover:bg-hovertint" onClick={() => openOverview(i.unit.id)}>
                          <td className="px-3 py-2 font-semibold text-ink">{i.unit.unitCode}<div className="font-normal text-ink3">{i.customer?.orderNumber || i.unit.orderNumber || ""}</div></td>
                          <td className="px-3 py-2">{i.customer?.name || "—"}<div className="text-ink3">{i.customer?.city || ""}</div></td>
                          <td className="px-3 py-2">{i.customer?.salesServices?.join(" + ") || <span className="text-ink3">belum tercatat</span>}</td>
                          <td className="px-3 py-2">{i.runId ? <><Badge variant={viewStatus(i).tone}>{viewStatus(i).label}</Badge>{viewPresence(i) && <div className="mt-0.5 text-ink3">{viewPresence(i).label}</div>}</> : <span className="text-ink3">—</span>}</td>
                          <td className="px-3 py-2"><Badge variant={i.bucket ? bucketStyle(i.bucket).badge : "neutral"}>{i.__col}</Badge>{i.runId && <div className="mt-0.5 text-ink3">{stageText(i)}</div>}</td>
                          <td className="px-3 py-2">{i.plan?.stationCode ? mejaLabel(i.plan.stationCode) : "Belum dijadwalkan"}</td>
                          <td className="px-3 py-2">{i.runId ? <PicChips view={i} /> : "—"}</td>
                          <td className="px-3 py-2">{pri && pri.key !== "NORMAL" ? <Badge variant={pri.tone}>{pri.label}</Badge> : <span className="text-ink3">Normal</span>}</td>
                        </tr>
                      );
                    })}
                    {v1.map((u) => (
                      <tr key={`v1-${u.id}`} data-testid="v1-row" data-unit-code={u.unitCode} className="cursor-pointer border-t border-line hover:bg-hovertint" onClick={() => openOverview(u.id)}>
                        <td className="px-3 py-2 font-semibold text-ink">{u.unitCode}<div className="font-normal text-ink3">{u.order?.orderNumber || ""}</div></td>
                        <td className="px-3 py-2">{u.order?.customer?.name || "—"}<PkrRujukan pkr={u.penjualanKaryawan} className="mt-0.5" /></td>
                        <td className="px-3 py-2">{salesServicesText((u.order?.items || []).map((x) => x.layananName).filter(Boolean))}</td>
                        <td className="px-3 py-2"><Badge variant={viewStatus({ unit: u, unitStatus: u.unitStatusDisplay }).tone}>{viewStatus({ unit: u, unitStatus: u.unitStatusDisplay }).label}</Badge></td>
                        <td className="px-3 py-2"><span className="text-ink3">{u.currentStage?.labelId || "Belum masuk papan"}</span></td>
                        <td className="px-3 py-2 text-ink3">—</td><td className="px-3 py-2 text-ink3">{u.assignedOperator?.name || "—"}</td>
                        <td className="px-3 py-2">{priorityOf(u).key !== "NORMAL" ? <Badge variant={priorityOf(u).tone}>{priorityOf(u).label}</Badge> : <span className="text-ink3">Normal</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            )}
          </>
        )}
      </PageBody>

      {drawer && <RunDrawer item={drawer} refs={refs} onClose={() => setDrawer(null)} onSchedule={(i) => { setDrawer(null); setSchedule(i); }} onConfirmArrival={(i) => { setDrawer(null); setArrival(i); }} onChanged={(msg) => { setDrawer(null); setNotice(msg); load(); }} />}
      {overviewUnitId && (
        <UnitOverviewDrawer unitId={overviewUnitId} onClose={closeOverview} onChanged={reloadV1} manageLabel="Kelola Jadwal"
          onManage={() => { const item = allItems.find((i) => i.unit.id === overviewUnitId && i.runId); closeOverview(); if (item) setDrawer(item); }} />
      )}
      {schedule && board && (
        <ScheduleModal target={schedule} board={board} date={today} refs={refs} onClose={() => setSchedule(null)} onDone={(msg) => { setSchedule(null); setNotice(msg); load(); }} />
      )}
    </PageContainer>
  );
}
