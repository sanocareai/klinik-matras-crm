import React, { useEffect, useRef, useState } from "react";
import { Loader2, Plus, Trash2, X } from "lucide-react";
import { api } from "@/api.js";
import { Modal } from "@/components/ui/modal.jsx";
import { Button } from "@/components/ui/button.jsx";
import { ISSUE_SOURCE_REAL, ISSUE_PRIORITY_REAL } from "../inventoryReal.js";

// Ajukan Material Issue baru — status awal selalu DRAFT
// (POST /inventory/material-issues). Requested Quantity WAJIB > 0: baris
// itu yang jadi Reserved begitu permintaan disetujui.
//
// Integrasi Produksi (13 Sept 2026): unitId WAJIB kalau Source Type = Work
// Order Produksi — inilah yang membuat request BENAR-BENAR terhubung ke
// unit produksi (bukan cuma teks bebas di "Referensi" seperti sebelumnya).
// Pencarian unit REUSE GET /production/work-orders (dipakai juga papan
// Work Order Bengkel) — TIDAK bikin endpoint pencarian unit baru.
const BARIS_KOSONG = { materialId: "", requestedQty: "" };

export default function MaterialIssueFormModal({ open, onClose, onCreated }) {
  const [materials, setMaterials] = useState([]);
  const [sourceType, setSourceType] = useState("PRODUCTION_WORK_ORDER");
  const [unitId, setUnitId] = useState("");
  const [unitLabel, setUnitLabel] = useState("");
  const [unitQuery, setUnitQuery] = useState("");
  const [unitResults, setUnitResults] = useState([]);
  const [unitSearching, setUnitSearching] = useState(false);
  const [sourceReference, setSourceReference] = useState("");
  const [department, setDepartment] = useState("");
  const [requiredDate, setRequiredDate] = useState("");
  const [priority, setPriority] = useState("NORMAL");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState([{ ...BARIS_KOSONG }]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const searchTimer = useRef(null);

  useEffect(() => {
    if (!open) return;
    setSourceType("PRODUCTION_WORK_ORDER"); setUnitId(""); setUnitLabel(""); setUnitQuery(""); setUnitResults([]);
    setSourceReference(""); setDepartment("");
    setRequiredDate(""); setPriority("NORMAL"); setNotes(""); setLines([{ ...BARIS_KOSONG }]); setErr("");
    api.getMaterials({ active: "true" }).then(setMaterials).catch(() => {});
  }, [open]);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!unitQuery.trim() || unitId) { setUnitResults([]); return; }
    setUnitSearching(true);
    searchTimer.current = setTimeout(() => {
      api.getWorkOrders({ q: unitQuery.trim() })
        .then((d) => setUnitResults((d.units || []).slice(0, 8)))
        .catch(() => setUnitResults([]))
        .finally(() => setUnitSearching(false));
    }, 300);
    return () => clearTimeout(searchTimer.current);
  }, [unitQuery, unitId]);

  function pilihUnit(u) {
    setUnitId(u.id);
    setUnitLabel(`${u.unitCode} — ${u.order?.orderNumber || "—"} (${u.order?.customer?.name || "—"})`);
    setUnitQuery("");
    setUnitResults([]);
  }
  function batalkanUnit() {
    setUnitId("");
    setUnitLabel("");
  }

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
    if (valid.length === 0) { setErr("Minimal satu item dengan jumlah diminta > 0 wajib diisi"); return; }
    if (sourceType === "PRODUCTION_WORK_ORDER" && !unitId) {
      setErr("Unit produksi wajib dipilih untuk permintaan dari Work Order Produksi");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      await api.createMaterialIssue({
        sourceType, unitId: unitId || undefined,
        sourceReference: sourceReference || undefined, department: department || undefined,
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
    <Modal open={open} onOpenChange={(o) => (o ? null : onClose())} title="Permintaan Material Baru" className="w-[560px]">
      <form onSubmit={simpan} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="mi-source" className="mb-1 block text-[11.5px] font-semibold text-ink2">Sumber Permintaan *</label>
            <select
              id="mi-source" value={sourceType} onChange={(e) => setSourceType(e.target.value)}
              className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-accent"
            >
              {Object.entries(ISSUE_SOURCE_REAL).map(([k, s]) => <option key={k} value={k}>{s.labelId || s.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="mi-priority" className="mb-1 block text-[11.5px] font-semibold text-ink2">Prioritas</label>
            <select
              id="mi-priority" value={priority} onChange={(e) => setPriority(e.target.value)}
              className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-accent"
            >
              {Object.entries(ISSUE_PRIORITY_REAL).map(([k, p]) => <option key={k} value={k}>{p.labelId || p.label}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="mi-unit" className="mb-1 block text-[11.5px] font-semibold text-ink2">
            Unit Produksi {sourceType === "PRODUCTION_WORK_ORDER" && "*"}
          </label>
          {unitId ? (
            <div className="flex items-center justify-between rounded-btn border border-border bg-inset px-2.5 py-1.5 text-[12.5px] text-ink">
              <span className="truncate">{unitLabel}</span>
              <button type="button" onClick={batalkanUnit} className="ml-2 shrink-0 text-ink3 hover:text-red" aria-label="Batalkan pilihan unit">
                <X size={14} />
              </button>
            </div>
          ) : (
            <div className="relative">
              <input
                id="mi-unit" value={unitQuery} onChange={(e) => setUnitQuery(e.target.value)}
                placeholder="Cari kode unit, no. order, atau nama pelanggan…"
                className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none placeholder:text-ink3 focus:border-accent"
              />
              {(unitSearching || unitResults.length > 0) && (
                <div className="absolute z-10 mt-1 w-full rounded-btn border border-border bg-surface shadow-lg">
                  {unitSearching && <div className="px-2.5 py-2 text-[12px] text-ink3">Mencari…</div>}
                  {!unitSearching && unitResults.map((u) => (
                    <button
                      key={u.id} type="button" onClick={() => pilihUnit(u)}
                      className="block w-full px-2.5 py-1.5 text-left text-[12px] text-ink hover:bg-hovertint"
                    >
                      <span className="font-semibold">{u.unitCode}</span>
                      <span className="ml-1.5 text-ink3">{u.order?.orderNumber} · {u.order?.customer?.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="mi-ref" className="mb-1 block text-[11.5px] font-semibold text-ink2">Referensi (opsional)</label>
            <input
              id="mi-ref" value={sourceReference} onChange={(e) => setSourceReference(e.target.value)}
              placeholder="mis. nomor tiket internal"
              className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none placeholder:text-ink3 focus:border-accent"
            />
          </div>
          <div>
            <label htmlFor="mi-dept" className="mb-1 block text-[11.5px] font-semibold text-ink2">Departemen</label>
            <input
              id="mi-dept" value={department} onChange={(e) => setDepartment(e.target.value)}
              placeholder="mis. Line A — Quilting"
              className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none placeholder:text-ink3 focus:border-accent"
            />
          </div>
        </div>

        <div>
          <label htmlFor="mi-date" className="mb-1 block text-[11.5px] font-semibold text-ink2">Dibutuhkan Tanggal</label>
          <input
            id="mi-date" type="date" value={requiredDate} onChange={(e) => setRequiredDate(e.target.value)}
            className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-accent"
          />
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="text-[11.5px] font-semibold text-ink2">Daftar Item *</label>
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
                  placeholder="Jumlah *"
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
          <label htmlFor="mi-notes" className="mb-1 block text-[11.5px] font-semibold text-ink2">Catatan</label>
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
