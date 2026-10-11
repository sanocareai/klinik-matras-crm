// Logika murni form item produksi Penjualan Karyawan (multi-item). Tanpa React/DOM supaya bisa dites.
//
// SEMUA definisi (kategori, produk, bentuk isian per kategori) datang dari server (GET /finance/penjualan-karyawan/katalog-item): katalog dikelola Admin dan himpunan field per bentuk
// ada di backend (lib/domain/pkrItem.js). Di sini hanya bentuk state form, body API, dan validasi ringan; server tetap otoritas (pratinjau + pembuatan memakai fungsi yang sama).

export const MAKS_ITEM = 20;
export const MAKS_UNIT = 20;

let urut = 0;
export const kunciBaris = () => `item-${Date.now().toString(36)}-${(urut++).toString(36)}`;

export const KIRIM_ITEM_OPSI = [
  { key: "", label: "— belum ditentukan —" },
  { key: "ya", label: "Dikirim" },
  { key: "tidak", label: "Diambil sendiri" },
];
export const DIMENSI_KUNCI = ["panjang", "lebar", "tebal", "tinggi"];

export const itemBaru = (kategori = "") => ({
  kunci: kunciBaris(), kategori, produkId: "", produkNama: "", jumlah: "1", panjang: "", lebar: "", tebal: "", tinggi: "", spesifikasi: "", kirim: "",
});
/** Isian awal form "Order untuk Produksi dan Delivery": satu item kosong + logistik. */
export const orderCrmItemKosong = () => ({ items: [itemBaru()], alamat: "", kota: "", tanggalKirim: "" });

export const daftarKategori = (katalog) => katalog?.kategori ?? [];
export const cariKategori = (katalog, kode) => daftarKategori(katalog).find((k) => k.kode === kode) ?? null;
/** Definisi bentuk (field kontekstual) untuk item; null bila kategori belum dipilih. */
export function bentukItem(katalog, item) {
  const k = cariKategori(katalog, item?.kategori);
  return k ? katalog?.bentuk?.[k.bentuk] ?? null : null;
}
export const produkKategori = (katalog, item) => cariKategori(katalog, item?.kategori)?.produk ?? [];

const angkaTeks = (v) => String(v ?? "").trim().replace(",", ".");
const angkaValid = (v) => v === "" || /^\d+(\.\d{1,2})?$/.test(angkaTeks(v));

export const totalUnitItems = (items) => items.reduce((a, i) => a + (Number.isInteger(Number(i.jumlah)) ? Number(i.jumlah) : 0), 0);
export const adaItemDikirim = (items) => items.some((i) => i.kirim === "ya");

/** Ganti kategori: field yang tidak dipakai bentuk baru dikosongkan, produk direset (produk milik kategori lama tidak sah). */
export function ubahKategoriItem(katalog, item, kodeBaru) {
  const k = cariKategori(katalog, kodeBaru);
  const dipakai = new Set((katalog?.bentuk?.[k?.bentuk]?.dimensi ?? []).map((d) => d.key));
  const baru = { ...item, kategori: kodeBaru, produkId: "", produkNama: "" };
  for (const d of DIMENSI_KUNCI) if (!dipakai.has(d)) baru[d] = "";
  return baru;
}

/** Galat isian ringan (null = boleh lanjut ke pratinjau). Kekurangan data BUKAN galat — order tetap dibuat "Perlu dilengkapi"; yang keras: kategori, jumlah, angka, custom tanpa spesifikasi. */
export function galatItems(items, katalog) {
  if (!items.length) return "Tambahkan minimal satu item produksi";
  if (items.length > MAKS_ITEM) return `Maksimal ${MAKS_ITEM} item`;
  for (const [idx, i] of items.entries()) {
    const no = idx + 1;
    const kat = cariKategori(katalog, i.kategori);
    if (!kat) return `Item ${no}: pilih kategori`;
    const n = Number(i.jumlah);
    if (!Number.isInteger(n) || n < 1 || n > MAKS_UNIT) return `Item ${no}: jumlah harus bilangan bulat 1–${MAKS_UNIT}`;
    const bentuk = katalog?.bentuk?.[kat.bentuk];
    for (const d of bentuk?.dimensi ?? []) if (!angkaValid(i[d.key])) return `Item ${no}: ${d.label} harus berupa angka dalam cm`;
    if (bentuk?.spesifikasi?.keras && String(i.spesifikasi ?? "").trim().length < 5) return `Item ${no}: produk custom wajib diisi spesifikasi (minimal 5 karakter)`;
  }
  if (totalUnitItems(items) > MAKS_UNIT) return `Total jumlah unit ${totalUnitItems(items)} melebihi batas ${MAKS_UNIT} per order`;
  return null;
}

function bodyItem(i, katalog, { struktur }) {
  const bentuk = bentukItem(katalog, i);
  const o = {};
  if (struktur) { o.kategori = i.kategori; o.jumlah = Number(i.jumlah) || 1; }
  if (i.produkId) o.produkId = i.produkId; else if (String(i.produkNama ?? "").trim()) o.produkNama = String(i.produkNama).trim();
  for (const d of bentuk?.dimensi ?? []) if (String(i[d.key] ?? "").trim()) o[d.key] = angkaTeks(i[d.key]);
  if (String(i.spesifikasi ?? "").trim()) o.spesifikasi = String(i.spesifikasi).trim();
  if (i.kirim === "ya") o.perluDikirim = true; else if (i.kirim === "tidak") o.perluDikirim = false;
  return o;
}

/** Body API pembuatan (POST PKR `orderCrm` / POST order-crm `spesifikasi`). Alamat hanya ikut bila ada item yang dikirim. */
export function bodyOrderCrmItem(f, katalog) {
  const o = { items: f.items.map((i) => bodyItem(i, katalog, { struktur: true })) };
  if (adaItemDikirim(f.items)) {
    const t = (v) => String(v ?? "").trim();
    if (t(f.alamat)) o.alamat = t(f.alamat);
    if (t(f.kota)) o.kota = t(f.kota);
    if (t(f.tanggalKirim)) o.tanggalKirim = t(f.tanggalKirim);
  }
  return o;
}

/** Isian form "Lengkapi" dari ringkasan server (sinkron.items + spesifikasi.alamat). */
export function formLengkapiDariSinkron(sinkron) {
  const s = sinkron?.order?.spesifikasi;
  return {
    items: (sinkron?.items ?? []).map((i) => ({
      kunci: kunciBaris(), no: i.no, kategori: i.kategori, kategoriNama: i.kategoriNama, jumlah: String(i.jumlah), produkId: i.produkId ?? "", produkNama: i.produk ?? "",
      panjang: i.panjang ?? "", lebar: i.lebar ?? "", tebal: i.tebal ?? "", tinggi: i.tinggi ?? "", spesifikasi: i.spesifikasi ?? "",
      kirim: i.perluDikirim === true ? "ya" : i.perluDikirim === false ? "tidak" : "", unitTerkunci: (i.unit ?? []).some((u) => !["AWAITING_PICKUP", "RECEIVED", "CANCELLED"].includes(u.status)),
    })),
    alamat: s?.alamat ?? "", kota: s?.kota ?? "", tanggalKirim: "",
  };
}

/** Body "Lengkapi": item diidentifikasi `no`; kategori & jumlah TIDAK dikirim (terkunci). Kolom dikosongkan dikirim "" supaya server mengosongkannya. */
export function bodyLengkapiItem(f, katalog) {
  const items = f.items.map((i) => {
    const bentuk = bentukItem(katalog, i);
    const o = { no: i.no, spesifikasi: String(i.spesifikasi ?? "").trim() };
    if (i.produkId) o.produkId = i.produkId; else { o.produkId = ""; o.produkNama = String(i.produkNama ?? "").trim(); }
    for (const d of bentuk?.dimensi ?? []) o[d.key] = angkaTeks(i[d.key]);
    o.perluDikirim = i.kirim === "ya" ? true : i.kirim === "tidak" ? false : null;
    return o;
  });
  const b = { items };
  const t = (v) => String(v ?? "").trim();
  if (t(f.alamat)) b.alamat = t(f.alamat);
  if (t(f.kota)) b.kota = t(f.kota);
  if (t(f.tanggalKirim)) b.tanggalKirim = t(f.tanggalKirim);
  return b;
}

/** Galat ringan untuk form lengkapi: angka valid dan custom tetap punya spesifikasi. */
export function galatLengkapiItem(f, katalog) {
  for (const i of f.items) {
    const bentuk = bentukItem(katalog, i);
    for (const d of bentuk?.dimensi ?? []) if (!angkaValid(i[d.key])) return `Item ${i.no}: ${d.label} harus berupa angka dalam cm`;
    if (bentuk?.spesifikasi?.keras && String(i.spesifikasi ?? "").trim().length < 5) return `Item ${i.no}: produk custom wajib diisi spesifikasi (minimal 5 karakter)`;
  }
  return null;
}

/** Ringkasan satu baris untuk daftar: "Kasur Baru ×1 · Divan/Box ×1 · Sandaran/Headboard ×1". */
export function ringkasItemsTeks(items) {
  if (!items?.length) return "";
  return items.map((i) => `${i.produk || i.kategoriNama}${i.jumlah > 1 ? ` ×${i.jumlah}` : ""}`).join(" · ");
}

export const LABEL_JENIS_KERJA = { BARU: "Produk baru (langsung di workshop)", LAYANAN: "Service/upgrade (barang diambil dulu)" };
