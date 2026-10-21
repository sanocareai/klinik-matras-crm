import React, { useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { api } from "@/api.js";
import { Button } from "@/components/ui/button.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { friendlyError } from "@/features/production/experience.js";
import { LANE, laneOptions, optionText } from "@/features/production/picLanes.js";
import { labelHari, teksAktivasiV2 } from "@/features/production/rencana/rencanaModel.js";

// AKTIVASI PELAKSANAAN MEJA (Produksi V2) — keputusan TERPISAH dari jadwal Admin. Konfirmasi menjelaskan bahwa Run dan alur Meja/QC akan dibuka; wajib dicentang. Jadwal Rencana Admin unit
// (bila ada) diambil alih rencana V2 pada tanggal/meja yang dipilih di sini. Pemegang izin Pengaturan Produksi saja; server menegakkan izin dan status cohort.
export default function AktivasiV2Modal({ item, awal, onClose, onDone }) {
  const [refs, setRefs] = useState(null); const [galat, setGalat] = useState(""); const [sibuk, setSibuk] = useState(false);
  const [paham, setPaham] = useState(false); const [tanggal, setTanggal] = useState(awal?.date || ""); const [meja, setMeja] = useState(awal?.station || "TABLE_1");
  const [workCenterId, setWorkCenterId] = useState(""); const [operatorId, setOperatorId] = useState(""); const kunci = useRef(null);
  useEffect(() => {
    let alive = true;
    api.getPlanningRefs().then((r) => { if (!alive) return; setRefs(r); setWorkCenterId(r.defaultWorkCenterId || r.workCenters?.[0]?.id || ""); }).catch((e) => { if (alive) setGalat(friendlyError(e)); });
    return () => { alive = false; };
  }, []);
  const bisa = paham && !!tanggal && !!meja && !!workCenterId && !sibuk;
  async function aktifkan() {
    if (!bisa) return; setSibuk(true); setGalat("");
    if (!kunci.current) kunci.current = `aktivasi-${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36)}`;
    try {
      const r = await api.planProductionV2Unit({ unitId: item.unitId, productionDate: tanggal, stationCode: meja, priority: item.prioritas?.key === "HIGH" ? 1 : 0, workCenterId, ...(operatorId ? { operatorId } : {}), activateUnit: true }, kunci.current);
      kunci.current = null; onDone({ item, hasil: r });
    } catch (e) { setGalat(friendlyError(e)); } finally { setSibuk(false); }
  }
  return (
    <Modal open onOpenChange={(v) => !v && !sibuk && onClose()} title={`Aktifkan Pelaksanaan Meja — ${item.unitCode}`} description="Keputusan terpisah dari jadwal Admin."
      footer={<div className="flex w-full justify-end gap-2"><Button variant="neutral" onClick={onClose} disabled={sibuk}>Batal</Button><Button variant="destructive" data-mutates onClick={aktifkan} disabled={!bisa} data-testid="aktivasi-lanjut">{sibuk ? "Mengaktifkan…" : "Aktifkan & buka Run"}</Button></div>}>
      <div className="space-y-3 px-6 pb-2" data-testid="aktivasi-modal">
        <p className="m-0 flex gap-1.5 rounded-btn bg-orangebg px-3 py-2 text-[12.5px] text-orange" data-testid="aktivasi-teks"><AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden /> {teksAktivasiV2({ diterima: item.diterima !== false })}</p>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-[12.5px] text-ink3">Tanggal<input type="date" value={tanggal} onChange={(e) => setTanggal(e.target.value)} className="mt-1 h-10 w-full rounded-btn border border-line bg-transparent px-3 text-[14px] text-ink" data-testid="aktivasi-tanggal" /></label>
          <label className="text-[12.5px] text-ink3">Meja<select value={meja} onChange={(e) => setMeja(e.target.value)} className="mt-1 h-10 w-full rounded-btn border border-line bg-transparent px-3 text-[14px] text-ink">{["TABLE_1", "TABLE_2", "TABLE_3", "TABLE_4"].map((c) => <option key={c} value={c}>Meja {c.replace("TABLE_", "")}</option>)}</select></label>
          <label className="text-[12.5px] text-ink3">Workshop<select value={workCenterId} onChange={(e) => setWorkCenterId(e.target.value)} className="mt-1 h-10 w-full rounded-btn border border-line bg-transparent px-3 text-[14px] text-ink"><option value="">— pilih —</option>{(refs?.workCenters || []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
          <label className="text-[12.5px] text-ink3">PIC meja<select value={operatorId} onChange={(e) => setOperatorId(e.target.value)} className="mt-1 h-10 w-full rounded-btn border border-line bg-transparent px-3 text-[14px] text-ink"><option value="">PIC bawaan meja</option>{laneOptions(refs?.operators || [], LANE.TABLE, null).map((o) => <option key={o.id} value={o.id}>{optionText(o, LANE.TABLE)}</option>)}</select></label>
        </div>
        {tanggal && <p className="m-0 text-[12px] text-ink3">Jadwal Meja: {labelHari(tanggal)} · Meja {meja.replace("TABLE_", "")}.</p>}
        <label className="flex items-start gap-2 text-[13px] text-ink"><input type="checkbox" checked={paham} onChange={(e) => setPaham(e.target.checked)} className="mt-0.5 h-4 w-4" data-testid="aktivasi-paham" /> Saya mengerti Run dan alur Meja/QC unit ini akan dibuka dan tidak bisa dibatalkan dari layar ini.</label>
        {galat && <p role="alert" className="m-0 rounded-btn bg-redbg px-3 py-2 text-[12.5px] text-red" data-testid="aktivasi-galat">{galat}</p>}
      </div>
    </Modal>
  );
}
