import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertOctagon, Plus, RefreshCw, Loader2 } from "lucide-react";
import { api } from "@/api.js";
import { Button } from "@/components/ui/button.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import DaftarSederhana from "@/features/warehouse/dokumen/DaftarSederhana.jsx";
import { DAMAGE_CATEGORY_REAL } from "../inventoryReal.js";
import { UNIT_LABEL } from "../inventoryReal.js";
import { KATEGORI_RUSAK, TAHAP_FILTER_RUSAK, teksCari } from "@/features/warehouse/dokumen/labelDokumen.js";
import { tanggalPendek, teksJumlah } from "@/features/warehouse/dokumen/dokumenLogic.js";

// BARANG RUSAK — daftar laporan (Dilaporkan → Diperiksa → Selesai ditangani). Hanya penyelesaian "Dibuang" / "Retur ke supplier" yang mengurangi stok. Detail dibuka sebagai halaman.
const satuan = (u) => UNIT_LABEL[u] || String(u || "").toLowerCase();


function FormModal({ open, onClose, onCreated }) {
  const [materials, setMaterials] = useState([]);
  const [materialId, setMaterialId] = useState("");
  const [qty, setQty] = useState("");
  const [damageCategory, setDamageCategory] = useState("OTHER");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open) return;
    setMaterialId(""); setQty(""); setDamageCategory("OTHER"); setNotes(""); setErr("");
    api.getMaterials({ active: "true" }).then(setMaterials).catch(() => {});
  }, [open]);

  async function simpan(e) {
    e.preventDefault();
    if (!materialId || !(Number(qty) > 0)) { setErr("Item dan quantity wajib diisi"); return; }
    setBusy(true);
    setErr("");
    try {
      const baru = await api.createDamagedStockRecord({ materialId, qty, damageCategory, notes: notes || undefined });
      onCreated(baru);
      onClose();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onOpenChange={(o) => (o ? null : onClose())} title="Laporkan Barang Rusak">
      <form onSubmit={simpan} className="space-y-3">
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
            <label className="mb-1 block text-[11.5px] font-semibold text-ink2">Jumlah rusak *</label>
            <input type="number" step="any" min="0" value={qty} onChange={(e) => setQty(e.target.value)}
              className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-accent" />
          </div>
          <div>
            <label className="mb-1 block text-[11.5px] font-semibold text-ink2">Kategori kerusakan *</label>
            <select value={damageCategory} onChange={(e) => setDamageCategory(e.target.value)}
              className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-accent">
              {Object.entries(DAMAGE_CATEGORY_REAL).map(([k, c]) => <option key={k} value={k}>{KATEGORI_RUSAK[k] ?? c.label}</option>)}
            </select>
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
          <Button type="submit" size="sm" disabled={busy}>{busy && <Loader2 size={14} className="animate-spin" />} Laporkan</Button>
        </div>
      </form>
    </Modal>
  );
}

export default function DamagedStockTab() {
  const navigate = useNavigate();
  const [tahap, setTahap] = useState(""); const [cari, setCari] = useState("");
  const [rows, setRows] = useState(null); const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [formOpen, setFormOpen] = useState(false);
  const load = useCallback(() => {
    setLoading(true); setError("");
    api.getDamagedStock({}).then((d) => setRows(d.records)).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { window.addEventListener("gudang-dokumen-berubah", load); return () => window.removeEventListener("gudang-dokumen-berubah", load); }, [load]); // jendela fokus dokumen memberi kabar setelah aksi
  const baru = <Button size="sm" onClick={() => setFormOpen(true)}><Plus size={14} /> Laporkan Barang Rusak</Button>;
  return (
    <>
      <DaftarSederhana filters={TAHAP_FILTER_RUSAK} rows={rows} loading={loading} error={error} tahap={tahap} onTahap={setTahap} cari={cari} onCari={setCari}
        placeholder="Cari no., bahan, pelapor" labelCari="Cari laporan barang rusak" labelTab="Saring tahap barang rusak" teks={teksCari.rusak} nomor={(r) => r.recordNumber} onBuka={(r) => navigate(`/warehouse/adjustments/damaged/${r.id}`)}
        aksiKepala={<div className="flex items-center justify-end gap-2"><Button variant="ghost" size="sm" onClick={load} disabled={loading}><RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Muat ulang</Button>{baru}</div>}
        kolom={[
          { label: "Laporan", kelas: "whitespace-nowrap", isi: (r) => <><div className="font-semibold text-ink">{r.recordNumber}</div><div className="text-[11px] text-ink3">{r.reportedBy?.name ?? "—"} · {tanggalPendek(r.reportedAt)}</div></> },
          { label: "Bahan", isi: (r) => <><div className="font-medium text-ink">{r.material.code}</div><div className="text-[11px] text-ink3">{r.material.name}</div></> },
          { label: "Jumlah rusak", numeric: true, isi: (r) => `${teksJumlah(r.qty)} ${satuan(r.material.unit)}` },
          { label: "Kategori", kelas: "text-ink2", isi: (r) => KATEGORI_RUSAK[r.damageCategory] ?? r.damageCategory },
        ]}
        kartu={(r) => ({ judul: r.recordNumber, baris: [<><span className="font-medium text-ink">{r.material.code}</span> · {teksJumlah(r.qty)} {satuan(r.material.unit)} · {KATEGORI_RUSAK[r.damageCategory] ?? r.damageCategory}</>, `${r.reportedBy?.name ?? "—"} · ${tanggalPendek(r.reportedAt)}`] })}
        kosong={{ icon: AlertOctagon, judul: "Belum ada laporan barang rusak", deskripsi: "Laporkan barang rusak untuk mulai melacak penanganannya.", aksi: baru }} />
      <FormModal open={formOpen} onClose={() => setFormOpen(false)} onCreated={(d) => { load(); if (d?.id) navigate(`/warehouse/adjustments/damaged/${d.id}`); }} />
    </>
  );
}
