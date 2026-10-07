import React, { useCallback, useEffect, useState } from "react";
import { ClipboardCheck, Loader2 } from "lucide-react";
import { api } from "@/api.js";
import { ComponentNoteSheet } from "./ComponentNoteSheet.jsx";
import { SECTION_BY_KEY } from "./componentNotesModel.js";

// Antrean PENGUJIAN AWAL untuk PIC QC (fase 2 Produksi LAYANAN): unit yang menunggu "QC sebelum bongkar" atau "Uji fondasi awal". Sumber = kartu Run (next.wait) — bukan antrean paralel.
// Formulir = ComponentNoteSheet yang SAMA dengan Unit 360/Meja/Dokumentasi (hasil tersimpan di Catatan Komponen, satu sumber). Hanya pemegang izin QC yang melihat antrean (server 403 untuk lainnya).
export default function PreTestQueue() {
  const [items, setItems] = useState(null); const [allowed, setAllowed] = useState(true); const [error, setError] = useState("");
  const [open, setOpen] = useState(null); const [detail, setDetail] = useState(null); const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    try { const r = await api.getComponentQcQueue(); setItems(r.items || []); setError(""); }
    catch (e) { if (e?.status === 403) setAllowed(false); else setError("Antrean pengujian awal belum bisa dimuat."); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (!notice) return undefined; const t = setTimeout(() => setNotice(""), 4000); return () => clearTimeout(t); }, [notice]);
  if (!allowed) return null;

  async function openSheet(item) {
    setOpen(item); setDetail(null);
    try { setDetail(await api.getComponentNotes(item.unitId)); } catch { setDetail({ sections: {}, salesContext: null }); }
  }
  const salesOf = (item) => (detail?.salesContext || { complaintLabels: item.customer.complaints, request: item.customer.request, customerWeightKg: item.customer.weightKg, orderNumber: item.customer.orderNumber });

  return (
    <section aria-label="Pengujian awal menunggu PIC QC" data-testid="pretest-queue" className="mb-4 space-y-2 rounded-[14px] border border-line bg-surface p-3">
      <div className="flex items-center gap-2"><ClipboardCheck size={16} className="text-accent" aria-hidden /><h2 className="m-0 text-[14px] font-bold text-ink">Pengujian awal menunggu PIC QC</h2></div>
      {notice && <p role="status" data-testid="pretest-notice" className="m-0 rounded-btn bg-greenbg px-3 py-2 text-[13px] font-semibold text-green">{notice}</p>}
      {error && <p role="alert" className="m-0 text-[13px] text-red">{error} <button type="button" onClick={load} className="font-bold underline">Coba lagi</button></p>}
      {items === null && !error ? <div className="flex items-center gap-2 text-[13px] text-ink3"><Loader2 size={14} className="animate-spin" aria-hidden /> Memuat…</div> : null}
      {items && items.length === 0 && <p className="m-0 text-[13px] text-ink3" data-testid="pretest-empty">Tidak ada unit yang menunggu pengujian awal.</p>}
      <ul className="m-0 list-none space-y-2 p-0">
        {(items || []).map((it) => (
          <li key={`${it.runId}-${it.section}`} data-testid="pretest-item" data-unit-code={it.unitCode} data-section={it.section} className="flex flex-wrap items-center justify-between gap-2 rounded-btn bg-inset p-3">
            <div className="min-w-0">
              <p className="m-0 text-[14px] font-bold text-ink">{it.unitCode} <span className="font-normal text-ink3">· {it.customer.orderNumber || "—"} · {it.customer.name || "—"}</span></p>
              <p className="m-0 text-[12.5px] text-ink3">{SECTION_BY_KEY[it.section]?.label}{it.station ? ` · ${it.station}` : ""}</p>
            </div>
            <button type="button" data-mutates data-testid="pretest-open" onClick={() => openSheet(it)} className="min-h-[44px] rounded-btn bg-accent px-4 text-[14px] font-bold text-white">Catat {SECTION_BY_KEY[it.section]?.short}</button>
          </li>
        ))}
      </ul>
      {open && detail && (
        <ComponentNoteSheet unitId={open.unitId} unitCode={open.unitCode} section={open.section} entry={detail.sections?.[open.section] || null} salesContext={salesOf(open)}
          onClose={() => setOpen(null)} onReload={async () => { setOpen(null); await load(); }}
          onSaved={async () => { setOpen(null); setNotice(`${SECTION_BY_KEY[open.section]?.label} tersimpan untuk ${open.unitCode}.`); await load(); }} />
      )}
    </section>
  );
}
