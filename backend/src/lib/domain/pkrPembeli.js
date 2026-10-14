// PEMBELI / PENERIMA / ALAMAT order Penjualan Karyawan (PKR) — aturan MURNI (tanpa DB) yang dipakai bersama pencatatan, pencarian customer, dan koreksi.
//
// Tiga identitas yang TIDAK boleh tercampur:
//   1. Karyawan penjual  = sumber transaksi PKR (user internal). Bukan Customer.
//   2. Customer/pembeli  = orang yang menerima produk/layanan; menjadi Order.customerId; tampil di CRM, Produksi, Delivery.
//   3. Penerima          = default sama dengan customer; boleh berbeda nama/nomor bila barang dikirim untuk orang lain.
//
// Dedupe customer SATU-SATUNYA lewat nomor telepon ternormalisasi (nama sama tanpa nomor BUKAN bukti orang yang sama).

export class PembeliPkrError extends Error {
  constructor(message, code = "PEMBELI_TIDAK_VALID", status = 400, extra = null) {
    super(message);
    this.name = "PembeliPkrError";
    this.code = code;
    this.statusCode = status;
    this.extra = extra;
  }
}
const gagal = (m, c, s = 400, e = null) => new PembeliPkrError(m, c, s, e);

/**
 * Normalisasi nomor telepon masukan manual → angka tanpa spasi/tanda (format yang sama dengan Customer.phone: "628…").
 *   • "0812-3456-7890" / "0812 3456 7890" → "6281234567890"
 *   • "+62 812…" / "62812…" / "812…"        → "62812…"
 *   • "+966 5…" (kode negara lain, wajib diawali +) → digit apa adanya (pelanggan luar negeri sah)
 * Melempar PembeliPkrError bila tidak dikenali. Tidak pernah menebak (mis. nomor tanpa awalan yang ambigu ditolak).
 */
export function normalisasiNomorTelepon(raw) {
  const teks = String(raw ?? "").trim();
  if (!teks) throw gagal("Nomor WhatsApp/telepon wajib diisi", "TELEPON_WAJIB");
  if (/@/.test(teks)) throw gagal("Isi nomor telepon biasa (bukan ID WhatsApp)", "TELEPON_TIDAK_VALID");
  const plus = teks.startsWith("+");
  const digit = teks.replace(/\D/g, "");
  if (!digit) throw gagal("Nomor telepon tidak valid", "TELEPON_TIDAK_VALID");
  let nomor;
  if (plus) {
    nomor = digit;
  } else if (digit.startsWith("00")) {
    nomor = digit.slice(2); // 0062… / 00966… (awalan internasional)
  } else if (digit.startsWith("0")) {
    nomor = `62${digit.slice(1)}`;
  } else if (digit.startsWith("62")) {
    nomor = digit;
  } else if (digit.startsWith("8")) {
    nomor = `62${digit}`;
  } else {
    throw gagal("Format nomor tidak dikenali — awali dengan 08…, 62…, atau +kode negara", "TELEPON_TIDAK_VALID");
  }
  if (nomor.startsWith("620")) nomor = `62${nomor.slice(3)}`; // "+62 0812…" → buang 0 sisa
  const indonesia = nomor.startsWith("62");
  if (indonesia) {
    if (nomor.length < 10 || nomor.length > 15) throw gagal("Panjang nomor Indonesia tidak wajar (10–15 digit termasuk 62)", "TELEPON_TIDAK_VALID");
    if (!nomor.startsWith("628")) throw gagal("Nomor seluler Indonesia diawali 08… / 628…", "TELEPON_TIDAK_VALID");
  } else if (nomor.length < 8 || nomor.length > 15) {
    throw gagal("Panjang nomor internasional tidak wajar (8–15 digit)", "TELEPON_TIDAK_VALID");
  }
  return nomor;
}

/** Sama, tetapi mengembalikan null (bukan melempar) — untuk pencarian longgar. */
export function nomorTeleponAtauNull(raw) {
  try { return normalisasiNomorTelepon(raw); } catch { return null; }
}

// Hanya tautan Google Maps: domain dibatasi (tidak ada URL bebas yang dibuka driver/Produksi), skema dipaksa https, tanpa spasi, panjang terbatas.
const HOST_MAPS = new Set([
  "maps.app.goo.gl", "goo.gl", "g.co", "maps.google.com", "www.google.com", "google.com", "www.google.co.id", "google.co.id", "maps.google.co.id", "share.google",
]);
const MAKS_URL = 500;

/**
 * Validasi tautan lokasi. Mengembalikan URL ternormalisasi (https) atau null bila kosong; melempar PembeliPkrError bila bukan tautan Google Maps.
 * TIDAK mengakses internet dan TIDAK menebak koordinat — koordinat tetap diambil oleh alur Delivery yang sudah ada (link-only).
 */
export function validasiLokasiUrl(raw) {
  if (raw === undefined || raw === null) return null;
  let teks = String(raw).trim();
  if (!teks) return null;
  if (teks.length > MAKS_URL) throw gagal(`Link Google Maps maksimal ${MAKS_URL} karakter`, "MAPS_TIDAK_VALID");
  if (/\s/.test(teks)) throw gagal("Link Google Maps tidak boleh berisi spasi", "MAPS_TIDAK_VALID");
  if (/^[a-z][a-z0-9+.-]*:/i.test(teks) && !/^https?:\/\//i.test(teks)) throw gagal("Link Google Maps harus diawali https://", "MAPS_TIDAK_VALID");
  if (!/^https?:\/\//i.test(teks)) teks = `https://${teks}`;
  let url;
  try { url = new URL(teks); } catch { throw gagal("Link Google Maps tidak valid", "MAPS_TIDAK_VALID"); }
  const host = url.hostname.toLowerCase();
  if (!HOST_MAPS.has(host)) throw gagal("Hanya link Google Maps yang diterima (maps.app.goo.gl, google.com/maps, goo.gl/maps)", "MAPS_TIDAK_VALID");
  const jalur = url.pathname.toLowerCase();
  const butuhJalurMaps = host === "www.google.com" || host === "google.com" || host === "www.google.co.id" || host === "google.co.id";
  if (butuhJalurMaps && !jalur.startsWith("/maps")) throw gagal("Link Google Maps harus berupa tautan /maps", "MAPS_TIDAK_VALID");
  if (host === "goo.gl" && !jalur.startsWith("/maps")) throw gagal("Link goo.gl harus berupa tautan /maps", "MAPS_TIDAK_VALID");
  url.protocol = "https:";
  url.username = ""; url.password = "";
  return url.toString();
}

const teksBersih = (v, maks, nama) => {
  if (v === undefined || v === null) return undefined;
  const t = String(v).replace(/\s+/g, " ").trim();
  if (t.length > maks) throw gagal(`${nama} maksimal ${maks} karakter`, "TEKS_TERLALU_PANJANG");
  return t === "" ? null : t;
};
const teksPanjang = (v, maks, nama) => {
  if (v === undefined || v === null) return undefined;
  const t = String(v).replace(/\r\n/g, "\n").trim();
  if (t.length > maks) throw gagal(`${nama} maksimal ${maks} karakter`, "TEKS_TERLALU_PANJANG");
  return t === "" ? null : t;
};

/**
 * Bacaan MASUKAN pembeli di tingkat PKR.
 *   mode "LAMA"     : klien lama (tanpa `pembeli`) — perilaku sebelumnya (profil internal karyawan), ditandai "Data customer belum lengkap".
 *   mode "AKTUAL"   : customer sebenarnya, dikenali lewat nomor telepon (wajib).
 *   mode "KARYAWAN" : pembeli adalah karyawan itu sendiri (jalur eksplisit) — memakai profil internal karyawan.
 */
export function bacaPembeli(masukan) {
  if (masukan === undefined || masukan === null) return { mode: "LAMA", telepon: null };
  if (typeof masukan !== "object" || Array.isArray(masukan)) throw gagal("Isian pembeli tidak valid", "PEMBELI_TIDAK_VALID");
  if (masukan.adalahKaryawan === true) return { mode: "KARYAWAN", telepon: null };
  return { mode: "AKTUAL", telepon: normalisasiNomorTelepon(masukan.telepon) };
}

/**
 * Bacaan MASUKAN pemenuhan/alamat/catatan. Semua opsional; `undefined` = tidak dikirim, null = dikosongkan.
 * (alamat/kota/tanggalKirim tetap dibaca oleh normalisasiSpesifikasi di penjualanKaryawanOrder.js — satu sumber.)
 */
export function bacaPemenuhan(m) {
  const o = m && typeof m === "object" && !Array.isArray(m) ? m : {};
  const penerimaMasuk = o.penerima;
  let penerima;
  if (penerimaMasuk !== undefined) {
    if (penerimaMasuk === null) penerima = { nama: null, telepon: null };
    else if (typeof penerimaMasuk !== "object" || Array.isArray(penerimaMasuk)) throw gagal("Isian penerima tidak valid", "PENERIMA_TIDAK_VALID");
    else {
      const nama = teksBersih(penerimaMasuk.nama, 120, "Nama penerima");
      const telRaw = penerimaMasuk.telepon === undefined ? undefined : String(penerimaMasuk.telepon ?? "").trim();
      penerima = { nama: nama ?? null, telepon: telRaw ? normalisasiNomorTelepon(telRaw) : null };
      if (penerima.telepon && !penerima.nama) throw gagal("Nama penerima wajib bila nomor penerima diisi", "PENERIMA_TIDAK_VALID");
    }
  }
  return {
    lokasiUrl: o.lokasiUrl === undefined ? undefined : validasiLokasiUrl(o.lokasiUrl),
    patokan: teksBersih(o.patokan, 200, "Patokan lokasi"),
    keluhan: teksPanjang(o.keluhan, 1000, "Keluhan"),
    catatanOrder: teksPanjang(o.catatanOrder, 1000, "Catatan order"),
    catatanProduksi: teksPanjang(o.catatanProduksi, 1000, "Catatan Produksi"),
    catatanDelivery: teksPanjang(o.catatanDelivery, 1000, "Catatan Delivery"),
    waktuPickup: teksBersih(o.waktuPickup, 200, "Waktu pickup yang disarankan"),
    waktuKirim: teksBersih(o.waktuKirim, 200, "Waktu pengiriman yang disarankan"),
    penerima,
  };
}

/** Penerima berbeda dari pembeli? (nama atau nomor berbeda dari customer). */
export function penerimaBerbeda({ penerimaNama, penerimaTelepon, customerNama, customerTelepon }) {
  if (!penerimaNama && !penerimaTelepon) return false;
  const n = (v) => String(v ?? "").trim().toLowerCase();
  if (penerimaNama && n(penerimaNama) !== n(customerNama)) return true;
  if (penerimaTelepon && customerTelepon && String(penerimaTelepon) !== String(customerTelepon)) return true;
  return false;
}
