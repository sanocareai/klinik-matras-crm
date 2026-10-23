// USULAN BAHAN KATALOG & PEMAKAIAN SEMENTARA (Okt 2026, UX Bahan) — aturan MURNI (tanpa database), dipakai layanan dan tes.
//   • Usulan bahan baru HANYA baris usulan: tidak membuat Material, saldo, penerimaan, pergerakan stok, biaya, atau jurnal.
//   • Pemakaian sementara = fakta bahan yang SUDAH dipakai tetapi belum punya sumber stok resmi. BUKAN Material Issue; tidak mengurangi saldo.
import { KELOMPOK, KELOMPOK_BELUM, grupTerpetakan, kelompokDariItemGroup, normalkanGrup } from "../../constants/kelompokBahan.js";

export class BahanUsulanError extends Error {
  constructor(message, code = "USULAN_BAHAN_DITOLAK", statusCode = 400, extra = null) { super(message); this.name = "BahanUsulanError"; this.code = code; this.statusCode = statusCode; if (extra) this.extra = extra; }
}

// Satuan = enum MaterialUnit (Gudang). Daftar tetap supaya pure; tes menjaga agar tetap sama dengan enum.
export const SATUAN = Object.freeze(["PCS", "METER", "M3", "SHEET", "SPOOL", "KG", "PACK", "ROLL", "BUNDLE", "ROD", "PAIR", "CAN", "BOX", "LITER"]);
export const KELOMPOK_USULAN = Object.freeze(Object.keys(KELOMPOK)); // BUSA, KAIN, BENANG, PEGAS, KAYU, LEM_KIMIA, AKSESORI, LAINNYA (tanpa "Belum dikelompokkan")
export const STATUS_USULAN = Object.freeze({ MENUNGGU_GUDANG: "Menunggu Gudang", DISETUJUI: "Disetujui (bahan dibuat di katalog)", DIGABUNG: "Digabung ke bahan yang sudah ada", DITOLAK: "Ditolak" });
export const STATUS_SEMENTARA = Object.freeze({ PERLU_REKONSILIASI: "Perlu rekonsiliasi Gudang", DIREKONSILIASI: "Sudah direkonsiliasi", DIBATALKAN: "Dibatalkan (salah input)" });
export const RESOLUSI = Object.freeze({ TAUTKAN_ISSUE: "Ditautkan ke pengeluaran stok resmi", TANPA_STOK: "Dinyatakan bukan stok Gudang" });
export const ASAL_UMUM = Object.freeze(["Sisa bahan di meja produksi", "Dibeli sendiri / dari luar", "Pinjam dari tempat lain", "Milik pelanggan", "Belum diketahui"]);
export const CATATAN_USULAN = "Usulan bahan hanya mencatat permintaan. Tidak membuat saldo, penerimaan, pergerakan stok, biaya, atau jurnal.";
export const CATATAN_SEMENTARA = "Pemakaian sementara adalah catatan fakta, bukan Material Issue. Saldo stok, biaya bahan, dan jurnal TIDAK berubah sampai Gudang menyelesaikan sumber stoknya lewat jalur resmi.";

const IDEM_RE = /^[A-Za-z0-9._:-]{12,128}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const bad = (msg, code, extra = null) => new BahanUsulanError(msg, code, 400, extra);
const str = (v, max) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");
export const kunciValid = (k) => { if (!k || !IDEM_RE.test(String(k))) throw bad("Idempotency-Key wajib (12–128 karakter huruf/angka/._:-).", "IDEMPOTENCY_KEY_INVALID"); return String(k); };
export const uuidValid = (v) => UUID_RE.test(String(v ?? ""));

/** Kunci pembanding nama: huruf kecil, tanpa tanda baca/spasi ganda. "Busa HR 5cm" ≡ "busa  hr 5 cm"? (angka+satuan menempel dipisah) → ya. */
export function kunciNama(nama) {
  return String(nama ?? "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/(\d)([a-z])/g, "$1 $2").replace(/([a-z])(\d)/g, "$1 $2").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}
const token = (k) => new Set(k.split(" ").filter((t) => t.length > 0));

/** Kemiripan dua nama (sudah dikunci). SAMA = identik; MIRIP = satu memuat yang lain (≥4 huruf) atau token tumpang-tindih ≥ 0.7. Selain itu null. */
export function kemiripanNama(a, b) {
  if (!a || !b) return null;
  if (a === b) return "SAMA";
  const lebihPendek = a.length <= b.length ? a : b; const lebihPanjang = a.length <= b.length ? b : a;
  if (lebihPendek.length >= 4 && (` ${lebihPanjang} `).includes(` ${lebihPendek} `)) return "MIRIP";
  const ta = token(a); const tb = token(b); let irisan = 0; for (const t of ta) if (tb.has(t)) irisan++;
  const gabungan = ta.size + tb.size - irisan;
  return gabungan > 0 && irisan / gabungan >= 0.7 ? "MIRIP" : null;
}

/** Kandidat kembar dari daftar bahan katalog + usulan terbuka. kode juga dibandingkan persis (huruf besar). */
export function cariKembar({ nama, kode = null, bahan = [], usulanTerbuka = [] }) {
  const kn = kunciNama(nama); const kd = kode ? String(kode).trim().toUpperCase() : null; const hasil = [];
  for (const m of bahan) {
    const t = kd && String(m.kode).toUpperCase() === kd ? "SAMA" : kemiripanNama(kn, kunciNama(m.nama));
    if (t) hasil.push({ jenis: "KATALOG", materialId: m.id, kode: m.kode, nama: m.nama, satuan: m.satuan, aktif: m.aktif !== false, tingkat: t, alasan: kd && String(m.kode).toUpperCase() === kd ? "Kode sama" : t === "SAMA" ? "Nama sama" : "Nama mirip" });
  }
  for (const u of usulanTerbuka) {
    const t = kemiripanNama(kn, u.nameKey ?? kunciNama(u.name));
    if (t) hasil.push({ jenis: "USULAN", proposalId: u.id, nama: u.name, satuan: u.unit, tingkat: t, alasan: t === "SAMA" ? "Sudah ada usulan dengan nama sama (menunggu Gudang)" : "Ada usulan bernama mirip (menunggu Gudang)" });
  }
  return hasil.sort((x, y) => (x.tingkat === y.tingkat ? 0 : x.tingkat === "SAMA" ? -1 : 1));
}
export const adaKembarSama = (kandidat) => kandidat.some((k) => k.tingkat === "SAMA");

/** Sub-jenis katalog (itemGroup) yang SUDAH dikenal untuk satu kelompok — supaya kelompok turunan Gudang benar. */
export function subJenisKelompok(kodeKelompok) {
  const semua = grupTerpetakan();
  return semua.filter((g) => kelompokDariItemGroup(g).kode === kodeKelompok);
}

/** Murni: isian usulan bahan baru. */
export function normalisasiUsulan(raw) {
  const d = raw && typeof raw === "object" ? raw : {};
  const name = str(d.name, 120); if (name.length < 3) throw bad("Nama bahan wajib diisi (minimal 3 huruf).", "USULAN_NAMA_WAJIB");
  const nameKey = kunciNama(name); if (nameKey.length < 3) throw bad("Nama bahan harus memuat huruf atau angka.", "USULAN_NAMA_WAJIB");
  const unit = String(d.unit ?? "").trim().toUpperCase(); if (!SATUAN.includes(unit)) throw bad("Satuan bahan tidak dikenal.", "USULAN_SATUAN_INVALID");
  const kelompok = String(d.kelompok ?? "").trim().toUpperCase(); if (!KELOMPOK_USULAN.includes(kelompok)) throw bad("Pilih kategori bahan (Busa, Kain, Benang, Pegas, Kayu, Lem/Kimia, Aksesori, atau Lainnya).", "USULAN_KELOMPOK_INVALID");
  let itemGroup = null;
  if (d.itemGroup) {
    itemGroup = normalkanGrup(d.itemGroup);
    if (kelompokDariItemGroup(itemGroup).kode !== kelompok) throw bad("Sub-jenis tidak sesuai dengan kategori yang dipilih.", "USULAN_SUBJENIS_INVALID");
  }
  const description = str(d.description, 500);
  const unitId = d.unitId ? String(d.unitId) : null; if (unitId && !uuidValid(unitId)) throw bad("Unit tidak valid.", "ID_INVALID");
  return { name, nameKey, unit, kelompok, itemGroup, description: description || null, unitId };
}

const TOLERANSI_QTY = 0.0001;
export const selisihQty = (a, b) => Math.round((Number(a) - Number(b)) * 10000) / 10000;
export const qtySama = (a, b) => Math.abs(Number(a) - Number(b)) <= TOLERANSI_QTY;

/** Murni: isian pemakaian sementara. `sekarang` bisa disuntik untuk tes. */
export function normalisasiPemakaianSementara(raw, { sekarang = new Date() } = {}) {
  const d = raw && typeof raw === "object" ? raw : {};
  const proposalId = d.proposalId ? String(d.proposalId) : null; if (proposalId && !uuidValid(proposalId)) throw bad("Usulan bahan tidak valid.", "ID_INVALID");
  const name = str(d.name, 120); if (name.length < 3) throw bad("Nama bahan wajib diisi (minimal 3 huruf).", "SEMENTARA_NAMA_WAJIB");
  const qty = Number(d.qty); if (!Number.isFinite(qty) || qty <= 0 || qty > 100000) throw bad("Jumlah yang dipakai harus lebih dari 0.", "SEMENTARA_JUMLAH_INVALID");
  const uom = String(d.uom ?? "").trim().toUpperCase(); if (!SATUAN.includes(uom)) throw bad("Satuan tidak dikenal.", "SEMENTARA_SATUAN_INVALID");
  const originNote = str(d.originNote, 300); const note = str(d.note, 500);
  let usedAt = sekarang;
  if (d.usedAt) {
    const t = new Date(d.usedAt); if (Number.isNaN(t.getTime())) throw bad("Waktu pemakaian tidak valid.", "SEMENTARA_WAKTU_INVALID");
    if (t.getTime() > sekarang.getTime() + 5 * 60 * 1000) throw bad("Waktu pemakaian tidak boleh di masa depan.", "SEMENTARA_WAKTU_INVALID");
    if (t.getTime() < sekarang.getTime() - 30 * 24 * 3600 * 1000) throw bad("Waktu pemakaian tidak boleh lebih dari 30 hari lalu.", "SEMENTARA_WAKTU_INVALID");
    usedAt = t;
  }
  return { proposalId, name, nameKey: kunciNama(name), qty: Math.round(qty * 10000) / 10000, uom, originNote: originNote || null, note: note || null, usedAt };
}

/** Saran kode material dari nama + kelompok (Gudang boleh mengubah). Unik dicek oleh pemanggil terhadap daftar kode yang ada. */
const AWALAN = { BUSA: "BUSA", KAIN: "KAIN", BENANG: "BENANG", PEGAS: "PER", KAYU: "KAYU", LEM_KIMIA: "KIMIA", AKSESORI: "AKS", LAINNYA: "LAIN" };
export function saranKode({ name, kelompok }, kodeAda = new Set()) {
  const slug = kunciNama(name).toUpperCase().replace(/ /g, "-").replace(/-+/g, "-").slice(0, 34).replace(/-$/, "");
  const dasar = `${AWALAN[kelompok] ?? "BHN"}-${slug || "BARU"}`;
  let kode = dasar; let n = 2;
  while (kodeAda.has(kode)) kode = `${dasar}-${n++}`;
  return kode;
}

export const KODE_RE = /^[A-Z0-9][A-Z0-9._-]{1,59}$/;

/** Murni: isian keputusan Gudang atas usulan. */
export function normalisasiKeputusan(raw) {
  const d = raw && typeof raw === "object" ? raw : {};
  const keputusan = String(d.keputusan ?? "");
  const catatan = str(d.catatan, 500);
  if (!["SETUJUI", "GABUNG", "TOLAK"].includes(keputusan)) throw bad("Keputusan harus Setujui, Gabung, atau Tolak.", "KEPUTUSAN_INVALID");
  if (keputusan === "TOLAK") { if (catatan.length < 3) throw bad("Alasan penolakan wajib diisi (minimal 3 karakter).", "KEPUTUSAN_ALASAN_WAJIB"); return { keputusan, catatan }; }
  if (keputusan === "GABUNG") { const materialId = String(d.materialId ?? ""); if (!uuidValid(materialId)) throw bad("Pilih bahan katalog tujuan penggabungan.", "KEPUTUSAN_BAHAN_WAJIB"); return { keputusan, catatan: catatan || null, materialId }; }
  const kode = String(d.kode ?? "").trim().toUpperCase(); if (!KODE_RE.test(kode)) throw bad("Kode bahan wajib (huruf besar/angka, 2–60 karakter, boleh . _ -).", "KEPUTUSAN_KODE_INVALID");
  const itemGroup = d.itemGroup ? normalkanGrup(d.itemGroup) : null;
  const category = d.category ? String(d.category) : null;
  return { keputusan, catatan: catatan || null, kode, itemGroup, category };
}

/** Murni: isian rekonsiliasi pemakaian sementara. */
export function normalisasiRekonsiliasi(raw) {
  const d = raw && typeof raw === "object" ? raw : {};
  const resolusi = String(d.resolusi ?? ""); const catatan = str(d.catatan, 500);
  if (!Object.keys(RESOLUSI).includes(resolusi)) throw bad("Pilih cara menyelesaikan: tautkan ke pengeluaran stok resmi, atau nyatakan bukan stok Gudang.", "REKONSILIASI_RESOLUSI_INVALID");
  if (resolusi === "TANPA_STOK") { if (catatan.length < 10) throw bad("Alasan 'bukan stok Gudang' wajib diisi jelas (minimal 10 karakter).", "REKONSILIASI_ALASAN_WAJIB"); return { resolusi, catatan }; }
  const stockMovementId = String(d.stockMovementId ?? ""); if (!uuidValid(stockMovementId)) throw bad("Pilih pengeluaran stok resmi yang akan ditautkan.", "REKONSILIASI_PERGERAKAN_WAJIB");
  return { resolusi, catatan: catatan || null, stockMovementId };
}

export { KELOMPOK, KELOMPOK_BELUM };
