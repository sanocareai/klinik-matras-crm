import React, { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { api } from "@/api.js";
import { MANUAL_LABEL, UNKNOWN_LABEL, materialText } from "./componentNotesModel.js";

// Pilih bahan komponen: Katalog (bahan resmi — tautan, TIDAK memotong stok), “Bahan manual” (teks bebas), atau “Tidak diketahui”. Catatan komponen bukan BOM/pemakaian.
const FIELD = "block w-full min-h-[44px] rounded-btn border border-line bg-surface px-3 py-2.5 text-[15px] text-ink outline-none focus:border-accent";
const MODES = [["CATALOG", "Katalog"], ["MANUAL", MANUAL_LABEL], ["UNKNOWN", UNKNOWN_LABEL]];

export function MaterialPicker({ value, onChange, label = "Bahan", optional = false, testid = "material-picker" }) {
  const mode = value?.kind || null;
  const [q, setQ] = useState(""); const [results, setResults] = useState([]); const [searching, setSearching] = useState(false); const [err, setErr] = useState("");
  useEffect(() => {
    if (mode !== "CATALOG") return undefined;
    let alive = true; setSearching(true);
    const t = setTimeout(() => {
      api.searchComponentMaterials(q).then((r) => { if (alive) { setResults(r.items || []); setErr(""); } }).catch(() => { if (alive) { setResults([]); setErr("Katalog tidak dapat dimuat — pakai “Bahan manual”."); } }).finally(() => { if (alive) setSearching(false); });
    }, q ? 250 : 0);
    return () => { alive = false; clearTimeout(t); };
  }, [q, mode]);
  const pickMode = (m) => {
    if (m === mode) return;
    if (m === "UNKNOWN") onChange({ kind: "UNKNOWN" });
    else if (m === "MANUAL") onChange({ kind: "MANUAL", text: "" });
    else onChange({ kind: "CATALOG", materialId: null });
  };
  return (
    <div className="space-y-2" data-testid={testid}>
      <p className="m-0 text-[13px] font-semibold text-ink2">{label}{optional ? " (opsional)" : ""}</p>
      <div role="radiogroup" aria-label={`Jenis ${label}`} className="flex flex-wrap gap-2">
        {MODES.map(([k, l]) => (
          <button key={k} type="button" role="radio" aria-checked={mode === k} data-testid={`material-mode-${k.toLowerCase()}`} onClick={() => pickMode(k)}
            className={`min-h-[44px] rounded-btn px-3 text-[13.5px] font-semibold ${mode === k ? "bg-accent text-white" : "bg-inset text-ink2"}`}>{l}</button>
        ))}
        {optional && mode && <button type="button" data-testid="material-clear" onClick={() => onChange(null)} className="min-h-[44px] rounded-btn px-3 text-[13px] font-semibold text-ink3 underline">Kosongkan</button>}
      </div>
      {mode === "MANUAL" && <input className={FIELD} aria-label={`${label}: ${MANUAL_LABEL}`} placeholder={`Nama ${MANUAL_LABEL.toLowerCase()}`} value={value.text || ""} maxLength={120} onChange={(e) => onChange({ kind: "MANUAL", text: e.target.value })} />}
      {mode === "UNKNOWN" && <p className="m-0 rounded-btn bg-inset px-3 py-2 text-[13px] text-ink3">Dicatat “{UNKNOWN_LABEL}” — tidak ditebak.</p>}
      {mode === "CATALOG" && (
        <div className="space-y-2">
          {value.materialId && <p data-testid="material-chosen" className="m-0 rounded-btn bg-accentbg px-3 py-2 text-[13px] font-semibold text-accent">Dipilih: {materialText(value)}</p>}
          <div className="relative"><Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink3" aria-hidden />
            <input className={`${FIELD} pl-9`} aria-label="Cari bahan katalog" placeholder="Cari kode/nama bahan…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          {err && <p role="alert" className="m-0 text-[12.5px] text-orange">{err}</p>}
          {searching && <p className="m-0 text-[12px] text-ink3">Mencari…</p>}
          {!searching && results.length > 0 && (
            <ul data-testid="material-results" className="m-0 max-h-48 list-none space-y-1 overflow-y-auto rounded-btn border border-line p-1">
              {results.map((m) => (
                <li key={m.materialId}><button type="button" data-material-code={m.code} onClick={() => onChange({ kind: "CATALOG", materialId: m.materialId, code: m.code, name: m.name, unit: m.unit })}
                  className="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-btn px-2 text-left text-[13.5px] text-ink hover:bg-hovertint"><span className="min-w-0 break-words">{m.name}</span><span className="shrink-0 text-[12px] text-ink3">{m.code}</span></button></li>
              ))}
            </ul>
          )}
          {!searching && !results.length && !err && <p className="m-0 text-[12px] text-ink3">Tidak ada bahan yang cocok — pakai “{MANUAL_LABEL}”.</p>}
        </div>
      )}
    </div>
  );
}
