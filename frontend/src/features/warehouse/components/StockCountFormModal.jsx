import React, { useEffect, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { api } from "@/api.js";
import { Modal } from "@/components/ui/modal.jsx";
import { Button } from "@/components/ui/button.jsx";
import { COUNT_TYPE_REAL, COUNT_METHOD_REAL } from "../inventoryReal.js";

// Jadwalkan sesi Stock Count baru — status awal selalu SCHEDULED
// (POST /inventory/stock-counts). Belum ada countedQty/systemQty di sini —
// keduanya baru terisi setelah Start Count.
export default function StockCountFormModal({ open, onClose, onCreated }) {
  const [materials, setMaterials] = useState([]);
  const [staff, setStaff] = useState([]);
  const [countType, setCountType] = useState("CYCLE_COUNT");
  const [countMethod, setCountMethod] = useState("BY_ITEM");
  const [scheduledDate, setScheduledDate] = useState("");
  const [blindCount, setBlindCount] = useState(true);
  const [assignedToId, setAssignedToId] = useState("");
  const [notes, setNotes] = useState("");
  const [materialIds, setMaterialIds] = useState([""]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open) return;
    setCountType("CYCLE_COUNT"); setCountMethod("BY_ITEM"); setScheduledDate("");
    setBlindCount(true); setAssignedToId(""); setNotes(""); setMaterialIds([""]); setErr("");
    api.getMaterials({ active: "true" }).then(setMaterials).catch(() => {});
    api.getUsers().then(setStaff).catch(() => {});
  }, [open]);

  function setMaterialAt(i, value) {
    setMaterialIds((ids) => ids.map((id, idx) => (idx === i ? value : id)));
  }
  function tambahBaris() {
    setMaterialIds((ids) => [...ids, ""]);
  }
  function hapusBaris(i) {
    setMaterialIds((ids) => (ids.length > 1 ? ids.filter((_, idx) => idx !== i) : ids));
  }

  async function simpan(e) {
    e.preventDefault();
    const valid = materialIds.filter(Boolean);
    if (valid.length === 0) { setErr("Minimal satu item wajib dipilih"); return; }
    setBusy(true);
    setErr("");
    try {
      await api.createStockCount({
        countType, countMethod, scheduledDate: scheduledDate || undefined,
        blindCount, assignedToId: assignedToId || undefined, notes: notes || undefined,
        lines: valid.map((materialId) => ({ materialId })),
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
    <Modal open={open} onOpenChange={(o) => (o ? null : onClose())} title="Jadwalkan Stock Count" className="w-[560px]">
      <form onSubmit={simpan} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="sc-type" className="mb-1 block text-[11.5px] font-semibold text-ink2">Count Type *</label>
            <select
              id="sc-type" value={countType} onChange={(e) => setCountType(e.target.value)}
              className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-accent"
            >
              {Object.entries(COUNT_TYPE_REAL).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="sc-method" className="mb-1 block text-[11.5px] font-semibold text-ink2">Count Method</label>
            <select
              id="sc-method" value={countMethod} onChange={(e) => setCountMethod(e.target.value)}
              className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-accent"
            >
              {Object.entries(COUNT_METHOD_REAL).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
            </select>
          </div>
        </div>
        <p className="text-[10.5px] leading-relaxed text-ink3">
          Count Method cuma label kategorisasi — item yang dihitung tetap dipilih manual di bawah.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="sc-date" className="mb-1 block text-[11.5px] font-semibold text-ink2">Scheduled Date</label>
            <input
              id="sc-date" type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)}
              className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-accent"
            />
          </div>
          <div>
            <label htmlFor="sc-assignee" className="mb-1 block text-[11.5px] font-semibold text-ink2">Assigned To</label>
            <select
              id="sc-assignee" value={assignedToId} onChange={(e) => setAssignedToId(e.target.value)}
              className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-accent"
            >
              <option value="">Belum ditugaskan</option>
              {staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
        </div>

        <label className="flex items-center gap-2 text-[12px] text-ink2">
          <input type="checkbox" checked={blindCount} onChange={(e) => setBlindCount(e.target.checked)} />
          Blind count — staf tidak melihat system quantity sampai submit
        </label>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="text-[11.5px] font-semibold text-ink2">Items to Count *</label>
            <button type="button" onClick={tambahBaris} className="flex items-center gap-1 text-[11.5px] font-semibold text-accent">
              <Plus size={12} /> Tambah Item
            </button>
          </div>
          <div className="space-y-2">
            {materialIds.map((id, i) => (
              <div key={i} className="flex items-center gap-2">
                <select
                  value={id} onChange={(e) => setMaterialAt(i, e.target.value)}
                  className="min-w-0 flex-1 rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12px] text-ink outline-none focus:border-accent"
                >
                  <option value="">Pilih item…</option>
                  {materials.map((m) => <option key={m.id} value={m.id}>{m.code} — {m.name}</option>)}
                </select>
                <button
                  type="button" onClick={() => hapusBaris(i)} disabled={materialIds.length === 1}
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
          <label htmlFor="sc-notes" className="mb-1 block text-[11.5px] font-semibold text-ink2">Notes</label>
          <textarea
            id="sc-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
            className="w-full rounded-btn border border-border bg-surface px-2.5 py-2 text-[12.5px] text-ink outline-none focus:border-accent"
          />
        </div>

        {err && <p className="text-[12px] text-red">{err}</p>}

        <div className="flex justify-end gap-2 border-t border-line pt-3">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>Batal</Button>
          <Button type="submit" size="sm" disabled={busy}>
            {busy && <Loader2 size={14} className="animate-spin" />} Jadwalkan
          </Button>
        </div>
      </form>
    </Modal>
  );
}
