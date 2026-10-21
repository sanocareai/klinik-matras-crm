import React, { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { api } from "@/api.js";
import { Button } from "@/components/ui/button.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { SUMBER, labelHari, labelTanggal, mondayOf, pesanGagalJadwal, shiftKey, sisaMeja, slotBawaan, validKey } from "@/features/production/rencana/rencanaModel.js";

// Jadwalkan / pindahkan unit (Rencana Admin). Default cerdas: hari dan meja pertama yang masih punya tempat → biasanya cukup SATU klik "Simpan jadwal".
// Dampak ditulis jelas: HANYA jadwal — tidak membuka Run/tahap/QC/penerimaan/pemakaian bahan. Aktivasi Pelaksanaan Meja adalah keputusan terpisah (menu kartu).
const KODE_MEJA = ["TABLE_1", "TABLE_2", "TABLE_3", "TABLE_4"];
const mejaTeks = (c) => `Meja ${c.replace("TABLE_", "")}`;

export default function JadwalModal({ item, minggu, awal = null, onClose, onSaved, onError }) {
  const jadwalAda = item.jadwal?.sumber === "ADMIN" ? item.jadwal : null;
  const bawaan = useMemo(() => (jadwalAda ? { date: jadwalAda.tanggal, station: jadwalAda.meja || "" } : awal?.date ? { date: awal.date, station: awal.station ?? "" } : slotBawaan(minggu)), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [tanggal, setTanggal] = useState(bawaan.date); const [meja, setMeja] = useState(bawaan.station);
  const [target, setTarget] = useState(item.targetSelesai || ""); const [prioritas, setPrioritas] = useState(item.prioritas?.key === "HIGH" ? "HIGH" : "NORMAL");
  const [catatan, setCatatan] = useState(""); const [sibuk, setSibuk] = useState(false); const [galat, setGalat] = useState("");
  const [kap, setKap] = useState(() => (minggu ? { [minggu.start]: minggu } : {})); const [riwayat, setRiwayat] = useState(null);
  const kunci = useRef(null); const today = minggu?.today;
  const revisi = jadwalAda ? jadwalAda.revisi : (item.revisiJadwal ?? 0);

  useEffect(() => {
    if (!validKey(tanggal)) return;
    const s = mondayOf(tanggal); if (kap[s]) return;
    let alive = true; api.getRencanaMinggu(s).then((r) => { if (alive) setKap((k) => ({ ...k, [s]: r })); }).catch(() => {});
    return () => { alive = false; };
  }, [tanggal]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!jadwalAda) return undefined; let alive = true; api.getJadwalUnit(item.unitId).then((r) => { if (alive) setRiwayat(r); }).catch(() => {}); return () => { alive = false; }; }, [item.unitId]); // eslint-disable-line react-hooks/exhaustive-deps

  const mingguTgl = kap[mondayOf(validKey(tanggal) ? tanggal : today)] || null;
  const sisa = (c) => { const v = sisaMeja(mingguTgl, tanggal, c); if (v == null) return null; return jadwalAda && jadwalAda.tanggal === tanggal && jadwalAda.meja === c ? v + 1 : v; };
  const tanggalLewat = validKey(tanggal) && today && tanggal < today;
  const targetSalah = target && validKey(target) && validKey(tanggal) && target < tanggal;
  const mejaPenuh = meja && sisa(meja) === 0;
  const bisa = validKey(tanggal) && !tanggalLewat && !targetSalah && !mejaPenuh && !sibuk;

  async function simpan() {
    if (!bisa) return; setSibuk(true); setGalat("");
    if (!kunci.current) kunci.current = `jadwal-${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2, 10)}`;
    try {
      const body = { productionDate: tanggal, stationCode: meja || null, expectedRevision: revisi, priority: prioritas, note: catatan.trim() || undefined, expectedUnit: item.unitCas || undefined };
      if (target !== (item.targetSelesai || "")) body.targetDate = target || null;
      const r = await api.jadwalkanUnit(item.unitId, body, kunci.current);
      kunci.current = null; onSaved({ item, hasil: r, tanggal, meja: meja || null });
    } catch (e) { setGalat(pesanGagalJadwal(e)); if (["JADWAL_REVISI_BASI", "JADWAL_UNIT_BERUBAH"].includes(e?.code)) { kunci.current = null; onError?.(e); } }
    finally { setSibuk(false); }
  }
  async function keluarkan() {
    setSibuk(true); setGalat("");
    try { const r = await api.keluarkanJadwalUnit(item.unitId, { expectedRevision: revisi }); onSaved({ item, hasil: r, dikeluarkan: true }); } catch (e) { setGalat(pesanGagalJadwal(e)); } finally { setSibuk(false); }
  }
  async function urungkan(ev) {
    setSibuk(true); setGalat("");
    try { const r = await api.undoJadwalUnit(item.unitId, { eventId: ev.id }); onSaved({ item, hasil: r, diurungkan: true }); } catch (e) { setGalat(pesanGagalJadwal(e)); } finally { setSibuk(false); }
  }
  const pilihCepat = [["Hari ini", 0], ["Besok", 1], ["Lusa", 2]];
  return (
    <Modal open onOpenChange={(v) => !v && !sibuk && onClose()} title={`${jadwalAda ? "Pindahkan jadwal" : "Jadwalkan"} — ${item.unitCode}`} description={`${item.customerName || "Pelanggan"} · ${(item.pekerjaan || []).join(" · ") || "layanan belum tercatat"}`}
      footer={<div className="flex w-full flex-wrap items-center justify-between gap-2">
        {jadwalAda ? <Button variant="neutral" data-mutates onClick={keluarkan} disabled={sibuk} data-testid="jadwal-keluarkan">Keluarkan dari jadwal</Button> : <span />}
        <div className="flex gap-2"><Button variant="neutral" onClick={onClose} disabled={sibuk}>Batal</Button><Button data-mutates onClick={simpan} disabled={!bisa} data-testid="jadwal-simpan">{sibuk ? "Menyimpan…" : jadwalAda ? "Simpan perubahan" : "Simpan jadwal"}</Button></div>
      </div>}>
      <div className="space-y-3 px-6 pb-2" data-testid="jadwal-modal">
        <p className="m-0 rounded-btn bg-accentbg px-3 py-2 text-[12.5px] text-accent" data-testid="jadwal-dampak"><b>{SUMBER.ADMIN.label}.</b> {SUMBER.ADMIN.dampak}</p>
        {item.diterima === false && <p className="m-0 flex gap-1.5 rounded-btn bg-orangebg px-3 py-2 text-[12.5px] text-orange" data-testid="jadwal-belum-tiba"><AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden /> Unit belum tercatat diterima di workshop. Jadwal ini hanya rencana; kerja menunggu unit tiba.</p>}
        <div>
          <label className="text-[12.5px] text-ink3" htmlFor="jadwal-tanggal">Tanggal</label>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <input id="jadwal-tanggal" type="date" min={today} value={tanggal} onChange={(e) => setTanggal(e.target.value)} data-testid="jadwal-tanggal" className="h-10 rounded-btn border border-line bg-transparent px-3 text-[14px] text-ink" />
            {pilihCepat.map(([t, n]) => today && <button key={t} type="button" className="min-h-[36px] rounded-chip bg-inset px-3 text-[12.5px] text-ink2 hover:bg-hovertint" onClick={() => setTanggal(shiftKey(today, n))}>{t}</button>)}
            {validKey(tanggal) && <span className="text-[12.5px] text-ink3">{labelHari(tanggal)}</span>}
          </div>
          {tanggalLewat && <p role="alert" className="m-0 mt-1 text-[12px] text-red">Tanggal sudah lewat — pilih hari ini atau setelahnya.</p>}
        </div>
        <div>
          <label className="text-[12.5px] text-ink3" htmlFor="jadwal-meja">Meja</label>
          <select id="jadwal-meja" value={meja} onChange={(e) => setMeja(e.target.value)} data-testid="jadwal-meja" className="mt-1 h-10 w-full rounded-btn border border-line bg-transparent px-3 text-[14px] text-ink">
            <option value="">Tanpa meja (hanya tanggal)</option>
            {KODE_MEJA.map((c) => { const s = sisa(c); return <option key={c} value={c} disabled={s === 0}>{mejaTeks(c)}{s == null ? "" : s === 0 ? " — penuh" : ` — sisa ${s} tempat`}</option>; })}
          </select>
          {mejaPenuh && <p role="alert" className="m-0 mt-1 text-[12px] text-red">Meja ini penuh pada {labelTanggal(tanggal)}.</p>}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-[12.5px] text-ink3">Target selesai
            <input type="date" min={tanggal || today} value={target} onChange={(e) => setTarget(e.target.value)} data-testid="jadwal-target" className="mt-1 h-10 w-full rounded-btn border border-line bg-transparent px-3 text-[14px] text-ink" /></label>
          <label className="text-[12.5px] text-ink3">Prioritas
            <select value={prioritas} onChange={(e) => setPrioritas(e.target.value)} data-testid="jadwal-prioritas" className="mt-1 h-10 w-full rounded-btn border border-line bg-transparent px-3 text-[14px] text-ink"><option value="NORMAL">Normal</option><option value="HIGH">Tinggi</option></select></label>
        </div>
        {targetSalah && <p role="alert" className="m-0 text-[12px] text-red">Target selesai tidak boleh lebih awal dari tanggal jadwal.</p>}
        <label className="block text-[12.5px] text-ink3">Catatan (opsional)
          <input type="text" maxLength={500} value={catatan} onChange={(e) => setCatatan(e.target.value)} className="mt-1 h-10 w-full rounded-btn border border-line bg-transparent px-3 text-[14px] text-ink" placeholder="Mis. menunggu bahan dari Gudang" /></label>
        <p className="m-0 text-[12px] text-ink3">PIC meja mengikuti PIC bawaan meja pada tanggal itu (diatur di Papan Meja). Target dan prioritas memakai data unit yang sama dengan Order Produksi.</p>
        {galat && <p role="alert" className="m-0 rounded-btn bg-redbg px-3 py-2 text-[12.5px] text-red" data-testid="jadwal-galat">{galat}</p>}
        {riwayat?.events?.length > 0 && (
          <details className="rounded-btn border border-line px-3 py-2" data-testid="jadwal-riwayat"><summary className="cursor-pointer text-[12.5px] font-medium text-ink2">Riwayat jadwal ({riwayat.events.length})</summary>
            <ul className="m-0 mt-2 list-none space-y-1.5 p-0 text-[12px] text-ink2">
              {[...riwayat.events].reverse().map((e) => (
                <li key={e.id} className="flex items-start justify-between gap-2"><span>{e.kind === "SCHEDULED" ? "Dijadwalkan" : e.kind === "RESCHEDULED" ? "Dipindah" : e.kind === "UNSCHEDULED" ? "Dikeluarkan" : e.kind === "TARGET_CHANGED" ? "Target/prioritas diubah" : e.kind === "UNDONE" ? "Diurungkan" : "Diambil alih pelaksanaan Meja"}
                  {e.ke ? ` → ${labelHari(e.ke.tanggal)}${e.ke.meja ? ` · ${mejaTeks(e.ke.meja)}` : ""}` : ""} <span className="text-ink3">· {e.actor || "—"} · {new Date(e.at).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}{e.note ? ` · ${e.note}` : ""}</span></span>
                  {e.undoable && <Button size="sm" variant="neutral" data-mutates className="min-h-[32px]" onClick={() => urungkan(e)} disabled={sibuk} data-testid="jadwal-urungkan">Urungkan</Button>}</li>
              ))}
            </ul></details>
        )}
      </div>
    </Modal>
  );
}
