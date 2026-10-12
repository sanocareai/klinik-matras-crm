// DETEKSI POTENSI BIAYA ADMIN GANDA pada refund (Okt 2026) — hanya MEMBACA.
//
// Risiko: biaya admin bank refund sudah dicatat Finance lewat Pengeluaran ("Biaya admin bank") atau jurnal manual, lalu refund yang sama membukukan biayanya LAGI di jurnalnya
// (Dr Beban Administrasi Bank). Sistem TIDAK menebak mana yang benar dan TIDAK menghapus/menimpa transaksi apa pun: ia hanya menunjukkan kandidat supaya Admin memutuskan.
//
// Kandidat = jurnal berlaku (POSTED) dari sumber PENGELUARAN / MANUAL / PEMBELIAN dengan uang keluar dari REKENING YANG SAMA sebesar tepat biaya admin, pada tanggal berdekatan,
// yang menyentuh Beban Administrasi Bank ATAU keterangannya menyebut biaya admin/bank. Jurnal dari refund (versi lama/baru) tidak dihitung.
//   KUAT  = rekening + nominal sama dan (tanggal sama persis ATAU referensi transfer muncul di keterangan) -> perlu konfirmasi eksplisit Admin untuk melanjutkan.
//   LEMAH = rekening + nominal sama, tanggal berbeda <= 3 hari -> hanya peringatan.

import { toMoney, moneyToNumber } from "./money.js";
import { SYSTEM_KEYS } from "./accounts.js";

const SUMBER_KANDIDAT = ["PENGELUARAN", "MANUAL", "PEMBELIAN"];
const JENDELA_HARI = 3;
const POLA_ADMIN = /admin|biaya\s+bank|bank\s+fee|biaya\s+transfer/i;
const HARI_MS = 24 * 60 * 60 * 1000;
const hariKe = (d) => Math.round(new Date(d).getTime() / HARI_MS);
const tgl = (d) => new Date(d).toISOString().slice(0, 10);

/**
 * @param db            Prisma / tx
 * @param cashAccountId rekening sumber refund (baru)
 * @param tanggal       tanggal refund (Date/ISO)
 * @param biaya         biaya admin (Decimal/number) — 0 = tidak ada yang perlu dicek
 * @param referensi     nomor referensi transfer (opsional)
 * @returns {{ ada: boolean, kuat: boolean, temuan: object[] }}
 */
export async function deteksiBiayaAdminGanda(db, { cashAccountId, tanggal, biaya, referensi = null }) {
  const nominal = toMoney(biaya || 0);
  if (!nominal.greaterThan(0) || !cashAccountId || !tanggal) return { ada: false, kuat: false, temuan: [] };
  const pusat = new Date(tanggal);
  const dari = new Date(pusat.getTime() - JENDELA_HARI * HARI_MS);
  const sampai = new Date(pusat.getTime() + JENDELA_HARI * HARI_MS);
  const bebanAdmin = await db.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BEBAN_ADMIN_BANK }, select: { id: true } });

  const entries = await db.finJournalEntry.findMany({
    where: {
      status: "POSTED", source: { in: SUMBER_KANDIDAT }, date: { gte: dari, lte: sampai },
      lines: { some: { cashAccountId, credit: nominal } },
    },
    select: { id: true, entryNumber: true, date: true, description: true, source: true, sourceId: true, lines: { select: { accountId: true, debit: true, credit: true, cashAccountId: true } } },
    orderBy: [{ date: "asc" }, { entryNumber: "asc" }],
    take: 50,
  });

  const ref = String(referensi ?? "").trim().toLowerCase();
  const temuan = [];
  for (const e of entries) {
    // Uang keluar dari rekening yang sama TEPAT sebesar biaya admin, dan jurnal ini memang soal biaya admin/bank.
    const keluarSama = e.lines.some((l) => l.cashAccountId === cashAccountId && toMoney(l.credit).equals(nominal));
    const sentuhBebanAdmin = !!bebanAdmin && e.lines.some((l) => l.accountId === bebanAdmin.id && toMoney(l.debit).greaterThan(0));
    const ket = String(e.description ?? "");
    if (!keluarSama || !(sentuhBebanAdmin || POLA_ADMIN.test(ket))) continue;
    const selisihHari = Math.abs(hariKe(e.date) - hariKe(pusat));
    const referensiCocok = !!ref && ket.toLowerCase().includes(ref);
    const kuat = selisihHari === 0 || referensiCocok;
    temuan.push({
      jurnal: e.entryNumber, tanggal: tgl(e.date), sumber: e.source, keterangan: ket.slice(0, 160), nominal: moneyToNumber(nominal),
      selisihHari, referensiCocok, tingkat: kuat ? "KUAT" : "LEMAH",
      alasan: [
        "rekening sama", "nominal sama",
        selisihHari === 0 ? "tanggal sama" : `selisih ${selisihHari} hari`,
        ...(referensiCocok ? ["referensi transfer cocok"] : []),
      ].join(", "),
    });
  }
  return { ada: temuan.length > 0, kuat: temuan.some((t) => t.tingkat === "KUAT"), temuan };
}
