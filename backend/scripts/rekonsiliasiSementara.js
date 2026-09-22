// PENYESUAIAN SEMENTARA REKONSILIASI BANK — skrip GENERIK (persetujuan
// Owner per kasus), dipakai kapan pun saldo bank riil terkonfirmasi lebih
// tinggi dari buku dan sumber dananya belum bisa diidentifikasi dari
// dokumen internal (butuh rekening koran).
//
//   REKON_FILE=/tmp/rekon-sementara.json node scripts/rekonsiliasiSementara.js            # PRATINJAU (tidak menulis)
//   REKON_BACKUP_OK=1 REKON_FILE=… node scripts/rekonsiliasiSementara.js --apply           # setelah backup database
//
// File parameter (PRIVAT, tidak di Git):
//   {
//     "rekening": "KEM - Sano Bank",
//     "amount": 1028719,
//     "tanggalBuku": "2026-09-22",
//     "cutoffLabel": "22 Sep 2026 pukul 19.00 WIB",
//     "saldoRiil": 7375118,
//     "keterangan": "Penyesuaian sementara rekonsiliasi KEM per 22 Sep 2026—menunggu rekening koran; wajib direklasifikasi setelah sumber dana teridentifikasi.",
//     "persetujuan": "Owner 23 Sep 2026"
//   }
//
// Pengaman WAJIB sebelum menulis (semua-atau-tidak-sama-sekali, satu
// transaksi DB, dikunci advisory lock per rekening):
//   1. Saldo buku rekening SAAT INI (tepat sebelum posting) + amount HARUS
//      persis sama dengan saldoRiil yang dinyatakan di file parameter —
//      kalau tidak, ada mutasi baru yang belum diperhitungkan, skrip
//      MENOLAK menulis.
//   2. Idempoten lewat kunci deterministik (rekening + tanggal buku, lihat
//      posting/rekonsiliasiSementara.js) — menjalankan ulang tidak pernah
//      menghasilkan jurnal kedua.
//   3. Jurnal ditulis lewat postJournal() (satu-satunya pintu ke buku
//      besar) — tidak ada tx.finJournalEntry.create() langsung di sini.

import fs from "node:fs";
import { prisma } from "../src/db.js";
import { postRekonsiliasiSementara, KEY } from "../src/services/finance/posting/rekonsiliasiSementara.js";
import { findEntryByKey, STATUS_DIHITUNG } from "../src/services/finance/journal.js";
import { ensureDefaultChartOfAccounts } from "../src/services/finance/accounts.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../src/lib/activityLog.js";
import { toMoney } from "../src/services/finance/money.js";

const APPLY = process.argv.includes("--apply");
const FILE = process.env.REKON_FILE || "/tmp/rekon-sementara.json";
const rp = (v) => `Rp${Number(v).toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function saldoBuku(db, cashAccountId) {
  const agr = await db.finJournalLine.aggregate({
    where: { cashAccountId, entry: { status: { in: STATUS_DIHITUNG } } },
    _sum: { debit: true, credit: true },
  });
  return toMoney(agr._sum.debit || 0).minus(toMoney(agr._sum.credit || 0));
}

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY (menulis ke database)" : "PRATINJAU (tidak menulis apa pun)"}`);
  const p = JSON.parse(fs.readFileSync(FILE, "utf8"));
  const nominal = toMoney(p.amount);
  const saldoRiil = toMoney(p.saldoRiil);

  const rekening = await prisma.finCashAccount.findFirst({ where: { name: p.rekening }, select: { id: true, name: true, accountId: true } });
  if (!rekening) throw new Error(`Rekening "${p.rekening}" tidak ditemukan di Kas & Bank`);

  const sebelum = await saldoBuku(prisma, rekening.id);
  const harapanSetelah = sebelum.plus(nominal);
  console.log(`\nRekening: ${rekening.name}`);
  console.log(`Saldo buku saat ini: ${rp(sebelum)}`);
  console.log(`Penyesuaian: +${rp(nominal)}`);
  console.log(`Saldo setelah posting (harapan): ${rp(harapanSetelah)}`);
  console.log(`Saldo riil dinyatakan: ${rp(saldoRiil)}`);

  if (!harapanSetelah.equals(saldoRiil)) {
    throw new Error(
      `PENGAMAN GAGAL: saldo buku (${rp(sebelum)}) + penyesuaian (${rp(nominal)}) = ${rp(harapanSetelah)}, ` +
      `TIDAK SAMA dengan saldoRiil yang dinyatakan (${rp(saldoRiil)}). Ada mutasi baru sejak snapshot, atau nominal di file parameter keliru — tidak ada yang ditulis.`
    );
  }

  const key = KEY.rekonsiliasiSementara(rekening.id, p.tanggalBuku);
  const sudahAda = await findEntryByKey(prisma, key);
  if (sudahAda) {
    console.log(`\nSUDAH PERNAH DIPOSTING: ${sudahAda.entryNumber} (idempoten — tidak ada yang ditulis ulang).`);
    return;
  }

  if (!APPLY) {
    console.log("\nIni PRATINJAU. Semua pengaman lolos. Backup dulu, lalu jalankan dengan REKON_BACKUP_OK=1 … --apply");
    return;
  }
  if (process.env.REKON_BACKUP_OK !== "1") throw new Error("Menolak --apply: set REKON_BACKUP_OK=1 SETELAH backup database dibuat.");

  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" }, orderBy: { createdAt: "asc" }, select: { id: true, name: true } });
  if (!admin) throw new Error("Tidak ada user ADMIN untuk atribusi");

  console.log(`\n>>> POSTING sebagai ${admin.name} …`);
  const hasil = await prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))::text AS k", `REKON_SEMENTARA:${rekening.id}`);
    await ensureDefaultChartOfAccounts(tx); // pastikan akun 2-1700 ada — idempoten, tidak menimpa akun lain
    // Baca ulang saldo DI DALAM transaksi setelah lock, sebelum menulis — pengaman final terhadap race.
    const sebelumTx = await saldoBuku(tx, rekening.id);
    if (!sebelumTx.plus(nominal).equals(saldoRiil)) {
      throw new Error(`PENGAMAN GAGAL DI DALAM TRANSAKSI: saldo berubah sejak pratinjau (sekarang ${rp(sebelumTx)}) — dibatalkan.`);
    }
    const { entry, created } = await postRekonsiliasiSementara(tx, {
      cashAccountId: rekening.id,
      cashAccountLedgerId: rekening.accountId,
      cashAccountName: rekening.name,
      amount: nominal,
      tanggalBuku: p.tanggalBuku,
      keterangan: p.keterangan,
      userId: admin.id,
    });
    if (!created) throw new Error("Jurnal ternyata sudah ada — dibatalkan (idempoten, tidak ada duplikat).");
    await recordActivity(tx, {
      entityType: ENTITY_TYPES.FIN_JOURNAL, entityId: entry.id, eventType: EVENT_TYPES.DOCUMENT_POSTED, actorId: admin.id,
      metadata: {
        aksi: "rekonsiliasi_sementara", rekening: rekening.name, cutoffLabel: p.cutoffLabel,
        tanggalBuku: p.tanggalBuku, saldoRiilDinyatakan: saldoRiil.toFixed(2), saldoSebelum: sebelumTx.toFixed(2),
        nominal: nominal.toFixed(2), persetujuan: p.persetujuan || null,
      },
    });
    return entry;
  }, { timeout: 60_000, maxWait: 20_000 });

  console.log(`\nDIBUAT: ${hasil.entryNumber}`);
  const sesudah = await saldoBuku(prisma, rekening.id);
  console.log(`\nVERIFIKASI:`);
  console.log(`  ${rekening.name} ${rp(sesudah)} ${sesudah.equals(saldoRiil) ? "== saldo riil dinyatakan OK" : "≠ HARAPAN!"}`);
  const tot = await prisma.finJournalLine.aggregate({ where: { entry: { status: { in: STATUS_DIHITUNG } } }, _sum: { debit: true, credit: true } });
  console.log(`  buku besar seimbang: debit ${rp(tot._sum.debit)} kredit ${rp(tot._sum.credit)} ${toMoney(tot._sum.debit).equals(toMoney(tot._sum.credit)) ? "SEIMBANG" : "TIDAK SEIMBANG!"}`);
  const ulang = await findEntryByKey(prisma, key);
  console.log(`  posting ulang ditolak sebagai duplikat: ${ulang ? "OK (idempoten)" : "PERIKSA!"}`);
}

main().catch((e) => { console.error("SCRIPT ERROR:", e.message); process.exitCode = 1; }).finally(async () => { await prisma.$disconnect(); });
