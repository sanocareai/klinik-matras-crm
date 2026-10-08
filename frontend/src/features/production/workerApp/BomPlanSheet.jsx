import React, { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Plus, Search, Trash2 } from "lucide-react";
import { api } from "@/api.js";
import { useOnline } from "@/components/StandaloneShell.jsx";
import { friendlyError, isRetryableError } from "@/features/production/experience.js";
import { MaterialAttrs } from "@/features/production/componentNotes/MaterialPicker.jsx";
import { submitState } from "./workerAppModel.js";
import { bomDraftFromCard, bomLockedReason, bomPayload, bomUnchanged, bomWillReleaseReservation, racikanRefs, validateBomDraft } from "./materialChainModel.js";
import { OfflineNote, SheetHeader } from "./workerSheets.jsx";

// Lembar "Rencana Bahan (BOM)" milik PIC BAHAN per pekerjaan. Command resmi: POST /production-v2/runs/:id/build/plan-bom -> setPlannedBOM (planning) yang SAMA dengan Diagnosis/Planner:
// revisi rencana (expectedRevision dari kartu), Idempotency-Key per niat, otorisasi PIC yang ditugaskan di server. Tidak menulis stok/reservasi — Gudang yang mereservasi & menyerahkan.
const field = "block w-full rounded-btn border border-line bg-surface px-3 py-3 text-[15px] text-ink placeholder:text-ink3 focus:outline-none focus:ring-2 focus:ring-accent/40";
const newKey = () => `bom-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`}`;

export default function BomPlanSheet({ card, onClose, onSubmitted }) {
  const online = useOnline();
  const locked = bomLockedReason(card);
  const [draft, setDraft] = useState(() => bomDraftFromCard(card.bom || []));
  const [notes, setNotes] = useState(null);
  const [q, setQ] = useState(""); const [results, setResults] = useState([]); const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [canRetry, setCanRetry] = useState(false);
  const keyRef = useRef(newKey());
  const touch = () => { keyRef.current = newKey(); setError(""); setCanRetry(false); }; // isi berubah -> niat baru -> kunci baru
  useEffect(() => { let alive = true; api.getComponentNotes(card.unit.id).then((n) => { if (alive) setNotes(n); }).catch(() => { if (alive) setNotes(null); }); return () => { alive = false; }; }, [card.unit.id]);
  useEffect(() => {
    if (locked) return undefined;
    let alive = true; setSearching(true);
    const t = setTimeout(() => { api.searchComponentMaterials(q).then((r) => { if (alive) setResults(r.items || []); }).catch(() => { if (alive) setResults([]); }).finally(() => { if (alive) setSearching(false); }); }, q ? 250 : 0);
    return () => { alive = false; clearTimeout(t); };
  }, [q, locked]);
  const refs = useMemo(() => racikanRefs(notes?.sections?.PLAN_RACIKAN ?? null), [notes]);
  const inDraft = new Set(draft.map((l) => l.materialId));
  const add = (m) => { if (inDraft.has(m.materialId)) return; setDraft((d) => [...d, { materialId: m.materialId, code: m.code ?? null, name: m.name ?? null, unit: m.unit ?? null, supplier: m.supplier ?? null, itemGroup: m.itemGroup ?? null, qty: "" }]); touch(); };
  const setQty = (id, qty) => { setDraft((d) => d.map((l) => (l.materialId === id ? { ...l, qty } : l))); touch(); };
  const remove = (id) => { setDraft((d) => d.filter((l) => l.materialId !== id)); touch(); };
  const gate = submitState({ online, busy });
  const problem = validateBomDraft(draft);
  const unchanged = bomUnchanged(draft, card.bom || []);

  async function submit() {
    if (problem) { setError(problem); return; }
    if (unchanged) { setError("Tidak ada perubahan pada rencana bahan."); return; }
    setBusy(true); setError(""); setCanRetry(false);
    try {
      const result = await api.setProductionV2BuildPlanBom(card.runId, { expectedRevision: card.plan.revision, lines: bomPayload(draft) }, keyRef.current);
      onSubmitted(result);
    } catch (e) {
      if (isRetryableError(e)) setCanRetry(true); else keyRef.current = newKey();
      setError(friendlyError(e));
      if (e.code === "PLAN_REVISION_CONFLICT") onSubmitted(null);
    } finally { setBusy(false); }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Rencana bahan" data-testid="bom-plan-sheet" className="fixed inset-0 z-50 flex flex-col bg-base">
      <SheetHeader onClose={onClose} subtitle={`${card.unit.unitCode} · rencana rev ${card.plan.revision}`} title="Rencana Bahan (BOM)" />
      <div className="flex-1 space-y-4 overflow-y-auto px-3 py-4">
        <p className="rounded-btn bg-accentbg px-3 py-2 text-[13.5px] text-accent">Tentukan bahan katalog yang dibutuhkan untuk pekerjaan ini. Menyimpan rencana tidak mengeluarkan stok — Gudang yang mereservasi dan menyerahkan bahan.</p>
        {locked && <p role="status" data-testid="bom-locked" className="m-0 rounded-btn bg-orangebg px-3 py-2 text-[13.5px] text-orange">{locked}</p>}
        {!locked && bomWillReleaseReservation(card) && <p role="status" data-testid="bom-release-note" className="m-0 rounded-btn bg-orangebg px-3 py-2 text-[13px] text-orange">Bahan sudah direservasi Gudang. Mengubah BOM melepas reservasi — Gudang perlu mereservasi ulang.</p>}
        <section className="space-y-2" data-testid="bom-racikan-ref">
          <p className="m-0 text-[13px] font-bold text-ink">Racikan dari PIC Meja/PIC QC (acuan)</p>
          {!notes?.sections?.PLAN_RACIKAN ? <p className="m-0 text-[13px] text-ink3">{notes === null ? "Racikan belum bisa dimuat." : "Racikan rencana Belum dicatat."}</p> : (
            <>
              <ul className="m-0 list-none space-y-1.5 p-0">
                {refs.catalog.map((c) => (
                  <li key={c.materialId} data-testid="bom-racikan-item" className="flex items-center justify-between gap-2 rounded-btn bg-inset px-3 py-2 text-[13px]">
                    <span className="min-w-0 break-words [overflow-wrap:anywhere]"><b>{c.name || c.code}</b> — {c.uses.map((u) => u.where).join(", ")}<MaterialAttrs value={{ kind: "CATALOG", ...c }} /></span>
                    {!locked && <button type="button" data-testid="bom-add-from-racikan" disabled={inDraft.has(c.materialId)} onClick={() => add(c)} className="min-h-[44px] shrink-0 rounded-btn bg-accentbg px-3 text-[13px] font-semibold text-accent disabled:opacity-40">{inDraft.has(c.materialId) ? "Sudah di BOM" : "Tambah ke BOM"}</button>}
                  </li>
                ))}
              </ul>
              {refs.unlinked.length > 0 && <p className="m-0 text-[12px] text-ink3" data-testid="bom-racikan-unlinked">Tanpa katalog (pilih bahan katalog bila perlu): {refs.unlinked.map((u) => `${u.where} — ${u.label}`).join("; ")}</p>}
            </>
          )}
        </section>
        <section className="space-y-2" data-testid="bom-lines">
          <p className="m-0 text-[13px] font-bold text-ink">BOM rencana</p>
          {draft.length === 0 && <p className="m-0 text-[13px] text-ink3">Belum ada bahan.</p>}
          <ul className="m-0 list-none space-y-2 p-0">
            {draft.map((l) => (
              <li key={l.materialId} data-testid="bom-line" className="flex items-center gap-3 rounded-btn bg-inset px-3 py-2">
                <div className="min-w-0 flex-1"><p className="m-0 truncate text-[14px] font-semibold text-ink">{l.name || l.code}</p><p className="m-0 text-[12px] text-ink3">{[l.code, l.supplier && `Supplier: ${l.supplier}`, l.itemGroup && `Kelompok: ${l.itemGroup}`].filter(Boolean).join(" · ")}{l.unit ? ` · satuan ${String(l.unit).toLowerCase()}` : ""}</p></div>
                <input aria-label={`Jumlah ${l.name || l.code} dibutuhkan`} data-testid="bom-qty" inputMode="decimal" placeholder="0" disabled={!!locked} className="h-12 w-20 rounded-btn border border-line bg-surface px-2 text-center text-[15px] text-ink disabled:opacity-60" value={l.qty} onChange={(e) => setQty(l.materialId, e.target.value)} />
                {!locked && <button type="button" aria-label={`Hapus ${l.name || l.code}`} onClick={() => remove(l.materialId)} className="flex h-11 w-11 items-center justify-center rounded-btn text-red"><Trash2 size={16} aria-hidden /></button>}
              </li>
            ))}
          </ul>
        </section>
        {!locked && (
          <section className="space-y-2" data-testid="bom-search">
            <p className="m-0 text-[13px] font-bold text-ink">Tambah bahan katalog</p>
            <div className="relative"><Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink3" aria-hidden /><input aria-label="Cari bahan untuk BOM" className={`${field} pl-9`} placeholder="Cari kode/nama bahan…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
            {searching && <p className="m-0 text-[12px] text-ink3">Mencari…</p>}
            <ul data-testid="bom-search-results" className="m-0 max-h-48 list-none space-y-1 overflow-y-auto rounded-btn border border-line p-1">
              {results.map((m) => (
                <li key={m.materialId}><button type="button" data-material-code={m.code} disabled={inDraft.has(m.materialId)} onClick={() => add(m)} className="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-btn px-2 py-1 text-left text-[13.5px] text-ink hover:bg-hovertint disabled:opacity-40">
                  <span className="min-w-0 break-words">{m.name}<MaterialAttrs value={{ kind: "CATALOG", ...m }} /></span><Plus size={15} className="shrink-0 text-accent" aria-hidden /></button></li>
              ))}
            </ul>
          </section>
        )}
        {error && <div role="alert" data-testid="bom-error" className="rounded-btn bg-redbg px-3 py-3 text-[13.5px] text-red">{error}</div>}
      </div>
      <div className="space-y-2 border-t border-line bg-surface px-3 pt-3" style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}>
        {!online && <OfflineNote />}
        <button type="button" data-mutates data-testid="bom-save" onClick={submit} disabled={gate.disabled || !!locked}
          className="flex min-h-[56px] w-full items-center justify-center gap-2 rounded-btn bg-accent text-[16px] font-bold text-white disabled:opacity-50">
          {busy ? <><Loader2 size={20} className="animate-spin" aria-hidden /> Mengirim…</> : canRetry ? "Coba Lagi" : (card.bom?.length ? "Simpan Revisi Rencana Bahan" : "Simpan Rencana Bahan")}
        </button>
      </div>
    </div>
  );
}
