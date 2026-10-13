// Logika murni koreksi data order PKR + pembatalan (tanpa DOM, bisa dites). Server = sumber kebenaran: kemampuan (field boleh/terkunci + alasan), pratinjau (perubahan/blokir/dampak),
// dan penerapan (alasan + expectedRevision + Idempotency-Key). Di sini hanya bentuk isian, perbandingan nilai, dan pemetaan teks.

export const FIELD_URUTAN = ["alamat", "kota", "tanggalKirim", "catatan", "perluDikirim", "merk", "ukuran"];
export const LABEL_FIELD = {
  alamat: "Alamat pengiriman", kota: "Kota", tanggalKirim: "Tanggal kirim", catatan: "Catatan permintaan customer",
  perluDikirim: "Dikirim / diambil sendiri", merk: "Merk kasur", ukuran: "Ukuran",
};
export const KIRIM_OPSI_KOREKSI = [
  { key: "", label: "— belum ditentukan —" },
  { key: "ya", label: "Dikirim ke alamat pembeli" },
  { key: "tidak", label: "Diambil sendiri (tanpa pengiriman)" },
];
export const ALASAN_MIN = 5;
export const ALASAN_MAKS = 500;

const teksAtau = (v) => (v === null || v === undefined ? "" : String(v));
const rapat = (v) => teksAtau(v).trim().replace(/\s+/g, " ");

export const kirimKeKunci = (v) => (v === true ? "ya" : v === false ? "tidak" : "");

/** Isian awal dari kemampuan server: nilai tersimpan apa adanya (string kosong = belum ada). */
export function formAwal(kem) {
  const f = kem?.field ?? {};
  return {
    alamat: teksAtau(f.alamat?.nilai), kota: teksAtau(f.kota?.nilai), tanggalKirim: teksAtau(f.tanggalKirim?.nilai), catatan: teksAtau(f.catatan?.nilai),
    kirim: kirimKeKunci(f.perluDikirim?.nilai), merk: teksAtau(f.merk?.nilai), ukuran: teksAtau(f.ukuran?.nilai),
  };
}

/**
 * Perubahan yang akan dikirim = HANYA field yang berbeda dari nilai tersimpan DAN boleh dikoreksi menurut server. Field terkunci tidak pernah dikirim
 * (server tetap menolak bila dikirim). Mengosongkan teks = string kosong. Dikirim/diambil hanya boleh dipilih ya/tidak (tidak kembali ke "belum ditentukan").
 */
export function perubahanDariForm(form, kem) {
  const f = kem?.field ?? {};
  const out = {};
  for (const k of ["alamat", "kota", "tanggalKirim", "catatan", "merk", "ukuran"]) {
    if (!f[k]?.boleh) continue;
    if (rapat(form[k]) !== rapat(f[k].nilai)) out[k] = rapat(form[k]);
  }
  if (f.perluDikirim?.boleh) {
    const awal = kirimKeKunci(f.perluDikirim.nilai);
    if (form.kirim !== awal && (form.kirim === "ya" || form.kirim === "tidak")) out.perluDikirim = form.kirim === "ya";
  }
  return out;
}

export const adaPerubahan = (form, kem) => Object.keys(perubahanDariForm(form, kem)).length > 0;
export const alasanValid = (alasan) => rapat(alasan).length >= ALASAN_MIN && rapat(alasan).length <= ALASAN_MAKS;

/** Galat isian (null = boleh ditinjau). */
export function galatForm(form, kem) {
  if (!kem) return "Memuat kemampuan koreksi…";
  const p = perubahanDariForm(form, kem);
  if (Object.keys(p).length === 0) return "Belum ada yang diubah";
  if (p.tanggalKirim && !/^\d{4}-\d{2}-\d{2}$/.test(p.tanggalKirim)) return "Tanggal kirim harus berformat YYYY-MM-DD";
  if (p.alamat !== undefined && p.alamat.length > 500) return "Alamat maksimal 500 karakter";
  if (p.catatan !== undefined && p.catatan.length > 500) return "Catatan maksimal 500 karakter";
  return null;
}

/** Baris matriks "apa yang bisa dikoreksi" untuk ditampilkan (urutan tetap; format lama tidak disembunyikan). */
export function barisMatriks(kem) {
  if (!kem) return [];
  const g = (judul, s) => ({ kunci: judul, judul, boleh: !!s?.boleh, alasan: s?.alasan ?? null, jalur: s?.jalur ?? null, catatan: s?.catatan ?? null });
  const atas = [
    g("Jumlah unit / jumlah baris", kem.jumlah),
    g("Harga / nilai penjualan", kem.harga),
    g("Tambah atau hapus item", kem.tambahHapusItem),
    g("Ukuran & spesifikasi per item", kem.perItem),
  ];
  const f = kem.field ?? {};
  const bawah = FIELD_URUTAN.filter((k) => f[k]).map((k) => ({ kunci: k, judul: LABEL_FIELD[k], boleh: !!f[k].boleh, alasan: f[k].alasan ?? null, jalur: f[k].jalur ?? null, catatan: f[k].catatan ?? null }));
  return [...atas, ...bawah];
}

const JALUR_TEKS = {
  "koreksi-baris": "lewat Koreksi item penjualan",
  "koreksi-item": "lewat Koreksi item order",
  "koreksi-order": "dari layar ini",
  "batal-catat-ulang": "hanya lewat batalkan lalu catat ulang",
  delivery: "lewat Delivery (Kendali Rute)",
};
export const teksJalur = (j) => JALUR_TEKS[j] ?? null;

/** Pesan galat server untuk modal: kode yang dikenal diberi arahan; selain itu pesan server apa adanya. */
export function pesanGalatKoreksi(e) {
  if (!e) return "";
  if (e.code === "REVISI_BERUBAH") return "Data order sudah diubah orang lain atau di layar lain. Data terbaru sudah dimuat — periksa lagi lalu tinjau ulang.";
  return e.message || "Gagal menerapkan koreksi";
}

export const kunciBaru = (prefix = "pkr-koreksi-order") => (globalThis.crypto?.randomUUID ? `${prefix}-${globalThis.crypto.randomUUID()}` : `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);

// ── PEMBATALAN ──────────────────────────────────────────────────────────────────────
/** Pecah hambatan pratinjau pembatalan menurut tindakan: yang perlu Riwayat Pembayaran, yang perlu alur order, dan yang final. */
export function kelompokHambatan(pv) {
  const h = pv?.hambatan ?? [];
  return {
    bayar: h.filter((x) => x.kode === "PEMBAYARAN_AKTIF"),
    produksi: h.filter((x) => x.kode === "PRODUKSI_DELIVERY_BERJALAN"),
    sudah: h.filter((x) => x.kode === "SUDAH_DIBATALKAN"),
    lain: h.filter((x) => !["PEMBAYARAN_AKTIF", "PRODUKSI_DELIVERY_BERJALAN", "SUDAH_DIBATALKAN"].includes(x.kode)),
  };
}
export const adaTautanRiwayat = (pv) => kelompokHambatan(pv).bayar.length > 0;
