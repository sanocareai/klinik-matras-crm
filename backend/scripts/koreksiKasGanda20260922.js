// KOREKSI KAS GANDA (persetujuan Owner 22 Sep 2026) — satu jurnal NON-KAS per transaksi yang pengaruh kasnya SUDAH termuat dalam saldo riil kalibrasi
// (JV-19092026-372 / JV-21092026-391) tetapi dijurnal sesudahnya. Lawan = 3-4100 Koreksi Saldo Awal. BUKAN jurnal penyeimbang untuk sisa selisih.
//
//   KOREKSI_FILE=/tmp/koreksi-kas-ganda.json node scripts/koreksiKasGanda20260922.js            # PRATINJAU (tidak menulis)
//   KOREKSI_BACKUP_OK=1 KOREKSI_FILE=… node scripts/koreksiKasGanda20260922.js --apply           # setelah backup database
//
// File daftar (PRIVAT, tidak di Git): { "koreksi": [ { "jurnal": "JV-…", "rekening": "PT Sano", "masuk": n, "keluar": n, "tercermin": "JV-…" } ] }
// Pengaman per transaksi: jurnal asli harus POSTED, sumber PEMBAYARAN_ORDER/PENGELUARAN/PEMBELIAN, memuat TEPAT satu baris kas pada rekening yang dinyatakan dengan nominal
// yang dinyatakan, tanggal buku ≤ 20 Sep 2026, dijurnal SESUDAH JV-21092026-391, dan belum pernah dikoreksi. Semua-atau-tidak-sama-sekali (satu transaksi DB).
// Idempoten: kunci KOREKSI_KAS_GANDA:<id jurnal asli>. Tidak menyentuh JV-372, JV-391, 2-1600, atau jurnal asli.

import fs from "node:fs";
import { prisma } from "../src/db.js";
import { postJournal } from "../src/services/finance/journal.js";
import { pastikanAkunKoreksi } from "../src/services/finance/kalibrasiSaldo.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../src/lib/activityLog.js";
import { toMoney, ZERO } from "../src/services/finance/money.js";

const APPLY = process.argv.includes("--apply");
const FILE = process.env.KOREKSI_FILE || "/tmp/koreksi-kas-ganda.json";
const TANGGAL_BUKU = new Date("2026-09-21T00:00:00.000Z");
const BATAS_TANGGAL_DOKUMEN = "2026-09-20";
const rp = (v) => `Rp${Number(v).toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const SUMBER_BOLEH = new Set(["PEMBAYARAN_ORDER", "PENGELUARAN", "PEMBELIAN"]);
const kunci = (id) => `KOREKSI_KAS_GANDA:${id}`;

async function saldoRekening(db) {
  const rek = await db.finCashAccount.findMany({ select: { id: true, name: true } });
  const out = {};
  for (const r of rek) {
    const a = await db.finJournalLine.aggregate({ where: { cashAccountId: r.id, entry: { status: { in: ["POSTED", "REVERSED"] } } }, _sum: { debit: true, credit: true } });
    out[r.name] = toMoney(a._sum.debit ?? 0).minus(toMoney(a._sum.credit ?? 0));
  }
  return out;
}

async function siapkan(db, daftar) {
  const k391 = await db.finJournalEntry.findFirst({ where: { entryNumber: "JV-21092026-391" }, select: { createdAt: true } });
  if (!k391) throw new Error("JV-21092026-391 tidak ditemukan");
  const hasil = [];
  const galat = [];
  const dilihat = new Set();
  for (const it of daftar) {
    const bad = (m) => galat.push(`${it.jurnal}: ${m}`);
    if (dilihat.has(it.jurnal)) { bad("duplikat dalam daftar"); continue; }
    dilihat.add(it.jurnal);
    const e = await db.finJournalEntry.findUnique({ where: { entryNumber: it.jurnal }, include: { lines: { include: { cashAccount: { select: { name: true } } } } } });
    if (!e) { bad("jurnal tidak ditemukan"); continue; }
    if (e.status !== "POSTED") bad(`status ${e.status} (harus POSTED)`);
    if (!SUMBER_BOLEH.has(e.source)) bad(`sumber ${e.source} tidak diizinkan`);
    if (e.date.toISOString().slice(0, 10) > BATAS_TANGGAL_DOKUMEN) bad(`tanggal buku ${e.date.toISOString().slice(0, 10)} > ${BATAS_TANGGAL_DOKUMEN}`);
    if (!(e.createdAt > k391.createdAt)) bad("dijurnal tidak sesudah JV-391");
    const kas = e.lines.filter((l) => l.cashAccountId);
    if (kas.length !== 1) { bad(`memuat ${kas.length} baris kas (harus 1)`); continue; }
    const l = kas[0];
    if (l.cashAccount.name !== it.rekening) bad(`rekening ${l.cashAccount.name} ≠ ${it.rekening}`);
    const masuk = toMoney(l.debit); const keluar = toMoney(l.credit);
    if (!masuk.equals(toMoney(it.masuk ?? 0)) || !keluar.equals(toMoney(it.keluar ?? 0))) bad(`nominal kas D${masuk} K${keluar} ≠ daftar D${it.masuk} K${it.keluar}`);
    const sudah = await db.finJournalEntry.findUnique({ where: { idempotencyKey: kunci(e.id) }, select: { entryNumber: true } });
    if (sudah) bad(`sudah dikoreksi (${sudah.entryNumber})`);
    hasil.push({ e, l, it, masuk, keluar });
  }
  return { hasil, galat };
}

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY (menulis ke database)" : "PRATINJAU (tidak menulis apa pun)"}`);
  const daftar = JSON.parse(fs.readFileSync(FILE, "utf8")).koreksi;
  console.log(`Daftar: ${daftar.length} koreksi`);
  const sebelum = await saldoRekening(prisma);
  const jurnal0 = await prisma.finJournalEntry.count();
  const a2 = await prisma.finAccount.findFirst({ where: { code: "2-1600" }, select: { id: true } });
  const baris2 = a2 ? await prisma.finJournalLine.count({ where: { accountId: a2.id } }) : 0;
  const idx = await prisma.finJournalEntry.findMany({ where: { entryNumber: { in: ["JV-19092026-372", "JV-21092026-391"] } }, select: { entryNumber: true, status: true, updatedAt: true } });

  const { hasil, galat } = await siapkan(prisma, daftar);
  const netPer = {};
  for (const h of hasil) netPer[h.it.rekening] = (netPer[h.it.rekening] ?? ZERO).plus(h.masuk).minus(h.keluar);
  console.log("\nPratinjau koreksi (jurnal asli → koreksi non-kas lawan 3-4100):");
  for (const h of hasil) console.log(`  ${h.it.jurnal} ${h.it.rekening.padEnd(16)} ${h.masuk.greaterThan(0) ? `masuk ${rp(h.masuk)} → Dr 3-4100 / Cr rekening` : `keluar ${rp(h.keluar)} → Dr rekening / Cr 3-4100`}  (tercermin ${h.it.tercermin})`);
  console.log("\nDampak pada saldo buku per rekening:");
  let totalNet = ZERO;
  for (const [n, v] of Object.entries(netPer)) { totalNet = totalNet.plus(v); console.log(`  ${n.padEnd(16)} sekarang ${rp(sebelum[n])}  koreksi ${rp(v.negated())}  → ${rp(sebelum[n].minus(v))}`); }
  console.log(`  TOTAL pengurangan kas/bank ${rp(totalNet)}`);
  if (galat.length) { console.log("\nGALAT PENGAMAN:"); galat.forEach((g) => console.log("  ✗ " + g)); throw new Error(`${galat.length} pengaman gagal — tidak ada yang ditulis`); }
  if (!APPLY) { console.log("\nIni PRATINJAU. Backup dulu, lalu jalankan dengan KOREKSI_BACKUP_OK=1 … --apply"); return; }
  if (process.env.KOREKSI_BACKUP_OK !== "1") throw new Error("Menolak --apply: set KOREKSI_BACKUP_OK=1 SETELAH backup database dibuat.");

  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" }, orderBy: { createdAt: "asc" }, select: { id: true, name: true } });
  if (!admin) throw new Error("Tidak ada user ADMIN untuk atribusi");
  console.log(`\n>>> POSTING ${hasil.length} jurnal sebagai ${admin.name} …`);
  const dibuat = await prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))::text AS k", "KOREKSI_KAS_GANDA_20260922");
    const ulang = await siapkan(tx, daftar); // periksa ulang DI DALAM transaksi (setelah kunci)
    if (ulang.galat.length) throw new Error("Pengaman gagal di dalam transaksi: " + ulang.galat.join("; "));
    const ekuitas = await pastikanAkunKoreksi(tx);
    const out = [];
    for (const h of ulang.hasil) {
      const inflow = h.masuk.greaterThan(0); const nilai = inflow ? h.masuk : h.keluar;
      const ket = `Koreksi kas ganda — ${h.it.rekening}: ${h.it.jurnal} (dokumen bertanggal ${h.e.date.toISOString().slice(0, 10)} sudah tercermin dalam saldo riil ${h.it.tercermin}); non-kas, lawan Koreksi Saldo Awal`;
      const lines = inflow
        ? [{ accountId: ekuitas.id, debit: nilai, description: `Koreksi kas ganda ${h.it.jurnal}` }, { accountId: h.l.accountId, cashAccountId: h.l.cashAccountId, credit: nilai, description: `Pengaruh kas ${h.it.jurnal} sudah tercermin dalam saldo riil` }]
        : [{ accountId: h.l.accountId, cashAccountId: h.l.cashAccountId, debit: nilai, description: `Pengaruh kas ${h.it.jurnal} sudah tercermin dalam saldo riil` }, { accountId: ekuitas.id, credit: nilai, description: `Koreksi kas ganda ${h.it.jurnal}` }];
      const { entry, created } = await postJournal(tx, { date: TANGGAL_BUKU, description: ket, source: "SALDO_AWAL", sourceId: h.e.id, idempotencyKey: kunci(h.e.id), userId: admin.id, lines });
      if (!created) throw new Error(`Jurnal koreksi untuk ${h.it.jurnal} ternyata sudah ada — dibatalkan`);
      out.push({ asal: h.it.jurnal, koreksi: entry.entryNumber, nilai: nilai.toFixed(2), arah: inflow ? "masuk" : "keluar" });
    }
    await recordActivity(tx, { entityType: ENTITY_TYPES.FIN_JOURNAL, entityId: out[0] ? (await tx.finJournalEntry.findUnique({ where: { entryNumber: out[0].koreksi }, select: { id: true } })).id : admin.id, eventType: EVENT_TYPES.DOCUMENT_POSTED, actorId: admin.id, metadata: { aksi: "koreksi_kas_ganda", jumlah: out.length, persetujuan: "Owner 22 Sep 2026" } });
    return out;
  }, { timeout: 120_000, maxWait: 20_000 });

  console.log(`\nDIBUAT ${dibuat.length} jurnal: ${dibuat[0].koreksi} … ${dibuat.at(-1).koreksi}`);
  const sesudah = await saldoRekening(prisma);
  console.log("\nVERIFIKASI:");
  for (const [n, v] of Object.entries(netPer)) { const harap = sebelum[n].minus(v); console.log(`  ${n.padEnd(16)} ${rp(sesudah[n])} ${sesudah[n].equals(harap) ? "== harapan OK" : "≠ HARAPAN!"}`); }
  const jurnal1 = await prisma.finJournalEntry.count();
  const baris2b = a2 ? await prisma.finJournalLine.count({ where: { accountId: a2.id } }) : 0;
  const idx2 = await prisma.finJournalEntry.findMany({ where: { entryNumber: { in: ["JV-19092026-372", "JV-21092026-391"] } }, select: { entryNumber: true, status: true, updatedAt: true } });
  console.log(`  jumlah jurnal ${jurnal0} → ${jurnal1} (+${jurnal1 - jurnal0}, diharapkan +${hasil.length})`);
  console.log(`  baris akun 2-1600 ${baris2} → ${baris2b} ${baris2 === baris2b ? "(utuh)" : "(BERUBAH!)"}`);
  console.log(`  JV-372/391 ${JSON.stringify(idx2) === JSON.stringify(idx) ? "utuh (status & updatedAt sama)" : "BERUBAH!"}`);
  const tot = await prisma.finJournalLine.aggregate({ where: { entry: { status: { in: ["POSTED", "REVERSED"] } } }, _sum: { debit: true, credit: true } });
  console.log(`  buku besar seimbang: debit ${rp(tot._sum.debit)} kredit ${rp(tot._sum.credit)} ${toMoney(tot._sum.debit).equals(toMoney(tot._sum.credit)) ? "SEIMBANG" : "TIDAK SEIMBANG!"}`);
  const ulang = await prisma.$transaction(async (tx) => (await siapkan(tx, daftar)).galat);
  console.log(`  posting ulang: ${ulang.every((g) => /sudah dikoreksi/.test(g)) && ulang.length === hasil.length ? "semua ditolak sebagai 'sudah dikoreksi' (idempoten)" : "PERIKSA: " + ulang.slice(0, 3).join("; ")}`);
}

main().catch((e) => { console.error("SCRIPT ERROR:", e.message); process.exitCode = 1; }).finally(async () => { await prisma.$disconnect(); });
