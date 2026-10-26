// KOMPONEN LAMA DARI UNIT PELANGGAN (Ruang Kerja Unit → Bahan → Catat pemakaian aktual → "Komponen lama dari unit ini").
// Komponen bongkaran milik kasur pelanggan yang sedang dikerjakan, dipakai kembali (atau dilepas tetapi tidak dipakai). BUKAN stok perusahaan:
//   • TIDAK menulis stock_movements, material_issues, reservasi, jurnal, harga persediaan, atau biaya bahan baru; TIDAK membuat penerimaan Gudang; tidak mengirim pesan;
//   • tabel unit_component_reuse_entries append-only (versi): salah input = versi CORRECTED/VOIDED dengan alasan wajib, baris lama tetap;
//   • sumber dikunci ke unit INI (DB CHECK source='OWN_UNIT'): komponen unit pelanggan lain tidak dapat dicatat lewat jalur ini.
import crypto from "node:crypto";
import { tanggalDilaporkan, catatanPembetulan } from "./pembetulanBahanUnit.js";
import { lockRowForUpdate } from "./inventoryLedger.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../lib/activityLog.js";
import { EVIDENCE_URL_PREFIX } from "../lib/domain/productionSteps.js";

export class ReuseError extends Error {
  constructor(message, code = "KOMPONEN_LAMA_DITOLAK", statusCode = 409, details = null) { super(message); this.name = "ReuseError"; this.code = code; this.statusCode = statusCode; if (details) this.details = details; }
}

export const OUTCOME = Object.freeze({
  REUSED: { key: "REUSED", label: "Dipakai kembali pada unit ini", pemakaian: true },
  RETURNED_TO_CUSTOMER: { key: "RETURNED_TO_CUSTOMER", label: "Dikembalikan ke pelanggan", pemakaian: false },
  KEPT_WITH_UNIT: { key: "KEPT_WITH_UNIT", label: "Disimpan bersama unit", pemakaian: false },
  DISCARDED: { key: "DISCARDED", label: "Dibuang", pemakaian: false },
});
export const OUTCOME_KEYS = Object.freeze(Object.keys(OUTCOME));
export const KIND_LABEL = Object.freeze({ CREATED: "Dicatat", CORRECTED: "Dikoreksi", VOIDED: "Dibatalkan (salah input)" });
// Satuan yang sama dengan satuan bahan Gudang (enum MaterialUnit) — komponen bongkaran memakai satuan yang dipahami petugas.
export const UOM_LIST = Object.freeze(["PCS", "METER", "M3", "SHEET", "SPOOL", "KG", "PACK", "ROLL", "BUNDLE", "ROD", "PAIR", "CAN", "BOX", "LITER"]);
export const PHOTO_MAX = 3;
export const NOTE_CLEAN = "Komponen milik pelanggan: tidak masuk stok perusahaan, tidak membuat Material Issue/penerimaan Gudang/biaya bahan baru.";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDEM_RE = /^[A-Za-z0-9._:-]{12,128}$/;
const FOTO_RE = new RegExp(`^${EVIDENCE_URL_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[A-Za-z0-9._-]{1,200}$`);
const INACTIVE = ["CANCELLED", "DELIVERED"];
const bad = (msg, code) => new ReuseError(msg, code, 400);
const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Murni: validasi + normalisasi isian satu baris komponen lama. */
export function normalisasiIsian(raw) {
  const d = raw && typeof raw === "object" ? raw : {};
  const name = str(d.name, 120); if (name.length < 2) throw bad("Nama komponen wajib diisi (minimal 2 huruf).", "KOMPONEN_NAMA_WAJIB");
  const qty = Number(d.qty); if (!Number.isFinite(qty) || qty <= 0 || qty > 100000) throw bad("Jumlah komponen harus lebih dari 0.", "KOMPONEN_JUMLAH_INVALID");
  const qtyBulat = Math.round(qty * 10000) / 10000;
  const uom = String(d.uom ?? "").trim().toUpperCase(); if (!UOM_LIST.includes(uom)) throw bad("Satuan komponen tidak dikenal.", "KOMPONEN_SATUAN_INVALID");
  const outcome = String(d.outcome ?? "REUSED"); if (!OUTCOME_KEYS.includes(outcome)) throw bad("Hasil komponen harus: dipakai kembali, dikembalikan ke pelanggan, disimpan bersama unit, atau dibuang.", "KOMPONEN_HASIL_INVALID");
  const condition = str(d.condition, 200); if (condition.length < 2) throw bad("Kondisi singkat komponen wajib diisi (mis. bagus, aus ringan).", "KOMPONEN_KONDISI_WAJIB");
  const workPart = str(d.workPart, 120);
  if (outcome === "REUSED" && workPart.length < 2) throw bad("Bagian pekerjaan tempat komponen dipakai wajib diisi.", "KOMPONEN_BAGIAN_WAJIB");
  const materialId = d.materialId ? String(d.materialId) : null; if (materialId && !UUID_RE.test(materialId)) throw bad("Bahan katalog tidak valid.", "KOMPONEN_BAHAN_INVALID");
  const note = str(d.note, 500);
  const foto = Array.isArray(d.photoUrls) ? d.photoUrls.map((u) => String(u).split("?")[0]) : [];
  if (foto.length > PHOTO_MAX) throw bad(`Maksimal ${PHOTO_MAX} foto per komponen.`, "KOMPONEN_FOTO_TERLALU_BANYAK");
  for (const u of foto) if (!FOTO_RE.test(u)) throw bad("Foto komponen tidak valid (unggah lewat tombol foto).", "KOMPONEN_FOTO_INVALID");
  return { name, qty: qtyBulat, uom, outcome, condition, workPart: workPart || null, materialId, note: note || null, photoUrls: [...new Set(foto)] };
}
const sama = (a, b) => a.name === b.name && Number(a.qty) === Number(b.qty) && a.uom === b.uom && a.outcome === b.outcome && (a.condition ?? "") === (b.condition ?? "") && (a.workPart ?? "") === (b.workPart ?? "") && (a.materialId ?? null) === (b.materialId ?? null) && (a.note ?? "") === (b.note ?? "") && JSON.stringify(a.photoUrls ?? []) === JSON.stringify(b.photoUrls ?? []);

function kunciValid(k) { if (!k || !IDEM_RE.test(String(k))) throw bad("Idempotency-Key wajib (12–128 karakter huruf/angka/._:-).", "IDEMPOTENCY_KEY_INVALID"); return String(k); }

// alasan + tanggal = pembetulan unit TERKIRIM (Okt 2026): komponen lama (BUKAN stok) pada unit DELIVERED diterima dengan alasan wajib (5–500 karakter) DAN tanggal pemakaian yang dilaporkan; unit DIBATALKAN tetap ditolak.
async function unitAktif(tx, unitId, { alasan = "", tanggal = "" } = {}) {
  await lockRowForUpdate(tx, "units", unitId);
  const unit = await tx.unit.findUnique({ where: { id: unitId }, select: { id: true, unitCode: true, status: true, orderId: true, createdAt: true } });
  if (!unit) throw new ReuseError("Unit tidak ditemukan", "UNIT_TIDAK_ADA", 404);
  const alasanB = String(alasan ?? "").trim();
  if (unit.status === "DELIVERED" && alasanB.length >= 5 && alasanB.length <= 500) return { ...unit, pembetulan: alasanB, tglDilaporkan: tanggalDilaporkan(tanggal, { unitDibuat: unit.createdAt }) };
  if (INACTIVE.includes(unit.status)) throw new ReuseError(`Unit ${unit.unitCode} sudah ${unit.status === "CANCELLED" ? "dibatalkan" : "terkirim"}; komponen lama tidak dicatat lagi${unit.status === "DELIVERED" ? " kecuali sebagai pembetulan dengan alasan (5–500 karakter) dan tanggal pemakaian" : ""}.`, "UNIT_TIDAK_AKTIF");
  return unit;
}
async function pastikanBahanAda(tx, materialId) { if (materialId && !(await tx.material.findUnique({ where: { id: materialId }, select: { id: true } }))) throw bad("Bahan katalog tidak ditemukan.", "KOMPONEN_BAHAN_TIDAK_ADA"); }

const tampil = (e, namaUser) => ({
  id: e.id, itemId: e.itemId, version: e.version, kind: e.kind, kindLabel: KIND_LABEL[e.kind] ?? e.kind, name: e.name, qty: Number(e.qty), uom: e.uom, outcome: e.outcome, outcomeLabel: OUTCOME[e.outcome]?.label ?? e.outcome,
  pemakaian: !!OUTCOME[e.outcome]?.pemakaian, condition: e.condition, workPart: e.workPart, note: e.note, materialId: e.materialId, reason: e.reason, photoUrls: e.photoUrls ?? [],
  oleh: namaUser.get(e.actorId) ?? null, actorId: e.actorId, at: e.createdAt,
});

/** Catat komponen lama BARU (versi 1). Idempoten per (unit, kunci): klik ganda/retry tidak menggandakan. */
export async function catatKomponenLama(prisma, { unitId, input, actorId, idempotencyKey }) {
  const kunci = kunciValid(idempotencyKey); const data = normalisasiIsian(input);
  return prisma.$transaction(async (tx) => {
    const unit = await unitAktif(tx, unitId, { alasan: input?.alasanPembetulan, tanggal: input?.tanggalPemakaian });
    if (unit.pembetulan) data.note = catatanPembetulan(unit.unitCode, unit.pembetulan, unit.tglDilaporkan.tanggal, data.note); // alasan + tanggal dilaporkan masuk ke catatan versi 1 (append-only); waktu pencatatan = createdAt
    const ada = await tx.unitComponentReuseEntry.findFirst({ where: { unitId, idempotencyKey: kunci } });
    if (ada) {
      if (ada.version !== 1 || !sama({ ...ada, qty: Number(ada.qty), photoUrls: ada.photoUrls }, data)) throw new ReuseError("Idempotency-Key ini sudah dipakai untuk isian yang berbeda.", "IDEMPOTENCY_KEY_REUSED");
      return { replayed: true, item: tampil(ada, new Map()) };
    }
    await pastikanBahanAda(tx, data.materialId);
    const itemId = crypto.randomUUID();
    const row = await tx.unitComponentReuseEntry.create({ data: { itemId, unitId, version: 1, kind: "CREATED", ...data, photoUrls: data.photoUrls, idempotencyKey: kunci, actorId } });
    await recordActivity(tx, { entityType: ENTITY_TYPES.UNIT, entityId: unitId, eventType: EVENT_TYPES.PRODUCTION_KOMPONEN_LAMA_DICATAT, actorId, metadata: { unitCode: unit.unitCode, kind: "CREATED", itemId, name: data.name, qty: data.qty, uom: data.uom, outcome: data.outcome, ...(unit.pembetulan ? { pembetulanUnitTerkirim: unit.pembetulan, tanggalPemakaianDilaporkan: unit.tglDilaporkan.tanggal } : {}) } });
    return { replayed: false, item: tampil(row, new Map()) };
  });
}

/** Koreksi (CORRECTED, isian lengkap baru) atau batalkan (VOIDED) satu komponen: versi BARU, versi lama tidak diubah. expectedVersion = versi yang dilihat pengguna. */
export async function koreksiKomponenLama(prisma, { unitId, itemId, kind, input, reason, expectedVersion, actorId, idempotencyKey }) {
  if (!["CORRECTED", "VOIDED"].includes(kind)) throw bad("Jenis koreksi tidak dikenal.", "KOMPONEN_JENIS_INVALID");
  const kunci = kunciValid(idempotencyKey); const alasan = str(reason, 500);
  if (alasan.length < 3) throw bad("Alasan koreksi wajib diisi (minimal 3 karakter).", "KOMPONEN_ALASAN_WAJIB");
  if (!UUID_RE.test(String(itemId))) throw bad("ID komponen tidak valid.", "ID_INVALID");
  const baru = kind === "CORRECTED" ? normalisasiIsian(input) : null;
  return prisma.$transaction(async (tx) => {
    const unit = await unitAktif(tx, unitId);
    const ada = await tx.unitComponentReuseEntry.findFirst({ where: { unitId, idempotencyKey: kunci } });
    if (ada) { if (ada.itemId !== itemId || ada.kind !== kind) throw new ReuseError("Idempotency-Key ini sudah dipakai untuk isian yang berbeda.", "IDEMPOTENCY_KEY_REUSED"); return { replayed: true, item: tampil(ada, new Map()) }; }
    const riwayat = await tx.unitComponentReuseEntry.findMany({ where: { unitId, itemId }, orderBy: { version: "asc" } });
    if (!riwayat.length) throw new ReuseError("Komponen tidak ditemukan pada unit ini.", "KOMPONEN_TIDAK_ADA", 404);
    const akhir = riwayat[riwayat.length - 1];
    if (akhir.kind === "VOIDED") throw new ReuseError("Komponen ini sudah dibatalkan; catat komponen baru bila perlu.", "KOMPONEN_SUDAH_DIBATALKAN");
    if (Number(expectedVersion) !== akhir.version) throw new ReuseError("Komponen ini sudah diubah orang lain. Muat ulang lalu ulangi bila masih perlu.", "RIWAYAT_BERUBAH", 409, { versiSekarang: akhir.version });
    const isi = kind === "CORRECTED" ? baru : { name: akhir.name, qty: Number(akhir.qty), uom: akhir.uom, outcome: akhir.outcome, condition: akhir.condition, workPart: akhir.workPart, materialId: akhir.materialId, note: akhir.note, photoUrls: akhir.photoUrls ?? [] };
    if (kind === "CORRECTED" && sama({ ...akhir, qty: Number(akhir.qty) }, isi)) throw new ReuseError("Tidak ada perubahan dari versi terakhir.", "KOMPONEN_TIDAK_BERUBAH", 422);
    await pastikanBahanAda(tx, isi.materialId);
    const row = await tx.unitComponentReuseEntry.create({ data: { itemId, unitId, version: akhir.version + 1, kind, ...isi, photoUrls: isi.photoUrls, reason: alasan, idempotencyKey: kunci, actorId } });
    await recordActivity(tx, { entityType: ENTITY_TYPES.UNIT, entityId: unitId, eventType: EVENT_TYPES.PRODUCTION_KOMPONEN_LAMA_DICATAT, actorId, metadata: { unitCode: unit.unitCode, kind, itemId, name: isi.name, qty: isi.qty, uom: isi.uom, outcome: isi.outcome, reason: alasan } });
    return { replayed: false, item: tampil(row, new Map()) };
  });
}

/** Baca-saja: keadaan terkini per komponen, komponen yang dibatalkan, riwayat versi, dan total TERPISAH (pemakaian vs dilepas-tidak-dipakai). Foto menerima penanda-tangan tautan dari pemanggil. */
export async function ambilKomponenLama(db, unitId, { tandaiFoto = (u) => u } = {}) {
  const unit = await db.unit.findUnique({ where: { id: unitId }, select: { unitCode: true } });
  const rows = await db.unitComponentReuseEntry.findMany({ where: { unitId }, orderBy: [{ createdAt: "asc" }, { version: "asc" }] });
  const aktor = new Map((await db.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.actorId))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const semua = rows.map((r) => ({ ...tampil(r, aktor), photos: (r.photoUrls ?? []).map((u) => ({ url: u, previewUrl: tandaiFoto(u) })) }));
  const terakhir = new Map(); for (const e of semua) terakhir.set(e.itemId, e);
  const terkini = [...terakhir.values()].sort((a, b) => new Date(b.at) - new Date(a.at));
  const berlaku = terkini.filter((e) => e.kind !== "VOIDED"); const dibatalkan = terkini.filter((e) => e.kind === "VOIDED");
  const per = (k) => berlaku.filter((e) => e.outcome === k);
  const jumlah = (xs) => { const m = new Map(); for (const e of xs) m.set(e.uom, Math.round(((m.get(e.uom) ?? 0) + e.qty) * 10000) / 10000); return [...m].map(([uom, qty]) => ({ uom, qty })); };
  return {
    unitCode: unit?.unitCode ?? null, asal: unit ? `Dari kasur pelanggan — ${unit.unitCode}` : null, catatan: NOTE_CLEAN,
    items: berlaku.map((e) => ({ ...e, asal: `Dari kasur pelanggan — ${unit?.unitCode ?? "—"}` })), dibatalkan,
    riwayat: [...semua].reverse(),
    total: {
      pemakaianKembali: { jumlahItem: per("REUSED").length, perSatuan: jumlah(per("REUSED")) },
      dilepasTidakDipakai: { jumlahItem: berlaku.length - per("REUSED").length, dikembalikan: per("RETURNED_TO_CUSTOMER").length, disimpan: per("KEPT_WITH_UNIT").length, dibuang: per("DISCARDED").length },
      terakhirAt: berlaku[0]?.at ?? null,
    },
    dampakStok: "Tidak ada (komponen milik pelanggan; tidak memengaruhi saldo, pergerakan, jurnal, maupun biaya bahan baru).",
  };
}
