import React, { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, Loader2, Search, X } from "lucide-react";
import { api } from "@/api.js";
import { EvidenceCapture } from "@/features/production/components/EvidenceCapture.jsx";
import { friendlyError } from "@/features/production/experience.js";

// P9D — Diagnosis Produksi + Planned BOM Terpadu. SATU wizard dipakai dari DUA tempat (Aplikasi Meja tahap 5
// via WorkerLane.jsx, DAN Unit 360 via "Isi Diagnosis") — bukan halaman terpisah. Draft disimpan lokal per
// section-switch (localStorage, pola sama dengan loadDraft/saveDraft WorkerLane) SUPAYA tidak hilang saat
// operator pindah section; simpan-ke-server (draft resmi, dgn revision) dipicu manual lewat tombol "Simpan
// Draft" di section terakhir — bukan tiap keystroke, supaya tidak membebani server/tidak memicu banyak konflik
// revisi dari sesi yang sama.
const DAMAGE_LEVELS = [["RINGAN", "Ringan"], ["SEDANG", "Sedang"], ["BERAT", "Berat"]];
const FOUNDATION_ACTIONS = [["KEEP", "Dipertahankan"], ["REINFORCE", "Diperkuat"], ["REPLACE", "Diganti"]];
const LAYER_ACTIONS = [["KEEP", "Dipertahankan"], ["REMOVE", "Dilepas"], ["REPLACE", "Diganti"]];
const SECTIONS = [
  ["sales", "Informasi Sales"], ["teardown", "Hasil Bongkar"], ["foundation", "Fondasi"],
  ["layers", "Lapisan & Komponen"], ["materials", "Bahan"], ["review", "Review & Simpan"],
];
const draftKey = (runId) => `p9d-diagnosis-draft:${runId}`;

function loadLocalDraft(runId) {
  try { const raw = localStorage.getItem(draftKey(runId)); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
export function hasLocalDraft(runId) { return !!runId && loadLocalDraft(runId) !== null; }
// Label tombol pembuka wizard (Unit 360): sudah dikirim → revisi; ada draft lokal → lanjutkan; selain itu → isi baru.
export function diagnosisCtaLabel({ status, hasDraft }) {
  if (status === "RECORDED") return "Revisi Diagnosis";
  return hasDraft ? "Lanjutkan Diagnosis" : "Isi Diagnosis";
}
function saveLocalDraft(runId, data) {
  try { localStorage.setItem(draftKey(runId), JSON.stringify(data)); } catch { /* penyimpanan lokal penuh/diblokir — abaikan, bukan fatal */ }
}
function clearLocalDraft(runId) {
  try { localStorage.removeItem(draftKey(runId)); } catch { /* no-op */ }
}

function emptyFindings() {
  return {
    general: { condition: "", mainDamage: "", damageLevel: "", teardownNote: "" },
    foundation: { oldCondition: "", action: "", size: "", qty: "", note: "" },
    layers: [],
    components: { spring: "", cover: "", quilting: "", glue: "", wood: "", other: [] },
    serviceNote: "",
  };
}

function Field({ label, children, hint }) {
  return (
    <div className="space-y-1">
      <label className="block text-[13px] font-semibold text-ink2">{label}</label>
      {children}
      {hint && <p className="m-0 text-[11.5px] text-ink3">{hint}</p>}
    </div>
  );
}
const inputCls = "block w-full min-h-[44px] rounded-btn border border-line bg-surface px-3 py-2.5 text-[15px] text-ink";
const textareaCls = `${inputCls} min-h-[88px] resize-y`;

function ChipPicker({ options, value, onChange, label }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {options.map(([v, l]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)}
          className={`min-h-[44px] rounded-btn px-3.5 text-[13.5px] font-semibold ${value === v ? "bg-accent text-white" : "bg-inset text-ink2"}`}>
          {l}
        </button>
      ))}
    </div>
  );
}

// CATATAN: belum ada field kanonis "Layanan Pesanan Sales" yang terpisah dari Unit.serviceId (gap yang sama
// sudah ditandai NEEDS_OWNER_CONFIRMATION sejak audit Unit 360/P9C) — ditampilkan di sini APA ADANYA lewat
// kategori/lini pesanan Order (card.customer.category), BUKAN ditebak jadi nama layanan yang tidak ada sumbernya.
function SalesSection({ card }) {
  const c = card.customer || {};
  return (
    <div className="space-y-3">
      <p className="rounded-btn bg-accentbg px-3 py-2 text-[13px] text-accent">Data ini milik Sales, hanya untuk referensi — Production tidak dapat mengubahnya di sini.</p>
      <dl className="m-0 grid grid-cols-1 gap-2 text-[13px] sm:grid-cols-2">
        <div className="min-w-0 rounded-btn bg-inset px-3 py-2"><dt className="m-0 text-ink3">Kategori pesanan (Sales)</dt><dd className="m-0 break-words font-semibold text-ink">{c.category || "Belum dicatat"}</dd></div>
        <div className="min-w-0 rounded-btn bg-inset px-3 py-2"><dt className="m-0 text-ink3">Berat badan</dt><dd className="m-0 break-words font-semibold text-ink">{c.weightKg ? `${c.weightKg} kg` : "Belum dicatat"}</dd></div>
        <div className="min-w-0 rounded-btn bg-inset px-3 py-2 sm:col-span-2"><dt className="m-0 text-ink3">Keluhan customer</dt><dd className="m-0 break-words font-semibold text-ink">{c.complaints?.length ? c.complaints.join(", ") : "Belum dicatat"}</dd></div>
        {c.request && <div className="min-w-0 rounded-btn bg-inset px-3 py-2 sm:col-span-2"><dt className="m-0 text-ink3">Request customer</dt><dd className="m-0 break-words font-semibold text-ink">{c.request}</dd></div>}
      </dl>
    </div>
  );
}

function TeardownSection({ findings, setFindings, media, setMedia, runId }) {
  const g = findings.general;
  const set = (patch) => setFindings((f) => ({ ...f, general: { ...f.general, ...patch } }));
  return (
    <div className="space-y-4">
      <Field label="Kondisi kasur *"><textarea className={textareaCls} value={g.condition} onChange={(e) => set({ condition: e.target.value })} placeholder="Deskripsikan kondisi kasur secara umum" /></Field>
      <Field label="Kerusakan utama *"><textarea className={textareaCls} value={g.mainDamage} onChange={(e) => set({ mainDamage: e.target.value })} placeholder="Kerusakan paling signifikan yang ditemukan" /></Field>
      <Field label="Tingkat kerusakan *"><ChipPicker options={DAMAGE_LEVELS} value={g.damageLevel} onChange={(v) => set({ damageLevel: v })} label="Tingkat kerusakan" /></Field>
      <Field label="Catatan hasil bongkar"><textarea className={textareaCls} value={g.teardownNote} onChange={(e) => set({ teardownNote: e.target.value })} placeholder="Catatan tambahan (opsional)" /></Field>
      <Field label="Foto/video diagnosis *" hint="Wajib minimal 1 foto/video hasil bongkar."><EvidenceCapture runId={runId} items={media} onChange={setMedia} rule={{ min: 1, video: false }} /></Field>
    </div>
  );
}

function FoundationSection({ findings, setFindings }) {
  const f = findings.foundation;
  const set = (patch) => setFindings((s) => ({ ...s, foundation: { ...s.foundation, ...patch } }));
  return (
    <div className="space-y-4">
      <Field label="Kondisi fondasi lama"><textarea className={textareaCls} value={f.oldCondition} onChange={(e) => set({ oldCondition: e.target.value })} /></Field>
      <Field label="Tindakan *"><ChipPicker options={FOUNDATION_ACTIONS} value={f.action} onChange={(v) => set({ action: v })} label="Tindakan fondasi" /></Field>
      {f.action === "REPLACE" && (
        <>
          <Field label="Ukuran"><input className={inputCls} value={f.size} onChange={(e) => set({ size: e.target.value })} placeholder="mis. 180x200 cm" /></Field>
          <Field label="Jumlah"><input inputMode="decimal" className={inputCls} value={f.qty} onChange={(e) => set({ qty: e.target.value })} /></Field>
        </>
      )}
      <Field label="Catatan"><textarea className={textareaCls} value={f.note} onChange={(e) => set({ note: e.target.value })} /></Field>
    </div>
  );
}

function LayerRow({ layer, onChange, onRemove, index }) {
  const set = (patch) => onChange({ ...layer, ...patch });
  return (
    <div className="space-y-2 rounded-btn border border-line p-3">
      <div className="flex items-center justify-between"><p className="m-0 text-[13px] font-bold text-ink">Lapisan #{index + 1}</p><button type="button" onClick={onRemove} className="flex min-h-[44px] items-center px-2 text-[12.5px] font-semibold text-red">Hapus</button></div>
      <Field label="Kondisi lama"><textarea className={textareaCls} value={layer.oldCondition} onChange={(e) => set({ oldCondition: e.target.value })} /></Field>
      <Field label="Tindakan"><ChipPicker options={LAYER_ACTIONS} value={layer.action} onChange={(v) => set({ action: v })} label={`Tindakan lapisan ${index + 1}`} /></Field>
      {layer.action === "REPLACE" && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Material"><input className={inputCls} value={layer.material} onChange={(e) => set({ material: e.target.value })} /></Field>
          <Field label="Ketebalan"><input className={inputCls} value={layer.thickness} onChange={(e) => set({ thickness: e.target.value })} /></Field>
          <Field label="Density"><input className={inputCls} value={layer.density} onChange={(e) => set({ density: e.target.value })} /></Field>
          <Field label="Jumlah"><input inputMode="decimal" className={inputCls} value={layer.qty} onChange={(e) => set({ qty: e.target.value })} /></Field>
        </div>
      )}
      <Field label="Catatan"><textarea className={textareaCls} value={layer.note} onChange={(e) => set({ note: e.target.value })} /></Field>
    </div>
  );
}

function LayersSection({ findings, setFindings }) {
  const layers = findings.layers;
  const comp = findings.components;
  const setLayers = (next) => setFindings((s) => ({ ...s, layers: next }));
  const setComp = (patch) => setFindings((s) => ({ ...s, components: { ...s.components, ...patch } }));
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {layers.map((l, i) => <LayerRow key={i} layer={l} index={i} onChange={(v) => setLayers(layers.map((x, xi) => (xi === i ? v : x)))} onRemove={() => setLayers(layers.filter((_, xi) => xi !== i))} />)}
        <button type="button" onClick={() => setLayers([...layers, { oldCondition: "", action: "", material: "", thickness: "", density: "", qty: "", note: "" }])}
          className="min-h-[44px] w-full rounded-btn bg-accentbg text-[13.5px] font-semibold text-accent">+ Tambah lapisan</button>
      </div>
      <div className="space-y-3 rounded-btn border border-line p-3">
        <p className="m-0 text-[13px] font-bold text-ink">Komponen lain</p>
        {["spring", "cover", "quilting", "glue", "wood"].map((k) => (
          <Field key={k} label={{ spring: "Per/spring", cover: "Kain/cover", quilting: "Quilting", glue: "Lem", wood: "Kayu" }[k]}>
            <input className={inputCls} value={comp[k]} onChange={(e) => setComp({ [k]: e.target.value })} />
          </Field>
        ))}
      </div>
    </div>
  );
}

function MaterialsSection({ bomLines, setBomLines, manualMaterials, setManualMaterials }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults([]); return undefined; }
    setSearching(true);
    const t = setTimeout(() => {
      api.searchProductionV2Materials(q).then((r) => setResults(r.items || [])).catch(() => setResults([])).finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  function addCatalog(material) {
    if (bomLines.some((l) => l.materialId === material.id)) return;
    setBomLines([...bomLines, { materialId: material.id, code: material.code, name: material.name, unit: material.unit, onHandQty: material.onHandQty, qty: "" }]);
    setQuery(""); setResults([]);
  }
  function updateQty(materialId, qty) { setBomLines(bomLines.map((l) => (l.materialId === materialId ? { ...l, qty } : l))); }
  function removeCatalog(materialId) { setBomLines(bomLines.filter((l) => l.materialId !== materialId)); }

  function addManual() { setManualMaterials([...manualMaterials, { description: "", estimatedUnit: "", qty: "", reason: "" }]); }
  function updateManual(i, patch) { setManualMaterials(manualMaterials.map((m, xi) => (xi === i ? { ...m, ...patch } : m))); }
  function removeManual(i) { setManualMaterials(manualMaterials.filter((_, xi) => xi !== i)); }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="m-0 text-[13px] font-bold text-ink">Bahan dari katalog</p>
        <div className="relative">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink3" aria-hidden />
          <input className={`${inputCls} pl-9`} placeholder="Cari kode/nama bahan…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Cari bahan katalog" />
        </div>
        {searching && <p data-testid="catalog-searching" className="m-0 text-[12px] text-ink3">Mencari…</p>}
        {results.length > 0 && (
          <ul data-testid="catalog-search-results" className="m-0 list-none space-y-1 rounded-btn border border-line p-1">
            {results.map((m) => (
              <li key={m.id}>
                <button type="button" data-material-code={m.code} onClick={() => addCatalog(m)} className="flex min-h-[44px] w-full items-center justify-between rounded-btn px-2 text-left hover:bg-hovertint">
                  <span className="min-w-0"><span className="block truncate text-[13.5px] font-semibold text-ink">{m.name}</span><span className="text-[11.5px] text-ink3">{m.code} · stok {m.onHandQty} {m.unit}</span></span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <ul className="m-0 list-none space-y-2 p-0">
          {bomLines.map((l) => (
            <li key={l.materialId} data-testid="bom-row" data-material-code={l.code} className="flex items-center gap-2 rounded-btn bg-inset px-3 py-2">
              <div className="min-w-0 flex-1"><p className="m-0 truncate text-[13.5px] font-semibold text-ink">{l.name}</p><p className="m-0 text-[11.5px] text-ink3">{l.code} · stok {l.onHandQty} {l.unit}</p></div>
              <input inputMode="decimal" className="h-11 w-20 rounded-btn border border-line bg-surface text-center text-[14px]" placeholder="Qty" value={l.qty} onChange={(e) => updateQty(l.materialId, e.target.value)} aria-label={`Jumlah ${l.name}`} />
              <button type="button" onClick={() => removeCatalog(l.materialId)} aria-label={`Hapus ${l.name}`} className="flex min-h-[44px] min-w-[44px] items-center justify-center text-red"><X size={16} aria-hidden /></button>
            </li>
          ))}
        </ul>
      </div>
      <div className="space-y-2 rounded-btn border border-line p-3">
        <p className="m-0 text-[13px] font-bold text-ink">Bahan belum terdaftar (manual)</p>
        <p className="m-0 text-[11.5px] text-ink3">Tidak dipotong stok/direservasi — Production Lead akan memetakannya ke katalog nanti.</p>
        {manualMaterials.map((m, i) => (
          <div key={i} data-testid="manual-row" className="space-y-2 rounded-btn bg-inset p-2">
            <div className="flex items-center justify-between"><p className="m-0 text-[12px] font-semibold text-ink3">Bahan manual #{i + 1}</p><button type="button" onClick={() => removeManual(i)} className="min-h-[44px] px-2 text-[12px] font-semibold text-red">Hapus</button></div>
            <input className={inputCls} placeholder="Nama/deskripsi bahan" value={m.description} onChange={(e) => updateManual(i, { description: e.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <input className={inputCls} placeholder="Satuan (mis. meter)" value={m.estimatedUnit} onChange={(e) => updateManual(i, { estimatedUnit: e.target.value })} />
              <input inputMode="decimal" className={inputCls} placeholder="Jumlah" value={m.qty} onChange={(e) => updateManual(i, { qty: e.target.value })} />
            </div>
            <textarea className={textareaCls} placeholder="Kenapa tidak ada di katalog?" value={m.reason} onChange={(e) => updateManual(i, { reason: e.target.value })} />
          </div>
        ))}
        <button type="button" onClick={addManual} className="min-h-[44px] w-full rounded-btn bg-accentbg text-[13.5px] font-semibold text-accent">+ Tambah bahan manual</button>
      </div>
    </div>
  );
}

function ReviewSection({ findings, setFindings, services, recommendedServiceId, setRecommendedServiceId, priorServiceLabel, bomLines, manualMaterials }) {
  const differs = priorServiceLabel && recommendedServiceId && services.find((s) => s.id === recommendedServiceId)?.labelId !== priorServiceLabel;
  return (
    <div className="space-y-4">
      <Field label="Layanan teknis *" hint="Ditetapkan Production berdasarkan hasil diagnosa — boleh berbeda dari layanan pesanan Sales.">
        <select className={inputCls} value={recommendedServiceId || ""} onChange={(e) => setRecommendedServiceId(e.target.value)}>
          <option value="">— Pilih layanan teknis —</option>
          {services.map((s) => <option key={s.id} value={s.id}>{s.labelId}</option>)}
        </select>
      </Field>
      {differs && <p className="flex items-center gap-1.5 rounded-btn bg-orangebg px-3 py-2 text-[12.5px] text-orange"><AlertTriangle size={13} aria-hidden /> Layanan teknis berbeda dari yang tercatat sebelumnya ({priorServiceLabel}). Order/harga Sales TIDAK berubah.</p>}
      <Field label="Kesimpulan diagnosis *" hint="Rangkuman hasil diagnosa untuk unit ini — dipakai sebagai catatan resmi tahap Diagnosa.">
        <textarea className={textareaCls} value={findings.serviceNote} onChange={(e) => setFindings((f) => ({ ...f, serviceNote: e.target.value }))} placeholder="mis. Fondasi diganti karena keropos, lapisan atas diperkuat sesuai keluhan sakit pinggang" />
      </Field>
      <div className="rounded-btn bg-inset p-3 text-[12.5px] text-ink2">
        <p className="m-0 font-semibold text-ink">Ringkasan</p>
        <p className="m-0">{bomLines.length} bahan katalog · {manualMaterials.length} bahan manual{manualMaterials.length ? " (perlu dipetakan Production Lead)" : ""}</p>
      </div>
    </div>
  );
}

export function DiagnosisWizard({ card, onClose, onSubmitted }) {
  const runId = card.runId;
  const local = useMemo(() => loadLocalDraft(runId), [runId]);
  const [section, setSection] = useState(0);
  const [findings, setFindings] = useState(() => local?.findings || emptyFindings());
  const [media, setMedia] = useState(() => (local?.media || []).filter((m) => m.status === "done"));
  const [bomLines, setBomLines] = useState(() => local?.bomLines || []);
  const [manualMaterials, setManualMaterials] = useState(() => local?.manualMaterials || []);
  const [recommendedServiceId, setRecommendedServiceId] = useState(() => local?.recommendedServiceId || null);
  const [services, setServices] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // "Ada perubahan belum terkirim" hanya dibaca saat menutup — BUKAN state render. Sebelumnya
  // sebuah efek yang men-set state `dirty` pada tiap perubahan form: tiap ketukan = satu commit yang efek pasifnya
  // menjadwalkan update state → React menghitung commit beruntun dan setelah >50 ketukan berturut-turut
  // memunculkan "Maximum update depth exceeded" (terbukti lewat stack: dispatchSetState <- updateManual <- onChange).
  // Ref tidak memicu render sama sekali; efek pertama (mount) dilewati supaya draft yang baru dibuka belum dianggap berubah.
  const dirtyRef = useRef(false);
  const mountedRef = useRef(false);

  useEffect(() => { api.getServiceCatalog().then((d) => setServices(Array.isArray(d?.services) ? d.services : [])).catch(() => setServices([])); }, []);
  useEffect(() => {
    if (!mountedRef.current) { mountedRef.current = true; return; }
    dirtyRef.current = true;
  }, [findings, media, bomLines, manualMaterials, recommendedServiceId]);
  useEffect(() => {
    const t = setTimeout(() => saveLocalDraft(runId, { findings, media: media.filter((m) => m.status === "done"), bomLines, manualMaterials, recommendedServiceId }), 400);
    return () => clearTimeout(t);
  }, [runId, findings, media, bomLines, manualMaterials, recommendedServiceId]);

  function requestClose() {
    if (dirtyRef.current && !window.confirm("Diagnosis belum dikirim — draft tersimpan di perangkat ini. Tutup sekarang?")) return;
    onClose();
  }

  function buildFindingsPayload() {
    return { ...findings, serviceNote: findings.serviceNote || `${findings.general.mainDamage || ""}${findings.general.damageLevel ? ` (${findings.general.damageLevel})` : ""}`.trim() || "Diagnosis dikirim dari Aplikasi Meja" };
  }

  async function submit() {
    setBusy(true); setError("");
    try {
      const photoUrls = media.filter((m) => m.status === "done").map((m) => m.url);
      const res = await api.submitProductionV2Diagnosis(runId, {
        expectedRevision: card.diagnosisRevision ?? 0, workCenterId: card.workCenterId,
        findings: buildFindingsPayload(), photoUrls, recommendedServiceId,
        materials: bomLines.filter((l) => Number(l.qty) > 0).map((l) => ({ materialId: l.materialId, qty: Number(l.qty) })),
        manualMaterials: manualMaterials.filter((m) => m.description?.trim()).map((m) => ({ description: m.description, estimatedUnit: m.estimatedUnit || null, qty: Number(m.qty), reason: m.reason })),
      });
      clearLocalDraft(runId);
      onSubmitted(res);
    } catch (e) { setError(friendlyError(e)); } finally { setBusy(false); }
  }

  const key = SECTIONS[section][0];
  const priorServiceLabel = card.priorServiceLabel;

  return (
    <div role="dialog" aria-modal="true" aria-label="Isi Diagnosis" className="fixed inset-0 z-[210] flex flex-col bg-base">
      <div className="flex items-center gap-2 border-b border-line bg-surface px-3 py-2" style={{ paddingTop: "calc(0.5rem + env(safe-area-inset-top))" }}>
        <button type="button" onClick={requestClose} aria-label="Tutup" className="flex h-11 w-11 items-center justify-center rounded-btn text-ink2 hover:bg-hovertint"><X size={20} aria-hidden /></button>
        <div className="min-w-0 flex-1"><h2 className="m-0 text-[12px] font-normal text-ink3">Isi Diagnosis · {card.unitCode}</h2><p className="m-0 truncate text-[16px] font-bold text-ink">{SECTIONS[section][1]}</p></div>
      </div>
      <div role="tablist" aria-label="Bagian diagnosis" className="flex shrink-0 gap-1 overflow-x-auto border-b border-line bg-surface px-2 py-1.5">
        {SECTIONS.map(([k, l], i) => (
          <button key={k} type="button" role="tab" aria-selected={section === i} onClick={() => setSection(i)}
            className={`min-h-[44px] shrink-0 whitespace-nowrap rounded-btn px-3 text-[12.5px] font-semibold ${section === i ? "bg-accent text-white" : "bg-inset text-ink3"}`}>
            {i + 1}. {l}
          </button>
        ))}
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto px-3 py-4">
        {key === "sales" && <SalesSection card={card} />}
        {key === "teardown" && <TeardownSection findings={findings} setFindings={setFindings} media={media} setMedia={setMedia} runId={runId} />}
        {key === "foundation" && <FoundationSection findings={findings} setFindings={setFindings} />}
        {key === "layers" && <LayersSection findings={findings} setFindings={setFindings} />}
        {key === "materials" && <MaterialsSection bomLines={bomLines} setBomLines={setBomLines} manualMaterials={manualMaterials} setManualMaterials={setManualMaterials} />}
        {key === "review" && (
          <ReviewSection findings={findings} setFindings={setFindings} services={services} recommendedServiceId={recommendedServiceId} setRecommendedServiceId={setRecommendedServiceId}
            priorServiceLabel={priorServiceLabel} bomLines={bomLines} manualMaterials={manualMaterials} />
        )}
        {error && <div role="alert" className="rounded-btn bg-redbg px-3 py-3 text-[13.5px] text-red">{error}</div>}
      </div>
      <div className="flex items-center gap-2 border-t border-line bg-surface px-3 pt-3" style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}>
        {section > 0 && (
          <button type="button" onClick={() => setSection((s) => s - 1)} className="flex min-h-[48px] items-center gap-1 rounded-btn bg-inset px-3 text-[14px] font-semibold text-ink2"><ChevronLeft size={18} aria-hidden /> Kembali</button>
        )}
        {section < SECTIONS.length - 1 ? (
          <button type="button" onClick={() => setSection((s) => s + 1)} className="flex min-h-[48px] flex-1 items-center justify-center gap-1 rounded-btn bg-accent text-[15px] font-bold text-white">Lanjut <ChevronRight size={18} aria-hidden /></button>
        ) : (
          <button type="button" data-testid="wizard-submit" onClick={submit} disabled={busy} className="flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-btn bg-accent text-[15px] font-bold text-white disabled:opacity-50">
            {busy ? <><Loader2 size={18} className="animate-spin" aria-hidden /> Mengirim…</> : "Kirim Diagnosis"}
          </button>
        )}
      </div>
    </div>
  );
}
