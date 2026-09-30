import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CalendarClock, PackageCheck, RefreshCw, Search, Undo2, XCircle } from "lucide-react";
import { api } from "@/api.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Card } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { formatTanggal } from "@/utils/formatDate.js";
import { PRIORITIES, friendlyError, priorityTone, wibDate } from "@/features/production/experience.js";
import { bomLineAvailability, validateBOMLines } from "@/features/production/planning.js";
import { UnitPhotoThumb, UnitPhotoPanel } from "@/features/production/UnitPhotoThumb.jsx";
import { UnitOverviewDrawer } from "@/features/production/UnitOverviewDrawer.jsx";
import { rolesOf } from "@/lib/roles.js";

// P9B.1 — Rencana Produksi (workspace BARU, terpisah dari "Status Produksi" P9B): tempat SUNGGUHAN mengalokasikan
// sumber daya (meja/PIC/tanggal) dan bahan (Planned BOM/reservasi). Tiga kelompok (Belum Direncanakan/Direncanakan/
// Bahan Direservasi), Papan/Kalender/Daftar. SELURUH mutasi lewat command P3 yang SUDAH ADA (planProductionV2Unit/
// scheduleProductionV2Plan dari P9B — BUKAN assignProductionPlan lama yang field-nya beda/targetStartAt-targetCompleteAt,
// supaya cuma SATU jalur tulis assignment yang aktif — plus setPlannedBOM/reserveMaterialForPlan/releasePlanReservations
// dari P3, tidak berubah sejak awal). TIDAK ADA endpoint/command baru di frontend maupun backend untuk workspace ini.

const GROUPS = Object.freeze([
  { key: "BELUM_DIRENCANAKAN", label: "Belum Direncanakan", dot: "bg-ink3" },
  { key: "DIRENCANAKAN", label: "Direncanakan", dot: "bg-accent" },
  { key: "BAHAN_SIAP", label: "Bahan Direservasi", dot: "bg-green" },
]);

const fmtDate = (d) => (d ? formatTanggal(d) : "Belum dicatat");
const fmtShort = (iso) => (iso ? new Date(iso).toISOString().slice(0, 10) : null);
const user = (() => { try { return JSON.parse(localStorage.getItem("user") || "null"); } catch { return null; } })();
const canUploadPhoto = rolesOf(user).some((r) => ["ADMIN", "OWNER", "PRODUCTION_LEAD"].includes(r));

function RencanaCard({ group, item, onOpen }) {
  const isEligible = group === "BELUM_DIRENCANAKAN";
  const unit = item.unit;
  return (
    <button type="button" onClick={() => onOpen(unit.id)} className="w-full rounded-card bg-surface p-3 text-left shadow-sm hover:bg-hovertint">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 gap-2">
          <UnitPhotoThumb photoUrl={unit.photoUrl} />
          <div className="min-w-0">
            <p className="truncate text-[13px] font-bold text-ink">{unit.unitCode}{unit.orderNumber ? ` · ${unit.orderNumber}` : ""}</p>
            <p className="truncate text-[12px] text-ink3">{item.customer?.name || "Belum dicatat"}{item.customer?.city ? ` · ${item.customer.city}` : ""}</p>
          </div>
        </div>
        {!isEligible && item.priority > 0 && <Badge variant={priorityTone(item.priority)}>{PRIORITIES.find((p) => p.value === item.priority)?.label}</Badge>}
      </div>
      <dl className="mt-2 space-y-1 text-[11.5px]">
        <div className="flex justify-between"><dt className="text-ink3">Target Selesai</dt><dd className="text-ink">{isEligible ? "Belum dicatat" : fmtDate(fmtShort(item.productionDate) || fmtShort(item.targetCompleteAt))}</dd></div>
        <div className="flex justify-between"><dt className="text-ink3">Workshop</dt><dd className="text-ink">{item.workCenter?.name || "Belum dicatat"}</dd></div>
        <div className="flex justify-between"><dt className="text-ink3">Operator</dt><dd className="text-ink">{item.operator?.name || "Belum dicatat"}</dd></div>
        {!isEligible && <div className="flex justify-between"><dt className="text-ink3">Planned BOM</dt><dd className="text-ink">{item.bomLines?.length ?? 0} bahan</dd></div>}
      </dl>
    </button>
  );
}

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

export default function ProductionRencanaWorkspace() {
  const [tab, setTab] = useState("board");
  const [search, setSearch] = useState("");
  const [workshopFilter, setWorkshopFilter] = useState("");
  const [operatorFilter, setOperatorFilter] = useState("");
  const [eligible, setEligible] = useState([]);
  const [planned, setPlanned] = useState([]);
  const [reserved, setReserved] = useState([]);
  const [readerMode, setReaderMode] = useState(null);
  const [refs, setRefs] = useState({ workCenters: [], operators: [], materials: [], stock: [], stations: ["TABLE_1", "TABLE_2", "TABLE_3", "TABLE_4"] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);

  // P9C — Unit 360 sekarang aksi UTAMA klik kartu; "Detail Rencana" (jadwal/BOM/reservasi) TETAP ADA sebagai
  // jalan pintas "Kelola Rencana" DARI DALAM Unit 360 — semua aksi tulis lama tetap sama persis.
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
    return Promise.all([
      api.getEligibleUnitsForPlanning(),
      api.getProductionPlans({ status: "PLANNED" }),
      api.getProductionPlans({ status: "MATERIAL_RESERVED" }),
    ]).then(([e, p, r]) => {
      setEligible(e.items || []); setPlanned(p.items || []); setReserved(r.items || []);
      setReaderMode(e.readerMode || null);
    }).catch((e) => setError(friendlyError(e))).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    Promise.all([api.getWorkCenters(), api.getProductionOperators(), api.getMaterials({ active: "true" }), api.getStock()])
      .then(([w, o, m, s]) => setRefs((r) => ({ ...r, workCenters: (w.workCenters || []).filter((x) => x.active !== false), operators: (o.operators || []).filter((x) => x.active !== false), materials: m || [], stock: s || [] })))
      .catch(() => {});
  }, []);

  const stockByMaterial = useMemo(() => new Map(refs.stock.map((row) => [row.materialId, row])), [refs.stock]);

  const norm = (item) => ({ ...item, unit: item.unit, customer: item.customer || null, plan: item.plan ?? (item.status ? item : null) });
  const matches = (item) => {
    const q = search.trim().toLowerCase();
    if (q && !`${item.unit.unitCode} ${item.unit.orderNumber || ""} ${item.customer?.name || ""}`.toLowerCase().includes(q)) return false;
    if (workshopFilter && item.workCenter?.id !== workshopFilter) return false;
    if (operatorFilter && item.operator?.id !== operatorFilter) return false;
    return true;
  };
  const eligibleF = useMemo(() => eligible.filter(matches), [eligible, search, workshopFilter, operatorFilter]);
  const plannedF = useMemo(() => planned.filter(matches), [planned, search, workshopFilter, operatorFilter]);
  const reservedF = useMemo(() => reserved.filter(matches), [reserved, search, workshopFilter, operatorFilter]);
  const groupItems = { BELUM_DIRENCANAKAN: eligibleF, DIRENCANAKAN: plannedF, BAHAN_SIAP: reservedF };

  const openDetail = (item, group) => {
    if (group === "BELUM_DIRENCANAKAN") setDetail({ runId: item.runId, unit: item.unit, customer: null, plan: null });
    else setDetail({ runId: item.runId, unit: item.unit, customer: item.customer, plan: item });
  };
  function openManageFor(unitId) {
    for (const [group, items] of Object.entries(groupItems)) {
      const item = items.find((i) => i.unit.id === unitId);
      if (item) { closeOverview(); openDetail(item, group); return; }
    }
  }

  function dropOn(group, runId) {
    setDropTarget(null);
    if (group !== "DIRENCANAKAN") return; // hanya kolom Direncanakan yang jadi target drop (butuh form, sama pola Status Produksi)
    const item = eligibleF.find((i) => i.runId === runId) || plannedF.find((i) => i.runId === runId) || reservedF.find((i) => i.runId === runId);
    if (!item) return;
    openDetail(item, item.status ? "DIRENCANAKAN" : "BELUM_DIRENCANAKAN");
  }

  const reader = readerMode;
  const totalCount = eligibleF.length + plannedF.length + reservedF.length;

  return (
    <PageContainer fluid>
      <PageHeader title="Rencana Produksi" subtitle="Atur jadwal produksi, alokasikan sumber daya, dan pastikan ketersediaan bahan untuk setiap unit matras."
        actions={<Button variant="neutral" size="sm" onClick={load} disabled={loading}><RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Muat Ulang</Button>} />
      <PageBody>
        {error && <div role="alert" className="rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red">{error}</div>}
        {reader === "OFF" ? (
          <Card className="p-0"><EmptyState icon={CalendarClock} title="Rencana produksi belum diaktifkan" description="Fitur ini sedang dalam tahap uji coba (canary)." /></Card>
        ) : (
          <>
            <Card className="flex flex-wrap items-center gap-2 p-3">
              <div className="flex min-w-[220px] flex-1 items-center gap-2 rounded-btn border border-line px-3 py-2">
                <Search size={14} className="text-ink3" aria-hidden />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari kode unit atau nomor order…" className="w-full bg-transparent text-[13px] text-ink outline-none" />
              </div>
              <select value={workshopFilter} onChange={(e) => setWorkshopFilter(e.target.value)} className="rounded-btn border border-line bg-transparent px-3 py-2 text-[13px] text-ink">
                <option value="">Semua Workshop</option>{refs.workCenters.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
              <select value={operatorFilter} onChange={(e) => setOperatorFilter(e.target.value)} className="rounded-btn border border-line bg-transparent px-3 py-2 text-[13px] text-ink">
                <option value="">Semua Operator</option>{refs.operators.map((o) => <option key={o.id} value={o.id}>{o.user?.name || o.employeeCode}</option>)}
              </select>
            </Card>

            <div role="tablist" aria-label="Tampilan" className="flex gap-1 border-b border-line">
              {[["board", "Papan"], ["calendar", "Kalender"], ["list", "Daftar"]].map(([k, l]) => (
                <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`-mb-px border-b-2 px-3 py-2 text-[13px] font-semibold ${tab === k ? "border-accent text-accent" : "border-transparent text-ink3 hover:text-ink2"}`}>{l}</button>
              ))}
              <span className="ml-auto self-center text-[11.5px] text-ink3">{totalCount} unit</span>
            </div>

            {loading && !eligible.length && !planned.length && !reserved.length ? (
              <div className="grid gap-3 md:grid-cols-3">{[1, 2, 3].map((n) => <Card key={n} className="h-64 animate-pulse bg-inset" />)}</div>
            ) : tab === "board" ? (
              <div className="grid gap-3 md:grid-cols-3">
                {GROUPS.map((g) => {
                  const items = groupItems[g.key];
                  const isDrop = g.key === "DIRENCANAKAN";
                  return (
                    // min-w-0: <section> grid item langsung — tanpa ini, min-width:auto bawaan grid item
                    // membuatnya tidak pernah menyusut di bawah lebar konten terlebarnya di mobile (P9C,
                    // "grid blowout" klasik — lihat catatan sama di ProductionPlannerV2.jsx).
                    <section key={g.key} aria-label={g.label}
                      onDragOver={isDrop ? (e) => { e.preventDefault(); setDropTarget(g.key); } : undefined}
                      onDragLeave={isDrop ? () => setDropTarget(null) : undefined}
                      onDrop={isDrop ? (e) => { e.preventDefault(); dropOn(g.key, e.dataTransfer.getData("text/plain")); } : undefined}
                      className={`flex min-w-0 flex-col gap-2 rounded-card bg-inset p-3 transition-colors ${dropTarget === g.key ? "ring-2 ring-accent" : ""}`}>
                      <div className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${g.dot}`} aria-hidden /><p className="text-[13.5px] font-bold text-ink">{g.label}</p><span className="ml-auto text-[12px] font-semibold tabular-nums text-ink3">{items.length}</span></div>
                      {items.length === 0 ? <p className="rounded-card border-2 border-dashed border-line p-4 text-center text-[11.5px] text-ink3">Tidak ada unit</p>
                        : items.map((item) => (
                          <div key={item.runId} draggable onDragStart={(e) => { e.dataTransfer.setData("text/plain", item.runId); e.dataTransfer.effectAllowed = "move"; }}>
                            <RencanaCard group={g.key} item={item} onOpen={openOverview} />
                          </div>
                        ))}
                    </section>
                  );
                })}
              </div>
            ) : tab === "calendar" ? (
              <Card className="p-4">
                {(() => {
                  const byDate = new Map();
                  for (const p of [...plannedF, ...reservedF]) {
                    const d = fmtShort(p.productionDate);
                    if (!d) continue;
                    byDate.set(d, (byDate.get(d) || 0) + 1);
                  }
                  const days = [...byDate.keys()].sort();
                  if (days.length === 0) return <p className="text-[12.5px] text-ink3">Belum ada rencana dengan tanggal produksi tercatat.</p>;
                  return (
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
                      {days.map((d) => (
                        <div key={d} className="rounded-btn border border-line p-3 text-center">
                          <p className="text-[12px] font-semibold text-ink">{fmtDate(d)}</p>
                          <p className="mt-1 text-[18px] font-bold tabular-nums text-ink">{byDate.get(d)}</p>
                          <p className="text-[10.5px] text-ink3">unit</p>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </Card>
            ) : (
              <Card className="overflow-x-auto p-0">
                <table className="w-full text-left text-[12.5px]">
                  <thead className="bg-inset text-ink3"><tr>{["Kelompok", "Unit", "Pelanggan", "Target", "Workshop", "PIC", "Status"].map((h) => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}</tr></thead>
                  <tbody>
                    {GROUPS.flatMap((g) => groupItems[g.key].map((item) => (
                      <tr key={`${g.key}-${item.runId}`} className="cursor-pointer border-t border-line hover:bg-hovertint" onClick={() => openOverview(item.unit.id)}>
                        <td className="px-3 py-2"><Badge variant="neutral">{g.label}</Badge></td>
                        <td className="px-3 py-2 font-semibold text-ink">{item.unit.unitCode}</td>
                        <td className="px-3 py-2">{item.customer?.name || "Belum dicatat"}</td>
                        <td className="px-3 py-2">{g.key === "BELUM_DIRENCANAKAN" ? "Belum dicatat" : fmtDate(fmtShort(item.productionDate))}</td>
                        <td className="px-3 py-2">{item.workCenter?.name || "Belum dicatat"}</td>
                        <td className="px-3 py-2">{item.operator?.name || "Belum dicatat"}</td>
                        <td className="px-3 py-2">{g.key !== "BELUM_DIRENCANAKAN" && <Badge variant={g.key === "BAHAN_SIAP" ? "green" : "accent"}>{g.label}</Badge>}</td>
                      </tr>
                    )))}
                  </tbody>
                </table>
              </Card>
            )}
          </>
        )}
      </PageBody>
      {detail && <DetailRencana target={detail} refs={refs} materials={refs.materials} stockByMaterial={stockByMaterial} onClose={() => setDetail(null)} onChanged={load} />}
      {overviewUnitId && (
        <UnitOverviewDrawer unitId={overviewUnitId} onClose={closeOverview} manageLabel="Kelola Rencana"
          onManage={() => openManageFor(overviewUnitId)} />
      )}
    </PageContainer>
  );
}
