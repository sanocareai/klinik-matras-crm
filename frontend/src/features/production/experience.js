// Production Experience V2 (P8) — logika MURNI UI (tanpa React/DOM kecuali akses storage yang dibungkus try/catch).
// Server adalah otoritas urutan tahap & izin; modul ini hanya menerjemahkan keadaan dari server ke label, form, dan pesan
// Bahasa Indonesia, plus validasi awal yang MENCERMINKAN kontrak server (bukan penggantinya).

export const STEPS = Object.freeze([
  { no: 1, label: "Sebelum Bongkar", actor: "TABLE", hint: "Foto/video kasur utuh dari luar. Cek ukuran & kondisi kain luar." },
  { no: 2, label: "Uji Rasa Awal", actor: "TABLE", hint: "Video uji tekan/rebah sebelum dibongkar + catatan rasa awal." },
  { no: 3, label: "Hasil Bongkar", actor: "TABLE", hint: "Foto/video bagian dalam setelah dibuka + centang material lama." },
  { no: 4, label: "Uji Fondasi Lama", actor: "TABLE", hint: "Video uji fondasi oleh penguji seberat customer + tinggi awal & saat ditekan." },
  { no: 5, label: "Diagnosa", actor: "TABLE", hint: "Jelaskan hubungan kerusakan dengan keluhan customer (ketik atau suara)." },
  { no: 6, label: "Fondasi Baru", actor: "TABLE", hint: "Video uji fondasi baru + pilih bahan Gudang yang dipakai." },
  { no: 7, label: "Lapisan Baru", actor: "TABLE", hint: "Foto/video pemasangan lapisan + pilih bahan Gudang yang dipakai." },
  { no: 8, label: "Uji Tekstur Akhir", actor: "TABLE", hint: "Video uji akhir oleh penguji seberat customer. Pilih hasilnya." },
  { no: 9, label: "Kirim ke Corner", actor: "TABLE", hint: "Foto/video kasur siap dibungkus kain, lalu kirim ke meja jahit." },
  { no: 10, label: "Mulai Jahit", actor: "CORNER", hint: "Cek spesifikasi kain, warna list, dan model sebelum menjahit." },
  { no: 11, label: "Jahit Selesai", actor: "CORNER", hint: "Foto/video hasil jahitan + checklist kerapian." },
  { no: 12, label: "Konfirmasi Selesai", actor: "CORNER", hint: "Foto kasur selesai/terbungkus, lalu serahkan ke Gudang. Laporan untuk Sales disiapkan otomatis." },
]);
export const STEP_BY_NO = Object.freeze(Object.fromEntries(STEPS.map((s) => [s.no, s])));

// Jalur PENGERJAAN (pesanan BARU/custom, view.track === "BUILD"): tahap 6 = "Pengerjaan Pesanan"; tahap 1–5 & 7 tidak berlaku (server menandai NA).
export const BUILD_TRACK = "BUILD";
export const BUILD_STEP = Object.freeze({ no: 6, label: "Pengerjaan Pesanan", actor: "TABLE", hint: "Foto/video hasil pengerjaan sesuai spesifikasi & layanan pesanan Sales. Catat bahan Gudang yang dipakai bila ada." });
export const BUILD_STEP_KASUR_HINT = "Catat racikan fondasi/lapisan yang dipakai (bersama PIC QC), foto/video hasil pengerjaan, dan bahan Gudang yang dipakai bila ada.";
/** Label bucket menurut jalur: pada jalur pengerjaan bucket "Fondasi Baru" bernama "Pengerjaan Pesanan". */
export const bucketLabelOf = (bucket, track) => (track === BUILD_TRACK && bucket === "FONDASI" ? BUILD_STEP.label : bucketStyle(bucket).label);
export const stepOf = (no, track) => (track === BUILD_TRACK && no === 6 ? BUILD_STEP : STEP_BY_NO[no]);
/** Alur produk jalur pengerjaan: "KASUR" (racikan + uji tekstur/berat badan) atau "NON_KASUR" (divan/sofa: tanpa uji kasur). Dari klasifikasi KANONIS server (card.product.flow). */
// Tanpa fallback ke kasur: klasifikasi belum ada/jelas = "UNCONFIRMED" (pengujian/racikan khusus kasur ditahan sampai jenis produk dikonfirmasi pada order).
export const productFlowOf = (card) => (card?.track === BUILD_TRACK ? card?.product?.flow || "UNCONFIRMED" : null);
export const isUnconfirmed = (card) => productFlowOf(card) === "UNCONFIRMED";
/** Pemakaian/racikan dicatat PIC Bahan (ditugaskan atau sudah ada catatan): PIC Meja tidak mengisi ulang (satu sumber). */
export const materialsByPic = (card) => (card?.track === BUILD_TRACK ? !!(card?.build?.materialOperator || card?.build?.record) : !!(card?.materialPic?.materialOperator || card?.materialPic?.record)); // Fase 3: LAYANAN juga (PIC Bahan per pekerjaan)
/** Fase 3: pekerjaan LAYANAN (restorasi) yang punya PIC Bahan ditugaskan/tercatat. */
export const isPicRestoration = (card) => card?.track !== BUILD_TRACK && !!card?.materialPic;
/** Pemakaian bahan tahap ini dicatat PIC Bahan (bukan Meja): tahap 6 (semua jalur) dan tahap 7 (LAYANAN). */
export const stepMaterialsByPic = (card, stepNo) => (stepNo === 6 || (stepNo === 7 && isPicRestoration(card))) && materialsByPic(card);
export const isNonKasur = (card) => productFlowOf(card) === "NON_KASUR";
/** Aturan media per tahap menurut jalur: tahap 6 jalur pengerjaan = foto ATAU video (video wajib hanya pada jalur restorasi). */
export const mediaRuleFor = (stepNo, track) => (track === BUILD_TRACK && stepNo === 6 ? { min: 1, video: false } : MEDIA_RULES[stepNo] || { min: 0, video: false });

export const OLD_MATERIALS = Object.freeze([
  { value: "PER", label: "Per / Spring" }, { value: "BUSA", label: "Busa" }, { value: "REBONDED", label: "Rebonded" },
  { value: "KAIN", label: "Kain" }, { value: "LATEX", label: "Latex" }, { value: "KAPUK", label: "Kapuk" }, { value: "LAINNYA", label: "Lainnya" },
]);
export const TEXTURE_VERDICTS = Object.freeze([
  { value: "PAS", label: "PAS", tone: "green" },
  { value: "TERLALU_KERAS", label: "Terlalu Keras", tone: "orange" },
  { value: "TERLALU_EMPUK", label: "Terlalu Empuk", tone: "orange" },
]);
export const MATTRESS_STYLES = Object.freeze([
  { value: "BIASA", label: "Kasur Biasa" }, { value: "PLUSHTOP", label: "Plushtop" }, { value: "PILLOWTOP", label: "Pillowtop" },
]);
export const CORNER_CHECKLIST = Object.freeze([
  { key: "jahitan", label: "Jahitan rapi & kuat" }, { key: "list", label: "List terpasang rata" },
  { key: "resleting", label: "Resleting berfungsi" }, { key: "kebersihan", label: "Kasur bersih" },
]);

// Kebutuhan media per tahap (cermin kontrak server).
export const MEDIA_RULES = Object.freeze({
  1: { min: 1, video: false }, 2: { min: 1, video: true }, 3: { min: 1, video: false }, 4: { min: 1, video: true },
  5: { min: 0, video: false }, 6: { min: 1, video: true }, 7: { min: 1, video: false }, 8: { min: 1, video: true },
  9: { min: 1, video: false }, 10: { min: 0, video: false }, 11: { min: 1, video: false }, 12: { min: 1, video: false },
});

// Bucket papan/Andon -> tampilan (hanya 4 hue DS: accent/red/orange/green + netral).
export const BUCKET_STYLE = Object.freeze({
  // P9A — pickup berhasil, unit sudah "Masuk Produksi", TAPI belum
  // dikonfirmasi tiba secara fisik di workshop.
  DALAM_PERJALANAN: { label: "Dalam perjalanan ke workshop", badge: "neutral", tv: "bg-inset text-ink3", dot: "bg-ink3" },
  ANTREAN: { label: "Antrean", badge: "neutral", tv: "bg-inset text-ink2", dot: "bg-ink3" },
  BONGKAR: { label: "Proses Bongkar", badge: "accent", tv: "bg-accentbg text-accent", dot: "bg-accent" },
  DIAGNOSA: { label: "Diagnosa", badge: "accent", tv: "bg-accentbg text-accent", dot: "bg-accent" },
  MENUNGGU_BAHAN: { label: "Tertunda — menunggu bahan", badge: "red", tv: "bg-red text-white", dot: "bg-red" },
  FONDASI: { label: "Fondasi Baru", badge: "accent", tv: "bg-accentbg text-accent", dot: "bg-accent" },
  LAPISAN: { label: "Lapisan Baru", badge: "accent", tv: "bg-accentbg text-accent", dot: "bg-accent" },
  QC: { label: "QC / Rework", badge: "orange", tv: "bg-orange text-white", dot: "bg-orange" },
  CORNER: { label: "Di Meja Corner", badge: "accent", tv: "bg-bluesolid text-white", dot: "bg-bluesolid" },
  HANDOFF: { label: "Serah ke Gudang", badge: "green", tv: "bg-greenbg text-green", dot: "bg-green" },
  SELESAI: { label: "Selesai", badge: "green", tv: "bg-green text-white", dot: "bg-green" },
  TERHENTI: { label: "Perlu Tindakan", badge: "red", tv: "bg-redbg text-red", dot: "bg-red" },
});
export const bucketStyle = (key) => BUCKET_STYLE[key] || BUCKET_STYLE.ANTREAN;

// Pilihan pengguna hanya Normal/Tinggi. Komplain = turunan ComplaintCase resmi (bukan pilihan); nilai lama Mendesak tersimpan apa adanya, tampil Tinggi.
export const PRIORITIES = Object.freeze([{ value: 0, label: "Normal" }, { value: 1, label: "Tinggi" }]);
// peringkat: 3=Komplain(merah) 1/2=Tinggi(oranye) 0=Normal(netral) — dipakai badge kartu.
export const priorityTone = (priority) => (priority >= 3 ? "red" : priority >= 1 ? "orange" : "neutral");

// P9B.1 — kolom pipeline Status Produksi (Command Center). Label & urutan HARUS sama dengan backend
// (lib/domain/productionSteps.js#COMMAND_CENTER_COLUMNS) — dipertahankan sebagai daftar statis di sini karena murni
// label tampilan (server tetap kirim `key`+`label` per kolom, ini hanya fallback/urutan bila server belum kirim).
// "Belum Dijadwalkan"/"Dijadwalkan" DIHAPUS sebagai kolom (status jadwal sekarang badge kartu, bukan kolom) —
// diganti "Dalam Perjalanan"/"Tiba / Belum Mulai" yang mencerminkan KEADAAN FISIK unit, bukan status jadwalnya.
export const COMMAND_CENTER_COLUMNS = Object.freeze([
  "AKAN_MASUK", "DALAM_PERJALANAN", "TIBA_BELUM_MULAI", "PENGERJAAN", "UJI_HASIL", "BONGKAR", "UJI_FONDASI", "FONDASI", "LAPISAN", "UJI_TEKSTUR", "CORNER", "SIAP_KIRIM",
]);

// Badge tanggal target (terpisah dari badge prioritas): besok=oranye, hari ini & belum mulai=merah, sudah lewat=merah "Terlambat".
// today/tomorrow: string "YYYY-MM-DD" WIB (lihat wibDate()).
export function targetDateBadge(view, today, tomorrow) {
  if (!view?.plan?.productionDate) return null;
  if (view.timer?.late) return { tone: "red", label: "Terlambat" };
  if (view.plan.productionDate === today && (view.progress?.done ?? 0) === 0 && !view.activeOp) return { tone: "red", label: "Target hari ini" };
  if (view.plan.productionDate === tomorrow) return { tone: "orange", label: "Target besok" };
  return null;
}

// Teks tombol aksi utama untuk kartu pekerja.
export function actionLabel(next, { stageLabel, track } = {}) {
  if (!next) return null;
  const step = stepOf(next.stepNo, track);
  switch (next.action) {
    case "START_WITH_EVIDENCE": return "Mulai: Foto Sebelum Bongkar";
    case "START": return `Mulai ${stageLabel || step?.label || "Tahap"}`;
    case "RESUME": return "Lanjutkan Pekerjaan";
    case "COMPLETE": return !next.serviceMissing && next.continueOnly ? "Lanjutkan" : `Kirim ${step?.label || "Tahap"}`;
    case "EVIDENCE": return next.general ? "Kirim Catatan & Dokumentasi Umum" : next.rework ? `Ulangi ${step?.label || "Lapisan"} (Rework)` : `Kirim Bukti ${step?.label || ""}`.trim();
    case "TEST": return "Kirim Uji Tekstur Akhir";
    case "HANDOFF": return "Kirim ke Corner";
    case "START_CORNER": return "Mulai Jahit";
    case "FINISH": return "Konfirmasi Selesai";
    default: return null;
  }
}

// Aksi yang TIDAK butuh form (langsung kirim).
export function isQuickAction(next) {
  // continueOnly = bukti sudah ada di sumbernya (diagnosa tahap 5; catatan PIC QC tahap 2/4) -> satu ketuk "Lanjutkan" tanpa formulir.
  return next?.action === "START" || next?.action === "RESUME" || (next?.action === "COMPLETE" && !!next.continueOnly);
}

export function waitCopy(next) {
  switch (next?.wait) {
    // P9A (One-Location Production Intake) — unit sudah "Masuk Produksi"
    // (pickup berhasil) tapi belum dikonfirmasi tiba di workshop; tahap
    // produksi tidak bisa dimulai sampai tombol "Unit Tiba di Workshop" di
    // kartu Planner diklik (server menegakkan ulang, bukan cuma UI).
    case "PENDING_ARRIVAL": return { title: "Menunggu konfirmasi kedatangan", text: "Unit sudah masuk produksi (pickup berhasil) tapi belum dikonfirmasi tiba di workshop. Konfirmasi kedatangan dulu di Rencana Produksi sebelum tahap ini bisa dimulai." };
    case "AWAITING_QC": return { title: "Menunggu QC", text: "Petugas QC akan menguji unit ini. Anda bisa lanjut ke unit lain." };
    case "QC_BEFORE_PENDING": return { title: "Menunggu QC sebelum bongkar", text: "PIC QC perlu mencatat uji kasur sebelum bongkar (kesesuaian keluhan, feel awal, berat penguji, penurunan kasur utuh). Setelah tercatat, tombol Lanjutkan muncul di sini." };
    case "FOUNDATION_TEST_PENDING": return { title: "Menunggu uji fondasi awal", text: "PIC QC perlu mencatat uji fondasi awal (tinggi tanpa beban dan dibebani, berat penguji, metode). Setelah tercatat, tombol Lanjutkan muncul di sini." };
    case "PRODUCT_TYPE_UNCONFIRMED": return { title: "Jenis produk perlu dikonfirmasi", text: `${next.problem || "Jenis produk pada order belum jelas."} Minta Sales memperbaiki jenis produk pada order — produksi tidak mengubah order. Catatan dan dokumentasi umum tetap bisa disimpan; racikan dan pengujian khusus kasur ditahan sampai jelas.` };
    case "CORNER_NOT_CONFIRMED": return { title: "Kebutuhan Corner belum dikonfirmasi", text: "Production Lead perlu mengonfirmasi apakah pekerjaan ini butuh Corner (kain/jahit) di Unit 360 › Proses. QC dan tahap berikutnya menunggu." };
    case "USAGE_NOT_RECORDED": return { title: "Menunggu PIC Bahan", text: "Pemakaian bahan pekerjaan ini dicatat PIC Bahan lebih dulu (satu sumber pemakaian aktual). Setelah tercatat, PIC Meja bisa menutup tahap ini tanpa mengisi bahan lagi." };
    case "RACIKAN_NOT_RECORDED": return { title: "Menunggu PIC Bahan", text: "Racikan fondasi/lapisan belum dicatat PIC Bahan. Pengerjaan boleh berjalan; bukti dikirim setelah racikan tercatat." };
    case "MATERIAL_NOT_READY": return { title: "Bahan belum turun", text: "Gudang belum menyerahkan bahan untuk tahap berikutnya. Tekan “Tunda Pekerjaan” (Menunggu bahan) bila bahan dibutuhkan sekarang." };
    case "READY_TO_FINISH": return { title: "Siap diselesaikan", text: "Semua tahap kerja tuntas. Tekan Selesaikan Produksi — QC tidak diwajibkan pada mode adaptasi (dicatat tidak dilakukan, bukan lulus)." };
    case "MATERIAL_SHORTAGE": return { title: "Tertunda — menunggu bahan", text: "Laporan kekurangan bahan sudah terkirim ke Gudang. Yang bertindak: Gudang. Pekerjaan bisa dilanjutkan setelah bahan diserahkan." };
    case "SERVICE_NOT_SET": return { title: "Menunggu keputusan layanan", text: "Diagnosa sudah terkirim. Production Lead perlu menetapkan layanan unit sebelum pekerjaan dilanjutkan." };
    case "DIAGNOSIS_MANUAL_UNMAPPED": return { title: "Menunggu pemetaan bahan manual", text: "Diagnosa sudah terkirim. Production Lead perlu memetakan bahan manual ke katalog (Unit 360 > Bahan) sebelum pekerjaan dilanjutkan." };
    case "DIAGNOSIS_BOM_EMPTY": return { title: "Rencana bahan masih kosong", text: "Diagnosa sudah terkirim tetapi belum ada bahan katalog. Buka Unit 360 > Pekerjaan > Revisi Diagnosis dan isi bahan yang dibutuhkan." };
    case "AWAITING_WAREHOUSE": return { title: "Menunggu Gudang", text: "Barang jadi sudah diserahkan dan menunggu diterima Gudang." };
    case "HANDOFF_REJECTED": return { title: "Ditolak Gudang", text: "Barang jadi ditolak Gudang. Production Lead akan menentukan tindak lanjut." };
    case "EXCEPTION_OPEN": return { title: "Perlu tindakan Production Lead", text: "Ada konflik data pada unit ini. Hubungi Production Lead." };
    case "COMPLETED": return { title: "Selesai", text: "Produksi unit ini sudah selesai dan diterima Gudang." };
    case "UNIT_NOT_IN_PRODUCTION": return { title: "Unit tidak dalam produksi", text: "Status unit diubah di luar alur produksi. Hubungi Production Lead." };
    default: return { title: "Belum bisa dikerjakan", text: "Tahap ini belum bisa dikerjakan sekarang." };
  }
}

// Galat server -> kalimat Bahasa Indonesia untuk pekerja (tanpa kode teknis/UUID).
export function friendlyError(error) {
  if (!error) return "";
  const code = error.code || "";
  if (error.status === 0 || code === "NETWORK" || /timeout|terputus|Failed to fetch/i.test(error.message || "")) return "Koneksi terputus. Data Anda aman — tekan Coba Lagi saat sinyal kembali.";
  if (code === "STEP_REVISION_CONFLICT" || code === "WORKSHOP_REVISION_CONFLICT") return "Data unit sudah berubah (mungkin dikerjakan dari HP lain). Kartu dimuat ulang — periksa lalu kirim lagi.";
  if (code === "STEP_OUT_OF_ORDER") return `Tahap ini belum waktunya. Kerjakan dulu: ${STEP_BY_NO[error.detail?.expectedStep]?.label || "tahap sebelumnya"}.`;
  if (code.startsWith("STEP_WAITING_")) return error.message;
  if (code === "WORKSHOP_OPERATOR_MISMATCH") return "Unit ini ditugaskan ke PIC lain. Minta Production Lead memindahkan tugas bila perlu.";
  if (code === "WORKSHOP_WORK_CENTER_MISMATCH") return "Meja/workshop tidak sesuai penugasan. Muat ulang kartu.";
  if (code === "STEP_WRITER_OFF" || code === "EVIDENCE_WRITER_OFF") return "Pekerjaan unit ini belum bisa dicatat dari aplikasi ini. Hubungi Production Lead.";
  if (code === "STEP_MEDIA_NOT_FOUND") return "Ada foto/video yang belum selesai terunggah. Unggah ulang lalu kirim.";
  if (code === "EVIDENCE_TOO_LARGE") return "Berkas terlalu besar (video maks. 80 MB, foto maks. 15 MB). Rekam lebih singkat.";
  if (code === "IDEMPOTENCY_CONFLICT") return "Isian berubah setelah terkirim. Muat ulang kartu lalu kirim sebagai isian baru.";
  if (code === "SHORTAGE_ALREADY_OPEN") return "Pekerjaan ini sudah tertunda karena menunggu bahan — Gudang masih menanganinya.";
  if (code === "PLAN_STATION_FULL") return `Meja sudah penuh (maks. ${error.detail?.capacity ?? 3} unit per meja). Kartu dikembalikan — pilih meja lain atau keluarkan unit dari meja itu.`;
  if (code === "PLAN_REVISION_CONFLICT") return "Rencana unit ini sudah diubah orang lain. Kartu dikembalikan dan tampilan dimuat ulang — coba lagi.";
  if (code === "STATION_ORDER_STALE") return "Isi meja berubah saat Anda menyeret (ada unit masuk/keluar). Kartu dikembalikan dan tampilan dimuat ulang — atur ulang urutannya.";
  if (code === "STATION_ORDER_INVALID") return "Urutan tidak valid. Tampilan dimuat ulang — coba lagi.";
  if (code === "PLAN_STATION_INVALID") return "Meja tujuan tidak dikenal. Muat ulang halaman.";
  if (error.status === 403) return "Anda tidak punya akses untuk aksi ini.";
  if (error.status === 503) return "Fitur ini belum aktif untuk unit ini.";
  return error.message || "Terjadi kesalahan. Coba lagi.";
}

// Validasi awal form tahap (cermin kontrak server). Mengembalikan pesan galat atau null.
export function validateStepForm(stepNo, form, { mediaItems = [], track, flow = "KASUR", byPic = false, gated = false, layersRequired = false } = {}) {
  const rule = mediaRuleFor(stepNo, track);
  const done = mediaItems.filter((m) => m.status === "done");
  if (mediaItems.some((m) => m.status === "uploading")) return "Tunggu unggahan selesai.";
  if (mediaItems.some((m) => m.status === "error")) return "Ada unggahan gagal — coba lagi atau hapus.";
  if (done.length < rule.min) return `Lampirkan minimal ${rule.min} foto/video.`;
  if (rule.video && !done.some((m) => m.kind === "video")) return "Tahap ini wajib video.";
  const f = form || {};
  const num = (v) => Number(String(v ?? "").replace(",", "."));
  switch (stepNo) {
    case 1: return f.conditionConfirmed ? null : "Centang konfirmasi ukuran & kondisi kain luar.";
    case 2: return (f.feelNote || "").trim().length >= 3 ? null : "Tulis catatan rasa awal.";
    case 3:
      // Fase 2 (LAYANAN): lapisan awal dicatat di Catatan Komponen (wajib); centang jenis material lama menjadi opsional.
      if (gated && layersRequired) return "Catat susunan lapisan awal (atas ke bawah) di bagian Catatan Komponen dulu.";
      return gated || (f.oldMaterials || []).length ? null : "Centang minimal satu material lama.";
    case 4: {
      const a = num(f.heightBeforeCm); const b = num(f.heightCompressedCm); const w = num(f.testerWeightKg);
      if (!(a > 0) || !(b > 0)) return "Isi tinggi awal dan tinggi saat ditekan (cm).";
      if (b > a) return "Tinggi saat ditekan tidak boleh lebih besar dari tinggi awal.";
      if (!(w > 0)) return "Isi berat penguji (kg).";
      return null;
    }
    case 5: return (f.diagnosis || "").trim().length >= 10 ? null : "Tulis penjelasan diagnosa (minimal 10 karakter).";
    case 6:
      if (track === BUILD_TRACK) { // bahan opsional pada jalur pengerjaan; kasur custom wajib mencatat racikan fondasi dan/atau lapisan (kecuali dicatat PIC Bahan)
        // Jenis produk belum jelas: catatan + dokumentasi UMUM tetap boleh disimpan (tanpa racikan); hanya racikan/uji khusus jenis produk yang menunggu Sales.
        if (flow === "KASUR" && !byPic && (f.racikanFondasi || "").trim().length < 3 && (f.racikanLapisan || "").trim().length < 3) return "Isi racikan fondasi dan/atau lapisan.";
        return (f.note || "").trim().length >= 3 ? null : "Jelaskan pengerjaan pesanan.";
      }
      if (!byPic && !(f.materials || []).some((m) => num(m.qty) > 0)) return "Pilih bahan Gudang yang dipakai.";
      return (f.note || "").trim().length >= 3 ? null : "Jelaskan isi fondasi baru.";
    case 7: return byPic || (f.materials || []).some((m) => num(m.qty) > 0) ? null : "Pilih bahan Gudang yang dipakai.";
    case 8: {
      if (!f.verdict) return "Pilih hasil uji: PAS, Terlalu Keras, atau Terlalu Empuk.";
      return num(f.testerWeightKg) > 0 ? null : "Isi berat penguji (kg).";
    }
    case 10:
      if (!f.mattressStyle) return "Pilih model kasur.";
      if ((f.fabricSpec || "").trim().length < 2) return "Isi spesifikasi/warna kain.";
      return (f.borderColor || "").trim().length >= 2 ? null : "Isi warna list.";
    case 11: return CORNER_CHECKLIST.every((c) => f.checklist?.[c.key]) ? null : "Lengkapi checklist jahitan.";
    case 12: return f.confirm ? null : "Centang konfirmasi selesai.";
    default: return null;
  }
}

// Payload server dari form UI (angka dinormalisasi, field kosong dibuang).
export function buildStepPayload(stepNo, form, { track, flow = "KASUR", byPic = false } = {}) {
  const f = form || {};
  const num = (v) => Number(String(v ?? "").replace(",", "."));
  const lines = (list) => (list || []).filter((m) => num(m.qty) > 0).map((m) => ({ materialId: m.materialId, qty: num(m.qty) }));
  switch (stepNo) {
    case 1: return { conditionConfirmed: !!f.conditionConfirmed, conditionNote: f.conditionNote?.trim() || undefined };
    case 2: return { feelNote: (f.feelNote || "").trim() };
    case 3: return { oldMaterials: (f.oldMaterials || []).map((type) => ({ type, note: f.oldMaterialNotes?.[type]?.trim() || undefined })), note: f.note?.trim() || undefined };
    case 4: return { heightBeforeCm: num(f.heightBeforeCm), heightCompressedCm: num(f.heightCompressedCm), testerWeightKg: num(f.testerWeightKg), foundationIssues: (f.foundationIssues || []).filter(Boolean), note: f.note?.trim() || undefined };
    case 5: return { diagnosis: (f.diagnosis || "").trim(), inputMethod: f.inputMethod === "VOICE" ? "VOICE" : "TEXT" };
    case 6: {
      const base = { materials: byPic ? [] : lines(f.materials), note: (f.note || "").trim() };
      if (track === BUILD_TRACK && flow === "KASUR" && !byPic) base.racikan = { fondasi: (f.racikanFondasi || "").trim() || undefined, lapisan: (f.racikanLapisan || "").trim() || undefined };
      return base;
    }
    case 7: return { materials: byPic ? [] : lines(f.materials), note: f.note?.trim() || undefined };
    case 8: return { verdict: f.verdict, testerWeightKg: num(f.testerWeightKg), note: f.note?.trim() || undefined };
    case 9: return { note: f.note?.trim() || undefined };
    case 10: return { mattressStyle: f.mattressStyle, fabricSpec: (f.fabricSpec || "").trim(), borderColor: (f.borderColor || "").trim(), materials: lines(f.materials), note: f.note?.trim() || undefined };
    case 11: return { checklist: Object.fromEntries(CORNER_CHECKLIST.map((c) => [c.key, !!f.checklist?.[c.key]])), note: f.note?.trim() || undefined };
    case 12: return { confirm: !!f.confirm, note: f.note?.trim() || undefined };
    default: return {};
  }
}

// Draft form lokal (per unit+tahap). Storage bisa diblokir/penuh -> diam-diam tidak menyimpan, form tetap jalan.
const DRAFT_PREFIX = "p8-draft:";
export const draftKey = (runId, stepNo) => `${DRAFT_PREFIX}${runId}:${stepNo}`;
export function loadDraft(storage, runId, stepNo) {
  try {
    const raw = storage?.getItem(draftKey(runId, stepNo));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch { return null; }
}
export function saveDraft(storage, runId, stepNo, draft) {
  try { storage?.setItem(draftKey(runId, stepNo), JSON.stringify({ ...draft, savedAt: new Date().toISOString() })); return true; } catch { return false; }
}
export function clearDraft(storage, runId, stepNo) {
  try { storage?.removeItem(draftKey(runId, stepNo)); } catch { /* abaikan */ }
}

// Kunci idempotensi per NIAT (unit + tahap + revisi): kirim ulang setelah galat jaringan memakai kunci yang sama (replay aman di server);
// setelah berhasil/ditolak final, kunci dilepas sehingga isian berikutnya mendapat kunci baru.
export function createIntentKeys(makeId = () => globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`) {
  const keys = new Map();
  return {
    keyFor(runId, stepNo, revision) {
      const k = `${runId}:${stepNo}:${revision}`;
      if (!keys.has(k)) keys.set(k, `p8-${stepNo}-${makeId()}`.slice(0, 120));
      return keys.get(k);
    },
    release(runId, stepNo, revision) { keys.delete(`${runId}:${stepNo}:${revision}`); },
  };
}

// Galat final (bukan jaringan) -> kunci dilepas; galat jaringan -> kunci dipertahankan untuk Coba Lagi.
/** Galat command PIC Bahan: pesan server yang SPESIFIK (mis. "Anda bukan PIC Bahan yang ditugaskan…") ditampilkan apa adanya; selain itu pesan ramah umum. */
export const friendlyBuildError = (e) => (e?.code && /^BUILD_/.test(e.code) && e.message ? e.message : friendlyError(e));
export const isRetryableError = (error) => !error?.status || error.status >= 500 && error.status !== 503;

export function formatMinutes(total) {
  const m = Math.max(0, Math.round(Number(total) || 0));
  if (m < 60) return `${m} mnt`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} j ${r} mnt` : `${h} jam`;
}

export function stationCapacity(station) {
  const count = station?.items?.length ?? station?.count ?? 0;
  const capacity = station?.capacity ?? 3;
  return { count, capacity, full: count >= capacity, label: `${count}/${capacity} unit` };
}

// Boleh dijatuhkan ke meja? (UI; server tetap memeriksa kapasitas di dalam transaksi)
export function canDropOn(station, item) {
  if (!station || !item) return false;
  if (item.plan?.stationCode === station.code) return false;
  return !stationCapacity(station).full;
}

// Indikator ringkas untuk kartu Planner.
const IND = Object.freeze({
  custody: { label: "Custody", ok: ["OK", "LAHIR_DI_WORKSHOP"] },
  service: { label: "Layanan", ok: ["OK", "TIDAK_BERLAKU"] }, // TIDAK_BERLAKU = jalur pengerjaan (layanan Sales jadi acuan, bukan layanan teknis)
  bom: { label: "BOM", ok: ["OK"] },
  material: { label: "Bahan", ok: ["SUDAH_DISERAHKAN"], bad: ["KEKURANGAN"] },
  workshop: { label: "Workshop", ok: ["BERJALAN"], bad: ["DIJEDA"] },
  qc: { label: "QC", ok: ["LULUS"], bad: ["REWORK"], warn: ["WAIVED"] },
  handoff: { label: "Serah Gudang", ok: ["ACCEPTED"], bad: ["REJECTED"] },
});
export function indicatorList(indicators) {
  return Object.entries(IND).map(([key, def]) => {
    const value = indicators?.[key] ?? "BELUM";
    const tone = def.bad?.includes(value) ? "red" : def.warn?.includes(value) ? "orange" : def.ok.includes(value) ? "green" : "neutral";
    return { key, label: def.label, value, tone };
  });
}

export const initials = (name) => String(name || "?").split(/[\s/]+/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join("") || "?";

// Tanggal lokal WIB "YYYY-MM-DD" (untuk default papan H-1 = besok).
export function wibDate(offsetDays = 0, now = new Date()) {
  return new Date(now.getTime() + 7 * 3600_000 + offsetDays * 86400_000).toISOString().slice(0, 10);
}

// ---- PIC Bahan (jalur pengerjaan): racikan + pemakaian aktual. Validasi mencerminkan server (server tetap pemutus); bahan hanya dari yang diserahkan Gudang.
export function validateMaterialRecord(form, { flow = "KASUR", issued = [] } = {}) {
  const f = form || {};
  if (flow === "RESTORATION") { // LAYANAN: hanya pemakaian aktual; racikan dicatat PIC Meja/QC di Catatan Komponen
    const used = (f.materials || []).filter((m) => Number(String(m.qty ?? "").replace(",", ".")) > 0);
    if (!used.length) return "Isi pemakaian bahan.";
    for (const l of used) {
      const item = issued.find((m) => m.materialId === l.materialId);
      if (!item) return "Bahan yang dipakai harus dari bahan yang diserahkan Gudang.";
      if (Number(String(l.qty).replace(",", ".")) > Number(item.qty) + 1e-9) return `Jumlah ${item.name} melebihi yang diserahkan Gudang (${item.qty}).`;
    }
    return null;
  }
  const num = (v) => Number(String(v ?? "").replace(",", "."));
  const lines = (f.materials || []).filter((m) => num(m.qty) > 0);
  const hasRacikan = (f.racikanFondasi || "").trim().length >= 3 || (f.racikanLapisan || "").trim().length >= 3;
  if (flow === "UNCONFIRMED" && ((f.racikanFondasi || "").trim() || (f.racikanLapisan || "").trim())) return "Jenis produk belum jelas — racikan kasur ditahan sampai Sales mengonfirmasi jenis produk.";
  if (flow === "KASUR") {
    if (((f.racikanFondasi || "").trim() && (f.racikanFondasi || "").trim().length < 3) || ((f.racikanLapisan || "").trim() && (f.racikanLapisan || "").trim().length < 3)) return "Racikan minimal 3 karakter.";
  }
  if (!hasRacikan && !lines.length) return flow === "KASUR" ? "Isi racikan dan/atau pemakaian bahan." : "Isi pemakaian bahan.";
  for (const l of lines) {
    const item = issued.find((m) => m.materialId === l.materialId);
    if (!item) return "Bahan yang dipakai harus dari bahan yang diserahkan Gudang.";
    if (num(l.qty) > Number(item.qty) + 1e-9) return `Jumlah ${item.name} melebihi yang diserahkan Gudang (${item.qty}).`;
  }
  return null;
}
export function buildMaterialRecordBody(form, { flow = "KASUR", revision }) {
  const f = form || {};
  const num = (v) => Number(String(v ?? "").replace(",", "."));
  const body = { expectedRevision: revision, materials: (f.materials || []).filter((m) => num(m.qty) > 0).map((m) => ({ materialId: m.materialId, qty: num(m.qty) })) };
  if (flow === "KASUR") { const fondasi = (f.racikanFondasi || "").trim(); const lapisan = (f.racikanLapisan || "").trim(); if (fondasi || lapisan) body.racikan = { fondasi: fondasi || undefined, lapisan: lapisan || undefined }; }
  const note = (f.note || "").trim(); if (note) body.note = note;
  return body;
}
