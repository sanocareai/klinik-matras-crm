import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useSearchParams } from "react-router-dom";
import { CalendarDays, CalendarClock, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ClipboardList, PackageCheck, PackageX, RefreshCw, Target, Timer, Undo2, XCircle } from "lucide-react";
import { api } from "@/api.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Card } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { formatTanggal } from "@/utils/formatDate.js";
import { PRIORITIES, friendlyError, stationCapacity, wibDate } from "@/features/production/experience.js";
import { bomLineAvailability, validateBOMLines } from "@/features/production/planning.js";
import { UnitPhotoPanel } from "@/features/production/UnitPhotoThumb.jsx";
import { UnitOverviewDrawer } from "@/features/production/UnitOverviewDrawer.jsx";
import { UpcomingCard } from "@/features/production/UnitCard.jsx";
import { DragHandle, PlanCard } from "@/features/production/PlanCard.jsx";
import { decideDrop, describeTarget, insertIndexAt, isPlanComplete, listWithInserted, planDisplayOrder, priorityInsertIndex, priorityInversion } from "@/features/production/planDnd.js";
import { simulateDrop } from "@/features/production/planDndSim.js";
import { isDemoActive } from "@/features/production/demo/demoGate.js";
import { usePlanDrag } from "@/features/production/usePlanDrag.js";
import { ScheduleModal } from "@/features/production/ScheduleModals.jsx";
import { MEJA, backlogOf, mattressInfo, mejaLabel } from "@/features/production/unitCardModel.js";
import { hasManualOrder, moveStep } from "@/features/production/stationOrder.js";
import { rolesOf } from "@/lib/roles.js";

// Rencana Produksi (P9 UX Realignment) — PLANNER harian seperti Route Planner Delivery: panel backlog "Belum
// Dijadwalkan" di kiri + area jadwal per Meja 1–4 (kapasitas 3 unit/meja, target 12/hari) untuk tanggal terpilih.
// Kartu unit SAMA dengan Status Produksi & QC (foto-pertama). Seret-lepas kartu ke meja = jadwalkan/pindahkan; tombol
// "Jadwalkan/Pindahkan" adalah fallback yang selalu ada (layar sentuh, keyboard). Seluruh mutasi lewat command P3/P9B
// yang SUDAH ADA (planProductionV2Unit / scheduleProductionV2Plan) — server menegakkan kapasitas, izin, cohort, dan
// revisi. Alokasi bahan (Planned BOM/reservasi) tetap lewat "Kelola Rencana" di dalam Unit 360 (DetailRencana).

const fmtShort = (iso) => (iso ? new Date(iso).toISOString().slice(0, 10) : null);
const shiftDate = (d, days) => new Date(new Date(`${d}T00:00:00Z`).getTime() + days * 86400_000).toISOString().slice(0, 10);
const user = (() => { try { return JSON.parse(localStorage.getItem("user") || "null"); } catch { return null; } })();
const canUploadPhoto = rolesOf(user).some((r) => ["ADMIN", "OWNER", "PRODUCTION_LEAD"].includes(r));

function AssignSection({ target, refs, onSaved, onError }) {
  const plan = target.plan;
  const [form, setForm] = useState(() => ({
    productionDate: fmtShort(plan?.productionDate) || wibDate(1),
    stationCode: plan?.stationCode || refs.stations[0] || "TABLE_1",
    priority: plan?.priority ?? 0,
    workCenterId: plan?.workCenter?.id || refs.workCenters[0]?.id || "",
    operatorId: plan?.operator?.id || "",
    cornerOperatorId: plan?.cornerOperator?.id || "",
  }));
  const [busy, setBusy] = useState(false);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const field = "mt-1 w-full rounded-btn border border-line bg-transparent px-3 py-2 text-[13px] text-ink";

  async function submit() {
    if (!form.workCenterId || !form.operatorId) { onError("Pilih workshop dan operator."); return; }
    setBusy(true);
    try {
      const body = { ...form, priority: Number(form.priority), cornerOperatorId: form.cornerOperatorId || undefined };
      const result = plan
        ? await api.scheduleProductionV2Plan(plan.id, { ...body, expectedRevision: plan.revision })
        : await api.planProductionV2Unit({ runId: target.runId, ...body });
      onSaved(result, `Rencana ${target.unit.unitCode} disimpan.`);
    } catch (e) { onError(friendlyError(e)); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-2 rounded-btn border border-line p-3">
      <p className="text-[12.5px] font-bold text-ink">Jadwal &amp; Sumber Daya</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-[11.5px] text-ink3">Tanggal produksi<input type="date" className={field} value={form.productionDate} onChange={(e) => set({ productionDate: e.target.value })} /></label>
        <label className="text-[11.5px] text-ink3">Prioritas
          <select className={field} value={form.priority} onChange={(e) => set({ priority: e.target.value })}>{PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</select>
        </label>
        <label className="text-[11.5px] text-ink3">Meja/Stasiun
          <select className={field} value={form.stationCode} onChange={(e) => set({ stationCode: e.target.value })}>{refs.stations.map((s) => <option key={s} value={s}>{s.replace("TABLE_", "Meja ")}</option>)}</select>
        </label>
        <label className="text-[11.5px] text-ink3">Workshop
          <select className={field} value={form.workCenterId} onChange={(e) => set({ workCenterId: e.target.value })}>
            <option value="">— pilih —</option>{refs.workCenters.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </label>
        <label className="text-[11.5px] text-ink3">PIC meja
          <select className={field} value={form.operatorId} onChange={(e) => set({ operatorId: e.target.value })}>
            <option value="">— pilih —</option>{refs.operators.map((o) => <option key={o.id} value={o.id}>{o.user?.name || o.employeeCode}</option>)}
          </select>
        </label>
        <label className="text-[11.5px] text-ink3">PIC Corner — opsional
          <select className={field} value={form.cornerOperatorId} onChange={(e) => set({ cornerOperatorId: e.target.value })}>
            <option value="">Sama dengan PIC meja</option>{refs.operators.map((o) => <option key={o.id} value={o.id}>{o.user?.name || o.employeeCode}</option>)}
          </select>
        </label>
      </div>
      <Button size="sm" data-mutates disabled={busy} onClick={submit}>{busy ? "Menyimpan…" : "Simpan Rencana"}</Button>
    </div>
  );
}

function BOMSection({ plan, materials, stockByMaterial, onSaved, onError }) {
  const [lines, setLines] = useState(() => (plan?.bomLines || []).map((l) => ({ materialId: l.materialId, qty: String(l.qty) })));
  const [busy, setBusy] = useState(false);
  if (!plan) return <p className="rounded-btn border border-dashed border-line p-3 text-[12px] text-ink3">Simpan jadwal &amp; sumber daya dulu sebelum menyusun Planned BOM.</p>;
  const addLine = () => setLines((prev) => [...prev, { materialId: "", qty: "" }]);
  const updateLine = (i, patch) => setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const removeLine = (i) => setLines((prev) => prev.filter((_, idx) => idx !== i));

  async function submit() {
    const payload = lines.filter((l) => l.materialId).map((l) => ({ materialId: l.materialId, qty: Number(l.qty) }));
    const { valid, error } = validateBOMLines(payload);
    if (!valid) { onError(error); return; }
    setBusy(true);
    try {
      const result = await api.setPlannedBOM(plan.id, { lines: payload, expectedRevision: plan.revision });
      onSaved(result, "Planned BOM disimpan.");
    } catch (e) { onError(friendlyError(e)); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-2 rounded-btn border border-line p-3">
      <p className="text-[12.5px] font-bold text-ink">Planned BOM — kebutuhan, tersedia, status</p>
      <table className="w-full text-[11.5px]">
        <thead className="text-ink3"><tr><th className="text-left font-medium">Bahan</th><th className="text-right font-medium">Kebutuhan</th><th className="text-right font-medium">Tersedia</th><th className="text-right font-medium">Status</th><th /></tr></thead>
        <tbody>
          {lines.map((line, i) => {
            const stockRow = stockByMaterial.get(line.materialId);
            const avail = line.materialId && line.qty ? bomLineAvailability(stockRow, line.qty) : null;
            return (
              <tr key={i} className="border-t border-line">
                <td className="py-1.5 pr-2">
                  <select value={line.materialId} onChange={(e) => updateLine(i, { materialId: e.target.value })} className="w-full rounded-btn border border-line bg-transparent px-2 py-1 text-ink">
                    <option value="">— pilih —</option>{materials.map((m) => <option key={m.id} value={m.id}>{m.code} · {m.name}</option>)}
                  </select>
                </td>
                <td className="py-1.5 text-right"><input type="number" min="0" step="0.0001" value={line.qty} onChange={(e) => updateLine(i, { qty: e.target.value })} className="w-16 rounded-btn border border-line bg-transparent px-2 py-1 text-right text-ink" /></td>
                <td className="py-1.5 text-right text-ink3">{avail ? avail.available : "—"}</td>
                <td className="py-1.5 text-right">{avail ? <Badge variant={avail.sufficient ? "green" : "red"}>{avail.sufficient ? "Cukup" : `Kurang ${avail.shortage}`}</Badge> : "—"}</td>
                <td className="py-1.5 text-right"><Button size="sm" variant="ghost" data-mutates onClick={() => removeLine(i)}><XCircle size={13} /></Button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="ghost" data-mutates onClick={addLine}>+ Tambah Bahan</Button>
        <Button size="sm" variant="secondary" data-mutates disabled={busy} onClick={submit}>{busy ? "Menyimpan…" : "Simpan Planned BOM"}</Button>
      </div>
    </div>
  );
}

function ReservationSection({ plan, materials = [], onSaved, onError }) {
  const matLabel = (id) => { const m = materials.find((x) => x.id === id); return m ? `${m.code} · ${m.name}` : id; };
  const [busy, setBusy] = useState(false);
  const [shortages, setShortages] = useState(null);
  const [releasing, setReleasing] = useState(false);
  const [reason, setReason] = useState("");
  if (!plan) return null;
  const canReserve = plan.status === "PLANNED" && plan.bomLines?.length > 0;

  async function doReserve() {
    setBusy(true); setShortages(null);
    try {
      const result = await api.reserveMaterialForPlan(plan.id, { expectedRevision: plan.revision });
      onSaved(result, "Bahan berhasil direservasi.");
    } catch (e) {
      if (e.code === "PLAN_MATERIAL_SHORTAGE") setShortages(e.detail?.shortages || []); else onError(friendlyError(e));
    } finally { setBusy(false); }
  }
  // Jalur UI baru untuk meminta Gudang menyerahkan bahan (sebelumnya hanya ada di halaman legacy "Rencana Produksi (lama, P3)").
  async function doRequestPickup() {
    setBusy(true);
    try { const result = await api.requestMaterialPickup(plan.id); onSaved(result, "Pengambilan bahan diajukan ke Gudang (Antrean Gudang > Pengambilan Bahan)."); }
    catch (e) { onError(friendlyError(e)); } finally { setBusy(false); }
  }
  async function doRelease() {
    if (reason.trim().length < 3) { onError("Alasan pelepasan wajib diisi (minimal 3 karakter)."); return; }
    setBusy(true);
    try {
      const result = await api.releasePlanReservations(plan.id, { reason: reason.trim(), expectedRevision: plan.revision });
      setReleasing(false); setReason("");
      onSaved(result, "Reservasi dilepas.");
    } catch (e) { onError(friendlyError(e)); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-2 rounded-btn border border-line p-3">
      <div className="flex items-center justify-between"><p className="text-[12.5px] font-bold text-ink">Status Reservasi Bahan</p><Badge variant={plan.status === "MATERIAL_RESERVED" ? "green" : "neutral"}>{plan.status === "MATERIAL_RESERVED" ? "Direservasi" : "Belum direservasi"}</Badge></div>
      {plan.reservations?.length > 0 ? (
        <ul className="space-y-0.5 text-[11.5px] text-ink3">{plan.reservations.map((r) => <li key={r.id} className="flex justify-between gap-2"><span className="min-w-0 break-words">{matLabel(r.materialId)}</span><span className="tabular-nums">{r.qty}</span></li>)}</ul>
      ) : <p className="text-[11.5px] text-ink3">Belum ada reservasi aktif.</p>}
      {shortages && shortages.length > 0 && <div className="rounded-btn bg-redbg px-2 py-1.5 text-[11.5px] text-red">Stok tidak cukup: {shortages.map((s) => `${s.code} (butuh ${s.needed}, tersedia ${s.available})`).join("; ")}</div>}
      <div className="flex flex-wrap gap-2">
        {canReserve && <Button size="sm" data-mutates disabled={busy} onClick={doReserve}><PackageCheck size={14} /> Reservasi Bahan</Button>}
        {plan.status === "MATERIAL_RESERVED" && !releasing && <Button size="sm" data-mutates disabled={busy} onClick={doRequestPickup}><PackageCheck size={14} /> Ajukan Pengambilan Bahan</Button>}
        {plan.status === "MATERIAL_RESERVED" && !releasing && <Button size="sm" variant="ghost" data-mutates disabled={busy} onClick={() => setReleasing(true)}><Undo2 size={14} /> Lepas Reservasi</Button>}
      </div>
      {releasing && (
        <div className="space-y-2">
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Alasan pelepasan" className="w-full rounded-btn border border-line bg-transparent px-3 py-2 text-[12.5px] text-ink" />
          <div className="flex gap-2">
            <Button size="sm" variant="destructive" data-mutates disabled={busy} onClick={doRelease}>Konfirmasi Lepas</Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setReleasing(false); setReason(""); }}>Batal</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function DetailRencana({ target, refs, materials, stockByMaterial, onClose, onChanged }) {
  const [current, setCurrent] = useState(target);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const unit = current.unit;
  const applySaved = async (result, message) => {
    setNotice(message); setError("");
    if (result?.planId || result?.id) {
      const fresh = await api.getProductionPlan(result.planId || result.id);
      setCurrent({ runId: current.runId, unit: fresh.unit, customer: fresh.customer, plan: fresh });
    }
    onChanged();
  };
  const c = current.customer || {};
  const mattress = mattressInfo({ unit, customer: c.request != null || c.productType ? c : target.customer });
  return (
    <Modal open onOpenChange={(v) => !v && onClose()} title={`Rencana Produksi — ${unit.unitCode}`} description={unit.orderNumber ? `Order ${unit.orderNumber}` : "Tanpa nomor order"} className="w-[680px]">
      <div className="space-y-3 px-6 pb-4">
        {notice && <div role="status" className="rounded-btn bg-greenbg px-3 py-2 text-[12.5px] text-green">{notice}</div>}
        {error && <div role="alert" className="rounded-btn bg-redbg px-3 py-2 text-[12.5px] text-red">{error}</div>}
        <dl className="grid grid-cols-2 gap-2 text-[11.5px] sm:grid-cols-3">
          {[["Pelanggan", c.name || "Belum dicatat"], ["Kota", c.city || "Belum dicatat"], ["Sales", c.salesName || "Belum dicatat"],
            ["Layanan Sales", (c.salesServices?.length ? c : target.customer || {}).salesServices?.join(" + ") || "Belum tercatat"], ["Kasur", [mattress.jenis, mattress.merk, mattress.ukuran].filter(Boolean).join(" · ") || "Belum dicatat"]]
            .map(([k, v]) => <div key={k} className="rounded-btn bg-inset px-3 py-2"><dt className="m-0 text-ink3">{k}</dt><dd className="m-0 font-semibold text-ink">{v}</dd></div>)}
        </dl>
        <UnitPhotoPanel unitId={unit.id} photoUrl={unit.photoUrl} canUpload={canUploadPhoto}
          onUploaded={(photoUrl) => { setCurrent((c) => ({ ...c, unit: { ...c.unit, photoUrl } })); setNotice("Foto identitas unit disimpan."); }} />
        <AssignSection target={current} refs={refs} onSaved={applySaved} onError={setError} />
        <BOMSection plan={current.plan} materials={materials} stockByMaterial={stockByMaterial} onSaved={applySaved} onError={setError} />
        <ReservationSection plan={current.plan} materials={materials} onSaved={applySaved} onError={setError} />
      </div>
    </Modal>
  );
}

function Kpi({ icon: Icon, label, value, hint, tone = "neutral" }) {
  const cls = tone === "red" ? "bg-redbg text-red" : tone === "orange" ? "bg-orangebg text-orange" : tone === "green" ? "bg-greenbg text-green" : "bg-accentbg text-accent";
  return (
    <Card className="flex items-center gap-3 p-4">
      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-btn ${cls}`}><Icon size={20} aria-hidden /></span>
      <div className="min-w-0"><p className="m-0 text-[12px] text-ink3">{label}</p><p className="m-0 text-[20px] font-bold leading-tight text-ink tabular-nums">{value}</p>{hint && <p className="m-0 text-[11px] text-ink3">{hint}</p>}</div>
    </Card>
  );
}

function WeekStrip({ centerDate, onPick, drag, refreshKey }) {
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => shiftDate(centerDate, i - 3)), [centerDate]);
  const [byDay, setByDay] = useState({});
  useEffect(() => {
    let alive = true;
    Promise.all(days.map((d) => api.getProductionV2Board(d).then((b) => [d, b]).catch(() => [d, null])))
      .then((pairs) => { if (alive) setByDay(Object.fromEntries(pairs)); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days.join(","), refreshKey]);
  const today = wibDate(0);
  return (
    <div className="grid grid-cols-7 gap-1.5" data-testid="week-strip" aria-label="Kalender 7 hari">
      {days.map((d) => {
        const b = byDay[d];
        const planned = b?.kpi?.planned ?? null, target = b?.kpi?.target ?? null;
        const sel = d === centerDate;
        const overDay = drag?.resolved?.target?.kind === "day" && drag.resolved.target.date === d ? drag.resolved.decision?.type : null;
        const dow = new Date(`${d}T00:00:00+07:00`).toLocaleDateString("id-ID", { weekday: "short" });
        const dm = new Date(`${d}T00:00:00+07:00`).toLocaleDateString("id-ID", { day: "2-digit", month: "short" });
        return (
          <button key={d} type="button" data-drop-day={d} onClick={() => onPick(d)} aria-pressed={sel}
            className={`flex min-h-[56px] min-w-0 flex-col items-center justify-center rounded-btn border px-1 py-1.5 text-center ${overDay === "moveDate" ? "ring-2 ring-accent" : overDay === "reject" ? "ring-2 ring-red" : ""} ${sel ? "border-accent bg-accentbg" : "border-line bg-surface hover:bg-hovertint"}`}>
            <span className={`text-[10.5px] font-semibold uppercase ${d === today ? "text-accent" : "text-ink3"}`}>{dow}</span>
            <span className="text-[12px] font-bold text-ink">{dm}</span>
            <span className="text-[11px] font-semibold tabular-nums text-ink3">{planned ?? "—"}/{target ?? "—"}</span>
          </button>
        );
      })}
    </div>
  );
}

// Indikator urutan sisip: garis di antara kartu pada posisi tujuan (hanya saat seret ke meja ini dan tujuan valid).
function InsertLine() {
  return <div data-testid="drop-indicator" aria-hidden className="relative my-0.5 h-1.5 rounded-full bg-accent"><span className="absolute -left-1 -top-[3px] h-3 w-3 rounded-full bg-accent" /></div>;
}

// Tombol aksi kartu: kontras tinggi di terang & gelap (bukan varian "secondary" biru-di-atas-biru).
const ACTION_BTN = "min-h-[44px] border border-line bg-inset text-ink hover:bg-hovertint";

function MejaColumn({ station, drag, saving, onOpen, onMove, onReorder, onHandleDown, today, tomorrow, busy = false }) {
  const cap = stationCapacity(station);
  // Urutan tampil = urutan server (manual > prioritas bawaan), unit 12/12 terkunci di paling bawah.
  const items = planDisplayOrder(station.items);
  const planIds = items.map((v) => v.plan?.id).filter(Boolean);
  const manual = hasManualOrder(items);
  const inversion = priorityInversion(items);
  const draggingRunId = drag?.view?.runId ?? null;
  const over = drag?.resolved?.target?.kind === "meja" && drag.resolved.target.code === station.code ? drag.resolved : null; // sasaran saat ini = meja ini
  const decision = over?.decision;
  const valid = !!decision && (decision.type === "place" || decision.type === "reorder");
  const rejected = decision?.type === "reject";
  // Posisi garis sisip = posisi kartu yang diseret di daftar hasil keputusan (sudah memperhitungkan unit 12/12 terkunci).
  const insertAt = valid ? decision.orderedIds.indexOf(drag.view.plan?.id ?? drag.view.runId) : -1;
  const slots = Math.max(0, cap.capacity - items.length);
  const ring = rejected ? "ring-2 ring-red" : valid ? "ring-2 ring-accent" : drag ? "ring-1 ring-line" : "";
  let seen = 0; // kartu non-seret yang sudah dirender
  return (
    <section data-testid="meja-column" data-drop="meja" data-station={station.code} aria-label={`${station.label}, ${cap.label}`}
      className={`flex min-w-0 flex-col gap-2 rounded-card bg-inset p-2.5 transition-shadow ${ring} ${valid ? "bg-accentbg/40" : ""}`}>
      <div className="flex items-start justify-between gap-2 px-1">
        <div className="min-w-0">
          <p className="m-0 text-[14px] font-bold text-ink">{station.label}</p>
          <p className="m-0 truncate text-[11.5px] text-ink3">{station.operatorNames?.length ? `PIC ${station.operatorNames.join(", ")}` : "PIC belum ada"}</p>
          {items.length > 1 && <p data-testid="meja-order-hint" className="m-0 text-[11px] text-ink3">{manual ? "Urutan diatur manual" : "Urutan bawaan: prioritas"} · seret lewat ⋮⋮ atau pakai ▲▼</p>}
        </div>
        <span data-testid="meja-capacity" className={`shrink-0 rounded-chip px-2 py-0.5 text-[12px] font-bold tabular-nums ${cap.full ? "bg-redbg text-red" : "bg-surface text-ink2"}`}>{cap.count} / {cap.capacity} unit{cap.full ? " · penuh" : ""}</span>
      </div>
      {inversion.length > 0 && (
        <p data-testid="priority-inversion" role="note" className="m-0 rounded-btn bg-orangebg px-2 py-1.5 text-[12px] font-semibold text-orange">
          Perhatian: {inversion.join(", ")} berprioritas lebih tinggi tetapi berada di bawah unit berprioritas lebih rendah. Urutan manual dihormati — tidak diubah otomatis.
        </p>
      )}
      {rejected && <p data-testid="drop-reject" role="status" className="m-0 rounded-btn bg-redbg px-2 py-1.5 text-[12px] font-semibold text-red">{decision.message}</p>}
      {items.map((v, idx) => {
        const isDragged = v.runId === draggingRunId;
        const locked = isPlanComplete(v);
        const movable = items.filter((x) => !isPlanComplete(x));
        const mi = movable.indexOf(v);
        const line = !isDragged && insertAt === seen; // garis sebelum kartu non-seret ke-`seen`
        if (!isDragged) seen += 1;
        return (
          <React.Fragment key={v.runId}>
            {line && <InsertLine />}
            <div data-testid="meja-card" data-meja-card data-run-id={v.runId} data-plan-id={v.plan?.id} className="min-w-0">
              <PlanCard view={v} seq={idx + 1} today={today} tomorrow={tomorrow} dragging={isDragged} onOpen={(x) => onOpen(x.unit.id)}
                handle={<DragHandle unitCode={v.unit.unitCode} disabled={busy} onPointerDown={(e) => onHandleDown(e, v)} />}
                footer={locked ? null : (
                  <div className="flex w-full gap-1.5">
                    <Button size="sm" variant="neutral" data-mutates className={`flex-1 ${ACTION_BTN}`} disabled={busy} onClick={() => onMove(v, station.code)}><CalendarDays size={13} aria-hidden /> Pindahkan</Button>
                    {movable.length > 1 && (
                      <>
                        <Button size="sm" variant="neutral" className={`min-w-[44px] ${ACTION_BTN}`} data-testid="order-up" data-demo-sim aria-label={`Naikkan urutan ${v.unit.unitCode}`} disabled={busy || mi === 0}
                          onClick={() => { const next = moveStep(planIds, v.plan?.id, -1); if (next) onReorder(station, next); }}><ChevronUp size={16} aria-hidden /></Button>
                        <Button size="sm" variant="neutral" className={`min-w-[44px] ${ACTION_BTN}`} data-testid="order-down" data-demo-sim aria-label={`Turunkan urutan ${v.unit.unitCode}`} disabled={busy || mi === movable.length - 1}
                          onClick={() => { const next = moveStep(planIds, v.plan?.id, 1); if (next) onReorder(station, next); }}><ChevronDown size={16} aria-hidden /></Button>
                      </>
                    )}
                  </div>
                )} />
            </div>
          </React.Fragment>
        );
      })}
      {valid && insertAt === seen && <InsertLine />}
      {Array.from({ length: slots }).map((_, i) => (
        <div key={i} data-testid="meja-slot" className={`flex min-h-[72px] items-center justify-center rounded-card border-2 border-dashed px-2 text-center text-[11.5px] ${valid ? "border-accent bg-accentbg/40 text-accent" : "border-line text-ink3"}`}>
          {valid ? `Lepas di sini → ${station.label}` : `+ Seret unit (⋮⋮) ke ${station.label}`}
        </div>
      ))}
      {saving && <p className="sr-only" role="status">Menyimpan…</p>}
    </section>
  );
}

export default function ProductionRencanaWorkspace() {
  const [date, setDate] = useState(() => wibDate(0));
  const dateInputRef = useRef(null);
  const [board, setBoard] = useState(null);
  const [cc, setCc] = useState(null);
  const [refs, setRefs] = useState({ workCenters: [], operators: [], materials: [], stock: [], stations: [...MEJA], services: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [detail, setDetail] = useState(null);
  const [schedule, setSchedule] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(""); // "Menyimpan…" selama command berjalan — posisi final HANYA setelah respons server
  const today = wibDate(0);
  const tomorrow = wibDate(1);

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

  const load = useCallback(() => {
    setLoading(true); setError("");
    return Promise.all([api.getProductionV2Board(date), api.getProductionV2CommandCenter()])
      .then(([b, c]) => { setBoard(b); setCc(c); })
      .catch((e) => setError(friendlyError(e))).finally(() => setLoading(false));
  }, [date]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    // Peran tanpa hak menjadwalkan (PIC/Gudang) tidak boleh memanggil daftar workshop/operator (403 + galat konsol).
    if (!canUploadPhoto) { Promise.all([api.getMaterials({ active: "true" }), api.getStock()]).then(([m, s]) => setRefs((r) => ({ ...r, materials: m || [], stock: s || [] }))).catch(() => {}); return; }
    Promise.all([api.getWorkCenters(), api.getProductionOperators(), api.getMaterials({ active: "true" }), api.getStock()])
      .then(([w, o, m, s]) => setRefs((r) => ({ ...r, workCenters: (w.workCenters || []).filter((x) => x.active !== false), operators: (o.operators || []).filter((x) => x.active !== false), materials: m || [], stock: s || [] })))
      .catch(() => {});
  }, []);
  // Galat drag/urutan muncul di atas halaman; pengguna biasanya sedang menggulir di kartu meja — bawa galat ke pandangan.
  const alertRef = useRef(null);
  useEffect(() => { if (error) alertRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [error]);
  useEffect(() => { if (!notice) return undefined; const t = setTimeout(() => setNotice(""), 5000); return () => clearTimeout(t); }, [notice]);

  const stockByMaterial = useMemo(() => new Map(refs.stock.map((row) => [row.materialId, row])), [refs.stock]);
  const backlog = useMemo(() => backlogOf(cc?.columns), [cc]);
  const upcoming = useMemo(() => cc?.columns?.find((c) => c.key === "AKAN_MASUK")?.items || [], [cc]); // forecast read-only (bukan WIP)
  const stations = board?.stations || [];
  const findView = (runId) => backlog.find((v) => v.runId === runId) || stations.flatMap((s) => s.items).find((v) => v.runId === runId);
  const kpi = board?.kpi;
  const cfg = board?.config;
  const reader = cc?.readerMode ?? board?.readerMode;

  const fmtLong = (d) => formatTanggal(d);

  // SEMUA perubahan jadwal (seret-lepas MAUPUN tombol Jadwalkan/Pindahkan/▲▼) lewat command yang sama. TIDAK optimistic: kartu baru berpindah
  // setelah server menjawab dan papan dimuat ulang. Bila gagal (409 revisi/isi meja berubah/meja penuh/403), papan dimuat ulang dari server
  // (kartu kembali ke posisi sebenarnya) dan pesan Bahasa Indonesia ditampilkan.
  async function commit(label, fn) {
    setBusy(true); setSaving(label); setError("");
    try {
      const out = await fn();
      await load();
      if (out?.notice) setNotice(out.notice);
      if (out?.warning) setError(out.warning);
    } catch (e) { await load(); setError(friendlyError(e)); } // muat ulang dulu (load mengosongkan galat) agar pesan tetap terlihat
    finally { setBusy(false); setSaving(""); }
  }
  // Jadwalkan/pindahkan langsung bila PIC & workshop sudah ada di rencana; kalau belum, buka form (fallback).
  async function placeOn(view, stationCode, decision = null) {
    const plan = view.plan;
    const target = stations.find((s) => s.code === stationCode);
    if (plan?.stationCode === stationCode && plan?.productionDate === date) return;
    if (target && stationCapacity(target).full) { setError(`${target.label} sudah penuh (${stationCapacity(target).label}). Pilih meja lain.`); return; }
    if (!(plan?.workCenter?.id && plan?.operator?.id)) { setSchedule({ ...view, presetStation: stationCode }); return; }
    await commit("Menyimpan jadwal…", async () => {
      await api.scheduleProductionV2Plan(plan.id, {
        productionDate: date, stationCode, priority: plan.priority ?? 0, workCenterId: plan.workCenter.id, operatorId: plan.operator.id,
        cornerOperatorId: plan.cornerOperator?.id || undefined, expectedRevision: plan.revision,
      });
      const where = `${mejaLabel(stationCode)} — ${fmtLong(date)}`;
      if (!decision?.needsReorder) return { notice: `${view.unit.unitCode} dijadwalkan ke ${where}.` };
      try {
        await api.reorderProductionV2Station({ productionDate: date, stationCode, orderedPlanIds: decision.orderedIds });
        return { notice: `${view.unit.unitCode} dijadwalkan ke ${where} di urutan ${decision.orderedIds.indexOf(plan.id) + 1}.` };
      } catch (e) {
        return { warning: `${view.unit.unitCode} sudah dijadwalkan ke ${where}, tetapi urutannya belum tersimpan (masuk paling bawah): ${friendlyError(e)}` };
      }
    });
  }
  async function unschedule(view) {
    const plan = view.plan;
    if (!plan?.stationCode) return;
    await commit("Menyimpan…", async () => {
      await api.scheduleProductionV2Plan(plan.id, { productionDate: null, stationCode: null, priority: plan.priority ?? 0, workCenterId: plan.workCenter?.id, operatorId: plan.operator?.id, cornerOperatorId: plan.cornerOperator?.id || undefined, expectedRevision: plan.revision });
      return { notice: `${view.unit.unitCode} dikembalikan ke Belum Dijadwalkan.` };
    });
  }
  // Pindah tanggal (seret kartu ke hari di kalender): meja SAMA, tanggal baru; server menegakkan kapasitas meja pada tanggal itu.
  async function moveDate(view, day) {
    const plan = view.plan;
    if (!(plan?.workCenter?.id && plan?.operator?.id && plan?.stationCode)) { setSchedule({ ...view, presetStation: plan?.stationCode }); return; }
    await commit("Menyimpan jadwal…", async () => {
      await api.scheduleProductionV2Plan(plan.id, {
        productionDate: day, stationCode: plan.stationCode, priority: plan.priority ?? 0, workCenterId: plan.workCenter.id, operatorId: plan.operator.id,
        cornerOperatorId: plan.cornerOperator?.id || undefined, expectedRevision: plan.revision,
      });
      return { notice: `${view.unit.unitCode} dipindah ke ${mejaLabel(plan.stationCode)} — ${fmtLong(day)}.` };
    });
  }
  // Urutan manual di satu meja: kirim DAFTAR LENGKAP plan id menurut urutan baru; server menolak (409) bila isi meja berubah.
  async function reorderStation(station, orderedPlanIds) {
    if (isDemoActive()) { simulate(null, { type: "reorder", stationCode: station.code, orderedIds: orderedPlanIds }, planOfOrder(station, orderedPlanIds)); return; } // Mode Demo: simulasi memori
    await commit("Menyimpan urutan…", async () => {
      await api.reorderProductionV2Station({ productionDate: date, stationCode: station.code, orderedPlanIds });
      return { notice: `Urutan ${station.label} diperbarui.` };
    });
  }

  // Posisi AWAL menurut prioritas (hanya unit yang masuk meja lewat tombol Jadwalkan, tanpa posisi eksplisit). Urutan manual yang sudah ada TIDAK
  // diubah; bila meja belum punya urutan manual, urutan bawaan server (prioritas) sudah cukup — tidak membuat urutan manual baru.
  async function applyInitialPosition(meta) {
    if (!meta?.stationCode || !meta.planId || isDemoActive()) { await load(); return; }
    try {
      const b = await api.getProductionV2Board(meta.productionDate);
      const ordered = planDisplayOrder((b.stations || []).find((x) => x.code === meta.stationCode)?.items || []);
      const ids = ordered.map((v) => v.plan?.id).filter(Boolean);
      if (ids.length > 1 && ids.includes(meta.planId) && hasManualOrder(ordered)) {
        const others = ordered.filter((v) => v.plan?.id !== meta.planId);
        const want = listWithInserted(ids.filter((x) => x !== meta.planId), meta.planId, priorityInsertIndex(others, meta.priority));
        if (want.some((id, i) => id !== ids[i])) await api.reorderProductionV2Station({ productionDate: meta.productionDate, stationCode: meta.stationCode, orderedPlanIds: want });
      }
    } catch (e) { setError(`Unit sudah dijadwalkan, tetapi posisi awal menurut prioritas belum tersimpan (masuk paling bawah): ${friendlyError(e)}`); }
    await load();
  }

  // --- Mode Demo: seret SIMULASI client-only — tanpa jaringan, hanya mengubah salinan papan/Command Center di memori. Dimuat ulang / keluar demo = data awal. ---
  const planOfOrder = (station, orderedIds) => (station.items || []).find((v) => v.plan?.id === orderedIds[0]) || null;
  function simulate(view, decision, fallbackView = null) {
    const v = view || fallbackView;
    if (!v) return;
    const out = simulateDrop({ board, cc, view: v, decision, date });
    if (!out.message) return;
    setBoard(out.board); setCc(out.cc); setError("");
    setNotice(`Simulasi Mode Latihan — ${out.message}. Tidak disimpan; data awal kembali saat dimuat ulang.`);
  }

  // --- seret-lepas pointer (mouse + sentuh) ---
  const stationsRef = useRef(stations); stationsRef.current = stations;
  const resolveDrop = (x, y, view) => {
    const els = document.elementsFromPoint(x, y);
    const day = els.map((e) => e.closest?.("[data-drop-day]")).find(Boolean);
    let target = null;
    if (day) target = { kind: "day", date: day.getAttribute("data-drop-day") };
    else {
      const col = els.map((e) => e.closest?.("[data-drop]")).find(Boolean);
      const kind = col?.getAttribute("data-drop");
      if (kind === "meja") {
        const mids = [...col.querySelectorAll("[data-meja-card]")].filter((c) => c.getAttribute("data-run-id") !== view.runId)
          .map((c) => { const r = c.getBoundingClientRect(); return r.top + r.height / 2; });
        target = { kind: "meja", code: col.getAttribute("data-station"), index: insertIndexAt(y, mids) };
      } else if (kind === "backlog") target = { kind: "backlog" };
    }
    return target ? { target, decision: decideDrop({ view, target, stations: stationsRef.current, date }) } : null; // lepas di luar sasaran = batal
  };
  const handleDrop = (view, { decision }) => {
    if (decision?.type !== "reject" && isDemoActive()) { if (["place", "reorder", "unschedule", "moveDate"].includes(decision?.type)) simulate(view, decision); return; }
    switch (decision?.type) {
      case "reject": setNotice(""); setError(decision.message); break;
      case "unschedule": unschedule(view); break;
      case "reorder": reorderStation(stationsRef.current.find((s) => s.code === decision.stationCode), decision.orderedIds); break;
      case "place": placeOn(view, decision.stationCode, decision); break;
      case "moveDate": moveDate(view, decision.date); break;
      default: break; // noop
    }
  };
  const { drag, start: onHandleDown } = usePlanDrag({ enabled: !busy && reader !== "OFF", resolve: resolveDrop, onDrop: handleDrop });

  // Kelola Rencana (BOM/reservasi, P3) — dibuka dari dalam Unit 360, aksi tulis lama tidak berubah.
  async function openManageFor(unitId) {
    const view = findView(cc?.columns?.flatMap((c) => c.items).find((i) => i.unit?.id === unitId)?.runId) || cc?.columns?.flatMap((c) => c.items).find((i) => i.unit?.id === unitId && i.runId);
    closeOverview();
    if (!view) return;
    if (view.plan?.id) {
      try { const fresh = await api.getProductionPlan(view.plan.id); setDetail({ runId: view.runId, unit: fresh.unit || view.unit, customer: fresh.customer || view.customer, plan: fresh }); return; } catch (e) { setError(friendlyError(e)); return; }
    }
    setDetail({ runId: view.runId, unit: view.unit, customer: view.customer, plan: null });
  }

  const backlogOver = drag?.resolved?.target?.kind === "backlog" ? drag.resolved.decision?.type : null;

  return (
    <PageContainer fluid>
      <PageHeader title="Rencana Produksi" subtitle={`Jadwal harian per meja · ${fmtLong(date)}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center rounded-btn bg-inset">
              <Button variant="neutral" size="icon" aria-label="Hari sebelumnya" className="min-h-[40px] min-w-[40px]" onClick={() => setDate((d) => shiftDate(d, -1))}><ChevronLeft size={16} /></Button>
              <button type="button" data-testid="date-button" onClick={() => { const el = dateInputRef.current; if (!el) return; if (typeof el.showPicker === "function") el.showPicker(); else el.click(); }} className="flex min-h-[40px] items-center gap-1.5 px-1 text-[13px] font-medium text-ink"><CalendarDays size={14} className="text-ink3" aria-hidden /> {fmtLong(date)}</button>
              <input ref={dateInputRef} type="date" aria-label="Tanggal produksi" className="sr-only" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
              <Button variant="neutral" size="icon" aria-label="Hari berikutnya" className="min-h-[40px] min-w-[40px]" onClick={() => setDate((d) => shiftDate(d, 1))}><ChevronRight size={16} /></Button>
            </div>
            <Button variant="neutral" size="sm" className="min-h-[40px]" onClick={() => setDate(today)}>Hari Ini</Button>
            <Button variant="neutral" size="sm" className="min-h-[40px]" onClick={() => setDate(tomorrow)}>Besok (H-1)</Button>
            <Button variant="neutral" size="sm" className="min-h-[40px]" onClick={load} disabled={loading}><RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Muat Ulang</Button>
          </div>
        } />
      <PageBody>
        {notice && <div role="status" className="rounded-btn bg-greenbg px-3 py-2.5 text-[12.5px] text-green">{notice}</div>}
        {error && <div role="alert" ref={alertRef} className="rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red">{error}</div>}
        {reader === "OFF" ? (
          <Card className="p-0"><EmptyState icon={CalendarClock} title="Rencana produksi belum diaktifkan" description="Fitur ini sedang dalam tahap uji coba (canary)." /></Card>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="planner-kpi">
              <Kpi icon={Target} label="Target harian" value={`${cfg?.dailyTarget ?? "—"} unit`} hint={`${cfg?.capacityPerStation ?? 3} unit per meja × ${cfg?.stations?.length ?? 4} meja`} />
              <Kpi icon={ClipboardList} label="Direncanakan" value={`${kpi?.planned ?? 0} unit`} hint={fmtLong(date)} />
              <Kpi icon={CheckCircle2} label="Selesai" value={`${kpi?.completed ?? 0} unit`} tone="green" />
              <Kpi icon={kpi?.waitingMaterial ? PackageX : Timer} label="Perlu perhatian" value={`${(kpi?.waitingMaterial ?? 0) + (kpi?.late ?? 0)}`} hint={`${kpi?.waitingMaterial ?? 0} menunggu bahan · ${kpi?.late ?? 0} terlambat`} tone={(kpi?.waitingMaterial ?? 0) + (kpi?.late ?? 0) ? "red" : "neutral"} />
            </div>
            <WeekStrip centerDate={date} onPick={setDate} drag={drag} refreshKey={board} />

            <div className="grid min-w-0 gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
              <div className="flex min-w-0 flex-col gap-4">
              <section data-testid="backlog-panel" data-drop="backlog" aria-label="Belum Dijadwalkan"
                className={`flex min-w-0 flex-col gap-2.5 rounded-card bg-inset p-3 xl:max-h-[calc(100vh-260px)] xl:overflow-y-auto ${backlogOver === "unschedule" ? "ring-2 ring-accent" : drag ? "ring-1 ring-line" : ""}`}>
                <div className="flex items-center justify-between px-1">
                  <h2 className="m-0 text-[14px] font-bold text-ink">Belum Dijadwalkan</h2>
                  <span data-testid="backlog-count" className="rounded-chip bg-surface px-2 py-0.5 text-[12px] font-bold tabular-nums text-ink2">{backlog.length} unit</span>
                </div>
                {drag && <p data-testid="backlog-drop-hint" className={`m-0 rounded-btn px-2 py-1.5 text-[12px] font-semibold ${backlogOver === "unschedule" ? "bg-accentbg text-accent" : "bg-surface text-ink3"}`}>Lepas di sini untuk mengembalikan ke Belum Dijadwalkan</p>}
                {backlog.length === 0 && !loading && <p className="rounded-card border-2 border-dashed border-line p-5 text-center text-[12px] text-ink3">Semua unit sudah dijadwalkan.</p>}
                {backlog.map((v) => (
                  <PlanCard key={v.runId} view={v} today={today} tomorrow={tomorrow} dragging={drag?.view?.runId === v.runId} onOpen={(x) => openOverview(x.unit.id)}
                    handle={<DragHandle unitCode={v.unit.unitCode} disabled={busy} onPointerDown={(e) => onHandleDown(e, v)} />}
                    footer={<Button size="sm" data-mutates className="min-h-[44px] w-full" disabled={busy} onClick={() => setSchedule(v)}><CalendarDays size={13} aria-hidden /> Jadwalkan</Button>} />
                ))}
              </section>
              {upcoming.length > 0 && (
                <section data-testid="upcoming-forecast" aria-label="Akan Masuk — Pickup Terjadwal" className="flex min-w-0 flex-col gap-2.5 rounded-card border border-dashed border-line bg-surface p-3">
                  <div className="flex items-center justify-between px-1">
                    <h2 className="m-0 text-[13.5px] font-bold text-ink">Akan Masuk — Pickup Terjadwal</h2>
                    <span data-testid="upcoming-count" className="rounded-chip bg-inset px-2 py-0.5 text-[12px] font-bold tabular-nums text-ink2">{upcoming.length} unit</span>
                  </div>
                  <p className="m-0 px-1 text-[11.5px] text-ink3">Perkiraan kedatangan (forecast). Hanya-baca: belum bisa dijadwalkan atau diseret sampai unit tiba, dan tidak dihitung sebagai WIP, target, atau selesai.</p>
                  {upcoming.map((item) => <UpcomingCard key={item.unit.id} item={item} badgeLabel="Forecast kedatangan" onOpen={openOverview} />)}
                </section>
              )}
              </div>

              <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2" data-testid="meja-grid">
                {(stations.length ? stations : (cfg?.stations || MEJA).map((code) => ({ code, label: mejaLabel(code), capacity: 3, count: 0, items: [], operatorNames: [] }))).map((s) => (
                  <MejaColumn key={s.code} station={s} drag={drag} saving={!!saving} onHandleDown={onHandleDown}
                    onOpen={openOverview} onMove={(v, code) => setSchedule({ ...v, presetStation: code })} onReorder={reorderStation} busy={busy} today={today} tomorrow={tomorrow} />
                ))}
              </div>
            </div>
          </>
        )}
      </PageBody>
      {saving && createPortal(<div role="status" data-testid="saving-banner" className="fixed bottom-4 left-1/2 z-[90] -translate-x-1/2 rounded-btn bg-accent px-4 py-2 text-[13px] font-semibold text-white shadow-lg">{saving}</div>, document.body)}
      {drag && createPortal(
        // Label tujuan di ATAS kartu (tetap terlihat saat jari di tepi bawah layar); posisi dijepit agar ghost tidak terpotong di tepi kiri/kanan.
        <div data-testid="drag-ghost" aria-hidden className="pointer-events-none fixed z-[100] opacity-95 shadow-2xl" style={{ left: Math.max(4, Math.min(drag.x - drag.offX, window.innerWidth - drag.width - 4)), top: drag.y - drag.offY - 34, width: drag.width }}>
          <p data-testid="drag-label" className={`m-0 mb-1 rounded-btn px-2 py-1 text-[12px] font-semibold text-white ${drag.resolved?.decision?.type === "reject" ? "bg-red" : drag.resolved?.decision && drag.resolved.decision.type !== "noop" ? "bg-accent" : "bg-ink3"}`}>
            {drag.resolved ? (describeTarget(drag.resolved.decision, stations, drag.view.plan?.id) || "Posisi sama — tidak ada perubahan") : "Lepas di Meja atau Belum Dijadwalkan"}
          </p>
          <div className="rotate-1"><PlanCard view={drag.view} today={today} tomorrow={tomorrow} /></div>
        </div>, document.body)}
      {detail && <DetailRencana target={detail} refs={refs} materials={refs.materials} stockByMaterial={stockByMaterial} onClose={() => setDetail(null)} onChanged={load} />}
      {overviewUnitId && <UnitOverviewDrawer unitId={overviewUnitId} onClose={closeOverview} manageLabel="Kelola Rencana" onManage={() => openManageFor(overviewUnitId)} />}
      {schedule && board && <ScheduleModal target={schedule} board={board} date={date} refs={{ workCenters: refs.workCenters, operators: refs.operators, services: refs.services }} onClose={() => setSchedule(null)} onDone={(msg, meta) => { setSchedule(null); setNotice(msg); applyInitialPosition(meta); }} />}
    </PageContainer>
  );
}
