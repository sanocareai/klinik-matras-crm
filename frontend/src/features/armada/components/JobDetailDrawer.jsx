import React, { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, MapPin, Phone, Package, Truck, User, Clock, Camera, Loader2 } from "lucide-react";
import { api } from "@/api.js";
import { cn } from "@/lib/utils.js";
import { Skeleton } from "@/components/ui/skeleton.jsx";
import StatusBadge from "./StatusBadge.jsx";
import { JOB_STATUS_REAL, JOB_TYPE_REAL, customerOf, orderNumberOf } from "../jobStatus.js";

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

export default function JobDetailDrawer({ jobId, onClose }) {
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!jobId) return;
    let batal = false;
    setLoading(true);
    setError("");
    api.getArmadaJob(jobId)
      .then((d) => !batal && setJob(d))
      .catch((e) => !batal && setError(e.message))
      .finally(() => !batal && setLoading(false));
    return () => { batal = true; };
  }, [jobId]);

  const units = job?.units?.map((ju) => ju.unit) || [];

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
                  <Baris label="Rute">{job.route ? `${job.route.code} · ${job.route.status}` : null}</Baris>
                </div>

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
