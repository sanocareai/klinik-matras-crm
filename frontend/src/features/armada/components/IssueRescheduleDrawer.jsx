import React, { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, CalendarClock, Loader2, Undo2 } from "lucide-react";
import { api } from "@/api.js";
import StatusBadge from "./StatusBadge.jsx";
import { ISSUE_STATUS } from "../issueStatus.js";
import { customerOf, orderNumberOf, jobLabelOf } from "../jobStatus.js";

// Drawer reschedule — satu-satunya jalan keluar dari status FAILED (lihat
// catatan panjang di backend/src/routes/armada.js POST /issues/:jobId/reschedule).
// Job yang statusnya sudah lewat dari FAILED (sudah pernah dijadwalkan ulang)
// tampil read-only di sini — reschedule kedua kali belum didukung backend.
//
// onAjukanRevisi (10 September 2026, kasus Richard RES-30082026-201) — job
// COMPLETED yang dikasih catatan reschedule retroaktif (JobDetailDrawer)
// SEBELUM ini jalan buntu total di sini: cuma pesan "lihat status di Jadwal
// & Penugasan" tanpa aksi apa pun, padahal kasus nyatanya (customer QC saat
// antar & minta revisi) butuh unit diambil-revisi-antar ulang — jalur yang
// SUDAH ADA (Retur/UnitRevision, sistem sama yang dipakai klaim garansi/
// trial kenyamanan) cuma tidak pernah tersambung ke sini. Tombol ini
// membuka RevisionRequestDrawer langsung dengan unit job ini (lihat
// ArmadaIssues.jsx) — bukan mesin baru, cuma jembatan ke yang sudah ada.
export default function IssueRescheduleDrawer({ job, onClose, onChanged, onAjukanRevisi }) {
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
            <p className="text-[11.5px] text-ink2">{jobLabelOf(job)}</p>

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

            {/* Riwayat lengkap (9 September 2026, D-110) — kotak "Alasan
                Gagal"/"Riwayat Reschedule" di atas cuma menampilkan SIKLUS
                TERAKHIR (field tunggal di Job). Job yang gagal LEBIH dari
                sekali (gagal -> reschedule -> gagal lagi -> reschedule lagi)
                kehilangan jejak siklus pertamanya di sana — timeline ini
                yang menyimpan semuanya (JobIssueLog, append-only). Cuma
                ditampilkan kalau ada LEBIH dari 1 baris — kalau cuma 1,
                sudah terwakili penuh oleh kotak di atas, menampilkan lagi
                di sini cuma duplikasi. */}
            {job.issueLogs?.length > 1 && (
              <div className="mt-3 border-t border-line pt-3">
                <h4 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-ink3">
                  Riwayat Lengkap ({job.issueLogs.length})
                </h4>
                <div className="space-y-2">
                  {job.issueLogs.map((log) => (
                    <div key={log.id} className="rounded-btn border border-border px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className={`text-[11px] font-bold ${log.type === "FAILED" ? "text-red" : "text-orange"}`}>
                          {log.type === "FAILED" ? "❌ Gagal" : "🔄 Dijadwalkan Ulang"}
                        </span>
                        <span className="shrink-0 text-[10.5px] text-ink3">
                          {new Date(log.createdAt).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                      {log.type === "FAILED" ? (
                        <p className="mt-1 text-[12px] text-ink">{log.failureReason}</p>
                      ) : (
                        <>
                          <p className="mt-1 text-[12px] text-ink">{log.rescheduleReason}</p>
                          {log.previousScheduledDate && log.newScheduledDate && (
                            <p className="text-[10.5px] text-ink3">
                              {new Date(log.previousScheduledDate).toLocaleDateString("id-ID")} → {new Date(log.newScheduledDate).toLocaleDateString("id-ID")}
                              {log.cause === "PROACTIVE" ? " · proaktif" : " · setelah gagal"}
                            </p>
                          )}
                          {log.customerConfirmed && (
                            <p className="text-[10.5px] font-semibold text-orange">Pelanggan sudah konfirmasi.</p>
                          )}
                        </>
                      )}
                      {log.createdBy && <p className="mt-1 text-[10px] text-ink3">oleh {log.createdBy.name}</p>}
                    </div>
                  ))}
                </div>
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
              <div className="mt-4 space-y-3 border-t border-line pt-3">
                <p className="text-[11.5px] leading-relaxed text-ink3">
                  Job ini sudah dijadwalkan ulang dan tidak lagi berstatus Gagal —
                  lihat status terbaru di halaman Jadwal & Penugasan.
                </p>
                {/* COMPLETED + catatan reschedule = kemungkinan besar kasus
                    "customer minta revisi setelah barang sudah dikirim"
                    (lihat komentar onAjukanRevisi di atas) — job ITU SENDIRI
                    tidak bisa dijadwalkan ulang (memang sudah selesai), tapi
                    unit-nya bisa diajukan Retur supaya ada jalan ke job
                    pengiriman baru. */}
                {job.status === "COMPLETED" && onAjukanRevisi && (
                  <button
                    type="button"
                    onClick={() => onAjukanRevisi(job)}
                    className="flex w-full items-center justify-center gap-1.5 rounded-btn border border-accent bg-accentbg py-2 text-[12.5px] font-bold text-accent transition-opacity hover:opacity-90"
                  >
                    <Undo2 size={14} /> Ajukan Revisi (Retur)
                  </button>
                )}
              </div>
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
