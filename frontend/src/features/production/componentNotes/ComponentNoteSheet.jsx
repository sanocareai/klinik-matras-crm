import React, { useRef, useState } from "react";
import { ArrowDown, ArrowUp, Loader2, Plus, Trash2, WifiOff, X } from "lucide-react";
import { api } from "@/api.js";
import { useOnline } from "@/components/StandaloneShell.jsx";
import { EvidenceCapture } from "@/features/production/components/EvidenceCapture.jsx";
import { AnalysisContext } from "./AnalysisContext.jsx";
import { JourneySummary } from "./JourneySummary.jsx";
import { MaterialPicker } from "./MaterialPicker.jsx";
import { SalesContextBox } from "./SalesContextBox.jsx";
import {
  draftComparison, draftDeviations, draftFromPlan,
  ACTIONS, COMPLAINT_MATCHES, CONDITIONS, FOUNDATION_SYSTEMS, MAX_LAYERS, SECTION_BY_KEY, applySuggestions, draftFromEntry, emptyLayerAfter, emptyLayerBefore, friendlyComponentError,
  hasPendingUploads, maxMediaFor, mediaPayload, minMediaFor, payloadFromDraft, summarizeLayersDraft, summarizeResultDraft, validateDraft,
} from "./componentNotesModel.js";

// Formulir Catatan Komponen (layar-penuh) — satu bentuk untuk Meja, Corner, Dokumentasi, dan Unit 360. Menyimpan versi baru lewat command server (Idempotency-Key per niat,
// expectedVersion dari bacaan terakhir). Koreksi wajib beralasan. Catatan ini INFORMASI: tidak memotong stok dan tidak menjadi BOM/pemakaian/retur.
const FIELD = "block w-full min-h-[44px] rounded-btn border border-line bg-surface px-3 py-2.5 text-[15px] text-ink outline-none focus:border-accent";
const newKey = (tag) => `${tag}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`}`;

// Lembar `fixed` harus dipasang di induk TANPA backdrop-filter: wildcard kaca `[class*="rounded-card"]` memberi induk bergaya kaca backdrop-filter sehingga `fixed` menjadi relatif
// terhadap induk (lembar terpotong) — QA klik nyata di Hub QC menemukannya. Induk yang memuat panel ini memakai `kpi-glass-guard` / bukan `rounded-card`. TIDAK di-portal: drawer Unit 360
// (Radix Dialog) menganggap portal sebagai "klik di luar" dan menutup dirinya.
function Sheet({ title, subtitle, onClose, children, footer }) {
  return (
    <div role="dialog" aria-modal="true" aria-label={title} data-testid="component-sheet" className="fixed inset-0 z-[230] flex flex-col bg-base">
      <div className="flex items-center gap-2 border-b border-line bg-surface px-3 py-2" style={{ paddingTop: "calc(0.5rem + env(safe-area-inset-top))" }}>
        <button type="button" onClick={onClose} aria-label="Tutup" className="flex h-11 w-11 items-center justify-center rounded-btn text-ink2 hover:bg-hovertint"><X size={20} aria-hidden /></button>
        <div className="min-w-0 flex-1">{subtitle && <p className="m-0 truncate text-[12px] text-ink3">{subtitle}</p>}<p className="m-0 truncate text-[16px] font-bold text-ink">{title}</p></div>
      </div>
      <div className="mx-auto w-full max-w-[720px] flex-1 space-y-4 overflow-y-auto px-3 py-4">{children}</div>
      <div className="space-y-2 border-t border-line bg-surface px-3 pt-3" style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}><div className="mx-auto w-full max-w-[720px] space-y-2">{footer}</div></div>
    </div>
  );
}
const Field = ({ label, children, hint }) => <label className="block space-y-1 text-[13px] font-semibold text-ink2"><span>{label}</span>{children}{hint && <span className="block text-[11.5px] font-normal text-ink3">{hint}</span>}</label>;
const Select = ({ value, onChange, options, placeholder, testid, label }) => (
  <select data-testid={testid} aria-label={label} className={FIELD} value={value} onChange={(e) => onChange(e.target.value)}>
    <option value="">{placeholder}</option>{options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
  </select>
);
const Chips = ({ options, value, onChange, label, testid }) => (
  <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2" data-testid={testid}>
    {options.map((o) => <button key={o.key} type="button" role="radio" aria-checked={value === o.key} onClick={() => onChange(o.key)} className={`min-h-[44px] rounded-btn px-3 text-[13.5px] font-semibold ${value === o.key ? "bg-accent text-white" : "bg-inset text-ink2"}`}>{o.label}</button>)}
  </div>
);
const Note = ({ value, onChange, placeholder = "Catatan (opsional)", testid = "component-note" }) => <textarea data-testid={testid} aria-label={placeholder} rows={2} maxLength={300} className={FIELD} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />;
const Thickness = ({ value, onChange }) => <input data-testid="thickness" inputMode="decimal" aria-label="Ketebalan (cm)" className={FIELD} placeholder="mis. 5" value={value} onChange={(e) => onChange(e.target.value)} />;

function LayersBeforeForm({ draft, set }) {
  const upd = (id, patch) => set({ layers: draft.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)) });
  const move = (i, d) => { const j = i + d; if (j < 0 || j >= draft.layers.length) return; const next = [...draft.layers]; [next[i], next[j]] = [next[j], next[i]]; set({ layers: next }); };
  return (
    <>
      <label className="flex min-h-[44px] items-center gap-2 rounded-btn bg-inset px-3 text-[14px] font-semibold text-ink"><input type="checkbox" data-testid="layers-unknown" checked={draft.layersUnknown} onChange={(e) => set({ layersUnknown: e.target.checked, layers: e.target.checked ? [] : draft.layers })} /> Lapisan tidak diketahui</label>
      {!draft.layersUnknown && (
        <>
          <p className="m-0 text-[12.5px] text-ink3">Urutkan dari lapisan paling atas (yang dikenai badan) ke bawah. Ketebalan yang kosong = belum diukur (bukan 0).</p>
          <p className="m-0 rounded-btn bg-inset px-3 py-2 text-[13px] font-semibold text-ink" data-testid="layers-total-preview">{summarizeLayersDraft(draft).text}</p>
          {draft.layers.map((l, i) => (
            <div key={l.id} data-testid="layer-row" className="space-y-3 rounded-card border border-line p-3">
              <div className="flex items-center justify-between"><p className="m-0 text-[14px] font-bold text-ink">Lapisan {i + 1}</p>
                <div className="flex gap-1">
                  <button type="button" aria-label="Naikkan" onClick={() => move(i, -1)} className="flex h-11 w-11 items-center justify-center rounded-btn text-ink2"><ArrowUp size={16} aria-hidden /></button>
                  <button type="button" aria-label="Turunkan" onClick={() => move(i, 1)} className="flex h-11 w-11 items-center justify-center rounded-btn text-ink2"><ArrowDown size={16} aria-hidden /></button>
                  <button type="button" aria-label={`Hapus lapisan ${i + 1}`} onClick={() => set({ layers: draft.layers.filter((x) => x.id !== l.id) })} className="flex h-11 w-11 items-center justify-center rounded-btn text-red"><Trash2 size={16} aria-hidden /></button></div></div>
              <MaterialPicker value={l.material} onChange={(m) => upd(l.id, { material: m })} label="Jenis/bahan lapisan" />
              <div className="grid grid-cols-2 gap-2">
                <Field label="Ketebalan (cm)" hint="Kosongkan bila tidak diketahui"><Thickness value={l.thickness} onChange={(v) => upd(l.id, { thickness: v })} /></Field>
                <Field label="Kondisi *"><Select testid="condition" label="Kondisi lapisan" value={l.condition} onChange={(v) => upd(l.id, { condition: v })} options={CONDITIONS} placeholder="Pilih kondisi" /></Field>
              </div>
              <Note value={l.note} onChange={(v) => upd(l.id, { note: v })} testid="layer-note" />
            </div>
          ))}
          {draft.layers.length < MAX_LAYERS && <button type="button" data-testid="add-layer" onClick={() => set({ layers: [...draft.layers, emptyLayerBefore()] })} className="flex min-h-[48px] w-full items-center justify-center gap-1.5 rounded-btn bg-accentbg text-[14px] font-semibold text-accent"><Plus size={16} aria-hidden /> Tambah lapisan</button>}
        </>
      )}
    </>
  );
}

const NumInput = ({ value, onChange, testid, label, placeholder }) => <input data-testid={testid} inputMode="decimal" aria-label={label} className={FIELD} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />;

// Fase 4: penanda "titik & metode sama dengan uji awal" + pratinjau perbandingan terhadap uji awal (hanya bila sebanding; server menghitung ulang).
function SameMethodCompare({ section, draft, set, measurements }) {
  const cmp = draftComparison(section, draft, measurements);
  return (
    <>
      <label className="flex min-h-[44px] items-center gap-2 rounded-btn bg-inset px-3 text-[14px] font-semibold text-ink"><input type="checkbox" data-testid="same-method" checked={!!draft.sameMethod} onChange={(e) => set({ sameMethod: e.target.checked })} /> Saya mengonfirmasi: titik, metode, dan kondisi pengujian SEBANDING dengan uji awal (selisih hanya tampil bila dicentang)</label>
      {cmp && <p data-testid="test-compare" data-comparable={cmp.comparable ? "1" : "0"} className={`m-0 rounded-btn px-3 py-2 text-[13px] ${cmp.available && !cmp.comparable ? "bg-orangebg text-orange" : "bg-inset text-ink2"}`}>{cmp.text}</p>}
    </>
  );
}

function WholeTestForm({ draft, set, salesContext, after = false, measurements = null }) {
  return (
    <>
      <SalesContextBox ctx={salesContext} />
      <Field label="Kesesuaian dengan keluhan customer *"><Chips options={COMPLAINT_MATCHES} value={draft.complaintMatch} onChange={(v) => set({ complaintMatch: v })} label="Kesesuaian dengan keluhan" testid="complaint-match" /></Field>
      <Field label="Catatan keluhan (opsional)"><Note value={draft.complaintNote} onChange={(v) => set({ complaintNote: v })} placeholder="Mis. keluhan sakit pinggang terasa pada sisi kiri" testid="complaint-note" /></Field>
      <Field label="Feel awal *"><textarea data-testid="feel-note" aria-label="Feel awal" rows={2} maxLength={500} className={FIELD} placeholder="Mis. tengah amblas, tepi keras" value={draft.feelNote} onChange={(e) => set({ feelNote: e.target.value })} /></Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Berat penguji aktual (kg) *" hint="Isi sesuai penimbangan nyata — tidak diisi otomatis"><NumInput testid="tester-weight" label="Berat penguji aktual (kg)" placeholder="mis. 75" value={draft.testerWeight} onChange={(v) => set({ testerWeight: v })} /></Field>
        <Field label="Penurunan kasur utuh (cm) *" hint="Boleh 0 bila tidak turun"><NumInput testid="whole-drop-input" label="Penurunan kasur utuh (cm)" placeholder="mis. 4" value={draft.wholeDrop} onChange={(v) => set({ wholeDrop: v })} /></Field>
      </div>
      <Field label="Titik / metode pengujian *"><input data-testid="test-method" aria-label="Titik atau metode pengujian" className={FIELD} maxLength={200} placeholder="Mis. duduk di tengah, lalu berbaring 1 menit" value={draft.testMethod} onChange={(e) => set({ testMethod: e.target.value })} /></Field>
      {after && <SameMethodCompare section="WHOLE_TEST_AFTER" draft={draft} set={set} measurements={measurements} />}
      <label className="flex min-h-[44px] items-center gap-2 rounded-btn bg-inset px-3 text-[14px] font-semibold text-ink"><input type="checkbox" data-testid="qc-in-frame" checked={draft.qcInFrame} onChange={(e) => set({ qcInFrame: e.target.checked })} /> Foto/video memperlihatkan PIC QC sedang menguji kasur *</label>
    </>
  );
}

function FoundationTestForm({ draft, set, after = false, measurements = null }) {
  const a = Number(String(draft.unloadedHeight).replace(",", ".")); const b = Number(String(draft.loadedHeight).replace(",", "."));
  const drop = draft.unloadedHeight !== "" && draft.loadedHeight !== "" && Number.isFinite(a) && Number.isFinite(b) && b <= a ? Math.round((a - b) * 100) / 100 : null;
  return (
    <>
      <Field label="Jenis / sistem fondasi *"><Select testid="foundation-system" label="Sistem fondasi" value={draft.system} onChange={(v) => set({ system: v })} options={FOUNDATION_SYSTEMS} placeholder="Pilih jenis fondasi" /></Field>
      <MaterialPicker value={draft.material} onChange={(m) => set({ material: m })} label="Bahan fondasi (opsional)" optional testid="foundation-material" />
      <div className="grid grid-cols-2 gap-2">
        <Field label="Tinggi tanpa beban (cm) *"><NumInput testid="unloaded-height" label="Tinggi tanpa beban (cm)" placeholder="mis. 25" value={draft.unloadedHeight} onChange={(v) => set({ unloadedHeight: v })} /></Field>
        <Field label="Tinggi saat dibebani (cm) *"><NumInput testid="loaded-height" label="Tinggi saat dibebani (cm)" placeholder="mis. 15" value={draft.loadedHeight} onChange={(v) => set({ loadedHeight: v })} /></Field>
      </div>
      <p className="m-0 rounded-btn bg-inset px-3 py-2 text-[13px] font-semibold text-ink" data-testid="drop-preview">Penurunan fondasi: {drop == null ? "Belum dicatat" : `${drop} cm`} <span className="font-normal text-ink3">(dihitung sistem: tanpa beban − dibebani; bukan dijumlahkan dengan uji kasur utuh)</span></p>
      <Field label="Berat penguji aktual (kg) *"><NumInput testid="tester-weight" label="Berat penguji aktual (kg)" placeholder="mis. 75" value={draft.testerWeight} onChange={(v) => set({ testerWeight: v })} /></Field>
      <Field label="Titik / metode pengujian *"><input data-testid="test-method" aria-label="Titik atau metode pengujian" className={FIELD} maxLength={200} placeholder="Mis. beban di tengah rangka, diukur di empat sudut" value={draft.testMethod} onChange={(e) => set({ testMethod: e.target.value })} /></Field>
      {after && <SameMethodCompare section="FOUNDATION_TEST_AFTER" draft={draft} set={set} measurements={measurements} />}
    </>
  );
}

function FoundationBeforeForm({ draft, set }) {
  return (
    <>
      <Field label="Jenis / sistem fondasi *"><Select testid="foundation-system" label="Sistem fondasi" value={draft.system} onChange={(v) => set({ system: v })} options={FOUNDATION_SYSTEMS} placeholder="Pilih jenis fondasi" /></Field>
      <MaterialPicker value={draft.material} onChange={(m) => set({ material: m })} label="Bahan fondasi" optional testid="foundation-material" />
      <Field label="Kondisi *"><Select testid="foundation-condition" label="Kondisi fondasi" value={draft.condition} onChange={(v) => set({ condition: v })} options={CONDITIONS} placeholder="Pilih kondisi" /></Field>
    </>
  );
}

function AfterForm({ draft, set, beforeCount, beforeLayers = [], planned = false, plan = null }) {
  const deviations = !planned && plan ? draftDeviations(draft, plan) : [];
  const upd = (id, patch) => set({ layers: draft.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)) });
  const move = (i, d) => { const j = i + d; if (j < 0 || j >= draft.layers.length) return; const next = [...draft.layers]; [next[i], next[j]] = [next[j], next[i]]; set({ layers: next }); };
  const f = draft.foundation;
  const setF = (patch) => set({ foundation: { ...f, ...patch } });
  return (
    <>
      {!planned && plan && <button type="button" data-testid="copy-plan" onClick={() => set(draftFromPlan(plan, draft))} className="min-h-[48px] w-full rounded-btn bg-accentbg px-3 text-[13.5px] font-semibold text-accent">Isi dari racikan rencana (bisa diubah)</button>}
      {!planned && draft.suggestions && (draft.suggestions.foundation?.length > 0 || draft.suggestions.layers?.length > 0) && (
        <button type="button" data-testid="use-suggestions" onClick={() => set(applySuggestions(draft, draft.suggestions))} className="min-h-[48px] w-full rounded-btn bg-accentbg px-3 text-[13.5px] font-semibold text-accent">Isi dari bahan terpakai di tahap pengerjaan (bisa diubah)</button>
      )}
      <label className="flex min-h-[44px] items-center gap-2 rounded-btn bg-inset px-3 text-[14px] font-semibold text-ink"><input type="checkbox" data-testid="foundation-on" checked={draft.foundationOn} onChange={(e) => set({ foundationOn: e.target.checked })} /> Catat fondasi</label>
      {draft.foundationOn && (
        <div className="space-y-3 rounded-card border border-line p-3" data-testid="after-foundation">
          <p className="m-0 text-[14px] font-bold text-ink">Fondasi</p>
          <Chips options={ACTIONS} value={f.action} onChange={(v) => setF({ action: v })} label="Tindakan fondasi" testid="foundation-action" />
          {f.action && f.action !== "KEEP" && <Field label={f.action === "REPLACE" ? "Jenis fondasi baru *" : "Jenis fondasi"}><Select testid="after-foundation-system" label="Jenis fondasi hasil" value={f.system} onChange={(v) => setF({ system: v })} options={FOUNDATION_SYSTEMS} placeholder="Pilih jenis fondasi" /></Field>}
          {f.action && f.action !== "KEEP" && <MaterialPicker value={f.material} onChange={(m) => setF({ material: m })} label="Bahan fondasi hasil" optional testid="after-foundation-material" />}
          <Note value={f.note} onChange={(v) => setF({ note: v })} testid="after-foundation-note" />
        </div>
      )}
      <p className="m-0 text-[13px] font-bold text-ink">{planned ? "Lapisan rencana (dari atas ke bawah)" : "Lapisan hasil akhir (dari atas ke bawah)"}</p>
      <p className="m-0 rounded-btn bg-inset px-3 py-2 text-[13px] font-semibold text-ink" data-testid={planned ? "plan-total-preview" : "after-total-preview"}>{summarizeResultDraft(draft, beforeLayers).text}</p>
      {draft.layers.map((l, i) => (
        <div key={l.id} data-testid="after-layer-row" className="space-y-3 rounded-card border border-line p-3">
          <div className="flex items-center justify-between"><p className="m-0 text-[14px] font-bold text-ink">Lapisan {i + 1}</p>
            <div className="flex gap-1">
              <button type="button" aria-label="Naikkan" onClick={() => move(i, -1)} className="flex h-11 w-11 items-center justify-center rounded-btn text-ink2"><ArrowUp size={16} aria-hidden /></button>
              <button type="button" aria-label="Turunkan" onClick={() => move(i, 1)} className="flex h-11 w-11 items-center justify-center rounded-btn text-ink2"><ArrowDown size={16} aria-hidden /></button>
              <button type="button" aria-label={`Hapus lapisan ${i + 1}`} onClick={() => set({ layers: draft.layers.filter((x) => x.id !== l.id) })} className="flex h-11 w-11 items-center justify-center rounded-btn text-red"><Trash2 size={16} aria-hidden /></button></div></div>
          <Chips options={ACTIONS} value={l.action} onChange={(v) => upd(l.id, { action: v })} label={`Tindakan lapisan ${i + 1}`} testid="layer-action" />
          {beforeCount > 0 && (
            <Field label="Merujuk lapisan lama" hint="Kosongkan = urutan yang sama">
              <select data-testid="from-order" aria-label="Lapisan lama yang dirujuk" className={FIELD} value={l.fromOrder} onChange={(e) => upd(l.id, { fromOrder: e.target.value })}>
                <option value="">Urutan yang sama</option>{Array.from({ length: beforeCount }, (_, k) => <option key={k + 1} value={k + 1}>Lapisan lama {k + 1}</option>)}
              </select></Field>
          )}
          {l.action && <MaterialPicker value={l.material} onChange={(m) => upd(l.id, { material: m })} label={l.action === "KEEP" ? "Bahan (jika perlu dicatat)" : "Bahan hasil"} optional={l.action === "KEEP"} />}
          <Field label="Ketebalan (cm)" hint="Kosongkan bila tidak diketahui"><Thickness value={l.thickness} onChange={(v) => upd(l.id, { thickness: v })} /></Field>
          <Note value={l.note} onChange={(v) => upd(l.id, { note: v })} testid="after-layer-note" />
        </div>
      ))}
      {!planned && plan && (
        <div className="space-y-1.5" data-testid="deviation-block" data-deviations={deviations.length}>
          {deviations.length > 0 ? <p role="status" className="m-0 rounded-btn bg-orangebg px-3 py-2 text-[13px] text-orange" data-testid="deviation-warning">Berbeda dari rencana: {deviations.join(", ")}. Alasan perbedaan wajib diisi dan tercatat di versi ini; rencana tidak ditimpa.</p> : <p className="m-0 text-[12.5px] text-ink3" data-testid="deviation-none">Sesuai rencana (atau bagian yang belum diisi tidak dihitung berbeda).</p>}
          <Field label={deviations.length ? "Alasan perbedaan dari rencana *" : "Catatan perbedaan dari rencana (opsional)"}><textarea data-testid="deviation-note" aria-label="Alasan perbedaan dari rencana" rows={2} maxLength={500} className={FIELD} placeholder="Mis. stok busa D44 5 cm habis, dipakai 4 cm" value={draft.deviationNote || ""} onChange={(e) => set({ deviationNote: e.target.value })} /></Field>
        </div>
      )}
      {draft.layers.length < MAX_LAYERS && <button type="button" data-testid="add-after-layer" onClick={() => set({ layers: [...draft.layers, emptyLayerAfter()] })} className="flex min-h-[48px] w-full items-center justify-center gap-1.5 rounded-btn bg-accentbg text-[14px] font-semibold text-accent"><Plus size={16} aria-hidden /> Tambah lapisan hasil</button>}
    </>
  );
}

export function ComponentNoteSheet({ unitId, unitCode, section, entry, suggestions, beforeCount = 0, beforeLayers = [], salesContext = null, analysis = null, measurements = null, plan = null, onClose, onSaved, onReload }) {
  const online = useOnline();
  const meta = SECTION_BY_KEY[section];
  const keyRef = useRef(newKey("s3-comp"));
  const [draft, setDraftState] = useState(() => (section === "AFTER" ? draftFromEntry(section, entry, suggestions) : draftFromEntry(section, entry)));
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [conflict, setConflict] = useState(false);
  // Galat validasi lama dibersihkan begitu isian berubah (QA klik nyata: pesan "Pilih kesesuaian…" bertahan walau sudah dipilih); banner konflik versi tetap sampai dimuat ulang.
  const set = (patch) => { setDraftState((d) => ({ ...d, ...patch })); keyRef.current = newKey("s3-comp"); if (!conflict) setError(""); };
  const correcting = !!entry;
  const uploading = hasPendingUploads(draft);
  const problem = validateDraft(section, draft, { correcting, plan });

  async function save() {
    const bad = validateDraft(section, draft, { correcting, plan });
    if (bad) { setError(bad); return; }
    setBusy(true); setError("");
    try {
      const res = await api.saveComponentNote(unitId, section, { expectedVersion: entry?.version ?? 0, data: payloadFromDraft(section, draft), media: mediaPayload(draft, section), reason: correcting ? draft.reason.trim() : undefined }, keyRef.current);
      onSaved(res);
    } catch (e) {
      if (e?.code === "COMPONENT_VERSION_CONFLICT") setConflict(true);
      setError(friendlyComponentError(e));
    } finally { setBusy(false); }
  }
  const setMedia = (fn) => setDraftState((d) => ({ ...d, media: fn(d.media) }));
  return (
    <Sheet title={meta.label} subtitle={`${unitCode || "Unit"}${correcting ? ` · koreksi versi ${entry.version}` : ""}`} onClose={onClose}
      footer={<>
        {!online && <p role="status" className="m-0 flex items-start gap-2 rounded-btn bg-orangebg px-3 py-2 text-[12.5px] font-semibold text-orange"><WifiOff size={15} className="mt-px shrink-0" aria-hidden /> Tidak ada koneksi — simpan dinonaktifkan sampai tersambung.</p>}
        {error && <div role="alert" data-testid="component-error" className="rounded-btn bg-redbg px-3 py-2 text-[13px] text-red">{error}{conflict && <button type="button" data-testid="component-reload" onClick={onReload} className="ml-2 font-bold underline">Muat versi terbaru</button>}</div>}
        <button type="button" data-mutates data-testid="component-save" disabled={busy || !online || uploading} onClick={save} className="flex min-h-[56px] w-full items-center justify-center gap-2 rounded-btn bg-accent text-[16px] font-bold text-white disabled:opacity-50">
          {busy ? <Loader2 size={20} className="animate-spin" aria-hidden /> : null}{uploading ? "Menunggu foto terunggah…" : correcting ? "Simpan koreksi" : "Simpan catatan"}
        </button>
      </>}>
      <p className="m-0 rounded-btn bg-inset px-3 py-2 text-[12.5px] text-ink3">Catatan ini hanya informasi — tidak memotong stok dan bukan daftar bahan/pemakaian. “Tidak diketahui” boleh dipilih bila memang belum jelas — jangan menebak.</p>
      {section === "LAYERS_BEFORE" && <LayersBeforeForm draft={draft} set={set} />}
      {section === "FOUNDATION_BEFORE" && <FoundationBeforeForm draft={draft} set={set} />}
      {section === "WHOLE_TEST_BEFORE" && <WholeTestForm draft={draft} set={set} salesContext={salesContext} />}
      {section === "FOUNDATION_TEST_BEFORE" && <FoundationTestForm draft={draft} set={set} />}
      {(section === "WHOLE_TEST_AFTER" || section === "FOUNDATION_TEST_AFTER") && analysis && <JourneySummary data={analysis} compact />}
      {section === "WHOLE_TEST_AFTER" && <WholeTestForm draft={draft} set={set} salesContext={salesContext} after measurements={measurements} />}
      {section === "FOUNDATION_TEST_AFTER" && <FoundationTestForm draft={draft} set={set} after measurements={measurements} />}
      {section === "PLAN_RACIKAN" && (
        <>
          {analysis ? <AnalysisContext data={analysis} /> : <SalesContextBox ctx={salesContext} />}
          <p className="m-0 rounded-btn bg-accentbg px-3 py-2 text-[13px] text-accent" data-testid="plan-note">Racikan RENCANA: tentukan apa yang dipertahankan, diperbaiki, atau diganti. Hasil aktual dicatat terpisah di “Sesudah pengerjaan”. Merencanakan tidak memotong stok dan bukan BOM.</p>
          <AfterForm draft={draft} set={set} beforeCount={beforeCount} beforeLayers={beforeLayers} planned />
        </>
      )}
      {section === "AFTER" && <AfterForm draft={draft} set={set} beforeCount={beforeCount} beforeLayers={beforeLayers} plan={plan} />}
      <Field label="Catatan umum"><Note value={draft.note} onChange={(v) => set({ note: v })} placeholder="Catatan umum (opsional)" /></Field>
      <div className="space-y-2" data-testid="component-photos">
        <p className="m-0 text-[13px] font-semibold text-ink2" data-testid="media-heading">{minMediaFor(section) ? "Foto/video (wajib minimal 1" : section === "LAYERS_BEFORE" ? "Foto/video isi kasur yang ditemukan (disarankan; tampil ke customer" : "Foto (opsional"}, maksimal {maxMediaFor(section)})</p>
        <EvidenceCapture runId={unitId} items={draft.media} onChange={setMedia} rule={{ min: minMediaFor(section), video: false }} imagesOnly={!(minMediaFor(section) || section === "LAYERS_BEFORE")} withCaption
          uploadFile={(_runId, file, onProgress) => api.uploadComponentNoteMedia(unitId, [file], onProgress)} />
        {section === "LAYERS_BEFORE" && !draft.layersUnknown && draft.layers.length > 0 && draft.media.filter((m) => m.status === "done").length > 0 && (
          <ul className="m-0 list-none space-y-2 p-0" data-testid="media-layer-links">
            {draft.media.filter((m) => m.status === "done").map((m, i) => (
              <li key={m.id} className="flex items-center gap-2 text-[12.5px] text-ink2">
                <span className="shrink-0">{m.kind === "video" ? "Video" : "Foto"} {i + 1} →</span>
                <select data-testid="media-layer-select" aria-label={`Lapisan terkait ${m.kind === "video" ? "video" : "foto"} ${i + 1}`} className={FIELD} value={m.layerRowId || ""} onChange={(e) => setMedia((list) => list.map((x) => (x.id === m.id ? { ...x, layerRowId: e.target.value || null } : x)))}>
                  <option value="">Umum (isi kasur secara keseluruhan)</option>
                  {draft.layers.map((l, k) => <option key={l.id} value={l.id}>Lapisan {k + 1}</option>)}
                </select>
              </li>
            ))}
          </ul>
        )}
      </div>
      {correcting && <Field label="Alasan koreksi *"><textarea data-testid="component-reason" rows={2} maxLength={300} className={FIELD} placeholder="Kenapa catatan ini diubah?" value={draft.reason} onChange={(e) => setDraftState((d) => ({ ...d, reason: e.target.value }))} /></Field>}
      {problem && <p data-testid="component-hint" className="m-0 text-[12.5px] text-ink3">{problem}</p>}
    </Sheet>
  );
}
