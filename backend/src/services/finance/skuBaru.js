// SKU BARU LANGSUNG DARI PURCHASE ORDER + KATALOG SUPPLIER + KONVERSI SATUAN.
//
// Prinsip (jangan dilanggar):
//   • SATU master material (tabel materials) untuk Finance, Gudang, dan Produksi — tidak ada salinan. SKU baru ditulis HANYA di dalam transaksi simpan PO: satu kegagalan
//     membatalkan SKU, katalog supplier, dan baris PO sekaligus. Membuat SKU/PO TIDAK menulis stok, jurnal, GRNI, utang, tagihan, atau pembayaran.
//   • Hanya finance:admin (ADMIN/OWNER) yang boleh membuat SKU dari form PO. Finance biasa hanya memilih SKU yang ada.
//   • Kode SKU dibuat SERVER (PREFIX-NNN, tiga huruf + tiga angka) di bawah advisory lock per prefix + unique(materials.code): dua permintaan paralel tidak mendapat kode sama.
//   • Duplikat: kecocokan pasti diblokir; mirip butuh konfirmasi + alasan; barang yang sama dari supplier lain memakai SKU internal yang sama + relasi Katalog Supplier baru.
//   • Harga terakhir katalog supplier hanya informasi — tidak menulis ulang PO lama, stok, atau biaya.
//   • Jenis: BAHAN_PRODUKSI (katalog Produksi, TIDAK otomatis masuk BOM mana pun) | PERLENGKAPAN_STOK (hanya Gudang; tidak jadi bahan BOM Produksi). Jasa/non-stok ditolak dengan arahan.
import { MaterialUnit } from "@prisma/client";
import { Decimal } from "./money.js";
import { lockRowForUpdate } from "../inventoryLedger.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../../lib/activityLog.js";

export class SkuError extends Error {
  constructor(message, statusCode = 400, code = null, extra = null) { super(message); this.name = "SkuError"; this.statusCode = statusCode; if (code) this.code = code; if (extra) this.extra = extra; }
}
const gagal = (m, s = 400, c = null, e = null) => new SkuError(m, s, c, e);

export const JENIS_SKU = Object.freeze({
  BAHAN_PRODUKSI: { label: "Bahan Produksi", category: "RAW_MATERIAL" },
  PERLENGKAPAN_STOK: { label: "Perlengkapan Stok", category: "CONSUMABLE" },
});
export const SATUAN_VALID = Object.values(MaterialUnit);
const JENIS_NON_STOK = /^(JASA|NON_?STOK|BIAYA|LAYANAN)/i;
export const PESAN_NON_STOK = "Jasa dan barang non-stok tidak dibuat sebagai SKU. Catat lewat Pengeluaran, Pengajuan Biaya, atau Tagihan Supplier.";

// ── Normalisasi & kemiripan ──────────────────────────────────────────────────────────────────────────

/** Nama untuk perbandingan: huruf kecil, tanpa aksen/tanda baca, "×" dan "x" di antara angka disamakan, spasi dirapatkan. */
export function normalisasiNama(teks) {
  return String(teks ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/(\d)\s*[×x*]\s*(?=\d)/g, "$1x")
    .replace(/[^a-z0-9]+/g, " ")
    .trim().replace(/\s+/g, " ");
}
const token = (n) => new Set(normalisasiNama(n).split(" ").filter((t) => t.length > 1 || /\d/.test(t)));
function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let irisan = 0; for (const t of a) if (b.has(t)) irisan += 1;
  return irisan / (a.size + b.size - irisan);
}

/** Cari material yang sama persis / mirip. Dibaca di dalam transaksi pemanggil (di bawah lock nama) supaya pembuatan paralel melihat hasil satu sama lain. */
export async function cariKandidat(db, { nama, kategori = null, satuanStok, spesifikasi = null, kodeSupplier = null, supplierId = null }) {
  const norm = normalisasiNama(nama);
  const tokens = token(nama);
  const semua = await db.material.findMany({ select: { id: true, code: true, name: true, unit: true, category: true, itemGroup: true, active: true, specification: true, kind: true } });
  const pasti = []; const mirip = [];
  const spekNorm = normalisasiNama(spesifikasi);
  for (const m of semua) {
    const nm = normalisasiNama(m.name);
    const info = { materialId: m.id, kode: m.code, nama: m.name, satuan: m.unit, kategori: m.itemGroup ?? null, aktif: m.active, spesifikasi: m.specification ?? null };
    if (nm === norm && m.unit === satuanStok) { pasti.push({ ...info, alasan: "Nama dan satuan stok sama persis" }); continue; }
    const sim = jaccard(tokens, token(m.name));
    const memuat = norm.length >= 4 && nm.length >= 4 && (nm.includes(norm) || norm.includes(nm));
    const spekSama = !!spekNorm && !!m.specification && normalisasiNama(m.specification) === spekNorm;
    const kategoriSama = !!kategori && !!m.itemGroup && normalisasiNama(m.itemGroup) === normalisasiNama(kategori);
    if (nm === norm) mirip.push({ ...info, alasan: `Nama sama tetapi satuan stok berbeda (${m.unit})` });
    else if (sim >= 0.6 || (memuat && (m.unit === satuanStok || kategoriSama)) || (spekSama && sim >= 0.34)) {
      mirip.push({ ...info, alasan: spekSama ? "Spesifikasi sama dan nama mirip" : `Nama mirip (${Math.round(sim * 100)}%)${kategoriSama ? ", kategori sama" : ""}${m.unit === satuanStok ? ", satuan sama" : ""}` });
    }
  }
  // Kode barang supplier yang sama pada supplier yang sama = barang yang sama.
  if (kodeSupplier && supplierId) {
    const kat = await db.finSupplierMaterial.findMany({ where: { supplierId, supplierSku: { equals: String(kodeSupplier).trim(), mode: "insensitive" } }, include: { material: { select: { id: true, code: true, name: true, unit: true, itemGroup: true, active: true, specification: true } } } });
    for (const k of kat) if (!pasti.some((p) => p.materialId === k.materialId)) pasti.push({ materialId: k.material.id, kode: k.material.code, nama: k.material.name, satuan: k.material.unit, kategori: k.material.itemGroup ?? null, aktif: k.material.active, spesifikasi: k.material.specification ?? null, alasan: "Kode barang supplier yang sama sudah ada di Katalog Supplier ini" });
  }
  const urut = (a, b) => a.kode.localeCompare(b.kode);
  return { pasti: pasti.sort(urut).slice(0, 10), mirip: mirip.filter((m) => !pasti.some((p) => p.materialId === m.materialId)).sort(urut).slice(0, 10) };
}

// ── Kode SKU ─────────────────────────────────────────────────────────────────────────────────────────

/** Tiga huruf prefix dari kata pertama nama (huruf saja, tanpa aksen); kurang dari tiga → ambil dari kata berikutnya; kosong → "BRG". */
export function prefixDariNama(nama) {
  const huruf = normalisasiNama(nama).replace(/[^a-z ]/g, "").split(" ").filter(Boolean).join("");
  const p = huruf.slice(0, 3).toUpperCase();
  return p.length === 3 ? p : (p + "XXX").slice(0, 3) === "XXX" ? "BRG" : (p + "XXX").slice(0, 3);
}

/**
 * Kode berikutnya untuk prefix: max(angka urut yang ada pada PREFIX-NNN) + 1, tiga digit minimal. Dipanggil DI DALAM transaksi: advisory lock per prefix menyerialkan pembuatan paralel;
 * unique(materials.code) tetap penjaga terakhir. Replay (Idempotency-Key) tidak sampai ke sini — respons pertama diputar ulang.
 */
export async function buatKodeSku(tx, nama) {
  const prefix = prefixDariNama(nama);
  await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))::text AS k", `sku-kode:${prefix}`);
  const baris = await tx.material.findMany({ where: { code: { startsWith: `${prefix}-` } }, select: { code: true } });
  let maks = 0;
  for (const b of baris) { const m = /^[A-Z]{3}-(\d{3,})$/.exec(b.code); if (m) maks = Math.max(maks, Number(m[1])); }
  return `${prefix}-${String(maks + 1).padStart(3, "0")}`;
}

// ── Validasi masukan material baru ───────────────────────────────────────────────────────────────────

const teks = (v, maks, nama, { wajib = false } = {}) => {
  const t = String(v ?? "").trim();
  if (!t) { if (wajib) throw gagal(`${nama} wajib diisi`); return null; }
  if (t.length > maks) throw gagal(`${nama} maksimal ${maks} karakter`);
  return t;
};

/** Faktor konversi: sama satuan → 1; beda → wajib positif, ≤4 desimal, ≤ 1.000.000. Mengembalikan Decimal. */
export function validasiFaktor(satuanBeli, satuanStok, faktor) {
  if (satuanBeli === satuanStok) return new Decimal(1);
  if (faktor === undefined || faktor === null || faktor === "") throw gagal(`Faktor konversi wajib diisi: 1 ${satuanBeli} = berapa ${satuanStok}`, 400, "FAKTOR_WAJIB");
  let f;
  try { f = new Decimal(String(faktor)); } catch { throw gagal("Faktor konversi bukan angka yang sah", 400, "FAKTOR_TIDAK_VALID"); }
  if (!f.isFinite() || f.lessThanOrEqualTo(0)) throw gagal("Faktor konversi harus lebih dari 0", 400, "FAKTOR_TIDAK_VALID");
  if (f.decimalPlaces() > 4) throw gagal("Faktor konversi maksimal 4 angka di belakang koma", 400, "FAKTOR_TIDAK_VALID");
  if (f.greaterThan(1_000_000)) throw gagal("Faktor konversi terlalu besar", 400, "FAKTOR_TIDAK_VALID");
  return f;
}

/** Jumlah stok = jumlah beli × faktor; harus muat di presisi ledger (4 desimal) dan harga per satuan stok minimal Rp1. */
export function periksaKonversiBaris({ qty, faktor, hargaBeli }) {
  const f = new Decimal(String(faktor));
  const stok = new Decimal(String(qty)).times(f);
  if (stok.decimalPlaces() > 4) throw gagal(`Jumlah × faktor konversi (${stok.toString()}) melebihi presisi stok (maksimal 4 angka di belakang koma). Ubah jumlah atau faktor.`, 400, "PRESISI_STOK");
  if (hargaBeli != null && new Decimal(String(hargaBeli)).dividedBy(f).lessThan(1)) throw gagal("Harga per satuan stok (harga beli ÷ faktor) kurang dari Rp1 — periksa faktor konversi atau harga.", 400, "HARGA_STOK_TERLALU_KECIL");
  return stok;
}

export function validasiMaterialBaru(b, { adaSupplier = true } = {}) {
  if (!b || typeof b !== "object") throw gagal("Data barang baru tidak valid");
  if (JENIS_NON_STOK.test(String(b.jenis ?? ""))) throw gagal(PESAN_NON_STOK, 400, "BUKAN_BARANG_STOK");
  const jenis = String(b.jenis ?? "");
  if (!Object.hasOwn(JENIS_SKU, jenis)) throw gagal("Jenis barang wajib dipilih: Bahan Produksi atau Perlengkapan Stok", 400, "JENIS_WAJIB");
  const nama = teks(b.nama, 200, "Nama barang", { wajib: true });
  if (normalisasiNama(nama).length < 2) throw gagal("Nama barang terlalu pendek");
  const kategori = teks(b.kategori, 80, "Kategori", { wajib: true });
  const satuanStok = String(b.satuanStok ?? "");
  if (!SATUAN_VALID.includes(satuanStok)) throw gagal("Satuan stok tidak valid", 400, "SATUAN_TIDAK_VALID");
  const satuanBeli = String(b.satuanBeli || satuanStok);
  if (!SATUAN_VALID.includes(satuanBeli)) throw gagal("Satuan pembelian tidak valid", 400, "SATUAN_TIDAK_VALID");
  const faktor = validasiFaktor(satuanBeli, satuanStok, b.faktorKonversi);
  let moq = null;
  if (b.moq !== undefined && b.moq !== null && b.moq !== "") { moq = new Decimal(String(b.moq)); if (!moq.isFinite() || moq.lessThanOrEqualTo(0) || moq.decimalPlaces() > 3) throw gagal("MOQ harus lebih dari 0 (maksimal 3 angka di belakang koma)"); }
  let leadTimeDays = null;
  if (b.estimasiKirimHari !== undefined && b.estimasiKirimHari !== null && b.estimasiKirimHari !== "") { leadTimeDays = Number(b.estimasiKirimHari); if (!Number.isInteger(leadTimeDays) || leadTimeDays < 0 || leadTimeDays > 365) throw gagal("Estimasi waktu kirim harus bilangan bulat 0–365 hari"); }
  void adaSupplier;
  return {
    jenis, nama, kategori, satuanStok, satuanBeli, faktor, moq, leadTimeDays,
    spesifikasi: teks(b.spesifikasi, 500, "Spesifikasi"), namaSupplier: teks(b.namaSupplier, 200, "Nama barang versi supplier"), kodeSupplier: teks(b.kodeSupplier, 100, "Kode barang supplier"),
    lokasi: teks(b.lokasi, 200, "Lokasi penyimpanan"), catatan: teks(b.catatan, 500, "Catatan"),
    konfirmasiMirip: b.konfirmasiMirip === true, alasanMirip: teks(b.alasanMirip, 300, "Alasan melanjutkan barang mirip"),
  };
}

// ── Pembuatan di dalam transaksi PO ──────────────────────────────────────────────────────────────────

/**
 * Buat SKU + asal SKU (audit) di dalam transaksi pemanggil. Menolak duplikat pasti; mirip butuh konfirmasi + alasan. Mengembalikan { material, masukan }.
 * `po` boleh null saat pratinjau — PO pertama diisi setelah PO tersimpan lewat `tautkanPoPertama`.
 */
export async function buatSkuBaru(tx, { data, supplier, userId }) {
  const m = validasiMaterialBaru(data);
  // Serialkan pembuat dengan nama yang sama: dua permintaan paralel berurutan sehingga yang kedua melihat SKU pertama sebagai duplikat pasti.
  await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))::text AS k", `sku-nama:${normalisasiNama(m.nama)}`);
  const { pasti, mirip } = await cariKandidat(tx, { nama: m.nama, kategori: m.kategori, satuanStok: m.satuanStok, spesifikasi: m.spesifikasi, kodeSupplier: m.kodeSupplier, supplierId: supplier.id });
  if (pasti.length > 0) {
    throw gagal(`Barang ini sudah ada di master material (${pasti[0].kode} — ${pasti[0].nama}). Pilih material yang ada, jangan buat SKU baru.`, 409, "SKU_DUPLIKAT_PASTI", { kandidat: pasti });
  }
  if (mirip.length > 0) {
    if (!m.konfirmasiMirip || !m.alasanMirip) {
      throw gagal(`Ada ${mirip.length} barang yang mirip (mis. ${mirip[0].kode} — ${mirip[0].nama}). Periksa dulu; bila memang barang berbeda, konfirmasi dan isi alasannya.`, 409, "SKU_MIRIP_BUTUH_KONFIRMASI", { kandidat: mirip });
    }
  }
  const kode = await buatKodeSku(tx, m.nama);
  const material = await tx.material.create({
    data: {
      code: kode, name: m.nama, unit: m.satuanStok, category: JENIS_SKU[m.jenis].category, kind: m.jenis, itemGroup: m.kategori,
      specification: m.spesifikasi, storageHint: m.lokasi, dataNote: m.catatan, vendor: supplier.name ?? null, active: true, createdVia: "PO", createdById: userId ?? null,
    },
  });
  await tx.finMaterialSkuOrigin.create({
    data: {
      materialId: material.id, createdById: userId ?? null, firstSupplierId: supplier.id, normalizedName: normalisasiNama(m.nama),
      initialData: { nama: m.nama, jenis: m.jenis, kategori: m.kategori, spesifikasi: m.spesifikasi, satuanStok: m.satuanStok, satuanBeli: m.satuanBeli, faktorKonversi: m.faktor.toString(), namaSupplier: m.namaSupplier, kodeSupplier: m.kodeSupplier, moq: m.moq?.toString() ?? null, estimasiKirimHari: m.leadTimeDays, lokasi: m.lokasi, catatan: m.catatan },
      duplicateCandidates: mirip.length ? mirip : null, duplicateOverrideReason: mirip.length ? m.alasanMirip : null,
    },
  });
  await recordActivity(tx, {
    entityType: ENTITY_TYPES.MATERIAL, entityId: material.id, eventType: EVENT_TYPES.MATERIAL_UPDATED, actorId: userId ?? null,
    metadata: { aksi: "sku_dibuat_dari_po", code: kode, nama: m.nama, jenis: m.jenis, supplier: supplier.name, ...(mirip.length && { overrideMirip: m.alasanMirip }) },
  });
  return { material, masukan: m };
}

/** Isi PO pertama pada asal SKU setelah PO tersimpan (hanya bila belum terisi). */
export async function tautkanPoPertama(tx, { materialId, purchaseOrderId }) {
  await tx.finMaterialSkuOrigin.updateMany({ where: { materialId, firstPurchaseOrderId: null }, data: { firstPurchaseOrderId: purchaseOrderId } });
}

// ── Katalog Supplier ─────────────────────────────────────────────────────────────────────────────────

/** Buat/perbarui relasi supplier ↔ material. Satu relasi per (supplier, material) — tidak pernah ganda. Mengembalikan baris katalog. */
export async function pastikanKatalog(tx, { supplierId, materialId, data, userId }) {
  const ada = await tx.finSupplierMaterial.findUnique({ where: { supplierId_materialId: { supplierId, materialId } } });
  const isi = {
    supplierItemName: data.namaSupplier ?? ada?.supplierItemName ?? null, supplierSku: data.kodeSupplier ?? ada?.supplierSku ?? null,
    purchaseUnit: data.satuanBeli ?? ada?.purchaseUnit, conversionFactor: data.faktor ?? ada?.conversionFactor ?? 1,
    moq: data.moq ?? ada?.moq ?? null, leadTimeDays: data.leadTimeDays ?? ada?.leadTimeDays ?? null,
  };
  if (!ada) return tx.finSupplierMaterial.create({ data: { supplierId, materialId, ...isi, active: true, createdById: userId ?? null, updatedById: userId ?? null } });
  const berubah = ["supplierItemName", "supplierSku", "purchaseUnit", "moq", "leadTimeDays"].some((k) => String(isi[k] ?? "") !== String(ada[k] ?? "")) || !new Decimal(String(isi.conversionFactor)).equals(new Decimal(String(ada.conversionFactor)));
  if (!berubah) return ada;
  return tx.finSupplierMaterial.update({ where: { id: ada.id }, data: { ...isi, active: true, updatedById: userId ?? null } });
}

/** Harga terakhir katalog = INFORMASI saja; dipanggil saat PO disetujui. Tidak menyentuh PO, stok, atau biaya mana pun. */
export async function catatHargaTerakhir(tx, { purchaseOrderId, tanggal, userId }) {
  const baris = await tx.finPurchaseOrderLine.findMany({ where: { purchaseOrderId, supplierMaterialId: { not: null } }, select: { supplierMaterialId: true, unitPrice: true } });
  for (const b of baris) await tx.finSupplierMaterial.update({ where: { id: b.supplierMaterialId }, data: { lastPrice: b.unitPrice, lastPriceAt: tanggal, updatedById: userId ?? null } });
}

// ── Perbaikan SKU (admin) ────────────────────────────────────────────────────────────────────────────

/**
 * Perbaiki SKU. Sebelum ada pergerakan stok / penerimaan: nama, kategori, spesifikasi, lokasi, catatan, dan satuan stok (hanya bila belum dipakai PO selain draf).
 * Sesudah ada pergerakan: kode dan satuan stok TERKUNCI; nama/spesifikasi boleh diperbaiki (alasan wajib) selama makna barang tidak berubah. Tidak pernah menghapus.
 * Kesalahan fundamental → nonaktifkan SKU dan buat SKU baru.
 */
export async function perbaikiSku(tx, { materialId, body, userId }) {
  await lockRowForUpdate(tx, "materials", materialId);
  const m = await tx.material.findUnique({ where: { id: materialId } });
  if (!m) throw gagal("Material tidak ditemukan", 404);
  if (m.createdVia !== "PO") throw gagal("Hanya SKU yang dibuat dari PO yang bisa diperbaiki lewat jalur ini. Material lain diubah lewat Master Material Gudang.", 409, "BUKAN_SKU_PO");
  const b = body ?? {};
  const alasan = teks(b.alasan, 300, "Alasan");
  const bergerak = (await tx.stockMovement.count({ where: { materialId } })) > 0 || (await tx.goodsReceiptLine.count({ where: { materialId } })) > 0;
  if (b.code !== undefined && b.code !== m.code) throw gagal("Kode SKU tidak bisa diubah", 409, "KODE_TERKUNCI");
  const data = {}; const perubahan = {};
  const set = (k, v) => { if ((v ?? null) !== (m[k] ?? null)) { data[k] = v; perubahan[k] = { dari: m[k] ?? null, ke: v ?? null }; } };
  if (b.nama !== undefined) { const n = teks(b.nama, 200, "Nama barang", { wajib: true }); if (n !== m.name) { if (bergerak && !alasan) throw gagal("Alasan wajib saat memperbaiki nama barang yang sudah pernah dipakai", 400, "ALASAN_WAJIB"); data.name = n; perubahan.name = { dari: m.name, ke: n }; } }
  if (b.kategori !== undefined) set("itemGroup", teks(b.kategori, 80, "Kategori", { wajib: true }));
  if (b.spesifikasi !== undefined) { const v = teks(b.spesifikasi, 500, "Spesifikasi"); if ((v ?? null) !== (m.specification ?? null)) { if (bergerak && !alasan) throw gagal("Alasan wajib saat memperbaiki spesifikasi barang yang sudah pernah dipakai", 400, "ALASAN_WAJIB"); data.specification = v; perubahan.specification = { dari: m.specification ?? null, ke: v }; } }
  if (b.lokasi !== undefined) set("storageHint", teks(b.lokasi, 200, "Lokasi penyimpanan"));
  if (b.catatan !== undefined) set("dataNote", teks(b.catatan, 500, "Catatan"));
  if (typeof b.active === "boolean" && b.active !== m.active) { data.active = b.active; perubahan.active = { dari: m.active, ke: b.active }; }
  if (b.satuanStok !== undefined && b.satuanStok !== m.unit) {
    if (bergerak) throw gagal("Satuan stok terkunci karena SKU ini sudah punya pergerakan/penerimaan. Nonaktifkan SKU ini dan buat SKU baru bila satuannya salah.", 409, "SATUAN_TERKUNCI");
    if (!SATUAN_VALID.includes(b.satuanStok)) throw gagal("Satuan stok tidak valid");
    const dipakai = await tx.finPurchaseOrderLine.count({ where: { materialId, purchaseOrder: { status: { not: "DRAFT" } } } });
    if (dipakai > 0) throw gagal("Satuan stok tidak bisa diubah: SKU ini sudah dipakai pada PO yang disetujui.", 409, "SATUAN_TERKUNCI");
    const konversi = await tx.finPurchaseOrderLine.count({ where: { materialId, purchaseUnit: { not: null } } });
    if (konversi > 0) throw gagal("Satuan stok tidak bisa diubah: ada baris PO berkonversi satuan. Hapus/ubah barisnya dulu.", 409, "SATUAN_TERKUNCI");
    data.unit = b.satuanStok; perubahan.unit = { dari: m.unit, ke: b.satuanStok };
    await tx.finPurchaseOrderLine.updateMany({ where: { materialId, purchaseUnit: null }, data: { unit: b.satuanStok } });
  }
  if (Object.keys(data).length === 0) throw gagal("Tidak ada perubahan yang dikirim", 400, "TANPA_PERUBAHAN");
  const baru = await tx.material.update({ where: { id: materialId }, data });
  await recordActivity(tx, { entityType: ENTITY_TYPES.MATERIAL, entityId: materialId, eventType: EVENT_TYPES.MATERIAL_UPDATED, actorId: userId ?? null, metadata: { aksi: "sku_diperbaiki", code: m.code, sudahBergerak: bergerak, alasan, changes: perubahan } });
  return baru;
}

// ── Baca: pratinjau duplikat, katalog supplier, asal SKU ─────────────────────────────────────────────

/** Pratinjau sebelum Simpan PO (tanpa menulis apa pun): kandidat pasti/mirip + kode berikutnya yang kemungkinan dipakai (INFORMASI — kode final dibuat server saat PO tersimpan). */
export async function pratinjauDuplikat(db, { supplierId, materialBaru }) {
  const b = materialBaru ?? {};
  if (JENIS_NON_STOK.test(String(b.jenis ?? ""))) throw gagal(PESAN_NON_STOK, 400, "BUKAN_BARANG_STOK");
  const nama = teks(b.nama, 200, "Nama barang", { wajib: true });
  const satuanStok = String(b.satuanStok ?? "");
  if (!SATUAN_VALID.includes(satuanStok)) throw gagal("Satuan stok tidak valid", 400, "SATUAN_TIDAK_VALID");
  const { pasti, mirip } = await cariKandidat(db, { nama, kategori: teks(b.kategori, 80, "Kategori"), satuanStok, spesifikasi: teks(b.spesifikasi, 500, "Spesifikasi"), kodeSupplier: teks(b.kodeSupplier, 100, "Kode barang supplier"), supplierId: supplierId || null });
  return { pasti, mirip, prefixKode: prefixDariNama(nama), bolehLanjut: pasti.length === 0, perluKonfirmasi: pasti.length === 0 && mirip.length > 0 };
}

const bentukKatalog = (r) => ({
  id: r.id, supplierId: r.supplierId, supplier: r.supplier ? { id: r.supplier.id, code: r.supplier.code, name: r.supplier.name } : undefined,
  materialId: r.materialId, material: r.material ? { id: r.material.id, kode: r.material.code, nama: r.material.name, satuanStok: r.material.unit, jenis: r.material.kind ?? null } : undefined,
  namaSupplier: r.supplierItemName, kodeSupplier: r.supplierSku, satuanBeli: r.purchaseUnit, faktorKonversi: Number(r.conversionFactor),
  moq: r.moq == null ? null : Number(r.moq), estimasiKirimHari: r.leadTimeDays,
  hargaTerakhir: r.lastPrice, tanggalHargaTerakhir: r.lastPriceAt, aktif: r.active, dibuatPada: r.createdAt, diubahPada: r.updatedAt,
});

/** Katalog Supplier (baca). Filter: supplierId / materialId / q (nama, kode, nama versi supplier). `harga:false` membuang harga terakhir. */
export async function daftarKatalog(db, { supplierId, materialId, q, aktif, harga = true } = {}) {
  const where = {
    ...(supplierId && { supplierId }), ...(materialId && { materialId }),
    ...(aktif === "true" && { active: true }), ...(aktif === "false" && { active: false }),
    ...(q && { OR: [
      { supplierItemName: { contains: String(q), mode: "insensitive" } }, { supplierSku: { contains: String(q), mode: "insensitive" } },
      { material: { name: { contains: String(q), mode: "insensitive" } } }, { material: { code: { contains: String(q), mode: "insensitive" } } },
    ] }),
  };
  const baris = await db.finSupplierMaterial.findMany({
    where, orderBy: [{ updatedAt: "desc" }], take: 300,
    include: { supplier: { select: { id: true, code: true, name: true } }, material: { select: { id: true, code: true, name: true, unit: true, kind: true } } },
  });
  return baris.map((r) => { const o = bentukKatalog(r); if (!harga) { o.hargaTerakhir = null; o.tanggalHargaTerakhir = null; } return o; });
}

/** Asal + status kunci SKU (untuk layar detail): siapa/kapan/PO & supplier pertama, data awal, alasan override duplikat, dan apakah sudah ada pergerakan. */
export async function bacaAsalSku(db, materialId) {
  const m = await db.material.findUnique({ where: { id: materialId }, include: { skuOrigin: true } });
  if (!m) return null;
  const [pergerakan, penerimaan, katalog] = await Promise.all([
    db.stockMovement.count({ where: { materialId } }), db.goodsReceiptLine.count({ where: { materialId } }),
    db.finSupplierMaterial.findMany({ where: { materialId }, include: { supplier: { select: { id: true, code: true, name: true } }, material: { select: { id: true, code: true, name: true, unit: true, kind: true } } } }),
  ]);
  const o = m.skuOrigin;
  const [po, sup, dibuatOleh] = o ? await Promise.all([
    o.firstPurchaseOrderId ? db.finPurchaseOrder.findUnique({ where: { id: o.firstPurchaseOrderId }, select: { id: true, poNumber: true } }) : null,
    o.firstSupplierId ? db.finSupplier.findUnique({ where: { id: o.firstSupplierId }, select: { id: true, code: true, name: true } }) : null,
    o.createdById ? db.user.findUnique({ where: { id: o.createdById }, select: { id: true, name: true } }) : null,
  ]) : [null, null, null];
  return {
    materialId: m.id, kode: m.code, nama: m.name, satuanStok: m.unit, jenis: m.kind, kategori: m.itemGroup, spesifikasi: m.specification, lokasi: m.storageHint, aktif: m.active,
    dibuatLewatPO: m.createdVia === "PO",
    terkunci: { kode: true, satuanStok: pergerakan + penerimaan > 0, alasan: pergerakan + penerimaan > 0 ? "SKU ini sudah punya pergerakan/penerimaan stok: kode dan satuan stok dikunci." : null },
    sudahBergerak: pergerakan + penerimaan > 0,
    asal: o && { dibuatPada: o.createdAt, dibuatOleh, poPertama: po, supplierPertama: sup, dataAwal: o.initialData, kandidatMirip: o.duplicateCandidates, alasanOverrideDuplikat: o.duplicateOverrideReason },
    katalogSupplier: katalog.map(bentukKatalog),
  };
}
