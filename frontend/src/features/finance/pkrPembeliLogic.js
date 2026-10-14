// FORM PEMBELI / PENERIMA / ALAMAT / KEBUTUHAN PKR — logika murni (tanpa React) supaya aturan validasi + bentuk body bisa dites dan dipakai bersama
// wizard "Catat Penjualan" dan dialog "Edit Data Customer". Tiga identitas TIDAK tercampur: karyawan penjual, customer/pembeli, penerima.
//
// Aturan yang sama dengan server (server tetap berwenang): nomor telepon dinormalisasi (utils/nomorTelepon.js), link Maps hanya Google Maps (utils/mapsLink.js),
// pembeli wajib punya nomor kecuali "Pembeli adalah karyawan", penerima berbeda wajib punya nama.
import { normalisasiNomorTelepon } from "../../utils/nomorTelepon.js";
import { validasiLinkMaps } from "../../utils/mapsLink.js";

/** Urutan langkah wizard Catat Penjualan (konsisten dengan urutan field di Order CRM Inbox). */
export const LANGKAH_PKR = Object.freeze([
  { kode: "transaksi", label: "Transaksi" },
  { kode: "customer", label: "Customer & penerima" },
  { kode: "alamat", label: "Alamat & lokasi" },
  { kode: "kebutuhan", label: "Keluhan & kebutuhan" },
  { kode: "item", label: "Item" },
  { kode: "bayar", label: "Pembayaran awal" },
  { kode: "pratinjau", label: "Pratinjau" },
]);

export const pembeliKosong = () => ({
  telepon: "", adalahKaryawan: false, ditautkanId: null,
  penerimaBeda: false, penerimaNama: "", penerimaTelepon: "",
  lokasiUrl: "", patokan: "",
  keluhan: "", catatanOrder: "", catatanProduksi: "", catatanDelivery: "", waktuPickup: "", waktuKirim: "",
});

const t = (v) => String(v ?? "").trim();

/** Galat langkah "Customer & penerima" (null = lolos). `buyerName` = nama pembeli di tingkat transaksi. */
export function galatCustomer(f) {
  const nama = t(f.buyerName);
  if (nama.length < 2) return "Nama pembeli wajib diisi (minimal 2 karakter)";
  const p = f.pembeli;
  if (!p.adalahKaryawan) {
    const n = normalisasiNomorTelepon(p.telepon);
    if (!n.ok) return n.galat;
  }
  if (p.penerimaBeda) {
    if (t(p.penerimaNama).length < 2) return "Nama penerima wajib diisi bila penerima berbeda dari pembeli";
    if (t(p.penerimaTelepon)) {
      const n = normalisasiNomorTelepon(p.penerimaTelepon);
      if (!n.ok) return `Nomor penerima: ${n.galat}`;
    }
  }
  return null;
}

/** Galat langkah "Alamat & lokasi". `perluAlamat` = ada item yang DIKIRIM (alamat wajib). */
export function galatAlamat(f, { perluAlamat = false } = {}) {
  if (perluAlamat && t(f.daftar?.alamat).length < 5) return "Alamat lengkap pengiriman wajib diisi karena ada item yang dikirim";
  const m = validasiLinkMaps(f.pembeli.lokasiUrl);
  if (!m.ok) return m.galat;
  if (t(f.pembeli.patokan).length > 200) return "Patokan lokasi maksimal 200 karakter";
  return null;
}

/** Galat langkah "Keluhan & kebutuhan". */
export function galatKebutuhan(f) {
  const p = f.pembeli;
  for (const [k, label, maks] of [["keluhan", "Keluhan", 1000], ["catatanOrder", "Catatan umum", 1000], ["catatanProduksi", "Catatan Produksi", 1000], ["catatanDelivery", "Catatan Delivery", 1000], ["waktuPickup", "Waktu pickup", 200], ["waktuKirim", "Waktu pengiriman", 200]]) {
    if (t(p[k]).length > maks) return `${label} maksimal ${maks} karakter`;
  }
  return null;
}

/** Bagian body POST PKR dari form pembeli: `pembeli` (identitas) + kolom tambahan untuk `orderCrm` (pemenuhan/alamat/catatan). Kunci kosong tidak dikirim. */
export function bodyPembeli(f) {
  const p = f.pembeli;
  const pembeli = p.adalahKaryawan ? { adalahKaryawan: true } : { telepon: t(p.telepon) };
  const ekstra = {};
  const set = (k, v) => { const x = t(v); if (x) ekstra[k] = x; };
  const maps = validasiLinkMaps(p.lokasiUrl);
  if (maps.ok && maps.url) ekstra.lokasiUrl = maps.url;
  set("patokan", p.patokan); set("keluhan", p.keluhan); set("catatanOrder", p.catatanOrder);
  set("catatanProduksi", p.catatanProduksi); set("catatanDelivery", p.catatanDelivery); set("waktuPickup", p.waktuPickup); set("waktuKirim", p.waktuKirim);
  if (p.penerimaBeda && t(p.penerimaNama)) ekstra.penerima = { nama: t(p.penerimaNama), ...(t(p.penerimaTelepon) && { telepon: t(p.penerimaTelepon) }) };
  return { pembeli, orderCrmEkstra: ekstra };
}

/** Ringkasan bacaan untuk langkah Pratinjau (tanpa nominal — nominal datang dari pratinjau server). */
export function ringkasCustomerPratinjau(f) {
  const p = f.pembeli;
  const n = normalisasiNomorTelepon(p.telepon);
  return {
    nama: t(f.buyerName),
    telepon: p.adalahKaryawan ? null : n.ok ? n.nomor : null,
    sumber: "Penjualan Karyawan",
    pembeliAdalahKaryawan: p.adalahKaryawan,
    penerima: p.penerimaBeda ? { nama: t(p.penerimaNama), telepon: t(p.penerimaTelepon) || null } : { nama: t(f.buyerName), telepon: null, samaDenganPembeli: true },
    alamat: t(f.daftar?.alamat) || null, kota: t(f.daftar?.kota) || null, lokasiUrl: validasiLinkMaps(p.lokasiUrl).url ?? null, patokan: t(p.patokan) || null,
  };
}

/** Data yang BELUM lengkap untuk ditampilkan di pratinjau (bukan galat penghalang kecuali yang wajib). */
export function belumLengkap(f, { perluAlamat = false } = {}) {
  const p = f.pembeli; const m = [];
  if (!p.adalahKaryawan && !normalisasiNomorTelepon(p.telepon).ok) m.push("Nomor telepon pembeli");
  if (perluAlamat && t(f.daftar?.alamat).length < 5) m.push("Alamat pengiriman");
  if (perluAlamat && !t(p.lokasiUrl)) m.push("Link Google Maps (disarankan untuk Delivery)");
  if (!t(p.keluhan)) m.push("Keluhan customer (opsional)");
  return m;
}

/** Form edit dari data order yang sudah ada (identitas server) → state dialog "Edit Data Customer". */
export function formEditDariIdentitas(identitas, { order = null } = {}) {
  const id = identitas || {};
  const a = id.alamat || {};
  const c = id.catatan || {};
  return {
    nama: id.legacy ? (id.customer?.nama ?? "") : (id.customer?.nama ?? ""),
    telepon: id.customer?.telepon ?? "",
    adalahKaryawan: Boolean(id.pembeliAdalahKaryawan),
    penerimaBeda: Boolean(id.penerima?.berbeda), penerimaNama: id.penerima?.berbeda ? (id.penerima?.nama ?? "") : "", penerimaTelepon: id.penerima?.berbeda ? (id.penerima?.telepon ?? "") : "",
    alamat: a.teks ?? "", kota: a.kota ?? "", lokasiUrl: a.lokasiUrl ?? "", patokan: a.patokan ?? "",
    keluhan: c.keluhan ?? "", catatanOrder: c.order ?? "", catatanProduksi: c.produksi ?? "", catatanDelivery: c.delivery ?? "",
    waktuPickup: order?.pickupEstimate ?? "", waktuKirim: order?.deliveryEstimate ?? "",
  };
}

/**
 * Body koreksi dari form edit: hanya kolom yang BERUBAH dibanding `awal` dikirim (server menolak "tanpa perubahan" dan membandingkan lagi).
 * Telepon kosong tidak dikirim (bukan menghapus customer).
 */
export function bodyKoreksiPembeli(baru, awal) {
  const pembeli = {};
  const pemenuhan = {};
  const beda = (k) => t(baru[k]) !== t(awal[k]);
  if (baru.adalahKaryawan && !awal.adalahKaryawan) pembeli.adalahKaryawan = true;
  else if (!baru.adalahKaryawan) {
    if (beda("telepon") && t(baru.telepon)) pembeli.telepon = t(baru.telepon);
    if (beda("nama") && t(baru.nama)) pembeli.nama = t(baru.nama);
    // Lengkapi data legacy: nomor baru + nama (nama dikirim juga supaya customer baru bernama benar).
    if (pembeli.telepon && !pembeli.nama && t(baru.nama)) pembeli.nama = t(baru.nama);
  }
  for (const k of ["alamat", "kota", "patokan", "keluhan", "catatanOrder", "catatanProduksi", "catatanDelivery", "waktuPickup", "waktuKirim"]) {
    if (beda(k)) pemenuhan[k] = t(baru[k]) || null;
  }
  if (beda("lokasiUrl")) pemenuhan.lokasiUrl = t(baru.lokasiUrl) || null;
  const penerimaBerubah = baru.penerimaBeda !== awal.penerimaBeda || beda("penerimaNama") || beda("penerimaTelepon");
  if (penerimaBerubah) {
    pemenuhan.penerima = baru.penerimaBeda ? { nama: t(baru.penerimaNama) || null, telepon: t(baru.penerimaTelepon) || null } : null;
  }
  const hasil = {};
  if (Object.keys(pembeli).length) hasil.pembeli = pembeli;
  if (Object.keys(pemenuhan).length) hasil.pemenuhan = pemenuhan;
  return hasil;
}

export const adaPerubahanKoreksi = (b) => Boolean(b && (b.pembeli || b.pemenuhan));

/** Galat form edit sebelum pratinjau. */
export function galatFormEdit(f) {
  if (!f.adalahKaryawan && t(f.telepon)) {
    const n = normalisasiNomorTelepon(f.telepon);
    if (!n.ok) return n.galat;
  }
  if (t(f.nama).length > 0 && t(f.nama).length < 2) return "Nama pembeli minimal 2 karakter";
  const m = validasiLinkMaps(f.lokasiUrl);
  if (!m.ok) return m.galat;
  if (f.penerimaBeda) {
    if (t(f.penerimaNama).length < 2) return "Nama penerima wajib diisi bila penerima berbeda";
    if (t(f.penerimaTelepon)) { const n = normalisasiNomorTelepon(f.penerimaTelepon); if (!n.ok) return `Nomor penerima: ${n.galat}`; }
  }
  return null;
}

/**
 * Kemampuan edit menurut PROGRES (hanya untuk menjelaskan di UI; server tetap menegakkan):
 *   delivery "MULAI" (EN_ROUTE/ARRIVED) → blokir alamat/penerima; "SELESAI" → blokir (hanya catatan); "TERJADWAL" → sinkron job yang sama; selain itu bebas.
 */
export function kemampuanEdit({ delivery = null } = {}) {
  const kode = delivery?.kode ?? null;
  if (kode === "COMPLETED") return { alamat: false, alasan: "Delivery sudah selesai — data penerima/alamat historis tidak ditimpa. Hanya catatan Delivery yang dapat ditambah.", status: "SELESAI" };
  if (kode === "EN_ROUTE" || kode === "ARRIVED") return { alamat: false, alasan: "Job Delivery sedang berjalan — hubungi Delivery untuk Reschedule/Koreksi Delivery resmi.", status: "MULAI" };
  if (["SCHEDULED", "ASSIGNED", "RESCHEDULED"].includes(kode)) return { alamat: true, alasan: "Job Delivery sudah terjadwal — alamat/penerima ikut diperbarui pada job yang SAMA (tidak membuat job kedua).", status: "TERJADWAL" };
  return { alamat: true, alasan: null, status: "BEBAS" };
}

/** Peran yang boleh mengoreksi data pembeli/pengiriman order PKR dari CRM (server tetap menegakkan izin dan membatasi kolom per peran). */
export function bolehKoreksiPembeliPkr(user) {
  const peran = new Set([user?.role, ...(Array.isArray(user?.roles) ? user.roles : [])].filter(Boolean));
  return ["ADMIN", "OWNER", "FINANCE", "DISPATCHER", "PRODUCTION_LEAD"].some((r) => peran.has(r));
}
