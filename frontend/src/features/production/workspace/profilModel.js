import { konfirmasiKerja } from "../orderProduksiModel.js";

// PROFIL UNIT — model MURNI (diuji node --test, tanpa React/DOM). SATU profil unit untuk seluruh workspace Produksi (permintaan Owner 13 Nov 2026):
// Rencana Produksi, Status Produksi, Order Produksi, Papan Meja, Quality Control. Yang dulu tiga tampilan (Ruang Kerja Unit, panel Order Produksi, Unit 360)
// kini satu profil: Ringkasan · Bahan · Foto · Riwayat, ditambah "Meja & QC" (isi Unit 360) hanya untuk unit yang sudah masuk alur Meja.

/** Tab profil. "pekerjaan" (tab lama) sudah dilebur ke Ringkasan — tautan lama tetap mendarat di Ringkasan. */
export const TAB_DASAR = Object.freeze([
  { key: "ringkasan", label: "Ringkasan" },
  { key: "bahan", label: "Bahan" },
  { key: "dokumentasi", label: "Foto" },
  { key: "riwayat", label: "Riwayat" },
]);
export const TAB_MEJA = Object.freeze({ key: "meja", label: "Meja & QC" });
export const BAGIAN_PROFIL = Object.freeze([...TAB_DASAR.map((t) => t.key), TAB_MEJA.key]);

export const normalBagian = (b) => (BAGIAN_PROFIL.includes(b) ? b : "ringkasan");

/** Tab yang tampil: "Meja & QC" hanya bila unit punya pekerjaan di alur Meja, atau halaman pemanggil (Papan Meja / QC) membukanya langsung. */
export function tabProfil(ruang, bagian) {
  return ruang?.alurMeja || ruang?.dokumentasi?.runId || bagian === "meja" ? [...TAB_DASAR, TAB_MEJA] : [...TAB_DASAR];
}


/** SATU status utama untuk kepala profil + keterangan pendek. Yang paling menentukan langkah Produksi tampil sebagai chip; sisanya teks kecil (tanpa label huruf besar).
 *  Posisi yang menentukan (belum diterima, di jalan, siap/terkirim) → posisi. "Di workshop" biasa → status kerja. Status order Sales selalu ikut di keterangan (dikunci = disebut). */
export function statusUtama(ad = {}, ruang = null) {
  const posisi = ad.posisi || null; const kerja = ad.kerja || null;
  const order = ruang?.order?.statusOrder || ad.orderSales || null;
  const posisiMenentukan = !!posisi && posisi.key !== "DI_WORKSHOP" && posisi.key !== "TIDAK_DIKETAHUI";
  const utama = posisiMenentukan ? { teks: posisi.label, nada: posisi.tone, jenis: "posisi" } : kerja ? { teks: kerja.label, nada: kerja.tone || "neutral", jenis: "kerja" } : posisi ? { teks: posisi.label, nada: posisi.tone || "neutral", jenis: "posisi" } : null;
  const meja = ruang?.alurMeja ? [ruang.alurMeja.tahap, ad.meja ? String(ad.meja).replace("TABLE_", "Meja ") : null].filter(Boolean).join(" · ") : ad.meja ? String(ad.meja).replace("TABLE_", "Meja ") : null;
  const keterangan = [
    order ? `Order ${order.label}${order.terkunci ? " (dikunci)" : ""}` : null,
    utama?.jenis === "posisi" && kerja ? kerja.label : null,
    utama?.jenis === "kerja" && posisi ? posisi.label : null,
    meja || null,
  ].filter(Boolean);
  return { utama, keterangan };
}

/** Label pendek status kerja untuk tombol segmen. */
export const LABEL_SEGMEN_KERJA = Object.freeze({ BELUM_DIJADWALKAN: "Belum", DIJADWALKAN: "Dijadwalkan", DIKERJAKAN: "Dikerjakan", TERTUNDA: "Tertunda", SELESAI: "Selesai" });
export const segmenKerja = (km) => (km?.nilaiBoleh || []).map((n) => ({ key: n.key, label: LABEL_SEGMEN_KERJA[n.key] || n.label, judul: n.label }));

/** Tindakan berikutnya dari server → tombol profil. Tindakan kecil = SATU ketukan + konfirmasi singkat (sama dengan Rencana Produksi);
 *  yang butuh layar lain = pindah bagian. null = tidak ada tombol (alasan tetap tampil dari teks server). */
export function aksiLangkah(t, { izin = {}, aktif = true, km = null, adaMeja = false } = {}) {
  switch (t?.aksi) {
    case "CONFIRM_ARRIVAL": return izin.catatPenerimaan && aktif ? { jenis: "tiba", label: "Tandai sudah tiba" } : null;
    case "UBAH_ORDER_DIPROSES": return izin.statusOrder && aktif ? { jenis: "diproses", label: "Ubah ke Diproses" } : null;
    case "MARK_READY": return izin.statusOrder ? { jenis: "siapKirim", label: "Tandai Siap Kirim" } : null;
    case "FINISH_WORK": return izin.statusKerja && aktif && !km?.dikunciAplikasi ? { jenis: "selesai", label: "Catat pekerjaan selesai" } : adaMeja ? { jenis: "bagian", bagian: "meja", label: "Buka Meja & QC", sekunder: true } : null;
    case "OPEN_WORK": return { jenis: "fokus", target: "pf-kerja", label: t.label || "Catat status kerja", sekunder: true };
    case "SET_TARGET": return izin.target ? { jenis: "fokus", target: "pf-target", label: "Tetapkan target" } : null;
    case "OPEN_PLAN": return null; // penjadwalan dilakukan di Rencana Produksi (seret ke meja / Pilih meja), bukan dari profil
    case "PLAN_MATERIAL": return izin.rencanaBahan ? { jenis: "bagian", bagian: "bahan", label: "Susun rencana bahan" } : null;
    case "RECORD_MATERIAL": return izin.pemakaianAktual ? { jenis: "bagian", bagian: "bahan", label: "Catat pemakaian bahan" } : null;
    case "RESOLVE_DELAY": return adaMeja ? { jenis: "bagian", bagian: "meja", label: "Buka Meja & QC", sekunder: true } : null;
    default: return null;
  }
}

/** Teks konfirmasi satu ketukan per jenis tindakan. */
export function teksKonfirmasi(jenis, { unitCode, orderNumber, jumlahUnit = 1 } = {}) {
  const banyak = jumlahUnit > 1 ? ` Order ini punya ${jumlahUnit} unit — status mengikuti aturan order.` : "";
  switch (jenis) {
    case "tiba": return { judul: `${unitCode} sudah tiba di workshop?`, isi: "Dicatat atas nama Anda di lokasi workshop bawaan. Pickup driver yang belum ditutup ikut ditutup otomatis.", ya: "Sudah tiba" };
    case "diproses": return { judul: `Ubah order ${orderNumber || ""} ke Diproses?`, isi: `Sales dan Delivery melihat status yang sama; unit bisa langsung dijadwalkan.${banyak}`, ya: "Ubah ke Diproses" };
    case "siapKirim": return { judul: `Tandai order ${orderNumber || ""} Siap Kirim?`, isi: `Sales dan Delivery melihat status yang sama; tugas pengiriman dibuat bila belum ada.${banyak}`, ya: "Siap Kirim" };
    case "selesai": return konfirmasiKerja("SELESAI", unitCode); // teks resmi yang sama dengan pencatatan status kerja manual
    default: return null;
  }
}

/** Status kerja yang wajib catatan (konfirmasi "sudah dilakukan" = KERJA_PERLU_KONFIRMASI di orderProduksiModel.js). */
export const KERJA_WAJIB_CATATAN = Object.freeze(["TERTUNDA"]);

/** Ringkasan satu baris untuk baris Bahan / Foto di Ringkasan (tanpa kartu kosong besar). */
export function barisBahan(data) {
  const p = data?.adopsi?.pemakaianBahan ?? {}; const rencana = data?.rencanaBahan?.plan;
  const baru = p.baruCatatan ?? 0; const lama = p.komponenLamaDipakaiKembali ?? 0; const sem = p.sementaraPerluRekonsiliasi ?? 0;
  const bagian = [baru ? `${baru} pemakaian` : null, lama ? `${lama} komponen lama` : null, sem ? `${sem} sementara` : null, rencana ? `rencana ${rencana.lines?.length ?? 0} bahan` : null].filter(Boolean);
  return bagian.length ? bagian.join(" · ") : "Belum ada";
}
export function barisFoto(ruang) {
  const d = ruang?.dokumentasi;
  if (!d?.tersedia) return "Setelah masuk alur Meja";
  return d.bolehUnggah ? "Lihat & unggah" : "Lihat";
}

/** Alasan jujur bila langkah berikutnya milik pihak lain (tidak ada tombol yang pasti gagal). */
export function penjelasanTertahan(data) {
  const t = data?.adopsi?.tindakan; if (!t) return null;
  if (t.aksi === "WAIT") return { teks: `Menunggu ${t.aktor && t.aktor !== "—" ? t.aktor : "pihak lain"}${t.detail ? ` — ${t.detail}` : ""}. Tidak ada yang perlu dikerjakan Admin sekarang.`, jalur: null };
  return null;
}

/** "2026-11-13" (WIB) dari ISO; kosong bila tidak ada. Dipakai isian tanggal target. */
export const tanggalWib = (iso) => (iso ? new Date(new Date(iso).getTime() + 7 * 3600000).toISOString().slice(0, 10) : "");
/** Target selesai disimpan pukul 17:00 WIB pada tanggal yang dipilih (sama dengan formulir lama). */
export const isoTarget = (tgl) => (tgl ? new Date(`${tgl}T17:00:00+07:00`).toISOString() : null);
