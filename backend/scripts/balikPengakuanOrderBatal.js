// BALIK PENGAKUAN PENDAPATAN ORDER YANG SUDAH DIBATALKAN (laporan Owner 6 Okt 2026: order CANCELLED masih muncul di Piutang).
// Sebelum perbaikan hooks.js#batalkanPengakuanPendapatan, membatalkan order TIDAK membalik jurnal pengakuannya, sehingga piutang & pendapatan order batal tetap di buku. Skrip ini membalik
// pengakuan yang tertinggal untuk order CANCELLED lama. Pembatalan BARU sudah otomatis.
//
//   Syarat tiap order (diperiksa ulang di dalam transaksi): status CANCELLED; tepat 1 jurnal pengakuan POSTED; TIDAK ada Payment aktif / alokasi; saldo piutang order = nilai pengakuan.
//   Jurnal pembalik bertanggal HARI INI (Oktober, periode berjalan). Kas/Bank, Payment, status order TIDAK tersentuh. Pendapatan dan piutang turun sebesar yang diakui.
//
//   node scripts/balikPengakuanOrderBatal.js                          # PRATINJAU (tidak menulis apa pun)
//   KOREKSI_BACKUP_OK=1 node scripts/balikPengakuanOrderBatal.js --apply
import { prisma } from "../src/db.js";
import { reverseJournal, todayBookDateWIB, STATUS_DIHITUNG } from "../src/services/finance/journal.js";
import { resolveAccount, SYSTEM_KEYS } from "../src/services/finance/accounts.js";
import { KEY } from "../src/services/finance/posting/orderRevenue.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../src/lib/activityLog.js";
import { toMoney } from "../src/services/finance/money.js";

const APPLY = process.argv.includes("--apply");
const AKTOR_NAMA = "OWNER (Admin)";
// nomor order → saldo piutang yang DIHARAPKAN (disetujui lewat pratinjau); berbeda = data berubah sejak itu → berhenti
const TARGET = {
  "NEW-01102026-004": 1_600_000, "NEW-30092026-052": 1_350_000, "NEW-30092026-053": 900_000, "SWS-28092026-015": 200_000,
  "NEW-30092026-054": 200_000, "NEW-30092026-050": 200_000, "NEW-30092026-051": 200_000,
};
const rp = (v) => `Rp${Number(v).toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
class Berhenti extends Error {}

async function saldoPiutangOrder(db, akunId, orderId) {
  const a = await db.finJournalLine.aggregate({ where: { accountId: akunId, orderId, entry: { status: { in: STATUS_DIHITUNG } } }, _sum: { debit: true, credit: true } });
  return toMoney(a._sum.debit ?? 0).minus(toMoney(a._sum.credit ?? 0));
}

async function periksa(db, akunId) {
  const hasil = [];
  for (const [nomor, harapan] of Object.entries(TARGET)) {
    const o = await db.order.findFirst({ where: { orderNumber: nomor }, select: { id: true, orderNumber: true, status: true, customer: { select: { name: true } } } });
    if (!o) throw new Berhenti(`order ${nomor} tidak ditemukan`);
    if (o.status !== "CANCELLED") throw new Berhenti(`${nomor}: status ${o.status}, harus CANCELLED`);
    const aktif = await db.finJournalEntry.findMany({ where: { idempotencyKey: { startsWith: KEY.revenue(o.id) }, status: "POSTED" }, select: { id: true, entryNumber: true } });
    const saldo = await saldoPiutangOrder(db, akunId, o.id);
    if (aktif.length === 0) { hasil.push({ nomor, o, saldo, sudah: true }); continue; }
    if (aktif.length !== 1) throw new Berhenti(`${nomor}: pengakuan POSTED harus tepat 1 (ada ${aktif.length})`);
    const payment = await db.payment.count({ where: { orderId: o.id, cancelledAt: null } });
    const alokasi = await db.finPaymentAllocation.count({ where: { orderId: o.id } });
    if (payment || alokasi) throw new Berhenti(`${nomor}: ada Payment aktif/alokasi — uangnya harus ditangani lewat refund, bukan skrip ini`);
    if (!saldo.equals(harapan)) throw new Berhenti(`${nomor}: saldo piutang ${rp(saldo)} ≠ yang disetujui ${rp(harapan)} (data berubah sejak pratinjau)`);
    hasil.push({ nomor, o, saldo, entry: aktif[0], sudah: false });
  }
  return hasil;
}

async function foto(db, piutangId) {
  const per = async (where) => { const a = await db.finJournalLine.aggregate({ where: { ...where, entry: { status: { in: STATUS_DIHITUNG } } }, _sum: { debit: true, credit: true } }); return toMoney(a._sum.debit ?? 0).minus(toMoney(a._sum.credit ?? 0)); };
  const rek = await db.finCashAccount.findMany({ select: { id: true, name: true, accountId: true } });
  const saldo = {};
  for (const r of rek) saldo[r.name] = await per({ cashAccountId: r.id, accountId: r.accountId });
  const pendapatan = await db.finAccount.findMany({ where: { type: "PENDAPATAN" }, select: { id: true } });
  let rev = toMoney(0);
  for (const a of pendapatan) rev = rev.minus(await per({ accountId: a.id }));
  const ner = await db.finJournalLine.aggregate({ where: { entry: { status: { in: STATUS_DIHITUNG } } }, _sum: { debit: true, credit: true } });
  return { saldo, piutang: await per({ accountId: piutangId }), rev, seimbang: toMoney(ner._sum.debit ?? 0).equals(toMoney(ner._sum.credit ?? 0)), jurnal: await db.finJournalEntry.count(), payment: await db.payment.count() };
}

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY" : "PRATINJAU (tidak menulis apa pun)"}`);
  const piutang = await resolveAccount(prisma, SYSTEM_KEYS.PIUTANG_USAHA);
  const hasil = await periksa(prisma, piutang.id);
  const kerja = hasil.filter((h) => !h.sudah);
  for (const h of hasil) console.log(`${h.nomor} | ${h.o.customer?.name} | piutang ${rp(h.saldo)}${h.sudah ? "  (SUDAH DIBALIK)" : ` | pengakuan ${h.entry.entryNumber} → dibalik`}`);
  if (kerja.length === 0) { console.log("SUDAH DIKOREKSI — berhenti tanpa perubahan."); return; }
  const total = kerja.reduce((s, h) => s.plus(h.saldo), toMoney(0));
  const sebelum = await foto(prisma, piutang.id);
  console.log(`\nTanggal pembalik: ${todayBookDateWIB().toISOString().slice(0, 10)}. ${kerja.length} jurnal pembalik; Piutang Usaha ${rp(sebelum.piutang)} → ${rp(sebelum.piutang.minus(total))}; pendapatan ${rp(sebelum.rev)} → ${rp(sebelum.rev.minus(total))}; Kas/Bank TIDAK berubah.`);
  if (!APPLY) { console.log("\nPRATINJAU. Jalankan: KOREKSI_BACKUP_OK=1 node scripts/balikPengakuanOrderBatal.js --apply"); return; }
  if (process.env.KOREKSI_BACKUP_OK !== "1") throw new Error("Menolak --apply: set KOREKSI_BACKUP_OK=1 (setelah backup tervalidasi)");
  const aktor = await prisma.user.findFirst({ where: { name: AKTOR_NAMA, role: "ADMIN", active: true }, select: { id: true } });
  if (!aktor) throw new Error(`akun atribusi ${AKTOR_NAMA} tidak ditemukan`);

  const r = await prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))::text AS k", "BALIK_PENGAKUAN_ORDER_BATAL");
    const q = (await periksa(tx, piutang.id)).filter((h) => !h.sudah);
    if (q.length === 0) throw new Berhenti("sudah dikerjakan oleh proses lain");
    const awal = await foto(tx, piutang.id);
    const nomor = [];
    for (const h of q) {
      const pembalik = await reverseJournal(tx, { entryId: h.entry.id, reason: `Order ${h.nomor} dibatalkan — pengakuan pendapatan dibalik (koreksi pembatalan lama); izin Owner 6 Okt 2026`, userId: aktor.id });
      nomor.push(pembalik.entryNumber);
      await recordActivity(tx, { entityType: ENTITY_TYPES.ORDER, entityId: h.o.id, eventType: EVENT_TYPES.DOCUMENT_CORRECTED, actorId: aktor.id, metadata: { aksi: "balik_pengakuan_order_batal", orderNumber: h.nomor, jurnalAsli: h.entry.entryNumber, jurnalPembalik: pembalik.entryNumber, jumlah: Number(h.saldo), dijalankanOleh: "Claude Code atas instruksi Owner" } });
    }
    const akhir = await foto(tx, piutang.id);
    const tot = q.reduce((s, h) => s.plus(h.saldo), toMoney(0));
    for (const k of Object.keys(awal.saldo)) if (!akhir.saldo[k].equals(awal.saldo[k])) throw new Error(`INVARIAN GAGAL: saldo ${k} berubah — rollback`);
    if (!akhir.piutang.equals(awal.piutang.minus(tot))) throw new Error("INVARIAN GAGAL: total Piutang Usaha — rollback");
    if (!akhir.rev.equals(awal.rev.minus(tot))) throw new Error("INVARIAN GAGAL: total pendapatan — rollback");
    for (const h of q) if (!(await saldoPiutangOrder(tx, piutang.id, h.o.id)).isZero()) throw new Error(`INVARIAN GAGAL: piutang ${h.nomor} belum nol — rollback`);
    if (akhir.jurnal !== awal.jurnal + q.length || akhir.payment !== awal.payment || !akhir.seimbang) throw new Error("INVARIAN GAGAL: jumlah jurnal/Payment/neraca — rollback");
    return { awal, akhir, nomor, tot };
  }, { timeout: 60_000, maxWait: 20_000 });

  console.log(`\nDIBUAT ${r.nomor.length} jurnal pembalik (atribusi ${AKTOR_NAMA}): ${r.nomor.join(", ")}`);
  console.log(`Piutang Usaha ${rp(r.awal.piutang)} → ${rp(r.akhir.piutang)}; pendapatan ${rp(r.awal.rev)} → ${rp(r.akhir.rev)}; Kas/Bank tidak berubah; neraca seimbang; jurnal ${r.awal.jurnal} → ${r.akhir.jurnal}`);
  console.log(`replay: ${(await periksa(prisma, piutang.id)).every((h) => h.sudah) ? "tidak menggandakan (sudah dibalik)" : "PERIKSA!"}`);
}
main().catch((e) => { if (e instanceof Berhenti) { console.error("BERHENTI:", e.message); process.exitCode = 2; } else { console.error("SCRIPT ERROR:", e.message); process.exitCode = 1; } }).finally(async () => { await prisma.$disconnect(); });
