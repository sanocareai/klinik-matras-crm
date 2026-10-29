// MODEL ALUR KOMPLAIN UNTUK TAMPILAN (redesign UI/UX, Okt 2026) — MURNI (tanpa React), dites di frontend/tests/complaintFlow.test.js.
//
// Backend TETAP memegang 15 status rinci, graf transisi, izin lintas divisi, audit, dan gerbang konfirmasi pelanggan. File ini hanya MENERJEMAHKAN status rinci ke:
//   • 4 tahap yang dipahami tim:  Terima & Periksa → Tentukan Solusi → Kerjakan & Kirim → Konfirmasi Pelanggan;
//   • SATU aksi utama yang kontekstual (kalimat natural, bukan nama status) + daftar "Tindakan lainnya".
// Tidak ada transisi baru yang dibuat di sini: setiap `ke` HARUS ada di ALLOWED_TRANSITIONS (cermin backend, dikunci tes). SELESAI hanya lewat jenis "konfirmasi"
// (POST /confirm-customer); tidak pernah lewat transisi status.
import { ALLOWED_TRANSITIONS } from "./complaintLabels.js";
import { rolesOf } from "../../lib/roles.js";

export const STATUS_TUTUP = Object.freeze(["SELESAI", "DIBATALKAN"]);
export const kasusTutup = (kase) => STATUS_TUTUP.includes(kase?.status);

export const TAHAP = Object.freeze([
  { no: 1, kunci: "PERIKSA", label: "Terima & Periksa", pendek: "Periksa", tanya: "Apa keluhannya dan apa penyebabnya?" },
  { no: 2, kunci: "SOLUSI", label: "Tentukan Solusi", pendek: "Solusi", tanya: "Apa yang akan dilakukan untuk pelanggan?" },
  { no: 3, kunci: "KERJAKAN", label: "Kerjakan & Kirim", pendek: "Kerjakan", tanya: "Sedang dikerjakan dan dikirim ke pelanggan." },
  { no: 4, kunci: "KONFIRMASI", label: "Konfirmasi Pelanggan", pendek: "Konfirmasi", tanya: "Pelanggan sudah puas?" },
]);

// Status rinci → tahap. Status "menunggu" mengikuti tahap tempat kasus tertahan: bahan/jadwal = Kerjakan & Kirim; menunggu pelanggan = Konfirmasi Pelanggan.
export const TAHAP_STATUS = Object.freeze({
  BARU: 1, VERIFIKASI: 1, INVESTIGASI: 1,
  ACTION_REQUIRED: 2,
  DIJADWALKAN: 3, DALAM_PENANGANAN: 3, QC: 3, SIAP_DIKIRIM: 3, DIKIRIM_ULANG: 3, MENUNGGU_MATERIAL: 3, MENUNGGU_JADWAL: 3,
  KONFIRMASI_CUSTOMER: 4, MENUNGGU_CUSTOMER: 4,
});
export const tahapDari = (status) => TAHAP_STATUS[status] ?? null; // null = sudah tutup (riwayat)
export const statusUntukTahap = (no) => Object.keys(TAHAP_STATUS).filter((s) => TAHAP_STATUS[s] === no);
export const TAHAP_AKTIF_SEMUA = Object.freeze(Object.keys(TAHAP_STATUS));

// Keadaan sekarang dalam kalimat awam (status rinci tetap tampil kecil di drawer untuk audit).
export const KEADAAN = Object.freeze({
  BARU: "Kasus baru, belum diperiksa",
  VERIFIKASI: "Keluhan sedang diperiksa",
  INVESTIGASI: "Sedang mencari penyebab masalah",
  ACTION_REQUIRED: "Solusi sedang ditentukan",
  DIJADWALKAN: "Pengambilan/pemeriksaan sudah dijadwalkan",
  DALAM_PENANGANAN: "Sedang dikerjakan",
  QC: "Menunggu pemeriksaan QC",
  SIAP_DIKIRIM: "Siap dikirim ke pelanggan",
  DIKIRIM_ULANG: "Sedang dikirim ke pelanggan",
  KONFIRMASI_CUSTOMER: "Menunggu konfirmasi pelanggan",
  MENUNGGU_CUSTOMER: "Menunggu tanggapan pelanggan",
  MENUNGGU_MATERIAL: "Tertahan: menunggu bahan",
  MENUNGGU_JADWAL: "Tertahan: menunggu jadwal",
  SELESAI: "Selesai",
  DIBATALKAN: "Dibatalkan",
});
export const TERTAHAN = Object.freeze(["MENUNGGU_MATERIAL", "MENUNGGU_JADWAL", "MENUNGGU_CUSTOMER"]);

// ─── izin (CERMIN constants/permissions.js — hanya untuk petunjuk di tombol; penegak tetap server, 403). Dikunci tes terhadap backend. ───
export const PERAN_AKSI = Object.freeze({
  UBAH_STATUS: ["ADMIN", "OWNER", "SALES", "PRODUCTION_LEAD", "QC_LEAD", "WAREHOUSE", "DISPATCHER"], // complaint:write
  TUGAS_KIRIM: ["ADMIN", "OWNER", "DISPATCHER", "LEADER_DRIVER"], // job:write
  MINTA_BAHAN: ["ADMIN", "OWNER", "WAREHOUSE"], // inventory:write
  TAUTKAN_QC: ["ADMIN", "OWNER", "QC_LEAD"], // qc:write
  KONFIRMASI: ["ADMIN", "OWNER", "SALES", "PRODUCTION_LEAD", "DISPATCHER"], // order:write (catat tindak lanjut & konfirmasi pelanggan)
});
export const SIAPA = Object.freeze({
  UBAH_STATUS: "Sales, Produksi, QC, Warehouse, atau Delivery",
  TUGAS_KIRIM: "Delivery (dispatcher)",
  MINTA_BAHAN: "Warehouse",
  TAUTKAN_QC: "QC",
  KONFIRMASI: "Sales (atau Produksi/Delivery yang memegang order)",
});
export const bisaAksi = (user, izin) => rolesOf(user).some((r) => (PERAN_AKSI[izin] || []).includes(r));
export const pesanIzin = (izin) => `Hanya ${SIAPA[izin] || "divisi terkait"} yang bisa melakukan ini.`;

// ─── kalimat transisi ───
const LABEL_TRANSISI = {
  VERIFIKASI: "Mulai periksa keluhan",
  INVESTIGASI: "Cari penyebab masalah",
  ACTION_REQUIRED: "Lanjut tentukan solusi",
  DIJADWALKAN: "Tandai sudah dijadwalkan",
  DALAM_PENANGANAN: "Kerjakan",
  QC: "Kirim ke QC",
  SIAP_DIKIRIM: "Tandai siap dikirim",
  DIKIRIM_ULANG: "Tandai sudah dikirim",
  KONFIRMASI_CUSTOMER: "Minta konfirmasi pelanggan",
  MENUNGGU_CUSTOMER: "Tunggu tanggapan pelanggan",
  MENUNGGU_MATERIAL: "Tahan: menunggu bahan",
  MENUNGGU_JADWAL: "Tahan: menunggu jadwal",
  DIBATALKAN: "Batalkan kasus",
};
const LABEL_KHUSUS = { "QC>DALAM_PENANGANAN": "QC belum lolos — kerjakan lagi", "KONFIRMASI_CUSTOMER>DALAM_PENANGANAN": "Pelanggan belum puas — kerjakan lagi", "QC>SIAP_DIKIRIM": "QC lolos — siap dikirim",
  "MENUNGGU_MATERIAL>ACTION_REQUIRED": "Ubah solusi", "MENUNGGU_JADWAL>ACTION_REQUIRED": "Ubah solusi", "MENUNGGU_CUSTOMER>VERIFIKASI": "Periksa ulang keluhan", "MENUNGGU_CUSTOMER>ACTION_REQUIRED": "Pelanggan sudah menjawab — tentukan solusi" };
export const labelTransisi = (dari, ke) => LABEL_KHUSUS[`${dari}>${ke}`] || LABEL_TRANSISI[ke] || ke;

// ─── aksi utama per status ───
// jenis: "status" (POST /status ke `ke`) | "tugasKirim" (POST /delivery-task, jobType; backend sendiri memindah status) | "konfirmasi" (POST /confirm-customer — SATU-SATUNYA jalan ke SELESAI) | "pilihCara" (pilih cara menangani)
const UTAMA = {
  BARU: { jenis: "status", ke: "VERIFIKASI", label: "Mulai periksa keluhan", bantuan: "Cek keluhan pelanggan dan data order/unit-nya." },
  VERIFIKASI: { jenis: "status", ke: "INVESTIGASI", label: "Cari penyebab masalah", bantuan: "Telusuri kenapa masalah ini terjadi, lalu catat penyebabnya." },
  INVESTIGASI: { jenis: "status", ke: "ACTION_REQUIRED", label: "Lanjut tentukan solusi", bantuan: "Isi penyebab masalah, lalu tentukan solusi untuk pelanggan." },
  ACTION_REQUIRED: { jenis: "pilihCara", label: "Mulai kerjakan solusi", bantuan: "Isi solusi yang disepakati, lalu pilih cara menanganinya." },
  DIJADWALKAN: { jenis: "status", ke: "DALAM_PENANGANAN", label: "Mulai dikerjakan", bantuan: "Unit sudah dijadwalkan — mulai pengerjaan." },
  DALAM_PENANGANAN: { jenis: "status", ke: "QC", label: "Selesai dikerjakan — kirim ke QC", bantuan: "Pengerjaan selesai? Serahkan ke QC untuk diperiksa." },
  QC: { jenis: "status", ke: "SIAP_DIKIRIM", label: "QC lolos — siap dikirim", bantuan: "Hasil pemeriksaan QC baik; siapkan pengiriman." },
  SIAP_DIKIRIM: { jenis: "tugasKirim", jobType: "DELIVERY", label: "Buat tugas kirim ulang", bantuan: "Delivery akan menjadwalkan pengiriman barang ke pelanggan." },
  DIKIRIM_ULANG: { jenis: "status", ke: "KONFIRMASI_CUSTOMER", label: "Barang sudah diterima — minta konfirmasi pelanggan", bantuan: "Hubungi pelanggan dan pastikan masalahnya teratasi." },
  KONFIRMASI_CUSTOMER: { jenis: "konfirmasi", label: "Pelanggan puas — selesaikan kasus", bantuan: "Selesaikan HANYA bila pelanggan sudah menyatakan puas." },
  MENUNGGU_MATERIAL: { jenis: "status", ke: "DALAM_PENANGANAN", label: "Bahan sudah tersedia — lanjut kerjakan", bantuan: "Bahan yang diminta sudah datang? Lanjutkan pengerjaan." },
  MENUNGGU_JADWAL: { jenis: "status", ke: "DIJADWALKAN", label: "Jadwal sudah ditetapkan", bantuan: "Jadwal sudah ada? Tandai agar pengerjaan bisa dilanjutkan." },
};
export function aksiUtama(kase) {
  if (!kase || kasusTutup(kase)) return null;
  if (kase.status === "MENUNGGU_CUSTOMER") {
    // Bila solusi sudah disepakati, pelanggan yang ditunggu = konfirmasi; bila belum, pelanggan yang ditunggu = informasi untuk pemeriksaan.
    return kase.resolution
      ? { jenis: "status", ke: "KONFIRMASI_CUSTOMER", label: "Pelanggan sudah menjawab — minta konfirmasi", bantuan: "Pelanggan sudah membalas? Lanjutkan ke konfirmasi." }
      : { jenis: "status", ke: "INVESTIGASI", label: "Pelanggan sudah menjawab — lanjut periksa", bantuan: "Informasi dari pelanggan sudah ada? Lanjutkan pemeriksaan." };
  }
  const a = UTAMA[kase.status]; if (!a) return null;
  const izin = a.jenis === "konfirmasi" ? "KONFIRMASI" : a.jenis === "tugasKirim" ? "TUGAS_KIRIM" : "UBAH_STATUS";
  return { ...a, izin };
}

// Cara menangani (tahap Tentukan Solusi): tiap pilihan memakai aksi backend yang SUDAH ada.
export function pilihanCara(kase) {
  const dari = kase?.status; const ok = (ke) => (ALLOWED_TRANSITIONS[dari] || []).includes(ke);
  return [
    ok("DIJADWALKAN") && { kunci: "ambil", jenis: "tugasKirim", jobType: "PICKUP", izin: "TUGAS_KIRIM", label: "Ambil unit untuk diperiksa atau diperbaiki", bantuan: "Membuat tugas pengambilan di Delivery." },
    ok("SIAP_DIKIRIM") && { kunci: "ganti", jenis: "status", ke: "SIAP_DIKIRIM", izin: "UBAH_STATUS", label: "Kirim barang pengganti tanpa pengambilan", bantuan: "Langsung siap dikirim (tanpa produksi ulang)." },
    ok("MENUNGGU_MATERIAL") && { kunci: "bahan", jenis: "mintaBahan", izin: "MINTA_BAHAN", label: "Butuh bahan dulu", bantuan: "Minta bahan ke Warehouse; kasus ditahan sampai bahan siap." },
    ok("MENUNGGU_JADWAL") && { kunci: "jadwal", jenis: "status", ke: "MENUNGGU_JADWAL", izin: "UBAH_STATUS", label: "Menunggu jadwal dulu", bantuan: "Tahan kasus sampai jadwal tersedia." },
  ].filter(Boolean);
}

// "Tindakan lainnya": semua transisi sah selain aksi utama, ditambah aksi lintas divisi. Pembatalan selalu terakhir dan wajib alasan.
export function aksiLain(kase) {
  if (!kase || kasusTutup(kase)) return [];
  const utama = aksiUtama(kase); const dari = kase.status; const izinkan = ALLOWED_TRANSITIONS[dari] || [];
  const hasil = [];
  for (const ke of izinkan) {
    if (ke === "DIBATALKAN") continue;
    if (utama?.jenis === "status" && utama.ke === ke) continue;
    if (dari === "ACTION_REQUIRED" && ["DIJADWALKAN", "SIAP_DIKIRIM", "MENUNGGU_JADWAL", "MENUNGGU_MATERIAL"].includes(ke)) continue; // sudah ada di "Mulai kerjakan solusi"
    hasil.push({ jenis: "status", ke, label: labelTransisi(dari, ke), izin: "UBAH_STATUS" });
  }
  if (izinkan.includes("DIJADWALKAN") && dari !== "ACTION_REQUIRED") hasil.push({ jenis: "tugasKirim", jobType: "PICKUP", izin: "TUGAS_KIRIM", label: "Buat tugas pengambilan/inspeksi" });
  if (izinkan.includes("DIKIRIM_ULANG") && !(utama?.jenis === "tugasKirim")) hasil.push({ jenis: "tugasKirim", jobType: "DELIVERY", izin: "TUGAS_KIRIM", label: "Buat tugas kirim ulang" });
  hasil.push({ jenis: "mintaBahan", izin: "MINTA_BAHAN", label: "Minta bahan" });
  if (kase.unit?.id) hasil.push({ jenis: "tautkanQc", izin: "TAUTKAN_QC", label: "Tautkan hasil QC" });
  hasil.push({ jenis: "tindakLanjut", izin: "KONFIRMASI", label: "Catat tindak lanjut ke pelanggan" });
  if (izinkan.includes("DIBATALKAN")) hasil.push({ jenis: "batal", ke: "DIBATALKAN", izin: "UBAH_STATUS", label: "Batalkan kasus", bahaya: true });
  return hasil;
}

export const PRIORITAS_BAHAN = Object.freeze({ LOW: "Rendah", NORMAL: "Biasa", HIGH: "Tinggi", URGENT: "Mendesak" });

// ─── tampilan kartu/daftar ───
export function ringkasTahap(kase) {
  if (kasusTutup(kase)) return { tutup: true, no: null, label: KEADAAN[kase.status], dari: 4 };
  const no = tahapDari(kase.status); const t = TAHAP[no - 1];
  return { tutup: false, no, label: t.label, pendek: t.pendek, dari: TAHAP.length, keadaan: KEADAAN[kase.status], tertahan: TERTAHAN.includes(kase.status) };
}
export function hitungTahap(perStatus = {}) {
  const jumlah = Object.fromEntries(TAHAP.map((t) => [t.no, 0]));
  for (const [st, n] of Object.entries(perStatus)) { const no = tahapDari(st); if (no) jumlah[no] += Number(n) || 0; }
  return jumlah;
}
export const ringkasanKeluhan = (kase, maks = 90) => { const t = String(kase?.description || "").replace(/\s+/g, " ").trim(); return t.length > maks ? `${t.slice(0, maks - 1)}…` : t; };
export const labelJumlah = ({ tampil, total }) => (total === 0 ? "Tidak ada kasus" : tampil >= total ? `Menampilkan semua ${total.toLocaleString("id-ID")} kasus` : `Menampilkan ${tampil.toLocaleString("id-ID")} dari ${total.toLocaleString("id-ID")} kasus`);
