import React, { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, CalendarClock, Loader2 } from "lucide-react";
import { api } from "@/api.js";
import StatusBadge from "./StatusBadge.jsx";
import { ISSUE_STATUS } from "../issueStatus.js";
import { customerOf, orderNumberOf } from "../jobStatus.js";

// Drawer reschedule — satu-satunya jalan keluar dari status FAILED (lihat
// catatan panjang di backend/src/routes/armada.js POST /issues/:jobId/reschedule).
// Job yang statusnya sudah lewat dari FAILED (sudah pernah dijadwalkan ulang)
// tampil read-only di sini — reschedule kedua kali belum didukung backend.
export default function IssueRescheduleDrawer({ job, onClose, onChanged }) {
  const [drivers, setDrivers] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [scheduledDate, setScheduledDate] = useState("");
  const [timeWindow, setTimeWindow] = useState("");
  const [driverId, setDriverId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [reason, setReason] = useState("");
  const [customerConfirmed, setCustomerConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!job) return;
    setScheduledDate("");
    setTimeWindow("");
    setDriverId("");
    setVehicleId("");
    setReason("");
    setCustomerConfirmed(false);
    setError("");
    api.getDrivers().then(setDrivers).catch(() => {});
    api.getVehicles().then((d) => setVehicles(d.vehicles)).catch(() => {});
  }, [job]);

  if (!job) return null;
  const bisaDijadwalkanUlang = job.status === "FAILED";

  async function simpan() {
    if (!scheduledDate) { setError("Tanggal baru wajib diisi"); return; }
    if (!reason.trim()) { setError("Alasan reschedule wajib diisi"); return; }
    setBusy(true);
    setError("");
    try {
      await api.rescheduleIssue(job.id, {
        scheduledDate,
        timeWindow: timeWindow || undefined,
        driverId: driverId || undefined,
        vehicleId: vehicleId || undefined,
        reason,
        customerConfirmed,
      });
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
          aria-label="Jadwalkan ulang job"
          className="fixed right-0 top-0 z-[201] flex h-full w-full flex-col bg-surface shadow-2xl outline-none data-[state=open]:animate-in data-[state=open]:slide-in-from-right sm:w-[440px]"
        >
          <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-3">
            <Dialog.Title className="text-[15px] font-bold text-ink">Kendala Job</Dialog.Title>
            <StatusBadge map={ISSUE_STATUS} value={job.issueStatus} />
            <Dialog.Close aria-label="Tutup" className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg text-ink3 hover:bg-hovertint hover:text-ink">
              <X size={16} />
            </Dialog.Close>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            <p className="text-[13px] font-semibold text-ink">{customerOf(job) || "—"}</p>
            <p className="text-[11.5px] text-ink2">{orderNumberOf(job)} · {job.id.slice(0, 8)}</p>

            <div className="mt-3 rounded-btn border-l-[3px] border-red bg-redbg px-3 py-2.5">
              <div className="text-[10px] font-bold uppercase tracking-wide text-red">Alasan Gagal</div>
              <p className="mt-0.5 text-[12.5px] text-ink">{job.failureReason || "—"}</p>
              {job.failurePhotoUrls?.length > 0 && (
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {job.failurePhotoUrls.map((src) => (
                    <a key={src} href={src} target="_blank" rel="noreferrer">
                      <img src={src} alt="" className="aspect-square w-full rounded-btn border border-border object-cover" />
                    </a>
                  ))}
                </div>
              )}
            </div>

            {job.rescheduleReason && (
              <div className="mt-3 rounded-btn border-l-[3px] border-orange bg-orangebg px-3 py-2.5">
                <div className="text-[10px] font-bold uppercase tracking-wide text-orange">Riwayat Reschedule</div>
                <p className="mt-0.5 text-[12.5px] text-ink">{job.rescheduleReason}</p>
                {job.rescheduledBy && (
                  <p className="mt-1 text-[10.5px] text-ink3">
                    oleh {job.rescheduledBy.name} · {new Date(job.rescheduledAt).toLocaleDateString("id-ID")}
                  </p>
                )}
                {job.customerConfirmedReschedule && (
                  <p className="mt-1 text-[10.5px] font-semibold text-orange">Pelanggan sudah konfirmasi jadwal baru.</p>
                )}
              </div>
            )}

            {bisaDijadwalkanUlang ? (
              <div className="mt-4 space-y-3 border-t border-line pt-3">
                <h4 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-ink3">
                  <CalendarClock size={12} aria-hidden /> Jadwalkan Ulang
                </h4>
                <div>
                  <label className="mb-1 block text-[11.5px] font-semibold text-ink2">Tanggal baru *</label>
                  <input
                    type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)}
                    className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-accent"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11.5px] font-semibold text-ink2">Jam (opsional)</label>
                  <input
                    type="text" value={timeWindow} onChange={(e) => setTimeWindow(e.target.value)}
                    placeholder="mis. 09:00–12:00"
                    className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none placeholder:text-ink3 focus:border-accent"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11.5px] font-semibold text-ink2">Driver (opsional)</label>
                  <select value={driverId} onChange={(e) => setDriverId(e.target.value)}
                    className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-accent">
                    <option value="">Belum ditugaskan</option>
                    {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[11.5px] font-semibold text-ink2">Kendaraan (opsional)</label>
                  <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}
                    className="w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-accent">
                    <option value="">Belum ditentukan</option>
                    {vehicles.map((v) => <option key={v.id} value={v.id}>{v.plateNumber}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[11.5px] font-semibold text-ink2">Alasan reschedule *</label>
                  <textarea
                    value={reason} onChange={(e) => setReason(e.target.value)}
                    placeholder="mis. pelanggan minta jadwal ulang besok siang"
                    rows={3}
                    className="w-full rounded-btn border border-border bg-surface px-2.5 py-2 text-[12.5px] text-ink outline-none placeholder:text-ink3 focus:border-accent"
                  />
                </div>
                <label className="flex items-center gap-2 text-[12px] text-ink2">
                  <input type="checkbox" checked={customerConfirmed} onChange={(e) => setCustomerConfirmed(e.target.checked)} />
                  Pelanggan sudah konfirmasi jadwal baru
                </label>
              </div>
            ) : (
              <p className="mt-4 border-t border-line pt-3 text-[11.5px] leading-relaxed text-ink3">
                Job ini sudah dijadwalkan ulang dan tidak lagi berstatus Gagal —
                lihat status terbaru di halaman Jadwal & Penugasan.
              </p>
            )}
          </div>

          {bisaDijadwalkanUlang && (
            <div className="shrink-0 border-t border-line p-3">
              {error && <p className="mb-2 text-[12px] text-red">{error}</p>}
              <button
                type="button"
                onClick={simpan}
                disabled={busy}
                className="flex w-full items-center justify-center gap-1.5 rounded-btn bg-accent py-2 text-[12.5px] font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : <CalendarClock size={14} />} Simpan Jadwal Baru
              </button>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
