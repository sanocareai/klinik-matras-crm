import React, { useEffect, useRef, useState } from "react";
import { Loader2, Plus, Search, Trash2 } from "lucide-react";
import { api } from "@/api.js";
import { useOnline } from "@/components/StandaloneShell.jsx";
import { friendlyBuildError, isRetryableError } from "@/features/production/experience.js";
import { MaterialAttrs } from "@/features/production/componentNotes/MaterialPicker.jsx";
import { submitState } from "./workerAppModel.js";
import { reworkLinesPayload, validateReworkLines } from "./materialChainModel.js";
import { OfflineNote, SheetHeader } from "./workerSheets.jsx";

// Lembar "Minta Bahan Rework" milik PIC BAHAN per pekerjaan. Command resmi: POST /production-v2/runs/:id/build/rework-material -> requestReworkMaterial (command QC yang SAMA: reservasi + Material Issue
// tambahan READY_TO_PICK; satu permintaan per putusan QC gagal; hanya sebelum rework dimulai). TIDAK menulis stok — Gudang menyerahkan lewat "Serahkan Bahan" yang sudah ada (stok keluar tepat sekali di sana).
const field = "block w-full rounded-btn border border-line bg-surface px-3 py-3 text-[15px] text-ink placeholder:text-ink3 focus:outline-none focus:ring-2 focus:ring-accent/40";
const newKey = () => `rwm-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`}`;

export default function ReworkMaterialSheet({ card, onClose, onSubmitted }) {
  const online = useOnline();
  const [lines, setLines] = useState([]);
  const [q, setQ] = useState(""); const [results, setResults] = useState([]); const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [canRetry, setCanRetry] = useState(false);
  const keyRef = useRef(newKey());
  const touch = () => { keyRef.current = newKey(); setError(""); setCanRetry(false); };
  useEffect(() => {
    let alive = true; setSearching(true);
    const t = setTimeout(() => { api.searchComponentMaterials(q).then((r) => { if (alive) setResults(r.items || []); }).catch(() => { if (alive) setResults([]); }).finally(() => { if (alive) setSearching(false); }); }, q ? 250 : 0);
    return () => { alive = false; clearTimeout(t); };
  }, [q]);
  const inList = new Set(lines.map((l) => l.materialId));
  const add = (m) => { if (inList.has(m.materialId)) return; setLines((d) => [...d, { materialId: m.materialId, code: m.code, name: m.name, unit: m.unit, supplier: m.supplier ?? null, itemGroup: m.itemGroup ?? null, qty: "" }]); touch(); };
  const setQty = (id, qty) => { setLines((d) => d.map((l) => (l.materialId === id ? { ...l, qty } : l))); touch(); };
  const remove = (id) => { setLines((d) => d.filter((l) => l.materialId !== id)); touch(); };
  const gate = submitState({ online, busy });
  async function submit() {
    const bad = validateReworkLines(lines); if (bad) { setError(bad); return; }
    setBusy(true); setError(""); setCanRetry(false);
    try { onSubmitted(await api.requestProductionV2BuildReworkMaterial(card.runId, { expectedRevision: card.revision, lines: reworkLinesPayload(lines) }, keyRef.current)); }
    catch (e) { if (isRetryableError(e)) setCanRetry(true); else keyRef.current = newKey(); setError(friendlyBuildError(e)); if (e.code === "QC_REVISION_CONFLICT" || e.code === "STEP_REVISION_CONFLICT") onSubmitted(null); }
    finally { setBusy(false); }
  }
  return (
    <div role="dialog" aria-modal="true" aria-label="Minta bahan rework" data-testid="rework-material-sheet" className="fixed inset-0 z-50 flex flex-col bg-base">
      <SheetHeader onClose={onClose} subtitle={`${card.unit.unitCode} · putaran ${card.assembly?.round ?? "—"}`} title="Minta Bahan Rework" />
      <div className="flex-1 space-y-4 overflow-y-auto px-3 py-4">
        <p className="rounded-btn bg-accentbg px-3 py-2 text-[13.5px] text-accent">QC memutuskan gagal → rework. Ajukan bahan TAMBAHAN yang dibutuhkan; Gudang mereservasi lalu menyerahkannya. Permintaan hanya bisa diajukan SEKALI dan sebelum PIC Meja memulai rework. Mengajukan tidak mengeluarkan stok.</p>
        <section className="space-y-2" data-testid="rework-lines">
          <p className="m-0 text-[13px] font-bold text-ink">Bahan tambahan</p>
          {lines.length === 0 && <p className="m-0 text-[13px] text-ink3">Belum ada bahan.</p>}
          <ul className="m-0 list-none space-y-2 p-0">
            {lines.map((l) => (
              <li key={l.materialId} data-testid="rework-line" className="flex items-center gap-3 rounded-btn bg-inset px-3 py-2">
                <div className="min-w-0 flex-1"><p className="m-0 truncate text-[14px] font-semibold text-ink">{l.name || l.code}</p><p className="m-0 text-[12px] text-ink3">{[l.code, l.supplier && `Supplier: ${l.supplier}`, l.unit && `satuan ${String(l.unit).toLowerCase()}`].filter(Boolean).join(" · ")}</p></div>
                <input aria-label={`Jumlah ${l.name || l.code} tambahan`} data-testid="rework-qty" inputMode="decimal" placeholder="0" className="h-12 w-20 rounded-btn border border-line bg-surface px-2 text-center text-[15px] text-ink" value={l.qty} onChange={(e) => setQty(l.materialId, e.target.value)} />
                <button type="button" aria-label={`Hapus ${l.name || l.code}`} onClick={() => remove(l.materialId)} className="flex h-11 w-11 items-center justify-center rounded-btn text-red"><Trash2 size={16} aria-hidden /></button>
              </li>
            ))}
          </ul>
        </section>
        <section className="space-y-2">
          <p className="m-0 text-[13px] font-bold text-ink">Tambah bahan katalog</p>
          <div className="relative"><Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink3" aria-hidden /><input aria-label="Cari bahan rework" className={`${field} pl-9`} placeholder="Cari kode/nama bahan…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          {searching && <p className="m-0 text-[12px] text-ink3">Mencari…</p>}
          <ul data-testid="rework-search-results" className="m-0 max-h-48 list-none space-y-1 overflow-y-auto rounded-btn border border-line p-1">
            {results.map((m) => (
              <li key={m.materialId}><button type="button" data-material-code={m.code} disabled={inList.has(m.materialId)} onClick={() => add(m)} className="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-btn px-2 py-1 text-left text-[13.5px] text-ink hover:bg-hovertint disabled:opacity-40">
                <span className="min-w-0 break-words">{m.name}<MaterialAttrs value={{ kind: "CATALOG", ...m }} /></span><Plus size={15} className="shrink-0 text-accent" aria-hidden /></button></li>
            ))}
          </ul>
        </section>
        {error && <div role="alert" data-testid="rework-error" className="rounded-btn bg-redbg px-3 py-3 text-[13.5px] text-red">{error}</div>}
      </div>
      <div className="space-y-2 border-t border-line bg-surface px-3 pt-3" style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}>
        {!online && <OfflineNote />}
        <button type="button" data-mutates data-testid="rework-submit" onClick={submit} disabled={gate.disabled}
          className="flex min-h-[56px] w-full items-center justify-center gap-2 rounded-btn bg-accent text-[16px] font-bold text-white disabled:opacity-50">
          {busy ? <><Loader2 size={20} className="animate-spin" aria-hidden /> Mengirim…</> : canRetry ? "Coba Lagi" : "Ajukan Bahan Rework ke Gudang"}
        </button>
      </div>
    </div>
  );
}
