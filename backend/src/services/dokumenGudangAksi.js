// ALAT BERSAMA aksi dokumen Gudang (UX Tahap 2): galat berkode, token revisi (deteksi konflik), validasi alasan, dan ringkasan perubahan baris.
// Murni (tanpa DB). Dipakai routes/materialIssue.js dan routes/stockTransfer.js supaya aturan konflik/retry tidak bisa berbeda antar dokumen.

export class GalatDokumen extends Error {
  constructor(message, statusCode = 400, kode = null) { super(message); this.statusCode = statusCode; this.kode = kode; }
}

/** Token revisi dokumen = updatedAt (ms). Klien mengirimnya kembali pada aksi ubah; berbeda = dokumen sudah diubah pihak lain. */
export const tokenRevisi = (d) => (d?.updatedAt instanceof Date ? d.updatedAt.toISOString() : String(d?.updatedAt ?? ""));

export function wajibRevisi(revisi) {
  if (revisi === undefined || revisi === null || revisi === "") throw new GalatDokumen("Muat ulang dokumen dulu: revisi dokumen wajib dikirim.", 400, "REVISI_WAJIB");
}
/** Bila `revisi` dikirim dan tidak sama dengan revisi sekarang → 409. Tanpa `revisi` = tidak diperiksa (pemanggil lama). */
export function cekRevisi(doc, revisi) {
  if (revisi === undefined || revisi === null || revisi === "") return;
  if (String(revisi) !== tokenRevisi(doc)) throw new GalatDokumen("Dokumen sudah diubah sejak Anda membukanya. Muat ulang, periksa isinya, lalu ulangi.", 409, "REVISI_BASI");
}
export function alasanValid(v, label = "Alasan") {
  const a = String(v ?? "").trim();
  if (a.length < 3 || a.length > 300) throw new GalatDokumen(`${label} wajib diisi (3–300 karakter)`, 400, "ALASAN_TIDAK_VALID");
  return a;
}

const num = (v) => Math.round(Number(v) * 10000) / 10000;

/**
 * Selisih isi baris dokumen (per bahan). `lama`/`baru`: [{ materialId, kode, jumlah, lokasi? }].
 * Kembalian: { berubah, ringkasan: ["Ditambah: KODE 5", "Dihapus: KODE", "Jumlah KODE: 10 → 12"] }.
 */
export function selisihBaris(lama = [], baru = []) {
  const a = new Map(lama.map((x) => [x.materialId, x])); const b = new Map(baru.map((x) => [x.materialId, x])); const ringkasan = [];
  for (const [id, x] of b) { const y = a.get(id); if (!y) ringkasan.push(`Ditambah: ${x.kode} ${num(x.jumlah)}`); else if (num(y.jumlah) !== num(x.jumlah)) ringkasan.push(`Jumlah ${x.kode}: ${num(y.jumlah)} → ${num(x.jumlah)}`); else if ((y.lokasi ?? null) !== (x.lokasi ?? null)) ringkasan.push(`Lokasi ${x.kode}: ${y.lokasi ?? "kosong"} → ${x.lokasi ?? "kosong"}`); }
  for (const [id, y] of a) if (!b.has(id)) ringkasan.push(`Dihapus: ${y.kode}`);
  return { berubah: ringkasan.length > 0, ringkasan };
}

/** Validasi bentuk baris isian (tanpa DB): jumlah > 0, bahan terisi, tanpa bahan ganda. Mengembalikan baris yang sudah dinormalkan. */
export function normalkanBaris(lines, kunciJumlah) {
  if (!Array.isArray(lines) || lines.length === 0) throw new GalatDokumen("Minimal satu item wajib diisi", 400, "BARIS_KOSONG");
  const dilihat = new Set(); const hasil = [];
  for (const l of lines) {
    if (!l?.materialId) throw new GalatDokumen("Setiap baris wajib memilih bahan", 400, "BAHAN_KOSONG");
    const q = Number(l[kunciJumlah]);
    if (!Number.isFinite(q) || q <= 0) throw new GalatDokumen("Jumlah wajib lebih dari 0", 400, "JUMLAH_TIDAK_VALID");
    if (dilihat.has(l.materialId)) throw new GalatDokumen("Satu bahan hanya boleh muncul satu kali; gabungkan jumlahnya.", 400, "BAHAN_GANDA");
    dilihat.add(l.materialId); hasil.push({ ...l, [kunciJumlah]: q });
  }
  return hasil;
}
