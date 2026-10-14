// KOREKSI ORDER PKR — logika murni layar (tanpa React): form awal, body API, galat ringan, pembacaan matriks progres, ringkasan dampak per area.
// Aturan sebenarnya ditegakkan SERVER (penjualanKaryawanKoreksiOrder.js); layar hanya menampilkannya jujur: field terkunci selalu membawa ALASAN dan TINDAKAN yang benar.
import { formEditDariIdentitas, bodyKoreksiPembeli, adaPerubahanKoreksi, galatFormEdit } from "./pkrPembeliLogic.js";
import { bodyItemPenjualan, galatItemPenjualan, itemPenjualanBaru, totalPenjualan } from "./pkrItemLogic.js";
import { peringatanAlur } from "./pkrRuteLogic.js";

export const JENIS_KOREKSI = Object.freeze({
  PERBAIKAN: { kode: "PERBAIKAN", label: "Perbaiki data yang salah input", hint: "Data di SANSS salah; pekerjaan fisik mengikuti data yang benar." },
  TAMBAHAN: { kode: "TAMBAHAN", label: "Tambahan permintaan customer", hint: "Customer menambah produk, jumlah, atau layanan setelah order dibuat." },
});

export const SECTION_KOREKSI = Object.freeze([
  { kode: "customer", label: "Customer & penerima" },
  { kode: "alamat", label: "Alamat, Maps dan patokan" },
  { kode: "catatan", label: "Keluhan dan catatan" },
  { kode: "item", label: "Item, jumlah, ukuran dan spesifikasi" },
  { kode: "kirim", label: "Pickup/Delivery" },
  { kode: "nilai", label: "Harga dan nilai" },
  { kode: "dampak", label: "Pratinjau dampak" },
]);

export const LABEL_TAHAP_PRODUKSI = { BELUM_MULAI: "Produksi belum mulai", BERJALAN: "Produksi sedang berjalan", SELESAI: "Produksi selesai" };
export const LABEL_TAHAP_DELIVERY = {
  BELUM_ADA: "Belum ada job pengiriman", BELUM_DIJADWALKAN: "Job pengiriman belum dijadwalkan", TERJADWAL: "Pengiriman terjadwal (belum berjalan)", BERJALAN: "Pengiriman sedang berjalan", SELESAI: "Pengiriman selesai",
};
export const LABEL_MODE = { LANGSUNG: "Boleh diubah langsung", ADMINISTRATIF: "Perbaikan administratif", KOREKSI_NILAI: "Lewat koreksi nilai", TERKUNCI: "Terkunci", TAMBAHAN: "Lewat tambahan pesanan" };
export const VARIAN_MODE = { LANGSUNG: "green", ADMINISTRATIF: "accent", KOREKSI_NILAI: "accent", TERKUNCI: "orange", TAMBAHAN: "accent" };

const t = (v) => String(v ?? "").trim();
const angka = (v) => { const s = t(v).replace(",", "."); return s === "" ? null : Number(s); };

export const grupMatriks = (kemampuan, kode) => (kemampuan?.matriks ?? []).find((g) => g.kode === kode) ?? null;

/** Kunci per field untuk tampilan: boleh/terkunci + alasan + tindakan (dari matriks server). */
export function statusField(kemampuan, kode) {
  const g = grupMatriks(kemampuan, kode);
  if (!g) return { boleh: true, terkunci: false, mode: "LANGSUNG", alasan: null, tindakan: null };
  return { boleh: g.boleh, terkunci: g.mode === "TERKUNCI", mode: g.mode, alasan: g.alasan, tindakan: g.tindakan };
}

export function formAwalKoreksi(kemampuan, identitas) {
  const pembeli = formEditDariIdentitas(identitas, { order: null });
  return {
    pembeli,
    spek: { merk: kemampuan?.spesifikasi?.merk ?? "", ukuran: kemampuan?.spesifikasi?.ukuran ?? "", perluDikirim: kemampuan?.spesifikasi?.perluDikirim ?? null },
    itemEdit: Object.fromEntries((kemampuan?.item ?? []).map((i) => [i.no, { spesifikasi: i.spesifikasi ?? "", panjang: i.panjang ?? "", lebar: i.lebar ?? "", tebal: i.tebal ?? "", tinggi: i.tinggi ?? "" }])),
    jumlah: String((kemampuan?.unit ?? []).length || ""),
    nilai: Object.fromEntries((kemampuan?.keuangan?.baris ?? []).map((b) => [b.no, String(b.harga)])),
    tambahan: [itemPenjualanBaru()],
    konfirmasiAdministratif: false,
  };
}

/** Body API Koreksi Order. Hanya yang BERUBAH dikirim. `awal` = formAwalKoreksi (identitas/spesifikasi/nilai awal). */
export function bodyKoreksiOrder(jenis, f, awal, kemampuan, katalog) {
  if (jenis === "TAMBAHAN") return { jenis, tambahan: (f.tambahan || []).map((i) => bodyItemPenjualan(i, katalog)) };
  const body = { jenis, konfirmasiAdministratif: Boolean(f.konfirmasiAdministratif) };
  const pembeli = bodyKoreksiPembeli(f.pembeli, awal.pembeli);
  if (pembeli.pembeli) body.pembeli = pembeli.pembeli;
  if (pembeli.pemenuhan) body.pemenuhan = pembeli.pemenuhan;
  const spek = {};
  if (kemampuan && !kemampuan.legacy) {
    const item = [];
    for (const [no, e] of Object.entries(f.itemEdit)) {
      const a = awal.itemEdit[no]; if (!a) continue;
      const o = { no: Number(no) };
      if (t(e.spesifikasi) !== t(a.spesifikasi)) o.spesifikasi = t(e.spesifikasi) || null;
      for (const d of ["panjang", "lebar", "tebal", "tinggi"]) if (t(e[d]) !== t(a[d])) o[d] = t(e[d]) === "" ? null : e[d];
      if (Object.keys(o).length > 1) item.push(o);
    }
    if (item.length) spek.item = item;
  } else {
    if (t(f.spek.merk) !== t(awal.spek.merk)) spek.merk = t(f.spek.merk) || null;
    if (t(f.spek.ukuran) !== t(awal.spek.ukuran)) spek.ukuran = t(f.spek.ukuran) || null;
    if (f.spek.perluDikirim !== awal.spek.perluDikirim && typeof f.spek.perluDikirim === "boolean") spek.perluDikirim = f.spek.perluDikirim;
  }
  if (Object.keys(spek).length) body.spesifikasi = spek;
  const jml = angka(f.jumlah);
  if (kemampuan?.legacy && jml !== null && jml !== Number(awal.jumlah)) body.jumlah = jml;
  const nilai = [];
  for (const [no, harga] of Object.entries(f.nilai)) if (t(harga) !== t(awal.nilai[no]) && t(harga) !== "") nilai.push({ no: Number(no), harga: Number(angka(harga)) });
  if (nilai.length) body.nilai = nilai;
  return body;
}

export function adaPerubahanOrder(body) {
  if (!body) return false;
  if (body.jenis === "TAMBAHAN") return (body.tambahan?.length ?? 0) > 0;
  return Boolean(body.pembeli || body.pemenuhan || body.spesifikasi || body.nilai || body.jumlah !== undefined);
}

export const alasanValid = (a) => t(a).replace(/\s+/g, " ").length >= 5;

/** Galat ringan sebelum pratinjau (server tetap memvalidasi ulang). */
export function galatKoreksiOrder(jenis, f, kemampuan, katalog) {
  if (jenis === "TAMBAHAN") {
    if (!katalog) return "Memuat katalog item…";
    if (!(f.tambahan || []).length) return "Isi minimal satu item tambahan";
    return galatItemPenjualan(f.tambahan, katalog);
  }
  const gp = galatFormEdit(f.pembeli);
  if (gp) return gp;
  for (const [no, h] of Object.entries(f.nilai)) {
    if (t(h) === "") return `Baris ${no}: harga wajib diisi`;
    const n = angka(h);
    if (!Number.isFinite(n) || n < 0) return `Baris ${no}: harga harus angka 0 atau lebih`;
  }
  const jml = angka(f.jumlah);
  if (kemampuan?.legacy && jml !== null && (!Number.isInteger(jml) || jml < 1 || jml > 200)) return "Jumlah unit harus bilangan bulat 1–200";
  return null;
}

/** Total tambahan (Rp) untuk kartu "Nilai tambahan". */
export const totalTambahan = (items) => totalPenjualan(items || []);

/** Perlu konfirmasi administratif? (Produksi selesai dan ada perubahan spesifikasi). */
export const perluKonfirmasiAdministratif = (kemampuan, body) => Boolean(body?.spesifikasi) && kemampuan?.progres?.tahapProduksi === "SELESAI";

/** Ringkas dampak dari pratinjau server menjadi tiga area (Finance, Produksi, Delivery) + peringatan. */
export function ringkasDampak(pra, kemampuan) {
  const hasil = { finance: [], produksi: [], delivery: [], customer: [], peringatan: [], menungguAlur: [], tidakDibuat: ["Order baru", "Payment baru", "Invoice", "Pendapatan CRM"] };
  if (!pra?.valid) return hasil;
  // "Menunggu penentuan alur Produksi" (mode transisi): dikumpulkan dari peringatan MANA PUN pada hasil pratinjau; ditampilkan sebagai blok sendiri, bukan galat.
  const kumpul = (x) => { for (const w of peringatanAlur(x)) if (!hasil.menungguAlur.includes(w)) hasil.menungguAlur.push(w); };
  kumpul(pra.peringatan); for (const b of pra.bagian ?? []) { kumpul(b.peringatan); kumpul(b.dampak?.peringatan); kumpul(b.dampak?.item?.peringatan); }
  for (const b of pra.bagian ?? []) {
    if (b.jenis === "PEMBELI") {
      for (const p of b.perubahan ?? []) hasil.customer.push({ label: p.label, sebelum: p.sebelum, sesudah: p.sesudah });
      const d = b.dampak || {};
      if (d.jobDisinkron) hasil.delivery.push(`Alamat/penerima ${d.jobDisinkron} job pengiriman diperbarui (job yang SAMA, tidak ada job baru).`);
      if (d.customerBaru) hasil.customer.push({ label: "Customer", sebelum: null, sesudah: "Customer baru dibuat dari nomor ini" });
      for (const w of b.peringatan ?? []) hasil.peringatan.push(String(w));
    } else if (b.jenis === "spesifikasi") {
      for (const x of Object.entries(b.perubahan ?? {})) if (x[1] && typeof x[1] === "object" && "sebelum" in x[1]) hasil.produksi.push(`${x[0]}: ${x[1].sebelum ?? "—"} → ${x[1].sesudah ?? "—"} (unit yang sama diperbarui)`);
      if (Array.isArray(b.perubahan)) for (const it of b.perubahan) hasil.produksi.push(`Item ${it.no}: ${Object.entries(it.perubahan || {}).map(([k, v]) => `${k} ${v.sebelum ?? "—"} → ${v.sesudah ?? "—"}`).join("; ")}${it.mode === "ADMINISTRATIF" ? " (administratif)" : ""}`);
      if (b.mode === "ADMINISTRATIF") hasil.peringatan.push("Perbaikan administratif: BOM, pemakaian bahan, stok, milestone, PIC, dan jurnal tidak berubah; data lama tersimpan di riwayat.");
    } else if (b.jenis === "ADOPSI") {
      hasil.produksi.push(`Order lama dicatat sebagai satu item "Pesanan awal" (${b.unit?.length ?? 0} unit ditautkan; unit tidak diubah).`);
    } else if (b.jenis === "JUMLAH") {
      const u = b.dampak?.unit; if (u) hasil.produksi.push(`Unit dibatalkan: ${(u.dibatalkan ?? []).join(", ") || "—"}`);
    } else if (b.jenis === "TAMBAHAN") {
      const u = b.dampak?.unit; if (u) hasil.produksi.push(`Unit baru: ${u.dibuat ?? 0} (unit lama tidak disentuh)`);
      for (const it of b.dampak?.item?.ditambah ?? []) hasil.produksi.push(`Item ${it.no}: ${it.produk} ×${it.jumlah}`);
      const d = b.dampak?.delivery; if (d?.catatan) hasil.delivery.push(d.catatan);
    }
    const k = b.keuangan || b.dampak?.keuangan;
    if (k) {
      hasil.finance.push({ totalSebelum: k.totalSebelum, totalSesudah: k.totalSesudah, selisih: k.selisih, terbayar: k.terbayar, sisaSesudah: k.sisaSesudah, jurnal: k.jurnal });
    }
  }
  void kemampuan;
  return hasil;
}

/** Hasil pratinjau gagal: ambil kelebihan bayar bila ada (peringatan khusus + arahan refund resmi). */
export function bacaGalatPratinjau(pra) {
  if (!pra || pra.valid) return null;
  const g = pra.galat || {};
  return { pesan: g.pesan || "Koreksi ditolak", kode: g.kode || null, kelebihanBayar: typeof g.kelebihanBayar === "number" ? g.kelebihanBayar : null, petunjuk: g.petunjuk || null };
}
