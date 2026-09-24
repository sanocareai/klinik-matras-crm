#!/usr/bin/env node
// B3 — Periode rekonsiliasi cutoff 22 Sep 2026 + snapshot periode 19–21 Sep yang sudah ada.
//
//   node scripts/rekonCutoff20260922.js           PRATINJAU (default, tidak menulis apa pun)
//   node scripts/rekonCutoff20260922.js --apply   buat periode 22 Sep (PT Sano, KEM) + snapshot keempat periode (idempoten)
//
// TIDAK membuat jurnal, mutasi bank, atau penyeimbang. Hanya mencatat angka yang SUDAH DIKONFIRMASI owner (baseline privat
// finance-2026-09-22) dan potret buku pada high-water mark yang dibuktikan data. Script BERHENTI bila saldo buku pada high-water mark
// tidak sama dengan angka yang tercatat di bukti (tidak ada penyesuaian diam-diam).
//
// Waktu (UTC di DB; WIB = UTC+7):
//   19–21 Sep: cutoff bank 19 Sep 20.00 → 21 Sep 20.00 WIB. Periode dicatat sistem 21 Sep 19.18.26 UTC (= saat konfirmasi owner
//              diinput). High-water mark = waktu pencatatan itu; catatan periode menyebut PT selisih Rp0 & KEM buku lebih tinggi Rp2.526.981.
//   22 Sep:    cutoff literal 22 Sep 19.00 WIB (12.00 UTC). Bukti: PT Sano HANYA cocok dengan saldo riil bila jurnal sampai
//              JV-22092026-513 (dibuat 14.33.14 UTC = 21.33 WIB) ikut dihitung → high-water mark EFEKTIF = waktu jurnal itu.
//              Kedua waktu disimpan (cutoff_end_at = literal, hwm_at = efektif) beserta penjelasannya.
import "dotenv/config";
import { prisma } from "../src/db.js";
import { buatPeriodeSementara } from "../src/services/finance/rekonBank.js";
import { buatSnapshot, hitungIsiSnapshot } from "../src/services/finance/rekonSnapshot.js";
import { toMoney, moneyToNumber } from "../src/services/finance/money.js";

const APPLY = process.argv.includes("--apply");

const PERIODE_22 = [
  {
    sourceKey: "REKON_SEMENTARA_20260922:PT_SANO", rekening: "PT Sano", periodStart: "2026-09-22", periodEnd: "2026-09-22",
    openingBalance: "39180615", closingBalance: "57566615",
    note: "Cutoff: 21 Sep 2026 pukul 20.00 WIB sampai 22 Sep 2026 pukul 19.00 WIB (literal); pengecekan saldo riil efektif mencakup posting sampai ±21.33 WIB. Saldo awal & akhir = saldo riil terkonfirmasi owner. Menunggu rekening koran.",
    buktiBuku: "57566615",
  },
  {
    sourceKey: "REKON_SEMENTARA_20260922:KEM_SANO", rekening: "KEM - Sano Bank", periodStart: "2026-09-22", periodEnd: "2026-09-22",
    openingBalance: "4912088", closingBalance: "7375118",
    note: "Cutoff: 21 Sep 2026 pukul 20.00 WIB sampai 22 Sep 2026 pukul 19.00 WIB (literal); pengecekan efektif ±21.33 WIB. Saldo awal & akhir = saldo riil terkonfirmasi owner. Selisih buku pada snapshot tidak dikoreksi di sini. Menunggu rekening koran.",
    buktiBuku: "6046399",
  },
];
const HWM_22_NOMOR = "JV-22092026-513";
const CUTOFF_22_AWAL = new Date("2026-09-21T13:00:00.000Z");
const CUTOFF_22_LITERAL = new Date("2026-09-22T12:00:00.000Z");
const BATAS_HWM_22 = new Date("2026-09-22T15:00:00.000Z"); // bukti: tidak ada jurnal kas/bank 22 Sep 14.34–15.00 UTC

const PERIODE_19 = [
  { sourceKey: "REKON_SEMENTARA_20260919_20260921:PT_SANO", buktiBuku: "39180615" },
  { sourceKey: "REKON_SEMENTARA_20260919_20260921:KEM_SANO", buktiBuku: "7439069" },
];

async function main() {
  const out = { mode: APPLY ? "APPLY" : "PRATINJAU", periode: [] };
  const hwmEntry = await prisma.finJournalEntry.findUnique({ where: { entryNumber: HWM_22_NOMOR }, select: { id: true, createdAt: true, date: true } });
  if (!hwmEntry) throw new Error(`${HWM_22_NOMOR} tidak ditemukan — hentikan`);
  if (!(hwmEntry.createdAt > CUTOFF_22_LITERAL && hwmEntry.createdAt < BATAS_HWM_22)) throw new Error(`${HWM_22_NOMOR} dibuat ${hwmEntry.createdAt.toISOString()} — di luar jendela bukti, hentikan`);
  const hwm22 = hwmEntry.createdAt;

  // 1) Periode 19–21 (sudah ada): snapshot pada waktu pencatatan konfirmasi.
  for (const p of PERIODE_19) {
    const s = await prisma.finBankStatement.findUnique({ where: { sourceKey: p.sourceKey }, include: { snapshot: true, cashAccount: true } });
    if (!s) { out.periode.push({ sourceKey: p.sourceKey, status: "TIDAK_ADA" }); continue; }
    const isi = await hitungIsiSnapshot(prisma, { cashAccountId: s.cashAccountId, periodStart: s.periodStart, periodEnd: s.periodEnd, hwmAt: s.createdAt });
    const cocok = isi.bookBalance.equals(toMoney(p.buktiBuku));
    out.periode.push({ rekening: s.cashAccount.name, periode: "19–21 Sep", hwmAt: s.createdAt.toISOString(), saldoBukuSnapshot: moneyToNumber(isi.bookBalance), bukti: Number(p.buktiBuku), cocok, sudahAdaSnapshot: !!s.snapshot });
    if (!cocok) throw new Error(`Saldo buku ${s.cashAccount.name} pada high-water mark tidak sama dengan bukti — hentikan`);
    if (APPLY && !s.snapshot) {
      await prisma.$transaction((tx) => buatSnapshot(tx, {
        statementId: s.id, hwmAt: s.createdAt, confirmedAt: s.createdAt,
        confirmedSource: "Konfirmasi owner saldo riil 21 Sep 2026 20.00 WIB (dicatat sistem saat periode sementara dibuat)",
        explanation: "High-water mark = waktu periode sementara dicatat (21 Sep 2026 19.18 UTC), saat angka konfirmasi owner dimasukkan. Snapshot dibuat belakangan (B3) dari jurnal yang sudah ada pada waktu itu; tidak ada angka yang diubah.",
      }), { timeout: 120_000, maxWait: 30_000 });
    }
  }

  // 2) Periode 22 Sep: periode sementara (tanpa mutasi bank) + snapshot pada high-water mark efektif.
  for (const d of PERIODE_22) {
    const rek = await prisma.finCashAccount.findFirst({ where: { name: d.rekening } });
    if (!rek) throw new Error(`Rekening ${d.rekening} tidak ditemukan`);
    const isi = await hitungIsiSnapshot(prisma, { cashAccountId: rek.id, periodStart: new Date(`${d.periodStart}T00:00:00Z`), periodEnd: new Date(`${d.periodEnd}T00:00:00Z`), hwmAt: hwm22 });
    const isiLiteral = await hitungIsiSnapshot(prisma, { cashAccountId: rek.id, periodStart: new Date(`${d.periodStart}T00:00:00Z`), periodEnd: new Date(`${d.periodEnd}T00:00:00Z`), hwmAt: CUTOFF_22_LITERAL });
    const cocok = isi.bookBalance.equals(toMoney(d.buktiBuku));
    const ada = await prisma.finBankStatement.findUnique({ where: { sourceKey: d.sourceKey }, include: { snapshot: true } });
    out.periode.push({
      rekening: d.rekening, periode: "22 Sep", hwmEfektif: hwm22.toISOString(), hwmLiteral: CUTOFF_22_LITERAL.toISOString(),
      saldoBukuEfektif: moneyToNumber(isi.bookBalance), saldoBukuLiteral: moneyToNumber(isiLiteral.bookBalance), bukti: Number(d.buktiBuku),
      saldoRiil: Number(d.closingBalance), selisihSnapshot: moneyToNumber(toMoney(d.closingBalance).minus(isi.bookBalance)), cocok, sudahAda: !!ada, sudahAdaSnapshot: !!ada?.snapshot,
    });
    if (!cocok) throw new Error(`Saldo buku ${d.rekening} pada high-water mark efektif tidak sama dengan bukti — hentikan`);
    if (!APPLY) continue;
    await buatPeriodeSementara(prisma, { daftar: [{ ...d, cutoffStartAt: CUTOFF_22_AWAL, cutoffEndAt: CUTOFF_22_LITERAL }] });
    const s = await prisma.finBankStatement.findUnique({ where: { sourceKey: d.sourceKey } });
    await prisma.$transaction((tx) => buatSnapshot(tx, {
      statementId: s.id, hwmAt: hwm22, confirmedAt: CUTOFF_22_LITERAL,
      confirmedSource: "Konfirmasi owner saldo riil 22 Sep 2026 19.00 WIB (baseline privat finance-2026-09-22)",
      explanation: `Cutoff literal 22 Sep 2026 19.00 WIB (12.00 UTC). High-water mark efektif = ${HWM_22_NOMOR} dibuat ${hwm22.toISOString()} (21.33 WIB): saldo PT Sano hanya sama dengan saldo riil bila posting sampai jurnal itu ikut dihitung, jadi pengecekan riil owner efektif mencakupnya. Kedua waktu disimpan.`,
    }), { timeout: 120_000, maxWait: 30_000 });
  }
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => { console.error("GAGAL:", e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
