// JUMLAH FISIK PENDAMPING pada PO dan penerimaan — fungsi MURNI (tanpa DB) supaya aturannya sama di PO, PDF, Finance, dan Gudang.
//
// Satuan UTAMA baris PO (mis. KG) tetap satu-satunya dasar NILAI dan STOK. Pendamping (mis. LEMBAR) hanya INFORMASI KONTROL: tidak pernah masuk ke nilai persediaan, stok, harga, atau jurnal.
// Dua mode:
//   TETAP  — rasio baku: 1 satuan utama = `rasio` pendamping (contoh 1 DUS = 12 KALENG). Estimasi PO = jumlah × rasio; aktual penerimaan = datang × rasio (dihitung server, snapshot).
//   AKTUAL — tanpa rasio tetap (contoh busa: KG + lembar; 1 lembar TIDAK punya berat baku). PO boleh memuat perkiraan; jumlah aktual dicatat per penerimaan oleh petugas.
// Tidak boleh digabung dengan konversi satuan beli→stok (purchaseUnit) — itu konsep lain (menentukan stok), pendamping tidak.

export const MODE_PENDAMPING = Object.freeze(["TETAP", "AKTUAL"]);

export class PendampingError extends Error {
  constructor(message, code = "PENDAMPING_TIDAK_VALID") { super(message); this.name = "PendampingError"; this.statusCode = 400; this.code = code; }
}

const k3 = (v) => Math.round(Number(v) * 1000);
const tigaDesimal = (v) => Math.abs(Number(v) * 1000 - Math.round(Number(v) * 1000)) <= 1e-6;
const fmt = (n) => Number(n).toLocaleString("id-ID", { maximumFractionDigits: 3 });

/**
 * Validasi masukan pendamping satu baris PO → kolom siap simpan (semua null bila tanpa pendamping).
 * @param raw     { satuan, mode, rasio?, estimasi? } | null/undefined/{} (kosong = tanpa pendamping)
 * @param opsi    { nomor, kode, adaKonversi }  (untuk pesan)
 */
export function validasiPendamping(raw, { nomor = null, kode = null, adaKonversi = false } = {}) {
  const lokasi = nomor ? `Baris ${nomor}${kode ? ` (${kode})` : ""}: ` : "";
  const kosong = { companionUnit: null, companionMode: null, companionRatio: null, companionEstimate: null };
  if (raw === undefined || raw === null) return kosong;
  const satuan = String(raw.satuan ?? "").trim();
  const mode = String(raw.mode ?? "").trim().toUpperCase();
  const adaIsi = satuan || mode || (raw.rasio !== undefined && raw.rasio !== null && raw.rasio !== "") || (raw.estimasi !== undefined && raw.estimasi !== null && raw.estimasi !== "");
  if (!adaIsi) return kosong;
  if (adaKonversi) throw new PendampingError(`${lokasi}jumlah fisik pendamping tidak bisa digabung dengan konversi satuan beli → stok. Pilih salah satu.`, "PENDAMPING_DAN_KONVERSI");
  if (!satuan) throw new PendampingError(`${lokasi}satuan pendamping wajib diisi (mis. LEMBAR)`);
  if (satuan.length > 20) throw new PendampingError(`${lokasi}satuan pendamping maksimal 20 karakter`);
  if (!MODE_PENDAMPING.includes(mode)) throw new PendampingError(`${lokasi}pilih mode pendamping: konversi tetap atau jumlah aktual`);
  if (mode === "TETAP") {
    const rasio = Number(raw.rasio);
    if (!Number.isFinite(rasio) || rasio <= 0) throw new PendampingError(`${lokasi}rasio konversi tetap harus lebih dari 0 (mis. 1 DUS = 12 KALENG → rasio 12)`);
    if (Math.abs(rasio * 1e6 - Math.round(rasio * 1e6)) > 1e-6) throw new PendampingError(`${lokasi}rasio maksimal 6 angka di belakang koma`);
    if (rasio > 1_000_000) throw new PendampingError(`${lokasi}rasio terlalu besar`);
    return { companionUnit: satuan, companionMode: "TETAP", companionRatio: String(rasio), companionEstimate: null };
  }
  // AKTUAL: tanpa rasio tetap; perkiraan opsional.
  if (raw.rasio !== undefined && raw.rasio !== null && raw.rasio !== "") throw new PendampingError(`${lokasi}mode jumlah aktual tidak memakai rasio tetap`);
  let estimasi = null;
  if (raw.estimasi !== undefined && raw.estimasi !== null && raw.estimasi !== "") {
    estimasi = Number(raw.estimasi);
    if (!Number.isFinite(estimasi) || estimasi < 0) throw new PendampingError(`${lokasi}perkiraan jumlah pendamping tidak boleh negatif`);
    if (!tigaDesimal(estimasi)) throw new PendampingError(`${lokasi}perkiraan maksimal 3 angka di belakang koma`);
    if (estimasi > 99_999_999) throw new PendampingError(`${lokasi}perkiraan terlalu besar`);
  }
  return { companionUnit: satuan, companionMode: "AKTUAL", companionRatio: null, companionEstimate: estimasi === null ? null : String(estimasi) };
}

/** Definisi pendamping baris PO dari kolom DB → bentuk keluaran, atau null. `qty` = jumlah PO (untuk estimasi TETAP). */
export function pendampingPO(l) {
  if (!l?.companionUnit || !l?.companionMode) return null;
  const satuan = String(l.companionUnit);
  if (l.companionMode === "TETAP") {
    const rasio = Number(l.companionRatio);
    const estimasi = Math.round(Number(l.qty) * rasio * 1000) / 1000;
    return { satuan, mode: "TETAP", rasio, estimasi, teks: `setara ${fmt(estimasi)} ${satuan.toLowerCase()}`, rumus: `1 ${l.unit} = ${fmt(rasio)} ${satuan.toLowerCase()}` };
  }
  const estimasi = l.companionEstimate === null || l.companionEstimate === undefined ? null : Number(l.companionEstimate);
  return { satuan, mode: "AKTUAL", rasio: null, estimasi, teks: estimasi === null ? `jumlah ${satuan.toLowerCase()} dicatat saat barang tiba` : `perkiraan ${fmt(estimasi)} ${satuan.toLowerCase()}`, rumus: null };
}

/** Teks satu baris untuk PDF/layar: "10 KG — perkiraan 2 lembar" (AKTUAL) · "10 DUS — setara 120 kaleng" (TETAP) · "10 KG" (tanpa pendamping). */
export function teksJumlahPO(l) {
  const dasar = `${fmt(l.qty)} ${l.unit}`;
  const p = pendampingPO(l);
  return p ? `${dasar} — ${p.teks}` : dasar;
}

/**
 * Jumlah pendamping AKTUAL untuk satu baris penerimaan.
 *   TETAP  : datang × rasio (server menghitung; masukan petugas diabaikan agar snapshot konsisten dengan rasio PO)
 *   AKTUAL : angka yang diketik petugas (boleh kosong → null = belum diisi)
 *   tanpa pendamping: masukan harus kosong.
 */
export function aktualPendampingPenerimaan(poLine, datang, masukan, { nomor = null } = {}) {
  const lokasi = nomor ? `Baris ${nomor}: ` : "";
  const p = pendampingPO(poLine);
  const ada = masukan !== undefined && masukan !== null && masukan !== "";
  if (!p) {
    if (ada) throw new PendampingError(`${lokasi}baris PO ini tidak memakai jumlah fisik pendamping`, "TANPA_PENDAMPING");
    return null;
  }
  if (p.mode === "TETAP") return Math.round(Number(datang) * p.rasio * 1000) / 1000;
  if (!ada) return null;
  const n = Number(masukan);
  if (!Number.isFinite(n) || n < 0) throw new PendampingError(`${lokasi}jumlah ${p.satuan.toLowerCase()} tidak boleh negatif`);
  if (!tigaDesimal(n)) throw new PendampingError(`${lokasi}jumlah ${p.satuan.toLowerCase()} maksimal 3 angka di belakang koma`);
  if (n > 99_999_999) throw new PendampingError(`${lokasi}jumlah ${p.satuan.toLowerCase()} terlalu besar`);
  return n;
}

export const sama3 = (a, b) => k3(a ?? 0) === k3(b ?? 0);
