import React, { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { api } from "@/api.js";
import { Button } from "@/components/ui/button.jsx";
import { friendlyError } from "@/features/production/experience.js";

// Rencana pengerjaan pesanan BARU/custom di Unit 360 > Proses: (1) kebutuhan JENIS PRODUK yang perlu dikonfirmasi Sales (produksi TIDAK mengubah order),
// (2) kebutuhan CORNER yang dikonfirmasi pada rencana (bukan diasumsikan dari jenis produk; tidak diperlukan wajib beralasan), (3) PIC BAHAN per pekerjaan
// (operator produksi yang sah; bukan akun/peran baru). Perubahan hanya untuk pemegang izin penjadwalan (server menegakkan ulang) lewat command resmi.
const field = "block w-full rounded-btn border border-line bg-surface px-3 py-2 text-[13px] text-ink";

export default function BuildPlanPanel({ d, canPlan = false, onChanged }) {
  const p = d.production;
  const build = p.build || {};
  const corner = build.corner || { required: null, reason: null, confirmed: false };
  const [operators, setOperators] = useState(null);
  const [cornerChoice, setCornerChoice] = useState(corner.required === false ? "NO" : corner.required === true ? "YES" : "");
  const [reason, setReason] = useState(corner.reason || "");
  const [picId, setPicId] = useState(build.materialOperator?.id || "");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => { setCornerChoice(corner.required === false ? "NO" : corner.required === true ? "YES" : ""); setReason(corner.reason || ""); setPicId(build.materialOperator?.id || ""); }, [corner.required, corner.reason, build.materialOperator?.id]);
  useEffect(() => { if (!canPlan) return; api.getPlanningRefs().then((r) => setOperators(r?.operators || [])).catch(() => setOperators([])); }, [canPlan]);

  const run = useCallback(async (name, call, success) => {
    setBusy(name); setError(""); setNotice("");
    try { const r = await call(); setNotice(r?.changed === false ? "Tidak ada perubahan." : success); await onChanged?.(); }
    catch (e) { setError(friendlyError(e)); } finally { setBusy(""); }
  }, [onChanged]);

  const saveCorner = () => {
    if (!cornerChoice) { setError("Pilih: Corner diperlukan atau tidak diperlukan."); return; }
    if (cornerChoice === "NO" && reason.trim().length < 3) { setError("Corner tidak diperlukan wajib beralasan (minimal 3 karakter)."); return; }
    return run("corner", () => api.confirmProductionV2BuildCorner(p.runId, { expectedRevision: p.revision, required: cornerChoice === "YES", ...(cornerChoice === "NO" ? { reason: reason.trim() } : {}) }), "Kebutuhan Corner dikonfirmasi.");
  };
  const savePic = (operatorId) => run("pic", () => api.setProductionV2BuildMaterialOperator(p.runId, { expectedRevision: p.revision, operatorId: operatorId || null }), operatorId ? "PIC Bahan ditetapkan." : "PIC Bahan dilepas.");

  return (
    <section aria-label="Rencana pengerjaan" data-testid="build-plan-panel" className="space-y-3 rounded-card border border-line p-3">
      <p className="m-0 text-[13px] font-bold text-ink">Rencana Pengerjaan Pesanan</p>
      {p.product?.problem && (
        <p data-testid="overview-product-problem" className="m-0 rounded-btn bg-orangebg px-3 py-2 text-[12.5px] text-orange">
          <b>Jenis produk perlu dikonfirmasi.</b> {p.product.problem}. Produksi tidak mengubah order; racikan dan pengujian khusus kasur ditahan sampai Sales memperbaiki jenis produk pada order.
        </p>
      )}

      <div className="space-y-1.5" data-testid="build-corner-block">
        <p className="m-0 text-[12.5px] font-semibold text-ink2">Corner (kain/jahit): {corner.confirmed ? (corner.required ? "diperlukan" : `tidak diperlukan — ${corner.reason}`) : <span className="text-orange" data-testid="corner-unconfirmed">belum dikonfirmasi — QC menunggu</span>}</p>
        {corner.locked ? <p className="m-0 text-[12px] text-ink3" data-testid="corner-locked">Keputusan Corner terkunci — pekerjaan sudah melewati gerbang penentuannya.</p> : null}
        {canPlan && !corner.locked ? (
          <div className="space-y-1.5">
            <div role="radiogroup" aria-label="Kebutuhan Corner" className="flex gap-3 text-[13px] text-ink">
              <label className="flex items-center gap-1.5"><input type="radio" name="corner" checked={cornerChoice === "YES"} onChange={() => setCornerChoice("YES")} data-testid="corner-yes" /> Diperlukan</label>
              <label className="flex items-center gap-1.5"><input type="radio" name="corner" checked={cornerChoice === "NO"} onChange={() => setCornerChoice("NO")} data-testid="corner-no" /> Tidak diperlukan</label>
            </div>
            {cornerChoice === "NO" && <input aria-label="Alasan Corner tidak diperlukan" data-testid="corner-reason" className={field} placeholder="Alasan — mis. tidak ada pekerjaan kain/jahit" value={reason} onChange={(e) => setReason(e.target.value)} />}
            <Button size="sm" variant="secondary" data-mutates data-testid="build-corner-save" disabled={!!busy} onClick={saveCorner}>{busy === "corner" ? <Loader2 size={14} className="animate-spin" aria-hidden /> : null} Simpan Corner</Button>
          </div>
        ) : null}
      </div>

      <div className="space-y-1.5" data-testid="build-pic-block">
        <p className="m-0 text-[12.5px] font-semibold text-ink2">PIC Bahan: {build.materialOperator?.name || "belum ditugaskan"}</p>
        {canPlan ? (
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label="PIC Bahan" data-testid="build-pic-select" className={`${field} w-auto min-w-[10rem]`} value={picId} onChange={(e) => setPicId(e.target.value)}>
              <option value="">— Pilih operator —</option>
              {(operators || []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            <Button size="sm" variant="secondary" data-mutates data-testid="build-pic-save" disabled={!!busy || !picId} onClick={() => savePic(picId)}>Tetapkan</Button>
            {build.materialOperator && <Button size="sm" variant="ghost" data-mutates data-testid="build-pic-clear" disabled={!!busy} onClick={() => savePic(null)}>Lepas</Button>}
            {operators && operators.length === 0 && <span className="text-[12px] text-ink3">Belum ada operator terdaftar (daftarkan di Pengaturan › Operator).</span>}
          </div>
        ) : null}
        <p className="m-0 text-[11.5px] text-ink3">PIC Bahan mencatat racikan dan pemakaian aktual di Aplikasi PIC Bahan. Stok keluar hanya saat Gudang menyerahkan bahan.</p>
      </div>
      {notice && <p role="status" className="m-0 rounded-btn bg-greenbg px-3 py-2 text-[12.5px] text-green">{notice}</p>}
      {error && <p role="alert" className="m-0 rounded-btn bg-redbg px-3 py-2 text-[12.5px] text-red">{error}</p>}
    </section>
  );
}
