// PENUTUPAN STOK PERIODIK & PERSEDIAAN AWAL PERPETUAL (B3.6)
//
// Sampai hari sebelum tanggal cutover (default 30 Sep 2026) bahan baku dibukukan PERIODIK: tagihan bahan baku tanpa penerimaan
// Gudang mendebet 5-1100 dan Persediaan 1-1400 tidak dijurnal per tagihan. Mulai tanggal cutover (default 1 Okt 2026) PERPETUAL:
// penerimaan Gudang Dr 1-1400 / Cr 2-1150, pemakaian Dr 5-1100 / Cr 1-1400, tagihan Dr 2-1150 ± selisih / Cr 2-1100.
// Jembatan keduanya = SATU jurnal PERSEDIAAN_AWAL bertanggal hari sebelum cutover:
//
//     Dr 1-1400 Persediaan Bahan Baku        (nilai stok fisik hasil opname − saldo 1-1400 buku s.d. tanggal itu)
//         Cr 5-1100 Beban Bahan Baku / Pemakaian Bahan
//
// (arah dibalik bila saldo buku lebih besar dari stok fisik). Dengan begitu saldo 1-1400 per akhir hari sebelum cutover = PERSIS
// nilai stok fisik, apa pun yang sudah terjurnal sebelumnya — tidak ada persediaan ganda walau ada penerimaan Gudang yang sudah
// dijurnal sebelum cutover.
//
// Aturan yang TIDAK boleh dilanggar:
//  1. Harga per unit TIDAK PERNAH diambil otomatis dari Material.referenceUnitCost (snapshot impor Agustus). Harga referensi
//     hanya dipakai sebagai PEMBANDING untuk mendeteksi harga tidak wajar.
//  2. Snapshot immutable di luar DRAFT (trigger DB), dan jurnal hanya diposting SEKALI (advisory lock + row lock + idempotency
//     key + partial unique index satu DIPOSTING per tanggal cutover). Koreksi = pembalikan resmi, tidak pernah edit/hapus.
//  3. Setelah jurnal pembuka diposting, tanggal/metode cutover terkunci (settings.js) dan pergerakan Gudang bertanggal sebelum
//     cutover tidak dijurnal lagi — nilainya sudah tercakup stok opname.

import crypto from "node:crypto";
import { postJournal, reverseJournal, generateDocumentNumber, toBookDate, findEntryByKey, STATUS_DIHITUNG } from "./journal.js";
import { resolveAccount, SYSTEM_KEYS } from "./accounts.js";
import { toMoney, sumMoney, ZERO } from "./money.js";
import { ambilKebijakanPersediaan, tanggalIndonesia } from "./inventoryMethod.js";
import { lockRowForUpdate } from "../inventoryLedger.js";

export class PersediaanError extends Error {
  constructor(message, statusCode = 400, code = null, detail = null) {
    super(message);
    this.name = "PersediaanError";
    this.statusCode = statusCode;
    if (code) this.code = code;
    if (detail) this.detail = detail;
  }
}

export const SUMBER_HARGA = Object.freeze({
  FAKTUR: "Faktur supplier",
  TAGIHAN: "Tagihan supplier di sistem",
  PEMBELIAN: "Pembelian di sistem",
  LAINNYA: "Lainnya (wajib keterangan)",
});

export const STATUS_LABEL = Object.freeze({
  DRAFT: "Draf", DIPERIKSA: "Sudah diperiksa", DIPOSTING: "Sudah diposting", DIBALIK: "Dibalik", DIBATALKAN: "Dibatalkan",
});

// Batas "harga tidak wajar": >5× atau <1/5 harga referensi, atau nilai satu baris > Rp50 jt. Baris seperti itu memblokir
// snapshot sampai diberi penjelasan harga (≥ 10 karakter) — dan tetap tampil di laporan pengecualian.
export const AMBANG = Object.freeze({ rasioReferensi: 5, nilaiBarisMaks: 50_000_000, penjelasanMin: 10 });

const KUNCI_LOCK = "fin_inventory_opening";
const KEY = (openingId) => `PERSEDIAAN_AWAL:${openingId}`;

// ── tanggal (WIB) ──────────────────────────────────────────────────────────────────────────────────────────────────────
export const awalCutover = (kunci) => new Date(`${kunci}T00:00:00+07:00`);
export const kunciWIB = (t) => new Date(new Date(t).getTime() + 7 * 3600_000).toISOString().slice(0, 10);
export function hariSebelum(kunci) {
  const d = new Date(`${kunci}T00:00:00Z`);
  return new Date(d.getTime() - 86400_000).toISOString().slice(0, 10);
}
const kunciDariKolomDate = (d) => new Date(d).toISOString().slice(0, 10);

// ── status kebijakan ───────────────────────────────────────────────────────────────────────────────────────────────────

/** Snapshot yang SUDAH diposting (aktif) untuk sebuah tanggal cutover (default: dari pengaturan), atau null. */
export async function pembukaAktif(db, cutover = undefined) {
  let kunci = cutover;
  if (kunci === undefined) kunci = (await ambilKebijakanPersediaan(db)).cutover;
  if (!kunci) return null;
  return db.finInventoryOpening.findFirst({
    where: { status: "DIPOSTING", cutoverDate: new Date(`${kunci}T00:00:00Z`) },
    select: { id: true, number: true, cutoverDate: true, countedAt: true, journalEntryId: true, totalValue: true },
  });
}

/**
 * Keputusan untuk satu pergerakan/penerimaan Gudang bertanggal `tanggal`:
 *   "biasa"          — tidak ada cutover; jurnal seperti biasa
 *   "sebelum"        — sebelum cutover & pembuka belum diposting → jurnal seperti biasa (nanti disetarakan jurnal pembuka)
 *   "tertutup"       — sebelum cutover & pembuka SUDAH diposting → JANGAN dijurnal (sudah tercakup stok opname)
 *   "perpetual"      — mulai cutover & pembuka sudah diposting → jurnal perpetual
 *   "tunggu_pembuka" — mulai cutover tetapi pembuka BELUM diposting → jangan kredit 1-1400 (jadi negatif), catat gap
 */
export async function statusCutoverUntuk(tx, tanggal) {
  const k = await ambilKebijakanPersediaan(tx);
  if (!k.cutover) return { status: "biasa", kebijakan: k, aktif: null };
  const aktif = await pembukaAktif(tx, k.cutover);
  const t = kunciWIB(tanggal);
  if (t < k.cutover) return { status: aktif ? "tertutup" : "sebelum", kebijakan: k, aktif };
  return { status: aktif ? "perpetual" : "tunggu_pembuka", kebijakan: k, aktif };
}

// ── baris & validasi ───────────────────────────────────────────────────────────────────────────────────────────────────

const angka = (v) => {
  if (v === null || v === undefined || String(v).trim() === "") return NaN;
  // terima "1.234,5" (format Indonesia) maupun "1234.5"
  const s = String(v).trim().replace(/\s/g, "");
  const norm = /,\d{1,4}$/.test(s) ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  return Number(norm);
};

export function hashIsi(lines) {
  const baris = [...lines]
    .map((l) => [l.materialId, toMoney(l.qty).toFixed(4), l.unit, toMoney(l.unitCost).toFixed(2), toMoney(l.value).toFixed(2), l.priceSource, l.priceReference || "", l.priceNote || ""].join("|"))
    .sort();
  return crypto.createHash("sha256").update(baris.join("\n")).digest("hex");
}

async function qtySistem(db, materialIds, sampai) {
  if (materialIds.length === 0) return new Map();
  const g = await db.stockMovement.groupBy({
    by: ["materialId"], where: { materialId: { in: materialIds }, createdAt: { lte: sampai } }, _sum: { qty: true },
  });
  return new Map(g.map((r) => [r.materialId, toMoney(r._sum.qty || 0)]));
}

/** Blocker (menghalangi pemeriksaan & posting) dan peringatan (ditampilkan, tidak menghalangi). Murni baca. */
export async function validasiSnapshot(db, opening, lines) {
  const blocker = [];
  const peringatan = [];
  const k = await ambilKebijakanPersediaan(db);
  const cutover = kunciDariKolomDate(opening.cutoverDate);

  if (!k.cutover) blocker.push({ kode: "CUTOVER_TIDAK_ADA", pesan: "Tanggal cutover persediaan belum diatur di Pengaturan Finance." });
  else if (k.cutover !== cutover) {
    blocker.push({ kode: "CUTOVER_BERBEDA", pesan: `Snapshot ini untuk cutover ${tanggalIndonesia(cutover)}, sedangkan pengaturan sekarang ${tanggalIndonesia(k.cutover)}. Buat snapshot baru.` });
  }
  if (lines.length === 0) blocker.push({ kode: "KOSONG", pesan: "Snapshot belum berisi baris stok." });

  const perMaterial = new Map();
  for (const l of lines) perMaterial.set(l.materialId, (perMaterial.get(l.materialId) || 0) + 1);

  for (const l of lines) {
    const m = l.material || {};
    const ref = { kode: m.code, nama: m.name };
    const qty = toMoney(l.qty);
    const harga = toMoney(l.unitCost);
    const nilai = toMoney(l.value);
    if ((perMaterial.get(l.materialId) || 0) > 1) blocker.push({ ...ref, kode: "MATERIAL_DUPLIKAT", pesan: `${m.code} tercatat lebih dari sekali.` });
    if (qty.lessThan(0)) blocker.push({ ...ref, kode: "QTY_NEGATIF", pesan: `${m.code}: kuantitas fisik negatif.` });
    if (qty.greaterThan(0) && !harga.greaterThan(0)) blocker.push({ ...ref, kode: "HARGA_NOL", pesan: `${m.code}: harga per unit nol/kosong.` });
    if (m.unit && l.unit !== m.unit) blocker.push({ ...ref, kode: "SATUAN_BEDA", pesan: `${m.code}: satuan hitung ${l.unit} tidak sama dengan satuan material ${m.unit}.` });
    if (!SUMBER_HARGA[l.priceSource]) blocker.push({ ...ref, kode: "SUMBER_HARGA_KOSONG", pesan: `${m.code}: sumber harga wajib dipilih (Faktur/Tagihan/Pembelian/Lainnya).` });
    else if (l.priceSource === "LAINNYA" ? !(l.priceNote || "").trim() : !(l.priceReference || "").trim()) {
      blocker.push({ ...ref, kode: "SUMBER_HARGA_KOSONG", pesan: l.priceSource === "LAINNYA" ? `${m.code}: sumber harga "Lainnya" wajib diberi keterangan.` : `${m.code}: nomor dokumen harga (faktur/tagihan/pembelian) wajib diisi.` });
    }
    const refCost = m.referenceUnitCost ? toMoney(m.referenceUnitCost) : null;
    const tidakWajar = [];
    if (refCost && refCost.greaterThan(0) && harga.greaterThan(0)) {
      if (harga.greaterThan(refCost.times(AMBANG.rasioReferensi))) tidakWajar.push(`lebih dari ${AMBANG.rasioReferensi}× harga referensi`);
      if (harga.times(AMBANG.rasioReferensi).lessThan(refCost)) tidakWajar.push(`kurang dari 1/${AMBANG.rasioReferensi} harga referensi`);
    }
    if (nilai.greaterThan(AMBANG.nilaiBarisMaks)) tidakWajar.push(`nilai satu baris di atas Rp${(AMBANG.nilaiBarisMaks / 1e6).toFixed(0)} jt`);
    if (tidakWajar.length > 0) {
      const dijelaskan = (l.priceNote || "").trim().length >= AMBANG.penjelasanMin;
      (dijelaskan ? peringatan : blocker).push({
        ...ref, kode: "HARGA_TIDAK_WAJAR",
        pesan: `${m.code}: harga ${tidakWajar.join(" dan ")}${dijelaskan ? " — sudah dijelaskan" : ". Periksa satuan/harga, atau tulis penjelasan harga (min. 10 karakter)."}`,
      });
    }
    if (m.active === false) peringatan.push({ ...ref, kode: "MATERIAL_NONAKTIF", pesan: `${m.code} berstatus nonaktif di master material.` });
    if (qty.isZero()) peringatan.push({ ...ref, kode: "QTY_NOL", pesan: `${m.code}: kuantitas fisik 0 (tidak menambah nilai).` });
  }

  // Pembanding dengan stok sistem Gudang per waktu hitung (bukan blocker: stok sistem belum tentu benar — itu gunanya opname).
  const ids = lines.map((l) => l.materialId);
  const sistem = await qtySistem(db, ids, opening.countedAt);
  let selisihQty = 0;
  for (const l of lines) {
    const s = sistem.get(l.materialId) || ZERO;
    if (!s.equals(toMoney(l.qty))) selisihQty += 1;
  }
  if (selisihQty > 0) {
    peringatan.push({ kode: "SELISIH_SISTEM", pesan: `${selisihQty} material berbeda kuantitasnya dengan stok sistem Gudang per waktu hitung. Gudang perlu menyesuaikan stok sistem (stock opname) supaya pengeluaran bahan mulai cutover memakai kuantitas yang benar.` });
  }
  const sisaSistem = await db.stockMovement.groupBy({ by: ["materialId"], where: { createdAt: { lte: opening.countedAt } }, _sum: { qty: true } });
  const tidakDihitung = sisaSistem.filter((r) => toMoney(r._sum.qty || 0).greaterThan(0) && !perMaterial.has(r.materialId)).length;
  if (tidakDihitung > 0) peringatan.push({ kode: "MATERIAL_TIDAK_DIHITUNG", pesan: `${tidakDihitung} material punya stok sistem > 0 tetapi tidak ada di snapshot (dianggap stok fisik 0).` });

  const total = sumMoney(lines.map((l) => toMoney(l.value)));
  return { blocker, peringatan, ringkasan: { jumlahBaris: lines.length, totalNilai: total.toFixed(2) } };
}

// ── helper baca ────────────────────────────────────────────────────────────────────────────────────────────────────────

const PILIH_MATERIAL = { id: true, code: true, name: true, unit: true, active: true, referenceUnitCost: true };

async function ambil(tx, id, { kunci = false } = {}) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) throw new PersediaanError("Snapshot persediaan tidak ditemukan", 404);
  if (kunci) await lockRowForUpdate(tx, '"fin_inventory_openings"', id);
  const o = await tx.finInventoryOpening.findUnique({ where: { id } });
  if (!o) throw new PersediaanError("Snapshot persediaan tidak ditemukan", 404);
  return o;
}
async function barisDengan(tx, openingId) {
  return tx.finInventoryOpeningLine.findMany({ where: { openingId }, include: { material: { select: PILIH_MATERIAL } }, orderBy: { createdAt: "asc" } });
}

/** Saldo 1-1400 menurut buku s.d. tanggal buku (inklusif), menghitung jurnal POSTED dan REVERSED beserta pembaliknya. */
export async function saldoPersediaanSampai(db, tanggalKunci) {
  const akun = await resolveAccount(db, SYSTEM_KEYS.PERSEDIAAN_BAHAN);
  const agg = await db.finJournalLine.aggregate({
    where: { accountId: akun.id, entry: { status: { in: STATUS_DIHITUNG }, date: { lte: toBookDate(tanggalKunci) } } },
    _sum: { debit: true, credit: true },
  });
  return toMoney(agg._sum.debit || 0).minus(toMoney(agg._sum.credit || 0));
}

// ── alur ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

export async function buatDraf(tx, { userId, notes = null }) {
  const k = await ambilKebijakanPersediaan(tx);
  if (!k.cutover) throw new PersediaanError("Atur tanggal cutover persediaan dulu di Pengaturan Finance.", 422, "CUTOVER_TIDAK_ADA");
  if (await pembukaAktif(tx, k.cutover)) {
    throw new PersediaanError(`Persediaan awal untuk cutover ${tanggalIndonesia(k.cutover)} sudah diposting. Balik dulu jurnalnya bila perlu snapshot baru.`, 409, "SUDAH_ADA_PEMBUKA");
  }
  const cutoverDate = new Date(`${k.cutover}T00:00:00Z`);
  const number = await generateDocumentNumber(tx, "PSA", toBookDate(hariSebelum(k.cutover)));
  return tx.finInventoryOpening.create({
    data: { number, cutoverDate, countedAt: new Date(awalCutover(k.cutover).getTime() - 60_000), notes: notes?.trim() || null, createdById: userId },
  });
}

/**
 * Isi/ganti baris snapshot dari tabel (tempel CSV di layar). SEMUA baris divalidasi dulu; satu saja tidak bisa dibaca = tidak ada
 * yang disimpan. Kuantitas negatif & material duplikat ditolak di sini (bukan disimpan lalu ditandai).
 * rows: [{ kode, qty, satuan, harga, sumber, referensi?, penjelasanHarga?, catatan? }]
 */
export async function isiBaris(tx, { openingId, rows, mode = "ganti", userId }) {
  const o = await ambil(tx, openingId, { kunci: true });
  if (o.status !== "DRAFT") throw new PersediaanError(`Snapshot berstatus ${STATUS_LABEL[o.status]} — isinya terkunci. Buka kembali pemeriksaan dulu bila perlu diubah.`, 409, "SNAPSHOT_TERKUNCI");
  if (!Array.isArray(rows) || rows.length === 0) throw new PersediaanError("Tidak ada baris yang dikirim", 400);
  if (rows.length > 2000) throw new PersediaanError("Maksimal 2.000 baris per kiriman", 400);

  const kodeList = [...new Set(rows.map((r) => String(r.kode || "").trim().toUpperCase()).filter(Boolean))];
  const materials = await tx.material.findMany({ where: { code: { in: kodeList } }, select: PILIH_MATERIAL });
  const byCode = new Map(materials.map((m) => [m.code.toUpperCase(), m]));
  const sudahAda = mode === "tambah" ? new Set((await tx.finInventoryOpeningLine.findMany({ where: { openingId }, select: { materialId: true } })).map((l) => l.materialId)) : new Set();

  const galat = [];
  const siap = [];
  const dipakai = new Set();
  rows.forEach((r, i) => {
    const no = i + 1;
    const kode = String(r.kode || "").trim().toUpperCase();
    const m = byCode.get(kode);
    if (!kode) return galat.push({ baris: no, kode: "KODE_KOSONG", pesan: `Baris ${no}: kode material kosong.` });
    if (!m) return galat.push({ baris: no, kode: "KODE_TIDAK_DIKENAL", pesan: `Baris ${no}: kode material ${kode} tidak ada di master material.` });
    if (dipakai.has(m.id) || sudahAda.has(m.id)) return galat.push({ baris: no, kode: "MATERIAL_DUPLIKAT", pesan: `Baris ${no}: ${kode} sudah ada di snapshot — satu material satu baris.` });
    const qty = angka(r.qty);
    const harga = angka(r.harga);
    if (!Number.isFinite(qty)) return galat.push({ baris: no, kode: "QTY_TIDAK_VALID", pesan: `Baris ${no}: kuantitas ${kode} bukan angka.` });
    if (qty < 0) return galat.push({ baris: no, kode: "QTY_NEGATIF", pesan: `Baris ${no}: kuantitas fisik ${kode} negatif (${qty}). Stok fisik tidak mungkin negatif — hitung ulang.` });
    if (!Number.isFinite(harga) || harga < 0) return galat.push({ baris: no, kode: "HARGA_TIDAK_VALID", pesan: `Baris ${no}: harga ${kode} bukan angka yang valid.` });
    const satuan = String(r.satuan || "").trim().toUpperCase();
    if (!satuan) return galat.push({ baris: no, kode: "SATUAN_KOSONG", pesan: `Baris ${no}: satuan ${kode} wajib diisi (sesuai satuan saat menghitung).` });
    const sumber = String(r.sumber || "").trim().toUpperCase();
    dipakai.add(m.id);
    const q = toMoney(qty).toDecimalPlaces(4);
    const h = toMoney(harga).toDecimalPlaces(2);
    siap.push({
      openingId, materialId: m.id, qty: q, unit: satuan, unitCost: h, value: q.times(h).toDecimalPlaces(2),
      priceSource: sumber, priceReference: String(r.referensi || "").trim() || null, priceNote: String(r.penjelasanHarga || "").trim() || null,
      notes: String(r.catatan || "").trim() || null, createdById: userId,
    });
  });
  if (galat.length > 0) throw new PersediaanError(`${galat.length} baris tidak bisa dibaca — tidak ada yang disimpan.`, 422, "BARIS_TIDAK_VALID", galat);

  if (mode === "ganti") await tx.finInventoryOpeningLine.deleteMany({ where: { openingId } });
  await tx.finInventoryOpeningLine.createMany({ data: siap });
  await resetPemeriksaan(tx, openingId);
  return { disimpan: siap.length };
}

export async function hapusBaris(tx, { openingId, lineId }) {
  const o = await ambil(tx, openingId, { kunci: true });
  if (o.status !== "DRAFT") throw new PersediaanError("Snapshot terkunci — baris tidak bisa dihapus.", 409, "SNAPSHOT_TERKUNCI");
  const n = await tx.finInventoryOpeningLine.deleteMany({ where: { id: lineId, openingId } });
  if (n.count === 0) throw new PersediaanError("Baris tidak ditemukan", 404);
  await resetPemeriksaan(tx, openingId);
}

async function resetPemeriksaan(tx, openingId) {
  await tx.finInventoryOpening.update({
    where: { id: openingId },
    data: { financeCheckedById: null, financeCheckedAt: null, warehouseCheckedById: null, warehouseCheckedAt: null, contentHash: null, lineCount: null, totalValue: null },
  });
}

/** Pemeriksaan oleh Finance atau Gudang (orang berbeda). Keduanya selesai → DIPERIKSA, isi dikunci + hash. */
export async function periksa(tx, { openingId, peran, userId }) {
  if (!["FINANCE", "GUDANG"].includes(peran)) throw new PersediaanError("Peran pemeriksa harus FINANCE atau GUDANG", 400);
  const o = await ambil(tx, openingId, { kunci: true });
  if (o.status !== "DRAFT") throw new PersediaanError(`Snapshot berstatus ${STATUS_LABEL[o.status]} — tidak bisa diperiksa lagi.`, 409, "STATUS_TIDAK_SESUAI");
  const lines = await barisDengan(tx, openingId);
  const v = await validasiSnapshot(tx, o, lines);
  if (v.blocker.length > 0) throw new PersediaanError(`Snapshot belum bisa diperiksa: ${v.blocker.length} masalah harus diperbaiki dulu.`, 422, "SNAPSHOT_TIDAK_VALID", v.blocker);
  const lain = peran === "FINANCE" ? o.warehouseCheckedById : o.financeCheckedById;
  if (lain && lain === userId) throw new PersediaanError("Pemeriksa Finance dan pemeriksa Gudang harus orang yang berbeda.", 409, "PEMERIKSA_SAMA");
  const data = peran === "FINANCE" ? { financeCheckedById: userId, financeCheckedAt: new Date() } : { warehouseCheckedById: userId, warehouseCheckedAt: new Date() };
  const lengkap = peran === "FINANCE" ? !!o.warehouseCheckedById : !!o.financeCheckedById;
  if (lengkap) {
    Object.assign(data, {
      status: "DIPERIKSA", contentHash: hashIsi(lines), lineCount: lines.length,
      totalValue: sumMoney(lines.map((l) => toMoney(l.value))).toDecimalPlaces(2),
    });
  }
  return tx.finInventoryOpening.update({ where: { id: openingId }, data });
}

export async function bukaKembali(tx, { openingId }) {
  const o = await ambil(tx, openingId, { kunci: true });
  if (o.status !== "DIPERIKSA") throw new PersediaanError("Hanya snapshot yang sudah diperiksa (belum diposting) yang bisa dibuka kembali.", 409, "STATUS_TIDAK_SESUAI");
  return tx.finInventoryOpening.update({
    where: { id: openingId },
    data: { status: "DRAFT", financeCheckedById: null, financeCheckedAt: null, warehouseCheckedById: null, warehouseCheckedAt: null, contentHash: null, lineCount: null, totalValue: null },
  });
}

export async function batalkanDraf(tx, { openingId }) {
  const o = await ambil(tx, openingId, { kunci: true });
  if (o.status !== "DRAFT") throw new PersediaanError("Hanya draf yang bisa dibatalkan.", 409, "STATUS_TIDAK_SESUAI");
  return tx.finInventoryOpening.update({ where: { id: openingId }, data: { status: "DIBATALKAN" } });
}

/** Susun baris jurnal pembuka. Murni hitung (dipakai pratinjau DAN posting — yang dilihat = yang diposting). */
async function susunJurnal(db, o, total) {
  const cutover = kunciDariKolomDate(o.cutoverDate);
  const tanggal = hariSebelum(cutover);
  const saldoBuku = await saldoPersediaanSampai(db, tanggal);
  const selisih = total.minus(saldoBuku);
  const persediaan = await resolveAccount(db, SYSTEM_KEYS.PERSEDIAAN_BAHAN);
  const beban = await resolveAccount(db, SYSTEM_KEYS.BEBAN_POKOK_BAHAN);
  const P = { kode: persediaan.code, nama: persediaan.name };
  const Bb = { kode: beban.code, nama: beban.name };
  const lines = [];
  if (selisih.greaterThan(0)) {
    lines.push({ akun: P, accountId: persediaan.id, debit: selisih, description: `Persediaan awal perpetual per ${tanggalIndonesia(cutover)} (stok opname ${o.number})` });
    lines.push({ akun: Bb, accountId: beban.id, credit: selisih, description: "Persediaan akhir periodik — mengurangi beban bahan baku" });
  } else if (selisih.lessThan(0)) {
    lines.push({ akun: Bb, accountId: beban.id, debit: selisih.negated(), description: "Persediaan akhir periodik lebih kecil dari saldo buku — tambahan beban bahan baku" });
    lines.push({ akun: P, accountId: persediaan.id, credit: selisih.negated(), description: `Penyesuaian persediaan ke stok opname ${o.number}` });
  }
  return { tanggal, cutover, saldoBuku, selisih, total, lines };
}

function bentukPratinjau(j) {
  const d = sumMoney(j.lines.map((l) => toMoney(l.debit || 0)));
  const k = sumMoney(j.lines.map((l) => toMoney(l.credit || 0)));
  return {
    tanggalJurnal: j.tanggal, cutover: j.cutover,
    nilaiStokFisik: j.total.toFixed(2), saldoBukuSebelum: j.saldoBuku.toFixed(2), penyesuaian: j.selisih.toFixed(2),
    saldoSesudah: j.saldoBuku.plus(j.selisih).toFixed(2),
    baris: j.lines.map((l) => ({
      akun: l.akun,
      debit: toMoney(l.debit || 0).toFixed(2), kredit: toMoney(l.credit || 0).toFixed(2), keterangan: l.description,
    })),
    totalDebit: d.toFixed(2), totalKredit: k.toFixed(2), seimbang: d.equals(k),
  };
}

export async function pratinjauJurnal(db, openingId) {
  const o = await ambil(db, openingId);
  const lines = await barisDengan(db, openingId);
  const total = o.totalValue != null ? toMoney(o.totalValue) : sumMoney(lines.map((l) => toMoney(l.value)));
  return bentukPratinjau(await susunJurnal(db, o, total));
}

/**
 * POSTING jurnal pembuka — sekali. Dipanggil di dalam transaksi; aman untuk klik ganda & permintaan paralel:
 *  advisory lock global → row lock snapshot → cek status (klik kedua melihat DIPOSTING dan mengembalikan hasil yang sama) →
 *  hash isi dicocokkan ulang → blocker dicek ulang → idempotency key jurnal → partial unique index sebagai jaring terakhir.
 */
export async function postingPembuka(tx, { openingId, userId, reason }) {
  if (!String(reason || "").trim()) throw new PersediaanError("Alasan posting wajib diisi.", 400, "ALASAN_WAJIB");
  await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", KUNCI_LOCK);
  const o = await ambil(tx, openingId, { kunci: true });
  if (o.status === "DIPOSTING") return { opening: o, dibuat: false };
  if (o.status !== "DIPERIKSA" || !o.financeCheckedById || !o.warehouseCheckedById) {
    throw new PersediaanError("Snapshot harus diperiksa Finance dan Gudang sebelum diposting.", 409, "BELUM_DIPERIKSA");
  }
  const cutover = kunciDariKolomDate(o.cutoverDate);
  const aktif = await pembukaAktif(tx, cutover);
  if (aktif && aktif.id !== o.id) throw new PersediaanError(`Persediaan awal cutover ${tanggalIndonesia(cutover)} sudah diposting lewat ${aktif.number}.`, 409, "SUDAH_ADA_PEMBUKA");

  const lines = await barisDengan(tx, openingId);
  if (hashIsi(lines) !== o.contentHash) throw new PersediaanError("Isi snapshot berbeda dengan yang diperiksa — posting dibatalkan.", 409, "ISI_BERUBAH");
  const v = await validasiSnapshot(tx, o, lines);
  if (v.blocker.length > 0) throw new PersediaanError("Snapshot masih punya masalah yang memblokir posting.", 422, "SNAPSHOT_TIDAK_VALID", v.blocker);

  const j = await susunJurnal(tx, o, toMoney(o.totalValue));
  let entry = null;
  if (j.lines.length > 0) {
    ({ entry } = await postJournal(tx, {
      date: j.tanggal, source: "PERSEDIAAN_AWAL", sourceId: o.id, idempotencyKey: KEY(o.id), userId,
      lines: j.lines.map(({ akun, ...l }) => l),
      description: `Persediaan awal perpetual ${tanggalIndonesia(cutover)} — stok opname ${o.number} (${lines.length} material). Alasan: ${String(reason).trim()}`.slice(0, 500),
    }));
  }
  const opening = await tx.finInventoryOpening.update({
    where: { id: o.id },
    data: {
      status: "DIPOSTING", postedById: userId, postedAt: new Date(), postReason: String(reason).trim(),
      bookValueBefore: j.saldoBuku.toDecimalPlaces(2), adjustment: j.selisih.toDecimalPlaces(2), journalEntryId: entry?.id || null,
    },
  });
  return { opening, dibuat: true, entry };
}

/** Pembalikan resmi jurnal pembuka (reversal), membuka kembali kunci tanggal cutover. Snapshot tetap tersimpan (DIBALIK). */
export async function balikPembuka(tx, { openingId, userId, reason }) {
  if (!String(reason || "").trim()) throw new PersediaanError("Alasan pembalikan wajib diisi.", 400, "ALASAN_WAJIB");
  await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", KUNCI_LOCK);
  const o = await ambil(tx, openingId, { kunci: true });
  if (o.status === "DIBALIK") return { opening: o, dibuat: false };
  if (o.status !== "DIPOSTING") throw new PersediaanError("Hanya persediaan awal yang sudah diposting yang bisa dibalik.", 409, "STATUS_TIDAK_SESUAI");
  let reversal = null;
  if (o.journalEntryId) {
    reversal = await reverseJournal(tx, { entryId: o.journalEntryId, date: toBookDate(hariSebelum(kunciDariKolomDate(o.cutoverDate))), reason: String(reason).trim(), userId });
  }
  const opening = await tx.finInventoryOpening.update({
    where: { id: o.id },
    data: { status: "DIBALIK", reversedById: userId, reversedAt: new Date(), reverseReason: String(reason).trim(), reversalEntryId: reversal?.id || null },
  });
  return { opening, dibuat: true };
}

// ── detail & laporan ───────────────────────────────────────────────────────────────────────────────────────────────────

export async function detailSnapshot(db, openingId) {
  const o = await ambil(db, openingId);
  const lines = await barisDengan(db, openingId);
  const v = await validasiSnapshot(db, o, lines);
  const sistem = await qtySistem(db, lines.map((l) => l.materialId), o.countedAt);
  const users = await db.user.findMany({
    where: { id: { in: [o.createdById, o.financeCheckedById, o.warehouseCheckedById, o.postedById, o.reversedById].filter(Boolean) } },
    select: { id: true, name: true },
  });
  const nama = (id) => users.find((u) => u.id === id)?.name || null;
  let jurnal = null;
  if (o.journalEntryId) jurnal = await db.finJournalEntry.findUnique({ where: { id: o.journalEntryId }, select: { id: true, entryNumber: true, status: true, date: true } });
  return {
    snapshot: {
      ...o, statusLabel: STATUS_LABEL[o.status], cutover: kunciDariKolomDate(o.cutoverDate),
      pencatat: nama(o.createdById), pemeriksaFinance: nama(o.financeCheckedById), pemeriksaGudang: nama(o.warehouseCheckedById),
      diposting: nama(o.postedById), dibalik: nama(o.reversedById), jurnal,
    },
    baris: lines.map((l) => ({
      id: l.id, materialId: l.materialId, kode: l.material.code, nama: l.material.name, satuanMaterial: l.material.unit,
      qty: toMoney(l.qty).toString(), satuan: l.unit, harga: toMoney(l.unitCost).toFixed(2), nilai: toMoney(l.value).toFixed(2),
      sumber: l.priceSource, sumberLabel: SUMBER_HARGA[l.priceSource] || l.priceSource, referensi: l.priceReference, penjelasanHarga: l.priceNote, catatan: l.notes,
      hargaReferensi: l.material.referenceUnitCost ?? null, qtySistem: (sistem.get(l.materialId) || ZERO).toString(),
    })),
    validasi: v,
  };
}

/**
 * Laporan pengecualian menjelang cutover (baca saja): stok sistem negatif, harga referensi tidak wajar, stok tanpa harga valid,
 * dan pemakaian bahan yang belum tercatat sampai hari sebelum cutover. Tidak mengubah data apa pun.
 */
export async function laporanPengecualian(db) {
  const k = await ambilKebijakanPersediaan(db);
  const cutover = k.cutover;
  const batas = cutover ? new Date(awalCutover(cutover).getTime() - 1) : new Date();
  const [saldo, materials, receiptsBerharga, issueTerakhir] = await Promise.all([
    db.stockMovement.groupBy({ by: ["materialId"], where: { createdAt: { lte: batas } }, _sum: { qty: true } }),
    db.material.findMany({ select: { ...PILIH_MATERIAL, referenceStockValue: true } }),
    db.stockMovement.findMany({ where: { type: "RECEIPT", unitCost: { gt: 0 } }, select: { materialId: true }, distinct: ["materialId"] }),
    db.stockMovement.findFirst({ where: { type: "ISSUE", createdAt: { lte: batas } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
  ]);
  const byId = new Map(materials.map((m) => [m.id, m]));
  const punyaHarga = new Set(receiptsBerharga.map((r) => r.materialId));

  const draf = cutover ? await db.finInventoryOpening.findFirst({
    where: { cutoverDate: new Date(`${cutover}T00:00:00Z`), status: { in: ["DRAFT", "DIPERIKSA", "DIPOSTING"] } },
    orderBy: { createdAt: "desc" }, select: { id: true, number: true, status: true },
  }) : null;
  const hargaSnapshot = new Set();
  if (draf) {
    const ls = await db.finInventoryOpeningLine.findMany({ where: { openingId: draf.id, unitCost: { gt: 0 } }, select: { materialId: true } });
    ls.forEach((l) => hargaSnapshot.add(l.materialId));
  }

  const stokNegatif = [];
  const hargaAnomali = [];
  const tanpaHarga = [];
  for (const r of saldo) {
    const m = byId.get(r.materialId);
    if (!m) continue;
    const qty = toMoney(r._sum.qty || 0);
    const ref = m.referenceUnitCost ? toMoney(m.referenceUnitCost) : null;
    const item = { kode: m.code, nama: m.name, satuan: m.unit, qtySistem: qty.toString(), hargaReferensi: m.referenceUnitCost ?? null, nilaiReferensi: ref ? qty.times(ref).toFixed(0) : null };
    if (qty.lessThan(0)) stokNegatif.push(item);
    if (qty.greaterThan(0) && ref && qty.times(ref).greaterThan(AMBANG.nilaiBarisMaks)) hargaAnomali.push({ ...item, alasan: `Nilai referensi di atas Rp${AMBANG.nilaiBarisMaks / 1e6} jt untuk satu material — kemungkinan salah harga/satuan.` });
    if (qty.greaterThan(0) && !punyaHarga.has(m.id) && !hargaSnapshot.has(m.id)) tanpaHarga.push(item);
  }
  for (const m of materials) {
    if (m.referenceStockValue && toMoney(m.referenceStockValue).greaterThan(AMBANG.nilaiBarisMaks) && !hargaAnomali.some((h) => h.kode === m.code)) {
      hargaAnomali.push({ kode: m.code, nama: m.name, satuan: m.unit, qtySistem: null, hargaReferensi: m.referenceUnitCost ?? null, nilaiReferensi: String(m.referenceStockValue), alasan: "Nilai stok referensi impor di atas batas wajar." });
    }
  }
  const jumlahNilai = (arr) => sumMoney(arr.map((x) => toMoney(x.nilaiReferensi || 0))).toFixed(0);

  let pemakaian = null;
  if (cutover) {
    const akhir = hariSebelum(cutover);
    const terakhir = issueTerakhir ? kunciWIB(issueTerakhir.createdAt) : null;
    if (!terakhir || terakhir < akhir) {
      const mulai = terakhir ? new Date(new Date(`${terakhir}T00:00:00Z`).getTime() + 86400_000).toISOString().slice(0, 10) : null;
      const hari = mulai ? Math.round((new Date(`${akhir}T00:00:00Z`) - new Date(`${mulai}T00:00:00Z`)) / 86400_000) + 1 : null;
      pemakaian = { terakhirTercatat: terakhir, belumTercatatDari: mulai, sampai: akhir, jumlahHari: hari,
        pesan: terakhir ? `Pemakaian bahan Gudang terakhir tercatat ${tanggalIndonesia(terakhir)}; ${hari} hari (${tanggalIndonesia(mulai)} – ${tanggalIndonesia(akhir)}) belum tercatat. Stok opname fisik yang menentukan persediaan akhir.` : "Belum ada pemakaian bahan yang tercatat di Gudang." };
    }
  }

  return {
    cutover, batasHitung: batas.toISOString(),
    snapshot: draf,
    stokNegatif: { jumlah: stokNegatif.length, nilaiReferensi: jumlahNilai(stokNegatif), daftar: stokNegatif.sort((a, b) => Number(a.nilaiReferensi || 0) - Number(b.nilaiReferensi || 0)) },
    hargaReferensiAnomali: { jumlah: hargaAnomali.length, daftar: hargaAnomali },
    tanpaHargaValid: { jumlah: tanpaHarga.length, daftar: tanpaHarga },
    pemakaianBelumLengkap: pemakaian,
    catatan: "Harga referensi master hanya pembanding; nilai persediaan awal memakai harga yang diisi di snapshot dengan dokumen sumbernya.",
  };
}

/** Penerimaan Gudang sebelum cutover yang sengaja TIDAK dijurnal karena pembuka sudah diposting (tercakup stok opname). */
export async function penerimaanTertutupPeriodik(tx, goodsReceiptId) {
  const gr = await tx.goodsReceipt.findUnique({ where: { id: goodsReceiptId }, select: { receivedDate: true, createdAt: true } });
  if (!gr) return false;
  if (await findEntryByKey(tx, `PENERIMAAN_BAHAN:${goodsReceiptId}`)) return false;
  const s = await statusCutoverUntuk(tx, gr.receivedDate || gr.createdAt);
  return s.status === "tertutup";
}
