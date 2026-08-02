import React, { useEffect, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { api } from "@/api.js";
import { Modal } from "@/components/ui/modal.jsx";
import { Button } from "@/components/ui/button.jsx";
import { TRANSFER_TYPE_REAL } from "../inventoryReal.js";

// Ajukan Stock Transfer baru — status awal selalu DRAFT
// (POST /inventory/transfers). Lokasi asal & tujuan WAJIB berbeda, backend
// menolaknya kalau sama.
const BARIS_KOSONG = { materialId: "", qtySent: "" };

export default function StockTransferFormModal({ open, onClose, onCreated }) {
  const [materials, setMaterials] = useState([]);
  const [locations, setLocations] = useState([]);
  const [transferType, setTransferType] = useState("BIN_TO_BIN");
  const [sourceLocationId, setSourceLocationId] = useState("");
  const [destinationLocationId, setDestinationLocationId] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState([{ ...BARIS_KOSONG }]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open) return;
    setTransferType("BIN_TO_BIN"); setSourceLocationId(""); setDestinationLocationId("");
    setNotes(""); setLines([{ ...BARIS_KOSONG }]); setErr("");
    api.getMaterials({ active: "true" }).then(setMaterials).catch(() => {});
    api.getStorageLocations().then((d) => setLocations(d.locations)).catch(() => {});
  }, [open]);

  function setLine(i, patch) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }
  function tambahBaris() {
    setLines((ls) => [...ls, { ...BARIS_KOSONG }]);
  }
  function hapusBaris(i) {
    setLines((ls) => (ls.length > 1 ? ls.filter((_, idx) => idx !== i) : ls));
  }

  async function simpan(e) {
    e.preventDefault();
    if (!sourceLocationId || !destinationLocationId) { setErr("Lokasi asal dan tujuan wajib dipilih"); return; }
    if (sourceLocationId === destinationLocationId) { setErr("Lokasi asal dan tujuan tidak boleh sama"); return; }
    const valid = lines.filter((l) => l.materialId && Number(l.qtySent) > 0);
    if (valid.length === 0) { setErr("Minimal satu item dengan Qty Sent > 0 wajib diisi"); return; }
    setBusy(true);
    setErr("");
    try {
      await api.createStockTransfer({
        transferType, sourceLocationId, destinationLocationId, notes: notes || undefined,
        lines: valid.map((l) => ({ materialId: l.materialId, qtySent: l.qtySent })),
      });
      onCreated();
      onClose();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onOpenChange={(o) => (o ? null : onClose())} title="Stock Transfer Baru" className="w-[560px]">
      <form onSubmit={simpan} className="space-y-3">
        <div>
          <label htmlFor="tr-type" className="mb-1 block text-[11.5px] font-semibold text-ink2">Transfer Type *</label>
          <select
            id="tr-type" value={transferType} onChange={(e) => setTransferType(e.target.value)}
            className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-accent"
          >
            {Object.entries(TRANSFER_TYPE_REAL).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="tr-source" className="mb-1 block text-[11.5px] font-semibold text-ink2">Source Location *</label>
            <select
              id="tr-source" value={sourceLocationId} onChange={(e) => setSourceLocationId(e.target.value)}
              className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-accent"
            >
              <option value="">Pilih lokasi…</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.warehouse.code} / {l.code}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="tr-dest" className="mb-1 block text-[11.5px] font-semibold text-ink2">Destination Location *</label>
            <select
              id="tr-dest" value={destinationLocationId} onChange={(e) => setDestinationLocationId(e.target.value)}
              className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-accent"
            >
              <option value="">Pilih lokasi…</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.warehouse.code} / {l.code}</option>)}
            </select>
          </div>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="text-[11.5px] font-semibold text-ink2">Item Lines *</label>
            <button type="button" onClick={tambahBaris} className="flex items-center gap-1 text-[11.5px] font-semibold text-accent">
              <Plus size={12} /> Tambah Baris
            </button>
          </div>
          <div className="space-y-2">
            {lines.map((l, i) => (
              <div key={i} className="flex items-center gap-2">
                <select
                  value={l.materialId} onChange={(e) => setLine(i, { materialId: e.target.value })}
                  className="min-w-0 flex-1 rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12px] text-ink outline-none focus:border-accent"
                >
                  <option value="">Pilih item…</option>
                  {materials.map((m) => <option key={m.id} value={m.id}>{m.code} — {m.name}</option>)}
                </select>
                <input
                  type="number" step="any" min="0" value={l.qtySent}
                  onChange={(e) => setLine(i, { qtySent: e.target.value })}
                  placeholder="Qty *"
                  className="w-20 shrink-0 rounded-btn border border-border bg-surface px-2 py-1.5 text-[12px] text-ink outline-none placeholder:text-ink3 focus:border-accent"
                />
                <button
                  type="button" onClick={() => hapusBaris(i)} disabled={lines.length === 1}
                  className="shrink-0 rounded-btn p-1.5 text-ink3 hover:bg-redbg hover:text-red disabled:opacity-30"
                  aria-label="Hapus baris"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div>
          <label htmlFor="tr-notes" className="mb-1 block text-[11.5px] font-semibold text-ink2">Notes</label>
          <textarea
            id="tr-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
            className="w-full rounded-btn border border-border bg-surface px-2.5 py-2 text-[12.5px] text-ink outline-none focus:border-accent"
          />
        </div>

        {err && <p className="text-[12px] text-red">{err}</p>}

        <div className="flex justify-end gap-2 border-t border-line pt-3">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>Batal</Button>
          <Button type="submit" size="sm" disabled={busy}>
            {busy && <Loader2 size={14} className="animate-spin" />} Buat Draft
          </Button>
        </div>
      </form>
    </Modal>
  );
}
