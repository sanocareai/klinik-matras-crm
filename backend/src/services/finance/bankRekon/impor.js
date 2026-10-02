// IMPOR REKENING KORAN — pratinjau, impor, pembatalan batch, dan daftar mutasi bank.
//
// JAMINAN: impor HANYA menulis ke fin_bank_import_batches / fin_bank_import_lines (+ catatan aktivitas). Tidak ada jurnal, tidak ada perubahan saldo buku,
// tidak ada perubahan Payment/order/dokumen. Baris bank immutable (trigger DB); pembatalan batch hanya menandai rolled_back_at.
import { toMoney, ZERO } from "../money.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../../../lib/activityLog.js";
import { telaahBerkas, sidikJariBaris, sha256, ParseError } from "./parse.js";
import { RekonError, wajibRekonV2Aktif, ambilRekening, uang, tgl, waktu, tanggalKolom, POLA_UUID, nilaiBank, maskNomor } from "./shared.js";

const diBungkus = (fn) => fn().catch((e) => { if (e instanceof ParseError) throw new RekonError(e.message, e.statusCode, e.code); throw e; });

async function pastikanBolehImpor(db, cashAccountId) {
  const rek = await ambilRekening(db, cashAccountId);
  if (rek.kind === "KAS") throw new RekonError("Uang Kas tidak memakai rekening koran — gunakan Hitung Fisik (opname) kas.", 422, "REKENING_KAS");
  if (!rek.active) throw new RekonError("Rekening sudah tidak aktif", 422, "REKENING_NONAKTIF");
  return rek;
}

/** Saldo bank awal & akhir dari baris terparse (bila kolom saldo ada): awal = saldo baris pertama − (kredit − debit) baris itu. */
function saldoDariBaris(baris) {
  if (!baris.length || baris[0].saldo == null || baris[baris.length - 1].saldo == null) return { awal: null, akhir: null };
  const p = baris[0];
  return { awal: toMoney(p.saldo).minus(toMoney(p.kredit)).plus(toMoney(p.debit)).toFixed(2), akhir: toMoney(baris[baris.length - 1].saldo).toFixed(2) };
}

/**
 * Pratinjau: baca & telaah berkas, TANPA menulis apa pun. Mengembalikan pemetaan (otomatis/hasil pengguna), contoh baris, galat, total, rantai saldo,
 * serta diagnosa duplikat (berkas sama persis & baris yang sudah ada di rekening ini).
 */
export async function pratinjauImpor(db, { cashAccountId, buffer, namaBerkas, pemetaan = null }) {
  const rek = await pastikanBolehImpor(db, cashAccountId);
  const t = await diBungkus(() => telaahBerkas(buffer, namaBerkas, pemetaan));
  const hash = sha256(buffer);
  const berkasSama = await db.finBankImportBatch.findFirst({ where: { cashAccountId, fileSha256: hash, status: "AKTIF" }, select: { id: true, fileName: true, importedAt: true, rowCount: true } });
  const fp = sidikJariBaris(cashAccountId, t.baris);
  const ada = fp.length ? await db.finBankImportLine.findMany({ where: { cashAccountId, rolledBackAt: null, fingerprint: { in: fp } }, select: { fingerprint: true } }) : [];
  const adaSet = new Set(ada.map((x) => x.fingerprint));
  const totalDebit = t.baris.reduce((a, b) => a.plus(b.debit), ZERO);
  const totalKredit = t.baris.reduce((a, b) => a.plus(b.kredit), ZERO);
  const saldo = saldoDariBaris(t.baris);
  const baru = t.baris.length - fp.filter((x) => adaSet.has(x)).length;
  return {
    rekening: { id: rek.id, nama: rek.name, jenis: rek.kind, bank: rek.bankName, nomor: maskNomor(rek.accountNumber) },
    berkas: { nama: namaBerkas, sha256: hash, format: t.format, ukuran: buffer.length, urutan: t.urutan },
    kolom: { headers: t.headers, barisJudul: t.barisJudul, pemetaan: t.pemetaan, pemetaanOtomatis: t.pemetaanOtomatis },
    jumlahBaris: t.baris.length, jumlahBarisBaru: baru, jumlahGanda: t.baris.length - baru,
    tanggalAwal: t.baris[0]?.tanggal ?? null, tanggalAkhir: t.baris[t.baris.length - 1]?.tanggal ?? null,
    totalDebit: totalDebit.toFixed(2), totalKredit: totalKredit.toFixed(2), saldoAwalBerkas: saldo.awal, saldoAkhirBerkas: saldo.akhir,
    rantaiSaldo: t.rantaiSaldo, galat: t.galat.slice(0, 50), jumlahGalat: t.galat.length, dilewati: t.dilewati.slice(0, 20), jumlahDilewati: t.dilewati.length,
    contoh: t.baris.slice(0, 15).map((b) => ({ noBaris: b.noBaris, tanggal: b.tanggal, tanggalEfektif: b.tanggalEfektif, deskripsi: b.deskripsi, referensi: b.referensi, debit: b.debit, kredit: b.kredit, saldo: b.saldo, ganda: adaSet.has(fp[t.baris.indexOf(b)]) })),
    berkasSama: berkasSama ? { id: berkasSama.id, nama: berkasSama.fileName, diimporPada: waktu(berkasSama.importedAt), jumlahBaris: berkasSama.rowCount } : null,
    bisaDiimpor: !berkasSama && t.galat.length === 0 && t.baris.length > 0 && baru > 0,
    alasanTidakBisa: berkasSama ? "Berkas yang sama persis sudah pernah diimpor untuk rekening ini." : t.galat.length ? `${t.galat.length} baris tidak terbaca — perbaiki berkas atau pemetaan kolom.` : !t.baris.length ? "Tidak ada baris transaksi terbaca." : baru === 0 ? "Semua baris sudah ada di rekening ini (impor ganda)." : null,
  };
}

/**
 * Impor sungguhan. Menolak: sakelar mati, berkas yang sama persis, galat baris, tidak ada baris baru. Baris yang sudah ada (sidik jari sama) DILEWATI — berkas rentang
 * tumpang tindih (mis. koran bulanan lalu rentang tanggal) tidak menggandakan baris. Serial per rekening (kunci advisory) supaya dua impor bersamaan tidak saling menyalip.
 */
export async function jalankanImpor(db, { cashAccountId, buffer, namaBerkas, pemetaan = null, userId = null }) {
  await wajibRekonV2Aktif(db);
  const rek = await pastikanBolehImpor(db, cashAccountId);
  const t = await diBungkus(() => telaahBerkas(buffer, namaBerkas, pemetaan));
  if (t.galat.length) throw new RekonError(`${t.galat.length} baris tidak terbaca (mis. baris ${t.galat[0].noBaris}: ${t.galat[0].pesan}). Perbaiki berkas atau pemetaan, lalu coba lagi.`, 422, "BARIS_GALAT");
  if (!t.baris.length) throw new RekonError("Tidak ada baris transaksi terbaca di berkas ini.", 422, "TANPA_BARIS");
  const hash = sha256(buffer);
  const fp = sidikJariBaris(cashAccountId, t.baris);

  return db.$transaction(async (tx) => {
    await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))::text AS k", `REKON_V2_IMPOR:${cashAccountId}`);
    const sama = await tx.finBankImportBatch.findFirst({ where: { cashAccountId, fileSha256: hash, status: "AKTIF" }, select: { id: true, fileName: true } });
    if (sama) throw new RekonError(`Berkas yang sama persis sudah pernah diimpor (${sama.fileName}).`, 409, "BERKAS_GANDA");
    const ada = await tx.finBankImportLine.findMany({ where: { cashAccountId, rolledBackAt: null, fingerprint: { in: fp } }, select: { fingerprint: true } });
    const adaSet = new Set(ada.map((x) => x.fingerprint));
    const idx = t.baris.map((b, i) => i).filter((i) => !adaSet.has(fp[i]));
    if (!idx.length) throw new RekonError("Semua baris di berkas ini sudah ada di rekening ini (impor ganda). Tidak ada yang diimpor.", 409, "SEMUA_GANDA");
    const baru = idx.map((i) => t.baris[i]);
    const totalDebit = baru.reduce((a, b) => a.plus(b.debit), ZERO);
    const totalKredit = baru.reduce((a, b) => a.plus(b.kredit), ZERO);
    const batch = await tx.finBankImportBatch.create({
      data: {
        cashAccountId, fileName: String(namaBerkas || "berkas").slice(0, 200), fileSha256: hash, rowCount: baru.length, totalDebit, totalCredit: totalKredit,
        dateFrom: tanggalKolom(baru.map((b) => b.tanggal).sort()[0]), dateTo: tanggalKolom(baru.map((b) => b.tanggal).sort().at(-1)),
        mapping: { kolom: t.pemetaan, barisJudul: t.barisJudul, headers: t.headers, format: t.format, urutan: t.urutan }, importedById: userId,
      },
    });
    await tx.finBankImportLine.createMany({
      data: idx.map((i, urut) => {
        const b = t.baris[i];
        return {
          batchId: batch.id, cashAccountId, lineNo: urut + 1, txDate: tanggalKolom(b.tanggal), effectiveDate: b.tanggalEfektif ? tanggalKolom(b.tanggalEfektif) : null,
          description: b.deskripsi.slice(0, 1000), reference: b.referensi ? b.referensi.slice(0, 200) : null, debit: toMoney(b.debit), credit: toMoney(b.kredit),
          runningBalance: b.saldo != null ? toMoney(b.saldo) : null, fingerprint: fp[i], raw: b.raw,
        };
      }),
    });
    await recordActivity(tx, {
      entityType: ENTITY_TYPES.FIN_BANK_REKON, entityId: batch.id, eventType: EVENT_TYPES.BANK_REKON_V2, actorId: userId,
      metadata: { aksi: "impor", rekening: rek.name, cashAccountId, batchId: batch.id, berkas: batch.fileName, jumlahBaris: baru.length, dilewati: t.baris.length - baru.length, totalDebit: totalDebit.toFixed(2), totalKredit: totalKredit.toFixed(2) },
    });
    return { batchId: batch.id, jumlahBaris: baru.length, dilewati: t.baris.length - baru.length, tanggalAwal: tgl(batch.dateFrom), tanggalAkhir: tgl(batch.dateTo), totalDebit: totalDebit.toFixed(2), totalKredit: totalKredit.toFixed(2) };
  }, { timeout: 120_000, maxWait: 20_000 });
}

/** Daftar batch impor sebuah rekening (terbaru dulu). Nomor rekening tidak ikut. */
export async function daftarBatch(db, { cashAccountId }) {
  await ambilRekening(db, cashAccountId);
  const rows = await db.finBankImportBatch.findMany({
    where: { cashAccountId }, orderBy: { importedAt: "desc" }, take: 100,
    include: { importedBy: { select: { id: true, name: true } }, rolledBackBy: { select: { id: true, name: true } } },
  });
  return rows.map((b) => ({
    id: b.id, berkas: b.fileName, jumlahBaris: b.rowCount, totalDebit: uang(b.totalDebit), totalKredit: uang(b.totalCredit), tanggalAwal: tgl(b.dateFrom), tanggalAkhir: tgl(b.dateTo),
    status: b.status, diimporOleh: b.importedBy ? { id: b.importedBy.id, name: b.importedBy.name } : null, diimporPada: waktu(b.importedAt),
    dibatalkanPada: waktu(b.rolledBackAt), dibatalkanOleh: b.rolledBackBy ? { id: b.rolledBackBy.id, name: b.rolledBackBy.name } : null, alasanBatal: b.rolledBackReason,
  }));
}

/**
 * Batalkan SATU batch (rollback). Syarat: (1) belum dipakai periode rekonsiliasi yang SELESAI & berlaku (batalkan periodenya dulu), (2) tidak ada pencocokan aktif pada barisnya
 * — kecuali `lepasPencocokan: true` yang sekaligus membatalkan kelompok pencocokannya (tercatat). Baris tidak dihapus; hanya diberi rolled_back_at (riwayat tetap).
 */
export async function batalkanBatch(db, { batchId, alasan, lepasPencocokan = false, userId = null }) {
  await wajibRekonV2Aktif(db);
  if (!POLA_UUID.test(String(batchId || ""))) throw new RekonError("Batch tidak valid", 400);
  if (String(alasan || "").trim().length < 10) throw new RekonError("Alasan pembatalan impor wajib diisi (minimal 10 karakter)", 400, "ALASAN_WAJIB");
  return db.$transaction(async (tx) => {
    const b = await tx.finBankImportBatch.findUnique({ where: { id: batchId } });
    if (!b) throw new RekonError("Batch impor tidak ditemukan", 404);
    await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))::text AS k", `REKON_V2_IMPOR:${b.cashAccountId}`);
    if (b.status !== "AKTIF") throw new RekonError("Batch ini sudah dibatalkan", 409, "SUDAH_DIBATALKAN");
    const periode = await tx.finBankReconPeriod.findFirst({
      where: { cashAccountId: b.cashAccountId, invalidatedAt: null, balanceSource: "REKENING_KORAN", periodTo: { gte: b.dateFrom } },
      select: { periodTo: true },
    });
    if (periode) throw new RekonError(`Impor ini sudah dipakai periode rekonsiliasi yang selesai (sampai ${tgl(periode.periodTo)}). Batalkan periodenya dulu.`, 409, "DIPAKAI_PERIODE");
    const kelompok = await tx.finBankMatchGroup.findMany({ where: { undoneAt: null, items: { some: { active: true, bankLine: { batchId } } } }, select: { id: true } });
    if (kelompok.length && !lepasPencocokan) throw new RekonError(`${kelompok.length} kelompok pencocokan masih memakai baris batch ini. Lepaskan pencocokannya dulu, atau batalkan impor dengan opsi melepas pencocokan.`, 409, "MASIH_DICOCOKKAN");
    const sekarang = new Date();
    for (const g of kelompok) {
      await tx.finBankMatchItem.updateMany({ where: { groupId: g.id, active: true }, data: { active: false } });
      await tx.finBankMatchGroup.update({ where: { id: g.id }, data: { undoneAt: sekarang, undoneById: userId, undoneReason: `Impor rekening koran dibatalkan: ${String(alasan).trim()}` } });
    }
    await tx.finBankImportLine.updateMany({ where: { batchId, rolledBackAt: null }, data: { rolledBackAt: sekarang } });
    await tx.finBankImportBatch.update({ where: { id: batchId }, data: { status: "DIBATALKAN", rolledBackAt: sekarang, rolledBackById: userId, rolledBackReason: String(alasan).trim() } });
    await recordActivity(tx, {
      entityType: ENTITY_TYPES.FIN_BANK_REKON, entityId: batchId, eventType: EVENT_TYPES.BANK_REKON_V2, actorId: userId,
      metadata: { aksi: "impor_dibatalkan", cashAccountId: b.cashAccountId, batchId, jumlahBaris: b.rowCount, alasan: String(alasan).trim(), pencocokanDilepas: kelompok.length },
    });
    return { batchId, jumlahBaris: b.rowCount, pencocokanDilepas: kelompok.length };
  }, { timeout: 60_000, maxWait: 20_000 });
}

export { nilaiBank };
