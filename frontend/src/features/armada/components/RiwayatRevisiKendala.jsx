import React, { useState } from "react";
import { Undo2, AlertTriangle, Plus } from "lucide-react";
import StatusBadge from "./StatusBadge.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { REVISION_STATUS, REVISION_TRIGGER } from "../revisionStatus.js";
import { ISSUE_STATUS } from "../issueStatus.js";
import { formatTanggal } from "@/utils/formatDate.js";
import {
  CATEGORY_LABEL, STATUS_LABEL, STATUS_TONE, OWNER_LABEL,
} from "@/features/complaints/complaintLabels.js";
import NewComplaintCaseForm from "@/features/complaints/NewComplaintCaseForm.jsx";

// Riwayat Revisi (Retur) & Kendala/Reschedule — SATU komponen, dipakai
// BERSAMA oleh 2 drawer yang beda konteks tapi HARUS menunjukkan data
// yang SAMA PERSIS (10 September 2026, permintaan owner setelah kasus
// Richard RES-30082026-201: "source code harus link dengan semua divisi
// ya, yang berarti source code harus sama, seperti di tab semua order"):
//   - OrderTimelineDrawer.jsx ("Rincian Order", dipakai Sales/Produksi/
//     Delivery lewat halaman Order masing-masing).
//   - JobDetailDrawer.jsx (Jadwal & Penugasan/Route Planner, dibuka dari
//     JOB — sebelumnya cuma bilang "riwayat aktivitas belum tersedia").
// SEMUA data dari SATU endpoint (GET /orders/:id/timeline) — pemanggil
// cukup lempar hasil fetch itu apa adanya sebagai props, bukan meracik
// bentuk data sendiri-sendiri yang bisa diam-diam menyimpang.
//
// Derive status ringkas job kendala/reschedule — SAMA logika dengan
// deriveIssueStatus() di backend/src/routes/armada.js, disalin ringkas di
// sini alih-alih backend mengirim field turunan lagi.
// rescheduleCaseId (D-160, 13 September 2026) — OR tambahan, sama alasan
// dengan backend deriveIssueStatus (armada.js): jalur PROACTIVE sekarang
// ikut menulis rescheduleReason juga, tapi job LAMA (sebelum perbaikan
// ini) cuma punya rescheduleCase.
export function issueStatusOf(j) {
  const pernahDireschedule = !!(j.rescheduleReason || j.rescheduleCase);
  if (j.status === "FAILED") return pernahDireschedule ? "RESCHEDULED" : "OPEN";
  if (pernahDireschedule) return "RESCHEDULED";
  return null;
}

export default function RiwayatRevisiKendala({
  revisions = [], issueJobs = [], complaintCases = [], hasComplaint = false, complaintDetail = null, complaintDate = null,
  className = "",
  onOpenComplaintCase,
  // orderId (12 September 2026, D-116 — laporan owner: "untuk input
  // komplain belum ada, harus buka chat > klik order nya > isi komplain")
  // — OPSIONAL, cuma diisi pemanggil yang tahu order-nya (semua pemanggil
  // saat ini SUDAH tahu, lihat OrderTimelineDrawer.jsx/JobDetailDrawer.jsx).
  // Kalau diisi, tombol "+ Buka Kasus" SELALU tampil di sini — sebelum ini
  // seksi ini cuma BACA (revisions/issueJobs/complaintCases dari props),
  // dan bahkan HILANG TOTAL kalau order belum pernah komplain sama sekali
  // (lihat `kosong` di bawah) — jadi walau order ini dibuka dari Semua
  // Order Delivery/Produksi/B2B atau Jadwal & Penugasan, TIDAK ADA jalan
  // membuka kasus baru dari sana. Sekarang ADA, di SATU tempat yang sudah
  // dipakai 6 halaman sekaligus (lihat catatan berkas di atas).
  orderId, unitId, onCaseCreated,
}) {
  const [showForm, setShowForm] = useState(false);
  const kosong = revisions.length === 0 && issueJobs.length === 0 && complaintCases.length === 0;
  if (kosong && !hasComplaint && !orderId) return null;

  return (
    <div className={className}>
      <div className="mb-2 flex items-center gap-1.5">
        <h4 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-ink3">
          <Undo2 size={12} aria-hidden /> Revisi & Kendala
        </h4>
        {orderId && (
          <button
            type="button" onClick={() => setShowForm((v) => !v)}
            className="ml-auto flex items-center gap-1 text-[11px] font-bold text-accent hover:underline"
          >
            <Plus size={11} /> Buka Kasus
          </button>
        )}
      </div>

      {showForm && (
        <div className="mb-2">
          <NewComplaintCaseForm
            orderId={orderId} unitId={unitId}
            onCreated={() => { setShowForm(false); onCaseCreated?.(); }}
            onCancel={() => setShowForm(false)}
          />
        </div>
      )}

      <div className="flex flex-col gap-2">
        {/* Complaint Case (D-116, 11 September 2026) — kasus lintas divisi
            yang SUDAH actionable (Delivery Task/Material Requirement/dst),
            BEDA dari fallback statis di bawah ("belum masuk sistem Retur")
            yang cuma menandai hasComplaint TANPA riwayat nyata. Kalau kasus
            ini ADA, itu SUDAH cukup untuk membuktikan komplain sedang
            ditangani — fallback di bawah otomatis tidak tampil lagi
            (lihat `kosong` di atas). */}
        {complaintCases.map((c) => (
          <button
            key={c.id} type="button"
            onClick={onOpenComplaintCase ? () => onOpenComplaintCase(c.id) : undefined}
            disabled={!onOpenComplaintCase}
            className="rounded-xl border-l-[3px] border-red bg-surface p-2.5 text-left shadow-card disabled:cursor-default"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-[10.5px] font-bold text-ink">{c.caseNumber}</span>
                <Badge variant={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status] || c.status}</Badge>
                <Badge variant="neutral">{CATEGORY_LABEL[c.category] || c.category}</Badge>
              </div>
              <span className="shrink-0 text-[10.5px] text-ink3">Pemegang: {OWNER_LABEL[c.currentOwner] || c.currentOwner}</span>
            </div>
            <p className="mt-1.5 text-[12px] leading-relaxed text-ink">{c.description}</p>
            <p className="mt-1.5 text-[10.5px] text-ink3">{formatTanggal(c.createdAt)}</p>
          </button>
        ))}

        {revisions.map((r) => (
          <div key={r.id} className="rounded-xl border-l-[3px] border-accent bg-surface p-2.5 shadow-card">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <StatusBadge map={REVISION_TRIGGER} value={r.trigger} />
                <StatusBadge map={REVISION_STATUS} value={r.status} />
              </div>
              {r.unit?.unitCode && <span className="font-mono text-[10.5px] text-ink3">{r.unit.unitCode}</span>}
            </div>
            <p className="mt-1.5 text-[12px] leading-relaxed text-ink">{r.complaint}</p>
            {r.note && <p className="mt-1 text-[11px] italic leading-relaxed text-ink2">Catatan tim: {r.note}</p>}
            <p className="mt-1.5 text-[10.5px] text-ink3">
              {formatTanggal(r.createdAt)}{r.createdBy?.name && ` · diajukan oleh ${r.createdBy.name}`}
            </p>
          </div>
        ))}

        {issueJobs.map((j) => {
          const status = issueStatusOf(j);
          return (
            <div key={j.id} className="rounded-xl border-l-[3px] border-orange bg-surface p-2.5 shadow-card">
              <div className="flex items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11.5px] font-semibold text-ink">
                    {j.type === "PICKUP" ? "Pengambilan" : "Pengiriman"} gagal/dijadwalkan ulang
                  </span>
                  {/* Kasus reschedule tersatukan (D-160, 13 September 2026) —
                      nomor kasus + ronde ke berapa, supaya "sudah berapa kali
                      job ini gagal->dijadwalkan ulang" langsung kelihatan
                      tanpa menghitung manual dari histori. */}
                  {j.rescheduleCase && (
                    <span className="font-mono text-[10px] font-bold text-ink3">
                      {j.rescheduleCase.caseNumber}{j.rescheduleCase.round > 1 ? ` · ronde ${j.rescheduleCase.round}` : ""}
                    </span>
                  )}
                </div>
                <StatusBadge map={ISSUE_STATUS} value={status} />
              </div>
              {j.failureReason && <p className="mt-1 text-[12px] leading-relaxed text-ink">Alasan gagal: {j.failureReason}</p>}
              {j.rescheduleReason && <p className="mt-1 text-[12px] leading-relaxed text-ink">{j.rescheduleReason}</p>}
              <p className="mt-1.5 text-[10.5px] text-ink3">
                {j.rescheduledAt && formatTanggal(j.rescheduledAt)}
                {j.rescheduledBy?.name && ` · oleh ${j.rescheduledBy.name}`}
                {j.customerConfirmedReschedule && " · pelanggan sudah konfirmasi"}
              </p>
            </div>
          );
        })}

        {/* Fallback: hasComplaint sales flag TANPA revisi/job kendala
            tertaut (mis. baru dilaporkan, belum masuk sistem Retur sama
            sekali) — tetap tampil supaya tidak hilang dari radar. */}
        {kosong && hasComplaint && (
          <div className="flex items-start gap-2 rounded-xl bg-redbg px-3 py-2.5">
            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-red" />
            <div>
              <p className="text-[12px] font-bold text-red">Ada komplain (belum masuk sistem Retur)</p>
              {complaintDetail && <p className="mt-1 text-[11px] leading-relaxed text-ink">{complaintDetail}</p>}
              {complaintDate && <p className="mt-1 text-[11px] text-ink3">{formatTanggal(complaintDate)}</p>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
