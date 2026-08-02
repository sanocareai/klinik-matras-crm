import React, { useEffect, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { api } from "@/api.js";
import { Modal } from "@/components/ui/modal.jsx";
import { Button } from "@/components/ui/button.jsx";
import { ISSUE_SOURCE_REAL, ISSUE_PRIORITY_REAL } from "../inventoryReal.js";

// Ajukan Material Issue baru — status awal selalu DRAFT
// (POST /inventory/material-issues). Requested Quantity WAJIB > 0: baris
// itu yang jadi Reserved begitu permintaan disetujui.
const BARIS_KOSONG = { materialId: "", requestedQty: "" };

export default function MaterialIssueFormModal({ open, onClose, onCreated }) {
  const [materials, setMaterials] = useState([]);
  const [sourceType, setSourceType] = useState("PRODUCTION_WORK_ORDER");
  const [sourceReference, setSourceReference] = useState("");
  const [department, setDepartment] = useState("");
  const [requiredDate, setRequiredDate] = useState("");
  const [priority, setPriority] = useState("NORMAL");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState([{ ...BARIS_KOSONG }]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open) return;
    setSourceType("PRODUCTION_WORK_ORDER"); setSourceReference(""); setDepartment("");
    setRequiredDate(""); setPriority("NORMAL"); setNotes(""); setLines([{ ...BARIS_KOSONG }]); setErr("");
    api.getMaterials({ active: "true" }).then(setMaterials).catch(() => {});
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
    const valid = lines.filter((l) => l.materialId && Number(l.requestedQty) > 0);
    if (valid.length === 0) { setErr("Minimal satu item dengan Requested Quantity > 0 wajib diisi"); return; }
    setBusy(true);
    setErr("");
    try {
      await api.createMaterialIssue({
        sourceType, sourceReference: sourceReference || undefined, department: department || undefined,
        requiredDate: requiredDate || undefined, priority, notes: notes || undefined,
        lines: valid.map((l) => ({ materialId: l.materialId, requestedQty: l.requestedQty })),
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
    <Modal open={open} onOpenChange={(o) => (o ? null : onClose())} title="Material Issue Baru" className="w-[560px]">
      <form onSubmit={simpan} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="mi-source" className="mb-1 block text-[11.5px] font-semibold text-ink2">Source Type *</label>
            <select
              id="mi-source" value={sourceType} onChange={(e) => setSourceType(e.target.value)}
              className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-accent"
            >
              {Object.entries(ISSUE_SOURCE_REAL).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="mi-priority" className="mb-1 block text-[11.5px] font-semibold text-ink2">Priority</label>
            <select
              id="mi-priority" value={priority} onChange={(e) => setPriority(e.target.value)}
              className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-accent"
            >
              {Object.entries(ISSUE_PRIORITY_REAL).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="mi-ref" className="mb-1 block text-[11.5px] font-semibold text-ink2">Work Order / Reference</label>
            <input
              id="mi-ref" value={sourceReference} onChange={(e) => setSourceReference(e.target.value)}
              placeholder="mis. WO-2026-0871"
              className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none placeholder:text-ink3 focus:border-accent"
            />
          </div>
          <div>
            <label htmlFor="mi-dept" className="mb-1 block text-[11.5px] font-semibold text-ink2">Department</label>
            <input
              id="mi-dept" value={department} onChange={(e) => setDepartment(e.target.value)}
              placeholder="mis. Line A — Quilting"
              className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none placeholder:text-ink3 focus:border-accent"
            />
          </div>
        </div>

        <div>
          <label htmlFor="mi-date" className="mb-1 block text-[11.5px] font-semibold text-ink2">Required Date</label>
          <input
            id="mi-date" type="date" value={requiredDate} onChange={(e) => setRequiredDate(e.target.value)}
            className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-accent"
          />
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
                  type="number" step="any" min="0" value={l.requestedQty}
                  onChange={(e) => setLine(i, { requestedQty: e.target.value })}
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
          <label htmlFor="mi-notes" className="mb-1 block text-[11.5px] font-semibold text-ink2">Notes</label>
          <textarea
            id="mi-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
            className="w-full rounded-btn border border-border bg-surface px-2.5 py-2 text-[12.5px] text-ink outline-none focus:border-accent"
          />
        </div>

        {err && <p className="text-[12px] text-red">{err}</p>}

        <div className="flex justify-end gap-2 border-t border-line pt-3">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>Batal</Button>
          <Button type="submit" size="sm" disabled={busy}>
            {busy && <Loader2 size={14} className="animate-spin" />} Ajukan
          </Button>
        </div>
      </form>
    </Modal>
  );
}
