import React, { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, PackageCheck, Plus, RefreshCw, Trash2, Undo2, XCircle } from "lucide-react";
import { api } from "@/api.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Card } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import {
  PLAN_TABS, bomLineAvailability, canCancelPlan, canEditBOM, canReleaseReservations, canReservePlan,
  emptyStateCopy, planStatusBadgeFor, validateAssignmentForm, validateBOMLines,
} from "@/features/production/planning.js";

// Rencana Produksi H-1 (Production Workshop + Warehouse V2, P3) — antrean unit eligible, assignment
// workshop/operator/target waktu, Planned BOM, reservasi bahan Gudang. Data hanya muncul bila reader V2
// (production_v2_reader) diaktifkan server untuk cohort unit terkait; di luar itu SELALU kosong (fail-closed),
// bukan error — lihat routes/productionPlanning.js. Halaman ini TIDAK mengaktifkan/mengubah flag apa pun.
// Reservasi TIDAK mengurangi stok fisik (baru terjadi di Material Issue/PICKED, slice berikutnya). Logika murni
// ada di features/production/planning.js, diuji lewat tests/productionPlanning.test.js.

const waktu = (s) => (s ? new Date(s).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
const toInputDateTime = (s) => (s ? new Date(s).toISOString().slice(0, 16) : "");

function EligibleCard({ item, onCreate, creating }) {
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div>
        <p className="text-[13px] font-bold text-ink">{item.unit.unitCode}</p>
        <p className="text-[12px] text-ink3">
          {item.unit.orderNumber ? `Order ${item.unit.orderNumber}` : "Tanpa nomor order"}
          {item.unit.merk ? ` · ${item.unit.merk}` : ""}
        </p>
      </div>
      <dl className="space-y-1 text-[12px]">
        <div className="flex justify-between"><dt className="text-ink3">Lokasi</dt><dd className="text-ink">{item.unit.storageLocation || "—"}</dd></div>
        {item.isLegacyException && <div className="flex justify-between"><dt className="text-ink3">Catatan</dt><dd className="text-ink">Data legacy (pengecualian)</dd></div>}
      </dl>
      <Button size="sm" className="mt-1" disabled={creating} onClick={() => onCreate(item)}>
        <Plus size={14} /> {creating ? "Membuat…" : "Buat Rencana"}
      </Button>
    </Card>
  );
}

function PlanCard({ plan, onOpen }) {
  const badge = planStatusBadgeFor(plan.status);
  return (
    <Card className="flex cursor-pointer flex-col gap-3 p-4 hover:bg-hovertint" onClick={() => onOpen(plan)}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[13px] font-bold text-ink">{plan.unit.unitCode}</p>
          <p className="text-[12px] text-ink3">{plan.unit.orderNumber ? `Order ${plan.unit.orderNumber}` : "Tanpa nomor order"}</p>
        </div>
        <Badge variant={badge.variant}>{badge.label}</Badge>
      </div>
      <dl className="space-y-1 text-[12px]">
        <div className="flex justify-between"><dt className="text-ink3">Workshop</dt><dd className="text-ink">{plan.workCenter?.name || "—"}</dd></div>
        <div className="flex justify-between"><dt className="text-ink3">Target Mulai</dt><dd className="text-ink">{waktu(plan.targetStartAt)}</dd></div>
        <div className="flex justify-between"><dt className="text-ink3">Planned BOM</dt><dd className="text-ink">{plan.bomLines.length} bahan</dd></div>
      </dl>
    </Card>
  );
}

function AssignmentSection({ plan, workCenters, operators, disabled, onSaved, onError }) {
  const [workCenterId, setWorkCenterId] = useState(plan.workCenter?.id || "");
  const [operatorId, setOperatorId] = useState(plan.operator?.id || "");
  const [targetStartAt, setTargetStartAt] = useState(toInputDateTime(plan.targetStartAt));
  const [targetCompleteAt, setTargetCompleteAt] = useState(toInputDateTime(plan.targetCompleteAt));
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const submit = async () => {
    const { valid, errors } = validateAssignmentForm({ workCenterId, operatorId, targetStartAt, targetCompleteAt });
    if (!valid) { setFormError(Object.values(errors)[0]); return; }
    setSaving(true); setFormError("");
    try {
      const result = await api.assignProductionPlan(plan.id, { workCenterId, operatorId, targetStartAt, targetCompleteAt, expectedRevision: plan.revision });
      onSaved(result);
    } catch (e) {
      if (e.status === 409) onError("Data sudah berubah (mungkin diproses petugas lain) — muat ulang rencana.");
      else setFormError(e.message || "Gagal menyimpan penetapan");
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-2 rounded-btn border border-line p-3">
      <p className="text-[12.5px] font-bold text-ink">Penetapan Workshop &amp; Operator</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <select value={workCenterId} onChange={(e) => setWorkCenterId(e.target.value)} disabled={disabled} className="rounded-btn border border-line bg-surface px-3 py-2 text-[13px] text-ink">
          <option value="">— Pilih workshop —</option>
          {workCenters.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <select value={operatorId} onChange={(e) => setOperatorId(e.target.value)} disabled={disabled} className="rounded-btn border border-line bg-surface px-3 py-2 text-[13px] text-ink">
          <option value="">— Pilih operator —</option>
          {operators.map((o) => <option key={o.id} value={o.id}>{o.user?.name || o.employeeCode || o.id}</option>)}
        </select>
        <label className="flex flex-col gap-1 text-[11.5px] text-ink3">
          Target mulai
          <input type="datetime-local" value={targetStartAt} onChange={(e) => setTargetStartAt(e.target.value)} disabled={disabled} className="rounded-btn border border-line bg-surface px-2 py-1.5 text-[13px] text-ink" />
        </label>
        <label className="flex flex-col gap-1 text-[11.5px] text-ink3">
          Target selesai
          <input type="datetime-local" value={targetCompleteAt} onChange={(e) => setTargetCompleteAt(e.target.value)} disabled={disabled} className="rounded-btn border border-line bg-surface px-2 py-1.5 text-[13px] text-ink" />
        </label>
      </div>
      {formError && <p className="text-[12px] text-red">{formError}</p>}
      <Button size="sm" variant="secondary" disabled={disabled || saving} onClick={submit}>{saving ? "Menyimpan…" : "Simpan Penetapan"}</Button>
    </div>
  );
}

function BOMSection({ plan, materials, stockByMaterial, disabled, onSaved, onError }) {
  const [lines, setLines] = useState(plan.bomLines.map((l) => ({ materialId: l.materialId, qty: String(l.qty) })));
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const addLine = () => setLines((prev) => [...prev, { materialId: "", qty: "" }]);
  const removeLine = (index) => setLines((prev) => prev.filter((_, i) => i !== index));
  const updateLine = (index, patch) => setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));

  const submit = async () => {
    const payload = lines.filter((l) => l.materialId).map((l) => ({ materialId: l.materialId, qty: Number(l.qty) }));
    const { valid, error } = validateBOMLines(payload);
    if (!valid) { setFormError(error); return; }
    setSaving(true); setFormError("");
    try {
      const result = await api.setPlannedBOM(plan.id, { lines: payload, expectedRevision: plan.revision });
      onSaved(result);
    } catch (e) {
      if (e.status === 409) onError("Data sudah berubah (mungkin diproses petugas lain) — muat ulang rencana.");
      else setFormError(e.message || "Gagal menyimpan Planned BOM");
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-2 rounded-btn border border-line p-3">
      <p className="text-[12.5px] font-bold text-ink">Planned BOM</p>
      <div className="space-y-2">
        {lines.map((line, index) => {
          const stockRow = stockByMaterial.get(line.materialId);
          const avail = line.materialId && line.qty ? bomLineAvailability(stockRow, line.qty) : null;
          return (
            <div key={index} className="flex flex-wrap items-center gap-2">
              <select value={line.materialId} onChange={(e) => updateLine(index, { materialId: e.target.value })} disabled={disabled} className="min-w-[10rem] flex-1 rounded-btn border border-line bg-surface px-2 py-1.5 text-[13px] text-ink">
                <option value="">— Pilih material —</option>
                {materials.map((m) => <option key={m.id} value={m.id}>{m.code} · {m.name}</option>)}
              </select>
              <input type="number" min="0" step="0.0001" value={line.qty} onChange={(e) => updateLine(index, { qty: e.target.value })} disabled={disabled} placeholder="Jumlah" className="w-24 rounded-btn border border-line bg-surface px-2 py-1.5 text-[13px] text-ink" />
              <Button size="sm" variant="ghost" disabled={disabled} onClick={() => removeLine(index)}><Trash2 size={14} /></Button>
              {avail && (
                <span className={`text-[11px] ${avail.sufficient ? "text-ink3" : "text-red"}`}>
                  tersedia {avail.available} · direservasi {avail.reserved} · butuh {avail.needed}{avail.sufficient ? "" : ` · kurang ${avail.shortage}`}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <Button size="sm" variant="ghost" disabled={disabled} onClick={addLine}><Plus size={14} /> Tambah Bahan</Button>
      {formError && <p className="text-[12px] text-red">{formError}</p>}
      <Button size="sm" variant="secondary" disabled={disabled || saving} onClick={submit}>{saving ? "Menyimpan…" : "Simpan Planned BOM"}</Button>
    </div>
  );
}

function ReservationSection({ plan, disabled, onSaved, onError }) {
  const [saving, setSaving] = useState(false);
  const [shortages, setShortages] = useState(null);
  const [releasing, setReleasing] = useState(false);
  const [releaseReason, setReleaseReason] = useState("");

  const doReserve = async () => {
    setSaving(true); setShortages(null);
    try {
      const result = await api.reserveMaterialForPlan(plan.id, { expectedRevision: plan.revision });
      onSaved(result);
    } catch (e) {
      if (e.code === "PLAN_MATERIAL_SHORTAGE") setShortages(e.detail?.shortages || []);
      else if (e.status === 409) onError("Data sudah berubah (mungkin diproses petugas lain) — muat ulang rencana.");
      else onError(e.message || "Gagal mereservasi bahan");
    } finally { setSaving(false); }
  };

  const doRelease = async () => {
    if (releaseReason.trim().length < 3) { onError("Alasan pelepasan wajib diisi (minimal 3 karakter)"); return; }
    setSaving(true);
    try {
      const result = await api.releasePlanReservations(plan.id, { reason: releaseReason.trim(), expectedRevision: plan.revision });
      setReleasing(false); setReleaseReason("");
      onSaved(result);
    } catch (e) {
      onError(e.status === 409 ? "Data sudah berubah — muat ulang rencana." : e.message || "Gagal melepas reservasi");
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-2 rounded-btn border border-line p-3">
      <p className="text-[12.5px] font-bold text-ink">Reservasi Bahan Gudang</p>
      {plan.reservations.length > 0 ? (
        <ul className="space-y-1 text-[12px] text-ink3">
          {plan.reservations.map((r) => <li key={r.id} className="flex justify-between"><span>{r.materialId}</span><span>{r.qty}</span></li>)}
        </ul>
      ) : (
        <p className="text-[12px] text-ink3">Belum ada reservasi aktif.</p>
      )}
      {shortages && shortages.length > 0 && (
        <div className="rounded-btn bg-redbg p-2 text-[12px] text-red">
          Stok tidak cukup: {shortages.map((s) => `${s.code} (butuh ${s.needed}, tersedia ${s.available})`).join("; ")}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {canReservePlan(plan) && <Button size="sm" disabled={disabled || saving} onClick={doReserve}><PackageCheck size={14} /> Reservasi Bahan</Button>}
        {canReleaseReservations(plan) && plan.reservations.length > 0 && !releasing && (
          <Button size="sm" variant="ghost" disabled={disabled || saving} onClick={() => setReleasing(true)}><Undo2 size={14} /> Lepas Reservasi</Button>
        )}
      </div>
      {releasing && (
        <div className="space-y-2">
          <textarea value={releaseReason} onChange={(e) => setReleaseReason(e.target.value)} rows={2} placeholder="Alasan pelepasan reservasi" className="w-full rounded-btn border border-line bg-surface px-3 py-2 text-[13px] text-ink" />
          <div className="flex gap-2">
            <Button size="sm" variant="destructive" disabled={saving} onClick={doRelease}>{saving ? "Menyimpan…" : "Konfirmasi Lepas"}</Button>
            <Button size="sm" variant="ghost" disabled={saving} onClick={() => { setReleasing(false); setReleaseReason(""); }}>Batal</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function PlanDetailModal({ plan, workCenters, operators, materials, stockByMaterial, onClose, onChanged }) {
  const [current, setCurrent] = useState(plan);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (message) => {
    const fresh = await api.getProductionPlan(current.id);
    setCurrent(fresh);
    if (message) setNotice(message);
    onChanged();
  }, [current.id, onChanged]);

  const disabled = current.status === "CANCELLED" || busy;

  const doCancel = async () => {
    if (cancelReason.trim().length < 3) { setError("Alasan pembatalan wajib diisi (minimal 3 karakter)"); return; }
    setBusy(true); setError("");
    try {
      await api.cancelProductionPlan(current.id, { reason: cancelReason.trim(), expectedRevision: current.revision });
      setCancelling(false);
      await refresh("Rencana dibatalkan.");
    } catch (e) {
      setError(e.status === 409 ? "Data sudah berubah — muat ulang rencana." : e.message || "Gagal membatalkan rencana");
    } finally { setBusy(false); }
  };

  return (
    <Modal open onOpenChange={(v) => !v && onClose()} title={`Rencana Produksi ${current.unit.unitCode}`} description="Assignment workshop/operator, Planned BOM, dan reservasi bahan untuk unit ini.">
      <div className="space-y-3">
        {notice && <div className="rounded-btn bg-greenbg px-3 py-2 text-[12.5px] text-green">{notice}</div>}
        {error && <div className="rounded-btn bg-redbg px-3 py-2 text-[12.5px] text-red">{error}</div>}
        <Badge variant={planStatusBadgeFor(current.status).variant}>{planStatusBadgeFor(current.status).label}</Badge>

        <AssignmentSection plan={current} workCenters={workCenters} operators={operators} disabled={!canEditBOM(current) || busy}
          onSaved={() => refresh("Penetapan disimpan.")} onError={setError} />
        <BOMSection plan={current} materials={materials} stockByMaterial={stockByMaterial} disabled={!canEditBOM(current) || busy}
          onSaved={() => refresh("Planned BOM disimpan.")} onError={setError} />
        <ReservationSection plan={current} disabled={busy}
          onSaved={() => refresh("Bahan direservasi.")} onError={setError} />

        {canCancelPlan(current) && !cancelling && (
          <Button size="sm" variant="destructive" disabled={busy} onClick={() => setCancelling(true)}><XCircle size={14} /> Batalkan Rencana</Button>
        )}
        {cancelling && (
          <div className="space-y-2 rounded-btn border border-red p-3">
            <textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} rows={2} placeholder="Alasan pembatalan" className="w-full rounded-btn border border-line bg-surface px-3 py-2 text-[13px] text-ink" />
            <div className="flex gap-2">
              <Button size="sm" variant="destructive" disabled={busy} onClick={doCancel}>{busy ? "Menyimpan…" : "Konfirmasi Batalkan"}</Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setCancelling(false); setCancelReason(""); }}>Batal</Button>
            </div>
          </div>
        )}
      </div>
      <div className="mt-5 flex justify-end">
        <Button variant="ghost" onClick={onClose}>Tutup</Button>
      </div>
    </Modal>
  );
}

export default function ProductionPlanning() {
  const [tab, setTab] = useState("ELIGIBLE");
  const [items, setItems] = useState(null);
  const [readerMode, setReaderMode] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [creatingRunId, setCreatingRunId] = useState(null);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [refData, setRefData] = useState({ workCenters: [], operators: [], materials: [], stock: [] });

  useEffect(() => {
    Promise.all([api.getWorkCenters(), api.getProductionOperators(), api.getMaterials({ active: "true" }), api.getStock()])
      .then(([wc, op, mats, stock]) => setRefData({ workCenters: wc.workCenters || [], operators: op.operators || [], materials: mats || [], stock: stock || [] }))
      .catch(() => {});
  }, []);

  const stockByMaterial = useMemo(() => new Map(refData.stock.map((row) => [row.materialId, row])), [refData.stock]);

  const load = useCallback(() => {
    setLoading(true); setError("");
    const req = tab === "ELIGIBLE" ? api.getEligibleUnitsForPlanning() : api.getProductionPlans({ status: tab });
    req.then((d) => { setItems(d.items || []); setReaderMode(d.readerMode || null); })
      .catch((e) => setError(e.message || "Gagal memuat data"))
      .finally(() => setLoading(false));
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (item) => {
    setCreatingRunId(item.runId); setError("");
    try {
      const result = await api.createProductionPlan({ runId: item.runId });
      setNotice(result.replayed ? "Rencana sudah ada sebelumnya." : `Rencana dibuat untuk unit ${item.unit.unitCode}.`);
      const plan = await api.getProductionPlan(result.planId);
      setSelectedPlan(plan);
      load();
    } catch (e) {
      setError(e.status === 503 ? "Planning V2 belum aktif untuk unit ini." : e.message || "Gagal membuat rencana");
    } finally { setCreatingRunId(null); }
  };

  const kosong = !loading && items && items.length === 0;
  const emptyCopy = emptyStateCopy({ readerMode, tabKey: tab });

  return (
    <PageContainer>
      <PageHeader
        title="Rencana Produksi"
        subtitle="Planning H-1: assignment workshop/operator, Planned BOM, dan reservasi bahan Gudang."
        actions={<Button variant="ghost" size="sm" onClick={load} disabled={loading}><RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Muat Ulang</Button>}
      />
      <PageBody>
        <div role="tablist" aria-label="Saring rencana produksi" className="flex flex-wrap gap-1 border-b border-line pb-2">
          {PLAN_TABS.map((t) => (
            <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
              className={`rounded-chip px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${tab === t.key ? "bg-accentbg text-accent" : "text-ink3 hover:bg-hovertint hover:text-ink2"}`}>
              {t.label}
            </button>
          ))}
          {items && !kosong && <span className="ml-auto self-center text-[11.5px] text-ink3">{items.length} {tab === "ELIGIBLE" ? "unit" : "rencana"}</span>}
        </div>

        {notice && <div className="rounded-btn bg-greenbg px-3 py-2.5 text-[12.5px] text-green">{notice}</div>}
        {error && <div className="rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red">{error}</div>}

        {loading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[1, 2, 3].map((n) => <Card key={n} className="h-40 animate-pulse bg-inset" />)}</div>
        ) : kosong ? (
          <Card className="overflow-hidden p-0"><EmptyState icon={CalendarClock} title={emptyCopy.title} description={emptyCopy.description} /></Card>
        ) : tab === "ELIGIBLE" ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => <EligibleCard key={item.runId} item={item} onCreate={handleCreate} creating={creatingRunId === item.runId} />)}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((plan) => <PlanCard key={plan.id} plan={plan} onOpen={setSelectedPlan} />)}
          </div>
        )}
      </PageBody>

      {selectedPlan && (
        <PlanDetailModal
          plan={selectedPlan} workCenters={refData.workCenters} operators={refData.operators}
          materials={refData.materials} stockByMaterial={stockByMaterial}
          onClose={() => { setSelectedPlan(null); load(); }}
          onChanged={load}
        />
      )}
    </PageContainer>
  );
}
