import React from "react";
import { AlertTriangle, CheckCircle2, Ban } from "lucide-react";
import { SALES_CONFIRM_LABEL } from "@/features/production/experience.js";

// Kartu "Permintaan Sales untuk Corner" (Fase 5) — dipakai PIC Corner (sebelum mulai), PIC Meja, Dokumentasi, dan Unit 360. Satu sumber: cornerView dari kartu/laporan.
// Tidak menebak motif atau warna: bila permintaan ganti kain ada tetapi motif/warna tidak tertulis, tampil "Perlu konfirmasi Sales".
export function CornerRequestCard({ cornerView, compact = false }) {
  if (!cornerView) return null;
  const { request: r, status } = cornerView;
  if (status?.status === "TIDAK_BERLAKU") {
    return (
      <section data-testid="corner-request-card" data-state="TIDAK_BERLAKU" className="space-y-1 rounded-btn bg-inset px-3 py-3 text-[13px] text-ink2">
        <p className="m-0 flex items-center gap-2 font-bold text-ink"><Ban size={15} aria-hidden /> Corner tidak berlaku</p>
        <p className="m-0" data-testid="corner-na-reason">Alasan: {status.reason}{status.decidedBy ? ` (keputusan ${status.decidedBy})` : ""}</p>
        <p className="m-0 text-ink3">{status.note}</p>
      </section>
    );
  }
  const confirmed = (cornerView.records?.start?.salesConfirmation || "").trim();
  const needs = !!r?.needsSalesConfirmation && !confirmed; // sudah ada hasil konfirmasi Sales yang dicatat PIC Corner → tidak lagi "perlu konfirmasi"
  return (
    <section data-testid="corner-request-card" data-state={r?.status} className={`space-y-2 rounded-btn px-3 py-3 text-[13px] ${needs ? "bg-orangebg text-ink" : "bg-inset text-ink2"}`}>
      <p className="m-0 flex items-center gap-2 text-[13.5px] font-bold text-ink">
        {needs ? <AlertTriangle size={15} className="text-orange" aria-hidden /> : <CheckCircle2 size={15} className="text-green" aria-hidden />} Permintaan Sales untuk Corner
      </p>
      {needs && <p className="m-0 rounded-btn bg-orange px-2 py-1 text-[12.5px] font-bold text-white" data-testid="sales-confirm-flag">{SALES_CONFIRM_LABEL}</p>}
      {r?.needsSalesConfirmation && confirmed && <p className="m-0 rounded-btn bg-greenbg px-2 py-1 text-[12.5px] font-bold text-green" data-testid="sales-confirmed">Sudah dikonfirmasi Sales — {confirmed}</p>}
      <dl className="m-0 space-y-1">
        <div><dt className="inline text-ink3">Ganti kain: </dt><dd className="inline font-semibold text-ink" data-testid="req-fabric">{r?.fabricChangeRequested ? (r.fabricItems?.length ? r.fabricItems.join(", ") : "ya (dari catatan pesanan)") : "tidak diminta"}</dd></div>
        <div><dt className="inline text-ink3">Motif: </dt><dd className="inline font-semibold text-ink" data-testid="req-motif">{!r?.fabricChangeRequested ? "—" : r.motifMentioned ? "tertulis di catatan" : "belum tertulis"}</dd></div>
        <div><dt className="inline text-ink3">Warna: </dt><dd className="inline font-semibold text-ink" data-testid="req-color">{!r?.fabricChangeRequested ? "—" : r.colorMentioned ? "tertulis di catatan" : "belum tertulis"}</dd></div>
        <div><dt className="inline text-ink3">Permintaan khusus / catatan pesanan: </dt><dd className="inline font-semibold text-ink" data-testid="req-notes">{r?.notes || "tidak ada"}</dd></div>
      </dl>
      {!compact && r?.hint && !confirmed && <p className="m-0 text-orange" data-testid="req-hint">{r.hint}</p>}
    </section>
  );
}
export default CornerRequestCard;
