// BACA REKONSILIASI BANK — SATU sumber query untuk layar Rekonsiliasi (GET /bank-statements dan GET /bank-statements/:id di
// routes/financeTransactions.js) dan Export Excel (services/finance/export/rekonsiliasi.js), supaya angka di berkas Excel tidak
// mungkin berbeda dari yang tampil di layar. Murni baca: tidak ada tulis ke database.
//
// Bentuk hasil SAMA PERSIS dengan respons endpoint layar. Mode `ids` (export dari periode yang tampil setelah filter sisi-klien)
// memuat ulang periode itu lewat perhitungan yang sama, dengan URUTAN mengikuti `ids`.

import { STATUS_DIHITUNG } from "./journal.js";
import { toMoney, moneyToNumber } from "./money.js";
import { pandanganCutoff, daftarException } from "./rekonSnapshot.js";
import {
  evaluasiSelesai, penyesuaianBukuPeriode, saldoBukuSampai, saldoBelumTeridentifikasi,
  LABEL_STATUS_REKON, LABEL_REKON_SEMENTARA, STATUS_DRAF_MENUNGGU,
} from "./rekonBank.js";
import { idValid, urutkanSesuaiIds } from "./supplierRead.js";

/** Ringkasan cutoff dari snapshot TERSIMPAN — angka snapshot tidak dihitung ulang. */
async function ringkasCutoff(db, s) {
  if (!s.snapshot) return { adaSnapshot: false, cutoffAkhir: s.cutoffEndAt };
  const p = await pandanganCutoff(db, s.snapshot, { closingBank: s.closingBalance });
  const r = p.ringkasanSetelahSnapshot;
  return {
    adaSnapshot: true, cutoffAkhir: s.cutoffEndAt, snapshotAt: p.snapshot.snapshotAt, hwmAt: p.snapshot.hwmAt, hwmEntryNumber: p.snapshot.hwmEntryNumber,
    saldoBukuSnapshot: p.snapshot.saldoBuku, selisihSnapshot: p.snapshot.selisih, valid: p.valid,
    postingSetelahCutoff: r.POSTING_SETELAH_CUTOFF, reversalSetelahSnapshot: r.REVERSAL_SETELAH_SNAPSHOT, penyesuaianSetelahSnapshot: r.PENYESUAIAN_BUKU,
    saldoBukuSekarang: p.saldoBukuSekarang,
  };
}

/** Daftar periode rekonsiliasi (tabel utama layar). `ids` menggantikan filter: muat ulang periode itu berurutan. */
export async function ambilDaftarStatement(db, { cashAccountId } = {}, { take = 50, ids = null } = {}) {
  const include = {
    cashAccount: { select: { id: true, name: true, kind: true } },
    createdBy: { select: { id: true, name: true } },
    completedBy: { select: { id: true, name: true } },
    lines: { select: { id: true, status: true, amount: true } },
    snapshot: true,
  };
  let statements;
  if (ids) {
    const rows = await db.finBankStatement.findMany({ where: { id: { in: idValid(ids) } }, include });
    statements = urutkanSesuaiIds(rows, idValid(ids));
  } else {
    statements = await db.finBankStatement.findMany({
      where: cashAccountId ? { cashAccountId } : {},
      orderBy: { periodStart: "desc" },
      take,
      include,
    });
  }
  const exc = await daftarException(db);
  const hasil = [];
  for (const s of statements) {
    const buku = await saldoBukuSampai(db, s.cashAccountId, s.periodEnd);
    const selisih = toMoney(s.closingBalance).minus(buku); // bank − buku
    hasil.push({
      ...s,
      openingBalance: moneyToNumber(s.openingBalance),
      closingBalance: moneyToNumber(s.closingBalance),
      statusLabel: LABEL_STATUS_REKON[s.status] ?? s.status,
      sementara: s.status === STATUS_DRAF_MENUNGGU,
      saldoBuku: moneyToNumber(buku),
      selisih: moneyToNumber(selisih),
      bukuLebihTinggi: moneyToNumber(buku.minus(toMoney(s.closingBalance))),
      jumlahBaris: s.lines.length,
      belumCocok: s.lines.filter((l) => l.status === "BELUM_COCOK").length,
      lines: undefined,
      snapshot: undefined,
      // B3 (aditif): ringkasan cutoff dari snapshot TERSIMPAN — angka snapshot tidak dihitung ulang.
      cutoffInfo: await ringkasCutoff(db, s),
      perluDitinjau: exc.items.filter((x) => !x.ditinjau && x.rekeningIds.includes(s.cashAccountId)).length,
    });
  }
  return hasil;
}

/** Detail satu periode: baris koran bank + kandidat pencocokan + selisih saldo. null bila periode tidak ada. */
export async function ambilDetailStatement(db, id) {
  const s = await db.finBankStatement.findUnique({
    where: { id },
    include: {
      cashAccount: { select: { id: true, name: true, kind: true, accountId: true } },
      lines: {
        orderBy: { date: "asc" },
        include: {
          matchedLine: {
            select: {
              id: true, debit: true, credit: true, description: true,
              entry: { select: { id: true, entryNumber: true, date: true, description: true } },
            },
          },
          matchedBy: { select: { id: true, name: true } },
        },
      },
    },
  });
  if (!s) return null;

  // Baris jurnal rekening ini di periode yang sama — kandidat pencocokan.
  const kandidat = await db.finJournalLine.findMany({
    where: {
      cashAccountId: s.cashAccountId,
      // Penyesuaian buku (kalibrasi saldo riil & koreksi kas ganda, sumber
      // SALDO_AWAL) dan penyesuaian sementara rekonsiliasi (sumber
      // REKONSILIASI_SEMENTARA, akun 2-1700) BUKAN transaksi bank → tidak
      // pernah jadi kandidat pencocokan mutasi koran.
      entry: { status: { in: STATUS_DIHITUNG }, date: { gte: s.periodStart, lte: s.periodEnd }, source: { notIn: ["SALDO_AWAL", "REKONSILIASI_SEMENTARA"] } },
    },
    orderBy: [{ entry: { date: "asc" } }],
    select: {
      id: true, debit: true, credit: true, description: true,
      entry: { select: { id: true, entryNumber: true, date: true, description: true, source: true } },
      bankStatementLines: { select: { id: true } },
    },
  });
  const penyesuaianBuku = await penyesuaianBukuPeriode(db, { cashAccountId: s.cashAccountId, periodStart: s.periodStart, periodEnd: s.periodEnd });
  const danaBelumTeridentifikasi = await saldoBelumTeridentifikasi(db, { cashAccountId: s.cashAccountId });

  // Saldo menurut BUKU pada akhir periode (seluruh mutasi rekening ini
  // sampai periodEnd) vs saldo menurut KORAN BANK.
  const saldoBuku = await saldoBukuSampai(db, s.cashAccountId, s.periodEnd);
  const snap = await db.finReconSnapshot.findUnique({ where: { statementId: s.id } });
  const cutoff = snap ? await pandanganCutoff(db, snap, { closingBank: s.closingBalance }) : null;
  const perluDitinjau = await daftarException(db, { cashAccountId: s.cashAccountId });
  const selisih = toMoney(s.closingBalance).minus(saldoBuku);

  return {
    statement: {
      ...s,
      openingBalance: moneyToNumber(s.openingBalance),
      closingBalance: moneyToNumber(s.closingBalance),
      lines: s.lines.map((l) => ({
        ...l,
        amount: moneyToNumber(l.amount),
        matchedLine: l.matchedLine && {
          ...l.matchedLine,
          debit: moneyToNumber(l.matchedLine.debit),
          credit: moneyToNumber(l.matchedLine.credit),
        },
      })),
    },
    kandidat: kandidat
      .filter((k) => k.bankStatementLines.length === 0)
      .map((k) => ({
        id: k.id,
        nilai: moneyToNumber(toMoney(k.debit).minus(toMoney(k.credit))),
        description: k.description || k.entry.description,
        entryNumber: k.entry.entryNumber,
        tanggal: k.entry.date,
        source: k.entry.source,
      })),
    rekonsiliasi: {
      saldoBuku: moneyToNumber(saldoBuku),
      saldoKoran: moneyToNumber(s.closingBalance),
      selisih: moneyToNumber(selisih),
      bukuLebihTinggi: moneyToNumber(saldoBuku.minus(toMoney(s.closingBalance))),
      cocok: selisih.isZero(),
      belumCocok: s.lines.filter((l) => l.status === "BELUM_COCOK").length,
      sementara: s.status === STATUS_DRAF_MENUNGGU,
      statusLabel: LABEL_STATUS_REKON[s.status] ?? s.status,
      labelSementara: s.status === STATUS_DRAF_MENUNGGU ? LABEL_REKON_SEMENTARA : null,
      cutoff: { mulai: s.cutoffStartAt, selesai: s.cutoffEndAt },
      penyelesaian: evaluasiSelesai({
        status: s.status, jumlahBaris: s.lines.length, belumCocok: s.lines.filter((l) => l.status === "BELUM_COCOK").length,
        selisih, danaBelumTeridentifikasi: danaBelumTeridentifikasi.total,
        snapshotValid: cutoff ? cutoff.valid : true, exceptionTerbuka: perluDitinjau.terbuka,
      }),
    },
    cutoff,
    perluDitinjau,
    penyesuaianBuku,
    danaBelumTeridentifikasi,
  };
}
