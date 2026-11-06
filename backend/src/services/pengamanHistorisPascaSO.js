// PENGAMAN POSTING HISTORIS PASCA-SO (Nov 2026) — pemakaian bertanggal SEBELUM/PADA tanggal SO tidak boleh mengurangi stok DUA KALI.
//
// Masalah: posting historis menulis ISSUE bertanggal lama; saldo = Σ semua pergerakan tanpa melihat tanggal. Bila fisik hasil SO (Koreksi Saldo → ADJUSTMENT) dihitung SETELAH pemakaian itu terjadi,
// ISSUE historis yang diposting sesudahnya mengurangi lagi — diam-diam.
//
// Dasar pengaman = TAUTAN SO EKSPLISIT, bukan "semua Koreksi Saldo" dan bukan pencarian teks alasan:
//   • Penyetuju (inventory:adjustment_approve) menautkan SO ke BAHAN dengan tanggal SO (batas = akhir hari tanggal itu, WIB — jam tidak direka), sumber, alasan, rujukan hash manifest, dan (opsional, dapat dilengkapi
//     kemudian lewat tautan pengganti) dokumen Koreksi Saldo. Tautan berlaku SEJAK dibuat — jadi dapat dipasang SEBELUM SO diposting dan menutup jendela "SO diposting, tautan belum ada".
//   • Koreksi biasa (mis. koreksi data 27 Okt) TIDAK pernah menahan apa pun: tanpa tautan, rencana posting dan hash IDENTIK dengan sebelumnya.
//   • Catatan EXCEL milik bahan bertautan yang bertanggal pakai ≤ batas SO → TERTAHAN_PASCA_SO: keluar dari rencana dan DITOLAK di dalam transaksi posting (fail-closed). Catatan sesudah batas: alur biasa.
//   • Penyelesaian per CATATAN (tidak pernah otomatis seluruh catatan satu bahan), oleh penyetuju, dengan alasan + rujukan:
//       TERCERMIN       → TERCERMIN_DI_SO: tersimpan sebagai riwayat, TIDAK membuat ISSUE, ledger tidak berubah.
//       BELUM_TERCERMIN → DILEPAS_BELUM_TERCERMIN: benar-benar belum tercermin di fisik SO; dilepas ke alur posting biasa (ISSUE bertanggal historis) atas tanggung jawab pernyataan yang tercatat.
//     Catatan yang tidak dinyatakan tetap ditahan. Semua append-only (entity pernyataan_historis_so); pembatalan = peristiwa baru.
//   • Hash rencana mengikat himpunan tertahan/tercermin/dilepas + tautan; persetujuan atas rencana lama tidak bisa dipakai untuk rencana berbeda. Pemosting historis tidak boleh pelaku pernyataan pada rencananya.
//   Tidak ada jalur baru menulis stok, harga, valuasi, jurnal, PSA, atau GR. Aditif, tanpa migrasi.
import crypto from "node:crypto";
import { MaterialUnit, MaterialCategory } from "@prisma/client";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../lib/activityLog.js";
import { hasPermission } from "../middleware/authorize.js";
import { PERMISSIONS as P } from "../constants/permissions.js";
import { KoreksiError } from "./warehouseCorrection.js";
import { lockRowForUpdate } from "./inventoryLedger.js";

export const KEADAAN_PENGAMAN = Object.freeze({ TERTAHAN_PASCA_SO: "TERTAHAN_PASCA_SO", TERCERMIN_DI_SO: "TERCERMIN_DI_SO", DILEPAS_BELUM_TERCERMIN: "DILEPAS_BELUM_TERCERMIN" });
export const ARAH = Object.freeze({ TERCERMIN: "TERCERMIN", BELUM_TERCERMIN: "BELUM_TERCERMIN" });
export const TEKS_PENGAMAN = Object.freeze({
  TERTAHAN_PASCA_SO: "SO bahan ini sudah ditautkan. Catatan pemakaian bertanggal sampai tanggal SO ditahan agar stok tidak berkurang dua kali; nyatakan per catatan: sudah tercermin di SO, atau memang belum tercermin.",
  TERCERMIN_DI_SO: "Dinyatakan sudah tercermin di hasil SO: tersimpan sebagai riwayat, TIDAK dibuat pengeluaran stok.",
  DILEPAS_BELUM_TERCERMIN: "Dinyatakan memang belum tercermin di hasil SO: dilepas ke posting historis biasa atas pernyataan penyetuju yang tercatat.",
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAKS_CATATAN = 200;
const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const wibTgl = (d) => new Date(new Date(d).getTime() + 7 * 3600_000).toISOString().slice(0, 10);
const batasDariTanggal = (tgl) => new Date(`${tgl}T23:59:59.999+07:00`);
const wajib = (c, m, code, status = 400) => { if (!c) throw new KoreksiError(m, status, code); };
const wajibPenyetuju = (aktor, aksi) => { wajib(aktor?.id, "Pelaku wajib ada", "PELAKU_WAJIB", 401); wajib(hasPermission(aktor, P.INVENTORY_ADJUSTMENT_APPROVE), `Hanya penyetuju (OWNER/FINANCE, inventory:adjustment_approve) yang boleh ${aksi}`, "BUKAN_PENYETUJU", 403); };
const wajibKunci = (kunci) => { const k = String(kunci ?? "").trim(); wajib(k.length >= 8 && k.length <= 100, "Idempotency-Key wajib (8–100 karakter)", "KUNCI_WAJIB", 428); return k; };
const eventsMateri = (db, materialIds) => db.activityEvent.findMany({ where: { entityType: ENTITY_TYPES.PERNYATAAN_HISTORIS_SO, ...(materialIds ? { entityId: { in: [...new Set(materialIds)] } } : {}) }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });

/** Tautan SO AKTIF per bahan (tidak dibatalkan, tidak digantikan). Map(materialId → { id, soTanggal, batas, dokumen, sumber, rujukanHash, pelakuId, waktu }). */
export async function tautanSOAktif(db, materialIds = null) {
  if (materialIds && !materialIds.length) return new Map();
  const ev = await eventsMateri(db, materialIds); const mati = new Set();
  for (const e of ev) { if (e.eventType === EVENT_TYPES.SO_TAUTAN_DIBATALKAN && e.metadata?.membatalkanId) mati.add(e.metadata.membatalkanId); if (e.eventType === EVENT_TYPES.SO_DITAUTKAN && e.metadata?.menggantikanId) mati.add(e.metadata.menggantikanId); }
  const peta = new Map();
  for (const e of ev) { if (e.eventType !== EVENT_TYPES.SO_DITAUTKAN || mati.has(e.id)) continue; const m = e.metadata ?? {}; peta.set(e.entityId, { id: e.id, soTanggal: m.soTanggal, batas: new Date(m.batasUTC), dokumen: m.dokumen ?? null, sumber: m.sumber, rujukanHash: m.rujukanHash, pelakuId: e.actorId, waktu: e.createdAt }); }
  return peta;
}

/** Pernyataan AKTIF per catatan. Map(noteId → { id, arah, pelakuId, materialId, alasan, rujukanHash, waktu }). */
export async function pernyataanAktif(db, materialIds = null) {
  if (materialIds && !materialIds.length) return new Map();
  const ev = await eventsMateri(db, materialIds); const batal = new Set(ev.filter((e) => e.eventType === EVENT_TYPES.SO_HISTORIS_DIBATALKAN).map((e) => e.metadata?.membatalkanId)); const peta = new Map();
  for (const e of ev) { if (e.eventType !== EVENT_TYPES.SO_HISTORIS_DINYATAKAN || batal.has(e.id)) continue; for (const nid of e.metadata?.catatanIds ?? []) peta.set(nid, { id: e.id, arah: e.metadata?.arah, pelakuId: e.actorId, materialId: e.entityId, alasan: e.metadata?.alasan, rujukanHash: e.metadata?.rujukanHash, waktu: e.createdAt }); }
  return peta;
}

/** Klasifikasi baca-saja untuk catatan { id, materialId, usedAt }: Map(noteId → { keadaan, tautan, pernyataan? }). Catatan yang tidak terkena pengaman TIDAK ada di peta. */
export async function klasifikasiPengaman(db, notes) {
  const daftar = notes.filter((n) => n.materialId && n.usedAt); if (!daftar.length) return new Map();
  const ids = [...new Set(daftar.map((n) => n.materialId))]; const tautan = await tautanSOAktif(db, ids); if (!tautan.size) return new Map();
  const pern = await pernyataanAktif(db, [...tautan.keys()]); const hasil = new Map();
  for (const n of daftar) {
    const t = tautan.get(n.materialId); if (!t || new Date(n.usedAt).getTime() > t.batas.getTime()) continue; // tanpa tautan, atau bertanggal SESUDAH batas SO: alur biasa
    const p = pern.get(n.id); const sah = p && p.materialId === n.materialId;
    hasil.set(n.id, !sah ? { keadaan: KEADAAN_PENGAMAN.TERTAHAN_PASCA_SO, tautan: t } : p.arah === ARAH.TERCERMIN ? { keadaan: KEADAAN_PENGAMAN.TERCERMIN_DI_SO, tautan: t, pernyataan: p } : { keadaan: KEADAAN_PENGAMAN.DILEPAS_BELUM_TERCERMIN, tautan: t, pernyataan: p });
  }
  return hasil;
}

/** Hash rencana: IDENTIK dengan hash lama bila tidak ada catatan terkena pengaman; selain itu mengikat tertahan + tercermin + dilepas + tautan. */
export function hashDenganPengaman(hashDasar, { tertahan = [], tercermin = [], dilepas = [] } = {}) {
  if (!tertahan.length && !tercermin.length && !dilepas.length) return hashDasar;
  const par = (a) => a.map((t) => [t.catatanId, t.pernyataanId ?? null, t.tautanId]).sort((x, y) => String(x[0]).localeCompare(String(y[0])));
  return crypto.createHash("sha256").update(JSON.stringify([hashDasar, par(tertahan), par(tercermin), par(dilepas)])).digest("hex");
}

/** Pemosting historis tidak boleh pelaku pernyataan (tercermin maupun dilepas) yang tercakup rencananya. */
export function wajibBukanPenyatakan(rencana, aktor) {
  const sama = [...(rencana.tercermin ?? []), ...(rencana.dilepas ?? [])].filter((t) => t.pelakuId && t.pelakuId === aktor?.id);
  if (sama.length) throw new KoreksiError("Pemosting historis tidak boleh orang yang menyatakan status catatan terhadap SO pada rencana ini — minta penyetuju lain memulai posting.", 403, "PENYATAAN_OLEH_PEMOSTING", { jumlah: sama.length });
}

/** Penjaga DI DALAM transaksi posting: catatan yang akan menjadi ISSUE tidak boleh tertahan/tercermin. Mengunci baris bahan lebih dulu (serial dengan tindakan lain pada bahan itu). */
export async function wajibTidakTerkenaPengaman(tx, notes) {
  for (const mid of [...new Set(notes.map((n) => n.materialId).filter(Boolean))].sort()) await lockRowForUpdate(tx, "materials", mid);
  const k = await klasifikasiPengaman(tx, notes); const buruk = notes.find((n) => { const v = k.get(n.id); return v && v.keadaan !== KEADAAN_PENGAMAN.DILEPAS_BELUM_TERCERMIN; });
  if (buruk) { const v = k.get(buruk.id); throw new KoreksiError(`Catatan pemakaian ${buruk.orderNumber ?? ""} tidak boleh diposting: ${v.keadaan} (SO ${v.tautan.soTanggal}, batas ${v.tautan.batas.toISOString()}). ${TEKS_PENGAMAN[v.keadaan]}`, 409, v.keadaan, { jumlahTerkena: [...k.values()].filter((x) => x.keadaan !== KEADAAN_PENGAMAN.DILEPAS_BELUM_TERCERMIN).length }); }
}

/** Daftar baca-saja: tautan aktif + catatan terkena pengaman beserta keadaan. */
export async function daftarPengaman(db, { materialId = null } = {}) {
  const tautan = await tautanSOAktif(db, materialId ? [materialId] : null);
  if (!tautan.size) return { jumlahBahan: 0, tertahan: 0, tercermin: 0, dilepas: 0, tautan: [], baris: [] };
  const notes = await db.unitUsageNote.findMany({ where: { origin: "EXCEL", state: { in: ["SIAP_POSTING", "PERLU_DICEK"] }, materialId: { in: [...tautan.keys()] }, usedAt: { not: null } }, include: { material: { select: { code: true, unit: true } } }, orderBy: [{ orderNumber: "asc" }, { sourceRow: "asc" }] });
  const k = await klasifikasiPengaman(db, notes);
  const baris = notes.filter((n) => k.has(n.id)).map((n) => { const v = k.get(n.id); return { catatanId: n.id, materialId: n.materialId, kodeBahan: n.material.code, satuan: n.material.unit, order: n.orderNumber, qty: Number(n.qty), tanggalPakai: n.usedAt.toISOString(), keadaan: v.keadaan, teks: TEKS_PENGAMAN[v.keadaan], tautanId: v.tautan.id, soTanggal: v.tautan.soTanggal, pernyataan: v.pernyataan ? { id: v.pernyataan.id, arah: v.pernyataan.arah, alasan: v.pernyataan.alasan, rujukanHash: v.pernyataan.rujukanHash, waktu: v.pernyataan.waktu } : null }; });
  const hitung = (x) => baris.filter((b) => b.keadaan === x).length;
  return { jumlahBahan: new Set(baris.map((b) => b.materialId)).size, tertahan: hitung(KEADAAN_PENGAMAN.TERTAHAN_PASCA_SO), tercermin: hitung(KEADAAN_PENGAMAN.TERCERMIN_DI_SO), dilepas: hitung(KEADAAN_PENGAMAN.DILEPAS_BELUM_TERCERMIN),
    tautan: [...tautan.entries()].map(([mid, t]) => ({ materialId: mid, tautanId: t.id, soTanggal: t.soTanggal, batas: t.batas.toISOString(), dokumen: t.dokumen, sumber: t.sumber, rujukanHash: t.rujukanHash, waktu: t.waktu })), baris };
}

/** Tautkan SO ke BAHAN (penyetuju). Berlaku sejak dibuat. Satu tautan aktif per bahan; mengubah/melengkapi dokumen = tautan PENGGANTI (menggantikanId), riwayat utuh. Idempoten per kunci. */
export async function tautkanSO(prisma, { aktor, materialId, soTanggal, sumber, alasan, rujukanHash, dokumenId = null, menggantikanId = null, kunci }) {
  wajibPenyetuju(aktor, "menautkan SO ke bahan"); const k = wajibKunci(kunci);
  wajib(UUID.test(String(materialId ?? "")), "bahan tidak valid", "BAHAN_TIDAK_VALID");
  wajib(/^\d{4}-\d{2}-\d{2}$/.test(String(soTanggal ?? "")) && !Number.isNaN(Date.parse(`${soTanggal}T00:00:00Z`)), "tanggal SO wajib (YYYY-MM-DD)", "TANGGAL_SO_WAJIB");
  wajib(String(soTanggal) <= wibTgl(new Date()), "tanggal SO tidak boleh di masa depan", "TANGGAL_SO_MASA_DEPAN");
  const s = norm(sumber); wajib(s.length >= 3 && s.length <= 300, "sumber wajib (3–300 karakter, mis. berkas SO dan rencana)", "SUMBER_WAJIB");
  const a = norm(alasan); wajib(a.length >= 10 && a.length <= 500, "alasan wajib (10–500 karakter)", "ALASAN_WAJIB");
  const r = norm(rujukanHash); wajib(r.length >= 8 && r.length <= 200, "rujukan hash manifest SO wajib (≥8 karakter)", "RUJUKAN_WAJIB");
  if (dokumenId !== null && dokumenId !== undefined) wajib(UUID.test(String(dokumenId)), "dokumenId tidak valid", "DOKUMEN_TIDAK_VALID");
  if (menggantikanId) wajib(UUID.test(String(menggantikanId)), "menggantikanId tidak valid", "MENGGANTIKAN_TIDAK_VALID");
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", `pernyataan_so:${materialId}`); await lockRowForUpdate(tx, "materials", materialId);
    const bahan = await tx.material.findUnique({ where: { id: materialId }, select: { id: true, code: true } }); wajib(bahan, "bahan tidak ditemukan", "BAHAN_TIDAK_ADA", 404);
    const sama = await tx.activityEvent.findFirst({ where: { entityType: ENTITY_TYPES.PERNYATAAN_HISTORIS_SO, entityId: materialId, metadata: { path: ["idempotencyKey"], equals: k } } });
    if (sama) { const m = sama.metadata ?? {}; wajib(sama.eventType === EVENT_TYPES.SO_DITAUTKAN && m.soTanggal === soTanggal && m.sumber === s && m.alasan === a && m.rujukanHash === r && (m.dokumen?.id ?? null) === (dokumenId ?? null) && (m.menggantikanId ?? null) === (menggantikanId ?? null), "Idempotency-Key ini sudah dipakai untuk isi yang berbeda", "KUNCI_DIPAKAI_LAIN", 409); return { ulang: true, id: sama.id, materialId, soTanggal }; }
    const aktif = (await tautanSOAktif(tx, [materialId])).get(materialId);
    if (aktif) wajib(menggantikanId && menggantikanId === aktif.id, `Bahan ini sudah punya tautan SO aktif (${aktif.soTanggal}). Mengubah/melengkapi wajib menunjuk tautan itu lewat menggantikanId — riwayat tidak dihapus.`, "SUDAH_ADA_TAUTAN", 409);
    else wajib(!menggantikanId, "tidak ada tautan aktif untuk digantikan", "TIDAK_ADA_YANG_DIGANTIKAN", 409);
    let dokumen = null;
    if (dokumenId) {
      const [d] = await tx.$queryRaw`SELECT r.id::text AS id, r.adjustment_number AS nomor, r.status::text AS status, r.posted_at AS "postedAt", k.material_id::text AS "materialId" FROM stock_adjustment_requests r JOIN koreksi_saldo_bahan k ON k.adjustment_request_id = r.id WHERE r.id = ${dokumenId}::uuid`;
      wajib(d, "dokumen Koreksi Saldo tidak ditemukan", "DOKUMEN_TIDAK_ADA", 404); wajib(d.materialId === materialId, "dokumen itu milik bahan lain — tautan wajib per bahan", "DOKUMEN_BAHAN_LAIN", 409);
      wajib(!["CANCELLED", "REJECTED"].includes(d.status), `dokumen ${d.nomor} berstatus ${d.status}`, "DOKUMEN_TIDAK_BERLAKU", 409);
      if (d.postedAt) wajib(soTanggal <= wibTgl(d.postedAt), `tanggal SO ${soTanggal} sesudah tanggal posting dokumen ${d.nomor}`, "SO_SESUDAH_DOKUMEN", 409);
      dokumen = { id: d.id, nomor: d.nomor, status: d.status, diposting: d.postedAt ? new Date(d.postedAt).toISOString() : null };
    }
    const e = await recordActivity(tx, { entityType: ENTITY_TYPES.PERNYATAAN_HISTORIS_SO, entityId: materialId, eventType: EVENT_TYPES.SO_DITAUTKAN, actorId: aktor.id,
      metadata: { materialId, kode: bahan.code, soTanggal, batasUTC: batasDariTanggal(soTanggal).toISOString(), sumber: s, alasan: a, rujukanHash: r, dokumen, menggantikanId: menggantikanId ?? null, idempotencyKey: k } });
    return { ulang: false, id: e.id, materialId, soTanggal, batas: batasDariTanggal(soTanggal).toISOString(), dokumen };
  }, { timeout: 30_000, maxWait: 10_000 });
}

/**
 * MASTER BARU + TAUTAN SO DALAM SATU TRANSAKSI (atomik; semua berhasil bersama atau gagal tanpa sisa).
 * Mengapa: sistem memetakan catatan historis ke master baru bila nama/kode persis sama (evaluasi ulang, juga dipicu pembacaan daftar). Bila master dibuat dulu lalu ditautkan kemudian, ada jendela
 * ketika catatan lama bisa terpetakan tanpa pengaman. Di sini master dan tautan SO baru terlihat oleh transaksi lain pada COMMIT yang SAMA, jadi pemetaan/posting yang muncul sesudahnya
 * selalu menemukan tautan aktif (TERTAHAN_PASCA_SO, fail-closed). Tidak memetakan catatan, tidak menulis stok/harga/valuasi/jurnal/PSA/GR, tidak membuat deklarasi.
 * Hanya MEMBUAT master baru: kode atau nama yang sudah ada menggagalkan seluruh permintaan (tidak pernah menautkan ke bahan lama lewat jalur ini). Penyetuju + izin inventory:write.
 */
export async function buatMasterBertautan(prisma, { aktor, bahan, soTanggal, sumber, alasan, rujukanHash, kunci }) {
  wajibPenyetuju(aktor, "membuat master baru beserta tautan SO"); wajib(hasPermission(aktor, P.INVENTORY_WRITE), "Membuat master wajib izin inventory:write", "TANPA_IZIN_MASTER", 403);
  const k = wajibKunci(kunci);
  const daftar = Array.isArray(bahan) ? bahan : []; wajib(daftar.length >= 1 && daftar.length <= 10, "bahan wajib 1–10 master", "BAHAN_TIDAK_VALID");
  const unitSah = Object.values(MaterialUnit); const kategoriSah = Object.values(MaterialCategory);
  const baru = daftar.map((b) => {
    const code = String(b?.code ?? "").trim().toUpperCase(); const name = norm(b?.name);
    wajib(code.length >= 3 && code.length <= 80 && /^[A-Z0-9][A-Z0-9._-]*$/.test(code), "kode master tidak valid (huruf besar, angka, titik, strip, garis bawah)", "KODE_TIDAK_VALID");
    wajib(name.length >= 3 && name.length <= 200, "nama master wajib (3–200 karakter)", "NAMA_TIDAK_VALID");
    wajib(unitSah.includes(b?.unit), "satuan tidak valid", "SATUAN_TIDAK_VALID"); wajib(kategoriSah.includes(b?.category), "kategori wajib dan harus valid", "KATEGORI_TIDAK_VALID");
    return { code, name, unit: b.unit, category: b.category };
  });
  wajib(new Set(baru.map((b) => b.code)).size === baru.length && new Set(baru.map((b) => b.name.toUpperCase())).size === baru.length, "kode atau nama ganda dalam satu permintaan", "MASTER_GANDA");
  wajib(/^\d{4}-\d{2}-\d{2}$/.test(String(soTanggal ?? "")) && !Number.isNaN(Date.parse(`${soTanggal}T00:00:00Z`)), "tanggal SO wajib (YYYY-MM-DD)", "TANGGAL_SO_WAJIB");
  wajib(String(soTanggal) <= wibTgl(new Date()), "tanggal SO tidak boleh di masa depan", "TANGGAL_SO_MASA_DEPAN");
  const s = norm(sumber); wajib(s.length >= 3 && s.length <= 300, "sumber wajib (3–300 karakter)", "SUMBER_WAJIB");
  const a = norm(alasan); wajib(a.length >= 10 && a.length <= 500, "alasan wajib (10–500 karakter)", "ALASAN_WAJIB");
  const r = norm(rujukanHash); wajib(r.length >= 8 && r.length <= 200, "rujukan hash manifest wajib (≥8 karakter)", "RUJUKAN_WAJIB");
  return prisma.$transaction(async (tx) => {
    for (const b of [...baru].sort((x, y) => x.code.localeCompare(y.code))) await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", `master_baru:${b.code}`);
    // ulang (idempoten): SEMUA master sudah ada DAN masing-masing membawa tautan dengan kunci + isi sama → kembalikan hasil lama tanpa menulis
    const ada = await tx.material.findMany({ where: { code: { in: baru.map((b) => b.code) } }, select: { id: true, code: true, name: true, unit: true, category: true } });
    if (ada.length) {
      wajib(ada.length === baru.length, "sebagian master sudah ada — seluruh permintaan ditolak (tidak ada yang dibuat)", "MASTER_SUDAH_ADA", 409);
      const hasil = [];
      for (const m of ada) {
        const b = baru.find((x) => x.code === m.code); const e = await tx.activityEvent.findFirst({ where: { entityType: ENTITY_TYPES.PERNYATAAN_HISTORIS_SO, entityId: m.id, eventType: EVENT_TYPES.SO_DITAUTKAN, metadata: { path: ["idempotencyKey"], equals: k } } });
        wajib(e && m.name === b.name && m.unit === b.unit && m.category === b.category && e.metadata?.soTanggal === soTanggal && e.metadata?.sumber === s && e.metadata?.alasan === a && e.metadata?.rujukanHash === r, "Master dengan kode ini sudah ada dan bukan hasil permintaan ini", "MASTER_SUDAH_ADA", 409);
        hasil.push({ materialId: m.id, kode: m.code, tautanId: e.id });
      }
      return { ulang: true, soTanggal, bahan: hasil };
    }
    for (const b of baru) {
      const kembar = await tx.material.findFirst({ where: { name: { equals: b.name, mode: "insensitive" } }, select: { code: true } });
      wajib(!kembar, `nama master sudah dipakai oleh ${kembar?.code} — seluruh permintaan ditolak (tidak ada yang dibuat)`, "NAMA_SUDAH_ADA", 409);
    }
    const hasil = [];
    for (const b of baru) {
      const m = await tx.material.create({ data: { code: b.code, name: b.name, unit: b.unit, category: b.category, serviceLine: null }, select: { id: true } });
      const e = await recordActivity(tx, { entityType: ENTITY_TYPES.PERNYATAAN_HISTORIS_SO, entityId: m.id, eventType: EVENT_TYPES.SO_DITAUTKAN, actorId: aktor.id,
        metadata: { materialId: m.id, kode: b.code, soTanggal, batasUTC: batasDariTanggal(soTanggal).toISOString(), sumber: s, alasan: a, rujukanHash: r, dokumen: null, menggantikanId: null, idempotencyKey: k, dibuatBersamaMaster: true } });
      hasil.push({ materialId: m.id, kode: b.code, tautanId: e.id });
    }
    return { ulang: false, soTanggal, batas: batasDariTanggal(soTanggal).toISOString(), bahan: hasil };
  }, { timeout: 30_000, maxWait: 10_000 });
}

/** Batalkan tautan SO (peristiwa baru). Melepas penahanan seluruh bahan itu — alasan wajib; pernyataan lama tidak dihapus. */
export async function batalkanTautan(prisma, { aktor, tautanId, alasan }) {
  wajibPenyetuju(aktor, "membatalkan tautan SO"); wajib(UUID.test(String(tautanId ?? "")), "id tautan tidak valid", "TAUTAN_TIDAK_VALID");
  const teks = norm(alasan); wajib(teks.length >= 10 && teks.length <= 500, "alasan pembatalan wajib (10–500 karakter)", "ALASAN_WAJIB");
  return prisma.$transaction(async (tx) => {
    const asli = await tx.activityEvent.findUnique({ where: { id: tautanId } }); wajib(asli && asli.entityType === ENTITY_TYPES.PERNYATAAN_HISTORIS_SO && asli.eventType === EVENT_TYPES.SO_DITAUTKAN, "tautan tidak ditemukan", "TAUTAN_TIDAK_ADA", 404);
    await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", `pernyataan_so:${asli.entityId}`);
    const aktif = (await tautanSOAktif(tx, [asli.entityId])).get(asli.entityId); wajib(aktif && aktif.id === asli.id, "tautan ini sudah tidak aktif (dibatalkan/digantikan)", "TAUTAN_TIDAK_AKTIF", 409);
    const e = await recordActivity(tx, { entityType: ENTITY_TYPES.PERNYATAAN_HISTORIS_SO, entityId: asli.entityId, eventType: EVENT_TYPES.SO_TAUTAN_DIBATALKAN, actorId: aktor.id, metadata: { membatalkanId: asli.id, alasan: teks } });
    return { id: e.id, membatalkanId: asli.id, materialId: asli.entityId };
  }, { timeout: 30_000, maxWait: 10_000 });
}

/** Nyatakan status catatan terhadap SO — per BAHAN dan per CATATAN yang disebut (tidak pernah otomatis seluruh catatan bahan). arah: TERCERMIN | BELUM_TERCERMIN. Idempoten per kunci. */
export async function nyatakanCatatan(prisma, { aktor, materialId, arah, catatanIds, alasan, rujukanHash, kunci }) {
  wajibPenyetuju(aktor, "menyatakan status catatan terhadap SO"); const k = wajibKunci(kunci);
  wajib(Object.values(ARAH).includes(arah), "arah wajib TERCERMIN atau BELUM_TERCERMIN", "ARAH_TIDAK_VALID");
  wajib(UUID.test(String(materialId ?? "")), "bahan tidak valid", "BAHAN_TIDAK_VALID");
  const ids = Array.isArray(catatanIds) ? catatanIds.map(String) : []; wajib(ids.length >= 1 && ids.length <= MAKS_CATATAN && new Set(ids).size === ids.length && ids.every((i) => UUID.test(i)), `catatanIds wajib 1–${MAKS_CATATAN} id unik (pernyataan menyebut catatan yang dicakup; bukan pernyataan massal)`, "CATATAN_TIDAK_VALID");
  const teks = norm(alasan); wajib(teks.length >= 10 && teks.length <= 500, "alasan wajib (10–500 karakter)", "ALASAN_WAJIB");
  const rujukan = norm(rujukanHash); wajib(rujukan.length >= 8 && rujukan.length <= 200, "rujukan hash manifest SO wajib (≥8 karakter)", "RUJUKAN_WAJIB");
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", `pernyataan_so:${materialId}`); await lockRowForUpdate(tx, "materials", materialId);
    const sama = await tx.activityEvent.findFirst({ where: { entityType: ENTITY_TYPES.PERNYATAAN_HISTORIS_SO, entityId: materialId, metadata: { path: ["idempotencyKey"], equals: k } } });
    if (sama) { const m = sama.metadata ?? {}; wajib(sama.eventType === EVENT_TYPES.SO_HISTORIS_DINYATAKAN && m.arah === arah && JSON.stringify([...(m.catatanIds ?? [])].sort()) === JSON.stringify([...ids].sort()) && m.alasan === teks && m.rujukanHash === rujukan, "Idempotency-Key ini sudah dipakai untuk isi yang berbeda", "KUNCI_DIPAKAI_LAIN", 409); return { ulang: true, id: sama.id, materialId, arah, catatanIds: m.catatanIds }; }
    const t = (await tautanSOAktif(tx, [materialId])).get(materialId); wajib(t, "Bahan ini belum punya tautan SO aktif — tautkan SO ke bahan lebih dulu", "TANPA_TAUTAN_SO", 409);
    const notes = await tx.unitUsageNote.findMany({ where: { id: { in: ids } } }); wajib(notes.length === ids.length, "ada catatan yang tidak ditemukan", "CATATAN_TIDAK_ADA", 404);
    for (const n of notes) {
      wajib(n.materialId === materialId, `catatan ${n.id} bukan milik bahan ini — pernyataan wajib per bahan`, "CATATAN_BAHAN_LAIN", 409);
      wajib(n.origin === "EXCEL" && ["SIAP_POSTING", "PERLU_DICEK"].includes(n.state), `catatan ${n.id} berstatus ${n.state}/${n.origin}: hanya catatan Excel yang belum diposting yang bisa dinyatakan`, "CATATAN_TIDAK_BISA", 409);
      wajib(n.usedAt && n.usedAt.getTime() <= t.batas.getTime(), `catatan ${n.id} bertanggal sesudah batas SO ${t.soTanggal} — tidak terkena pengaman`, "CATATAN_SESUDAH_SO", 409);
    }
    const aktif = await pernyataanAktif(tx, [materialId]); wajib(!ids.some((i) => aktif.has(i)), "sebagian catatan sudah dinyatakan (batalkan dulu bila perlu mengubah)", "SUDAH_DINYATAKAN", 409);
    const e = await recordActivity(tx, { entityType: ENTITY_TYPES.PERNYATAAN_HISTORIS_SO, entityId: materialId, eventType: EVENT_TYPES.SO_HISTORIS_DINYATAKAN, actorId: aktor.id,
      metadata: { materialId, arah, tautanId: t.id, soTanggal: t.soTanggal, catatanIds: [...ids].sort(), alasan: teks, rujukanHash: rujukan, idempotencyKey: k, jumlah: ids.length } });
    return { ulang: false, id: e.id, materialId, arah, catatanIds: [...ids].sort(), soTanggal: t.soTanggal };
  }, { timeout: 30_000, maxWait: 10_000 });
}

/** Batalkan pernyataan (peristiwa baru; yang lama tidak dihapus). Catatan kembali TERTAHAN_PASCA_SO. */
export async function batalkanPernyataan(prisma, { aktor, pernyataanId, alasan }) {
  wajibPenyetuju(aktor, "membatalkan pernyataan"); wajib(UUID.test(String(pernyataanId ?? "")), "id pernyataan tidak valid", "PERNYATAAN_TIDAK_VALID");
  const teks = norm(alasan); wajib(teks.length >= 10 && teks.length <= 500, "alasan pembatalan wajib (10–500 karakter)", "ALASAN_WAJIB");
  return prisma.$transaction(async (tx) => {
    const asli = await tx.activityEvent.findUnique({ where: { id: pernyataanId } });
    wajib(asli && asli.entityType === ENTITY_TYPES.PERNYATAAN_HISTORIS_SO && asli.eventType === EVENT_TYPES.SO_HISTORIS_DINYATAKAN, "pernyataan tidak ditemukan", "PERNYATAAN_TIDAK_ADA", 404);
    await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", `pernyataan_so:${asli.entityId}`);
    const sudah = await tx.activityEvent.findFirst({ where: { entityType: ENTITY_TYPES.PERNYATAAN_HISTORIS_SO, eventType: EVENT_TYPES.SO_HISTORIS_DIBATALKAN, metadata: { path: ["membatalkanId"], equals: asli.id } } });
    wajib(!sudah, "pernyataan ini sudah dibatalkan", "SUDAH_DIBATALKAN", 409);
    // catatan yang sudah terlanjur diposting sebagai ISSUE (arah BELUM_TERCERMIN) tidak bisa "dikembalikan" — riwayat tetap; pembatalan hanya berlaku ke depan
    const e = await recordActivity(tx, { entityType: ENTITY_TYPES.PERNYATAAN_HISTORIS_SO, entityId: asli.entityId, eventType: EVENT_TYPES.SO_HISTORIS_DIBATALKAN, actorId: aktor.id, metadata: { membatalkanId: asli.id, alasan: teks, catatanIds: asli.metadata?.catatanIds ?? [], arah: asli.metadata?.arah ?? null } });
    return { id: e.id, membatalkanId: asli.id, catatanIds: asli.metadata?.catatanIds ?? [] };
  }, { timeout: 30_000, maxWait: 10_000 });
}

/** Peringatan untuk pratinjau Koreksi Saldo: bahan punya catatan pemakaian historis belum diposting TANPA tautan SO. Baca-saja. */
export async function peringatanCatatanHistoris(db, materialId) {
  const [n, tautan] = [await db.unitUsageNote.count({ where: { materialId, origin: "EXCEL", state: { in: ["SIAP_POSTING", "PERLU_DICEK"] } } }), (await tautanSOAktif(db, [materialId])).get(materialId)];
  if (!n) return null;
  return tautan ? `Bahan ini punya ${n} catatan pemakaian historis belum diposting dan SO sudah ditautkan (${tautan.soTanggal}): catatan bertanggal sampai batas SO ditahan sampai dinyatakan per catatan.` : `Bahan ini punya ${n} catatan pemakaian historis yang belum diposting. Bila koreksi ini adalah hasil SO, TAUTKAN SO ke bahan dulu (pengaman posting historis); tanpa tautan, catatan itu bisa mengurangi stok lagi sesudah SO diposting.`;
}
