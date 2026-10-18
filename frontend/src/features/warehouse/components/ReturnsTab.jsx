import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Undo2, Plus, RefreshCw, Loader2 } from "lucide-react";
import { api } from "@/api.js";
import { Button } from "@/components/ui/button.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import DaftarSederhana from "@/features/warehouse/dokumen/DaftarSederhana.jsx";
import { RETURN_TYPE_REAL, UNIT_LABEL } from "../inventoryReal.js";
import { JENIS_RETUR, TAHAP_FILTER_RETUR, teksCari } from "@/features/warehouse/dokumen/labelDokumen.js";
import { tanggalPendek, teksJumlah } from "@/features/warehouse/dokumen/dokumenLogic.js";

// RETUR — daftar (Dicatat → Diterima → Diperiksa → Selesai). Hanya penyelesaian "Kembalikan ke tersedia" yang menambah stok. Detail dibuka sebagai halaman.
const satuan = (u) => UNIT_LABEL[u] || String(u || "").toLowerCase();


function FormModal({ open, onClose, onCreated }) {
  const [materials, setMaterials] = useState([]);
  const [returnType, setReturnType] = useState("CUSTOMER_RETURN");
  const [reference, setReference] = useState("");
  const [materialId, setMaterialId] = useState("");
  const [qty, setQty] = useState("");
  const [condition, setCondition] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open) return;
    setReturnType("CUSTOMER_RETURN"); setReference(""); setMaterialId(""); setQty("");
    setCondition(""); setNotes(""); setErr("");
    api.getMaterials({ active: "true" }).then(setMaterials).catch(() => {});
  }, [open]);

  async function simpan(e) {
    e.preventDefault();
    if (!materialId || !(Number(qty) > 0)) { setErr("Item dan quantity wajib diisi"); return; }
    setBusy(true); setErr("");
    try {
      const baru = await api.createReturnRecord({
        returnType, reference: reference || undefined, materialId, qty,
        condition: condition || undefined, notes: notes || undefined,
      });
      onCreated(baru); onClose();
    } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  }

  return (
    <Modal open={open} onOpenChange={(o) => (o ? null : onClose())} title="Catat Retur">
      <form onSubmit={simpan} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-[11.5px] font-semibold text-ink2">Jenis retur *</label>
            <select value={returnType} onChange={(e) => setReturnType(e.target.value)}
              className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-accent">
              {Object.entries(RETURN_TYPE_REAL).map(([k, t]) => <option key={k} value={k}>{JENIS_RETUR[k] ?? t.label}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[11.5px] font-semibold text-ink2">Referensi</label>
            <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="No. order/job"
              className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none placeholder:text-ink3 focus:border-accent" />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-[11.5px] font-semibold text-ink2">Bahan *</label>
          <select value={materialId} onChange={(e) => setMaterialId(e.target.value)}
            className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-accent">
            <option value="">Pilih item…</option>
            {materials.map((m) => <option key={m.id} value={m.id}>{m.code} — {m.name}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-[11.5px] font-semibold text-ink2">Jumlah *</label>
            <input type="number" step="any" min="0" value={qty} onChange={(e) => setQty(e.target.value)}
              className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-accent" />
          </div>
          <div>
            <label className="mb-1 block text-[11.5px] font-semibold text-ink2">Kondisi</label>
            <input value={condition} onChange={(e) => setCondition(e.target.value)} placeholder="mis. baik, sedikit kotor"
              className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none placeholder:text-ink3 focus:border-accent" />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-[11.5px] font-semibold text-ink2">Catatan</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
            className="w-full rounded-btn border border-border bg-surface px-2.5 py-2 text-[12.5px] text-ink outline-none focus:border-accent" />
        </div>
        {err && <p className="text-[12px] text-red">{err}</p>}
        <div className="flex justify-end gap-2 border-t border-line pt-3">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>Batal</Button>
          <Button type="submit" size="sm" disabled={busy}>{busy && <Loader2 size={14} className="animate-spin" />} Buat</Button>
        </div>
      </form>
    </Modal>
  );
}

export default function ReturnsTab() {
  const navigate = useNavigate();
  const [tahap, setTahap] = useState(""); const [cari, setCari] = useState("");
  const [rows, setRows] = useState(null); const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [formOpen, setFormOpen] = useState(false);
  const load = useCallback(() => {
    setLoading(true); setError("");
    api.getReturns({}).then((d) => setRows(d.records)).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);
  const baru = <Button size="sm" onClick={() => setFormOpen(true)}><Plus size={14} /> Catat Retur</Button>;
  return (
    <>
      <DaftarSederhana filters={TAHAP_FILTER_RETUR} rows={rows} loading={loading} error={error} tahap={tahap} onTahap={setTahap} cari={cari} onCari={setCari}
        placeholder="Cari no., bahan, referensi" labelCari="Cari retur" labelTab="Saring tahap retur" teks={teksCari.retur} nomor={(r) => r.returnNumber} onBuka={(r) => navigate(`/warehouse/adjustments/returns/${r.id}`)}
        aksiKepala={<div className="flex items-center justify-end gap-2"><Button variant="ghost" size="sm" onClick={load} disabled={loading}><RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Muat ulang</Button>{baru}</div>}
        kolom={[
          { label: "Retur", kelas: "whitespace-nowrap", isi: (r) => <><div className="font-semibold text-ink">{r.returnNumber}</div><div className="text-[11px] text-ink3">{r.createdBy?.name ?? "—"} · {tanggalPendek(r.createdAt)}</div></> },
          { label: "Jenis", kelas: "text-ink2", isi: (r) => <>{JENIS_RETUR[r.returnType] ?? r.returnType}{r.reference ? <div className="text-[11px] text-ink3">{r.reference}</div> : null}</> },
          { label: "Bahan", isi: (r) => <><div className="font-medium text-ink">{r.material.code}</div><div className="text-[11px] text-ink3">{r.material.name}</div></> },
          { label: "Jumlah", numeric: true, isi: (r) => `${teksJumlah(r.qty)} ${satuan(r.material.unit)}` },
        ]}
        kartu={(r) => ({ judul: r.returnNumber, baris: [<>{JENIS_RETUR[r.returnType] ?? r.returnType} · <span className="font-medium text-ink">{r.material.code}</span> · {teksJumlah(r.qty)} {satuan(r.material.unit)}</>, `${r.createdBy?.name ?? "—"} · ${tanggalPendek(r.createdAt)}${r.reference ? ` · ${r.reference}` : ""}`] })}
        kosong={{ icon: Undo2, judul: "Belum ada retur", deskripsi: "Catat barang retur untuk mulai melacak penyelesaiannya.", aksi: baru }} />
      <FormModal open={formOpen} onClose={() => setFormOpen(false)} onCreated={(d) => { load(); if (d?.id) navigate(`/warehouse/adjustments/returns/${d.id}`); }} />
    </>
  );
}
