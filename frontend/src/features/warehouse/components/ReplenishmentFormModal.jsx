import React, { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { api } from "@/api.js";
import { Modal } from "@/components/ui/modal.jsx";
import { Button } from "@/components/ui/button.jsx";
import { REPLENISHMENT_SOURCE_REAL as SOURCE_MAP } from "../inventoryReal.js";

// Buat Replenishment Request — dari saran (materialId+suggestedQty sudah
// terisi) atau manual (materialId kosong, harus dipilih). suggestedQty
// TETAP bisa diedit ("Review quantity" — langkah eksplisit sebelum
// approval, sesuai spesifikasi).
export default function ReplenishmentFormModal({ open, prefill, onClose, onCreated }) {
  const [materials, setMaterials] = useState([]);
  const [source, setSource] = useState("MANUAL_REQUEST");
  const [materialId, setMaterialId] = useState("");
  const [suggestedQty, setSuggestedQty] = useState("");
  const [requiredDate, setRequiredDate] = useState("");
  const [priority, setPriority] = useState("NORMAL");
  const [supplier, setSupplier] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open) return;
    setErr("");
    if (prefill) {
      setSource("REORDER_POINT");
      setMaterialId(prefill.materialId);
      setSuggestedQty(prefill.reorderQty ?? "");
    } else {
      setSource("MANUAL_REQUEST");
      setMaterialId("");
      setSuggestedQty("");
    }
    setRequiredDate(""); setPriority("NORMAL"); setSupplier(""); setNotes("");
    api.getMaterials({ active: "true" }).then(setMaterials).catch(() => {});
  }, [open, prefill]);

  async function simpan(e) {
    e.preventDefault();
    if (!materialId) { setErr("Item wajib dipilih"); return; }
    if (!(Number(suggestedQty) > 0)) { setErr("Suggested quantity wajib lebih dari 0"); return; }
    setBusy(true); setErr("");
    try {
      await api.createReplenishmentRequest({
        source, materialId, suggestedQty, requiredDate: requiredDate || undefined,
        priority, supplier: supplier || undefined, notes: notes || undefined,
      });
      onCreated(); onClose();
    } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  }

  return (
    <Modal open={open} onOpenChange={(o) => (o ? null : onClose())} title="Replenishment Request">
      <form onSubmit={simpan} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-[11.5px] font-semibold text-ink2">Source *</label>
            <select value={source} onChange={(e) => setSource(e.target.value)}
              className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-accent">
              {Object.entries(SOURCE_MAP).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[11.5px] font-semibold text-ink2">Priority</label>
            <select value={priority} onChange={(e) => setPriority(e.target.value)}
              className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-accent">
              <option value="LOW">Low</option><option value="NORMAL">Normal</option>
              <option value="HIGH">High</option><option value="URGENT">Urgent</option>
            </select>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-[11.5px] font-semibold text-ink2">Item *</label>
          <select value={materialId} onChange={(e) => setMaterialId(e.target.value)} disabled={!!prefill}
            className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-accent disabled:bg-inset disabled:text-ink3">
            <option value="">Pilih item…</option>
            {materials.map((m) => <option key={m.id} value={m.id}>{m.code} — {m.name}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-[11.5px] font-semibold text-ink2">Suggested Quantity *</label>
            <input type="number" step="any" min="0" value={suggestedQty} onChange={(e) => setSuggestedQty(e.target.value)}
              className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-accent" />
          </div>
          <div>
            <label className="mb-1 block text-[11.5px] font-semibold text-ink2">Required Date</label>
            <input type="date" value={requiredDate} onChange={(e) => setRequiredDate(e.target.value)}
              className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-accent" />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-[11.5px] font-semibold text-ink2">Preferred Supplier</label>
          <input value={supplier} onChange={(e) => setSupplier(e.target.value)}
            className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-accent" />
        </div>

        <div>
          <label className="mb-1 block text-[11.5px] font-semibold text-ink2">Notes</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
            className="w-full rounded-btn border border-border bg-surface px-2.5 py-2 text-[12.5px] text-ink outline-none focus:border-accent" />
        </div>

        {err && <p className="text-[12px] text-red">{err}</p>}

        <div className="flex justify-end gap-2 border-t border-line pt-3">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>Batal</Button>
          <Button type="submit" size="sm" disabled={busy}>{busy && <Loader2 size={14} className="animate-spin" />} Create Request</Button>
        </div>
      </form>
    </Modal>
  );
}
