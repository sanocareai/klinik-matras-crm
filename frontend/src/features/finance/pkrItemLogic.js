// Logika murni form item produksi Penjualan Karyawan (multi-item). Tanpa React/DOM supaya bisa dites.
//
// SEMUA definisi (kategori, produk, bentuk isian per kategori, komposisi bundel, pemetaan rute) datang dari server (GET /finance/penjualan-karyawan/katalog-item): katalog dikelola
// Admin dan himpunan field per bentuk ada di backend (lib/domain/pkrItem.js). Di sini hanya bentuk state form, body API, dan validasi ringan; server tetap otoritas (pratinjau +
// pembuatan memakai fungsi yang sama).

export const MAKS_ITEM = 20;
export const MAKS_UNIT = 20;

let urut = 0;
export const kunciBaris = () => `item-${Date.now().toString(36)}-${(urut++).toString(36)}`;

export const KIRIM_ITEM_OPSI = [
  { key: "", label: "— belum ditentukan —" },
  { key: "ya", label: "Dikirim" },
  { key: "tidak", label: "Diambil sendiri" },
];
/** Pilihan kirim untuk KOMPONEN set: kosong = ikut pilihan Set. */
export const KIRIM_KOMPONEN_OPSI = [
  { key: "", label: "Ikut pilihan Set" },
  { key: "ya", label: "Dikirim" },
  { key: "tidak", label: "Diambil sendiri" },
];
export const DIMENSI_KUNCI = ["panjang", "lebar", "tebal", "tinggi"];

export const komponenKosong = () => ({ produkId: "", produkNama: "", panjang: "", lebar: "", tebal: "", tinggi: "", spesifikasi: "", kirim: "" });
export const itemBaru = (kategori = "") => ({
  kunci: kunciBaris(), kategori, produkId: "", produkNama: "", jumlah: "1", panjang: "", lebar: "", tebal: "", tinggi: "", spesifikasi: "", kirim: "", komponen: [],
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

// ── Bundel (Set Kasur Lengkap) ────────────────────────────────────────────────────────────────────
/** Kategori item ini bundel (Set)? */
export const itemBundel = (katalog, item) => Boolean(cariKategori(katalog, item?.kategori)?.bundel);

/** Komposisi yang berlaku untuk item bundel: komposisi khusus produk bila ada, selain itu komposisi kategori. Urut seperti server. */
export function komposisiItem(katalog, item) {
  const kat = cariKategori(katalog, item?.kategori);
  if (!kat?.bundel) return [];
  const prod = item.produkId ? kat.produk.find((p) => p.id === item.produkId) : null;
  return prod?.komposisi?.length ? prod.komposisi : kat.komposisi ?? [];
}

/** Samakan `komponen` dengan komposisi (jumlah & urutan); isian yang sudah ada dipertahankan bila kategori komponennya sama. */
export function sinkronKomponen(katalog, item) {
  if (!itemBundel(katalog, item)) return { ...item, komponen: [] };
  const komposisi = komposisiItem(katalog, item);
  const lama = item.komponen ?? [];
  return { ...item, komponen: komposisi.map((k, idx) => (lama[idx] && lama[idx].kategoriKode === k.kategoriKode ? lama[idx] : { ...komponenKosong(), kategoriKode: k.kategoriKode })) };
}

/** Definisi bentuk untuk satu komponen bundel (bentuk kategori komponen). */
export const bentukKomponen = (katalog, entri) => katalog?.bentuk?.[entri?.bentuk] ?? null;
/** Produk yang boleh dipilih untuk komponen: produk kategori komponen. */
export const produkKomponen = (katalog, entri) => daftarKategori(katalog).find((k) => k.kode === entri?.kategoriKode)?.produk ?? [];

const angkaTeks = (v) => String(v ?? "").trim().replace(",", ".");
const angkaValid = (v) => v === "" || /^\d+(\.\d{1,2})?$/.test(angkaTeks(v));

/** Total unit produksi. Bundel: jumlah set × jumlah komponen per set (butuh katalog). */
export function totalUnitItems(items, katalog = null) {
  return items.reduce((a, i) => {
    const n = Number.isInteger(Number(i.jumlah)) ? Number(i.jumlah) : 0;
    if (katalog && itemBundel(katalog, i)) return a + n * komposisiItem(katalog, i).reduce((s, k) => s + (k.jumlah || 1), 0);
    return a + n;
  }, 0);
}
export const adaItemDikirim = (items, katalog = null) => items.some((i) => {
  if (katalog && itemBundel(katalog, i)) return (i.komponen ?? []).some((k) => (k.kirim || i.kirim) === "ya");
  return i.kirim === "ya";
});

/** Ganti kategori: field yang tidak dipakai bentuk baru dikosongkan, produk direset (produk milik kategori lama tidak sah). Kategori bundel: komponen disiapkan dari komposisi. */
export function ubahKategoriItem(katalog, item, kodeBaru) {
  const k = cariKategori(katalog, kodeBaru);
  const dipakai = new Set((katalog?.bentuk?.[k?.bentuk]?.dimensi ?? []).map((d) => d.key));
  const baru = { ...item, kategori: kodeBaru, produkId: "", produkNama: "", komponen: [] };
  for (const d of DIMENSI_KUNCI) if (!dipakai.has(d)) baru[d] = "";
  return sinkronKomponen(katalog, baru);
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
    if (kat.bundel) {
      const komposisi = komposisiItem(katalog, i);
      if (!komposisi.length) return `Item ${no}: set "${kat.nama}" belum punya komposisi komponen — minta Admin mengisinya di Katalog Item PKR`;
      for (const [ki, entri] of komposisi.entries()) {
        const k = (i.komponen ?? [])[ki] ?? komponenKosong();
        const b = bentukKomponen(katalog, entri);
        for (const d of b?.dimensi ?? []) if (!angkaValid(k[d.key])) return `Item ${no} · ${entri.kategoriNama}: ${d.label} harus berupa angka dalam cm`;
        if (b?.spesifikasi?.keras && String(k.spesifikasi ?? i.spesifikasi ?? "").trim().length < 5) return `Item ${no} · ${entri.kategoriNama}: produk custom wajib diisi spesifikasi (minimal 5 karakter)`;
      }
      continue;
    }
    const bentuk = katalog?.bentuk?.[kat.bentuk];
    for (const d of bentuk?.dimensi ?? []) if (!angkaValid(i[d.key])) return `Item ${no}: ${d.label} harus berupa angka dalam cm`;
    if (bentuk?.spesifikasi?.keras && String(i.spesifikasi ?? "").trim().length < 5) return `Item ${no}: produk custom wajib diisi spesifikasi (minimal 5 karakter)`;
  }
  const total = totalUnitItems(items, katalog);
  if (total > MAKS_UNIT) return `Total jumlah unit ${total} melebihi batas ${MAKS_UNIT} per order`;
  return null;
}

function bodyFieldItem(i, bentuk, o) {
  if (i.produkId) o.produkId = i.produkId; else if (String(i.produkNama ?? "").trim()) o.produkNama = String(i.produkNama).trim();
  for (const d of bentuk?.dimensi ?? []) if (String(i[d.key] ?? "").trim()) o[d.key] = angkaTeks(i[d.key]);
  if (String(i.spesifikasi ?? "").trim()) o.spesifikasi = String(i.spesifikasi).trim();
  if (i.kirim === "ya") o.perluDikirim = true; else if (i.kirim === "tidak") o.perluDikirim = false;
  return o;
}

function bodyItem(i, katalog, { struktur }) {
  const o = {};
  if (struktur) { o.kategori = i.kategori; o.jumlah = Number(i.jumlah) || 1; }
  if (itemBundel(katalog, i)) {
    // Set: pilihan/catatan tingkat set + satu isian per komponen sesuai komposisi (urutan sama).
    if (i.produkId) o.produkId = i.produkId;
    if (String(i.spesifikasi ?? "").trim()) o.spesifikasi = String(i.spesifikasi).trim();
    if (i.kirim === "ya") o.perluDikirim = true; else if (i.kirim === "tidak") o.perluDikirim = false;
    o.komponen = komposisiItem(katalog, i).map((entri, idx) => {
      const k = (i.komponen ?? [])[idx] ?? komponenKosong();
      const c = { kategori: entri.kategoriKode };
      return bodyFieldItem({ ...k, spesifikasi: k.spesifikasi, kirim: k.kirim }, bentukKomponen(katalog, entri), c);
    });
    return o;
  }
  return bodyFieldItem(i, bentukItem(katalog, i), o);
}

/** Body API pembuatan (POST PKR `orderCrm` / POST order-crm `spesifikasi`). Alamat hanya ikut bila ada item yang dikirim. */
export function bodyOrderCrmItem(f, katalog) {
  const o = { items: f.items.map((i) => bodyItem(i, katalog, { struktur: true })) };
  if (adaItemDikirim(f.items, katalog)) {
    const t = (v) => String(v ?? "").trim();
    if (t(f.alamat)) o.alamat = t(f.alamat);
    if (t(f.kota)) o.kota = t(f.kota);
    if (t(f.tanggalKirim)) o.tanggalKirim = t(f.tanggalKirim);
  }
  return o;
}

const itemDariServer = (i) => ({
  kunci: kunciBaris(), no: i.no, kategori: i.kategori, kategoriNama: i.kategoriNama, jumlah: String(i.jumlah), produkId: i.produkId ?? "", produkNama: i.produk ?? "",
  panjang: i.panjang ?? "", lebar: i.lebar ?? "", tebal: i.tebal ?? "", tinggi: i.tinggi ?? "", spesifikasi: i.spesifikasi ?? "",
  kirim: i.perluDikirim === true ? "ya" : i.perluDikirim === false ? "tidak" : "", komponen: [],
  bundel: i.bundel ?? null,
  unitTerkunci: (i.unit ?? []).some((u) => !["AWAITING_PICKUP", "RECEIVED", "CANCELLED"].includes(u.status)),
  jumlahAsal: i.jumlah, unitAktif: (i.unit ?? []).filter((u) => u.status !== "CANCELLED").length,
});

/** Isian form "Lengkapi" dari ringkasan server (sinkron.items + spesifikasi.alamat). */
export function formLengkapiDariSinkron(sinkron) {
  const s = sinkron?.order?.spesifikasi;
  return { items: (sinkron?.items ?? []).map(itemDariServer), alamat: s?.alamat ?? "", kota: s?.kota ?? "", tanggalKirim: "" };
}

/** Body "Lengkapi": item diidentifikasi `no`; kategori & jumlah TIDAK dikirim (struktur = Koreksi Item). Kolom dikosongkan dikirim "" supaya server mengosongkannya. */
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

// ── Koreksi Item ───────────────────────────────────────────────────────────────────────────────────
/** Form koreksi dari ringkasan server: item yang ada (dengan nilai awal untuk diff) + daftar item baru kosong. */
export function formKoreksiDariSinkron(sinkron) {
  const ada = (sinkron?.items ?? []).filter((i) => !i.virtual).map((i) => ({ ...itemDariServer(i), hapus: false, awal: {
    panjang: i.panjang ?? "", lebar: i.lebar ?? "", tebal: i.tebal ?? "", tinggi: i.tinggi ?? "", spesifikasi: i.spesifikasi ?? "", produkNama: i.produk ?? "", produkId: i.produkId ?? "",
    perluDikirim: i.perluDikirim ?? null, jumlah: i.jumlah,
  } }));
  return { items: ada, baru: [], alasan: "", revisi: sinkron?.order?.revisi ?? null };
}

const sama = (a, b) => String(a ?? "").trim() === String(b ?? "").trim();

/** Operasi koreksi (ubah/hapus/tambah) dari selisih form dengan nilai awal. Hanya yang berubah yang dikirim. */
export function operasiKoreksi(f, katalog) {
  const ops = [];
  for (const i of f.items) {
    if (i.hapus) { ops.push({ op: "hapus", no: i.no }); continue; }
    const bentuk = bentukItem(katalog, i);
    const o = { op: "ubah", no: i.no };
    let beda = false;
    for (const d of bentuk?.dimensi ?? []) if (!sama(i[d.key], i.awal[d.key])) { o[d.key] = angkaTeks(i[d.key]); beda = true; }
    if (!sama(i.spesifikasi, i.awal.spesifikasi)) { o.spesifikasi = String(i.spesifikasi ?? "").trim(); beda = true; }
    if ((i.produkId || "") !== (i.awal.produkId || "")) { o.produkId = i.produkId || ""; beda = true; }
    if (!i.produkId && !sama(i.produkNama, i.awal.produkNama)) { o.produkNama = String(i.produkNama ?? "").trim(); beda = true; }
    const kirim = i.kirim === "ya" ? true : i.kirim === "tidak" ? false : null;
    if (kirim !== (i.awal.perluDikirim ?? null)) { o.perluDikirim = kirim; beda = true; }
    if (Number(i.jumlah) !== Number(i.awal.jumlah)) { o.jumlah = Number(i.jumlah); beda = true; }
    if (beda) ops.push(o);
  }
  for (const b of f.baru) ops.push({ op: "tambah", item: bodyItem(b, katalog, { struktur: true }) });
  return ops;
}

/** Total unit SESUDAH koreksi (untuk pesan batas) — item dihapus tidak dihitung. */
export function totalUnitKoreksi(f, katalog) {
  const ada = f.items.filter((i) => !i.hapus);
  return totalUnitItems(ada, null) + totalUnitItems(f.baru, katalog);
}

/** Galat ringan koreksi (null = boleh dipratinjau). Server tetap otoritas. */
export function galatKoreksi(f, katalog) {
  for (const i of f.items.filter((x) => !x.hapus)) {
    const n = Number(i.jumlah);
    if (!Number.isInteger(n) || n < 1 || n > MAKS_UNIT) return `Item ${i.no}: jumlah harus bilangan bulat 1–${MAKS_UNIT}`;
    const bentuk = bentukItem(katalog, i);
    for (const d of bentuk?.dimensi ?? []) if (!angkaValid(i[d.key])) return `Item ${i.no}: ${d.label} harus berupa angka dalam cm`;
    if (bentuk?.spesifikasi?.keras && String(i.spesifikasi ?? "").trim().length < 5) return `Item ${i.no}: produk custom wajib diisi spesifikasi (minimal 5 karakter)`;
  }
  const g = f.baru.length ? galatItems(f.baru, katalog) : null;
  if (g) return g;
  if (totalUnitKoreksi(f, katalog) > MAKS_UNIT) return `Total jumlah unit ${totalUnitKoreksi(f, katalog)} melebihi batas ${MAKS_UNIT} per order`;
  if (operasiKoreksi(f, katalog).length === 0) return "Belum ada perubahan";
  return null;
}

/** Alasan koreksi valid? (minimal 5 karakter setelah dirapikan). */
export const alasanValid = (a) => String(a ?? "").trim().replace(/\s+/g, " ").length >= 5;

/** Ringkasan satu baris untuk daftar: "Kasur Baru ×1 · Divan/Box ×1 · Sandaran/Headboard ×1". Komponen set diberi awalan "Set n:" sekali. */
export function ringkasItemsTeks(items) {
  if (!items?.length) return "";
  return items.map((i) => `${i.produk || i.kategoriNama}${i.jumlah > 1 ? ` ×${i.jumlah}` : ""}`).join(" · ");
}

export const LABEL_JENIS_KERJA = { BARU: "Produk baru (langsung di workshop)", LAYANAN: "Service/upgrade (barang diambil dulu)" };
export const LABEL_KATEGORI_ORDER = { BARU: "Produk baru", LAYANAN: "Service/Upgrade", CAMPURAN: "Campuran", SEWA: "Sewa" };
