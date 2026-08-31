import React, { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Check, XCircle, Loader2, User, Package } from "lucide-react";
import { api } from "@/api.js";
import { cn } from "@/lib/utils.js";
import StatusBadge from "./StatusBadge.jsx";
import { POD_STATUS } from "../podStatus.js";
import { customerOf, orderNumberOf, unitCountOf, jobLabelOf } from "../jobStatus.js";

// Drawer review Proof of Delivery — Approve / Reject atas foto & tanda
// tangan yang SUDAH diunggah driver. Tidak ada "checklist penyelesaian" di
// sini (lihat catatan panjang di ArmadaPod.jsx): aplikasi driver tidak pernah
// mengumpulkan checklist, jadi menampilkannya di sini akan jadi UI kosong
// yang tidak pernah bisa diisi siapa pun.
export default function PodReviewDrawer({ job, onClose, onChanged }) {
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!job) return null;
  const status = job.derivedPodStatus;
  const bisaDitinjau = status === "PENDING_REVIEW" || status === "REJECTED";

  async function verifikasi() {
    setBusy(true);
    setError("");
    try {
      await api.verifyPod(job.id);
      onChanged();
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function tolak() {
    if (!note.trim()) { setError("Alasan penolakan wajib diisi"); return; }
    setBusy(true);
    setError("");
    try {
      await api.rejectPod(job.id, note);
      onChanged();
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open={!!job} onOpenChange={(o) => (o ? null : onClose())}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[200] bg-black/30 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content
          aria-label="Review Proof of Delivery"
          className="fixed right-0 top-0 z-[201] flex h-full w-full flex-col bg-surface shadow-2xl outline-none data-[state=open]:animate-in data-[state=open]:slide-in-from-right sm:w-[460px]"
        >
          <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-3">
            <Dialog.Title className="text-[15px] font-bold text-ink">Review Bukti</Dialog.Title>
            <StatusBadge map={POD_STATUS} value={status} />
            <Dialog.Close aria-label="Tutup" className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg text-ink3 hover:bg-hovertint hover:text-ink">
              <X size={16} />
            </Dialog.Close>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wide text-ink3">
              <User size={12} aria-hidden /> Pelanggan
            </div>
            <p className="mt-0.5 text-[13px] font-semibold text-ink">{customerOf(job) || "—"}</p>
            <p className="text-[11.5px] text-ink2">{jobLabelOf(job)} · {unitCountOf(job)} unit</p>

            <div className="mt-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wide text-ink3">
              <Package size={12} aria-hidden /> Waktu selesai
            </div>
            <p className="mt-0.5 text-[13px] text-ink">
              {job.completedAt
                ? new Date(job.completedAt).toLocaleString("id-ID", { dateStyle: "long", timeStyle: "short" })
                : "Belum selesai"}
            </p>
            <p className="text-[11.5px] text-ink2">Driver: {job.driver?.name || "—"}</p>

            <div className="mt-4 border-t border-line pt-3">
              <h4 className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-ink3">Foto Bukti</h4>
              {job.proofPhotoUrls?.length > 0 ? (
                <div className="grid grid-cols-3 gap-2">
                  {job.proofPhotoUrls.map((src) => (
                    <a key={src} href={src} target="_blank" rel="noreferrer">
                      <img src={src} alt="" className="aspect-square w-full rounded-btn border border-border object-cover" />
                    </a>
                  ))}
                </div>
              ) : (
                <p className="text-[12px] text-ink3">Belum ada foto — driver belum menyelesaikan job ini.</p>
              )}
            </div>

            <div className="mt-4">
              <h4 className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-ink3">Tanda Tangan Penerima</h4>
              {job.signatureUrl ? (
                <img src={job.signatureUrl} alt="Tanda tangan" className="h-20 rounded-btn border border-border bg-white object-contain px-2" />
              ) : (
                <p className="text-[12px] text-ink3">Tidak ada tanda tangan — customer/penerima tidak di tempat (opsional).</p>
              )}
            </div>

            {job.podStatus === "REJECTED" && job.podRejectionNote && (
              <div className="mt-4 rounded-btn border-l-[3px] border-red bg-redbg px-3 py-2.5">
                <div className="text-[10px] font-bold uppercase tracking-wide text-red">Alasan penolakan sebelumnya</div>
                <p className="mt-0.5 text-[12.5px] text-ink">{job.podRejectionNote}</p>
                {job.podVerifiedBy && (
                  <p className="mt-1 text-[10.5px] text-ink3">
                    oleh {job.podVerifiedBy.name} · {new Date(job.podVerifiedAt).toLocaleDateString("id-ID")}
                  </p>
                )}
              </div>
            )}

            {status === "VERIFIED" && job.podVerifiedBy && (
              <p className="mt-4 text-[11.5px] text-ink3">
                Diverifikasi oleh {job.podVerifiedBy.name} · {new Date(job.podVerifiedAt).toLocaleDateString("id-ID")}
              </p>
            )}

            <p className="mt-5 border-t border-line pt-3 text-[11px] leading-relaxed text-ink3">
              Nama penerima, checklist penyelesaian, dan koordinat lokasi selesai
              belum tersedia — aplikasi driver belum mengumpulkan data itu.
            </p>
          </div>

          {bisaDitinjau && (
            <div className="shrink-0 border-t border-line p-3">
              {error && <p className="mb-2 text-[12px] text-red">{error}</p>}
              {rejecting ? (
                <div className="space-y-2">
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Apa yang perlu diperbaiki? (mis. foto buram, belum ada tanda tangan)"
                    rows={3}
                    className="w-full rounded-btn border border-border bg-surface px-2.5 py-2 text-[12.5px] text-ink outline-none focus:border-accent"
                  />
                  <div className="flex justify-end gap-2">
                    <button type="button" onClick={() => { setRejecting(false); setNote(""); }} className="rounded-btn px-3 py-1.5 text-[12px] font-semibold text-ink2 hover:bg-hovertint">
                      Batal
                    </button>
                    <button
                      type="button"
                      onClick={tolak}
                      disabled={busy}
                      className="flex items-center gap-1 rounded-btn bg-red px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-50"
                    >
                      {busy ? <Loader2 size={12} className="animate-spin" /> : <XCircle size={12} />} Kirim Penolakan
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setRejecting(true)}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-btn border border-border py-2 text-[12.5px] font-bold text-ink2 transition-colors hover:bg-redbg hover:text-red"
                  >
                    <XCircle size={14} /> Tolak
                  </button>
                  <button
                    type="button"
                    onClick={verifikasi}
                    disabled={busy}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-btn bg-accent py-2 text-[12.5px] font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Verifikasi
                  </button>
                </div>
              )}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
