import React, { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { api } from "@/api.js";
import { useOnline } from "@/components/StandaloneShell.jsx";
import { friendlyBuildError, isRetryableError } from "@/features/production/experience.js";
import { MaterialAttrs } from "@/features/production/componentNotes/MaterialPicker.jsx";
import MaterialRowsEditor from "@/features/production/components/MaterialRowsEditor.jsx";
import { fromRecord, rowsPayload, sameAsSaved, validateMaterialRows, withTrailingBlank } from "@/features/production/materialRows.js";
import { submitState } from "./workerAppModel.js";
import { bomLockedReason, bomWillReleaseReservation, racikanRefs } from "./materialChainModel.js";
import { OfflineNote, SheetHeader } from "./workerSheets.jsx";

// Lembar "Rencana Bahan (BOM)" milik PIC BAHAN per pekerjaan. Command resmi: POST /production-v2/runs/:id/build/plan-bom -> setPlannedBOM (planning) yang SAMA dengan Diagnosis/Planner:
// revisi rencana (expectedRevision dari kartu), Idempotency-Key per niat, otorisasi PIC yang ditugaskan di server. Tidak menulis stok/reservasi — Gudang yang mereservasi & menyerahkan.
// Isian memakai pola baris "+ Tambah baris" (sama dengan PO Finance): satu daftar, baris kosong terakhir tidak dikirim, satu bahan satu baris.
const field = "block w-full rounded-btn border border-line bg-surface px-3 py-3 text-[15px] text-ink placeholder:text-ink3 focus:outline-none focus:ring-2 focus:ring-accent/40";
const newKey = () => `bom-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`}`;

export default function BomPlanSheet({ card, onClose, onSubmitted }) {
  const online = useOnline();
  const locked = bomLockedReason(card);
  const [rows, setRows] = useState(() => fromRecord(card.bom || []));
  const [rowErrors, setRowErrors] = useState({});
  const [notes, setNotes] = useState(null);
  const [q, setQ] = useState(""); const [results, setResults] = useState([]); const [searching, setSearching] = useState(false);
  const [known, setKnown] = useState(() => new Map((card.bom || []).map((b) => [b.materialId, { id: b.materialId, label: b.name || b.code || "Bahan", code: b.code ?? null, unit: b.uom ?? null, supplier: b.supplier ?? null, itemGroup: b.itemGroup ?? null }])));
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [canRetry, setCanRetry] = useState(false);
  const keyRef = useRef(newKey());
  const touch = () => { keyRef.current = newKey(); setError(""); setCanRetry(false); setRowErrors({}); }; // isi berubah -> niat baru -> kunci baru
  useEffect(() => { let alive = true; api.getComponentNotes(card.unit.id).then((n) => { if (alive) setNotes(n); }).catch(() => { if (alive) setNotes(null); }); return () => { alive = false; }; }, [card.unit.id]);
  useEffect(() => {
    if (locked) return undefined;
    let alive = true; setSearching(true);
    const t = setTimeout(() => { api.searchComponentMaterials(q).then((r) => { if (alive) setResults(r.items || []); }).catch(() => { if (alive) setResults([]); }).finally(() => { if (alive) setSearching(false); }); }, q ? 250 : 0);
    return () => { alive = false; clearTimeout(t); };
  }, [q, locked]);
  // Bahan yang pernah muncul di hasil pencarian diingat supaya nama bahan di baris tidak hilang saat kata kunci berubah.
  useEffect(() => {
    if (!results.length) return;
    setKnown((prev) => { const next = new Map(prev); for (const m of results) next.set(m.materialId, { id: m.materialId, label: m.name || m.code, code: m.code ?? null, unit: m.unit ?? null, supplier: m.supplier ?? null, itemGroup: m.itemGroup ?? null }); return next; });
  }, [results]);
  const refs = useMemo(() => racikanRefs(notes?.sections?.PLAN_RACIKAN ?? null), [notes]);
  const selectedIds = new Set(rows.map((r) => r.materialId).filter(Boolean));
  const optionOf = (m) => ({ id: m.id, label: `${m.label}${m.code ? ` (${m.code})` : ""}`, unit: m.unit, hint: [m.supplier && `Supplier: ${m.supplier}`, m.itemGroup && `Kelompok: ${m.itemGroup}`].filter(Boolean).join(" · ") || null });
  const options = useMemo(() => {
    const shown = new Map();
    for (const m of results) { const k = known.get(m.materialId); if (k) shown.set(k.id, optionOf(k)); }
    for (const id of selectedIds) { const k = known.get(id); if (k && !shown.has(id)) shown.set(id, optionOf(k)); }
    return [...shown.values()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, known, rows]);

  const addFromRacikan = (m) => {
    if (selectedIds.has(m.materialId)) return;
    setKnown((prev) => new Map(prev).set(m.materialId, { id: m.materialId, label: m.name || m.code, code: m.code ?? null, unit: m.unit ?? null, supplier: m.supplier ?? null, itemGroup: m.itemGroup ?? null }));
    setRows((rs) => withTrailingBlank([...rs.filter((r) => !(r.materialId === "" && String(r.qty).trim() === "")), { materialId: m.materialId, qty: "" }]));
    touch();
  };
  const changeRows = (next) => { setRows(next); touch(); };
  const gate = submitState({ online, busy });
  const unchanged = sameAsSaved(rows, card.bom || []);

  async function submit() {
    const v = validateMaterialRows(rows, { requireOne: true });
    if (v.error) { setRowErrors(v.rowErrors); setError(v.error); return; }
    if (unchanged) { setError("Tidak ada perubahan pada rencana bahan."); return; }
    setBusy(true); setError(""); setCanRetry(false);
    try {
      const result = await api.setProductionV2BuildPlanBom(card.runId, { expectedRevision: card.plan.revision, lines: rowsPayload(rows) }, keyRef.current);
      onSubmitted(result);
    } catch (e) {
      if (isRetryableError(e)) setCanRetry(true); else keyRef.current = newKey();
      setError(friendlyBuildError(e));
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
                    {!locked && <button type="button" data-testid="bom-add-from-racikan" disabled={selectedIds.has(c.materialId)} onClick={() => addFromRacikan(c)} className="min-h-[44px] shrink-0 rounded-btn bg-accentbg px-3 text-[13px] font-semibold text-accent disabled:opacity-40">{selectedIds.has(c.materialId) ? "Sudah di BOM" : "Tambah ke BOM"}</button>}
                  </li>
                ))}
              </ul>
              {refs.unlinked.length > 0 && <p className="m-0 text-[12px] text-ink3" data-testid="bom-racikan-unlinked">Tanpa katalog (pilih bahan katalog bila perlu): {refs.unlinked.map((u) => `${u.where} — ${u.label}`).join("; ")}</p>}
            </>
          )}
        </section>
        <section className="space-y-2" data-testid="bom-lines">
          <p className="m-0 text-[13px] font-bold text-ink">BOM rencana</p>
          {!locked && (
            <div className="relative" data-testid="bom-search">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink3" aria-hidden />
              <input aria-label="Cari bahan untuk BOM" className={`${field} pl-9`} placeholder="Cari kode/nama bahan untuk daftar pilihan…" value={q} onChange={(e) => setQ(e.target.value)} />
              {searching && <p className="m-0 mt-1 text-[12px] text-ink3">Mencari…</p>}
            </div>
          )}
          <MaterialRowsEditor rows={rows} onChange={changeRows} options={options} errors={rowErrors} disabled={!!locked} testid="bom-rows" addLabel="Tambah baris" qtyLabel="Jumlah dibutuhkan" />
        </section>
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
