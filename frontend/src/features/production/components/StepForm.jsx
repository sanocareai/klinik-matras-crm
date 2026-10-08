import React, { useEffect, useRef, useState } from "react";
import { Check, Mic, MicOff } from "lucide-react";
import { CORNER_CHECKLIST, MATTRESS_STYLES, OLD_MATERIALS, TEXTURE_VERDICTS , productFlowOf, stepMaterialsByPic } from "@/features/production/experience.js";

// Isian per tahap (mobile-first, target sentuh >= 44px). `form` dikelola induk supaya ikut draft lokal.
const field = "block w-full rounded-btn border border-line bg-surface px-3 py-3 text-[15px] text-ink placeholder:text-ink3 focus:outline-none focus:ring-2 focus:ring-accent/40";
const labelCls = "mb-1.5 block text-[13px] font-semibold text-ink2";

function Toggle({ checked, onChange, children }) {
  return (
    <button type="button" role="checkbox" aria-checked={!!checked} onClick={() => onChange(!checked)}
      className={`flex min-h-[48px] w-full items-center gap-3 rounded-btn px-3 text-left text-[14.5px] ${checked ? "bg-accentbg font-semibold text-accent" : "bg-inset text-ink"}`}>
      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 ${checked ? "border-accent bg-accent text-white" : "border-line"}`}>{checked && <Check size={16} aria-hidden />}</span>
      {children}
    </button>
  );
}

function Choice({ options, value, onChange, tones = {} }) {
  return (
    <div role="radiogroup" className="grid grid-cols-3 gap-2">
      {options.map((o) => {
        const active = value === o.value;
        const tone = tones[o.value] || "accent";
        const activeCls = tone === "green" ? "bg-green text-white" : tone === "orange" ? "bg-orange text-white" : "bg-accent text-white";
        return (
          <button key={o.value} type="button" role="radio" aria-checked={active} onClick={() => onChange(o.value)}
            className={`min-h-[56px] rounded-btn px-2 text-[14px] font-bold ${active ? activeCls : "bg-inset text-ink"}`}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function NumberField({ label, value, onChange, suffix, id }) {
  return (
    <div>
      <label htmlFor={id} className={labelCls}>{label}</label>
      <div className="relative">
        <input id={id} inputMode="decimal" className={`${field} pr-12`} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-ink3">{suffix}</span>
      </div>
    </div>
  );
}

// Voice-to-text memakai Web Speech API bila browser mendukung (Chrome Android: webkitSpeechRecognition). Tanpa dukungan: tombol disembunyikan.
function useSpeech(onText) {
  const recRef = useRef(null);
  const [listening, setListening] = useState(false);
  const Rec = typeof window !== "undefined" ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
  useEffect(() => () => { try { recRef.current?.stop(); } catch { /* abaikan */ } }, []);
  if (!Rec) return { supported: false };
  const toggle = () => {
    if (listening) { recRef.current?.stop(); return; }
    const rec = new Rec();
    rec.lang = "id-ID"; rec.continuous = true; rec.interimResults = false;
    rec.onresult = (e) => {
      const text = Array.from(e.results).slice(e.resultIndex).map((r) => r[0]?.transcript || "").join(" ").trim();
      if (text) onText(text);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    rec.start();
    setListening(true);
  };
  return { supported: true, listening, toggle };
}

export function MaterialLines({ issued, value = [], onChange, emptyText }) {
  if (!issued?.length) return <p className="rounded-btn bg-orangebg px-3 py-3 text-[13px] text-orange">{emptyText}</p>;
  const qtyOf = (id) => value.find((m) => m.materialId === id)?.qty ?? "";
  const set = (id, qty) => {
    const rest = value.filter((m) => m.materialId !== id);
    onChange(qty === "" ? rest : [...rest, { materialId: id, qty }]);
  };
  return (
    <ul className="m-0 list-none p-0 space-y-2">
      {issued.map((m) => (
        <li key={m.materialId} className="flex items-center gap-3 rounded-btn bg-inset px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-semibold text-ink">{m.name}</p>
            <p className="text-[12px] text-ink3">{m.code} · diserahkan {m.qty} {String(m.uom || "").toLowerCase()}{m.remainingQty != null && m.remainingQty !== m.qty ? ` · sisa ${m.remainingQty}` : ""}</p>
          </div>
          <input aria-label={`Jumlah ${m.name} dipakai`} inputMode="decimal" placeholder="0" className="h-12 w-20 rounded-btn border border-line bg-surface px-2 text-center text-[15px] text-ink"
            value={qtyOf(m.materialId)} onChange={(e) => set(m.materialId, e.target.value)} />
        </li>
      ))}
    </ul>
  );
}

const ISSUE_CHIPS = ["Per tengah lemah", "Kawat lepas", "Busa kempes", "Rangka patah", "Pinggiran turun"];

export function StepForm({ stepNo, form, setForm, card, next }) {
  const set = (patch) => setForm((prev) => ({ ...prev, ...patch }));
  const speech = useSpeech((text) => setForm((prev) => ({ ...prev, diagnosis: `${prev.diagnosis ? `${prev.diagnosis.trim()} ` : ""}${text}`, inputMethod: "VOICE" })));
  const weight = card?.customer?.weightKg;
  const issued = card?.issuedMaterials || [];
  // Berat penguji yang TAMPIL (bawaan = berat customer) harus ikut tersimpan di isian: tanpa ini kolom terlihat terisi tetapi validasi/pengiriman menganggapnya kosong.
  useEffect(() => { if ((stepNo === 4 || stepNo === 8) && weight && form.testerWeightKg === undefined) setForm((prev) => (prev.testerWeightKg === undefined ? { ...prev, testerWeightKg: String(weight) } : prev)); }, [stepNo, weight, form.testerWeightKg, setForm]);

  switch (stepNo) {
    case 1:
      return (
        <div className="space-y-3">
          <Toggle checked={form.conditionConfirmed} onChange={(v) => set({ conditionConfirmed: v })}>
            Ukuran {card?.unit?.ukuran || "kasur"} & kondisi kain luar sudah dicek
          </Toggle>
          <div><label htmlFor="s1n" className={labelCls}>Catatan kondisi (opsional)</label>
            <textarea id="s1n" rows={2} className={field} value={form.conditionNote || ""} onChange={(e) => set({ conditionNote: e.target.value })} placeholder="mis. kain luar sobek di sudut" /></div>
        </div>
      );
    case 2:
      return (
        <div><label htmlFor="s2" className={labelCls}>Catatan rasa awal</label>
          <textarea id="s2" rows={3} className={field} value={form.feelNote || ""} onChange={(e) => set({ feelNote: e.target.value })} placeholder="mis. tengah terasa amblas, pinggir keras" /></div>
      );
    case 3: {
      const selected = form.oldMaterials || [];
      return (
        <div className="space-y-2">
          {next?.gated && (
            <p data-testid="layers-gate-note" className={`m-0 rounded-btn px-3 py-2 text-[13px] ${next.layersRequired ? "bg-orangebg text-orange" : "bg-greenbg text-green"}`}>
              {next.layersRequired
                ? "Catat susunan lapisan awal (atas ke bawah, per lapis: bahan, ketebalan, kondisi) di bagian Catatan Komponen sebelum menyelesaikan bongkar. Foto/video di bawah menjadi dokumentasi isi kasur untuk customer."
                : "Lapisan awal sudah tercatat di Catatan Komponen. Lampirkan foto/video isi kasur yang ditemukan."}
            </p>
          )}
          <p className={labelCls}>{next?.gated ? "Material lama yang ditemukan (opsional)" : "Material lama yang ditemukan"}</p>
          <div className="grid grid-cols-2 gap-2">
            {OLD_MATERIALS.map((m) => (
              <Toggle key={m.value} checked={selected.includes(m.value)} onChange={(v) => set({ oldMaterials: v ? [...selected, m.value] : selected.filter((x) => x !== m.value) })}>{m.label}</Toggle>
            ))}
          </div>
          <textarea rows={2} aria-label="Catatan material lama" className={field} value={form.note || ""} onChange={(e) => set({ note: e.target.value })} placeholder="Catatan (opsional)" />
        </div>
      );
    }
    case 4: {
      const a = Number(String(form.heightBeforeCm ?? "").replace(",", "."));
      const b = Number(String(form.heightCompressedCm ?? "").replace(",", "."));
      const drop = a > 0 && b > 0 ? Math.round((a - b) * 10) / 10 : null;
      const issues = form.foundationIssues || [];
      return (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <NumberField id="s4a" label="Tinggi awal" suffix="cm" value={form.heightBeforeCm} onChange={(v) => set({ heightBeforeCm: v })} />
            <NumberField id="s4b" label="Saat ditekan" suffix="cm" value={form.heightCompressedCm} onChange={(v) => set({ heightCompressedCm: v })} />
          </div>
          {drop != null && <p className={`rounded-btn px-3 py-2 text-[14px] font-semibold ${drop >= 0 ? "bg-accentbg text-accent" : "bg-redbg text-red"}`}>Penurunan: {drop} cm</p>}
          <NumberField id="s4w" label={`Berat penguji${weight ? ` (customer ${weight} kg)` : ""}`} suffix="kg" value={form.testerWeightKg ?? (weight || "")} onChange={(v) => set({ testerWeightKg: v })} />
          <p className={labelCls}>Masalah fondasi</p>
          <div className="flex flex-wrap gap-2">
            {ISSUE_CHIPS.map((c) => {
              const on = issues.includes(c);
              return <button key={c} type="button" aria-pressed={on} onClick={() => set({ foundationIssues: on ? issues.filter((x) => x !== c) : [...issues, c] })}
                className={`min-h-[44px] rounded-chip px-3 text-[13.5px] font-semibold ${on ? "bg-accent text-white" : "bg-inset text-ink2"}`}>{c}</button>;
            })}
          </div>
        </div>
      );
    }
    case 5:
      return (
        <div className="space-y-2">
          {card?.customer?.complaints?.length > 0 && <p className="rounded-btn bg-inset px-3 py-2 text-[13px] text-ink2">Keluhan customer: <b className="text-ink">{card.customer.complaints.join(", ")}</b></p>}
          <label htmlFor="s5" className={labelCls}>Penjelasan diagnosa</label>
          <textarea id="s5" rows={5} className={field} value={form.diagnosis || ""} onChange={(e) => set({ diagnosis: e.target.value, inputMethod: form.inputMethod === "VOICE" ? "VOICE" : "TEXT" })}
            placeholder="Hubungkan kerusakan yang ditemukan dengan keluhan customer" />
          {speech.supported && (
            <button type="button" onClick={speech.toggle} className={`flex min-h-[48px] w-full items-center justify-center gap-2 rounded-btn text-[14px] font-semibold ${speech.listening ? "bg-red text-white" : "bg-accentbg text-accent"}`}>
              {speech.listening ? <><MicOff size={18} aria-hidden /> Berhenti merekam suara</> : <><Mic size={18} aria-hidden /> Diktekan dengan suara</>}
            </button>
          )}
        </div>
      );
    case 6:
    case 7: {
      const byPic = stepMaterialsByPic(card, stepNo);
      const flow6 = stepNo === 6 && card?.track === "BUILD" ? productFlowOf(card) : null;
      return (
        <div className="space-y-3">
          {byPic ? (
            <div data-testid="by-pic-note" className="space-y-1 rounded-btn bg-inset px-3 py-2 text-[13px] text-ink2">
              <p className="m-0 font-bold text-ink">{card.track === "BUILD" ? "Racikan & pemakaian bahan" : "Pemakaian bahan"} dicatat PIC Bahan{(card.build?.materialOperator?.name || card.materialPic?.materialOperator?.name) ? `: ${card.build?.materialOperator?.name || card.materialPic?.materialOperator?.name}` : ""}</p>
              {card.track === "BUILD" ? (card.racikan ? <p className="m-0">{[card.racikan.fondasi && `Fondasi — ${card.racikan.fondasi}`, card.racikan.lapisan && `Lapisan — ${card.racikan.lapisan}`].filter(Boolean).join(" · ")}</p> : <p className="m-0 text-orange">Racikan belum dicatat PIC Bahan.</p>) : <p className="m-0" data-testid="by-pic-racikan-note">Racikan fondasi/lapisan ada di Catatan Komponen (Racikan rencana) — ditentukan PIC Meja/PIC QC.</p>}
              {(card.build ?? card.materialPic)?.record?.materials?.length > 0 && <p className="m-0" data-testid="by-pic-usage">Bahan dipakai: {(card.build ?? card.materialPic).record.materials.map((m) => `${m.name || m.code} ${m.qty}`).join(", ")}</p>}
            </div>
          ) : (
            <>
              <p className={labelCls}>{card?.track === "BUILD" ? "Bahan dari Gudang yang dipakai (opsional)" : "Bahan dari Gudang yang dipakai"}</p>
              <MaterialLines issued={issued} value={form.materials} onChange={(materials) => set({ materials })} emptyText="Belum ada bahan yang diserahkan Gudang untuk unit ini." />
            </>
          )}
          {flow6 === "UNCONFIRMED" && <p data-testid="unconfirmed-note" className="m-0 rounded-btn bg-orangebg px-3 py-2 text-[13px] text-orange">Jenis produk belum jelas pada order — catatan dan dokumentasi umum tetap bisa disimpan. Racikan dan pengujian khusus kasur menunggu Sales mengonfirmasi jenis produk.</p>}
          {!byPic && flow6 === "KASUR" && (
            <div className="space-y-2" data-testid="racikan-fields">
              <p className={labelCls}>Racikan kasur (fondasi &amp; lapisan)</p>
              <input aria-label="Racikan fondasi" className={field} placeholder="Fondasi — mis. pocket spring 25 cm + penguat pinggir" value={form.racikanFondasi || ""} onChange={(e) => set({ racikanFondasi: e.target.value })} />
              <input aria-label="Racikan lapisan" className={field} placeholder="Lapisan — mis. latex 3 cm + busa D23 2 cm" value={form.racikanLapisan || ""} onChange={(e) => set({ racikanLapisan: e.target.value })} />
            </div>
          )}
          <div><label htmlFor="s67" className={labelCls}>{stepNo === 6 ? (card?.track === "BUILD" ? "Penjelasan pengerjaan pesanan" : "Penjelasan isi fondasi") : "Catatan lapisan (opsional)"}</label>
            <textarea id="s67" rows={2} className={field} value={form.note || ""} onChange={(e) => set({ note: e.target.value })} /></div>
        </div>
      );
    }
    case 8:
      return (
        <div className="space-y-3">
          {next?.lastVerdict && <p className="rounded-btn bg-orangebg px-3 py-2 text-[13px] text-orange">Uji sebelumnya: {TEXTURE_VERDICTS.find((v) => v.value === next.lastVerdict)?.label}. Lapisan sudah disesuaikan.</p>}
          <p className={labelCls}>Hasil uji tekstur akhir</p>
          <Choice options={TEXTURE_VERDICTS} value={form.verdict} onChange={(verdict) => set({ verdict })} tones={Object.fromEntries(TEXTURE_VERDICTS.map((v) => [v.value, v.tone]))} />
          {form.verdict && form.verdict !== "PAS" && <p className="rounded-btn bg-orangebg px-3 py-2 text-[13px] text-orange">Hasil ini mewajibkan rework: sesuaikan lapisan lalu kirim ulang bukti lapisan.</p>}
          <NumberField id="s8w" label={`Berat penguji${weight ? ` (customer ${weight} kg)` : ""}`} suffix="kg" value={form.testerWeightKg ?? (weight || "")} onChange={(v) => set({ testerWeightKg: v })} />
          <textarea rows={2} aria-label="Catatan uji" className={field} value={form.note || ""} onChange={(e) => set({ note: e.target.value })} placeholder="Catatan (opsional)" />
        </div>
      );
    case 9:
      return <textarea rows={2} aria-label="Catatan untuk Corner" className={field} value={form.note || ""} onChange={(e) => set({ note: e.target.value })} placeholder="Catatan untuk Corner (opsional)" />;
    case 10:
      return (
        <div className="space-y-3">
          <p className={labelCls}>Model kasur</p>
          <Choice options={MATTRESS_STYLES} value={form.mattressStyle} onChange={(mattressStyle) => set({ mattressStyle })} />
          <div><label htmlFor="s10f" className={labelCls}>Spesifikasi / warna kain</label>
            <input id="s10f" className={field} value={form.fabricSpec || ""} onChange={(e) => set({ fabricSpec: e.target.value })} placeholder="mis. Knitting putih quilting" /></div>
          <div><label htmlFor="s10b" className={labelCls}>Warna list</label>
            <input id="s10b" className={field} value={form.borderColor || ""} onChange={(e) => set({ borderColor: e.target.value })} placeholder="mis. Abu-abu tua" /></div>
          {issued.length > 0 && <><p className={labelCls}>Bahan kain dari Gudang (opsional)</p>
            <MaterialLines issued={issued} value={form.materials} onChange={(materials) => set({ materials })} /></>}
        </div>
      );
    case 11:
      return (
        <div className="space-y-2">
          {CORNER_CHECKLIST.map((c) => (
            <Toggle key={c.key} checked={form.checklist?.[c.key]} onChange={(v) => set({ checklist: { ...(form.checklist || {}), [c.key]: v } })}>{c.label}</Toggle>
          ))}
        </div>
      );
    case 12:
      return (
        <div className="space-y-2">
          <Toggle checked={form.confirm} onChange={(v) => set({ confirm: v })}>{card?.track === "BUILD" ? "Pekerjaan selesai & produk siap diserahkan ke Gudang" : "Jahitan selesai & kasur siap diserahkan ke Gudang"}</Toggle>
          <p className="text-[12.5px] text-ink3">Setelah dikonfirmasi, unit ditawarkan ke Gudang (belum siap kirim sampai Gudang menerima). Laporan untuk Sales disiapkan otomatis.</p>
        </div>
      );
    default:
      return null;
  }
}

export default StepForm;
