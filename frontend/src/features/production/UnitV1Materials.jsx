import React, { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { api } from "@/api.js";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";
import { canMaterialV1 } from "./unitV1ActionsModel.js";

// P12B.6 — Bahan Digunakan (V1) untuk unit NON-V2: catat pemakaian bahan lewat ledger stok yang sama dengan Gudang (negatif ditolak server). Unit cohort memakai Material Issue V2.
const INPUT = "h-9 rounded-btn border border-border bg-surface px-2.5 text-[12.5px] text-ink outline-none placeholder:text-ink3 focus:border-accent";

export default function UnitV1Materials({ unitId, roles, onChanged }) {
  const canWrite = canMaterialV1(roles);
  const [usage, setUsage] = useState(null); const [catalog, setCatalog] = useState([]);
  const [form, setForm] = useState({ materialId: "", qty: "", note: "" });
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState({ kind: "", text: "" });
  const load = useCallback(() => api.getUnitMaterials(unitId).then(setUsage).catch((e) => setMsg({ kind: "error", text: e.message })), [unitId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (canWrite) api.getMaterials({ active: true }).then((d) => setCatalog(Array.isArray(d) ? d : d.materials || [])).catch(() => {}); }, [canWrite]);
  async function add() {
    setBusy(true); setMsg({ kind: "", text: "" });
    try { await api.addUnitMaterial(unitId, { materialId: form.materialId, qty: Number(form.qty), note: form.note }); setForm({ materialId: "", qty: "", note: "" }); await load(); onChanged?.(); setMsg({ kind: "ok", text: "Pemakaian bahan tercatat." }); }
    catch (e) { setMsg({ kind: "error", text: e.message || "Gagal mencatat" }); } finally { setBusy(false); }
  }
  return (
    <section className="rounded-btn border border-line p-3" data-testid="v1-materials">
      <h3 className="m-0 mb-1 text-[13px] font-bold text-ink">Bahan Digunakan (V1)</h3>
      <p className="m-0 mb-2 text-[11.5px] text-ink3">Dicatat langsung — stok gudang berkurang otomatis (jumlah negatif = koreksi).</p>
      {canWrite && (
        <div className="mb-2 flex flex-wrap items-end gap-2">
          <select data-testid="v1-material-select" aria-label="Pilih bahan" className={`${INPUT} min-w-[160px] flex-1`} value={form.materialId} onChange={(e) => setForm({ ...form, materialId: e.target.value })}><option value="">Pilih bahan…</option>{catalog.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.unit})</option>)}</select>
          <input data-testid="v1-material-qty" type="number" step="any" aria-label="Jumlah" className={`${INPUT} w-[130px]`} placeholder="Jumlah" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} />
          <input aria-label="Catatan bahan" className={`${INPUT} min-w-[120px] flex-1`} placeholder="Catatan (opsional)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          <Button size="sm" data-testid="v1-material-save" onClick={add} disabled={busy || !form.materialId || !form.qty || Number(form.qty) === 0}>{busy && <Loader2 size={14} className="animate-spin" />} Catat</Button>
        </div>
      )}
      {msg.text && <p role={msg.kind === "error" ? "alert" : "status"} data-testid="v1-material-msg" className={`m-0 mb-2 rounded-btn px-3 py-2 text-[12px] ${msg.kind === "error" ? "bg-redbg text-red" : "bg-greenbg text-green"}`}>{msg.text}</p>}
      {usage?.totals?.length > 0 && <div className="mb-2 flex flex-wrap gap-1.5" data-testid="v1-material-totals">{usage.totals.map((t) => <Badge key={t.material.id} variant="accent">{t.material.name}: {t.usedQty} {t.material.unit}</Badge>)}</div>}
      {usage?.movements?.length > 0 ? (
        <ul className="m-0 list-none divide-y divide-line p-0">{usage.movements.map((m) => (
          <li key={m.id} className="flex items-center justify-between gap-2 py-1.5 text-[12px]"><span className="min-w-0 truncate"><b className="text-ink">{m.material.name}</b> <span className="text-ink3">{m.createdBy?.name || "—"}</span></span><Badge variant={m.type === "ISSUE" ? "accent" : "orange"}>{m.type === "RETURN" ? "-" : ""}{Math.abs(Number(m.qty))} {m.material.unit}</Badge></li>))}</ul>
      ) : <p className="m-0 text-[12px] text-ink3">Belum ada bahan dicatat untuk unit ini.</p>}
    </section>
  );
}
