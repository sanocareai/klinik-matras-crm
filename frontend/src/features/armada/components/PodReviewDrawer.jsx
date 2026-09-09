import React, { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Check, XCircle, Loader2, User, Package, Camera, PenLine, UploadCloud, Clock, Pencil } from "lucide-react";
import { api } from "@/api.js";
import Avatar from "@/components/Avatar.jsx";
import AssignDropdown from "./AssignDropdown.jsx";
import StatusBadge from "./StatusBadge.jsx";
import PasteUploadZone from "./PasteUploadZone.jsx";
import DateTimePicker from "@/components/ui/date-time-picker.jsx";
import { POD_STATUS } from "../podStatus.js";
import { customerOf, orderNumberOf, unitCountOf, jobLabelOf, orderOf } from "../jobStatus.js";
import { StatusSelect } from "@/features/orders/StatusSelect.jsx";
import { isAdminUser } from "@/lib/roles.js";

// "YYYY-MM-DDTHH:mm" dalam jam LOKAL perangkat (kontrak <input type=
// "datetime-local"> — TIDAK boleh dipakai untuk kolom DATE murni, cuma
// untuk field jam-menit seperti ini). Admin yang mengoperasikan ini
// diasumsikan di WIB (sama seperti seluruh operasional Klinik Matras) —
// beda dari skema tanggal-only di lib/dateRange.js yang eksplisit
// dikonversi lewat toWIB(), field jam seperti ini bergantung timezone
// PERANGKAT karena itu memang kontrak bawaan <input type="datetime-local">.
function toDatetimeLocal(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

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
//
// WAKTU SELESAI + DRIVER/HELPER BISA DIEDIT (D-087, 5 September 2026) —
// laporan owner: "waktu selesai bisa di update manual, tambahkan detail
// driver, helper yang bertanggung jawab". Bukti WA biasanya diterima admin
// LAMA setelah job benar-benar selesai (bukan "sekarang") — kalau
// completedAt selalu dipaksa "saat submit", riwayatnya jadi bohong. Driver/
// helper juga sering belum tercatat sama sekali di job (dibuat otomatis
// dari order, belum sempat ditugaskan lewat Papan) padahal admin SUDAH
// tahu siapa yang sebenarnya mengerjakan dari laporan WA — AssignDropdown
// yang sama dipakai Papan/JobCard, bukan komponen baru.
//
// TTD PENERIMA SENGAJA DI-HOLD (permintaan owner eksplisit) — rencana
// jangka panjangnya: tab khusus PER KENDARAAN (baca jalur, mapping Google
// Maps, dokumentasi sampai TTD digital), dan owner sendiri ragu TTD bisa
// diandalkan di HP Android lama driver. TIDAK dibangun jalur upload TTD
// manual di sini — bagian "Tanda Tangan Penerima" di bawah TETAP tampil
// (baca job.signatureUrl apa adanya, kalau suatu saat terisi dari jalur
// lain), cuma tidak ada cara MENGISINYA dari drawer ini.
// Koreksi Admin (9 September 2026, laporan owner: "ketika proof of delivery
// sudah di input buat fitur edit khusus admin, karna namanya sistem baru,
// pasti karyawan masih banyak salah") — SEBELUM ini, foto/waktu selesai/
// driver-helper yang sudah tersimpan tidak bisa dikoreksi lagi (cuma bisa
// DITAMBAH foto lewat "Tambah Bukti" di atas, tidak bisa mengganti/
// menghapus yang salah). Admin only (isAdminUser, pola sama dengan
// RouteCard.jsx canEditCompleted) — dispatcher biasa tetap cuma bisa
// Verifikasi/Tolak. Mengubah foto otomatis mereset podStatus ke "Menunggu
// Verifikasi" (lihat backend PATCH /pod/:jobId/edit) — bukti yang jadi dasar
// verifikasi lama sudah beda, wajib ditinjau ulang.
const currentUser = JSON.parse(localStorage.getItem("user") || "null");

export default function PodReviewDrawer({ job, onClose, onChanged }) {
  const isAdmin = isAdminUser(currentUser);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [editing, setEditing] = useState(false);
  const [editKeepUrls, setEditKeepUrls] = useState([]);
  const [editNewFiles, setEditNewFiles] = useState([]);
  const [editCompletedAt, setEditCompletedAt] = useState("");
  const [editDriverId, setEditDriverId] = useState("");
  const [editHelperId, setEditHelperId] = useState("");
  const [editReason, setEditReason] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState("");

  // Daftar driver/helper untuk AssignDropdown — diambil SEKALI (bukan per
  // job dibuka), sama pola dengan komponen lain yang memakai dropdown ini.
  const [drivers, setDrivers] = useState([]);
  const [helpers, setHelpers] = useState([]);
  useEffect(() => {
    api.getDrivers().then(setDrivers).catch(() => {});
    api.getHelpers().then(setHelpers).catch(() => {});
  }, []);

  // Input manual — direset tiap job berganti (lihat useEffect di bawah),
  // supaya foto/detail job SEBELUMNYA yang belum sempat disubmit tidak
  // nyasar ke job BERIKUTNYA kalau dispatcher pindah baris tanpa menutup
  // drawer. Driver/helper diprefill dari job (kalau sudah ada), waktu
  // selesai diprefill "sekarang" — keduanya TETAP bisa diubah admin
  // sebelum submit, ini cuma titik awal yang masuk akal.
  const [proofFiles, setProofFiles] = useState([]);
  const [manualCompletedAt, setManualCompletedAt] = useState("");
  const [manualDriverId, setManualDriverId] = useState("");
  const [manualHelperId, setManualHelperId] = useState("");
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState("");

  // Tambah Bukti untuk job yang SUDAH Selesai (8 September 2026, laporan
  // owner — screenshot job Irpus: order sudah "Terkirim" tapi tidak bisa
  // upload bukti manual sama sekali). "Input Manual" di atas SENGAJA cuma
  // untuk job yang BELUM Selesai (belumSelesaiSistem) — ini jalur TERPISAH
  // untuk job yang SUDAH Selesai tapi buktinya kosong/kurang, job.status
  // TIDAK berubah lagi (lihat PATCH /jobs/:id/proof-photos di armada.js).
  const [showExtraProof, setShowExtraProof] = useState(false);
  const [extraProofFiles, setExtraProofFiles] = useState([]);
  const [extraProofBusy, setExtraProofBusy] = useState(false);
  const [extraProofError, setExtraProofError] = useState("");

  useEffect(() => {
    setProofFiles([]);
    setUploadError("");
    setRejecting(false);
    setNote("");
    setError("");
    setShowExtraProof(false);
    setExtraProofFiles([]);
    setExtraProofError("");
    setManualCompletedAt(toDatetimeLocal(new Date()));
    setManualDriverId(job?.driverId || "");
    setManualHelperId(job?.helperId || "");
    setEditing(false);
    setEditKeepUrls(job?.proofPhotoUrls || []);
    setEditNewFiles([]);
    setEditCompletedAt(job?.completedAt ? toDatetimeLocal(new Date(job.completedAt)) : toDatetimeLocal(new Date()));
    setEditDriverId(job?.driverId || "");
    setEditHelperId(job?.helperId || "");
    setEditReason("");
    setEditError("");
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

  // Ubah status Order langsung dari POD (6 September 2026, laporan owner:
  // "pastikan bisa diedit statusnya di... proof of delivery"). TIDAK
  // menutup drawer (beda dari verifikasi/tolak) — mengoreksi status bukan
  // "selesai review", admin wajar lanjut lihat foto/detail lain setelahnya.
  // Staleness `job` prop ditangani di ArmadaPod.jsx (resync effect di sana),
  // bukan di sini — komponen ini tidak tahu/tidak perlu tahu soal state
  // list induknya.
  async function ubahStatusOrder(order, newStatus) {
    if (newStatus === order.status) return;
    setBusy(true);
    setError("");
    try {
      await api.updateOrder(order.id, { status: newStatus });
      onChanged();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function tambahBuktiSetelahSelesai() {
    if (extraProofFiles.length === 0) { setExtraProofError("Minimal 1 foto bukti wajib diunggah"); return; }
    setExtraProofBusy(true);
    setExtraProofError("");
    try {
      const fd = new FormData();
      extraProofFiles.forEach(({ file }) => fd.append("photos", file));
      const { urls } = await api.uploadJobPhotos(job.id, fd);
      await api.addJobProofPhotos(job.id, { proofPhotoUrls: urls });
      setShowExtraProof(false);
      setExtraProofFiles([]);
      onChanged();
    } catch (e) {
      setExtraProofError(e.message);
    } finally {
      setExtraProofBusy(false);
    }
  }

  async function selesaikanManual() {
    if (proofFiles.length === 0) { setUploadError("Minimal 1 foto bukti wajib diunggah"); return; }
    if (!manualCompletedAt) { setUploadError("Waktu selesai wajib diisi"); return; }
    setUploadBusy(true);
    setUploadError("");
    try {
      const fd = new FormData();
      proofFiles.forEach(({ file }) => fd.append("photos", file));
      const { urls } = await api.uploadJobPhotos(job.id, fd);

      await api.completeArmadaJob(job.id, {
        proofPhotoUrls: urls,
        completedAt: new Date(manualCompletedAt).toISOString(),
        driverId: manualDriverId || null,
        helperId: manualHelperId || null,
      });
      onChanged();
      onClose();
    } catch (e) {
      setUploadError(e.message);
    } finally {
      setUploadBusy(false);
    }
  }

  // Koreksi Admin — lihat catatan panjang di atas komponen. `photosChanged`
  // dicek dulu (BUKAN selalu kirim proofPhotoUrls) supaya edit yang cuma
  // membetulkan waktu selesai/driver TIDAK ikut mereset status verifikasi —
  // backend (PATCH /pod/:jobId/edit) cuma mereset podStatus kalau
  // proofPhotoUrls ADA di body request.
  async function simpanEdit() {
    if (!editReason.trim()) { setEditError("Alasan koreksi wajib diisi"); return; }
    const fotoAsli = job.proofPhotoUrls || [];
    const photosChanged = editNewFiles.length > 0 || editKeepUrls.length !== fotoAsli.length
      || editKeepUrls.some((u, i) => u !== fotoAsli[i]);
    if (photosChanged && editKeepUrls.length === 0 && editNewFiles.length === 0) {
      setEditError("Minimal 1 foto bukti wajib ada");
      return;
    }
    setEditBusy(true);
    setEditError("");
    try {
      let finalUrls;
      if (photosChanged) {
        let baru = [];
        if (editNewFiles.length > 0) {
          const fd = new FormData();
          editNewFiles.forEach(({ file }) => fd.append("photos", file));
          const { urls } = await api.uploadJobPhotos(job.id, fd);
          baru = urls;
        }
        finalUrls = [...editKeepUrls, ...baru];
      }
      await api.editPod(job.id, {
        reason: editReason.trim(),
        ...(photosChanged && { proofPhotoUrls: finalUrls }),
        completedAt: editCompletedAt ? new Date(editCompletedAt).toISOString() : undefined,
        driverId: editDriverId || null,
        helperId: editHelperId || null,
      });
      setEditing(false);
      setEditNewFiles([]);
      onChanged();
    } catch (e) {
      setEditError(e.message);
    } finally {
      setEditBusy(false);
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

            {/* Ubah status Order langsung dari sini (6 September 2026,
                laporan owner) — StatusSelect.jsx (D-086) dipakai ulang
                persis, sama dengan JobDetailDrawer (Route Planner/Jadwal &
                Penugasan). */}
            {orderOf(job) && (
              <div className="mt-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-wide text-ink3">Status Order</span>
                  <StatusSelect order={orderOf(job)} onChange={ubahStatusOrder} />
                </div>
                {/* Error di sini TERPISAH dari `error` yang dipakai tombol
                    Verifikasi/Tolak di footer bawah — footer itu cuma
                    dirender kalau bisaDitinjau, jadi kalau job ini sudah
                    VERIFIED/REJECTED, error ubah status tidak akan pernah
                    kelihatan tanpa baris ini. */}
                {!bisaDitinjau && error && <p className="mt-1.5 text-[11.5px] text-red">{error}</p>}
              </div>
            )}

            <div className="mt-3.5 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wide text-ink3">
              <Package size={12} aria-hidden /> Waktu Selesai
            </div>
            <p className="mt-0.5 text-[13px] text-ink">
              {job.completedAt
                ? new Date(job.completedAt).toLocaleString("id-ID", { dateStyle: "long", timeStyle: "short" })
                : "Belum selesai"}
            </p>
            <p className="text-[11.5px] text-ink2">Driver: {job.driver?.name || "—"}</p>

            {/* Koreksi Admin (9 September 2026) — lihat catatan panjang di
                atas komponen. Cuma admin, cuma job yang sudah COMPLETED
                (belum selesai sistem sudah punya jalur "Input Manual" di
                bawah, tidak butuh mode edit terpisah). */}
            {isAdmin && !belumSelesaiSistem && !editing && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="mt-1.5 flex items-center gap-1 text-[11.5px] font-semibold text-accent hover:underline"
              >
                <Pencil size={11} /> Koreksi bukti (Admin)
              </button>
            )}

            {editing && (
              <div className="mt-3 rounded-btn border border-dashed border-orange/40 bg-orangebg/30 p-3">
                <p className="mb-2.5 text-[11.5px] leading-relaxed text-ink2">
                  Ganti waktu selesai, driver/helper, atau foto bukti yang salah — foto lama bisa dihapus, foto baru ditambahkan. Mengubah foto akan mengembalikan status ke "Menunggu Verifikasi".
                </p>

                <div className="mb-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  <div>
                    <p className="mb-1 flex items-center gap-1 text-[10.5px] font-semibold text-ink2">
                      <Clock size={11} aria-hidden /> Waktu Selesai
                    </p>
                    <DateTimePicker value={editCompletedAt} onChange={setEditCompletedAt} />
                  </div>
                  <div>
                    <p className="mb-1 flex items-center gap-1 text-[10.5px] font-semibold text-ink2">
                      <User size={11} aria-hidden /> Driver &amp; Helper
                    </p>
                    <AssignDropdown
                      drivers={drivers}
                      helpers={helpers}
                      currentDriverId={editDriverId}
                      currentHelperId={editHelperId}
                      onPick={(driverId, helperId) => {
                        setEditDriverId(driverId || "");
                        if (helperId !== undefined) setEditHelperId(helperId || "");
                      }}
                    />
                  </div>
                </div>

                <p className="mb-1 text-[10.5px] font-semibold text-ink2">
                  Foto Bukti {job.type === "PICKUP" ? "Pengambilan" : "Pengiriman"}
                </p>
                {editKeepUrls.length > 0 && (
                  <div className="mb-2 grid grid-cols-4 gap-2">
                    {editKeepUrls.map((src) => (
                      <div key={src} className="group relative">
                        <img src={src} alt="" className="aspect-square w-full rounded-btn border border-border object-cover" />
                        <button
                          type="button"
                          onClick={() => setEditKeepUrls(editKeepUrls.filter((u) => u !== src))}
                          aria-label="Hapus foto ini"
                          className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red text-white shadow"
                        >
                          <X size={11} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <PasteUploadZone
                  files={editNewFiles}
                  onFilesChange={setEditNewFiles}
                  multiple
                  label="Tambah foto baru (opsional)"
                />

                <textarea
                  value={editReason}
                  onChange={(e) => setEditReason(e.target.value)}
                  placeholder="Alasan koreksi (wajib) — mis. foto salah upload, waktu selesai keliru dicatat"
                  rows={2}
                  className="mt-2.5 w-full rounded-btn border border-border bg-surface px-2.5 py-2 text-[12.5px] text-ink outline-none focus:border-accent"
                />

                {editError && <p className="mt-1.5 text-[11.5px] text-red">{editError}</p>}
                <div className="mt-2.5 flex gap-2">
                  <button
                    type="button"
                    onClick={simpanEdit}
                    disabled={editBusy}
                    className="flex items-center gap-1.5 rounded-btn bg-accent px-3 py-1.5 text-[12px] font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                  >
                    {editBusy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Simpan Koreksi
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(false);
                      setEditKeepUrls(job.proofPhotoUrls || []);
                      setEditNewFiles([]);
                      setEditError("");
                    }}
                    disabled={editBusy}
                    className="rounded-btn px-3 py-1.5 text-[12px] font-semibold text-ink2 hover:bg-hovertint"
                  >
                    Batal
                  </button>
                </div>
              </div>
            )}

            <div className="mt-4 border-t border-line pt-3.5">
              {/* Label dibedakan per tipe job (6 September 2026, laporan
                  owner — sama alasan dengan JobDetailDrawer.jsx: "Foto
                  Bukti" generik tidak bilang ini bukti AMBIL atau bukti
                  KIRIM). job.proofPhotoUrls TETAP satu field, job ini
                  SELALU salah satu Pengambilan ATAU Pengiriman. */}
              <h4 className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-ink3">
                <Camera size={12} aria-hidden /> Foto Bukti {job.type === "PICKUP" ? "Pengambilan" : "Pengiriman"}
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

              {/* Tambah Bukti (8 September 2026) — lihat catatan panjang di
                  state showExtraProof di atas. */}
              {!belumSelesaiSistem && (
                <div className="mt-2">
                  {showExtraProof ? (
                    <div className="rounded-btn border border-dashed border-accent/40 bg-accentbg/20 p-2.5">
                      <PasteUploadZone
                        files={extraProofFiles}
                        onFilesChange={setExtraProofFiles}
                        multiple
                        label="Foto bukti tambahan"
                      />
                      {extraProofError && <p className="mt-1.5 text-[11.5px] text-red">{extraProofError}</p>}
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          onClick={tambahBuktiSetelahSelesai}
                          disabled={extraProofBusy || extraProofFiles.length === 0}
                          className="flex items-center gap-1.5 rounded-btn bg-accent px-3 py-1.5 text-[12px] font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                        >
                          {extraProofBusy ? <Loader2 size={13} className="animate-spin" /> : <UploadCloud size={13} />} Simpan
                        </button>
                        <button
                          type="button"
                          onClick={() => { setShowExtraProof(false); setExtraProofFiles([]); }}
                          disabled={extraProofBusy}
                          className="rounded-btn px-3 py-1.5 text-[12px] font-semibold text-ink2 hover:bg-hovertint"
                        >
                          Batal
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowExtraProof(true)}
                      className="text-[12px] font-semibold text-accent hover:underline"
                    >
                      + Tambah Bukti
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Input Manual (D-086/D-087) — HANYA muncul kalau job belum
                pernah diselesaikan lewat sistem sama sekali. Begitu
                tersimpan, job.status jadi COMPLETED dan bagian ini otomatis
                hilang di render berikutnya (data yang sama, tinggal buka
                lagi lewat job.proofPhotoUrls seperti biasa). TTD SENGAJA
                tidak ada di sini (di-hold, lihat catatan header komponen). */}
            {belumSelesaiSistem && (
              <div className="mt-3 rounded-btn border border-dashed border-accent/40 bg-accentbg/30 p-3">
                <p className="mb-2.5 text-[11.5px] leading-relaxed text-ink2">
                  Job ini belum pernah ditandai selesai lewat sistem — kalau bukti sudah diterima manual (mis. lewat WhatsApp), lengkapi detailnya lalu unggah di sini.
                </p>

                <div className="mb-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  <div>
                    <p className="mb-1 flex items-center gap-1 text-[10.5px] font-semibold text-ink2">
                      <Clock size={11} aria-hidden /> Waktu Selesai
                    </p>
                    {/* DateTimePicker (8 September 2026, laporan owner:
                        "redesign tanggal nya sesuai dengan style glass...
                        sistem waktu 24jam") — GANTI <input type=
                        "datetime-local"> native (kaca terang bawaan
                        browser + AM/PM) dengan komponen Sano DS, jam murni
                        24-jam TANPA AM/PM sama sekali. */}
                    <DateTimePicker value={manualCompletedAt} onChange={setManualCompletedAt} />
                  </div>
                  <div>
                    <p className="mb-1 flex items-center gap-1 text-[10.5px] font-semibold text-ink2">
                      <User size={11} aria-hidden /> Driver &amp; Helper
                    </p>
                    <AssignDropdown
                      drivers={drivers}
                      helpers={helpers}
                      currentDriverId={manualDriverId}
                      currentHelperId={manualHelperId}
                      onPick={(driverId, helperId) => {
                        setManualDriverId(driverId || "");
                        if (helperId !== undefined) setManualHelperId(helperId || "");
                      }}
                    />
                  </div>
                </div>

                <PasteUploadZone
                  files={proofFiles}
                  onFilesChange={setProofFiles}
                  multiple
                  label="Foto bukti (wajib, minimal 1)"
                />

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

            {/* Jejak Koreksi Admin (9 September 2026) — supaya siapa pun
                yang buka drawer ini tahu bukti pernah dikoreksi manual,
                bukan asli dari driver/input pertama, dan KENAPA. */}
            {job.podEditedBy && (
              <div className="mt-3 rounded-btn border-l-[3px] border-orange bg-orangebg px-3 py-2.5">
                <div className="text-[10px] font-bold uppercase tracking-wide text-orange">Dikoreksi Admin</div>
                {job.podEditReason && <p className="mt-0.5 text-[12.5px] text-ink">{job.podEditReason}</p>}
                <p className="mt-1 text-[10.5px] text-ink3">
                  oleh {job.podEditedBy.name} · {new Date(job.podEditedAt).toLocaleString("id-ID", { dateStyle: "long", timeStyle: "short" })}
                </p>
              </div>
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
