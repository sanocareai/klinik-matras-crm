// PENYESUAIAN PENGAKUAN PENDAPATAN — 4 order yang nilainya diedit SESUDAH pendapatan diakui (instruksi Owner 6 Okt 2026: dibukukan di OKTOBER).
// postRevenueRecognition mengakui pendapatan SEKALI saat order diserahkan; edit nilai order sesudahnya tidak menyesuaikan jurnal, sehingga Piutang Usaha menyimpang
// sebesar selisih nilai. Pada keempat order ini uang yang DIVERIFIKASI sama persis dengan nilai order sekarang (bukti nilai akhir yang disepakati pelanggan).
//
//   selisih = tagihan sekarang (value + ongkir) − total yang diakui + penyesuaian sebelumnya
//   selisih > 0 : Dr Piutang Usaha / Cr Pendapatan (kurang diakui)      selisih < 0 : Dr Pendapatan / Cr Piutang Usaha (kelebihan diakui)
//   Akibat: piutang tiap order → 0; Kas/Bank, Payment, order tidak tersentuh. Pendapatan neto +Rp1.300.000 (4-1100: +100.000, 4-1200: +1.200.000).
//
//   node scripts/penyesuaianPengakuanPendapatan.js                           # PRATINJAU (tidak menulis apa pun)
//   KOREKSI_BACKUP_OK=1 node scripts/penyesuaianPengakuanPendapatan.js --apply
//
// Pengaman: selisih tiap order HARUS sama dengan nilai harapan di TARGET (berbeda = berhenti: data berubah sejak pratinjau disetujui); semua syarat diperiksa ULANG di dalam
// transaksi setelah advisory lock; invarian diperiksa SEBELUM commit (gagal = rollback total). Idempoten: kunci PENYESUAIAN_PENGAKUAN:<orderId>:<tagihan>.
import { prisma } from "../src/db.js";
import { postJournal, todayBookDateWIB, STATUS_DIHITUNG } from "../src/services/finance/journal.js";
import { resolveAccount, revenueSystemKeyForOrder, SYSTEM_KEYS } from "../src/services/finance/accounts.js";
import { PILIH_TAGIHAN, tagihanOrder, resiBaru } from "../src/services/finance/tagihanOrder.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../src/lib/activityLog.js";
import { toMoney } from "../src/services/finance/money.js";
import { PREFIX_KUNCI_PENYESUAIAN as PREFIX_KUNCI } from "../src/services/finance/piutangDiagnosis.js";

const APPLY = process.argv.includes("--apply");
const AKTOR_NAMA = "OWNER (Admin)";
// nomor order → selisih yang DIHARAPKAN (tagihan sekarang − diakui). Disetujui Owner lewat pratinjau 6 Okt 2026.
const TARGET = [
  { nomor: "RES-16092026-090", selisih: -800_000 },
  { nomor: "RES-19082026-093", selisih: -100_000 },
  { nomor: "RES-13092026-080", selisih: 1_000_000 },
  { nomor: "NEW-10092026-011", selisih: 1_200_000 },
];
const rp = (v) => `Rp${Number(v).toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
class Berhenti extends Error {}

/** Total yang sudah diakui untuk order = Σ debit piutang pada pengakuan POSTED + Σ penyesuaian POSTED sebelumnya (net debit−kredit pada piutang). */
async function sudahDiakui(db, orderId, akunPiutangId) {
  const pengakuan = await db.finJournalEntry.findMany({ where: { source: "PENGAKUAN_PENDAPATAN", status: "POSTED", sourceId: orderId }, select: { lines: { where: { accountId: akunPiutangId, orderId }, select: { debit: true } } } });
  if (pengakuan.length !== 1) throw new Berhenti(`order ${orderId}: pengakuan pendapatan POSTED harus tepat 1 (ada ${pengakuan.length})`);
  const awal = toMoney(pengakuan[0].lines.reduce((s, l) => s + Number(l.debit), 0));
  const adj = await db.finJournalEntry.findMany({ where: { idempotencyKey: { startsWith: `${PREFIX_KUNCI}${orderId}:` }, status: "POSTED" }, select: { lines: { where: { accountId: akunPiutangId, orderId }, select: { debit: true, credit: true } } } });
  const net = adj.reduce((s, e) => s + e.lines.reduce((t, l) => t + Number(l.debit) - Number(l.credit), 0), 0);
  return awal.plus(net);
}

async function periksa(db) {
  const akunPiutang = await resolveAccount(db, SYSTEM_KEYS.PIUTANG_USAHA);
  const hasil = [];
  for (const t of TARGET) {
    const o = await db.order.findFirst({ where: { orderNumber: t.nomor }, select: { ...PILIH_TAGIHAN, id: true, orderNumber: true, category: true, status: true, customerId: true, paymentStatus: true } });
    if (!o) throw new Berhenti(`order ${t.nomor} tidak ditemukan`);
    if (resiBaru(o)) throw new Berhenti(`${t.nomor} bagian dari Resi Gabungan — tidak ditangani skrip ini`);
    if (Number(o.ongkir ?? 0) !== 0) throw new Berhenti(`${t.nomor} punya ongkir — penyesuaian per akun ongkir belum ditangani`);
    const tagihan = toMoney(tagihanOrder(o));
    const diakui = await sudahDiakui(db, o.id, akunPiutang.id);
    const selisih = tagihan.minus(diakui);
    const aktif = await db.payment.aggregate({ where: { orderId: o.id, cancelledAt: null, verifications: { some: {} } }, _sum: { amount: true } });
    // Bukti nilai akhir: uang terverifikasi harus sama dengan tagihan sekarang.
    if (!toMoney(aktif._sum.amount ?? 0).equals(tagihan)) throw new Berhenti(`${t.nomor}: uang terverifikasi ${rp(aktif._sum.amount ?? 0)} ≠ tagihan ${rp(tagihan)} — bukti nilai akhir tidak terpenuhi`);
    if (selisih.isZero()) { hasil.push({ ...t, o, tagihan, diakui, selisih, sudah: true }); continue; }
    if (!selisih.equals(t.selisih)) throw new Berhenti(`${t.nomor}: selisih ${rp(selisih)} ≠ yang disetujui ${rp(t.selisih)} (data berubah sejak pratinjau)`);
    hasil.push({ ...t, o, tagihan, diakui, selisih, sudah: false });
  }
  return { akunPiutang, hasil };
}

async function foto(db, akunPiutangId, orderIds) {
  const per = async (where) => { const a = await db.finJournalLine.aggregate({ where: { ...where, entry: { status: { in: STATUS_DIHITUNG } } }, _sum: { debit: true, credit: true } }); return toMoney(a._sum.debit ?? 0).minus(toMoney(a._sum.credit ?? 0)); };
  const rek = await db.finCashAccount.findMany({ select: { id: true, name: true, accountId: true } });
  const saldo = {};
  for (const r of rek) saldo[r.name] = await per({ cashAccountId: r.id, accountId: r.accountId });
  const piutangOrder = {};
  for (const id of orderIds) piutangOrder[id] = await per({ accountId: akunPiutangId, orderId: id });
  const pendapatan = await db.finAccount.findMany({ where: { type: "PENDAPATAN" }, select: { id: true, code: true } });
  const rev = {};
  for (const a of pendapatan) rev[a.code] = (await per({ accountId: a.id })).neg();
  const ner = await db.finJournalLine.aggregate({ where: { entry: { status: { in: STATUS_DIHITUNG } } }, _sum: { debit: true, credit: true } });
  return { saldo, piutang: await per({ accountId: akunPiutangId }), piutangOrder, rev, seimbang: toMoney(ner._sum.debit).equals(toMoney(ner._sum.credit)), jurnal: await db.finJournalEntry.count(), payment: await db.payment.count() };
}

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY" : "PRATINJAU (tidak menulis apa pun)"}`);
  const arg = (process.argv.find((a) => a.startsWith("--tanggal=")) ?? "").slice("--tanggal=".length);
  const tanggal = arg ? new Date(`${arg}T00:00:00Z`) : todayBookDateWIB();
  if (Number.isNaN(tanggal.getTime())) throw new Berhenti("--tanggal tidak valid (YYYY-MM-DD)");
  const bulan = new Date(tanggal).toISOString().slice(0, 7);
  if (bulan !== "2026-10") throw new Berhenti(`Tanggal pembukuan ${bulan} bukan Oktober 2026 — instruksi Owner: dibukukan di Oktober`);
  const { akunPiutang, hasil } = await periksa(prisma);
  const sebelum = await foto(prisma, akunPiutang.id, hasil.map((h) => h.o.id));
  for (const h of hasil) {
    console.log(`${h.nomor}: diakui ${rp(h.diakui)} | tagihan ${rp(h.tagihan)} | selisih ${rp(h.selisih)} | piutang order ${rp(sebelum.piutangOrder[h.o.id])} → ${rp(sebelum.piutangOrder[h.o.id].plus(h.selisih))}${h.sudah ? "  (SUDAH DISESUAIKAN)" : ""}`);
  }
  const jml = hasil.filter((h) => !h.sudah);
  if (jml.length === 0) { console.log("SUDAH DIKOREKSI — berhenti tanpa perubahan."); return; }
  const totalSelisih = jml.reduce((s, h) => s.plus(h.selisih), toMoney(0));
  console.log(`Tanggal jurnal: ${tanggal.toISOString().slice(0, 10)} (Oktober). ${jml.length} jurnal baru; Piutang Usaha ${rp(sebelum.piutang)} → ${rp(sebelum.piutang.plus(totalSelisih))}; pendapatan neto ${rp(totalSelisih)}; Kas/Bank TIDAK berubah.`);
  if (!APPLY) { console.log("\nPRATINJAU. Jalankan: KOREKSI_BACKUP_OK=1 node scripts/penyesuaianPengakuanPendapatan.js --apply"); return; }
  if (process.env.KOREKSI_BACKUP_OK !== "1") throw new Error("Menolak --apply: set KOREKSI_BACKUP_OK=1 (setelah backup tervalidasi)");
  const aktor = await prisma.user.findFirst({ where: { name: AKTOR_NAMA, role: "ADMIN", active: true }, select: { id: true } });
  if (!aktor) throw new Error(`akun atribusi ${AKTOR_NAMA} tidak ditemukan`);

  const r = await prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))::text AS k", "PENYESUAIAN_PENGAKUAN_PENDAPATAN");
    const q = await periksa(tx);
    const kerja = q.hasil.filter((h) => !h.sudah);
    if (kerja.length === 0) throw new Berhenti("sudah disesuaikan oleh proses lain");
    const awal = await foto(tx, q.akunPiutang.id, q.hasil.map((h) => h.o.id));
    const nomor = [];
    for (const h of kerja) {
      const pendapatan = await resolveAccount(tx, revenueSystemKeyForOrder(h.o));
      const nominal = h.selisih.abs();
      const kurang = h.selisih.greaterThan(0); // kurang diakui → tambah piutang & pendapatan
      const base = { orderId: h.o.id, customerId: h.o.customerId };
      const { entry, created } = await postJournal(tx, {
        date: tanggal,
        description: `Penyesuaian pengakuan pendapatan order ${h.nomor} — nilai order diubah setelah diakui (diakui ${rp(h.diakui)}, nilai sekarang ${rp(h.tagihan)}); uang terverifikasi sama dengan nilai sekarang; izin Owner 6 Okt 2026, dibukukan Oktober`,
        source: "MANUAL",
        idempotencyKey: `${PREFIX_KUNCI}${h.o.id}:${h.tagihan.toString()}`,
        userId: aktor.id,
        lines: kurang
          ? [{ accountId: q.akunPiutang.id, debit: nominal, description: `Piutang — penyesuaian ${h.nomor}`, ...base }, { accountId: pendapatan.id, credit: nominal, description: `Pendapatan — penyesuaian ${h.nomor}`, ...base }]
          : [{ accountId: pendapatan.id, debit: nominal, description: `Pendapatan — penyesuaian ${h.nomor}`, ...base }, { accountId: q.akunPiutang.id, credit: nominal, description: `Piutang — penyesuaian ${h.nomor}`, ...base }],
      });
      if (!created) throw new Error(`Jurnal penyesuaian ${h.nomor} ternyata sudah ada — dibatalkan`);
      nomor.push(entry.entryNumber);
      await recordActivity(tx, { entityType: ENTITY_TYPES.ORDER, entityId: h.o.id, eventType: EVENT_TYPES.DOCUMENT_CORRECTED, actorId: aktor.id, metadata: { aksi: "penyesuaian_pengakuan_pendapatan", orderNumber: h.nomor, diakui: Number(h.diakui), tagihan: Number(h.tagihan), selisih: Number(h.selisih), jurnal: entry.entryNumber, dijalankanOleh: "Claude Code atas instruksi Owner" } });
    }
    const akhir = await foto(tx, q.akunPiutang.id, q.hasil.map((h) => h.o.id));
    for (const k of Object.keys(awal.saldo)) if (!akhir.saldo[k].equals(awal.saldo[k])) throw new Error(`INVARIAN GAGAL: saldo ${k} berubah — rollback`);
    for (const h of kerja) if (!akhir.piutangOrder[h.o.id].equals(awal.piutangOrder[h.o.id].plus(h.selisih))) throw new Error(`INVARIAN GAGAL: piutang ${h.nomor} — rollback`);
    const total = kerja.reduce((s, h) => s.plus(h.selisih), toMoney(0));
    if (!akhir.piutang.equals(awal.piutang.plus(total))) throw new Error("INVARIAN GAGAL: total Piutang Usaha — rollback");
    const revAwal = Object.values(awal.rev).reduce((s, v) => s.plus(v), toMoney(0)); const revAkhir = Object.values(akhir.rev).reduce((s, v) => s.plus(v), toMoney(0));
    if (!revAkhir.equals(revAwal.plus(total))) throw new Error("INVARIAN GAGAL: total pendapatan — rollback");
    if (akhir.jurnal !== awal.jurnal + kerja.length || akhir.payment !== awal.payment || !akhir.seimbang) throw new Error("INVARIAN GAGAL: jumlah jurnal/Payment/neraca — rollback");
    return { awal, akhir, nomor, total };
  }, { timeout: 60_000, maxWait: 20_000 });

  console.log(`\nDIBUAT ${r.nomor.length} jurnal (atribusi ${AKTOR_NAMA}): ${r.nomor.join(", ")}`);
  console.log(`Piutang Usaha ${rp(r.awal.piutang)} → ${rp(r.akhir.piutang)}; pendapatan neto ${rp(r.total)}; Kas/Bank tidak berubah; neraca seimbang; jurnal ${r.awal.jurnal} → ${r.akhir.jurnal}`);
  const ulang = await periksa(prisma);
  console.log(`replay: ${ulang.hasil.every((h) => h.sudah) ? "tidak menggandakan (sudah disesuaikan)" : "PERIKSA!"}`);
}
main().catch((e) => { if (e instanceof Berhenti) { console.error("BERHENTI:", e.message); process.exitCode = 2; } else { console.error("SCRIPT ERROR:", e.message); process.exitCode = 1; } }).finally(async () => { await prisma.$disconnect(); });
