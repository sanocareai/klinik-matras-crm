// SKEMA SATUAN PAKAI BAHAN (Produksi) — fungsi MURNI tanpa DB; diuji node --test.
//
// Latar: beberapa bahan DIBELI/DISIMPAN dalam satu satuan (stok) tetapi DIPAKAI Produksi dalam satuan lain. Kasus pertama (KEPUTUSAN OWNER 4 Nov 2026): semua LIST WIBING — dibeli per ROLL,
// dipakai dalam METER, 1 ROLL = 90 METER. Sebelumnya meter dicatat sebagai angka ROLL sehingga saldo ledger jadi minus besar (LIST-WIBING-ABU −388,5 / PUTIH −360 / COKLAT −116,5 "ROLL").
// "Sistem tidak mengonversi" adalah sebab kesalahan itu; skema ini yang mengonversi — di SERVER, eksplisit, dan tercatat.
//
// Prinsip:
//  • Ledger stok SELALU dalam satuan stok master (ROLL). Hanya pencatatan pemakaian Produksi yang menerima satuan pakai (METER); server mengonversi: qtyStok = meter ÷ faktor, dibulatkan 4 desimal
//    (presisi kolom stock_movements.qty). Pembulatan ≤ 0,00005 ROLL (± 4,5 mm untuk 90 m/roll) per pergerakan. Jumlah yang diketik pengguna tetap tercatat apa adanya (audit + catatan pergerakan).
//  • Aturan hanya berlaku bila satuan stok master bahan memang = satuanStok aturan (mis. ROLL). Bahan yang satuan masternya sudah METER TIDAK dikonversi (tidak ada aturan ganda).
//  • Bahan beraturan WAJIB menyatakan satuan input (METER atau ROLL) — tanpa itu ditolak (klien lama tidak boleh mengirim meter yang terbaca sebagai ROLL).
//  • Faktor tidak pernah ditebak: bawaan hanya yang diputuskan Owner (di bawah); perubahan lewat pengaturan Produksi yang tercatat (izin pengelola), tidak mengubah pergerakan yang sudah tercatat.
export const SATUAN_STOK_BAWAAN = "ROLL";
export const SATUAN_PAKAI_BAWAAN = "METER";
/** Aturan bawaan (keputusan Owner 4 Nov 2026). `awalan` mencocokkan kode bahan (huruf besar). faktor = jumlah satuan pakai per 1 satuan stok. */
export const ATURAN_BAWAAN = Object.freeze([
  Object.freeze({ id: "LIST-WIBING", awalan: "LIST-WIBING", satuanStok: "ROLL", satuanPakai: "METER", faktor: 90, sumber: "KEPUTUSAN_OWNER_2026_11_04", catatan: "Semua jenis list wibing: dibeli ROLL, dipakai METER; 1 ROLL = 90 METER." }),
]);
const EPS = 1e-9;
const r4 = (v) => Math.round(Number(v) * 10000) / 10000;
const koma = (n) => String(r4(n)).replace(".", ",");

/** Validasi satu aturan (dari pengaturan). Mengembalikan galat teks atau null. */
export function galatAturan(a) {
  if (!a || typeof a !== "object") return "Aturan tidak valid.";
  if (!/^[A-Z0-9][A-Z0-9-]{1,39}$/.test(String(a.awalan ?? ""))) return "Awalan kode bahan tidak valid (huruf besar, angka, tanda minus; 2–40 karakter).";
  if (!["ROLL", "KG", "PCS", "PACK", "BUNDLE", "ROD", "SHEET", "SPOOL"].includes(a.satuanStok)) return "Satuan stok aturan tidak dikenal.";
  if (!["METER"].includes(a.satuanPakai)) return "Satuan pakai yang didukung saat ini: METER.";
  if (!(Number(a.faktor) > 0) || Number(a.faktor) > 100000) return "Faktor harus lebih dari 0 (jumlah satuan pakai per 1 satuan stok).";
  return null;
}

/** Gabungkan aturan bawaan dengan penimpaan dari pengaturan ({ aturan: [...] }). Awalan yang sama: penimpaan menang; penimpaan tidak valid DIABAIKAN (bawaan tetap). */
export function aturanBerlaku(penimpaan = null) {
  const daftar = new Map(ATURAN_BAWAAN.map((a) => [a.awalan, { ...a }]));
  for (const p of Array.isArray(penimpaan?.aturan) ? penimpaan.aturan : []) {
    if (galatAturan(p)) continue;
    if (p.nonaktif === true) { daftar.delete(p.awalan); continue; }
    daftar.set(p.awalan, { id: p.awalan, awalan: p.awalan, satuanStok: p.satuanStok, satuanPakai: p.satuanPakai, faktor: Number(p.faktor), sumber: p.sumber ?? "PENGATURAN_PRODUKSI", catatan: p.catatan ?? null });
  }
  return [...daftar.values()];
}

/** Aturan untuk satu bahan ({ code, unit }) atau null. Awalan terpanjang menang; satuan master harus sama dengan satuan stok aturan. */
export function aturanUntukBahan(bahan, aturan = ATURAN_BAWAAN) {
  const kode = String(bahan?.code ?? bahan?.kode ?? "").toUpperCase(); const unit = String(bahan?.unit ?? bahan?.satuan ?? "").toUpperCase();
  if (!kode || !unit) return null;
  const cocok = aturan.filter((a) => kode.startsWith(a.awalan) && a.satuanStok === unit).sort((x, y) => y.awalan.length - x.awalan.length);
  return cocok[0] ?? null;
}

/** Ringkas aturan untuk klien (pemilih bahan, form). */
export const ringkasAturan = (a) => (a ? { satuanStok: a.satuanStok, satuanPakai: a.satuanPakai, faktor: a.faktor, teks: `1 ${a.satuanStok} = ${koma(a.faktor)} ${a.satuanPakai}`, sumber: a.sumber } : null);

/**
 * Konversi jumlah yang diketik ke satuan STOK. `satuanInput` wajib untuk bahan beraturan.
 * Hasil: { ok, qtyStok, qtyInput, satuanInput, faktor, dikonversi, teks, catatan } atau { ok:false, kode, pesan }.
 * qtyInput dapat negatif (pengembalian); tanda dipertahankan.
 */
export function konversiKeStok({ qty, satuanInput = null, aturan = null, satuanStok }) {
  const q = Number(qty);
  if (!Number.isFinite(q) || q === 0) return { ok: false, kode: "QTY_TIDAK_VALID", pesan: "Jumlah wajib diisi dan tidak boleh nol." };
  if (!aturan) {
    if (satuanInput && String(satuanInput).toUpperCase() !== String(satuanStok ?? "").toUpperCase()) return { ok: false, kode: "SATUAN_TIDAK_DIKENAL", pesan: `Bahan ini hanya dicatat dalam ${satuanStok}.` };
    return { ok: true, qtyStok: q, qtyInput: q, satuanInput: satuanStok ?? null, faktor: null, dikonversi: false, teks: null, catatan: null };
  }
  const s = String(satuanInput ?? "").toUpperCase();
  if (!s) return { ok: false, kode: "SATUAN_PAKAI_WAJIB", pesan: `Bahan ini dicatat dalam ${aturan.satuanPakai} (1 ${aturan.satuanStok} = ${koma(aturan.faktor)} ${aturan.satuanPakai}). Sebutkan satuannya (${aturan.satuanPakai} atau ${aturan.satuanStok}); segarkan halaman bila klien lama.` };
  if (s !== aturan.satuanPakai && s !== aturan.satuanStok) return { ok: false, kode: "SATUAN_TIDAK_DIKENAL", pesan: `Satuan ${s} tidak dikenal untuk bahan ini (pilih ${aturan.satuanPakai} atau ${aturan.satuanStok}).` };
  if (s === aturan.satuanStok) return { ok: true, qtyStok: q, qtyInput: q, satuanInput: s, faktor: aturan.faktor, dikonversi: false, teks: `${koma(Math.abs(q))} ${s} (satuan stok; tanpa konversi)`, catatan: null };
  const stok = r4(q / aturan.faktor);
  if (Math.abs(stok) < 0.0001 - EPS) return { ok: false, kode: "QTY_TERLALU_KECIL", pesan: `${koma(Math.abs(q))} ${s} lebih kecil dari ketelitian stok (0,0001 ${aturan.satuanStok} = ${koma(0.0001 * aturan.faktor)} ${s}). Naikkan jumlahnya.` };
  const teks = `${koma(Math.abs(q))} ${s} ÷ ${koma(aturan.faktor)} = ${koma(Math.abs(stok))} ${aturan.satuanStok} (1 ${aturan.satuanStok} = ${koma(aturan.faktor)} ${s}; dibulatkan 4 desimal ${aturan.satuanStok})`;
  return { ok: true, qtyStok: stok, qtyInput: q, satuanInput: s, faktor: aturan.faktor, dikonversi: true, teks, catatan: `[pakai ${koma(Math.abs(q))} ${s} = ${koma(Math.abs(stok))} ${aturan.satuanStok} @ ${koma(aturan.faktor)}/${aturan.satuanStok}]` };
}

/** Urai penanda konversi dari catatan pergerakan: "[pakai 3,4 METER = 0,0378 ROLL @ 90/ROLL]" → { qty, satuan, qtyStok, satuanStok, faktor } atau null. */
export function uraiPenandaPakai(note) {
  const m = /\[pakai ([\d.,]+) ([A-Z]+) = ([\d.,]+) ([A-Z]+) @ ([\d.,]+)\/([A-Z]+)\]/.exec(String(note ?? ""));
  if (!m) return null;
  const n = (t) => Number(String(t).replace(/\./g, "").replace(",", "."));
  return { qty: n(m[1]), satuan: m[2], qtyStok: n(m[3]), satuanStok: m[4], faktor: n(m[5]) };
}
