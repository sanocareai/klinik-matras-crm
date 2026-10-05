import React, { useEffect, useState } from "react";
import { api } from "@/api.js";
import { Button } from "@/components/ui/button.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { PRIORITIES, friendlyError, stationCapacity } from "@/features/production/experience.js";

// P9 UX Realignment — modal jadwal & konfirmasi kedatangan dipindah dari ProductionPlannerV2.jsx supaya dipakai BERSAMA
// Status Produksi (jalan pintas dari Unit 360) dan Rencana Produksi (fallback tombol Jadwalkan/Pindahkan untuk drag-drop).
// Logika & kontrak API TIDAK diubah sama sekali dibanding sebelum dipindah.

// P9A — pemilih lokasi Receiving/WIP untuk "Unit Tiba di Workshop". Tidak ada
// default terpilih (server juga menolak locationId kosong) — pengguna WAJIB
// memilih sendiri, sesuai kontrak "jangan pernah menebak lokasi".
export function ArrivalModal({ target, onClose, onDone }) {
  const [locations, setLocations] = useState(null);
  const [locationId, setLocationId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    api.getProductionV2ReceivingLocations().then((r) => { if (alive) setLocations(r.locations || []); }).catch((e) => { if (alive) setError(friendlyError(e)); });
    return () => { alive = false; };
  }, []);
  async function submit() {
    if (!locationId) { setError("Pilih lokasi penyimpanan dulu."); return; }
    setBusy(true); setError("");
    try {
      await api.confirmProductionV2UnitArrival(target.unit.id, { locationId });
      onDone(`${target.unit.unitCode} tercatat tiba di workshop.`);
    } catch (e) { setError(friendlyError(e)); } finally { setBusy(false); }
  }
  return (
    <Modal open onOpenChange={(v) => !v && onClose()} title={`Unit Tiba di Workshop — ${target.unit.unitCode}`}
      description="Konfirmasi kedatangan fisik unit ke lokasi Receiving/WIP. Tahap produksi baru bisa dimulai setelah ini."
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="neutral" onClick={onClose} disabled={busy}>Batal</Button>
          <Button data-mutates onClick={submit} disabled={busy || !locationId}>{busy ? "Menyimpan…" : "Konfirmasi Tiba"}</Button>
        </div>
      }>
      <div className="space-y-3 px-6 pb-2">
        <label className="text-[12.5px] text-ink3">Lokasi penyimpanan (Receiving/WIP)
          <select className="mt-1 w-full rounded-btn border border-line bg-transparent px-3 py-2 text-[13.5px] text-ink" value={locationId} onChange={(e) => setLocationId(e.target.value)} disabled={!locations}>
            <option value="">{locations ? "— pilih lokasi —" : "Memuat…"}</option>
            {(locations || []).map((l) => <option key={l.id} value={l.id}>{l.code}{l.zone ? ` (${l.zone})` : ""}</option>)}
          </select>
        </label>
        {locations && locations.length === 0 && <p className="rounded-btn bg-orangebg px-3 py-2 text-[12.5px] text-orange">Belum ada lokasi Receiving/WIP aktif. Minta Gudang mengaktifkan satu lokasi dulu.</p>}
        {error && <p role="alert" className="rounded-btn bg-redbg px-3 py-2 text-[12.5px] text-red">{error}</p>}
      </div>
    </Modal>
  );
}

export function ScheduleModal({ target, board, date, refs, onClose, onDone }) {
  const plan = target.plan;
  const [form, setForm] = useState(() => ({
    productionDate: plan?.productionDate || date,
    stationCode: target.presetStation || plan?.stationCode || board.stations.find((s) => !stationCapacity(s).full)?.code || board.config.stations[0],
    priority: plan?.priority ?? 0,
    workCenterId: plan?.workCenter?.id || refs.workCenters[0]?.id || "",
    operatorId: plan?.operator?.id || "",
    cornerOperatorId: plan?.cornerOperator?.id || "",
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const unitCode = target.unit?.unitCode;
  const field = "mt-1 w-full rounded-btn border border-line bg-transparent px-3 py-2 text-[13.5px] text-ink";

  async function submit(unschedule = false) {
    if (!unschedule && (!form.workCenterId || !form.operatorId)) { setError("Pilih workshop dan PIC meja."); return; }
    setBusy(true); setError("");
    const body = unschedule
      ? { productionDate: null, stationCode: null, priority: form.priority }
      : { ...form, priority: Number(form.priority), cornerOperatorId: form.cornerOperatorId || undefined };
    try {
      let result;
      if (plan) result = await api.scheduleProductionV2Plan(plan.id, { ...body, expectedRevision: plan.revision });
      else result = await api.planProductionV2Unit({ runId: target.runId, ...body });
      // Argumen ke-2 (P12A.3): info penempatan agar pemanggil bisa menetapkan POSISI AWAL menurut prioritas (bukan auto-reorder).
      onDone(unschedule ? `${unitCode} dikeluarkan dari papan.` : `${unitCode} dijadwalkan ke ${form.stationCode.replace("TABLE_", "Meja ")}.`,
        unschedule ? null : { planId: plan?.id ?? result?.planId ?? result?.id ?? null, stationCode: form.stationCode, productionDate: form.productionDate, priority: Number(form.priority) });
    } catch (e) { setError(friendlyError(e)); } finally { setBusy(false); }
  }

  return (
    <Modal open onOpenChange={(v) => !v && onClose()} title={plan ? `Jadwal ${unitCode}` : `Rencanakan ${unitCode}`} description="Tanggal produksi, meja bongkar, dan PIC. Kapasitas meja dijaga server."
      footer={
        <div className="flex w-full flex-wrap justify-end gap-2">
          {plan?.stationCode && <Button variant="neutral" data-mutates disabled={busy} onClick={() => submit(true)}>Keluarkan dari papan</Button>}
          <Button variant="neutral" onClick={onClose} disabled={busy}>Batal</Button>
          <Button data-mutates onClick={() => submit(false)} disabled={busy}>{busy ? "Menyimpan…" : "Simpan Jadwal"}</Button>
        </div>
      }>
      <div className="grid gap-3 px-6 pb-2 sm:grid-cols-2">
        <label className="text-[12.5px] text-ink3">Tanggal produksi<input type="date" className={field} value={form.productionDate} onChange={(e) => set({ productionDate: e.target.value })} /></label>
        <label className="text-[12.5px] text-ink3">Meja bongkar
          <select className={field} value={form.stationCode} onChange={(e) => set({ stationCode: e.target.value })}>
            {board.stations.map((s) => { const c = stationCapacity(s); return <option key={s.code} value={s.code} disabled={c.full && s.code !== plan?.stationCode}>{s.label} ({c.label}{c.full ? " — penuh" : ""})</option>; })}
          </select>
        </label>
        <label className="text-[12.5px] text-ink3">Prioritas
          <select className={field} value={form.priority} onChange={(e) => set({ priority: e.target.value })}>{PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</select>
        </label>
        <label className="text-[12.5px] text-ink3">Workshop
          <select className={field} value={form.workCenterId} onChange={(e) => set({ workCenterId: e.target.value })}>
            <option value="">— pilih —</option>{refs.workCenters.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </label>
        <label className="text-[12.5px] text-ink3">PIC meja (bongkar & restorasi)
          <select className={field} value={form.operatorId} onChange={(e) => set({ operatorId: e.target.value })}>
            <option value="">— pilih —</option>{refs.operators.map((o) => <option key={o.id} value={o.id}>{o.user?.name || o.employeeCode}</option>)}
          </select>
        </label>
        <label className="text-[12.5px] text-ink3">PIC Corner (jahit) — opsional
          <select className={field} value={form.cornerOperatorId} onChange={(e) => set({ cornerOperatorId: e.target.value })}>
            <option value="">Sama dengan PIC meja</option>{refs.operators.map((o) => <option key={o.id} value={o.id}>{o.user?.name || o.employeeCode}</option>)}
          </select>
        </label>
        {refs.operators.length === 0 && <p className="sm:col-span-2 rounded-btn bg-orangebg px-3 py-2 text-[12.5px] text-orange">Belum ada operator aktif. Tambahkan di Tim & Area Kerja → Operators.</p>}
        {error && <p role="alert" className="sm:col-span-2 rounded-btn bg-redbg px-3 py-2 text-[12.5px] text-red">{error}</p>}
      </div>
    </Modal>
  );
}
