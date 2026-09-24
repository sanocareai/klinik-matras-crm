// REKONSILIASI BANK — periode SEMENTARA (tanpa rekening koran) + aturan penyelesaian periode + Penyesuaian Buku.
//
// TIDAK PERNAH membuat/mengubah jurnal, saldo, atau baris mutasi bank. Periode sementara hanya berisi angka yang DIKONFIRMASI owner (saldo awal/akhir bank);
// baris mutasi bank sengaja kosong sampai rekening koran asli dimasukkan (tidak ada mutasi fiktif).
//
// Aturan penyelesaian (satu tempat, dipakai endpoint /complete dan tampilan): periode hanya boleh SELESAI bila
//   1) statusnya DRAFT (bukan DRAF_MENUNGGU_MUTASI), 2) sudah ada baris mutasi bank asli, 3) tidak ada baris BELUM_COCOK (semua dicocokkan/dijelaskan),
//   4) selisih saldo bank vs saldo buku = 0.

import { toMoney, moneyToNumber, formatRupiah } from "./money.js";
import { STATUS_DIHITUNG } from "./journal.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../../lib/activityLog.js";
import { saldoBukuRekening } from "./rekonSnapshot.js";

export const STATUS_DRAF_MENUNGGU = "DRAF_MENUNGGU_MUTASI";
export const LABEL_STATUS_REKON = { DRAFT: "Sedang dicocokkan", SELESAI: "Selesai", DRAF_MENUNGGU_MUTASI: "Draf — menunggu mutasi bank" };
export const LABEL_REKON_SEMENTARA = "Rekonsiliasi sementara tanpa rekening koran. Saldo akhir telah dikonfirmasi owner, tetapi mutasi individual belum seluruhnya diverifikasi.";

const CUTOFF_AWAL = new Date("2026-09-19T13:00:00.000Z"); // 19 Sep 2026 20.00 WIB
const CUTOFF_AKHIR = new Date("2026-09-21T13:00:00.000Z"); // 21 Sep 2026 20.00 WIB
const CATATAN_CUTOFF = "Cutoff: 19 Sep 2026 pukul 20.00 WIB sampai 21 Sep 2026 pukul 20.00 WIB.";

/** Dua periode produksi (konfirmasi owner). Nama rekening harus persis sama dengan di Kas & Bank. */
export const PERIODE_SEMENTARA_20260919 = Object.freeze([
  {
    sourceKey: "REKON_SEMENTARA_20260919_20260921:PT_SANO", rekening: "PT Sano", periodStart: "2026-09-19", periodEnd: "2026-09-21",
    openingBalance: "36870615", closingBalance: "39180615",
    note: `${CATATAN_CUTOFF} Saldo akhir cocok dengan saldo buku (selisih Rp0); mutasi individual belum diverifikasi. Menunggu rekening koran untuk mencocokkan mutasi satu per satu.`,
  },
  {
    sourceKey: "REKON_SEMENTARA_20260919_20260921:KEM_SANO", rekening: "KEM - Sano Bank", periodStart: "2026-09-19", periodEnd: "2026-09-21",
    openingBalance: "766507", closingBalance: "4912088",
    note: `${CATATAN_CUTOFF} Selisih terbuka Rp2.526.981 (saldo buku lebih tinggi dari saldo bank); tidak dikoreksi. Menunggu rekening koran.`,
  },
]);

/** Murni: apakah periode boleh diselesaikan? Mengembalikan syarat satu per satu (untuk UI) + alasan yang belum terpenuhi. */
export function evaluasiSelesai({ status, jumlahBaris, belumCocok, selisih, danaBelumTeridentifikasi, snapshotValid = true, exceptionTerbuka = 0 }) {
  const sel = toMoney(selisih ?? 0);
  const suspense = toMoney(danaBelumTeridentifikasi ?? 0);
  const syarat = [
    { kode: "STATUS", ok: status === "DRAFT", teks: status === "SELESAI" ? "Periode sudah selesai" : status === STATUS_DRAF_MENUNGGU ? "Periode masih draf — belum ada mutasi bank asli" : "Periode berstatus sedang dicocokkan" },
    { kode: "MUTASI_ASLI", ok: Number(jumlahBaris) > 0, teks: "Mutasi bank asli (rekening koran) sudah dimasukkan" },
    { kode: "SEMUA_DICOCOKKAN", ok: Number(jumlahBaris) > 0 && Number(belumCocok) === 0, teks: "Seluruh baris mutasi sudah dicocokkan atau dijelaskan" },
    { kode: "SELISIH_NOL", ok: sel.isZero(), teks: "Selisih saldo bank dan saldo buku nol" },
    // Suspense (2-1700) menutup selisih ANGKA-nya, tapi SUMBER dananya belum
    // terbukti — periode TIDAK BOLEH "Selesai" selama saldo ini masih ada,
    // supaya tidak pernah tersamar seolah rekonsiliasi benar-benar tuntas.
    { kode: "DANA_TERIDENTIFIKASI", ok: suspense.isZero(), teks: "Tidak ada dana masuk yang masih menunggu identifikasi sumber" },
    // B3: exception dokumen/jurnal yang belum ditinjau dan snapshot yang tidak berlaku juga menahan penyelesaian.
    { kode: "TANPA_EXCEPTION", ok: Number(exceptionTerbuka) === 0, teks: "Tidak ada exception dokumen/jurnal yang Perlu Ditinjau" },
    { kode: "SNAPSHOT_BERLAKU", ok: !!snapshotValid, teks: "Snapshot periode masih berlaku" },
  ];
  const alasan = syarat.filter((s) => !s.ok).map((s) => {
    if (s.kode === "STATUS") return s.teks;
    if (s.kode === "MUTASI_ASLI") return "Belum ada mutasi bank asli — impor rekening koran dulu";
    if (s.kode === "SEMUA_DICOCOKKAN") return `Masih ada ${belumCocok} baris mutasi yang belum dicocokkan atau dijelaskan`;
    if (s.kode === "TANPA_EXCEPTION") return `Masih ada ${exceptionTerbuka} exception dokumen/jurnal Perlu Ditinjau untuk rekening ini`;
    if (s.kode === "SNAPSHOT_BERLAKU") return "Snapshot periode tidak berlaku lagi — jurnal yang sudah termasuk snapshot berubah atau snapshot dinyatakan tidak berlaku";
    if (s.kode === "DANA_TERIDENTIFIKASI") return `${formatRupiah(suspense)} masih menunggu identifikasi sumber (lihat Dana Masuk Belum Teridentifikasi) — reklasifikasi dulu setelah sumbernya terbukti`;
    return `Selisih saldo bank dan buku belum nol (${sel.toFixed(2)})`;
  });
  return { bisa: alasan.length === 0, syarat, alasan };
}

/**
 * Saldo buku rekening sampai tanggal buku `sampai` (jurnal yang dihitung). Baca-saja.
 * B3 (25 Sep 2026): hanya baris di AKUN buku rekening itu (definisi Kas & Bank). Dulu semua baris bertanda cash_account_id ikut
 * dihitung, termasuk baris beban biaya admin transfer yang ikut ditandai rekening, sehingga saldo rekon meleset sebesar biaya admin.
 */
export async function saldoBukuSampai(db, cashAccountId, sampai) {
  return saldoBukuRekening(db, cashAccountId, sampai);
}

/**
 * Penyesuaian Buku: jurnal bersumber SALDO_AWAL (kalibrasi saldo riil & koreksi kas ganda) pada rekening & periode ini. BUKAN transaksi bank —
 * tidak boleh dipasangkan dengan mutasi koran dan tidak masuk daftar kandidat pencocokan.
 */
export async function penyesuaianBukuPeriode(db, { cashAccountId, periodStart, periodEnd }) {
  const ls = await db.finJournalLine.findMany({
    where: { cashAccountId, entry: { source: "SALDO_AWAL", status: { in: STATUS_DIHITUNG }, date: { gte: periodStart, lte: periodEnd } } },
    orderBy: [{ entry: { entryNumber: "asc" } }],
    select: { debit: true, credit: true, entry: { select: { id: true, entryNumber: true, date: true, description: true, idempotencyKey: true, status: true } } },
  });
  const rows = ls.map((l) => {
    const kunci = l.entry.idempotencyKey ?? "";
    const jenis = kunci.startsWith("KOREKSI_KAS_GANDA:") ? "KOREKSI_KAS_GANDA" : "KALIBRASI_SALDO";
    return {
      jurnalId: l.entry.id, nomor: l.entry.entryNumber, tanggal: new Date(l.entry.date).toISOString().slice(0, 10), keterangan: l.entry.description, status: l.entry.status,
      jenis, jenisLabel: jenis === "KOREKSI_KAS_GANDA" ? "Koreksi kas ganda" : "Kalibrasi saldo riil", nilai: moneyToNumber(toMoney(l.debit).minus(toMoney(l.credit))),
    };
  });
  const koreksi = rows.filter((r) => r.jenis === "KOREKSI_KAS_GANDA");
  return {
    items: rows,
    ringkasan: {
      jumlah: rows.length, bersih: moneyToNumber(rows.reduce((t, r) => t.plus(toMoney(r.nilai)), toMoney(0))),
      koreksiKasGanda: { jumlah: koreksi.length, bersih: moneyToNumber(koreksi.reduce((t, r) => t.plus(toMoney(r.nilai)), toMoney(0))), dari: koreksi[0]?.nomor ?? null, sampai: koreksi.at(-1)?.nomor ?? null },
    },
    catatan: "Penyesuaian Buku bukan transaksi bank: kalibrasi ke saldo riil dan koreksi kas ganda (lawan Koreksi Saldo Awal). Tidak dicocokkan dengan mutasi koran.",
  };
}

/**
 * Saldo akun "Dana Masuk Belum Teridentifikasi" (2-1700, suspense — lihat
 * posting/rekonsiliasiSementara.js), OPSIONAL disaring per rekening kas.
 * Dipakai Ringkasan (GET /finance/saldo-riil) dan detail Rekonsiliasi Bank
 * supaya penyesuaian sementara SELALU tampil jelas, tidak pernah tersamar
 * sebagai "periode selesai" atau pendapatan. Baca-saja.
 */
export async function saldoBelumTeridentifikasi(db, { cashAccountId } = {}) {
  const lines = await db.finJournalLine.findMany({
    where: {
      ...(cashAccountId ? { cashAccountId } : { cashAccountId: { not: null } }),
      entry: { source: "REKONSILIASI_SEMENTARA", status: { in: STATUS_DIHITUNG } },
    },
    orderBy: { entry: { date: "asc" } },
    select: {
      debit: true, credit: true,
      entry: { select: { id: true, entryNumber: true, date: true, description: true } },
      cashAccount: { select: { id: true, name: true } },
    },
  });
  const items = lines.map((l) => ({
    jurnalId: l.entry.id, nomor: l.entry.entryNumber, tanggal: l.entry.date, keterangan: l.entry.description,
    rekening: l.cashAccount?.name ?? null,
    nilai: moneyToNumber(toMoney(l.debit).minus(toMoney(l.credit))),
  }));
  const total = items.reduce((t, r) => t.plus(toMoney(r.nilai)), toMoney(0));
  return {
    total: moneyToNumber(total),
    items,
    peringatan: total.isZero() ? null : `${formatRupiah(total)} masih menunggu identifikasi`,
  };
}

/**
 * Buat periode sementara (IDEMPOTEN): kunci sumber unik + pemeriksaan (rekening, periode). Menjalankan ulang TIDAK membuat periode kedua.
 * TIDAK membuat baris mutasi, jurnal, atau mengubah saldo.
 */
export async function buatPeriodeSementara(db, { daftar = PERIODE_SEMENTARA_20260919, userId = null } = {}) {
  return db.$transaction(async (tx) => {
    await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))::text AS k", "REKON_SEMENTARA_PERIODE");
    const hasil = [];
    for (const d of daftar) {
      const rek = await tx.finCashAccount.findFirst({ where: { name: d.rekening }, select: { id: true, name: true } });
      if (!rek) throw new Error(`Rekening "${d.rekening}" tidak ditemukan di Kas & Bank`);
      const ada = await tx.finBankStatement.findUnique({ where: { sourceKey: d.sourceKey }, select: { id: true, status: true } });
      if (ada) { hasil.push({ rekening: d.rekening, id: ada.id, dibuat: false, alasan: "sudah_ada" }); continue; }
      const kembar = await tx.finBankStatement.findFirst({ where: { cashAccountId: rek.id, periodStart: new Date(`${d.periodStart}T00:00:00.000Z`), periodEnd: new Date(`${d.periodEnd}T00:00:00.000Z`) }, select: { id: true, status: true } });
      if (kembar) { hasil.push({ rekening: d.rekening, id: kembar.id, dibuat: false, alasan: "periode_sama_sudah_ada" }); continue; }
      const s = await tx.finBankStatement.create({
        data: {
          cashAccountId: rek.id, periodStart: new Date(`${d.periodStart}T00:00:00.000Z`), periodEnd: new Date(`${d.periodEnd}T00:00:00.000Z`),
          openingBalance: toMoney(d.openingBalance), closingBalance: toMoney(d.closingBalance), status: STATUS_DRAF_MENUNGGU, note: d.note,
          cutoffStartAt: d.cutoffStartAt ?? CUTOFF_AWAL, cutoffEndAt: d.cutoffEndAt ?? CUTOFF_AKHIR, sourceKey: d.sourceKey, createdById: userId,
        },
      });
      await recordActivity(tx, { entityType: ENTITY_TYPES.FIN_BANK_STATEMENT, entityId: s.id, eventType: EVENT_TYPES.DOCUMENT_EDITED, actorId: userId, metadata: { label: "Periode rekonsiliasi sementara dibuat (tanpa mutasi bank)", aksi: "periode_sementara", rekening: d.rekening, sourceKey: d.sourceKey } });
      hasil.push({ rekening: d.rekening, id: s.id, dibuat: true });
    }
    return hasil;
  }, { timeout: 60_000, maxWait: 20_000 });
}
