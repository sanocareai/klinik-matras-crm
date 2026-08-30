import React, { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, MapPin, Phone, Package, Truck, User, Clock, Camera, Loader2 } from "lucide-react";
import { api } from "@/api.js";
import { cn } from "@/lib/utils.js";
import { Skeleton } from "@/components/ui/skeleton.jsx";
import { Button } from "@/components/ui/button.jsx";
import StatusBadge from "./StatusBadge.jsx";
import { JOB_STATUS_REAL, JOB_TYPE_REAL, EDITABLE_JOB_STATUSES, customerOf, orderNumberOf } from "../jobStatus.js";
import { performSubmit } from "@/utils/submitJobAction.js";

// Drawer detail job — data NYATA dari GET /armada/jobs/:id.
//
// Radix Dialog dipakai supaya focus trap, Escape, dan pengembalian fokus ke
// baris tabel benar tanpa ditulis manual — pola yang sama dengan
// NotificationDrawer.
//
// ⚠️ Hanya menampilkan field yang BENAR-BENAR ADA di backend. Spesifikasi
// menyebut Area, SLA, Priority, dan Activity Log; keempatnya belum ada di
// database (lihat FIELDS_NOT_IN_BACKEND di ../jobStatus.js). Menampilkan
// baris kosong berlabel "SLA: —" akan membuat orang mengira datanya hilang,
// padahal fiturnya memang belum ada — jadi barisnya tidak dirender sama
// sekali, dan yang belum ada disebut jujur di bagian bawah.
//
// SEJAK 30 Agustus 2026 (D-036): drawer ini TIDAK LAGI cuma menampilkan —
// dispatcher bisa assign driver/kendaraan/tanggal DAN menggerakkan status
// job (mulai/tiba/selesai/gagal) langsung dari sini, tanpa pindah ke mode
// "Papan" (Armada.jsx). Pola assign sama persis dengan JobCard di
// Armada.jsx (saveDriver/saveVehicle); aksi status pakai performSubmit dari
// utils/submitJobAction.js — fungsi yang SAMA yang dipakai driver di HP-nya
// sendiri (DriverJobs.jsx), supaya tidak ada dua implementasi upload
// foto+status yang bisa diam-diam berbeda. loadOwnedJob di backend memang
// SENGAJA mengizinkan admin/dispatcher bertindak atas nama driver ("boleh
// operasikan atas nama driver kalau perlu") — jalur ini bukan workaround.

function Baris({ icon: Icon, label, children }) {
  if (!children) return null;
  return (
    <div className="flex gap-2.5 py-2">
      {Icon && <Icon size={14} className="mt-0.5 shrink-0 text-ink3" aria-hidden />}
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-bold uppercase tracking-wide text-ink3">{label}</div>
        <div className="mt-0.5 text-[13px] text-ink">{children}</div>
      </div>
    </div>
  );
}

const selectClass =
  "h-9 w-full rounded-btn border border-border bg-surface px-2.5 text-[12.5px] text-ink outline-none transition-colors focus:border-accent";

// Form kecil utk aksi yang WAJIB foto (Selesaikan/Tandai Gagal) — backend
// menolak keras tanpa foto (FR-D-03/04/07, lihat armada.js), jadi form ini
// tidak bisa "disederhanakan" jadi tombol polos.
function AksiFotoForm({ label, needReason, busy, onCancel, onSubmit }) {
  const [files, setFiles] = useState([]);
  const [reason, setReason] = useState("");

  return (
    <div className="mt-2 rounded-btn border border-border bg-inset/40 p-2.5">
      {needReason && (
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Alasan gagal (wajib)"
          className="mb-2 h-9 w-full rounded-btn border border-border bg-surface px-2.5 text-[12.5px] text-ink outline-none focus:border-accent"
        />
      )}
      <input
        type="file" accept="image/*" multiple
        onChange={(e) => setFiles(Array.from(e.target.files || []))}
        className="block w-full text-[11.5px] text-ink2 file:mr-2 file:rounded-btn file:border-0 file:bg-accentbg file:px-2.5 file:py-1.5 file:text-[11.5px] file:font-semibold file:text-accent"
      />
      <div className="mt-2 flex gap-2">
        <Button
          size="sm"
          disabled={busy || files.length === 0 || (needReason && !reason.trim())}
          onClick={() => onSubmit({ files, reason: reason.trim() })}
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : label}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>Batal</Button>
      </div>
    </div>
  );
}

export default function JobDetailDrawer({ jobId, onClose, onChanged }) {
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [drivers, setDrivers] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [showForm, setShowForm] = useState(null); // "complete" | "fail" | null

  function muat() {
    if (!jobId) return;
    setLoading(true);
    setError("");
    api.getArmadaJob(jobId)
      .then(setJob)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    muat();
    setShowForm(null);
    setActionError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  // Driver/kendaraan dimuat sekali per drawer dibuka — dropdown-nya cuma
  // relevan kalau job memang masih di status yang boleh diedit (dicek di
  // render), tapi murah untuk dimuat lebih dulu daripada nunggu klik.
  useEffect(() => {
    if (!jobId) return;
    Promise.all([api.getDrivers(), api.getVehicles()])
      .then(([d, v]) => { setDrivers(d || []); setVehicles((v.vehicles || []).filter((x) => x.active)); })
      .catch(() => {});
  }, [jobId]);

  const units = job?.units?.map((ju) => ju.unit) || [];
  const editable = job && EDITABLE_JOB_STATUSES.has(job.status);

  async function ubahJadwal(patch) {
    setBusy(true);
    setActionError("");
    try {
      const updated = await api.updateArmadaJob(job.id, patch);
      setJob(updated);
      onChanged?.();
    } catch (e) {
      setActionError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function jalankanAksi(action, payload = {}, files = []) {
    setBusy(true);
    setActionError("");
    try {
      const updated = await performSubmit(job.id, action, payload, files);
      setJob(updated);
      setShowForm(null);
      onChanged?.();
    } catch (e) {
      setActionError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open={!!jobId} onOpenChange={(o) => (o ? null : onClose())}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[200] bg-black/30 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content
          aria-label="Detail job"
          className={cn(
            "fixed right-0 top-0 z-[201] flex h-full w-full flex-col bg-surface shadow-2xl outline-none sm:w-[460px]",
            "data-[state=open]:animate-in data-[state=open]:slide-in-from-right"
          )}
        >
          <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-3">
            <Dialog.Title className="text-[15px] font-bold text-ink">Detail Job</Dialog.Title>
            {job && <StatusBadge map={JOB_STATUS_REAL} value={job.status} />}
            <Dialog.Close
              aria-label="Tutup detail job"
              className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg text-ink3 transition-colors hover:bg-hovertint hover:text-ink"
            >
              <X size={16} />
            </Dialog.Close>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            {loading && (
              <div className="space-y-3">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-24 w-full" />
              </div>
            )}

            {error && (
              <div className="rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red">
                Gagal memuat detail job: {error}
              </div>
            )}

            {job && !loading && (
              <>
                <div className="divide-y divide-line">
                  <Baris label="Job ID">
                    <span className="font-semibold">{job.id.slice(0, 8)}</span>
                  </Baris>
                  <Baris label="Jenis">{JOB_TYPE_REAL[job.type]?.label || job.type}</Baris>
                  <Baris label="Order">{orderNumberOf(job)}</Baris>
                  <Baris icon={User} label="Pelanggan">{customerOf(job)}</Baris>
                  <Baris icon={Phone} label="Kontak">
                    {job.order?.customer?.phone && (
                      <a href={`tel:${job.order.customer.phone}`} className="text-accent hover:underline">
                        {job.order.customer.phone}
                      </a>
                    )}
                  </Baris>
                  <Baris icon={MapPin} label="Alamat">{job.addressText}</Baris>
                  <Baris label="Catatan akses">{job.accessNotes}</Baris>
                </div>

                {/* Assign — HANYA muncul kalau job masih di status yang boleh
                    diedit (sama syarat dengan PATCH /jobs/:id di backend).
                    Job yang sudah EN_ROUTE/dst ditampilkan read-only di bawah,
                    supaya tidak terlihat bisa diubah padahal server menolak. */}
                {editable ? (
                  <div className="mt-3 space-y-2 rounded-btn border border-border bg-inset/30 p-3">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-ink3">Penugasan</p>
                    <div>
                      <label className="mb-1 block text-[11px] text-ink2">Driver</label>
                      <select
                        className={selectClass}
                        disabled={busy}
                        value={job.driverId || ""}
                        onChange={(e) => ubahJadwal({ driverId: e.target.value || null })}
                      >
                        <option value="">Belum ditugaskan</option>
                        {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] text-ink2">Kendaraan</label>
                      <select
                        className={selectClass}
                        disabled={busy}
                        value={job.vehicleId || ""}
                        onChange={(e) => ubahJadwal({ vehicleId: e.target.value || null })}
                      >
                        <option value="">Belum ada kendaraan</option>
                        {vehicles.map((v) => <option key={v.id} value={v.id}>{v.plateNumber}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] text-ink2">Tanggal</label>
                      <input
                        type="date"
                        className={selectClass}
                        disabled={busy}
                        value={job.scheduledDate ? job.scheduledDate.slice(0, 10) : ""}
                        onChange={(e) => ubahJadwal({ scheduledDate: e.target.value || null })}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="divide-y divide-line">
                    <Baris icon={Clock} label="Jadwal">
                      {job.scheduledDate
                        ? new Date(job.scheduledDate).toLocaleDateString("id-ID", {
                            weekday: "long", day: "numeric", month: "long", year: "numeric",
                          })
                        : "Belum dijadwalkan"}
                      {job.timeWindow ? ` · ${job.timeWindow}` : ""}
                    </Baris>
                    <Baris icon={User} label="Driver">{job.driver?.name || "Belum ditugaskan"}</Baris>
                    <Baris icon={Truck} label="Kendaraan">
                      {job.vehicle ? `${job.vehicle.plateNumber} (${job.vehicle.type})` : null}
                    </Baris>
                  </div>
                )}

                {/* Ubah status manual — dispatcher bertindak atas nama driver.
                    Tombol yang muncul mengikuti status SEKARANG, sama persis
                    guard yang dipakai backend (lihat komentar tiap endpoint
                    di armada.js) — supaya tidak ada tombol yang ujung-ujungnya
                    pasti ditolak server. */}
                {!["COMPLETED", "FAILED"].includes(job.status) && (
                  <div className="mt-3 rounded-btn border border-border bg-inset/30 p-3">
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-ink3">Status Pekerjaan</p>
                    <div className="flex flex-wrap gap-2">
                      {job.status === "ASSIGNED" && (
                        <Button size="sm" disabled={busy} onClick={() => jalankanAksi("start")}>
                          {busy ? <Loader2 size={13} className="animate-spin" /> : "Mulai Perjalanan"}
                        </Button>
                      )}
                      {job.status === "EN_ROUTE" && (
                        <Button size="sm" disabled={busy} onClick={() => jalankanAksi("arrive")}>
                          {busy ? <Loader2 size={13} className="animate-spin" /> : "Tiba di Lokasi"}
                        </Button>
                      )}
                      {["EN_ROUTE", "ARRIVED"].includes(job.status) && (
                        <Button size="sm" variant="secondary" disabled={busy} onClick={() => setShowForm(showForm === "complete" ? null : "complete")}>
                          Selesaikan
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => setShowForm(showForm === "fail" ? null : "fail")}>
                        Tandai Gagal
                      </Button>
                    </div>

                    {showForm === "complete" && (
                      <AksiFotoForm
                        label="Selesaikan Job"
                        busy={busy}
                        onCancel={() => setShowForm(null)}
                        onSubmit={({ files }) => jalankanAksi("complete", {}, files)}
                      />
                    )}
                    {showForm === "fail" && (
                      <AksiFotoForm
                        label="Tandai Gagal"
                        needReason
                        busy={busy}
                        onCancel={() => setShowForm(null)}
                        onSubmit={({ files, reason }) => jalankanAksi("fail", { failureReason: reason }, files)}
                      />
                    )}
                    {actionError && (
                      <p className="mt-2 text-[11.5px] text-red">{actionError}</p>
                    )}
                  </div>
                )}

                {/* Unit yang dibawa */}
                <div className="mt-4">
                  <h4 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-ink3">
                    <Package size={12} aria-hidden /> Unit ({units.length})
                  </h4>
                  {units.length === 0 ? (
                    <p className="text-[12px] text-ink3">Belum ada unit terpasang pada job ini.</p>
                  ) : (
                    <ul className="divide-y divide-line rounded-btn border border-border">
                      {units.map((u) => (
                        <li key={u.id} className="px-3 py-2">
                          <div className="text-[12.5px] font-semibold text-ink">{u.unitCode}</div>
                          <div className="text-[11.5px] text-ink2">
                            {[u.merk, u.ukuran].filter(Boolean).join(" · ") || "Tanpa keterangan merk/ukuran"}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Bukti — foto yang SUDAH diunggah driver lewat aplikasi */}
                {(job.proofPhotoUrls?.length > 0 || job.signatureUrl) && (
                  <div className="mt-4">
                    <h4 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-ink3">
                      <Camera size={12} aria-hidden /> Bukti Serah Terima
                    </h4>
                    <div className="flex flex-wrap gap-2">
                      {job.proofPhotoUrls?.map((src) => (
                        <img key={src} src={src} alt="" className="h-16 w-16 rounded-btn border border-border object-cover" />
                      ))}
                      {job.signatureUrl && (
                        <img src={job.signatureUrl} alt="Tanda tangan penerima"
                             className="h-16 rounded-btn border border-border bg-white object-contain px-1" />
                      )}
                    </div>
                  </div>
                )}

                {/* Kegagalan — alasan WAJIB terisi di backend saat job gagal */}
                {job.failureReason && (
                  <div className="mt-4 rounded-btn border-l-[3px] border-red bg-redbg px-3 py-2.5">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-red">Job gagal</div>
                    <p className="mt-0.5 text-[12.5px] text-ink">{job.failureReason}</p>
                  </div>
                )}

                {/* Jujur soal yang belum ada — lihat catatan di kepala file */}
                <p className="mt-5 border-t border-line pt-3 text-[11px] leading-relaxed text-ink3">
                  Area, SLA, prioritas, dan riwayat aktivitas belum tersedia — field-nya
                  belum ada di database. Ditambahkan bersama Tahap 5.
                </p>
              </>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
