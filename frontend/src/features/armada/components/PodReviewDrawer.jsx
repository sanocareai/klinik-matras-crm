import React, { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Check, XCircle, Loader2, User, Package, Camera, PenLine, ClipboardPaste, UploadCloud } from "lucide-react";
import { api } from "@/api.js";
import { cn } from "@/lib/utils.js";
import Avatar from "@/components/Avatar.jsx";
import StatusBadge from "./StatusBadge.jsx";
import { POD_STATUS } from "../podStatus.js";
import { customerOf, orderNumberOf, unitCountOf, jobLabelOf } from "../jobStatus.js";

// Drawer review Proof of Delivery — Approve / Reject atas foto & tanda
// tangan yang SUDAH diunggah driver. Tidak ada "checklist penyelesaian" di
// sini (lihat catatan panjang di ArmadaPod.jsx): aplikasi driver tidak pernah
// mengumpulkan checklist, jadi menampilkannya di sini akan jadi UI kosong
// yang tidak pernah bisa diisi siapa pun.
//
// REDESIGN + INPUT MANUAL (D-086, 5 September 2026) — laporan owner: "ui nya
// masih yang lama, mari kita redesign", DAN "saat ini foto bukti semua masih
// upload di whatsapp, karna delivery masih belum siap... bisa tambahkan
// skema manual input untuk review bukti nya? admin ambil dari wa upload
// atau kalo bisa copy paste... tanpa download".
//
// Dua perubahan:
// 1. Visual dirombak — avatar pelanggan, hierarki bagian lebih jelas
//    (ikon + label section), grid foto lebih besar, badge TTD jadi ikon
//    bukan teks "Ada"/"—" polos.
// 2. Bagian BARU "Input Manual" — muncul HANYA kalau job belum COMPLETED
//    (adopsi app driver belum penuh, banyak bukti serah terima masih
//    dikirim manual lewat WhatsApp ke admin, bukan lewat app driver).
//    Admin bisa PILIH FILE atau TEMPEL (Ctrl+V) gambar yang sudah di-copy
//    dari WhatsApp Web — tanpa perlu download ke disk dulu, ClipboardEvent
//    browser sudah membawa gambarnya langsung sebagai Blob. Upload lewat
//    endpoint yang SAMA dengan app driver (POST /jobs/:id/photos, lalu
//    POST /jobs/:id/complete) — SATU jalur penyimpanan, bukan tabel/kolom
//    kedua yang bisa drift dari data driver asli. Backend (routes/armada.js)
//    diperluas menerima status SCHEDULED/ASSIGNED juga di /complete (dulu
//    cuma ARRIVED/EN_ROUTE) — jembatan sementara, lihat catatan di sana.
export default function PodReviewDrawer({ job, onClose, onChanged }) {
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Input manual — direset tiap job berganti (lihat useEffect di bawah),
  // supaya foto job SEBELUMNYA yang belum sempat disubmit tidak nyasar
  // ke job BERIKUTNYA kalau dispatcher pindah baris tanpa menutup drawer.
  const [proofFiles, setProofFiles] = useState([]);
  const [signatureFiles, setSignatureFiles] = useState([]);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState("");

  useEffect(() => {
    setProofFiles([]);
    setSignatureFiles([]);
    setUploadError("");
    setRejecting(false);
    setNote("");
    setError("");
  }, [job?.id]);

  if (!job) return null;
  const status = job.derivedPodStatus;
  const bisaDitinjau = status === "PENDING_REVIEW" || status === "REJECTED";
  // Belum pernah diselesaikan LEWAT SISTEM sama sekali (job.status, BUKAN
  // derivedPodStatus — "Belum Lengkap" juga mencakup job yang sebenarnya
  // sudah COMPLETED tapi tanpa foto, kasus itu TIDAK relevan untuk input
  // manual karena job-nya sendiri sudah "selesai" di alur normal).
  const belumSelesaiSistem = job.status !== "COMPLETED";

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

  async function selesaikanManual() {
    if (proofFiles.length === 0) { setUploadError("Minimal 1 foto bukti wajib diunggah"); return; }
    setUploadBusy(true);
    setUploadError("");
    try {
      const fd = new FormData();
      proofFiles.forEach(({ file }) => fd.append("photos", file));
      const { urls } = await api.uploadJobPhotos(job.id, fd);

      let signatureUrl;
      if (signatureFiles.length > 0) {
        const fd2 = new FormData();
        fd2.append("photos", signatureFiles[0].file);
        const res2 = await api.uploadJobPhotos(job.id, fd2);
        signatureUrl = res2.urls[0];
      }

      await api.completeArmadaJob(job.id, { proofPhotoUrls: urls, signatureUrl });
      onChanged();
      onClose();
    } catch (e) {
      setUploadError(e.message);
    } finally {
      setUploadBusy(false);
    }
  }

  return (
    <Dialog.Root open={!!job} onOpenChange={(o) => (o ? null : onClose())}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[200] bg-black/30 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content
          aria-label="Review Proof of Delivery"
          className="fixed right-0 top-0 z-[201] flex h-full w-full flex-col bg-surface shadow-2xl outline-none data-[state=open]:animate-in data-[state=open]:slide-in-from-right sm:w-[480px]"
        >
          <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-3">
            <Dialog.Title className="text-[15px] font-bold text-ink">Review Bukti</Dialog.Title>
            <StatusBadge map={POD_STATUS} value={status} />
            <Dialog.Close aria-label="Tutup" className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg text-ink3 hover:bg-hovertint hover:text-ink">
              <X size={16} />
            </Dialog.Close>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            {/* Identitas — avatar (D-086), sebelumnya teks polos tanpa
                identitas visual, beda dari pola avatar-forward yang sudah
                dipakai di Semua Order/Jadwal & Penugasan. */}
            <div className="flex items-center gap-2.5">
              <Avatar name={customerOf(job) || "?"} size="sm" gradient className="h-9 w-9 shrink-0 text-[11px]" />
              <div className="min-w-0">
                <p className="truncate text-[14px] font-bold text-ink">{customerOf(job) || "—"}</p>
                <p className="text-[11.5px] text-ink2">{jobLabelOf(job)} · {orderNumberOf(job) || "—"} · {unitCountOf(job)} unit</p>
              </div>
            </div>

            <div className="mt-3.5 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wide text-ink3">
              <Package size={12} aria-hidden /> Waktu Selesai
            </div>
            <p className="mt-0.5 text-[13px] text-ink">
              {job.completedAt
                ? new Date(job.completedAt).toLocaleString("id-ID", { dateStyle: "long", timeStyle: "short" })
                : "Belum selesai"}
            </p>
            <p className="text-[11.5px] text-ink2">Driver: {job.driver?.name || "—"}</p>

            <div className="mt-4 border-t border-line pt-3.5">
              <h4 className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-ink3">
                <Camera size={12} aria-hidden /> Foto Bukti
              </h4>
              {job.proofPhotoUrls?.length > 0 ? (
                <div className="grid grid-cols-3 gap-2">
                  {job.proofPhotoUrls.map((src) => (
                    <a key={src} href={src} target="_blank" rel="noreferrer" className="group block overflow-hidden rounded-btn border border-border">
                      <img src={src} alt="" className="aspect-square w-full object-cover transition-transform duration-150 group-hover:scale-105" />
                    </a>
                  ))}
                </div>
              ) : belumSelesaiSistem ? null : (
                <p className="text-[12px] text-ink3">Belum ada foto.</p>
              )}
            </div>

            {/* Input Manual (D-086) — HANYA muncul kalau job belum pernah
                diselesaikan lewat sistem sama sekali. Begitu tersimpan,
                job.status jadi COMPLETED dan bagian ini otomatis hilang di
                render berikutnya (data yang sama, tinggal buka lagi lewat
                job.proofPhotoUrls seperti biasa). */}
            {belumSelesaiSistem && (
              <div className="mt-3 rounded-btn border border-dashed border-accent/40 bg-accentbg/30 p-3">
                <p className="mb-2.5 text-[11.5px] leading-relaxed text-ink2">
                  Job ini belum pernah ditandai selesai lewat sistem — kalau bukti sudah diterima manual (mis. lewat WhatsApp), unggah di sini untuk menandai selesai.
                </p>
                <PasteUploadZone
                  files={proofFiles}
                  onFilesChange={setProofFiles}
                  multiple
                  label="Foto bukti (wajib, minimal 1)"
                />
                <div className="mt-3">
                  <PasteUploadZone
                    files={signatureFiles}
                    onFilesChange={setSignatureFiles}
                    multiple={false}
                    label="Tanda tangan penerima (opsional)"
                  />
                </div>
                {uploadError && <p className="mt-2 text-[12px] text-red">{uploadError}</p>}
                <button
                  type="button"
                  onClick={selesaikanManual}
                  disabled={uploadBusy || proofFiles.length === 0}
                  className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-btn bg-accent py-2 text-[12.5px] font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  {uploadBusy ? <Loader2 size={14} className="animate-spin" /> : <UploadCloud size={14} />} Tandai Selesai + Simpan Bukti
                </button>
              </div>
            )}

            <div className="mt-4">
              <h4 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-ink3">
                <PenLine size={12} aria-hidden /> Tanda Tangan Penerima
              </h4>
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

// Zona unggah + tempel (D-086) — dipakai untuk foto bukti (multiple) DAN
// tanda tangan (single). Dua cara mengisi: (1) klik lalu pilih file biasa,
// (2) fokuskan lalu Ctrl+V — kalau gambar sudah di-copy dari WhatsApp Web
// (klik kanan gambar > Copy image, atau Ctrl+C di image viewer-nya),
// ClipboardEvent browser membawa Blob gambarnya LANGSUNG, tidak perlu
// men-download ke disk dulu lalu pilih file itu secara manual — persis
// yang diminta owner ("copy paste tanpa download").
//
// Preview object URL dibuat SEKALI saat file ditambahkan (bukan di setiap
// render) dan di-revoke saat file itu dihapus/komponen lepas — mencegah
// kebocoran memori dari createObjectURL yang tidak pernah dibersihkan.
function PasteUploadZone({ files, onFilesChange, multiple, label }) {
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    // Revoke SEMUA object URL saat komponen benar-benar lepas (drawer
    // ditutup) — pembersihan terakhir, pelengkap dari revoke per-item di
    // removeAt() untuk kasus normal (dihapus manual/disubmit).
    return () => { files.forEach((f) => URL.revokeObjectURL(f.previewUrl)); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function addFiles(rawFiles) {
    const imgs = rawFiles.filter((f) => f.type.startsWith("image/"));
    if (imgs.length === 0) return;
    const withPreview = imgs.map((file) => ({ file, previewUrl: URL.createObjectURL(file) }));
    if (multiple) {
      onFilesChange([...files, ...withPreview]);
    } else {
      files.forEach((f) => URL.revokeObjectURL(f.previewUrl)); // ganti satu-satunya slot
      onFilesChange(withPreview.slice(0, 1));
    }
  }

  function handlePaste(e) {
    const items = Array.from(e.clipboardData?.items || []);
    const imgs = items.filter((it) => it.kind === "file" && it.type.startsWith("image/")).map((it) => it.getAsFile()).filter(Boolean);
    if (imgs.length > 0) { e.preventDefault(); addFiles(imgs); }
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    addFiles(Array.from(e.dataTransfer?.files || []));
  }

  function removeAt(i) {
    URL.revokeObjectURL(files[i].previewUrl);
    onFilesChange(files.filter((_, idx) => idx !== i));
  }

  return (
    <div>
      <p className="mb-1 text-[10.5px] font-semibold text-ink2">{label}</p>
      <div
        tabIndex={0}
        role="button"
        aria-label={`${label} — klik atau tempel gambar`}
        onPaste={handlePaste}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={cn(
          "flex cursor-pointer items-center justify-center gap-1.5 rounded-btn border-2 border-dashed px-3 py-3 text-center text-[11px] outline-none transition-colors",
          dragOver ? "border-accent bg-accentbg text-accent" : "border-border text-ink3 hover:border-accent hover:text-accent focus-visible:border-accent"
        )}
      >
        <ClipboardPaste size={14} className="shrink-0" />
        <span>Klik lalu tempel gambar (Ctrl+V), atau klik untuk pilih file</span>
        <input
          ref={inputRef} type="file" accept="image/*" multiple={multiple} className="hidden"
          onChange={(e) => { addFiles(Array.from(e.target.files || [])); e.target.value = ""; }}
        />
      </div>
      {files.length > 0 && (
        <div className="mt-2 grid grid-cols-4 gap-2">
          {files.map((f, i) => (
            <div key={f.previewUrl} className="group relative">
              <img src={f.previewUrl} alt="" className="aspect-square w-full rounded-btn border border-border object-cover" />
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); removeAt(i); }}
                aria-label="Hapus gambar ini"
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red text-white shadow"
              >
                <X size={11} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
