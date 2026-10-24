import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Scale, Plus, RefreshCw, Loader2 } from "lucide-react";
import { api } from "@/api.js";
import { Button } from "@/components/ui/button.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import DaftarSederhana from "@/features/warehouse/dokumen/DaftarSederhana.jsx";
import { ADJUSTMENT_TYPE_REAL, UNIT_LABEL } from "../inventoryReal.js";
import { JENIS_PENYESUAIAN, TAHAP_FILTER_ADJ, teksCari } from "@/features/warehouse/dokumen/labelDokumen.js";
import { tanggalPendek, teksJumlah } from "@/features/warehouse/dokumen/dokumenLogic.js";

// PENYESUAIAN STOK — daftar (Draf → Menunggu persetujuan → Disetujui → Diposting). Persetujuan wajib orang lain berperan penyetuju (aturan pemisahan tugas yang berlaku). Detail dibuka sebagai halaman.
const satuan = (u) => UNIT_LABEL[u] || String(u || "").toLowerCase();
const tanda = (n) => `${n > 0 ? "+" : ""}${teksJumlah(n)}`;


function FormModal({ open, onClose, onCreated }) {
  const [materials, setMaterials] = useState([]);
  const [materialId, setMaterialId] = useState("");
  const [adjustmentType, setAdjustmentType] = useState("DATA_CORRECTION");
  const [adjustmentQty, setAdjustmentQty] = useState("");
  const [mode, setMode] = useState("delta"); const [saldoBaru, setSaldoBaru] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open) return;
    setMaterialId(""); setAdjustmentType("DATA_CORRECTION"); setAdjustmentQty(""); setMode("delta"); setSaldoBaru("");
    setReason(""); setNotes(""); setErr("");
    api.getMaterials({ active: "true" }).then(setMaterials).catch(() => {});
  }, [open]);

  async function simpan(e) {
    e.preventDefault();
    if (!materialId) { setErr("Item wajib dipilih"); return; }
    if (mode === "delta" && !Number(adjustmentQty)) { setErr("Adjustment quantity wajib diisi dan tidak boleh nol"); return; }
    if (mode === "saldo" && (saldoBaru === "" || !Number.isFinite(Number(saldoBaru)) || Number(saldoBaru) < 0)) { setErr("Saldo yang benar wajib diisi (angka, tidak boleh minus)"); return; }
    if (!reason.trim()) { setErr("Alasan wajib diisi"); return; }
    setBusy(true); setErr("");
    try {
      const baru = await api.createAdjustmentRequest({ materialId, adjustmentType, ...(mode === "saldo" ? { saldoBaru: Number(saldoBaru) } : { adjustmentQty }), reason, notes: notes || undefined });
      onCreated(baru); onClose();
    } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  }

  return (
    <Modal open={open} onOpenChange={(o) => (o ? null : onClose())} title="Ajukan Penyesuaian Stok">
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
            <label className="mb-1 block text-[11.5px] font-semibold text-ink2">Jenis penyesuaian *</label>
            <select value={adjustmentType} onChange={(e) => setAdjustmentType(e.target.value)}
              className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-accent">
              {Object.entries(ADJUSTMENT_TYPE_REAL).map(([k, t]) => <option key={k} value={k}>{JENIS_PENYESUAIAN[k] ?? t.label}</option>)}
            </select>
          </div>
          <div>
            <div className="mb-1 flex gap-3 text-[11.5px] font-semibold text-ink2" role="radiogroup" aria-label="Cara mengisi koreksi">
              <label className="flex items-center gap-1"><input type="radio" name="mode-koreksi" checked={mode === "delta"} onChange={() => setMode("delta")} data-testid="mode-delta" /> Perubahan (+/−)</label>
              <label className="flex items-center gap-1"><input type="radio" name="mode-koreksi" checked={mode === "saldo"} onChange={() => setMode("saldo")} data-testid="mode-saldo" /> Saldo yang benar</label>
            </div>
            {mode === "saldo" ? (
              <>
                <input type="number" step="any" value={saldoBaru} onChange={(e) => setSaldoBaru(e.target.value)} placeholder="saldo yang seharusnya" data-testid="adj-saldo-baru"
                  className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none placeholder:text-ink3 focus:border-accent" />
                <p className="m-0 mt-1 text-[11px] text-ink3">Selisih dihitung dari saldo saat ini. Saldo tidak ditimpa — tetap menunggu persetujuan orang lain, lalu tercatat sebagai penyesuaian.</p>
              </>
            ) : (
            <input type="number" step="any" value={adjustmentQty} onChange={(e) => setAdjustmentQty(e.target.value)}
              placeholder="mis. -3 atau 5"
              className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none placeholder:text-ink3 focus:border-accent" />
            )}
          </div>
        </div>
        <div>
          <label className="mb-1 block text-[11.5px] font-semibold text-ink2">Alasan *</label>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
            placeholder="Wajib diisi — tidak ada adjustment tanpa alasan"
            className="w-full rounded-btn border border-border bg-surface px-2.5 py-2 text-[12.5px] text-ink outline-none placeholder:text-ink3 focus:border-accent" />
        </div>
        <div>
          <label className="mb-1 block text-[11.5px] font-semibold text-ink2">Catatan</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
            className="w-full rounded-btn border border-border bg-surface px-2.5 py-2 text-[12.5px] text-ink outline-none focus:border-accent" />
        </div>
        {err && <p className="text-[12px] text-red">{err}</p>}
        <div className="flex justify-end gap-2 border-t border-line pt-3">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>Batal</Button>
          <Button type="submit" size="sm" disabled={busy}>{busy && <Loader2 size={14} className="animate-spin" />} Ajukan</Button>
        </div>
      </form>
    </Modal>
  );
}

export default function AdjustmentsTab() {
  const navigate = useNavigate();
  const [tahap, setTahap] = useState(""); const [cari, setCari] = useState("");
  const [rows, setRows] = useState(null); const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [formOpen, setFormOpen] = useState(false);
  const load = useCallback(() => {
    setLoading(true); setError("");
    api.getAdjustmentRequests({}).then((d) => setRows(d.requests)).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { window.addEventListener("gudang-dokumen-berubah", load); return () => window.removeEventListener("gudang-dokumen-berubah", load); }, [load]); // jendela fokus dokumen memberi kabar setelah aksi
  const baru = <Button size="sm" onClick={() => setFormOpen(true)}><Plus size={14} /> Ajukan Penyesuaian</Button>;
  return (
    <>
      <DaftarSederhana filters={TAHAP_FILTER_ADJ} rows={rows} loading={loading} error={error} tahap={tahap} onTahap={setTahap} cari={cari} onCari={setCari}
        placeholder="Cari no., bahan, alasan" labelCari="Cari penyesuaian stok" labelTab="Saring tahap penyesuaian" teks={teksCari.adj} nomor={(r) => r.adjustmentNumber} onBuka={(r) => navigate(`/warehouse/adjustments/stock/${r.id}`)}
        aksiKepala={<div className="flex items-center justify-end gap-2"><Button variant="ghost" size="sm" onClick={load} disabled={loading}><RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Muat ulang</Button>{baru}</div>}
        kolom={[
          { label: "Penyesuaian", kelas: "whitespace-nowrap", isi: (r) => <><div className="font-semibold text-ink">{r.adjustmentNumber}</div><div className="text-[11px] text-ink3">{r.requestedBy?.name ?? "—"} · {tanggalPendek(r.createdAt)}</div></> },
          { label: "Jenis", kelas: "text-ink2", isi: (r) => JENIS_PENYESUAIAN[r.adjustmentType] ?? r.adjustmentType },
          { label: "Bahan", isi: (r) => <><div className="font-medium text-ink">{r.material.code}</div><div className="text-[11px] text-ink3">{r.material.name}</div></> },
          { label: "Perubahan", numeric: true, isi: (r) => <span className={Number(r.adjustmentQty) > 0 ? "font-semibold text-green" : "font-semibold text-red"}>{tanda(Number(r.adjustmentQty))} {satuan(r.material.unit)}</span> },
          { label: "Alasan", kelas: "max-w-[220px] truncate text-ink2", isi: (r) => r.reason },
        ]}
        kartu={(r) => ({ judul: r.adjustmentNumber, baris: [<>{JENIS_PENYESUAIAN[r.adjustmentType] ?? r.adjustmentType} · <span className="font-medium text-ink">{r.material.code}</span> · {tanda(Number(r.adjustmentQty))} {satuan(r.material.unit)}</>, `${r.requestedBy?.name ?? "—"} · ${tanggalPendek(r.createdAt)}`, r.reason] })}
        kosong={{ icon: Scale, judul: "Belum ada penyesuaian stok", deskripsi: "Ajukan penyesuaian bila stok sistem perlu dikoreksi.", aksi: baru }} />
      <FormModal open={formOpen} onClose={() => setFormOpen(false)} onCreated={(d) => { load(); if (d?.id) navigate(`/warehouse/adjustments/stock/${d.id}`); }} />
    </>
  );
}
