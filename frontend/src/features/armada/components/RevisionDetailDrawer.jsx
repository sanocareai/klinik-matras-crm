import React, { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Loader2, Save } from "lucide-react";
import { api } from "@/api.js";
import StatusBadge from "./StatusBadge.jsx";
import { REVISION_STATUS, REVISION_TRIGGER, customerOfUnit } from "../revisionStatus.js";

// Alur status berurutan (tidak menghitung CANCELLED, yang bisa dari mana
// saja) — dipakai untuk membatasi pilihan "langkah berikutnya" di dropdown
// supaya dispatcher tidak bisa melompat status secara tidak masuk akal.
const FLOW = ["REQUESTED", "PICKUP_SCHEDULED", "IN_REWORK", "READY_REDELIVER", "REDELIVERED", "CONFIRMED"];

export default function RevisionDetailDrawer({ revision, onClose, onChanged }) {
  const [status, setStatus] = useState("");
  const [jobId, setJobId] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!revision) return;
    setStatus(revision.status);
    setJobId(revision.jobId || "");
    setNote(revision.note || "");
    setError("");
  }, [revision]);

  if (!revision) return null;
  const selesai = revision.status === "CONFIRMED" || revision.status === "CANCELLED";
  const currentIdx = FLOW.indexOf(revision.status);
  const nextOptions = FLOW.slice(Math.max(currentIdx, 0));

  async function simpan() {
    if (status === "CANCELLED" && !note.trim()) { setError("Alasan pembatalan wajib diisi"); return; }
    setBusy(true);
    setError("");
    try {
      await api.updateRevision(revision.id, { status, jobId: jobId || null, note: note || null });
      onChanged();
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open={!!revision} onOpenChange={(o) => (o ? null : onClose())}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[200] bg-black/30 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content
          aria-label="Detail Revisi"
          className="fixed right-0 top-0 z-[201] flex h-full w-full flex-col bg-surface shadow-2xl outline-none data-[state=open]:animate-in data-[state=open]:slide-in-from-right sm:w-[420px]"
        >
          <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-3">
            <Dialog.Title className="text-[15px] font-bold text-ink">Detail Revisi</Dialog.Title>
            <StatusBadge map={REVISION_STATUS} value={revision.status} />
            <Dialog.Close aria-label="Tutup" className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg text-ink3 hover:bg-hovertint hover:text-ink">
              <X size={16} />
            </Dialog.Close>
          </div>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
            <div>
              <p className="text-[13px] font-semibold text-ink">{revision.unit?.unitCode}</p>
              <p className="text-[11.5px] text-ink2">{customerOfUnit(revision.unit) || "—"} · {revision.unit?.order?.orderNumber}</p>
              <p className="text-[11.5px] text-ink2">{revision.unit?.merk} · {revision.unit?.ukuran}</p>
            </div>

            <div className="flex items-center gap-2">
              <StatusBadge map={REVISION_TRIGGER} value={revision.trigger} />
              <span className="text-[11px] text-ink3">diajukan {new Date(revision.createdAt).toLocaleDateString("id-ID")} oleh {revision.createdBy?.name || "—"}</span>
            </div>

            <div className="rounded-btn border-l-[3px] border-orange bg-orangebg px-3 py-2.5">
              <div className="text-[10px] font-bold uppercase tracking-wide text-orange">Keluhan Pelanggan</div>
              <p className="mt-0.5 text-[12.5px] text-ink">{revision.complaint}</p>
            </div>

            {revision.job && (
              <div className="rounded-btn border border-border px-3 py-2.5">
                <div className="text-[10px] font-bold uppercase tracking-wide text-ink3">Job Terkait</div>
                <p className="mt-0.5 text-[12.5px] text-ink">{revision.job.type === "PICKUP" ? "Jemput" : "Antar"} · {revision.job.driver?.name || "Belum ada driver"}</p>
                <p className="text-[11px] text-ink2">
                  {revision.job.scheduledDate ? new Date(revision.job.scheduledDate).toLocaleDateString("id-ID") : "Belum dijadwalkan"}
                </p>
              </div>
            )}

            {!selesai && (
              <div className="space-y-3 border-t border-line pt-3">
                <div>
                  <label className="mb-1 block text-[11.5px] font-semibold text-ink2">Job ID (opsional)</label>
                  <input
                    type="text" value={jobId} onChange={(e) => setJobId(e.target.value)}
                    placeholder="Tempelkan ID job jemput/antar dari Jadwal & Penugasan"
                    className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12px] text-ink outline-none placeholder:text-ink3 focus:border-accent"
                  />
                  <p className="mt-1 text-[10.5px] text-ink3">
                    Buat job jemput/antar seperti biasa lewat Jadwal & Penugasan, lalu tempelkan ID-nya di sini.
                  </p>
                </div>

                <div>
                  <label className="mb-1 block text-[11.5px] font-semibold text-ink2">Status</label>
                  <select value={status} onChange={(e) => setStatus(e.target.value)}
                    className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-accent">
                    {nextOptions.map((s) => <option key={s} value={s}>{REVISION_STATUS[s].label}</option>)}
                    <option value="CANCELLED">{REVISION_STATUS.CANCELLED.label}</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-[11.5px] font-semibold text-ink2">
                    Catatan {status === "CANCELLED" ? "(alasan pembatalan) *" : "(opsional)"}
                  </label>
                  <textarea
                    value={note} onChange={(e) => setNote(e.target.value)}
                    placeholder="mis. sudah ditambah lapisan latex 2cm di area pinggul"
                    rows={3}
                    className="w-full rounded-btn border border-border bg-surface px-2.5 py-2 text-[12.5px] text-ink outline-none placeholder:text-ink3 focus:border-accent"
                  />
                </div>
              </div>
            )}

            {selesai && revision.note && (
              <div className="border-t border-line pt-3">
                <div className="text-[10px] font-bold uppercase tracking-wide text-ink3">Catatan Akhir</div>
                <p className="mt-0.5 text-[12.5px] text-ink">{revision.note}</p>
              </div>
            )}
          </div>

          {!selesai && (
            <div className="shrink-0 border-t border-line p-3">
              {error && <p className="mb-2 text-[12px] text-red">{error}</p>}
              <button
                type="button" onClick={simpan} disabled={busy}
                className="flex w-full items-center justify-center gap-1.5 rounded-btn bg-accent py-2 text-[12.5px] font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Simpan
              </button>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
