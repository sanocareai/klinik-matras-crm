// KOREKSI Rp1 ORDER RES-28092026-179 (izin Owner 8 Okt 2026 — HANYA order ini).
//
// Rantai: Payment Rp1 (2b6beabb…, JV-06102026-185: Dr Kas / Cr Uang Muka) → pendapatan diakui (JV-06102026-188 memindahkan Uang Muka Rp1 jadi pelunasan piutang: Dr Uang Muka / Cr Piutang)
// → Payment Rp1 ditolak/dibatalkan 7 Okt (pembalik JV-07102026-208, TANPA menyesuaikan pemindahan di 188) → Payment pengganti Rp1.200.000 (JV-06102026-217).
// Akibat: Uang Muka order bersaldo DEBIT Rp1 dan Piutang order bersaldo KREDIT Rp1 (minus). Kode perbaikan (reklasUangMuka.js) mencegah kasus baru; skrip ini membereskan satu kasus lama.
//
// KOREKSI = jurnal baru lewat helper yang SAMA dengan jalur kode (sesuaikanReklasUangMuka), kunci idempoten sama dengan konvensi:
//   PEMBAYARAN_ORDER:<paymentId>:RECLAS:<orderId>      Dr 1-1300 Piutang Usaha Rp1 / Cr 2-1200 Uang Muka Pelanggan Rp1  (dimensi order & pelanggan)
// Tidak menyentuh kas/bank, Payment, order, atau status. Jurnal lama tidak diubah.
//
//   node scripts/koreksiRp1Reklas20260928179.js                       # PRATINJAU (tidak menulis apa pun)
//   KOREKSI_BACKUP_OK=1 node scripts/koreksiRp1Reklas20260928179.js --apply   # setelah backup database divalidasi
//
// Semua syarat diperiksa ULANG di dalam transaksi (di bawah advisory lock); invarian diperiksa SEBELUM commit — tidak cocok = rollback total.
// Idempoten: bila kunci koreksi sudah ada → berhenti TANPA menambah jurnal (exit 0). Bila anomali sudah tidak ada → TIDAK menulis jurnal (exit 0).

import { prisma } from "../src/db.js";
import { sesuaikanReklasUangMuka, kunciReklas } from "../src/services/finance/reklasUangMuka.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../src/lib/activityLog.js";
import { toMoney, ZERO } from "../src/services/finance/money.js";

const APPLY = process.argv.includes("--apply");
const ORDER_NO = "RES-28092026-179";
const PAYMENT_ID = "2b6beabb-0bc4-4ec4-af66-fbbfa8cfbe7a"; // Payment Rp1 yang dibatalkan
const NO_BAYAR_ASLI = "JV-06102026-185";
const NO_PENGAKUAN = "JV-06102026-188";
const NO_PEMBALIK = "JV-07102026-208";
const NOMINAL = toMoney("1");
const AKTOR_EMAIL = "admin@klinikmatras.com"; // "OWNER (Admin)" — atribusi yang sama dengan koreksi Owner sebelumnya
const rp = (v) => `Rp${Number(v).toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const STATUS = ["POSTED", "REVERSED"];

class Berhenti extends Error {}

const saldoAkunOrder = async (db, systemKey, orderId) => {
  const akun = await db.finAccount.findUnique({ where: { systemKey }, select: { id: true } });
  const a = await db.finJournalLine.aggregate({ where: { accountId: akun.id, orderId, entry: { status: { in: STATUS } } }, _sum: { debit: true, credit: true } });
  return toMoney(a._sum.debit ?? 0).minus(toMoney(a._sum.credit ?? 0));
};
const saldoAkun = async (db, systemKey) => {
  const akun = await db.finAccount.findUnique({ where: { systemKey }, select: { id: true } });
  const a = await db.finJournalLine.aggregate({ where: { accountId: akun.id, entry: { status: { in: STATUS } } }, _sum: { debit: true, credit: true } });
  return toMoney(a._sum.debit ?? 0).minus(toMoney(a._sum.credit ?? 0));
};
async function saldoRekening(db) {
  const rek = await db.finCashAccount.findMany({ select: { id: true, name: true, accountId: true } });
  const out = {};
  for (const r of rek) {
    const a = await db.finJournalLine.aggregate({ where: { cashAccountId: r.id, accountId: r.accountId, entry: { status: { in: STATUS } } }, _sum: { debit: true, credit: true } });
    out[r.name] = toMoney(a._sum.debit ?? 0).minus(toMoney(a._sum.credit ?? 0));
  }
  return out;
}
async function neraca(db) {
  const a = await db.finJournalLine.aggregate({ where: { entry: { status: { in: STATUS } } }, _sum: { debit: true, credit: true } });
  return { debit: toMoney(a._sum.debit ?? 0), kredit: toMoney(a._sum.credit ?? 0) };
}
/** Sidik jari seluruh order LAIN: saldo Piutang + Uang Muka per order (string) — harus identik sebelum/sesudah. */
async function sidikJariOrderLain(db, orderId) {
  const rows = await db.$queryRawUnsafe(`
    select coalesce(l.order_id,'-') as oid, a.system_key as k, sum(l.debit - l.credit)::text as s
    from fin_journal_lines l join fin_journal_entries e on e.id = l.entry_id join fin_accounts a on a.id = l.account_id
    where a.system_key in ('PIUTANG_USAHA','UANG_MUKA_PELANGGAN') and e.status in ('POSTED','REVERSED') and (l.order_id is distinct from $1)
    group by 1,2 order by 1,2`, orderId);
  return JSON.stringify(rows);
}
async function fotoOrderDanPayment(db, orderId) {
  const o = await db.order.findUnique({ where: { id: orderId } });
  const p = await db.payment.findMany({ where: { orderId }, orderBy: { id: "asc" } });
  return JSON.stringify({ o, p });
}

/** Periksa seluruh syarat. { sudahDikoreksi, info } atau { ... data } atau melempar Berhenti. */
async function periksa(db) {
  const order = await db.order.findFirst({ where: { orderNumber: ORDER_NO }, select: { id: true, orderNumber: true, customerId: true } });
  if (!order) throw new Berhenti(`order ${ORDER_NO} tidak ditemukan`);
  const kunci = kunciReklas(PAYMENT_ID, order.id);
  const sudah = await db.finJournalEntry.findUnique({ where: { idempotencyKey: kunci }, select: { entryNumber: true } });
  const lain = await db.finJournalEntry.count({ where: { idempotencyKey: { contains: ":RECLAS:" }, lines: { some: { orderId: order.id } } } });
  if (sudah || lain > 0) return { sudahDikoreksi: true, info: `jurnal penyesuaian sudah ada (${sudah?.entryNumber ?? `${lain} entri RECLAS pada order`})` };

  const pay = await db.payment.findUnique({ where: { id: PAYMENT_ID } });
  if (!pay || pay.orderId !== order.id) throw new Berhenti("Payment Rp1 tidak ditemukan / bukan milik order ini");
  if (!pay.cancelledAt) throw new Berhenti("Payment Rp1 TIDAK dibatalkan (harus sudah ditolak/dibatalkan)");
  if (!toMoney(pay.amount).equals(NOMINAL)) throw new Berhenti(`Payment bernominal ${pay.amount} (harus Rp1)`);

  const asli = await db.finJournalEntry.findUnique({ where: { entryNumber: NO_BAYAR_ASLI }, include: { lines: true } });
  if (!asli || asli.idempotencyKey !== `PEMBAYARAN_ORDER:${PAYMENT_ID}` || asli.status !== "REVERSED") throw new Berhenti(`${NO_BAYAR_ASLI} bukan jurnal asli Payment Rp1 berstatus REVERSED`);
  const balik = await db.finJournalEntry.findUnique({ where: { entryNumber: NO_PEMBALIK }, select: { status: true, reversalOfId: true } });
  if (!balik || balik.status !== "POSTED" || balik.reversalOfId !== asli.id) throw new Berhenti(`${NO_PEMBALIK} bukan pembalik POSTED dari ${NO_BAYAR_ASLI}`);
  const pengakuan = await db.finJournalEntry.findUnique({ where: { entryNumber: NO_PENGAKUAN }, include: { lines: { include: { account: { select: { systemKey: true } } } } } });
  if (!pengakuan || pengakuan.source !== "PENGAKUAN_PENDAPATAN" || pengakuan.status !== "POSTED" || pengakuan.sourceId !== order.id) throw new Berhenti(`${NO_PENGAKUAN} bukan pengakuan pendapatan POSTED order ini`);
  const dpUM = pengakuan.lines.filter((l) => l.account.systemKey === "UANG_MUKA_PELANGGAN").reduce((s, l) => s.plus(toMoney(l.debit)).minus(toMoney(l.credit)), ZERO);
  if (!dpUM.equals(NOMINAL)) throw new Berhenti(`pengakuan memindahkan Uang Muka ${rp(dpUM)} (harus Rp1)`);

  const um = await saldoAkunOrder(db, "UANG_MUKA_PELANGGAN", order.id);
  const pi = await saldoAkunOrder(db, "PIUTANG_USAHA", order.id);
  if (!um.equals(NOMINAL)) throw new Berhenti(`saldo Uang Muka order ${rp(um)} (harus debit Rp1 — anomali tidak sesuai dugaan)`);
  if (!pi.equals(NOMINAL.negated())) throw new Berhenti(`saldo Piutang order ${rp(pi)} (harus kredit Rp1 — anomali tidak sesuai dugaan)`);
  const aktor = await db.user.findFirst({ where: { email: AKTOR_EMAIL, role: "ADMIN", active: true }, select: { id: true, name: true } });
  if (!aktor) throw new Berhenti(`akun atribusi ${AKTOR_EMAIL} tidak ditemukan`);
  return { sudahDikoreksi: false, order, asli, aktor, um, pi, kunci };
}

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY (menulis ke database)" : "PRATINJAU (tidak menulis apa pun)"}`);
  const p = await periksa(prisma);
  if (p.sudahDikoreksi) { console.log(`SUDAH DIKOREKSI (${p.info}) — berhenti tanpa menambah jurnal.`); return; }
  const sebelum = { rek: await saldoRekening(prisma), neraca: await neraca(prisma), n: await prisma.finJournalEntry.count(), lain: await sidikJariOrderLain(prisma, p.order.id), foto: await fotoOrderDanPayment(prisma, p.order.id) };
  const hitung = await prisma.$transaction((tx) => sesuaikanReklasUangMuka(tx, { paymentId: PAYMENT_ID, entryAsli: p.asli, hanyaHitung: true }));
  if (hitung.length !== 1 || hitung[0].orderId !== p.order.id || hitung[0].jumlah !== 1) throw new Berhenti(`helper tidak menghasilkan tepat satu penyesuaian Rp1 untuk order ini: ${JSON.stringify(hitung)}`);

  console.log(`\nOrder          : ${ORDER_NO}`);
  console.log(`Rantai         : Payment Rp1 (${NO_BAYAR_ASLI}, REVERSED) → pengakuan ${NO_PENGAKUAN} memindahkan Uang Muka Rp1 → pembalik ${NO_PEMBALIK}`);
  console.log(`Kondisi aktual : Piutang order ${rp(p.pi)} (kredit/minus) · Uang Muka order ${rp(p.um)} (debit)`);
  console.log(`\nLangkah (satu transaksi, helper sesuaikanReklasUangMuka — jurnal baru, jurnal lama tidak diubah):`);
  console.log(`  Dr 1-1300 Piutang Usaha ${rp(1)} / Cr 2-1200 Uang Muka Pelanggan ${rp(1)}   dimensi order+pelanggan, tanggal hari ini (WIB), kunci ${p.kunci}`);
  console.log(`  atribusi: ${p.aktor.name} (${AKTOR_EMAIL})`);
  console.log(`\nDampak yang DIHARAPKAN: Piutang order ${rp(0)}, Uang Muka order ${rp(0)}; kas/bank, Payment, order, status, order lain TIDAK berubah; jurnal ${sebelum.n} → ${sebelum.n + 1}`);
  console.log(`Neraca saat ini: debit ${rp(sebelum.neraca.debit)} = kredit ${rp(sebelum.neraca.kredit)}`);
  if (!APPLY) { console.log("\nIni PRATINJAU. Backup dulu, lalu: KOREKSI_BACKUP_OK=1 node scripts/koreksiRp1Reklas20260928179.js --apply"); return; }
  if (process.env.KOREKSI_BACKUP_OK !== "1") throw new Error("Menolak --apply: set KOREKSI_BACKUP_OK=1 SETELAH backup database dibuat dan divalidasi.");

  const hasil = await prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))::text AS k", "KOREKSI_RP1_RES_28092026_179");
    const q = await periksa(tx); // periksa ULANG di bawah kunci
    if (q.sudahDikoreksi) throw new Berhenti(`sudah dikoreksi oleh proses lain (${q.info})`);
    const sblm = { rek: await saldoRekening(tx), neraca: await neraca(tx), n: await tx.finJournalEntry.count(), lain: await sidikJariOrderLain(tx, q.order.id), foto: await fotoOrderDanPayment(tx, q.order.id) };
    const r = await sesuaikanReklasUangMuka(tx, { paymentId: PAYMENT_ID, entryAsli: q.asli, userId: q.aktor.id });
    if (r.length !== 1 || !r[0].dibuat || r[0].jumlah !== 1) throw new Error(`penyesuaian tidak sesuai harapan: ${JSON.stringify(r)}`);
    const entry = await tx.finJournalEntry.findUnique({ where: { idempotencyKey: q.kunci } });
    await recordActivity(tx, {
      entityType: ENTITY_TYPES.FIN_JOURNAL, entityId: entry.id, eventType: EVENT_TYPES.DOCUMENT_CORRECTED, actorId: q.aktor.id,
      metadata: { aksi: "koreksi_rp1_reklas_uang_muka", order: ORDER_NO, paymentId: PAYMENT_ID, jurnalAsliPayment: NO_BAYAR_ASLI, jurnalPengakuan: NO_PENGAKUAN, jurnalPembalik: NO_PEMBALIK, jurnalKoreksi: r[0].entryNumber, jumlah: 1, izin: "Owner 8 Okt 2026" },
    });

    // INVARIAN — diperiksa SEBELUM commit; tidak cocok = rollback total (throw).
    const ssdh = { rek: await saldoRekening(tx), neraca: await neraca(tx), n: await tx.finJournalEntry.count(), lain: await sidikJariOrderLain(tx, q.order.id), foto: await fotoOrderDanPayment(tx, q.order.id) };
    for (const [n, v] of Object.entries(sblm.rek)) if (!ssdh.rek[n].equals(v)) throw new Error(`INVARIAN GAGAL: saldo rekening ${n} berubah — rollback`);
    if (!(await saldoAkunOrder(tx, "PIUTANG_USAHA", q.order.id)).isZero()) throw new Error("INVARIAN GAGAL: Piutang order tidak nol — rollback");
    if (!(await saldoAkunOrder(tx, "UANG_MUKA_PELANGGAN", q.order.id)).isZero()) throw new Error("INVARIAN GAGAL: Uang Muka order tidak nol — rollback");
    if (!ssdh.neraca.debit.equals(ssdh.neraca.kredit)) throw new Error("INVARIAN GAGAL: neraca tidak seimbang — rollback");
    if (!ssdh.neraca.debit.minus(sblm.neraca.debit).equals(NOMINAL) || !ssdh.neraca.kredit.minus(sblm.neraca.kredit).equals(NOMINAL)) throw new Error("INVARIAN GAGAL: total debit/kredit bertambah selain Rp1 — rollback");
    if (ssdh.n !== sblm.n + 1) throw new Error(`INVARIAN GAGAL: jumlah jurnal ${sblm.n} → ${ssdh.n} (harus +1) — rollback`);
    if (ssdh.lain !== sblm.lain) throw new Error("INVARIAN GAGAL: saldo Piutang/Uang Muka ORDER LAIN berubah — rollback");
    if (ssdh.foto !== sblm.foto) throw new Error("INVARIAN GAGAL: order atau Payment berubah — rollback");
    const kasLines = await tx.finJournalLine.count({ where: { entryId: entry.id, cashAccountId: { not: null } } });
    if (kasLines !== 0) throw new Error("INVARIAN GAGAL: jurnal koreksi menyentuh kas/bank — rollback");
    return { entryNumber: r[0].entryNumber, aktor: q.aktor.name };
  }, { timeout: 60_000, maxWait: 20_000 });

  console.log(`\nDITERAPKAN: ${hasil.entryNumber} (atribusi: ${hasil.aktor})`);
  const sesudah = { rek: await saldoRekening(prisma), neraca: await neraca(prisma), n: await prisma.finJournalEntry.count() };
  console.log("VERIFIKASI:");
  console.log(`  Piutang order    ${rp(p.pi)} → ${rp(await saldoAkunOrder(prisma, "PIUTANG_USAHA", p.order.id))}`);
  console.log(`  Uang Muka order  ${rp(p.um)} (debit) → ${rp(await saldoAkunOrder(prisma, "UANG_MUKA_PELANGGAN", p.order.id))}`);
  for (const [n, v] of Object.entries(sesudah.rek)) console.log(`  rekening ${n.padEnd(14)} ${rp(sebelum.rek[n])} → ${rp(v)}`);
  console.log(`  jurnal ${sebelum.n} → ${sesudah.n}; neraca debit ${rp(sesudah.neraca.debit)} ${sesudah.neraca.debit.equals(sesudah.neraca.kredit) ? "= kredit (SEIMBANG)" : "≠ kredit (TIDAK SEIMBANG!)"}`);
  const ulang = await periksa(prisma);
  console.log(`  replay           ${ulang.sudahDikoreksi ? `tidak menggandakan koreksi (${ulang.info})` : "PERIKSA: replay tidak mendeteksi koreksi!"}`);
}

main().catch((e) => { if (e instanceof Berhenti) { console.error("BERHENTI:", e.message); process.exitCode = 2; } else { console.error("SCRIPT ERROR:", e.message); process.exitCode = 1; } }).finally(async () => { await prisma.$disconnect(); });
