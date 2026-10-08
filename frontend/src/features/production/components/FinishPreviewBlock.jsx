import React, { useEffect, useState } from "react";
import { CheckCircle2, CircleAlert, Ban } from "lucide-react";
import { api } from "@/api.js";
import { friendlyError } from "@/features/production/experience.js";

// Pratinjau "Selesaikan Produksi" untuk Run NON-adaptasi (Fase 5): memeriksa putusan QC sesuai kebijakan Run, keputusan Corner, tahap berjalan, dan retur sisa bahan.
// Hanya membaca; aksinya = konfirmasi tahap 12 yang sama (server menegakkan ulang semua syarat). Siap Kirim baru setelah Gudang menerima barang jadi.
export function FinishPreviewBlock({ runId, revision }) {
  const [pv, setPv] = useState(null); const [err, setErr] = useState("");
  useEffect(() => { let alive = true; api.getProductionV2FinishPreview(runId).then((p) => { if (alive) setPv(p); }).catch((e) => { if (alive) setErr(friendlyError(e)); }); return () => { alive = false; }; }, [runId, revision]);
  if (err) return <p role="alert" className="m-0 rounded-btn bg-redbg px-3 py-2 text-[13px] text-red">{err}</p>;
  if (!pv) return <div className="h-20 animate-pulse rounded-card bg-inset" />;
  if (pv.kind !== "HANDOFF_GUDANG") return null;
  return (
    <section data-testid="finish-preview" className="space-y-2 rounded-btn border border-line p-3 text-[13px]">
      <p className="m-0 text-[13.5px] font-bold text-ink">Ringkasan sebelum diselesaikan</p>
      <ul className="m-0 list-none space-y-1 p-0">
        {pv.checks.map((c) => (
          <li key={c.key} data-testid={`finish-check-${c.key}`} data-ok={c.ok ? "1" : "0"} className={`flex items-start gap-2 rounded-btn px-2 py-2 ${c.ok ? "bg-greenbg text-green" : "bg-redbg text-red"}`}>
            {c.status === "TIDAK_BERLAKU" ? <Ban size={15} className="mt-0.5 shrink-0" aria-hidden /> : c.ok ? <CheckCircle2 size={15} className="mt-0.5 shrink-0" aria-hidden /> : <CircleAlert size={15} className="mt-0.5 shrink-0" aria-hidden />}
            <span><b>{c.label}:</b> {c.detail}{c.policy ? ` (kebijakan Run: ${c.policy})` : ""}</span>
          </li>
        ))}
      </ul>
      {pv.expectedReturns.length > 0 && (
        <div data-testid="finish-returns" className="rounded-btn bg-orangebg px-3 py-2 text-orange"><p className="m-0 font-bold">Sisa bahan akan dikembalikan ke Gudang</p>
          <ul className="m-0 mt-1 list-disc pl-5">{pv.expectedReturns.map((r) => <li key={r.code || r.name}>{r.name || r.code} — {r.qty} {r.unit || ""}</li>)}</ul>
          <p className="m-0 mt-1">Barang jadi baru bisa diterima Gudang setelah sisa ini diterima.</p></div>
      )}
      {pv.blockers.length > 0 && <ul data-testid="finish-blockers" className="m-0 list-none space-y-1 p-0">{pv.blockers.map((b) => <li key={b.code} className="rounded-btn bg-redbg px-3 py-2 text-red">{b.text}</li>)}</ul>}
      <p className="m-0 text-ink3" data-testid="finish-statement">{pv.statement}</p>
    </section>
  );
}
export default FinishPreviewBlock;
