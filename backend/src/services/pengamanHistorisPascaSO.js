// PENGAMAN POSTING HISTORIS PASCA-SO (Nov 2026) — pemakaian bertanggal SEBELUM SO tidak boleh mengurangi stok DUA KALI.
//
// Masalah: posting historis menulis ISSUE bertanggal lama; saldo = Σ semua pergerakan tanpa melihat tanggal. Bila hasil SO sudah diposting (Koreksi Saldo → ADJUSTMENT) sebagai fisik SETELAH pemakaian itu terjadi,
// ISSUE historis yang diposting sesudahnya mengurangi lagi — diam-diam.
//
// Aturan (FAIL-CLOSED, aditif, tanpa migrasi; keadaan DIHITUNG, bukan disimpan di catatan):
//   • Bahan "ber-hasil-SO yang disahkan" = punya Koreksi Saldo berstatus POSTED (disetujui orang lain). Bahan tanpa itu: perilaku TIDAK berubah (rencana posting identik, hash identik).
//   • Catatan EXCEL milik bahan itu yang bertanggal pakai ≤ waktu posting Koreksi Saldo terakhir bahan itu → TERTAHAN_PASCA_SO: tidak masuk rencana, tidak bisa diposting (dijaga ulang DI DALAM transaksi posting).
//   • Catatan hanya dilepas bila DINYATAKAN eksplisit oleh penyetuju (inventory:adjustment_approve), per bahan, dengan alasan + rujukan hash manifest SO → TERCERMIN_DI_SO: tetap tersimpan sebagai riwayat,
//     TIDAK membuat ISSUE, tidak mengubah ledger. Tidak ada pernyataan massal "semua bahan". Pernyataan = peristiwa append-only (entity pernyataan_historis_so); pembatalan = peristiwa baru.
//   • Catatan bertanggal SESUDAH waktu posting tetap mengikuti alur biasa. Catatan yang TIDAK tercakup pernyataan tetap ditahan (tidak dianggap tercermin, tidak dibuang).
//   • Hash rencana memuat himpunan tertahan + pernyataan bila ada; persetujuan atas rencana lama tidak bisa dipakai untuk rencana berbeda. Pemosting historis tidak boleh pelaku pernyataan yang tercakup rencananya.
//   Tidak ada jalur baru menulis stok, harga, valuasi, jurnal, PSA, atau GR.
import crypto from "node:crypto";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../lib/activityLog.js";
import { hasPermission } from "../middleware/authorize.js";
import { PERMISSIONS as P } from "../constants/permissions.js";
import { KoreksiError } from "./warehouseCorrection.js";
import { lockRowForUpdate } from "./inventoryLedger.js";

export const KEADAAN_PENGAMAN = Object.freeze({ TERTAHAN_PASCA_SO: "TERTAHAN_PASCA_SO", TERCERMIN_DI_SO: "TERCERMIN_DI_SO" });
export const TEKS_PENGAMAN = Object.freeze({
  TERTAHAN_PASCA_SO: "Bahan ini sudah punya hasil SO yang disahkan. Catatan pemakaian lama ditahan agar stok tidak berkurang dua kali; nyatakan per bahan bahwa catatan ini sudah tercermin di SO, atau tetap tahan.",
  TERCERMIN_DI_SO: "Dinyatakan sudah tercermin di hasil SO: tersimpan sebagai riwayat, TIDAK dibuat pengeluaran stok.",
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAKS_CATATAN = 200;
const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const wajib = (c, m, code, status = 400) => { if (!c) throw new KoreksiError(m, status, code); };

/** Bahan ber-hasil-SO yang disahkan: Koreksi Saldo POSTED terakhir per bahan. Map(materialId → { requestId, nomor, postedAt }). */
export async function bahanBerSOSah(db, materialIds = null) {
  const ids = materialIds ? [...new Set(materialIds)].filter(Boolean) : null; if (ids && !ids.length) return new Map();
  const rows = await db.$queryRawUnsafe(`
    SELECT DISTINCT ON (k.material_id) k.material_id::text AS "materialId", r.id::text AS "requestId", r.adjustment_number AS nomor, r.posted_at AS "postedAt"
      FROM koreksi_saldo_bahan k JOIN stock_adjustment_requests r ON r.id = k.adjustment_request_id
     WHERE r.status = 'POSTED' AND r.posted_at IS NOT NULL ${ids ? "AND k.material_id = ANY($1::uuid[])" : ""}
     ORDER BY k.material_id, r.posted_at DESC`, ...(ids ? [ids] : []));
  return new Map(rows.map((r) => [r.materialId, { requestId: r.requestId, nomor: r.nomor, postedAt: new Date(r.postedAt) }]));
}

/** Pernyataan AKTIF (belum dibatalkan). Map(noteId → { id, pelakuId, materialId, alasan, rujukanHash, waktu }). Append-only: pembatalan = peristiwa baru yang menunjuk pernyataan. */
export async function pernyataanAktif(db, materialIds = null) {
  const ev = await db.activityEvent.findMany({ where: { entityType: ENTITY_TYPES.PERNYATAAN_HISTORIS_SO, ...(materialIds ? { entityId: { in: [...new Set(materialIds)] } } : {}) }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const batal = new Set(ev.filter((e) => e.eventType === EVENT_TYPES.SO_HISTORIS_DIBATALKAN).map((e) => e.metadata?.membatalkanId));
  const peta = new Map();
  for (const e of ev) {
    if (e.eventType !== EVENT_TYPES.SO_HISTORIS_TERCERMIN || batal.has(e.id)) continue;
    for (const nid of e.metadata?.catatanIds ?? []) peta.set(nid, { id: e.id, pelakuId: e.actorId, materialId: e.entityId, alasan: e.metadata?.alasan, rujukanHash: e.metadata?.rujukanHash, waktu: e.createdAt });
  }
  return peta;
}

/** Klasifikasi baca-saja untuk sekumpulan catatan { id, materialId, usedAt }: Map(noteId → { keadaan, so, pernyataan? }). Catatan yang tidak terkena pengaman TIDAK ada di peta. */
export async function klasifikasiPengaman(db, notes) {
  const daftar = notes.filter((n) => n.materialId && n.usedAt); if (!daftar.length) return new Map();
  const ids = [...new Set(daftar.map((n) => n.materialId))];
  const so = await bahanBerSOSah(db, ids); if (!so.size) return new Map();
  const pern = await pernyataanAktif(db, ids); const hasil = new Map();
  for (const n of daftar) {
    const s = so.get(n.materialId); if (!s || new Date(n.usedAt).getTime() > s.postedAt.getTime()) continue; // tanpa hasil SO sah, atau bertanggal SESUDAH posting: alur biasa
    const p = pern.get(n.id); hasil.set(n.id, p && p.materialId === n.materialId ? { keadaan: KEADAAN_PENGAMAN.TERCERMIN_DI_SO, so: s, pernyataan: p } : { keadaan: KEADAAN_PENGAMAN.TERTAHAN_PASCA_SO, so: s });
  }
  return hasil;
}

/** Hash rencana: identik dengan hash lama bila tidak ada catatan terkena pengaman; selain itu mengikat himpunan tertahan + pernyataan. */
export function hashDenganPengaman(hashDasar, tertahan, tercermin) {
  if (!tertahan.length && !tercermin.length) return hashDasar;
  const isi = [hashDasar, tertahan.map((t) => t.catatanId).sort(), tercermin.map((t) => [t.catatanId, t.pernyataanId]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))];
  return crypto.createHash("sha256").update(JSON.stringify(isi)).digest("hex");
}

/** Pemosting historis tidak boleh pelaku pernyataan yang tercakup rencananya (pemisahan tugas). */
export function wajibBukanPenyatakan(rencana, aktor) {
  const sama = (rencana.tercermin ?? []).filter((t) => t.pelakuId && t.pelakuId === aktor?.id);
  if (sama.length) throw new KoreksiError("Pemosting historis tidak boleh orang yang menyatakan catatan 'tercermin di SO' pada rencana ini — minta penyetuju lain memulai posting.", 403, "PENYATAAN_OLEH_PEMOSTING", { jumlah: sama.length });
}

/** Penjaga DI DALAM transaksi posting: catatan yang akan menjadi ISSUE tidak boleh tertahan/tercermin. Mengunci baris bahan lebih dulu (serial dengan posting Koreksi Saldo). */
export async function wajibTidakTerkenaPengaman(tx, notes) {
  for (const mid of [...new Set(notes.map((n) => n.materialId).filter(Boolean))].sort()) await lockRowForUpdate(tx, "materials", mid);
  const k = await klasifikasiPengaman(tx, notes);
  if (k.size) { const n = notes.find((x) => k.has(x.id)); const v = k.get(n.id); throw new KoreksiError(`Catatan pemakaian ${n.orderNumber ?? ""} untuk bahan ini tidak boleh diposting: ${v.keadaan} (hasil SO ${v.so.nomor}, diposting ${v.so.postedAt.toISOString()}). ${TEKS_PENGAMAN[v.keadaan]}`, 409, v.keadaan, { jumlahTerkena: k.size }); }
}

/** Daftar baca-saja: catatan terkena pengaman beserta keadaan, hasil SO rujukan, dan pernyataan. */
export async function daftarPengaman(db, { materialId = null } = {}) {
  const so = await bahanBerSOSah(db, materialId ? [materialId] : null); if (!so.size) return { jumlahBahan: 0, tertahan: 0, tercermin: 0, baris: [] };
  const notes = await db.unitUsageNote.findMany({ where: { origin: "EXCEL", state: { in: ["SIAP_POSTING", "PERLU_DICEK"] }, materialId: { in: [...so.keys()] }, usedAt: { not: null } }, include: { material: { select: { code: true, unit: true } } }, orderBy: [{ orderNumber: "asc" }, { sourceRow: "asc" }] });
  const k = await klasifikasiPengaman(db, notes);
  const baris = notes.filter((n) => k.has(n.id)).map((n) => { const v = k.get(n.id); return { catatanId: n.id, materialId: n.materialId, kodeBahan: n.material.code, satuan: n.material.unit, order: n.orderNumber, qty: Number(n.qty), tanggalPakai: n.usedAt.toISOString(), keadaan: v.keadaan, teks: TEKS_PENGAMAN[v.keadaan], hasilSO: { nomor: v.so.nomor, diposting: v.so.postedAt.toISOString() }, pernyataan: v.pernyataan ? { id: v.pernyataan.id, alasan: v.pernyataan.alasan, rujukanHash: v.pernyataan.rujukanHash, waktu: v.pernyataan.waktu } : null }; });
  return { jumlahBahan: new Set(baris.map((b) => b.materialId)).size, tertahan: baris.filter((b) => b.keadaan === KEADAAN_PENGAMAN.TERTAHAN_PASCA_SO).length, tercermin: baris.filter((b) => b.keadaan === KEADAAN_PENGAMAN.TERCERMIN_DI_SO).length, baris };
}

/** Nyatakan catatan (per BAHAN) sudah tercermin di hasil SO. Hanya penyetuju; wajib alasan + rujukan hash; tanpa pernyataan massal. Idempoten per kunci. */
export async function nyatakanTercermin(prisma, { aktor, materialId, catatanIds, alasan, rujukanHash, kunci }) {
  wajib(aktor?.id, "Pelaku wajib ada", "PELAKU_WAJIB", 401);
  wajib(hasPermission(aktor, P.INVENTORY_ADJUSTMENT_APPROVE), "Hanya penyetuju (OWNER/FINANCE, inventory:adjustment_approve) yang boleh menyatakan catatan tercermin di SO", "BUKAN_PENYETUJU", 403);
  const k = String(kunci ?? "").trim(); wajib(k.length >= 8 && k.length <= 100, "Idempotency-Key wajib (8–100 karakter)", "KUNCI_WAJIB", 428);
  wajib(UUID.test(String(materialId ?? "")), "bahan tidak valid", "BAHAN_TIDAK_VALID");
  const ids = Array.isArray(catatanIds) ? catatanIds.map(String) : []; wajib(ids.length >= 1 && ids.length <= MAKS_CATATAN && new Set(ids).size === ids.length && ids.every((i) => UUID.test(i)), `catatanIds wajib 1–${MAKS_CATATAN} id unik (pernyataan per bahan; bukan pernyataan massal)`, "CATATAN_TIDAK_VALID");
  const teks = norm(alasan); wajib(teks.length >= 10 && teks.length <= 500, "alasan wajib (10–500 karakter)", "ALASAN_WAJIB");
  const rujukan = norm(rujukanHash); wajib(rujukan.length >= 8 && rujukan.length <= 200, "rujukan hash manifest SO wajib (≥8 karakter)", "RUJUKAN_WAJIB");
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", `pernyataan_so:${materialId}`);
    await lockRowForUpdate(tx, "materials", materialId);
    const sama = await tx.activityEvent.findFirst({ where: { entityType: ENTITY_TYPES.PERNYATAAN_HISTORIS_SO, entityId: materialId, metadata: { path: ["idempotencyKey"], equals: k } } });
    if (sama) { const m = sama.metadata ?? {}; wajib(JSON.stringify([...(m.catatanIds ?? [])].sort()) === JSON.stringify([...ids].sort()) && m.alasan === teks && m.rujukanHash === rujukan, "Idempotency-Key ini sudah dipakai untuk isi yang berbeda", "KUNCI_DIPAKAI_LAIN", 409); return { ulang: true, id: sama.id, materialId, catatanIds: m.catatanIds }; }
    const so = (await bahanBerSOSah(tx, [materialId])).get(materialId); wajib(so, "Bahan ini belum punya hasil SO yang disahkan (Koreksi Saldo POSTED) — tidak ada yang perlu dinyatakan", "TANPA_HASIL_SO_SAH", 409);
    const notes = await tx.unitUsageNote.findMany({ where: { id: { in: ids } } }); wajib(notes.length === ids.length, "ada catatan yang tidak ditemukan", "CATATAN_TIDAK_ADA", 404);
    for (const n of notes) {
      wajib(n.materialId === materialId, `catatan ${n.id} bukan milik bahan ini — pernyataan wajib per bahan`, "CATATAN_BAHAN_LAIN", 409);
      wajib(n.origin === "EXCEL" && ["SIAP_POSTING", "PERLU_DICEK"].includes(n.state), `catatan ${n.id} berstatus ${n.state}/${n.origin}: hanya catatan Excel yang belum diposting yang bisa dinyatakan`, "CATATAN_TIDAK_BISA", 409);
      wajib(n.usedAt && n.usedAt.getTime() <= so.postedAt.getTime(), `catatan ${n.id} bertanggal sesudah hasil SO ${so.nomor} — tidak tercermin di SO`, "CATATAN_SESUDAH_SO", 409);
    }
    const aktif = await pernyataanAktif(tx, [materialId]); wajib(!ids.some((i) => aktif.has(i)), "sebagian catatan sudah dinyatakan (batalkan dulu bila perlu mengubah)", "SUDAH_DINYATAKAN", 409);
    const e = await recordActivity(tx, { entityType: ENTITY_TYPES.PERNYATAAN_HISTORIS_SO, entityId: materialId, eventType: EVENT_TYPES.SO_HISTORIS_TERCERMIN, actorId: aktor.id,
      metadata: { materialId, rujukanSO: { adjustmentRequestId: so.requestId, nomor: so.nomor, diposting: so.postedAt.toISOString() }, catatanIds: [...ids].sort(), alasan: teks, rujukanHash: rujukan, idempotencyKey: k, jumlah: ids.length } });
    return { ulang: false, id: e?.id ?? null, materialId, catatanIds: [...ids].sort(), hasilSO: so.nomor };
  }, { timeout: 30_000, maxWait: 10_000 });
}

/** Batalkan pernyataan (peristiwa baru; yang lama tidak dihapus). Catatan kembali TERTAHAN_PASCA_SO. */
export async function batalkanPernyataan(prisma, { aktor, pernyataanId, alasan }) {
  wajib(aktor?.id, "Pelaku wajib ada", "PELAKU_WAJIB", 401);
  wajib(hasPermission(aktor, P.INVENTORY_ADJUSTMENT_APPROVE), "Hanya penyetuju yang boleh membatalkan pernyataan", "BUKAN_PENYETUJU", 403);
  wajib(UUID.test(String(pernyataanId ?? "")), "id pernyataan tidak valid", "PERNYATAAN_TIDAK_VALID");
  const teks = norm(alasan); wajib(teks.length >= 10 && teks.length <= 500, "alasan pembatalan wajib (10–500 karakter)", "ALASAN_WAJIB");
  return prisma.$transaction(async (tx) => {
    const asli = await tx.activityEvent.findUnique({ where: { id: pernyataanId } });
    wajib(asli && asli.entityType === ENTITY_TYPES.PERNYATAAN_HISTORIS_SO && asli.eventType === EVENT_TYPES.SO_HISTORIS_TERCERMIN, "pernyataan tidak ditemukan", "PERNYATAAN_TIDAK_ADA", 404);
    await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", `pernyataan_so:${asli.entityId}`);
    const sudah = await tx.activityEvent.findFirst({ where: { entityType: ENTITY_TYPES.PERNYATAAN_HISTORIS_SO, eventType: EVENT_TYPES.SO_HISTORIS_DIBATALKAN, metadata: { path: ["membatalkanId"], equals: asli.id } } });
    wajib(!sudah, "pernyataan ini sudah dibatalkan", "SUDAH_DIBATALKAN", 409);
    const e = await recordActivity(tx, { entityType: ENTITY_TYPES.PERNYATAAN_HISTORIS_SO, entityId: asli.entityId, eventType: EVENT_TYPES.SO_HISTORIS_DIBATALKAN, actorId: aktor.id, metadata: { membatalkanId: asli.id, alasan: teks, catatanIds: asli.metadata?.catatanIds ?? [] } });
    return { id: e?.id ?? null, membatalkanId: asli.id, catatanIds: asli.metadata?.catatanIds ?? [] };
  }, { timeout: 30_000, maxWait: 10_000 });
}
