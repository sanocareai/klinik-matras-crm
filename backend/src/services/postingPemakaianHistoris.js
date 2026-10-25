// POSTING PEMAKAIAN HISTORIS — jalur terpadu yang menyatukan ledger stok DAN tampilan Produksi (Okt 2026).
//
// Mengapa jalur baru: jalur resmi POST /units/:id/materials mencap waktu = SEKARANG (tak bisa mundur) dan otomatis menjurnal; impor lama (createMany) melewati kunci/invarian saldo, tanpa pelaku,
// tanpa valuasi. Jalur ini: SATU transaksi per order (semua-atau-tidak-sama-sekali) → kunci bahan → invarian saldo (postStockMovement) → cap waktu = tanggal selesai Excel → valuasi beku di tanggal itu →
// catatan historis ditautkan (DIPOSTING). Pergerakan bertaut unit sehingga langsung tampil di Bahan/Ringkasan/Riwayat/Excel Order Produksi seperti pemakaian aktual lain.
//
// PAGAR: tidak berjalan tanpa (a) rencana yang hash-nya SAMA dengan yang disetujui, (b) rujukan persetujuan Owner, (c) pelaku. Idempoten: kunci per (order, bahan) + tautan catatan; jalan ulang = nol tulisan.
// Jurnal HPP TIDAK dibuat kecuali diminta eksplisit (keputusan Finance: jurnal akan bertanggal historis).
import crypto from "node:crypto";
import { postStockMovement, lockRowForUpdate } from "./inventoryLedger.js";
import { bukukanNilaiPergerakanBaru } from "./finance/posting/inventory.js";
import { KoreksiError } from "./warehouseCorrection.js";
import { evaluasiUlang, kunciEvaluasiCatatan, keadaanEfektif } from "./catatanPemakaianHistoris.js";
import { STATE, r4 } from "../lib/domain/pemakaianHistoris.js";
import { wajibKonfirmasiManifest, wajibOwnerMemulai, wajibAdaKonfirmasi } from "./postingKonfirmasiManifest.js";

export const AWAL_NOTE_POSTING = "Impor pemakaian historis Sep–Okt 2026";
const kunciPosting = (orderNumber, kodeBahan) => `PH2610:${orderNumber}:${kodeBahan}`;
const wibTgl = (d) => new Date(new Date(d).getTime() + 7 * 3600_000).toISOString().slice(0, 10);

/** Rencana posting dari catatan SIAP_POSTING (baca-saja). Urutan = tanggal, order, bahan. Hash menutup isi rencana. */
export async function rencanakanPosting(db, { unitIds = null } = {}) {
  // Rencana memakai keadaan EFEKTIF (terhadap ledger sekarang), sama dengan yang dilihat pengguna: catatan tersimpan "siap" yang pasokannya sudah terpakai GR/pengeluaran lain TIDAK ikut,
  // dan catatan tersimpan "perlu dicek" yang kini cukup stoknya ikut.
  const kandidat = await db.unitUsageNote.findMany({ where: { origin: "EXCEL", state: { in: [STATE.SIAP_POSTING, STATE.PERLU_DICEK] }, ...(unitIds ? { unitId: { in: unitIds } } : {}) }, select: { id: true } });
  const efektif = kandidat.length ? await keadaanEfektif(db) : new Map();
  const idSiap = kandidat.filter((n) => efektif.get(n.id)?.state === STATE.SIAP_POSTING).map((n) => n.id);
  const notes = await db.unitUsageNote.findMany({
    where: { id: { in: idSiap } },
    include: { material: { select: { id: true, code: true, name: true, unit: true } }, unit: { select: { id: true, unitCode: true, status: true } } }, orderBy: [{ orderNumber: "asc" }, { sourceRow: "asc" }],
  });
  const grup = new Map();
  for (const n of notes) {
    const k = `${n.unitId}|${n.materialId}`; const g = grup.get(k) ?? { unitId: n.unitId, unitCode: n.unit.unitCode, statusUnit: n.unit.status, orderNumber: n.orderNumber, materialId: n.materialId, kodeBahan: n.material.code, satuan: n.material.unit, qty: 0, tanggal: wibTgl(n.usedAt), usedAt: n.usedAt, catatanIds: [], barisSumber: [] };
    g.qty = r4(g.qty + Number(n.qty)); g.catatanIds.push(n.id); g.barisSumber.push(n.sourceRow); if (new Date(n.usedAt) < new Date(g.usedAt)) { g.usedAt = n.usedAt; g.tanggal = wibTgl(n.usedAt); } grup.set(k, g);
  }
  const transaksi = [...grup.values()].sort((a, b) => a.tanggal.localeCompare(b.tanggal) || a.orderNumber.localeCompare(b.orderNumber) || a.kodeBahan.localeCompare(b.kodeBahan))
    .map((g, i) => ({ no: i + 1, kunci: kunciPosting(g.orderNumber, g.kodeBahan), ...g, createdAtUTC: new Date(g.usedAt).toISOString() }));
  const hash = crypto.createHash("sha256").update(JSON.stringify(transaksi.map((t) => [t.kunci, t.unitId, t.materialId, t.qty, t.createdAtUTC, [...t.catatanIds].sort()]))).digest("hex");
  return { hash, jumlah: transaksi.length, orderUnik: new Set(transaksi.map((t) => t.orderNumber)).size, transaksi };
}

async function garisWaktuBahan(tx, materialId) {
  const rows = await tx.stockMovement.findMany({ where: { materialId }, select: { qty: true, createdAt: true } });
  return rows.map((m) => ({ d: wibTgl(m.createdAt), q: Number(m.qty) }));
}
const minGaris = (l) => { let run = 0; let min = 0; for (const e of [...l].sort((a, b) => a.d.localeCompare(b.d) || b.q - a.q)) { run = r4(run + e.q); if (run < min) min = run; } return min; };

/**
 * Posting SATU unit (satu transaksi, semua-atau-tidak-sama-sekali) dari daftar transaksi rencana. Dipakai jalankanPosting (sinkron) dan pekerja batch latar.
 * Tidak pernah melempar untuk kegagalan unit: mengembalikan { status: "DIPOSTING"|"DILEWATI"|"GAGAL", ok, lewat, kode, pesan }. Idempoten: pergerakan berkunci yang sudah ada hanya ditautkan.
 */
export async function postingSatuUnit(prisma, { unitId, daftar, persetujuan, aktor, jurnalHPP = false, sekarang = new Date() }) {
  try {
    const hasil = await prisma.$transaction(async (tx) => {
    // URUTAN KUNCI SERAGAM: kunci evaluasi (serialisasi semua penulis keadaan catatan) → baris. Posting bersamaan menunggu giliran dan membaca ledger/keadaan yang SUDAH COMMIT.
    await kunciEvaluasiCatatan(tx);
    await lockRowForUpdate(tx, "units", unitId);
    // Segarkan keadaan terhadap ledger sekarang DI DALAM kunci: catatan yang tidak lagi siap (mis. pasokan terpakai posting/koreksi/pengeluaran lain) gugur di pemeriksaan di bawah — fail-closed.
    await evaluasiUlang(tx, { actorId: aktor.id, sekarang });
    const ok = []; const lewat = [];
    for (const t of daftar) {
      for (const id of t.catatanIds) await lockRowForUpdate(tx, "unit_usage_notes", id);
      const notes = await tx.unitUsageNote.findMany({ where: { id: { in: t.catatanIds } } });
      // idempotensi / pemulihan: pergerakan dengan kunci ini sudah ada → tautkan saja, jangan tulis lagi
      const ada = await tx.stockMovement.findFirst({ where: { unitId, materialId: t.materialId, note: { contains: `[${t.kunci}]` } }, select: { id: true } });
      if (notes.every((n) => n.state === STATE.DIPOSTING) && ada) { lewat.push({ kunci: t.kunci, alasan: "SUDAH_DIPOSTING" }); continue; }
      if (!notes.every((n) => n.state === STATE.SIAP_POSTING && !n.stockMovementId)) throw new KoreksiError(`Catatan ${t.kunci} tidak lagi siap posting`, 409, "CATATAN_BERUBAH");
      let mv = ada;
      if (!mv) {
        // garis waktu: pemakaian bertanggal historis tidak boleh membuat saldo negatif di titik waktu mana pun
        const L = await garisWaktuBahan(tx, t.materialId); const awal = minGaris(L);
        if (minGaris([...L, { d: t.tanggal, q: -t.qty }]) < -1e-6 && awal >= -1e-6) throw new KoreksiError(`Saldo ${t.kodeBahan} akan negatif pada garis waktu (${t.tanggal}) — tidak diposting`, 409, "SALDO_GARIS_WAKTU", { kunci: t.kunci });
        mv = await postStockMovement(tx, { materialId: t.materialId, type: "ISSUE", qty: -t.qty, unitId, createdAt: t.usedAt, createdById: aktor.id,
          note: `${AWAL_NOTE_POSTING} [${t.kunci}] — order ${t.orderNumber}`, reason: `Persetujuan ${persetujuan.rujukan} oleh ${persetujuan.disetujuiOleh}` });
        if (jurnalHPP) await bukukanNilaiPergerakanBaru(tx, mv, { userId: aktor.id });
      }
      for (const n of notes) {
        await tx.unitUsageNote.update({ where: { id: n.id }, data: { state: STATE.DIPOSTING, stockMovementId: mv.id, linkKind: "POSTING_HISTORIS", flags: [], evaluatedAt: sekarang } });
        await tx.unitUsageNoteEvent.create({ data: { noteId: n.id, kind: "DIPOSTING", before: { state: n.state }, after: { state: STATE.DIPOSTING, pergerakanId: mv.id, qty: t.qty, satuan: t.satuan, tanggal: t.tanggal, kunci: t.kunci }, reason: `Dijadikan pengeluaran stok — persetujuan ${persetujuan.rujukan} (${persetujuan.disetujuiOleh})`, actorId: aktor.id } });
      }
      ok.push({ kunci: t.kunci, pergerakanId: mv.id, qty: t.qty });
    }
    // ATOMIK: keadaan semua catatan dihitung ulang (GLOBAL, bukan hanya unit ini) di transaksi yang SAMA dengan posting → tidak ada jeda keadaan palsu yang terbaca/dipakai.
    if (ok.length) await evaluasiUlang(tx, { actorId: aktor.id, sekarang });
    return { ok, lewat };
    }, { timeout: 300_000, maxWait: 120_000 });
    return { status: hasil.ok.length ? "DIPOSTING" : "DILEWATI", ok: hasil.ok, lewat: hasil.lewat };
  } catch (e) {
    // PENYEMBUHAN: transaksi unit yang gagal ikut membatalkan penyegaran keadaan di dalamnya. Bila gagal karena keadaan sudah bergeser (mis. pasokan terpakai di luar modul ini), simpan keadaan yang benar sekarang
    // (transaksi evaluasi tersendiri, terkunci) agar catatan yang tidak lagi siap tidak tetap terbaca SIAP_POSTING. Upaya terbaik: kegagalan di sini tidak mengubah hasil.
    try { await evaluasiUlang(prisma, { actorId: aktor.id, sekarang }); } catch { /* evaluasi berikutnya akan memperbaiki */ }
    return { status: "GAGAL", ok: [], lewat: [], kode: e.code ?? "GALAT", pesan: e.message };
  }
}

/**
 * Jalankan rencana yang DISETUJUI. Per order satu transaksi. Mengembalikan { diposting, dilewati, gagal } — kegagalan satu order tidak membatalkan order lain.
 * @param persetujuan { hashDisetujui, rujukan (≥8 karakter, mis. nomor persetujuan Owner), disetujuiOleh, konfirmasi (wajib: lihat postingKonfirmasiManifest.js) }
 */
export async function jalankanPosting(prisma, { persetujuan, aktor, jurnalHPP = false, unitIds = null, sekarang = new Date() }) {
  if (!aktor?.id) throw new KoreksiError("Pelaku wajib ada", 400, "PELAKU_WAJIB");
  await wajibOwnerMemulai(prisma, aktor); // SEMENTARA hanya akun Owner yang memulai
  if (!persetujuan?.hashDisetujui || String(persetujuan.rujukan ?? "").trim().length < 8 || !persetujuan.disetujuiOleh) throw new KoreksiError("Posting butuh hash rencana yang disetujui, rujukan persetujuan Owner (≥8 karakter), dan nama penyetuju", 403, "PERSETUJUAN_WAJIB");
  await wajibAdaKonfirmasi(prisma, aktor, persetujuan);
  const rencana = await rencanakanPosting(prisma, { unitIds });
  if (rencana.hash !== persetujuan.hashDisetujui) throw new KoreksiError("Rencana posting saat ini BERBEDA dari yang disetujui — tidak dijalankan. Minta persetujuan ulang atas daftar terbaru.", 409, "RENCANA_BERUBAH", { hashSekarang: rencana.hash });
  if (rencana.jumlah) await wajibKonfirmasiManifest(prisma, { rencana, persetujuan, aktor }); // selisih dengan konfirmasi manifest → ditolak SEBELUM movement apa pun
  const perUnit = new Map(); for (const t of rencana.transaksi) (perUnit.get(t.unitId) ?? perUnit.set(t.unitId, []).get(t.unitId)).push(t);
  const diposting = []; const dilewati = []; const gagal = [];
  for (const [unitId, daftar] of perUnit) {
    const h = await postingSatuUnit(prisma, { unitId, daftar, persetujuan, aktor, jurnalHPP, sekarang });
    if (h.status === "GAGAL") gagal.push({ unitId, order: daftar[0].orderNumber, kode: h.kode, pesan: h.pesan });
    else { diposting.push(...h.ok.map((x) => ({ unitId, ...x }))); dilewati.push(...h.lewat.map((x) => ({ unitId, ...x }))); }
  }
  return { hash: rencana.hash, diposting, dilewati, gagal };
}
