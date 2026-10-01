import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CalendarDays, CalendarClock, CheckCircle2, ChevronLeft, ChevronRight, ClipboardList, PackageCheck, PackageX, RefreshCw, Target, Timer, Undo2, XCircle } from "lucide-react";
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
import { UnitCard } from "@/features/production/UnitCard.jsx";
import { ScheduleModal } from "@/features/production/ScheduleModals.jsx";
import { MEJA, backlogOf, mejaLabel } from "@/features/production/unitCardModel.js";
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
      <Button size="sm" disabled={busy} onClick={submit}>{busy ? "Menyimpan…" : "Simpan Rencana"}</Button>
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
                <td className="py-1.5 text-right"><Button size="sm" variant="ghost" onClick={() => removeLine(i)}><XCircle size={13} /></Button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="ghost" onClick={addLine}>+ Tambah Bahan</Button>
        <Button size="sm" variant="secondary" disabled={busy} onClick={submit}>{busy ? "Menyimpan…" : "Simpan Planned BOM"}</Button>
      </div>
    </div>
  );
}

function ReservationSection({ plan, onSaved, onError }) {
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
        <ul className="space-y-0.5 text-[11.5px] text-ink3">{plan.reservations.map((r) => <li key={r.id} className="flex justify-between"><span>{r.materialId}</span><span>{r.qty}</span></li>)}</ul>
      ) : <p className="text-[11.5px] text-ink3">Belum ada reservasi aktif.</p>}
      {shortages && shortages.length > 0 && <div className="rounded-btn bg-redbg px-2 py-1.5 text-[11.5px] text-red">Stok tidak cukup: {shortages.map((s) => `${s.code} (butuh ${s.needed}, tersedia ${s.available})`).join("; ")}</div>}
      <div className="flex flex-wrap gap-2">
        {canReserve && <Button size="sm" disabled={busy} onClick={doReserve}><PackageCheck size={14} /> Reservasi Bahan</Button>}
        {plan.status === "MATERIAL_RESERVED" && !releasing && <Button size="sm" variant="ghost" disabled={busy} onClick={() => setReleasing(true)}><Undo2 size={14} /> Lepas Reservasi</Button>}
      </div>
      {releasing && (
        <div className="space-y-2">
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Alasan pelepasan" className="w-full rounded-btn border border-line bg-transparent px-3 py-2 text-[12.5px] text-ink" />
          <div className="flex gap-2">
            <Button size="sm" variant="destructive" disabled={busy} onClick={doRelease}>Konfirmasi Lepas</Button>
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
  return (
    <Modal open onOpenChange={(v) => !v && onClose()} title={`Rencana Produksi — ${unit.unitCode}`} description={unit.orderNumber ? `Order ${unit.orderNumber}` : "Tanpa nomor order"} className="w-[680px]">
      <div className="space-y-3 px-6 pb-4">
        {notice && <div role="status" className="rounded-btn bg-greenbg px-3 py-2 text-[12.5px] text-green">{notice}</div>}
        {error && <div role="alert" className="rounded-btn bg-redbg px-3 py-2 text-[12.5px] text-red">{error}</div>}
        <dl className="grid grid-cols-2 gap-2 text-[11.5px] sm:grid-cols-3">
          {[["Pelanggan", c.name || "Belum dicatat"], ["Kota", c.city || "Belum dicatat"], ["Sales", c.salesName || "Belum dicatat"],
            ["Layanan", unit.service?.label || "Belum ditetapkan"], ["Merk/Ukuran", [unit.merk, unit.ukuran].filter(Boolean).join(" ") || "Belum dicatat"]]
            .map(([k, v]) => <div key={k} className="rounded-btn bg-inset px-3 py-2"><dt className="m-0 text-ink3">{k}</dt><dd className="m-0 font-semibold text-ink">{v}</dd></div>)}
        </dl>
        <UnitPhotoPanel unitId={unit.id} photoUrl={unit.photoUrl} canUpload={canUploadPhoto}
          onUploaded={(photoUrl) => { setCurrent((c) => ({ ...c, unit: { ...c.unit, photoUrl } })); setNotice("Foto identitas unit disimpan."); }} />
        <AssignSection target={current} refs={refs} onSaved={applySaved} onError={setError} />
        <BOMSection plan={current.plan} materials={materials} stockByMaterial={stockByMaterial} onSaved={applySaved} onError={setError} />
        <ReservationSection plan={current.plan} onSaved={applySaved} onError={setError} />
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

function WeekStrip({ centerDate, onPick }) {
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => shiftDate(centerDate, i - 3)), [centerDate]);
  const [byDay, setByDay] = useState({});
  useEffect(() => {
    let alive = true;
    Promise.all(days.map((d) => api.getProductionV2Board(d).then((b) => [d, b]).catch(() => [d, null])))
      .then((pairs) => { if (alive) setByDay(Object.fromEntries(pairs)); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days.join(",")]);
  const today = wibDate(0);
  return (
    <div className="grid grid-cols-7 gap-1.5" data-testid="week-strip" aria-label="Kalender 7 hari">
      {days.map((d) => {
        const b = byDay[d];
        const planned = b?.kpi?.planned ?? null, target = b?.kpi?.target ?? null;
        const sel = d === centerDate;
        const dow = new Date(`${d}T00:00:00+07:00`).toLocaleDateString("id-ID", { weekday: "short" });
        const dm = new Date(`${d}T00:00:00+07:00`).toLocaleDateString("id-ID", { day: "2-digit", month: "short" });
        return (
          <button key={d} type="button" onClick={() => onPick(d)} aria-pressed={sel}
            className={`flex min-h-[56px] min-w-0 flex-col items-center justify-center rounded-btn border px-1 py-1.5 text-center ${sel ? "border-accent bg-accentbg" : "border-line bg-surface hover:bg-hovertint"}`}>
            <span className={`text-[10.5px] font-semibold uppercase ${d === today ? "text-accent" : "text-ink3"}`}>{dow}</span>
            <span className="text-[12px] font-bold text-ink">{dm}</span>
            <span className="text-[11px] font-semibold tabular-nums text-ink3">{planned ?? "—"}/{target ?? "—"}</span>
          </button>
        );
      })}
    </div>
  );
}

function MejaColumn({ station, date, dropActive, onDragOverMeja, onDropMeja, onOpen, onMove, dragStart, today, tomorrow }) {
  const cap = stationCapacity(station);
  const slots = Math.max(0, cap.capacity - station.items.length);
  const items = [...station.items].sort((a, b) => (b.plan?.priority ?? 0) - (a.plan?.priority ?? 0));
  return (
    <section data-testid="meja-column" data-station={station.code} aria-label={`${station.label}, ${cap.label}`}
      onDragOver={(e) => { e.preventDefault(); onDragOverMeja(station.code); }} onDragLeave={() => onDragOverMeja(null)} onDrop={(e) => { e.preventDefault(); onDropMeja(station.code, e.dataTransfer.getData("text/plain")); }}
      className={`flex min-w-0 flex-col gap-2 rounded-card bg-inset p-2.5 transition-shadow ${dropActive ? "ring-2 ring-accent" : ""}`}>
      <div className="flex items-start justify-between gap-2 px-1">
        <div className="min-w-0">
          <p className="m-0 text-[14px] font-bold text-ink">{station.label}</p>
          <p className="m-0 truncate text-[11.5px] text-ink3">{station.operatorNames?.length ? `PIC ${station.operatorNames.join(", ")}` : "PIC belum ada"}</p>
        </div>
        <span data-testid="meja-capacity" className={`shrink-0 rounded-chip px-2 py-0.5 text-[12px] font-bold tabular-nums ${cap.full ? "bg-redbg text-red" : "bg-surface text-ink2"}`}>{cap.count} / {cap.capacity} unit{cap.full ? " · penuh" : ""}</span>
      </div>
      {items.map((v, idx) => (
        <UnitCard key={v.runId} view={v} variant="compact" seq={idx + 1} today={today} tomorrow={tomorrow} draggable onDragStart={(e) => dragStart(e, v.runId)} onOpen={(x) => onOpen(x.unit.id)}
          footer={<Button size="sm" variant="secondary" className="min-h-[44px] w-full" onClick={() => onMove(v, station.code)}><CalendarDays size={13} aria-hidden /> Pindahkan</Button>} />
      ))}
      {Array.from({ length: slots }).map((_, i) => (
        <div key={i} data-testid="meja-slot" className="flex min-h-[64px] items-center justify-center rounded-card border-2 border-dashed border-line px-2 text-center text-[11.5px] text-ink3">
          + Seret unit ke {station.label}
        </div>
      ))}
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
  const [dropOver, setDropOver] = useState(null);
  const [busy, setBusy] = useState(false);
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
    Promise.all([api.getWorkCenters(), api.getProductionOperators(), api.getMaterials({ active: "true" }), api.getStock()])
      .then(([w, o, m, s]) => setRefs((r) => ({ ...r, workCenters: (w.workCenters || []).filter((x) => x.active !== false), operators: (o.operators || []).filter((x) => x.active !== false), materials: m || [], stock: s || [] })))
      .catch(() => {});
  }, []);
  useEffect(() => { if (!notice) return undefined; const t = setTimeout(() => setNotice(""), 5000); return () => clearTimeout(t); }, [notice]);

  const stockByMaterial = useMemo(() => new Map(refs.stock.map((row) => [row.materialId, row])), [refs.stock]);
  const backlog = useMemo(() => backlogOf(cc?.columns), [cc]);
  const stations = board?.stations || [];
  const findView = (runId) => backlog.find((v) => v.runId === runId) || stations.flatMap((s) => s.items).find((v) => v.runId === runId);
  const kpi = board?.kpi;
  const cfg = board?.config;

  const fmtLong = (d) => formatTanggal(d);

  // Jadwalkan/pindahkan langsung (seret-lepas) bila PIC & workshop sudah ada di rencana; kalau belum, buka form (fallback).
  async function placeOn(view, stationCode) {
    const plan = view.plan;
    const target = stations.find((s) => s.code === stationCode);
    if (plan?.stationCode === stationCode && plan?.productionDate === date) return;
    if (target && stationCapacity(target).full) { setError(`${target.label} sudah penuh (${stationCapacity(target).label}). Pilih meja lain.`); return; }
    if (plan?.workCenter?.id && plan?.operator?.id) {
      setBusy(true); setError("");
      try {
        await api.scheduleProductionV2Plan(plan.id, {
          productionDate: date, stationCode, priority: plan.priority ?? 0, workCenterId: plan.workCenter.id, operatorId: plan.operator.id,
          cornerOperatorId: plan.cornerOperator?.id || undefined, expectedRevision: plan.revision,
        });
        setNotice(`${view.unit.unitCode} dijadwalkan ke ${mejaLabel(stationCode)} — ${fmtLong(date)}.`);
        await load();
      } catch (e) { setError(friendlyError(e)); } finally { setBusy(false); }
    } else {
      setSchedule({ ...view, presetStation: stationCode });
    }
  }
  async function unschedule(view) {
    const plan = view.plan;
    if (!plan?.stationCode) return;
    setBusy(true); setError("");
    try {
      await api.scheduleProductionV2Plan(plan.id, { productionDate: null, stationCode: null, priority: plan.priority ?? 0, workCenterId: plan.workCenter?.id, operatorId: plan.operator?.id, cornerOperatorId: plan.cornerOperator?.id || undefined, expectedRevision: plan.revision });
      setNotice(`${view.unit.unitCode} dikembalikan ke Belum Dijadwalkan.`);
      await load();
    } catch (e) { setError(friendlyError(e)); } finally { setBusy(false); }
  }
  const dragStart = (e, runId) => { e.dataTransfer.setData("text/plain", runId); e.dataTransfer.effectAllowed = "move"; };

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

  const reader = cc?.readerMode ?? board?.readerMode;

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
        {error && <div role="alert" className="rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red">{error}</div>}
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
            <WeekStrip centerDate={date} onPick={setDate} />

            <div className="grid min-w-0 gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
              <section data-testid="backlog-panel" aria-label="Belum Dijadwalkan"
                onDragOver={(e) => { e.preventDefault(); setDropOver("BACKLOG"); }} onDragLeave={() => setDropOver(null)}
                onDrop={(e) => { e.preventDefault(); setDropOver(null); const v = findView(e.dataTransfer.getData("text/plain")); if (v?.plan?.stationCode) unschedule(v); }}
                className={`flex min-w-0 flex-col gap-2.5 rounded-card bg-inset p-3 xl:max-h-[calc(100vh-260px)] xl:overflow-y-auto ${dropOver === "BACKLOG" ? "ring-2 ring-accent" : ""}`}>
                <div className="flex items-center justify-between px-1">
                  <h2 className="m-0 text-[14px] font-bold text-ink">Belum Dijadwalkan</h2>
                  <span data-testid="backlog-count" className="rounded-chip bg-surface px-2 py-0.5 text-[12px] font-bold tabular-nums text-ink2">{backlog.length} unit</span>
                </div>
                {backlog.length === 0 && !loading && <p className="rounded-card border-2 border-dashed border-line p-5 text-center text-[12px] text-ink3">Semua unit sudah dijadwalkan.</p>}
                {backlog.map((v) => (
                  <UnitCard key={v.runId} view={v} variant="compact" today={today} tomorrow={tomorrow} draggable onDragStart={(e) => dragStart(e, v.runId)} onOpen={(x) => openOverview(x.unit.id)}
                    footer={<Button size="sm" className="min-h-[44px] w-full" disabled={busy} onClick={() => setSchedule(v)}><CalendarDays size={13} aria-hidden /> Jadwalkan</Button>} />
                ))}
              </section>

              <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2" data-testid="meja-grid">
                {(stations.length ? stations : (cfg?.stations || MEJA).map((code) => ({ code, label: mejaLabel(code), capacity: 3, count: 0, items: [], operatorNames: [] }))).map((s) => (
                  <MejaColumn key={s.code} station={s} date={date} dropActive={dropOver === s.code} onDragOverMeja={setDropOver}
                    onDropMeja={(code, runId) => { setDropOver(null); const v = findView(runId); if (v) placeOn(v, code); }}
                    onOpen={openOverview} onMove={(v, code) => setSchedule({ ...v, presetStation: code })} today={today} tomorrow={tomorrow} />
                ))}
              </div>
            </div>
          </>
        )}
      </PageBody>
      {detail && <DetailRencana target={detail} refs={refs} materials={refs.materials} stockByMaterial={stockByMaterial} onClose={() => setDetail(null)} onChanged={load} />}
      {overviewUnitId && <UnitOverviewDrawer unitId={overviewUnitId} onClose={closeOverview} manageLabel="Kelola Rencana" onManage={() => openManageFor(overviewUnitId)} />}
      {schedule && board && <ScheduleModal target={schedule} board={board} date={date} refs={{ workCenters: refs.workCenters, operators: refs.operators, services: refs.services }} onClose={() => setSchedule(null)} onDone={(msg) => { setSchedule(null); setNotice(msg); load(); }} />}
    </PageContainer>
  );
}
