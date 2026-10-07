import React, { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { api } from "@/api.js";
import { useOnline } from "@/components/StandaloneShell.jsx";
import { MaterialLines } from "@/features/production/components/StepForm.jsx";
import { buildMaterialRecordBody, createIntentKeys, friendlyError, isRetryableError, productFlowOf, validateMaterialRecord } from "@/features/production/experience.js";
import { submitState } from "./workerAppModel.js";
import { OfflineNote, SheetHeader } from "./workerSheets.jsx";

// Lembar "Catat Racikan & Bahan" milik PIC BAHAN per pekerjaan (jalur Pengerjaan Pesanan). Command resmi: POST /production-v2/runs/:id/build/materials
// (otorisasi PIC Bahan ditegakkan server; bahan HANYA dari yang diserahkan Gudang; idempoten; TIDAK menulis stok — stok keluar hanya saat Gudang menyerahkan).
// Versi terbaru = keadaan sekarang: lembar ini membuka isian dari catatan terakhir, jadi koreksi = kirim ulang isian lengkap.
const intentKeysMaterial = createIntentKeys();
const field = "block w-full rounded-btn border border-line bg-surface px-3 py-3 text-[15px] text-ink placeholder:text-ink3 focus:outline-none focus:ring-2 focus:ring-accent/40";
const labelCls = "mb-1 block text-[13px] font-semibold text-ink2";

export default function MaterialRecordSheet({ card, onClose, onSubmitted }) {
  const online = useOnline();
  const restoration = card.track !== "BUILD"; // Fase 3: LAYANAN — hanya pemakaian aktual (racikan = Catatan Komponen)
  const flow = restoration ? "RESTORATION" : (productFlowOf(card) || "UNCONFIRMED");
  const record = (restoration ? card.materialPic?.record : card.build?.record) || null;
  const issued = card.issuedMaterials || [];
  const [form, setForm] = useState(() => ({
    racikanFondasi: record?.racikan?.fondasi || "", racikanLapisan: record?.racikan?.lapisan || "", note: record?.note || "",
    materials: (record?.materials || []).map((m) => ({ materialId: m.materialId, qty: String(m.qty) })),
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [canRetry, setCanRetry] = useState(false);
  useEffect(() => { setError(""); setCanRetry(false); }, [form]);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const gate = submitState({ online, busy });
  const body = useMemo(() => buildMaterialRecordBody(form, { flow, revision: card.revision }), [form, flow, card.revision]);

  async function submit() {
    const invalid = validateMaterialRecord(form, { flow, issued });
    if (invalid) { setError(invalid); return; }
    setBusy(true); setError(""); setCanRetry(false);
    const key = intentKeysMaterial.keyFor(card.runId, "materials", card.revision);
    try {
      const result = await api.recordProductionV2BuildMaterials(card.runId, body, key);
      intentKeysMaterial.release(card.runId, "materials", card.revision);
      onSubmitted(result);
    } catch (e) {
      if (isRetryableError(e)) setCanRetry(true); else intentKeysMaterial.release(card.runId, "materials", card.revision);
      setError(friendlyError(e));
      if (e.code === "STEP_REVISION_CONFLICT") onSubmitted(null);
    } finally { setBusy(false); }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Catat racikan dan bahan" data-testid="material-record-sheet" className="fixed inset-0 z-50 flex flex-col bg-base">
      <SheetHeader onClose={onClose} subtitle={`${card.unit.unitCode}${record ? ` · versi ${record.version}` : ""}`} title={restoration ? "Catat Bahan Dipakai" : "Catat Racikan & Bahan"} />
      <div className="flex-1 space-y-4 overflow-y-auto px-3 py-4">
        <p className="rounded-btn bg-accentbg px-3 py-2 text-[13.5px] text-accent">Catat racikan dan bahan yang benar-benar dipakai. Bahan hanya dari yang sudah diserahkan Gudang. Mencatat di sini tidak mengeluarkan stok — sisa bahan otomatis menjadi retur saat produksi selesai.</p>
        {restoration && <p data-testid="material-restoration-note" className="m-0 rounded-btn bg-inset px-3 py-2 text-[13px] text-ink2">Racikan fondasi/lapisan ditentukan PIC Meja/PIC QC di Catatan Komponen (Racikan rencana). Di sini cukup catat bahan yang benar-benar dipakai.</p>}
        {flow === "UNCONFIRMED" && <p data-testid="unconfirmed-note" className="m-0 rounded-btn bg-orangebg px-3 py-2 text-[13px] text-orange">Jenis produk belum jelas pada order — racikan kasur ditahan sampai Sales mengonfirmasi. Pemakaian bahan tetap bisa dicatat.</p>}
        {flow === "NON_KASUR" && <p className="m-0 rounded-btn bg-inset px-3 py-2 text-[13px] text-ink2">Produk non-kasur (divan/sofa): tidak ada racikan kasur — catat bahan yang dipakai.</p>}
        {flow === "KASUR" && (
          <div className="space-y-2" data-testid="material-racikan-fields">
            <p className={labelCls}>Racikan kasur (fondasi &amp; lapisan)</p>
            <input aria-label="Racikan fondasi" className={field} placeholder="Fondasi — mis. pocket spring 25 cm + penguat pinggir" value={form.racikanFondasi} onChange={(e) => set({ racikanFondasi: e.target.value })} />
            <input aria-label="Racikan lapisan" className={field} placeholder="Lapisan — mis. latex 3 cm + busa D23 2 cm" value={form.racikanLapisan} onChange={(e) => set({ racikanLapisan: e.target.value })} />
          </div>
        )}
        <div className="space-y-2" data-testid="material-usage-fields">
          <p className={labelCls}>Bahan dari Gudang yang dipakai</p>
          <MaterialLines issued={issued} value={form.materials} onChange={(materials) => set({ materials })} emptyText="Belum ada bahan yang diserahkan Gudang untuk unit ini." />
        </div>
        <div><label htmlFor="mat-note" className={labelCls}>Catatan (opsional)</label>
          <textarea id="mat-note" rows={2} className={field} value={form.note} onChange={(e) => set({ note: e.target.value })} /></div>
        {error && <div role="alert" className="rounded-btn bg-redbg px-3 py-3 text-[13.5px] text-red">{error}</div>}
      </div>
      <div className="space-y-2 border-t border-line bg-surface px-3 pt-3" style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}>
        {!online && <OfflineNote />}
        <button type="button" data-mutates data-testid="material-record-submit" onClick={submit} disabled={gate.disabled}
          className="flex min-h-[56px] w-full items-center justify-center gap-2 rounded-btn bg-accent text-[16px] font-bold text-white disabled:opacity-50">
          {busy ? <><Loader2 size={20} className="animate-spin" aria-hidden /> Mengirim…</> : canRetry ? "Coba Lagi" : restoration ? "Simpan Bahan Dipakai" : "Simpan Racikan & Bahan"}
        </button>
      </div>
    </div>
  );
}
