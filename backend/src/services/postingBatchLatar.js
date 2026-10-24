// POSTING BATCH DI LATAR (Okt 2026) — posting rencana besar (ratusan order) tanpa satu permintaan layar yang menggantung belasan menit.
//
// Prinsip (sama dengan posting sinkron — tidak ada jalur baru menulis stok): rencana DISETUJUI oleh hash → batch menyimpan salinan rencana yang disetujui → pekerja di latar mengeksekusi per unit lewat postingSatuUnit
// (satu transaksi per order, semua-atau-tidak-sama-sekali, kunci evaluasi, keadaan efektif disegarkan di dalam kunci, fail-closed bila catatan/stok bergeser).
//  • PROGRES: setiap unit selesai menulis peristiwa BATCH_UNIT; status dibaca dari peristiwa + kebenaran database (catatan DIPOSTING). Tidak ada tabel baru (tanpa migrasi): peristiwa append-only di activity_events
//    (entityType "posting_historis_batch", entityId = hash rencana).
//  • IDEMPOTENSI: id batch = hash rencana yang disetujui. Mengajukan hash yang sama = batch yang sama (tidak digandakan). Unit yang sudah diposting hanya ditautkan (postingSatuUnit idempoten).
//  • KELANJUTAN: pekerja memegang "sewa" (BATCH_LEASE, 90 dtk, diperbarui tiap unit). Proses mati → sewa kedaluwarsa → pulihkanBatch (saat boot) / POST …/lanjut meneruskan dari unit yang belum selesai.
//  • KENDALI: hentikanBatch menulis BATCH_HENTI; pekerja berhenti sebelum unit berikutnya. Jurnal HPP tidak pernah dibuat di jalur ini kecuali diminta eksplisit saat mengajukan.
import crypto from "node:crypto";
import { KoreksiError } from "./warehouseCorrection.js";
import { kunciEvaluasiCatatan } from "./catatanPemakaianHistoris.js";
import { rencanakanPosting, postingSatuUnit } from "./postingPemakaianHistoris.js";

export const ENTITAS_BATCH = "posting_historis_batch";
const SEWA_MS = 90_000;
const ID_PEKERJA = `p${process.pid}-${crypto.randomBytes(4).toString("hex")}`; // unik per proses (pid saja berulang di container)
const aktif = new Map(); // batchId → Promise pekerja di PROSES INI (cegah dua pekerja dalam satu proses)
const log = (...a) => { if (process.env.NODE_ENV !== "test") console.log("[posting-batch]", ...a); };

const bacaPeristiwa = (db, batchId) => db.activityEvent.findMany({ where: { entityType: ENTITAS_BATCH, entityId: batchId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
function ringkas(batchId, ev) {
  const dia = ev.find((e) => e.eventType === "BATCH_DIAJUKAN");
  if (!dia) return null;
  const spec = dia.metadata; const unitIds = spec.unitUrut;
  const hasilUnit = new Map(); for (const e of ev) if (e.eventType === "BATCH_UNIT") hasilUnit.set(e.metadata.unitId, e.metadata);
  const selesai = ev.find((e) => e.eventType === "BATCH_SELESAI"); const henti = ev.filter((e) => e.eventType === "BATCH_HENTI" || e.eventType === "BATCH_LANJUT").at(-1);
  const sewa = ev.filter((e) => e.eventType === "BATCH_LEASE").at(-1);
  const gagal = [...hasilUnit.values()].filter((h) => h.hasil === "GAGAL");
  const diposting = [...hasilUnit.values()].reduce((n, h) => n + (h.hasil === "DIPOSTING" ? h.jumlah : 0), 0);
  const dihentikan = henti?.eventType === "BATCH_HENTI";
  const sewaAktif = !!sewa && new Date(sewa.metadata.sampai).getTime() > Date.now();
  let status = "MENUNGGU";
  if (selesai) status = selesai.metadata.status; else if (dihentikan) status = "DIHENTIKAN"; else if (sewaAktif) status = "BERJALAN"; else if (sewa) status = "TERPUTUS";
  return {
    batchId, hash: spec.hash, status, rujukan: spec.rujukan, disetujuiOleh: spec.disetujuiOleh, jurnalHPP: spec.jurnalHPP,
    totalUnit: unitIds.length, unitSelesai: hasilUnit.size, unitGagal: gagal.length, transaksiTotal: spec.rencana.length, transaksiDiposting: diposting,
    diajukanPada: dia.createdAt, terakhir: ev.at(-1)?.createdAt ?? null, selesaiPada: selesai?.createdAt ?? null,
    gagal: gagal.map((g) => ({ unitId: g.unitId, order: g.order, kode: g.kode, pesan: g.pesan })),
    unitBerikut: unitIds.filter((u) => !hasilUnit.has(u)).slice(0, 5),
  };
}
export async function statusBatch(db, batchId) {
  const s = ringkas(batchId, await bacaPeristiwa(db, batchId));
  if (!s) throw new KoreksiError("Batch posting tidak ditemukan", 404, "BATCH_TIDAK_ADA");
  return s;
}

/** Ajukan batch dari rencana yang DISETUJUI (hash). Idempoten: hash yang sama = batch yang sama. Tidak menjalankan apa pun — panggil mulaiBatch. */
export async function ajukanBatch(prisma, { persetujuan, aktor, jurnalHPP = false, unitIds = null }) {
  if (!aktor?.id) throw new KoreksiError("Pelaku wajib ada", 400, "PELAKU_WAJIB");
  if (!persetujuan?.hashDisetujui || String(persetujuan.rujukan ?? "").trim().length < 8 || !persetujuan.disetujuiOleh) throw new KoreksiError("Batch posting butuh hash rencana yang disetujui, rujukan persetujuan Owner (≥8 karakter), dan nama penyetuju", 403, "PERSETUJUAN_WAJIB");
  // IDEMPOTENSI: batch dengan hash ini sudah ada (berjalan/selesai) → kembalikan batch itu; rencana saat ini boleh sudah berbeda karena batch itu sendiri sudah memposting.
  if (/^[0-9a-f]{64}$/.test(persetujuan.hashDisetujui)) { const ada = ringkas(persetujuan.hashDisetujui, await bacaPeristiwa(prisma, persetujuan.hashDisetujui)); if (ada) return { ...ada, baru: false }; }
  const rencana = await rencanakanPosting(prisma, { unitIds });
  if (rencana.hash !== persetujuan.hashDisetujui) throw new KoreksiError("Rencana posting saat ini BERBEDA dari yang disetujui — batch tidak dibuat. Minta persetujuan ulang atas daftar terbaru.", 409, "RENCANA_BERUBAH", { hashSekarang: rencana.hash });
  if (!rencana.jumlah) throw new KoreksiError("Rencana kosong — tidak ada yang diposting", 409, "RENCANA_KOSONG");
  const batchId = rencana.hash;
  const unitUrut = [...new Set(rencana.transaksi.map((t) => t.unitId))];
  const baru = await prisma.$transaction(async (tx) => {
    await kunciEvaluasiCatatan(tx);
    if (await tx.activityEvent.findFirst({ where: { entityType: ENTITAS_BATCH, entityId: batchId, eventType: "BATCH_DIAJUKAN" }, select: { id: true } })) return false;
    await tx.activityEvent.create({ data: { entityType: ENTITAS_BATCH, entityId: batchId, eventType: "BATCH_DIAJUKAN", actorType: "USER", actorId: aktor.id, metadata: {
      hash: rencana.hash, rujukan: persetujuan.rujukan, disetujuiOleh: persetujuan.disetujuiOleh, aktorId: aktor.id, jurnalHPP: jurnalHPP === true, unitUrut,
      rencana: rencana.transaksi.map((t) => ({ kunci: t.kunci, unitId: t.unitId, orderNumber: t.orderNumber, materialId: t.materialId, kodeBahan: t.kodeBahan, satuan: t.satuan, qty: t.qty, tanggal: t.tanggal, usedAt: t.usedAt, createdAtUTC: t.createdAtUTC, catatanIds: t.catatanIds })),
    } } });
    return true;
  }, { timeout: 60_000 });
  return { ...(await statusBatch(prisma, batchId)), baru };
}

async function ambilSewa(prisma, batchId, pekerja) {
  return prisma.$transaction(async (tx) => {
    await kunciEvaluasiCatatan(tx);
    const ev = await bacaPeristiwa(tx, batchId); const s = ringkas(batchId, ev);
    if (!s) throw new KoreksiError("Batch posting tidak ditemukan", 404, "BATCH_TIDAK_ADA");
    if (["SELESAI", "SELESAI_SEBAGIAN", "DIHENTIKAN"].includes(s.status)) return { ok: false, status: s.status };
    const sewa = ev.filter((e) => e.eventType === "BATCH_LEASE").at(-1);
    if (sewa && sewa.metadata.pekerja !== pekerja && new Date(sewa.metadata.sampai).getTime() > Date.now()) return { ok: false, status: "BERJALAN" };
    await tx.activityEvent.create({ data: { entityType: ENTITAS_BATCH, entityId: batchId, eventType: "BATCH_LEASE", actorType: "SYSTEM", metadata: { pekerja, sampai: new Date(Date.now() + SEWA_MS).toISOString() } } });
    return { ok: true, spec: ev.find((e) => e.eventType === "BATCH_DIAJUKAN").metadata };
  }, { timeout: 30_000 });
}
const perbaruiSewa = (prisma, batchId, pekerja) => prisma.activityEvent.create({ data: { entityType: ENTITAS_BATCH, entityId: batchId, eventType: "BATCH_LEASE", actorType: "SYSTEM", metadata: { pekerja, sampai: new Date(Date.now() + SEWA_MS).toISOString() } } });

/** Pekerja: eksekusi unit yang belum selesai. Bisa dipanggil berulang/serentak — sewa memastikan satu pekerja aktif. Mengembalikan status akhir. */
export async function jalankanBatch(prisma, batchId, { pekerja = ID_PEKERJA, jedaMs = 0, setelahUnit = null } = {}) {
  const sewa = await ambilSewa(prisma, batchId, pekerja);
  if (!sewa.ok) return { batchId, status: sewa.status, dijalankan: false };
  const spec = sewa.spec; const aktor = { id: spec.aktorId }; const persetujuan = { hashDisetujui: spec.hash, rujukan: spec.rujukan, disetujuiOleh: spec.disetujuiOleh };
  const ev0 = await bacaPeristiwa(prisma, batchId); const sudah = new Set(ev0.filter((e) => e.eventType === "BATCH_UNIT").map((e) => e.metadata.unitId));
  const perUnit = new Map(); for (const t of spec.rencana) (perUnit.get(t.unitId) ?? perUnit.set(t.unitId, []).get(t.unitId)).push(t);
  for (const unitId of spec.unitUrut) {
    if (sudah.has(unitId)) continue;
    const ev = await bacaPeristiwa(prisma, batchId); const s = ringkas(batchId, ev);
    if (s.status === "DIHENTIKAN") return { batchId, status: "DIHENTIKAN", dijalankan: true };
    const tersimpan = perUnit.get(unitId);
    // Rencana unit HARUS masih persis yang disetujui (nilai, tanggal, catatan). Bergeser → unit ini gugur (fail-closed), batch lanjut ke unit lain.
    const kini = await rencanakanPosting(prisma, { unitIds: [unitId] }); const sudahPosting = await prisma.unitUsageNote.count({ where: { id: { in: tersimpan.flatMap((t) => t.catatanIds) }, state: "DIPOSTING" } });
    const sama = (a, b) => JSON.stringify(a.map((t) => [t.kunci, t.materialId, t.qty, t.createdAtUTC, [...t.catatanIds].sort()])) === JSON.stringify(b.map((t) => [t.kunci, t.materialId, t.qty, t.createdAtUTC, [...t.catatanIds].sort()]));
    let h;
    if (sudahPosting === tersimpan.flatMap((t) => t.catatanIds).length) h = await postingSatuUnit(prisma, { unitId, daftar: tersimpan, persetujuan, aktor, jurnalHPP: spec.jurnalHPP }); // pemulihan: sudah diposting → hanya ditautkan (DILEWATI)
    else if (!sama(kini.transaksi, tersimpan)) h = { status: "GAGAL", kode: "RENCANA_BERUBAH", pesan: "Catatan/stok unit ini bergeser sejak rencana disetujui — tidak diposting", ok: [], lewat: [] };
    else h = await postingSatuUnit(prisma, { unitId, daftar: tersimpan, persetujuan, aktor, jurnalHPP: spec.jurnalHPP });
    await prisma.activityEvent.create({ data: { entityType: ENTITAS_BATCH, entityId: batchId, eventType: "BATCH_UNIT", actorType: "SYSTEM", metadata: {
      unitId, order: tersimpan[0].orderNumber, hasil: h.status === "GAGAL" ? "GAGAL" : h.status, jumlah: h.ok.length, dilewati: h.lewat.length, kode: h.kode ?? null, pesan: h.pesan ?? null } } });
    await perbaruiSewa(prisma, batchId, pekerja);
    if (setelahUnit) await setelahUnit(unitId, h);
    if (jedaMs) await new Promise((r) => setTimeout(r, jedaMs));
  }
  const akhir = ringkas(batchId, await bacaPeristiwa(prisma, batchId));
  const status = akhir.unitGagal ? "SELESAI_SEBAGIAN" : "SELESAI";
  await prisma.activityEvent.create({ data: { entityType: ENTITAS_BATCH, entityId: batchId, eventType: "BATCH_SELESAI", actorType: "SYSTEM", metadata: { status, diposting: akhir.transaksiDiposting, gagal: akhir.unitGagal } } });
  return { batchId, status, dijalankan: true };
}

/** Jalankan di LATAR (tidak menahan permintaan). Satu pekerja per batch per proses. */
export function mulaiBatch(prisma, batchId, opsi = {}) {
  if (aktif.has(batchId)) return aktif.get(batchId);
  const p = (async () => { try { return await jalankanBatch(prisma, batchId, opsi); } catch (e) { log("gagal", batchId, e.message); return { batchId, status: "GALAT", pesan: e.message }; } finally { aktif.delete(batchId); } })();
  aktif.set(batchId, p);
  return p;
}
export async function tungguBatch(batchId) { while (aktif.has(batchId)) await aktif.get(batchId); }

export async function hentikanBatch(prisma, batchId, aktor) {
  await statusBatch(prisma, batchId);
  await prisma.activityEvent.create({ data: { entityType: ENTITAS_BATCH, entityId: batchId, eventType: "BATCH_HENTI", actorType: "USER", actorId: aktor.id, metadata: {} } });
  return statusBatch(prisma, batchId);
}
export async function lanjutkanBatch(prisma, batchId, aktor) {
  const s = await statusBatch(prisma, batchId);
  if (["SELESAI", "SELESAI_SEBAGIAN"].includes(s.status)) return s;
  if (s.status === "DIHENTIKAN") await prisma.activityEvent.create({ data: { entityType: ENTITAS_BATCH, entityId: batchId, eventType: "BATCH_LANJUT", actorType: "USER", actorId: aktor.id, metadata: {} } });
  mulaiBatch(prisma, batchId);
  return statusBatch(prisma, batchId);
}
/** Saat boot: teruskan batch yang terputus (sewa kedaluwarsa, belum selesai/dihentikan). Mengembalikan id yang diteruskan. */
export async function pulihkanBatch(prisma) {
  const dia = await prisma.activityEvent.findMany({ where: { entityType: ENTITAS_BATCH, eventType: "BATCH_DIAJUKAN" }, select: { entityId: true } });
  const diteruskan = [];
  for (const { entityId } of dia) {
    const s = ringkas(entityId, await bacaPeristiwa(prisma, entityId));
    if (!s) continue;
    if (["TERPUTUS", "MENUNGGU"].includes(s.status)) { mulaiBatch(prisma, entityId); diteruskan.push(entityId); }
    else if (s.status === "BERJALAN") { const t = setTimeout(() => { mulaiBatch(prisma, entityId); }, SEWA_MS + 1000); t.unref?.(); diteruskan.push(entityId); } // sewa pekerja proses lama (sudah mati) kedaluwarsa dulu
  }
  return diteruskan;
}
