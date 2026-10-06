// PIUTANG AWAL — order keringanan lunas yang SUDAH DISERAHKAN SEBELUM PEMBUKUAN dan uang pelanggannya BELUM diterima (kasus 10 order HOTEL DISCOVERY ANCOL, RES-19082026-083..092,
// Rp12.100.000). Dari sisi uang ini tagihan sah ke pelanggan, tetapi buku tidak punya jurnal pendapatan/piutang sama sekali (order diserahkan 19 Agustus, sebelum saldo awal 18 Sep),
// sehingga (a) tidak tampil di neraca/laporan piutang, dan (b) saat Hotel akhirnya membayar sistem akan mencatatnya sebagai UANG MUKA (kewajiban palsu) karena tidak ada piutang yang ditutup.
//
//   Dr 1-1300 Piutang Usaha [per order, per pelanggan] / Cr 3-3100 Laba Ditahan — NON-KAS, bertanggal saldo awal (18 Sep 2026). Pendapatan TIDAK disentuh (milik periode sebelum pembukuan).
//   Kunci idempoten = kunci PENGAKUAN PENDAPATAN order (PENGAKUAN_PENDAPATAN:<orderId>) dengan sumber SALDO_AWAL: sistem menganggap pendapatan order sudah diakui, jadi (1) pengakuan otomatis
//   tidak pernah membuat piutang KEDUA, dan (2) pembayaran Hotel nanti otomatis menutup piutang ini (Dr Bank / Cr Piutang) pada tanggal uang sebenarnya diterima.
//   Status Lunas di CRM, Pengecualian Tgl Lunas, target Sales, dan tanggal lunas TIDAK berubah.
//
//   node scripts/piutangAwalKeringananLunas.js                          # PRATINJAU (tidak menulis apa pun)
//   KOREKSI_BACKUP_OK=1 node scripts/piutangAwalKeringananLunas.js --apply
import { prisma } from "../src/db.js";
import { postJournal, STATUS_DIHITUNG } from "../src/services/finance/journal.js";
import { resolveAccount, SYSTEM_KEYS } from "../src/services/finance/accounts.js";
import { KEY } from "../src/services/finance/posting/orderRevenue.js";
import { tanggalCutoff } from "../src/services/finance/cutoff.js";
import { PILIH_TAGIHAN, tagihanOrder } from "../src/services/finance/tagihanOrder.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../src/lib/activityLog.js";
import { toMoney } from "../src/services/finance/money.js";

const APPLY = process.argv.includes("--apply");
const AKTOR_NAMA = "OWNER (Admin)";
// nomor order → tagihan yang DIHARAPKAN (dikunci supaya data yang berubah sejak pratinjau disetujui menghentikan skrip)
const TARGET = Object.fromEntries([
  ["RES-19082026-083", 1_500_000], ["RES-19082026-084", 1_500_000], ["RES-19082026-085", 1_500_000], ["RES-19082026-086", 1_500_000],
  ["RES-19082026-087", 1_000_000], ["RES-19082026-088", 1_000_000], ["RES-19082026-089", 1_000_000], ["RES-19082026-090", 1_000_000], ["RES-19082026-091", 1_000_000],
  ["RES-19082026-092", 1_100_000],
]);
const rp = (v) => `Rp${Number(v).toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
class Berhenti extends Error {}

async function periksa(db) {
  const hasil = [];
  for (const [nomor, harapan] of Object.entries(TARGET)) {
    const o = await db.order.findFirst({ where: { orderNumber: nomor }, select: { ...PILIH_TAGIHAN, id: true, orderNumber: true, customerId: true, paymentStatus: true, customer: { select: { name: true } } } });
    if (!o) throw new Berhenti(`order ${nomor} tidak ditemukan`);
    const sudah = await db.finJournalEntry.findFirst({ where: { idempotencyKey: KEY.revenue(o.id), source: "SALDO_AWAL", status: "POSTED" }, select: { entryNumber: true } });
    if (sudah) { hasil.push({ nomor, o, tagihan: toMoney(tagihanOrder(o)), sudah: sudah.entryNumber }); continue; }
    if (o.status !== "DELIVERED") throw new Berhenti(`${nomor}: status ${o.status}, harus DELIVERED`);
    if (!/discovery/i.test(o.customer?.name ?? "")) throw new Berhenti(`${nomor}: pelanggan ${o.customer?.name} bukan Hotel Discovery`);
    const pengecualian = await db.orderPaidAtPengecualian.count({ where: { orderId: o.id, dicabutAt: null } });
    if (pengecualian !== 1) throw new Berhenti(`${nomor}: pengecualian tgl lunas aktif harus tepat 1 (ada ${pengecualian})`);
    const jurnal = await db.finJournalLine.count({ where: { orderId: o.id } });
    if (jurnal !== 0) throw new Berhenti(`${nomor}: sudah punya ${jurnal} baris jurnal — bukan kasus "tidak pernah dijurnal"`);
    const payment = await db.payment.count({ where: { orderId: o.id, cancelledAt: null } });
    if (payment !== 0) throw new Berhenti(`${nomor}: sudah ada ${payment} Payment aktif — uangnya sudah diterima, bukan piutang awal`);
    const tagihan = toMoney(tagihanOrder(o));
    if (!tagihan.equals(harapan)) throw new Berhenti(`${nomor}: tagihan ${rp(tagihan)} ≠ yang disetujui ${rp(harapan)}`);
    hasil.push({ nomor, o, tagihan, sudah: null });
  }
  return hasil;
}

async function foto(db, piutangId, labaId) {
  const per = async (where) => { const a = await db.finJournalLine.aggregate({ where: { ...where, entry: { status: { in: STATUS_DIHITUNG } } }, _sum: { debit: true, credit: true } }); return toMoney(a._sum.debit ?? 0).minus(toMoney(a._sum.credit ?? 0)); };
  const rek = await db.finCashAccount.findMany({ select: { id: true, name: true, accountId: true } });
  const saldo = {};
  for (const r of rek) saldo[r.name] = await per({ cashAccountId: r.id, accountId: r.accountId });
  const ner = await db.finJournalLine.aggregate({ where: { entry: { status: { in: STATUS_DIHITUNG } } }, _sum: { debit: true, credit: true } });
  return { saldo, piutang: await per({ accountId: piutangId }), laba: await per({ accountId: labaId }), seimbang: toMoney(ner._sum.debit ?? 0).equals(toMoney(ner._sum.credit ?? 0)), jurnal: await db.finJournalEntry.count(), payment: await db.payment.count() };
}

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY" : "PRATINJAU (tidak menulis apa pun)"}`);
  const tanggal = new Date(`${await tanggalCutoff(prisma)}T00:00:00Z`);
  const piutang = await resolveAccount(prisma, SYSTEM_KEYS.PIUTANG_USAHA);
  const laba = await resolveAccount(prisma, SYSTEM_KEYS.LABA_DITAHAN);
  const hasil = await periksa(prisma);
  const kerja = hasil.filter((h) => !h.sudah);
  for (const h of hasil) console.log(`${h.nomor} | ${h.o.customer?.name} | ${rp(h.tagihan)}${h.sudah ? `  (SUDAH: ${h.sudah})` : ""}`);
  if (kerja.length === 0) { console.log("SUDAH DIKOREKSI — berhenti tanpa perubahan."); return; }
  const total = kerja.reduce((s, h) => s.plus(h.tagihan), toMoney(0));
  const sebelum = await foto(prisma, piutang.id, laba.id);
  console.log(`\nTanggal jurnal: ${tanggal.toISOString().slice(0, 10)} (tanggal saldo awal). ${kerja.length} jurnal non-kas: Dr Piutang Usaha / Cr Laba Ditahan, total ${rp(total)}.`);
  console.log(`Piutang Usaha ${rp(sebelum.piutang)} → ${rp(sebelum.piutang.plus(total))} | Laba Ditahan (saldo debit−kredit) ${rp(sebelum.laba)} → ${rp(sebelum.laba.minus(total))} | ${Object.entries(sebelum.saldo).map(([n, v]) => `${n} ${rp(v)}`).join(" | ")} (kas/bank TIDAK berubah)`);
  if (!APPLY) { console.log("\nPRATINJAU. Jalankan: KOREKSI_BACKUP_OK=1 node scripts/piutangAwalKeringananLunas.js --apply"); return; }
  if (process.env.KOREKSI_BACKUP_OK !== "1") throw new Error("Menolak --apply: set KOREKSI_BACKUP_OK=1 (setelah backup tervalidasi)");
  const aktor = await prisma.user.findFirst({ where: { name: AKTOR_NAMA, role: "ADMIN", active: true }, select: { id: true } });
  if (!aktor) throw new Error(`akun atribusi ${AKTOR_NAMA} tidak ditemukan`);

  const r = await prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))::text AS k", "PIUTANG_AWAL_KERINGANAN_LUNAS");
    const q = (await periksa(tx)).filter((h) => !h.sudah);
    if (q.length === 0) throw new Berhenti("sudah dikerjakan oleh proses lain");
    const awal = await foto(tx, piutang.id, laba.id);
    const nomor = [];
    for (const h of q) {
      const base = { orderId: h.o.id, customerId: h.o.customerId };
      const { entry, created } = await postJournal(tx, {
        date: tanggal,
        description: `Piutang awal order ${h.nomor} — ${h.o.customer?.name}: diserahkan sebelum pembukuan, uang pelanggan belum diterima (keringanan lunas untuk target Sales); izin Owner 6 Okt 2026. Non-kas, lawan Laba Ditahan.`,
        source: "SALDO_AWAL",
        idempotencyKey: KEY.revenue(h.o.id),
        userId: aktor.id,
        lines: [{ accountId: piutang.id, debit: h.tagihan, description: `Piutang awal ${h.nomor}`, ...base }, { accountId: laba.id, credit: h.tagihan, description: `Piutang awal ${h.nomor} (lawan Laba Ditahan)`, ...base }],
      });
      if (!created) throw new Error(`Jurnal ${h.nomor} ternyata sudah ada — dibatalkan`);
      nomor.push(entry.entryNumber);
      await recordActivity(tx, { entityType: ENTITY_TYPES.ORDER, entityId: h.o.id, eventType: EVENT_TYPES.DOCUMENT_CORRECTED, actorId: aktor.id, metadata: { aksi: "piutang_awal_keringanan_lunas", orderNumber: h.nomor, jumlah: Number(h.tagihan), jurnal: entry.entryNumber, dijalankanOleh: "Claude Code atas instruksi Owner" } });
    }
    const akhir = await foto(tx, piutang.id, laba.id);
    const tot = q.reduce((s, h) => s.plus(h.tagihan), toMoney(0));
    for (const k of Object.keys(awal.saldo)) if (!akhir.saldo[k].equals(awal.saldo[k])) throw new Error(`INVARIAN GAGAL: saldo ${k} berubah — rollback`);
    if (!akhir.piutang.equals(awal.piutang.plus(tot)) || !akhir.laba.equals(awal.laba.minus(tot))) throw new Error("INVARIAN GAGAL: saldo Piutang Usaha / Laba Ditahan — rollback");
    if (akhir.jurnal !== awal.jurnal + q.length || akhir.payment !== awal.payment || !akhir.seimbang) throw new Error("INVARIAN GAGAL: jumlah jurnal/Payment/neraca — rollback");
    return { awal, akhir, nomor, tot };
  }, { timeout: 60_000, maxWait: 20_000 });

  console.log(`\nDIBUAT ${r.nomor.length} jurnal (atribusi ${AKTOR_NAMA}): ${r.nomor.join(", ")}`);
  console.log(`Piutang Usaha ${rp(r.awal.piutang)} → ${rp(r.akhir.piutang)}; Kas/Bank tidak berubah; neraca seimbang; jurnal ${r.awal.jurnal} → ${r.akhir.jurnal}`);
  console.log(`replay: ${(await periksa(prisma)).every((h) => h.sudah) ? "tidak menggandakan (sudah dibuat)" : "PERIKSA!"}`);
}
main().catch((e) => { if (e instanceof Berhenti) { console.error("BERHENTI:", e.message); process.exitCode = 2; } else { console.error("SCRIPT ERROR:", e.message); process.exitCode = 1; } }).finally(async () => { await prisma.$disconnect(); });
