import React, { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, MapPin, Package, Truck, User, Clock, Camera, Loader2, Navigation, Lock, UploadCloud } from "lucide-react";
import { api } from "@/api.js";
import { cn } from "@/lib/utils.js";
import { Skeleton } from "@/components/ui/skeleton.jsx";
import { Button } from "@/components/ui/button.jsx";
import DatePicker from "@/components/ui/date-picker.jsx";
import StatusBadge from "./StatusBadge.jsx";
import DeliveryTimeline from "./DeliveryTimeline.jsx";
import ChipPilih from "./ChipPilih.jsx";
import PasteUploadZone from "./PasteUploadZone.jsx";
import DateTimePicker from "@/components/ui/date-time-picker.jsx";
import { CustomerProfileCard } from "./JobBadges.jsx";
import RiwayatRevisiKendala from "./RiwayatRevisiKendala.jsx";
import ComplaintCaseDrawer from "@/features/complaints/ComplaintCaseDrawer.jsx";
import { AlertTriangle } from "lucide-react";
import { StatusSelect } from "@/features/orders/StatusSelect.jsx";
import {
  JOB_STATUS_REAL, JOB_TYPE_REAL, EDITABLE_JOB_STATUSES, customerOf, orderNumberOf, mapsUrl, orderOf,
  estimasiDurasiLabel, ESTIMASI_JAM_PRESET,
} from "../jobStatus.js";
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
//
// PasteUploadZone (8 September 2026, laporan owner: "proof of delivery...
// bisa upload bukti pengambilan/pengiriman dengan skema bisa ctrl+v")
// GANTI `<input type=file>` polos — sebelumnya cuma bisa pilih file dari
// disk, sekarang bisa juga tempel langsung dari clipboard (mis. gambar
// yang di-copy dari WhatsApp Web), sama komponen yang sudah dipakai POD
// Review (ArmadaPod.jsx), bukan implementasi kedua yang bisa drift.
// "YYYY-MM-DDTHH:mm" jam LOKAL perangkat — kontrak <input type=
// "datetime-local">, sama persis dengan toDatetimeLocal di PodReviewDrawer.jsx.
function toDatetimeLocal(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

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
      <PasteUploadZone files={files} onFilesChange={setFiles} multiple label={null} />
      <div className="mt-2 flex gap-2">
        <Button
          size="sm"
          disabled={busy || files.length === 0 || (needReason && !reason.trim())}
          onClick={() => onSubmit({ files: files.map((f) => f.file), reason: reason.trim() })}
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
  const [helpers, setHelpers] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [showForm, setShowForm] = useState(null); // "complete" | "fail" | null
  // Complaint / After-Sales Case (D-116, 11 September 2026) — job Delivery
  // Task yang lahir dari POST /complaints/:id/delivery-task menautkan diri
  // lewat job.complaintCase (lihat ComplaintBadge di JobBadges.jsx). Dispatcher
  // buka kasusnya langsung dari sini alih-alih pindah halaman.
  const [showComplaintCase, setShowComplaintCase] = useState(false);
  // Input Manual (8 September 2026, laporan owner — "proof of delivery
  // harus ada di route planner... bisa upload bukti pengambilan/pengiriman
  // dengan skema ctrl+v"). Sebelumnya jalur ini CUMA ada di halaman POD
  // Review terpisah (PodReviewDrawer.jsx) — dispatcher yang lagi buka
  // Route Planner harus pindah halaman cuma untuk menempelkan bukti yang
  // sudah diterima lewat WhatsApp. Dibawa ke sini juga, komponen
  // PasteUploadZone yang SAMA, endpoint yang SAMA (completeArmadaJob) —
  // bukan jalur/tabel kedua. Draft lokal, direset tiap job berganti.
  const [showManualInput, setShowManualInput] = useState(false);
  const [manualProofFiles, setManualProofFiles] = useState([]);
  const [manualCompletedAt, setManualCompletedAt] = useState("");
  const [manualBusy, setManualBusy] = useState(false);
  const [manualError, setManualError] = useState("");
  // Tambah Bukti untuk job yang SUDAH Selesai (8 September 2026, laporan
  // owner — screenshot job Irpus: order sudah "Terkirim" tapi tidak bisa
  // upload bukti manual sama sekali, karena "Input Manual" di atas SENGAJA
  // cuma untuk job yang BELUM Selesai). Ini jalur TERPISAH: job.status
  // TIDAK berubah, cuma proofPhotoUrls bertambah (lihat PATCH /jobs/:id/
  // proof-photos di armada.js).
  const [showExtraProof, setShowExtraProof] = useState(false);
  const [extraProofFiles, setExtraProofFiles] = useState([]);
  const [extraProofBusy, setExtraProofBusy] = useState(false);
  const [extraProofError, setExtraProofError] = useState("");
  // Catatan reschedule retroaktif (6 September 2026) — form kecil, cuma
  // muncul di job yang SUDAH Selesai TAPI belum punya rescheduleReason.
  // Draft LOKAL (pola sama dengan textarea gagal di AksiFotoForm) supaya
  // ketikan tidak langsung tersimpan sebelum tombol Simpan ditekan.
  const [showRescheduleNote, setShowRescheduleNote] = useState(false);
  const [rescheduleNoteReason, setRescheduleNoteReason] = useState("");
  // Riwayat Revisi & Kendala (10 September 2026, kasus Richard
  // RES-30082026-201 — permintaan owner "source code harus sama, seperti
  // di tab semua order") — SATU komponen (RiwayatRevisiKendala.jsx) & SATU
  // endpoint (GET /orders/:id/timeline) yang SAMA dengan OrderTimelineDrawer
  // ("Rincian Order"), bukan implementasi kedua yang bisa diam-diam
  // menyimpang. Drawer ini sebelumnya cuma bilang "riwayat aktivitas belum
  // tersedia" — datanya SUDAH ADA (dipakai tab Semua Order), cuma belum
  // pernah di-fetch dari sini.
  const [timelineData, setTimelineData] = useState(null);

  // Draft Alamat/Catatan/Jam (31 Agustus 2026, D-039 — laporan owner:
  // "form order-nya bisa buat lebih lengkap?", drawer ini sebelumnya cuma
  // menampilkan ketiganya read-only, tidak pernah bisa diisi/diubah dari
  // sini sama sekali walau backend PATCH /jobs/:id sudah menerima ketiganya
  // sejak awal — satu-satunya jalur edit yang ada cuma di board lama
  // (Armada.jsx JobCard). State LOKAL (bukan baca langsung dari job seperti
  // driver/helper/kendaraan) karena user mengetik huruf demi huruf sebelum
  // blur-simpan — pola sama dengan address di JobCard.
  const [address, setAddress] = useState("");
  const [accessNotes, setAccessNotes] = useState("");
  const [timeWindow, setTimeWindow] = useState("");

  // Guard balapan (6 September 2026, laporan owner — contoh nyata: klik
  // stop "Cst VERA" di Route Planner, drawer yang kebuka malah nampilin
  // data "Morning Dew/Novan" [stop LAIN di rute yang sama]). Akar masalah:
  // klik cepat berpindah job (drawer masih kebuka, jobId prop ganti sebelum
  // fetch job SEBELUMNYA selesai) — TANPA guard, respons yang datang
  // BELAKANGAN menang siapa pun urutan permintaannya, jadi request yang
  // lambat untuk job LAMA bisa menimpa state SETELAH request job BARU
  // (lebih cepat) sudah lebih dulu selesai duluan. `jobIdRef` menyimpan
  // jobId yang PALING BARU diminta; begitu respons datang, dicek dulu
  // apa jobId itu MASIH yang diminta sekarang — kalau sudah usang (user
  // sudah pindah ke job lain), dibuang begitu saja, bukan dipakai.
  const jobIdRef = useRef(jobId);

  function muat() {
    if (!jobId) return;
    const jobIdSaatDiminta = jobId;
    jobIdRef.current = jobIdSaatDiminta;
    setLoading(true);
    setError("");
    api.getArmadaJob(jobIdSaatDiminta)
      .then((data) => { if (jobIdRef.current === jobIdSaatDiminta) setJob(data); })
      .catch((e) => { if (jobIdRef.current === jobIdSaatDiminta) setError(e.message); })
      .finally(() => { if (jobIdRef.current === jobIdSaatDiminta) setLoading(false); });
  }

  useEffect(() => {
    jobIdRef.current = jobId;
    muat();
    setShowForm(null);
    setActionError("");
    setShowManualInput(false);
    setManualProofFiles([]);
    setManualCompletedAt(toDatetimeLocal(new Date()));
    setManualError("");
    setShowExtraProof(false);
    setExtraProofFiles([]);
    setExtraProofError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  // Driver/kendaraan dimuat sekali per drawer dibuka — dropdown-nya cuma
  // relevan kalau job memang masih di status yang boleh diedit (dicek di
  // render), tapi murah untuk dimuat lebih dulu daripada nunggu klik.
  useEffect(() => {
    if (!jobId) return;
    Promise.all([api.getDrivers(), api.getHelpers(), api.getVehicles()])
      .then(([d, h, v]) => { setDrivers(d || []); setHelpers(h || []); setVehicles((v.vehicles || []).filter((x) => x.active)); })
      .catch(() => {});
  }, [jobId]);

  // Riwayat Revisi & Kendala — SATU sumber dengan OrderTimelineDrawer,
  // lihat catatan panjang di deklarasi timelineData di atas. Menunggu
  // job.order ke-load dulu (butuh order.id), jadi terpisah dari effect
  // muat() di atas alih-alih ditumpuk di sana.
  useEffect(() => {
    const orderId = orderOf(job)?.id;
    if (!orderId) { setTimelineData(null); return; }
    let batal = false;
    api.getOrderTimeline(orderId)
      .then((d) => { if (!batal) setTimelineData(d); })
      .catch(() => { if (!batal) setTimelineData(null); });
    return () => { batal = true; };
  }, [job?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const units = job?.units?.map((ju) => ju.unit) || [];
  const editable = job && EDITABLE_JOB_STATUSES.has(job.status);
  // Job sudah masuk Route (D-077) — Route jadi SATU-SATUNYA otoritas untuk
  // driver/helper/kendaraan, backend MENOLAK PATCH ketiga field itu lewat
  // sini (lihat armada.js PATCH /jobs/:id). Sebelumnya kartu Penugasan di
  // bawah tetap tampil seolah bisa diklik untuk job begini — klik driver
  // baru gagal SETELAH request, dengan error mentah. Sekarang dikunci
  // proaktif di UI, bukan cuma dibiarkan gagal di backend. Tanggal/jam/
  // estimasi/alamat/catatan TETAP bisa diedit di sini walau routeId ada —
  // guard backend cuma soal driver/helper/vehicle, jadi kuncinya juga
  // SESEMPIT itu, bukan mengunci seluruh kartu Penugasan.
  const terkunciRute = job?.routeId != null;
  // Job RIWAYAT — selesai/gagal sebelum sistem Armada dipakai (backfill),
  // TIDAK PUNYA driver/tanggal karena memang tidak pernah dicatat, bukan
  // karena belum ditindaklanjuti (laporan owner 31 Agustus 2026: "kenapa
  // sudah terkirim statusnya tapi masih harus diambil?" — "Belum
  // dijadwalkan"/"Belum ditugaskan" terbaca seolah masih pending).
  const historis = job && ["COMPLETED", "FAILED"].includes(job.status) && !job.scheduledDate && !job.driverId;

  // Tanggal Pengambilan/Pengiriman (6 September 2026, laporan owner —
  // rangkaian revisi berakhir dengan penggabungan Job.scheduledDate +
  // Order.pickupConfirmedDate/deliveryConfirmedDate jadi SATU kontrol,
  // lihat ubahTanggalTerpadu di bawah). orderUntukTanggal masih dipakai
  // sebagai target PATCH Order; janjiAmbil/janjiKirim/perbandingan mismatch
  // tidak relevan lagi karena sekarang literal field yang sama.
  const pickupJob = job?.type === "PICKUP";
  const orderUntukTanggal = orderOf(job);

  // Sinkron draft SEKALI per job dibuka (job?.id, bukan job) — supaya PATCH
  // lain yang mengubah job (mis. pilih driver) tidak diam-diam menimpa ketikan
  // Alamat/Catatan yang belum sempat di-blur.
  useEffect(() => {
    if (!job) return;
    setAddress(job.addressText || "");
    setAccessNotes(job.accessNotes || "");
    setTimeWindow(job.timeWindow || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id]);

  // Alamat SALES/rencana (Order.deliveryAddress/deliveryCity, D-027/D-032) —
  // SARAN, bukan auto-fill (lihat tombol "Pakai alamat order" di bawah),
  // pola sama persis dengan JobCard di Armada.jsx supaya tidak ada 2
  // implementasi prefill yang bisa diam-diam beda.
  const prefillAddress = job?.order
    ? [job.order.deliveryAddress, job.order.deliveryCity].filter(Boolean).join(", ")
    : "";

  // Armada Sano cuma punya 1 kendaraan aktif hari ini (CLAUDE.md §1) — kalau
  // memang cuma ada 1 pilihan, tidak ada gunanya minta dispatcher memilih
  // sesuatu yang sudah pasti. Auto-terisi SEKALI per job (guard `busy` +
  // cek vehicleId null mencegah ini menembak ulang setelah user sengaja
  // melepas kendaraan lewat "Belum ada kendaraan").
  useEffect(() => {
    // terkunciRute (D-077, 6 September 2026) — job ber-routeId TIDAK BOLEH
    // di-PATCH vehicleId lewat sini, backend selalu menolak. Tanpa guard ini
    // efek di bawah nembak PATCH yang pasti gagal SETIAP kali drawer job
    // begini dibuka (armada dengan cuma 1 kendaraan aktif).
    if (!job || !editable || busy || terkunciRute) return;
    if (vehicles.length === 1 && !job.vehicleId) {
      ubahJadwal({ vehicleId: vehicles[0].id });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id, job?.vehicleId, vehicles.length, editable, terkunciRute]);

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

  // Ubah status ORDER langsung dari drawer (6 September 2026, laporan
  // owner: "pastikan bisa diedit statusnya di rute planner, jadwal
  // penugasan, proof of delivery" — bukan cuma tab "Semua Order"). Endpoint
  // & pola SAMA PERSIS dengan handleStatusChange di ArmadaOrders.jsx (D-086)
  // — StatusSelect.jsx sudah reusable, jangan tulis ulang logicnya di sini.
  // muat() dipanggil (bukan cuma setJob) karena PATCH /orders/:id
  // mengembalikan Order, bukan Job — job.order butuh di-refetch utuh
  // supaya DeliveryTimeline/badge ikut update konsisten.
  async function ubahStatusOrder(order, newStatus) {
    if (newStatus === order.status) return;
    setBusy(true);
    setActionError("");
    try {
      await api.updateOrder(order.id, { status: newStatus });
      muat();
      onChanged?.();
    } catch (e) {
      setActionError(e.message);
    } finally {
      setBusy(false);
    }
  }

  // Tanggal Pengambilan & Pengiriman — KEDUANYA tetap tampil terpisah
  // (6 September 2026, koreksi owner atas percobaan "satu tanggal" di atas:
  // "tetep tampilkan tanggal pickup dan kirim, karna di crm sales seperti
  // ini udah pasti kirim dan pickup jelas" — merujuk tampilan
  // OrderSection.jsx Sales CRM yang sudah punya "JADWAL PICK UP"/"JADWAL
  // KIRIM" terpisah). Jadi field-nya TETAP DUA (Order.pickupConfirmedDate
  // & Order.deliveryConfirmedDate), bukan digabung jadi satu — yang
  // digabung cuma SUMBER KEBENARANNYA dengan Job.scheduledDate: kalau
  // field yang diedit COCOK dengan tipe job yang sedang dibuka (pickupJob
  // -> pickupConfirmedDate, selain itu -> deliveryConfirmedDate),
  // Job.scheduledDate ikut ditulis di aksi yang sama supaya kartu
  // Penugasan tidak lagi butuh input tanggal terpisah sendiri (itu yang
  // dulu bikin redundan/bisa beda sendiri — lihat komentar lama di git
  // blame kalau perlu riwayatnya). Field yang TIDAK cocok tipe job ini
  // cuma menulis Order (job lain di order yang sama yang punya tipe itu
  // yang menentukan scheduledDate-nya sendiri, lewat drawer job itu).
  async function ubahTanggalOrder(field, value) {
    const fieldTipeJobIni = pickupJob ? "pickupConfirmedDate" : "deliveryConfirmedDate";
    const inginUbahJob = field === fieldTipeJobIni;

    // Reschedule PROAKTIF wajib alasan (9 September 2026, D-110) — sebelum
    // ini, reschedule SETELAH gagal (IssueRescheduleDrawer) wajib alasan +
    // konfirmasi pelanggan, tapi mengganti tanggal di sini (job belum
    // pernah gagal) tidak mencatat apa pun, tanggal berubah diam-diam tanpa
    // jejak. Backend (PATCH /jobs/:id) menegakkan ini juga — prompt di sini
    // supaya dispatcher tidak perlu gagal submit dulu baru tahu wajib diisi.
    // Cuma relevan kalau job SUDAH punya tanggal dan mau diganti ke tanggal
    // LAIN (bukan penjadwalan awal, bukan dikosongkan — pola sama dengan
    // guard isReschedule di backend).
    let rescheduleReason = "";
    let customerConfirmed = false;
    const tanggalLama = job.scheduledDate ? job.scheduledDate.slice(0, 10) : "";
    if (inginUbahJob && tanggalLama && value && tanggalLama !== value) {
      const alasan = window.prompt(
        `Job ini sudah dijadwalkan ${new Date(tanggalLama).toLocaleDateString("id-ID")}. Tulis alasan reschedule-nya (mis. permintaan pelanggan, kendala armada):`
      );
      if (!alasan?.trim()) return; // batal kalau kosong/Cancel
      rescheduleReason = alasan.trim();
      customerConfirmed = window.confirm("Apakah pelanggan sudah dikonfirmasi soal jadwal baru ini?");
    }

    setBusy(true);
    setActionError("");
    try {
      const tugas = [];
      if (orderUntukTanggal) tugas.push(api.updateOrder(orderUntukTanggal.id, { [field]: value || null }));
      if (inginUbahJob) {
        tugas.push(api.updateArmadaJob(job.id, {
          scheduledDate: value || null,
          ...(rescheduleReason && { rescheduleReason, customerConfirmed }),
        }));
      }
      await Promise.all(tugas);
      muat();
      onChanged?.();
    } catch (e) {
      setActionError(e.message);
    } finally {
      setBusy(false);
    }
  }

  // Catatan reschedule retroaktif untuk job Selesai (6 September 2026,
  // laporan owner — contoh nyata RES-02092026-010/Julhan: scheduledDate 2
  // Sep, completedAt 5 Sep, TIDAK ADA cara mencatat alasan mundurnya karena
  // job Selesai terkunci total). TIDAK mengubah tanggal/driver/status job —
  // cuma menambahkan alasan+jejak waktu (lihat POST /jobs/:id/reschedule-note
  // di armada.js untuk kenapa ini SENGAJA endpoint terpisah dari reschedule
  // biasa yang MENYALAKAN ULANG job dari status Gagal).
  async function simpanCatatanReschedule() {
    if (!rescheduleNoteReason.trim()) { setActionError("Alasan reschedule wajib diisi"); return; }
    setBusy(true);
    setActionError("");
    try {
      const updated = await api.addRescheduleNote(job.id, { reason: rescheduleNoteReason.trim() });
      setJob(updated);
      setShowRescheduleNote(false);
      setRescheduleNoteReason("");
      onChanged?.();
    } catch (e) {
      setActionError(e.message);
    } finally {
      setBusy(false);
    }
  }

  // Buka lagi order "Terkirim" yang ternyata belum pernah punya job
  // Pengiriman (8 September 2026, laporan owner — 2 contoh resi nyata: job
  // Pengambilan beneran selesai, job Pengiriman tidak pernah ada, order
  // sudah kadung "Terkirim" lewat dropdown status manual). Lihat catatan
  // lengkap di backend routes/orders.js POST /:id/reopen-for-delivery.
  async function bukaLagiUntukPengiriman(order) {
    setBusy(true);
    setActionError("");
    try {
      await api.reopenOrderForDelivery(order.id);
      muat();
      onChanged?.();
    } catch (e) {
      setActionError(e.message);
    } finally {
      setBusy(false);
    }
  }

  // Simpan bukti manual (8 September 2026) — pola SAMA dengan
  // selesaikanManual() di PodReviewDrawer.jsx: upload dulu (POST
  // /jobs/:id/photos), lalu completeArmadaJob dengan proofPhotoUrls +
  // completedAt manual. TIDAK lewat performSubmit (itu jalur driver app,
  // photoFiles-nya dikompres+diantre offline — di sini admin sudah online
  // langsung di dashboard, tidak perlu antrean sinkron).
  async function simpanBuktiManual() {
    if (manualProofFiles.length === 0) { setManualError("Minimal 1 foto bukti wajib diunggah"); return; }
    if (!manualCompletedAt) { setManualError("Waktu selesai wajib diisi"); return; }
    setManualBusy(true);
    setManualError("");
    try {
      const fd = new FormData();
      manualProofFiles.forEach(({ file }) => fd.append("photos", file));
      const { urls } = await api.uploadJobPhotos(job.id, fd);
      const updated = await api.completeArmadaJob(job.id, {
        proofPhotoUrls: urls,
        completedAt: new Date(manualCompletedAt).toISOString(),
      });
      setJob(updated);
      setShowManualInput(false);
      setManualProofFiles([]);
      onChanged?.();
    } catch (e) {
      setManualError(e.message);
    } finally {
      setManualBusy(false);
    }
  }

  // Tambah bukti untuk job yang SUDAH Selesai (8 September 2026) — lihat
  // catatan panjang di state showExtraProof di atas.
  async function tambahBuktiSetelahSelesai() {
    if (extraProofFiles.length === 0) { setExtraProofError("Minimal 1 foto bukti wajib diunggah"); return; }
    setExtraProofBusy(true);
    setExtraProofError("");
    try {
      const fd = new FormData();
      extraProofFiles.forEach(({ file }) => fd.append("photos", file));
      const { urls } = await api.uploadJobPhotos(job.id, fd);
      const updated = await api.addJobProofPhotos(job.id, { proofPhotoUrls: urls });
      setJob(updated);
      setShowExtraProof(false);
      setExtraProofFiles([]);
      onChanged?.();
    } catch (e) {
      setExtraProofError(e.message);
    } finally {
      setExtraProofBusy(false);
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
    <>
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
          <div className="flex shrink-0 items-start gap-2 border-b border-line px-4 py-3">
            <div className="min-w-0 flex-1">
              <Dialog.Title className="truncate text-[15px] font-bold text-ink">
                {job ? customerOf(job) || "Detail Job" : "Detail Job"}
              </Dialog.Title>
              {job && (
                <p className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-ink3">
                  {orderNumberOf(job)} · {JOB_TYPE_REAL[job.type]?.label || job.type}
                </p>
              )}
            </div>
            {job && <StatusBadge map={JOB_STATUS_REAL} value={job.status} className="shrink-0" />}
            <Dialog.Close
              aria-label="Tutup detail job"
              className="ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink3 transition-colors hover:bg-hovertint hover:text-ink"
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
                {/* Ubah status Order langsung dari sini (6 September 2026,
                    laporan owner: "pastikan bisa diedit statusnya di rute
                    planner, jadwal penugasan, proof of delivery") — dulu
                    HANYA bisa diedit dari tab "Semua Order" (Sales CRM),
                    dispatcher harus pindah halaman cuma untuk membetulkan
                    status yang sales lupa update. StatusSelect.jsx (D-086)
                    dipakai ulang persis, bukan kontrol baru. */}
                {orderOf(job) && (
                  <div className="mb-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-bold uppercase tracking-wide text-ink3">Status Order</span>
                      <StatusSelect order={orderOf(job)} onChange={ubahStatusOrder} />
                    </div>
                    {/* actionError di bawah (dekat tombol Status Pekerjaan)
                        TIDAK dirender untuk job COMPLETED/FAILED — kalau
                        ubah status di sini gagal justru pada job seperti
                        itu (kasus paling wajar: benerin status yang salah
                        SETELAH job selesai), errornya harus tetap kelihatan
                        di sini, bukan hilang diam-diam. */}
                    {["COMPLETED", "FAILED"].includes(job.status) && actionError && (
                      <p className="mt-1.5 text-[11.5px] text-red">{actionError}</p>
                    )}
                    {/* Buka Lagi utk Pengiriman (8 September 2026, laporan
                        owner — lihat catatan panjang di bukaLagiUntukPengiriman
                        di atas). Cuma muncul kalau Order "Terkirim" TAPI
                        tidak pernah punya job DELIVERY sama sekali — jangan
                        tawarkan tombol ini untuk order yang memang beres
                        (sudah ada job Pengiriman selesai/berjalan). */}
                    {orderOf(job).status === "DELIVERED" &&
                      !orderOf(job).jobs?.some((j) => j.type === "DELIVERY") && (
                        <div className="mt-2 rounded-btn border border-orange/40 bg-orangebg px-2.5 py-2">
                          <p className="text-[11.5px] text-orange">
                            Order ini "Terkirim" tapi belum pernah punya job Pengiriman —
                            kemungkinan cuma pengambilan yang selesai.
                          </p>
                          <Button
                            size="sm" variant="secondary" disabled={busy}
                            className="mt-1.5"
                            onClick={() => bukaLagiUntukPengiriman(orderOf(job))}
                          >
                            {busy ? <Loader2 size={13} className="animate-spin" /> : "Buka Lagi utk Pengiriman"}
                          </Button>
                        </div>
                      )}
                  </div>
                )}
                {/* Tanggal Pengambilan & Pengiriman — field Order, jadi
                    SENGAJA di luar blok editable/read-only job di bawah
                    (tetap bisa dikoreksi walau job-nya sendiri sudah
                    Selesai/Gagal, sama alasan dengan Status Order di atas).
                    Edit di sini otomatis "teredit di semua divisi" karena
                    field Order yang SAMA dibaca Sales CRM — lihat
                    ubahTanggalOrder di atas untuk kenapa DUA field ini
                    (bukan satu) tapi tetap nyambung ke Job.scheduledDate. */}
                {orderUntukTanggal && (
                  <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-[11px] text-ink2">Tanggal Pengambilan</label>
                      <DatePicker
                        value={orderUntukTanggal.pickupConfirmedDate ? orderUntukTanggal.pickupConfirmedDate.slice(0, 10) : ""}
                        onChange={(v) => ubahTanggalOrder("pickupConfirmedDate", v)}
                        placeholder="Belum diisi"
                        className="w-full"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] text-ink2">Tanggal Pengiriman</label>
                      <DatePicker
                        value={orderUntukTanggal.deliveryConfirmedDate ? orderUntukTanggal.deliveryConfirmedDate.slice(0, 10) : ""}
                        onChange={(v) => ubahTanggalOrder("deliveryConfirmedDate", v)}
                        placeholder="Belum diisi"
                        className="w-full"
                      />
                    </div>
                  </div>
                )}

                {job.order?.status && (
                  <DeliveryTimeline
                    orderStatus={job.order.status}
                    orderCategory={job.order.category}
                    job={job}
                    className="pb-4"
                  />
                )}

                {/* Kartu identitas pelanggan (D-047, 4 September 2026 — "buat
                    seperti artifacts") — GANTI dua baris terpisah "Sales
                    Person"/"Kontak" yang lama, lihat komentar CustomerProfileCard
                    di JobBadges.jsx untuk alasannya. */}
                <CustomerProfileCard job={job} className="mb-3" />

                {job.complaintCase && (
                  <button
                    type="button" onClick={() => setShowComplaintCase(true)}
                    className="mb-3 flex w-full items-center gap-2 rounded-btn bg-redbg px-3 py-2 text-left text-[12px] font-semibold text-red hover:opacity-90"
                  >
                    <AlertTriangle size={13} className="shrink-0" />
                    Dari Kasus Komplain {job.complaintCase.caseNumber} — lihat detail
                  </button>
                )}

                <div className="divide-y divide-line">
                  {/* Navigasi (D-040, 31 Agustus 2026) — dulu cuma ada di HP
                      driver (DriverJobs.jsx), sekarang tersedia juga di
                      drawer dispatcher supaya bisa langsung cek lokasi di
                      Maps tanpa harus jadi driver yang login. Link publik
                      Google Maps biasa, TIDAK butuh API key/billing. */}
                  {mapsUrl(job) && (
                    <div className="py-2">
                      <a
                        href={mapsUrl(job)} target="_blank" rel="noreferrer"
                        className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-accent hover:underline"
                      >
                        <Navigation size={13} /> Buka di Google Maps
                      </a>
                    </div>
                  )}
                  {/* Alamat & Catatan pindah jadi field EDITABLE di kartu
                      Penugasan di bawah selama job masih boleh diedit — baris
                      read-only di sini cuma untuk job yang statusnya sudah
                      lewat (EN_ROUTE/dst), supaya tidak ada 2 tampilan nilai
                      yang sama (satu bisa diketik, satu cuma teks) sekaligus. */}
                  {!editable && (
                    <>
                      <Baris icon={MapPin} label="Alamat">{job.addressText}</Baris>
                      <Baris label="Catatan">{job.accessNotes}</Baris>
                    </>
                  )}
                </div>

                {/* Assign — HANYA muncul kalau job masih di status yang boleh
                    diedit (sama syarat dengan PATCH /jobs/:id di backend).
                    Job yang sudah EN_ROUTE/dst ditampilkan read-only di bawah,
                    supaya tidak terlihat bisa diubah padahal server menolak. */}
                {editable ? (
                  <div className="mt-3 space-y-3 rounded-btn border border-border bg-inset/30 p-3">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-ink3">Penugasan</p>
                    {/* Terkunci (D-077) — job ini sudah jadi stop di sebuah
                        Route, jadi driver/helper/kendaraan diatur DI SANA,
                        bukan di sini (Route otoritas penuh begitu job masuk
                        rute). Tampil read-only + penjelasan, BUKAN dihilangkan
                        total, supaya dispatcher tetap tahu siapa yang
                        ditugaskan tanpa perlu buka Route Planner cuma untuk
                        mengecek. */}
                    {terkunciRute ? (
                      <div className="space-y-2">
                        <div className="flex items-start gap-1.5 rounded-btn bg-orangebg px-2.5 py-2 text-[11.5px] text-orange">
                          <Lock size={13} className="mt-0.5 shrink-0" />
                          <span>
                            Sudah masuk rute <strong>{job.route?.code || "?"}</strong> — driver/helper/kendaraan
                            diatur di Route Planner, bukan di sini.
                          </span>
                        </div>
                        <p className="flex items-center gap-1.5 text-[12px] text-ink2">
                          <User size={13} className="text-ink3" /> {job.driver?.name || "Belum ditugaskan"}
                        </p>
                        {job.helper?.name && (
                          <p className="flex items-center gap-1.5 text-[12px] text-ink2">
                            <User size={13} className="text-ink3" /> {job.helper.name} (helper)
                          </p>
                        )}
                        {job.vehicle && (
                          <p className="flex items-center gap-1.5 text-[12px] text-ink2">
                            <Truck size={13} className="text-ink3" /> {job.vehicle.plateNumber}
                          </p>
                        )}
                      </div>
                    ) : (
                      <>
                        <div>
                          <label className="mb-1.5 block text-[11px] text-ink2">Driver</label>
                          <ChipPilih
                            items={drivers}
                            selectedId={job.driverId}
                            disabled={busy}
                            kosongLabel="Belum ditugaskan"
                            onPick={(id) => ubahJadwal({ driverId: id })}
                          />
                        </div>
                        {/* Helper (pendamping driver, D-037, 31 Agustus 2026) —
                            OPSIONAL, kolam nama TERPISAH dari Driver di atas
                            (lihat GET /armada/helpers). Job boleh jalan tanpa
                            helper sama sekali, karena itu "Tanpa helper" dan
                            bukan "Belum ditugaskan" (beda nuansa: yang satu
                            wajar dikosongkan, yang satu perlu ditindaklanjuti). */}
                        <div>
                          <label className="mb-1.5 block text-[11px] text-ink2">Helper</label>
                          <ChipPilih
                            items={helpers}
                            selectedId={job.helperId}
                            disabled={busy}
                            kosongLabel="Tanpa helper"
                            onPick={(id) => ubahJadwal({ helperId: id })}
                          />
                        </div>
                        {/* Kendaraan: 1 pilihan saja -> auto-terisi (lihat efek
                            di atas), tampil sebagai info, bukan pilihan
                            berulang. >1 kendaraan baru tampil chip pola sama
                            dgn Driver. */}
                        {vehicles.length > 1 ? (
                          <div>
                            <label className="mb-1.5 block text-[11px] text-ink2">Kendaraan</label>
                            <ChipPilih
                              items={vehicles.map((v) => ({ id: v.id, name: v.plateNumber }))}
                              selectedId={job.vehicleId}
                              disabled={busy}
                              kosongLabel="Belum ada kendaraan"
                              onPick={(id) => ubahJadwal({ vehicleId: id })}
                            />
                          </div>
                        ) : (
                          job.vehicle && (
                            <p className="flex items-center gap-1.5 text-[12px] text-ink2">
                              <Truck size={13} className="text-ink3" /> {job.vehicle.plateNumber}
                            </p>
                          )
                        )}
                      </>
                    )}
                    {/* Tanggal sudah diedit lewat "Tanggal Pengambilan/
                        Pengiriman" di atas (field Order, nyambung otomatis
                        ke Job.scheduledDate job ini — lihat ubahTanggalOrder).
                        TIDAK ada input tanggal terpisah lagi di sini supaya
                        tidak ada 2 kontrol yang bisa beda sendiri. */}

                    {/* Estimasi Jam (6 September 2026, GANTI TOTAL dari
                        "Estimasi Durasi" — laporan owner: durasi/menit tidak
                        bisa diukur akurat karena tergantung macet jalanan,
                        yang benar-benar berguna buat dispatcher adalah "job
                        ini estimasi baru bisa dikerjakan DI ATAS jam berapa"
                        — persis pola form Google Sheets lama ("EST DIATAS
                        JAM 09.00"). Field targetnya Job.timeWindow (jam
                        kunjungan), BUKAN Job.estimatedDurationMinutes —
                        beda field, beda makna, jangan disatukan lagi.
                        Preset APA ADANYA dari owner (09.00/12.00/15.00/
                        17.00/19.00), bukan dikarang. */}
                    <div>
                      <label className="mb-1.5 block text-[11px] text-ink2">Estimasi Jam (opsional)</label>
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => { setTimeWindow(""); ubahJadwal({ timeWindow: null }); }}
                          className={cn(
                            "flex h-7 items-center rounded-full border-2 px-2.5 text-[11px] font-medium transition-colors disabled:opacity-50",
                            !job.timeWindow ? "border-ink3 bg-inset text-ink2" : "border-border text-ink3 hover:border-ink3"
                          )}
                        >
                          Belum diisi
                        </button>
                        {ESTIMASI_JAM_PRESET.map((p) => {
                          const active = job.timeWindow === p.value;
                          return (
                            <button
                              key={p.value}
                              type="button"
                              disabled={busy}
                              onClick={() => { setTimeWindow(p.value); ubahJadwal({ timeWindow: p.value }); }}
                              className={cn(
                                "flex h-7 items-center gap-1 rounded-full border-2 px-2.5 text-[11px] font-semibold transition-colors disabled:opacity-50",
                                active ? "border-orange bg-orangebg text-orange" : "border-border text-ink2 hover:border-ink3"
                              )}
                            >
                              <Clock size={11} className="shrink-0" />
                              {p.label}
                            </button>
                          );
                        })}
                      </div>
                      {/* Fallback manual — kasus jam di luar 5 preset di atas
                          tetap bisa diketik bebas, field yang sama persis
                          (timeWindow), cuma jalur beda. */}
                      <input
                        value={timeWindow}
                        onChange={(e) => setTimeWindow(e.target.value)}
                        onBlur={() => timeWindow !== (job.timeWindow || "") && ubahJadwal({ timeWindow: timeWindow || null })}
                        disabled={busy}
                        placeholder="atau isi manual, mis. Di atas jam 14.00"
                        className={cn(selectClass, "mt-1.5")}
                      />
                    </div>

                    {/* Alamat & Catatan (D-039, 31 Agustus 2026) — dulu cuma
                        bisa diedit dari board lama (Armada.jsx JobCard),
                        sekarang tersedia langsung di drawer supaya dispatcher
                        tidak perlu pindah tampilan untuk melengkapi job.
                        Label "Catatan Akses" DIGANTI "Catatan" (6 September
                        2026, laporan owner) — isinya di lapangan TERNYATA
                        jarang soal akses/patokan, lebih sering pengingat
                        bawaan buat driver ("Bawa Mesin EDC", "Bawa Roda
                        Divan/Sofa") — nama field lama menyesatkan cakupan
                        sebenarnya. accessNotes di backend TIDAK diubah,
                        cuma label & placeholder di UI. */}
                    <div>
                      <label className="mb-1 block text-[11px] text-ink2">Alamat</label>
                      <input
                        value={address}
                        onChange={(e) => setAddress(e.target.value)}
                        onBlur={() => address !== (job.addressText || "") && ubahJadwal({ addressText: address })}
                        disabled={busy}
                        placeholder="Alamat pengambilan/pengiriman"
                        className={selectClass}
                      />
                      {/* Cuma muncul kalau field masih kosong DAN order-nya
                          punya alamat sales (D-027/D-032) — klik = niat
                          jelas isi + langsung simpan, bukan sekadar saran
                          pasif yang bisa terlewat. */}
                      {!address && prefillAddress && (
                        <button
                          type="button"
                          onClick={() => { setAddress(prefillAddress); ubahJadwal({ addressText: prefillAddress }); }}
                          className="mt-1 text-left text-[11px] text-accent hover:underline"
                        >
                          Pakai alamat order: {prefillAddress}
                        </button>
                      )}
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] text-ink2">Catatan (Opsional)</label>
                      <input
                        value={accessNotes}
                        onChange={(e) => setAccessNotes(e.target.value)}
                        onBlur={() => accessNotes !== (job.accessNotes || "") && ubahJadwal({ accessNotes: accessNotes || null })}
                        disabled={busy}
                        placeholder="mis. Bawa Mesin EDC, Bawa Roda Divan, patokan rumah"
                        className={selectClass}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="divide-y divide-line">
                    <Baris icon={Clock} label={`Jadwal ${pickupJob ? "Pengambilan" : "Pengiriman"}`}>
                      {job.scheduledDate
                        ? new Date(job.scheduledDate).toLocaleDateString("id-ID", {
                            weekday: "long", day: "numeric", month: "long", year: "numeric",
                          })
                        : historis ? "— (data riwayat)" : "Belum dijadwalkan"}
                      {job.timeWindow ? ` · ${job.timeWindow}` : ""}
                    </Baris>
                    <Baris icon={User} label="Driver">
                      {job.driver?.name || (historis ? "— (data riwayat)" : "Belum ditugaskan")}
                    </Baris>
                    <Baris icon={User} label="Helper">{job.helper?.name || null}</Baris>
                    <Baris icon={Truck} label="Kendaraan">
                      {job.vehicle ? `${job.vehicle.plateNumber} (${job.vehicle.type})` : null}
                    </Baris>
                    <Baris icon={Clock} label="Estimasi Durasi">
                      {estimasiDurasiLabel(job.estimatedDurationMinutes)}
                    </Baris>
                  </div>
                )}

                {/* Catatan reschedule retroaktif (6 September 2026, laporan
                    owner — contoh nyata Julhan/RES-...-010: job Selesai
                    terkunci total, tidak ada cara mencatat kalau ternyata
                    ini mundur dari rencana awal). CUMA muncul untuk job
                    Selesai — job aktif tinggal ganti Tanggal langsung di
                    kartu Penugasan di atas, tidak perlu jalur terpisah. */}
                {job.status === "COMPLETED" && (
                  <div className="mt-3 rounded-btn border border-border bg-inset/30 p-3">
                    {job.rescheduleReason ? (
                      <>
                        <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-ink3">Catatan Reschedule</p>
                        <p className="text-[12.5px] text-ink">{job.rescheduleReason}</p>
                        <p className="mt-1 text-[11px] text-ink3">
                          Dicatat {job.rescheduledBy?.name ? `oleh ${job.rescheduledBy.name}` : ""}
                          {job.rescheduledAt ? ` · ${new Date(job.rescheduledAt).toLocaleDateString("id-ID")}` : ""}
                        </p>
                      </>
                    ) : showRescheduleNote ? (
                      <div className="space-y-2">
                        <p className="text-[10px] font-bold uppercase tracking-wide text-ink3">Catat sebagai Reschedule</p>
                        <textarea
                          value={rescheduleNoteReason}
                          onChange={(e) => setRescheduleNoteReason(e.target.value)}
                          placeholder="Kenapa job ini mundur dari rencana awal? (mis. customer tidak di tempat, driver reschedule ke hari lain)"
                          rows={2}
                          className="w-full rounded-btn border border-border bg-surface px-2.5 py-2 text-[12.5px] text-ink outline-none focus:border-accent"
                        />
                        <div className="flex gap-2">
                          <Button size="sm" disabled={busy || !rescheduleNoteReason.trim()} onClick={simpanCatatanReschedule}>
                            {busy ? <Loader2 size={13} className="animate-spin" /> : "Simpan"}
                          </Button>
                          <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setShowRescheduleNote(false); setRescheduleNoteReason(""); }}>
                            Batal
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setShowRescheduleNote(true)}
                        className="text-[12px] font-semibold text-accent hover:underline"
                      >
                        Job ini mundur dari rencana awal? Catat sebagai reschedule
                      </button>
                    )}
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

                {/* Input Manual (8 September 2026, laporan owner) — jalur
                    ALTERNATIF di luar Mulai→Tiba→Selesaikan di atas, untuk
                    bukti yang sudah diterima manual (mis. lewat WhatsApp)
                    walau job belum/tidak pernah lewat app driver. Sama
                    kondisi dengan PodReviewDrawer.jsx (job.status !==
                    "COMPLETED") — termasuk job FAILED, siapa tahu bukti
                    baru menyusul belakangan. */}
                {job.status !== "COMPLETED" && (
                  <div className="mt-3 rounded-btn border border-dashed border-accent/40 bg-accentbg/20 p-3">
                    <button
                      type="button"
                      onClick={() => setShowManualInput((v) => !v)}
                      className="flex w-full items-center justify-between text-left text-[12px] font-semibold text-accent"
                    >
                      <span>Sudah ada bukti dari WhatsApp? Input manual</span>
                      <span className="text-[11px] text-ink3">{showManualInput ? "Tutup" : "Buka"}</span>
                    </button>
                    {showManualInput && (
                      <div className="mt-2.5 space-y-2.5">
                        <div>
                          <p className="mb-1 flex items-center gap-1 text-[10.5px] font-semibold text-ink2">
                            <Clock size={11} aria-hidden /> Waktu Selesai
                          </p>
                          {/* DateTimePicker (8 September 2026) — lihat
                              catatan panjang di komponennya soal
                              redesign glass + 24 jam murni. */}
                          <DateTimePicker value={manualCompletedAt} onChange={setManualCompletedAt} />
                        </div>
                        <PasteUploadZone
                          files={manualProofFiles}
                          onFilesChange={setManualProofFiles}
                          multiple
                          label={`Foto bukti ${pickupJob ? "Pengambilan" : "Pengiriman"} (wajib, minimal 1)`}
                        />
                        {manualError && <p className="text-[11.5px] text-red">{manualError}</p>}
                        <Button
                          size="sm"
                          disabled={manualBusy || manualProofFiles.length === 0}
                          onClick={simpanBuktiManual}
                          className="w-full"
                        >
                          {manualBusy ? <Loader2 size={13} className="animate-spin" /> : <UploadCloud size={13} />} Tandai Selesai + Simpan Bukti
                        </Button>
                      </div>
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

                {/* Bukti — foto yang SUDAH diunggah driver lewat aplikasi.
                    Label DIBEDAKAN per tipe job (6 September 2026, laporan
                    owner: "bukti serah terima adalah bukti pengambilan...
                    buat menjadi 2 dokumentasi pengambilan dan pengiriman") —
                    "Bukti Serah Terima" generik menyesatkan untuk job
                    Pengambilan (bukti AMBIL dari customer, bukan SERAH ke
                    customer). Job.proofPhotoUrls TETAP satu field per job
                    (sudah type-specific secara data — job ini SELALU salah
                    satu Pengambilan ATAU Pengiriman, tidak pernah dua-duanya
                    sekaligus), yang berubah cuma labelnya supaya jujur soal
                    bukti APA yang sedang dilihat. */}
                {/* Bukti — DULU cuma dirender kalau sudah ADA foto/TTD, jadi
                    job COMPLETED yang buktinya kosong (banyak dari backfill
                    sesi ini: selesaikanJobBelumJalan/adminBypassProduction,
                    SENGAJA tanpa foto) tidak pernah kelihatan section ini
                    sama sekali — laporan owner (screenshot job Irpus): "gak
                    bisa upload bukti manual" untuk order yang sudah
                    Selesai. Sekarang section SELALU tampil untuk job
                    COMPLETED (jujur bilang "Belum ada foto" kalau memang
                    kosong) + tombol Tambah Bukti (PATCH /jobs/:id/
                    proof-photos, endpoint TERPISAH dari Selesaikan — job
                    tidak berpindah status lagi). */}
                {(job.status === "COMPLETED" || job.proofPhotoUrls?.length > 0 || job.signatureUrl) && (
                  <div className="mt-4">
                    <h4 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-ink3">
                      <Camera size={12} aria-hidden /> Bukti {pickupJob ? "Pengambilan" : "Pengiriman"}
                    </h4>
                    {(job.proofPhotoUrls?.length > 0 || job.signatureUrl) ? (
                      <div className="flex flex-wrap gap-2">
                        {job.proofPhotoUrls?.map((src) => (
                          <img key={src} src={src} alt="" className="h-16 w-16 rounded-btn border border-border object-cover" />
                        ))}
                        {job.signatureUrl && (
                          <img src={job.signatureUrl} alt="Tanda tangan penerima"
                               className="h-16 rounded-btn border border-border bg-white object-contain px-1" />
                        )}
                      </div>
                    ) : job.status === "COMPLETED" ? (
                      <p className="text-[12px] text-ink3">Belum ada foto — job ini ditandai selesai tanpa bukti terunggah.</p>
                    ) : null}

                    {job.status === "COMPLETED" && (
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
                              <Button
                                size="sm" disabled={extraProofBusy || extraProofFiles.length === 0}
                                onClick={tambahBuktiSetelahSelesai}
                              >
                                {extraProofBusy ? <Loader2 size={13} className="animate-spin" /> : <UploadCloud size={13} />} Simpan
                              </Button>
                              <Button size="sm" variant="ghost" disabled={extraProofBusy} onClick={() => { setShowExtraProof(false); setExtraProofFiles([]); }}>
                                Batal
                              </Button>
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
                )}

                {/* Kegagalan — alasan WAJIB terisi di backend saat job gagal */}
                {job.failureReason && (
                  <div className="mt-4 rounded-btn border-l-[3px] border-red bg-redbg px-3 py-2.5">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-red">Job gagal</div>
                    <p className="mt-0.5 text-[12.5px] text-ink">{job.failureReason}</p>
                  </div>
                )}

                {/* Riwayat Revisi & Kendala (10 Sep 2026) — SATU sumber
                    dengan tab Semua Order, lihat catatan di deklarasi
                    timelineData. null kalau order ini tidak punya revisi/
                    kendala apa pun (mayoritas job) — tidak render apa-apa. */}
                <RiwayatRevisiKendala
                  className="mt-5 border-t border-line pt-3"
                  revisions={timelineData?.revisions || []}
                  issueJobs={timelineData?.issueJobs || []}
                  hasComplaint={timelineData?.hasComplaint}
                  complaintDetail={timelineData?.complaintDetail}
                  complaintDate={timelineData?.complaintDate}
                />

                {/* Jujur soal yang belum ada — lihat catatan di kepala file */}
                <p className="mt-5 border-t border-line pt-3 text-[11px] leading-relaxed text-ink3">
                  Area, SLA, dan prioritas belum tersedia — field-nya belum ada
                  di database. Ditambahkan bersama Tahap 5.
                </p>
              </>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
    <ComplaintCaseDrawer
      open={showComplaintCase} caseId={job?.complaintCase?.id}
      onClose={() => setShowComplaintCase(false)}
      onChanged={() => { onChanged?.(); }}
    />
    </>
  );
}
