import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Check, Clipboard, FileText, Send } from "lucide-react";
import { api } from "@/api.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Card } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { LifecycleBadge } from "@/features/production/components/LifecycleBadge.jsx";
import { DocSequence } from "@/features/production/components/DocSequence.jsx";
import { CornerRequestCard } from "@/features/production/components/CornerRequestCard.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { friendlyError } from "@/features/production/experience.js";
import { BeforeAfterSummary } from "@/features/production/componentNotes/BeforeAfterSummary.jsx";
import { PreTestBlock } from "@/features/production/componentNotes/PreTestBlock.jsx";
import { JourneySummary } from "@/features/production/componentNotes/JourneySummary.jsx";

// Paket Laporan Produksi V2 (P8E) — before · proses · after untuk Sales. Media bertanda tangan (akses aman, kedaluwarsa 60 menit).
// Status broadcast dibaca dari outbox: selama pengirim otomatis belum aktif, status jujur "Menunggu pengirim" (PENDING) — tidak pernah
// dianggap terkirim. Tombol Salin Pesan membantu Sales mengirim manual sampai consumer tersedia.
const STYLE = { BIASA: "Kasur Biasa", PLUSHTOP: "Plushtop", PILLOWTOP: "Pillowtop" };
const SOURCE_LABEL = { DRIVER_PICKUP: "Driver Pickup", PRODUKSI: "Produksi", QC: "QC", CORNER: "Corner", GUDANG: "Gudang", MANUAL: "Manual" };
const VERDICT = { PAS: "PAS", TERLALU_KERAS: "Terlalu Keras", TERLALU_EMPUK: "Terlalu Empuk" };

function Gallery({ title, items }) {
  return (
    <section className="space-y-2" aria-label={title}>
      <h3 className="text-[13px] font-bold text-ink2">{title} <span className="font-normal text-ink3">({items.length})</span></h3>
      {items.length === 0 ? <p className="text-[12.5px] text-ink3">Belum ada media.</p> : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {items.map((m) => (
            <figure key={m.url} className="overflow-hidden rounded-btn bg-inset">
              {m.kind === "video" ? <video src={m.url} controls preload="metadata" className="aspect-video w-full bg-black object-contain" /> : <img src={m.url} alt={m.caption || m.stepLabel} loading="lazy" className="aspect-video w-full object-cover" onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />}
              <figcaption className="px-2 py-1 text-[11px] text-ink3 [overflow-wrap:anywhere]" data-testid="report-media" data-documentation={m.documentation ? "true" : undefined}>
                {m.documentation ? m.stepLabel : `${m.stepNo}. ${m.stepLabel}`}{m.source ? ` · ${SOURCE_LABEL[m.source] || m.source}` : ""}{m.caption ? ` — ${m.caption}` : ""}
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </section>
  );
}

export default function ProductionReportV2() {
  const { runId } = useParams();
  const [report, setReport] = useState(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => { api.getProductionV2Report(runId).then(setReport).catch((e) => setError(friendlyError(e))); }, [runId]);

  async function copy() {
    const absoluteMessage = report.message.replace(report.reportPath, `${window.location.origin}${report.reportPath}`);
    try { await navigator.clipboard.writeText(absoluteMessage); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { setError("Gagal menyalin — pilih teks pesan secara manual."); }
  }
  if (error && !report) return <PageContainer><PageBody><Card className="p-0"><EmptyState icon={FileText} title="Laporan tidak tersedia" description={error} /></Card></PageBody></PageContainer>;
  if (!report) return <PageContainer><PageBody><Card className="h-64 animate-pulse bg-inset" /></PageBody></PageContainer>;

  const absoluteMessage = report.message.replace(report.reportPath, `${window.location.origin}${report.reportPath}`);
  const b = report.broadcast;
  const broadcastBadge = b.status === "DELIVERED" ? <Badge variant="green">Terkirim ke Sales</Badge>
    : b.status === "PENDING" ? <Badge variant="orange">Menunggu pengirim otomatis</Badge>
      : b.status === "FAILED" ? <Badge variant="red">Gagal terkirim</Badge> : <Badge variant="neutral">Belum siap</Badge>;
  return (
    <PageContainer>
      <PageHeader title={`Laporan Produksi ${report.unit.unitCode}`} subtitle={`${report.order.customerName || "—"} · ${report.order.orderNumber || "tanpa nomor order"}`}
        actions={<div className="flex items-center gap-2">{broadcastBadge}<Button size="sm" onClick={copy} disabled={!report.ready}>{copied ? <><Check size={14} /> Tersalin</> : <><Clipboard size={14} /> Salin Pesan untuk Sales</>}</Button></div>} />
      <PageBody>
        {!report.ready && <div className="rounded-btn bg-orangebg px-3 py-2.5 text-[12.5px] text-orange">Produksi belum dikonfirmasi selesai — laporan masih sementara.</div>}
        {b.status === "PENDING" && <div className="flex items-center gap-2 rounded-btn bg-inset px-3 py-2.5 text-[12.5px] text-ink2"><Send size={14} aria-hidden /> Laporan sudah masuk antrean kirim (outbox). Pengirim otomatis ke grup & PIC Sales belum aktif — kirim manual dengan “Salin Pesan”.</div>}
        {report.lifecycle && <Card className="space-y-2 p-4 text-[12.5px]" data-testid="report-lifecycle"><p className="m-0 font-bold text-ink">Status produksi</p><LifecycleBadge lifecycle={report.lifecycle} />{report.lifecycle.detail && <p className="m-0 text-ink3">{report.lifecycle.detail}</p>}</Card>}
        {report.cornerView && (report.cornerView.status.status === "TIDAK_BERLAKU" || report.cornerView.request.fabricChangeRequested || report.cornerView.records.start) && (
          <Card className="space-y-2 p-4 text-[12.5px]" data-testid="report-corner">
            <CornerRequestCard cornerView={report.cornerView} />
            {report.cornerView.records.start && <p className="m-0 text-ink2" data-testid="report-corner-start">Corner mulai: {report.cornerView.records.start.fabricMode === "NEW_INSTALLED" ? "kain baru dipasang" : report.cornerView.records.start.fabricMode === "OLD_REUSED" ? "kain lama dipakai kembali" : "—"}{report.cornerView.records.start.requestMatch === "ADA_PERBEDAAN" ? ` · ada perbedaan: ${report.cornerView.records.start.requestNote || "—"}` : report.cornerView.records.start.requestMatch ? " · sesuai permintaan Sales" : ""}{report.cornerView.records.start.salesConfirmation ? ` · Konfirmasi Sales dicatat oleh PIC Corner (${report.cornerView.records.start.byName || "PIC Corner"}${report.cornerView.records.start.at ? `, ${new Date(report.cornerView.records.start.at).toLocaleString("id-ID", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}` : ""}): ${report.cornerView.records.start.salesConfirmation}` : ""}</p>}
            {report.cornerView.records.done && <p className="m-0 text-ink2" data-testid="report-corner-done">Pekerjaan Corner: {report.cornerView.records.done.cornerWork || "—"}{report.cornerView.records.done.noDifference ? " · tidak ada perbedaan" : report.cornerView.records.done.differenceNote ? ` · perbedaan: ${report.cornerView.records.done.differenceNote}` : ""}</p>}
          </Card>
        )}
        {report.sequence?.length > 0 && <Card className="space-y-2 p-4" data-testid="report-sequence"><p className="m-0 text-[13px] font-bold text-ink">Rangkaian dokumentasi</p><DocSequence sequence={report.sequence} /></Card>}
        <div className="grid gap-3 md:grid-cols-3">
          <Card className="space-y-1 p-4 text-[12.5px]"><p className="font-bold text-ink">Unit</p><p className="text-ink2">{[report.unit.merk, report.unit.ukuran].filter(Boolean).join(" · ") || "—"}</p><p className="text-ink2">{report.unit.service || "Layanan —"}</p><p className="text-ink3">{report.pic.station}</p></Card>
          <Card className="space-y-1 p-4 text-[12.5px]"><p className="font-bold text-ink">PIC</p><p className="text-ink2">Meja: {report.pic.table || "—"}</p><p className="text-ink2">Corner: {report.pic.corner || "—"}</p><p className="text-ink2">Sales: {report.pic.sales || "—"}</p></Card>
          <Card className="space-y-1 p-4 text-[12.5px]"><p className="font-bold text-ink">Hasil</p><p className="text-ink2">Uji akhir: {report.finalTest ? `${VERDICT[report.finalTest.verdict]} (${report.finalTest.testerWeightKg} kg)` : "—"}</p><p className="text-ink2" data-testid="report-qc">QC: {report.qc ? (report.qc.result === "PASS" ? "Lulus" : report.qc.result) : report.qcStatus === "TIDAK_DILAKUKAN" ? "Tidak dilakukan (mode adaptasi)" : "—"}</p><p className="text-ink2">Gudang: {report.handoffStatus === "ACCEPTED" ? "Diterima" : report.handoffStatus ? "Menunggu diterima" : report.adaptation && report.status === "COMPLETED" ? "Tidak diwajibkan (mode adaptasi)" : "—"}</p></Card>
        </div>
        {report.skippedSteps?.length > 0 && (
          <Card className="space-y-1 p-4 text-[12.5px]" data-testid="report-skipped">
            <p className="font-bold text-ink">Tahap dilewati (Adaptasi sistem)</p>
            <p className="text-ink3">Tahap berikut tidak dikerjakan — tanpa foto atau hasil uji, dan tidak dihitung sebagai pekerjaan.</p>
            <ul className="m-0 list-none space-y-0.5 p-0">{report.skippedSteps.map((s) => <li key={s.stepNo} className="text-ink2">{s.stepNo}. {s.label} — Dilewati{s.by ? ` oleh ${s.by}` : ""}</li>)}</ul>
          </Card>
        )}
        <Card className="space-y-2 p-4 text-[13px]">
          <p className="font-bold text-ink">Ringkasan diagnosa</p>
          {report.order.complaints.length > 0 && <p className="text-ink2"><b>Keluhan:</b> {report.order.complaints.join(", ")}</p>}
          {report.measurement && report.measurement.heightBeforeCm != null && !report.components?.measurements?.recorded?.foundation && <p className="text-ink2"><b>Uji fondasi lama:</b> beban {report.measurement.testerWeightKg} kg, {report.measurement.heightBeforeCm} → {report.measurement.heightCompressedCm} cm (penurunan {report.measurement.dropCm} cm)</p>}
          <PreTestBlock measurements={report.components?.measurements} assembly={report.components?.assembly} />
          {report.diagnosis && <p className="text-ink2"><b>Diagnosa:</b> {report.diagnosis}</p>}
          <p className="text-ink2"><b>Fondasi baru:</b> {report.materials.foundation.map((m) => `${m.name} (${m.qty})`).join(", ") || "—"}</p>
          <p className="text-ink2"><b>Lapisan baru:</b> {report.materials.layer.map((m) => `${m.name} (${m.qty})`).join(", ") || "—"}</p>
          {report.textureTests.length > 1 && <p className="text-ink2"><b>Riwayat uji tekstur:</b> {report.textureTests.map((t) => VERDICT[t.verdict]).join(" → ")}</p>}
          {report.finishing && <p className="text-ink2"><b>Finishing:</b> {STYLE[report.finishing.mattressStyle]} · kain {report.finishing.fabricSpec} · list {report.finishing.borderColor}</p>}
        </Card>
        {report.components && (
          <Card className="space-y-3 p-4" data-testid="report-components">
            <p className="font-bold text-ink">Komponen: Sebelum → Sesudah</p>
            <JourneySummary data={{ measurements: report.components.measurements, comparison: report.components.comparison, assembly: report.components.assembly }} />
            <BeforeAfterSummary comparison={report.components.comparison} />
            {report.components.mediaCount > 0 && (
              <div className="space-y-3">
                <Gallery title="Foto komponen — sebelum dibongkar" items={report.components.media.before.map((m) => ({ ...m, url: m.previewUrl, stepLabel: "Catatan komponen", documentation: true }))} />
                <Gallery title="Foto komponen — sesudah" items={report.components.media.after.map((m) => ({ ...m, url: m.previewUrl, stepLabel: "Catatan komponen", documentation: true }))} />
              </div>
            )}
          </Card>
        )}
        <Card className="space-y-4 p-4">
          <Gallery title="Before" items={report.media.before} />
          <Gallery title="Proses" items={report.media.process} />
          <Gallery title="After" items={report.media.after} />
        </Card>
        <Card className="p-4">
          <p className="mb-2 text-[13px] font-bold text-ink">Pratinjau pesan untuk grup & PIC Sales</p>
          <pre className="whitespace-pre-wrap rounded-btn bg-inset p-3 font-sans text-[12.5px] text-ink2">{absoluteMessage}</pre>
        </Card>
      </PageBody>
    </PageContainer>
  );
}
