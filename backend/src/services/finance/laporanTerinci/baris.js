// LAPORAN KEUANGAN TERINCI — BARIS JURNAL LABA RUGI (read-model dasar, BACA-SAJA).
//
// Satu daftar baris jurnal yang menjadi SUMBER SEMUA drilldown kartu Laba Rugi (Pendapatan, HPP, Laba Kotor, Beban Operasional, Laba Bersih), jembatan pendapatan,
// beban per divisi, dan Export Excel. Filter SAMA PERSIS dengan labaRugi() di reports.js (status POSTED/REVERSED, tanggal buku inklusif, akun postable bertipe
// PENDAPATAN/BEBAN_POKOK/BEBAN) — angka kartu tidak dihitung ulang di sini; baris ini dipakai untuk MENELUSURI dan hasilnya wajib sama dengan kartu (lihat kontrol di index.js).
//
// Tanda (efek) tiap baris terhadap metrik:
//   nilai   = menurut saldo normal akunnya (kontra pendapatan 4-2100 bersaldo normal DEBIT → nilai positif = retur).
//   efek    = pengaruh ke LABA BERSIH: pendapatan saldo-normal-KREDIT +nilai; retur −nilai; beban pokok/operasional −nilai.
// Atribusi divisi memakai KODE ASLI Laporan Divisi (laporanDivisi/atribusi.js) — tidak ada aturan kedua.

import { STATUS_DIHITUNG } from "../journal.js";
import { toMoney, sumMoney, moneyToNumber, ZERO } from "../money.js";
import { atribusiEntri } from "../laporanDivisi/atribusi.js";
import { AKUN_SENSITIF, LABEL_DIVISI, DI_LUAR_DIVISI, TIDAK_TERKLASIFIKASI } from "../laporanDivisi/divisi.js";

export const TIPE_LR = Object.freeze(["PENDAPATAN", "BEBAN_POKOK", "BEBAN"]);
export const MAKS_BARIS_DRILLDOWN = 8000;
export const METRIK_DRILLDOWN = Object.freeze(["pendapatan", "hpp", "laba_kotor", "beban_operasional", "laba_bersih"]);
export const LABEL_METRIK = Object.freeze({
  pendapatan: "Pendapatan Bersih", hpp: "Beban Pokok (HPP)", laba_kotor: "Laba Kotor", beban_operasional: "Beban Operasional", laba_bersih: "Laba Bersih",
});
export const LABEL_DI_LUAR_DIVISI = "Di luar divisi (pendapatan/retur)";

const tgl = (d) => new Date(d).toISOString().slice(0, 10);
export const labelDivisi = (scope) => (scope === DI_LUAR_DIVISI ? LABEL_DI_LUAR_DIVISI : LABEL_DIVISI[scope] ?? scope);

/** Nilai satu baris (saldo normal) dan efeknya ke laba bersih — Decimal. */
export function hitungNilaiEfek(tipe, normal, debit, credit) {
  const d = toMoney(debit || 0); const c = toMoney(credit || 0);
  const nilai = normal === "DEBIT" ? d.minus(c) : c.minus(d);
  const efek = tipe === "PENDAPATAN" ? (normal === "DEBIT" ? nilai.negated() : nilai) : nilai.negated();
  return { nilai, efek };
}

/** Kontribusi baris ke satu metrik kartu (null = baris tidak termasuk metrik itu). */
export function kontribusiMetrik(r, metrik) {
  switch (metrik) {
    case "pendapatan": return r.akunTipe === "PENDAPATAN" ? r.efek : null;
    case "hpp": return r.akunTipe === "BEBAN_POKOK" ? r.nilai : null;
    case "laba_kotor": return r.akunTipe === "PENDAPATAN" || r.akunTipe === "BEBAN_POKOK" ? r.efek : null;
    case "beban_operasional": return r.akunTipe === "BEBAN" ? r.nilai : null;
    case "laba_bersih": return r.efek;
    default: return null;
  }
}

/** Bagi nominal sesuai bobot atribusi (pembayaran supplier yang dialokasikan ke beberapa tagihan); sisa pembulatan ke bagian terakhir supaya jumlah tetap persis. */
function pecah(nilaiDec, bagian) {
  const hasil = []; let sisa = nilaiDec;
  bagian.forEach((b, i) => {
    const v = i === bagian.length - 1 ? sisa : nilaiDec.times(b.bobot).toDecimalPlaces(2, 4);
    sisa = sisa.minus(v); hasil.push(v);
  });
  return hasil;
}

/**
 * Muat seluruh baris jurnal Laba Rugi periode [from, to] (Date tanggal-buku UTC tengah malam, inklusif).
 * @returns {Promise<Array>} baris terurut tanggal, nomor jurnal, nomor baris.
 */
export async function muatBarisLabaRugi(tx, { from, to, bolehSensitif = false }) {
  const lines = await tx.finJournalLine.findMany({
    where: { entry: { status: { in: STATUS_DIHITUNG }, date: { gte: from, lte: to } }, account: { type: { in: TIPE_LR }, isPostable: true } },
    select: {
      lineNo: true, debit: true, credit: true, description: true, orderId: true, unitId: true,
      account: { select: { code: true, name: true, type: true, normalBalance: true } },
      order: { select: { orderNumber: true } },
      entry: { select: { id: true, entryNumber: true, date: true, description: true, source: true, sourceId: true, status: true, reversalOfId: true, reversalOf: { select: { entryNumber: true, date: true, source: true } } } },
    },
    orderBy: [{ entry: { date: "asc" } }, { entry: { entryNumber: "asc" } }, { lineNo: "asc" }],
  });

  const entries = [...new Map(lines.map((l) => [l.entry.id, l.entry])).values()];
  const idEntri = entries.map((e) => e.id);
  const [atribusi, sens, pkr] = await Promise.all([
    atribusiEntri(tx, entries.map((e) => ({ id: e.id, source: e.source, sourceId: e.sourceId, reversalOfId: e.reversalOfId }))),
    idEntri.length ? tx.finJournalLine.findMany({ where: { entryId: { in: idEntri }, account: { code: { in: [...AKUN_SENSITIF] } } }, select: { entryId: true } }) : [],
    (async () => {
      const ids = [...new Set(entries.filter((e) => e.source === "PENJUALAN_KARYAWAN" && e.sourceId).map((e) => e.sourceId))];
      return ids.length ? tx.finPenjualanKaryawan.findMany({ where: { id: { in: ids } }, select: { id: true, nomor: true } }) : [];
    })(),
  ]);
  const idSensitif = new Set(sens.map((s) => s.entryId));
  const nomorPkr = new Map(pkr.map((p) => [p.id, p.nomor]));

  const baris = [];
  for (const l of lines) {
    const e = l.entry; const a = l.account;
    const { nilai, efek } = hitungNilaiEfek(a.type, a.normalBalance, l.debit, l.credit);
    const at = atribusi.get(e.id);
    const sensitif = idSensitif.has(e.id) || !!at?.sensitif;
    const bagian = at?.bagian?.length ? at.bagian : [{ scope: TIDAK_TERKLASIFIKASI, bobot: 1 }];
    const nilaiBagian = bagian.length > 1 ? pecah(nilai, bagian) : [nilai];
    const efekBagian = bagian.length > 1 ? pecah(efek, bagian) : [efek];
    const debitBagian = bagian.length > 1 ? pecah(toMoney(l.debit || 0), bagian) : [toMoney(l.debit || 0)];
    const kreditBagian = bagian.length > 1 ? pecah(toMoney(l.credit || 0), bagian) : [toMoney(l.credit || 0)];
    const dokumen = at?.dokumen?.nomor
      ? { modul: at.dokumen.modul, nomor: at.dokumen.nomor }
      : l.order?.orderNumber ? { modul: "order", nomor: l.order.orderNumber }
        : e.source === "PENJUALAN_KARYAWAN" && nomorPkr.get(e.sourceId) ? { modul: "penjualan-karyawan", nomor: nomorPkr.get(e.sourceId) } : null;
    bagian.forEach((b, i) => {
      baris.push({
        id: `${e.id}:${l.lineNo}${bagian.length > 1 ? `#${i}` : ""}`,
        entryId: e.id, nomorJurnal: e.entryNumber, tanggal: tgl(e.date), sumber: e.source, status: e.status,
        akunKode: a.code, akunNama: a.name, akunTipe: a.type, normal: a.normalBalance,
        debit: moneyToNumber(debitBagian[i]), credit: moneyToNumber(kreditBagian[i]),
        nilai: moneyToNumber(nilaiBagian[i]), efek: moneyToNumber(efekBagian[i]),
        orderId: l.orderId ?? null, orderNomor: l.order?.orderNumber ?? null, unitId: l.unitId ?? null,
        dokumen, sourceId: e.sourceId ?? null,
        deskripsi: sensitif && !bolehSensitif ? "(rincian sensitif — hanya Finance Admin)" : (e.description || l.description || "").slice(0, 220),
        membalik: e.reversalOf ? { nomor: e.reversalOf.entryNumber, tanggal: tgl(e.reversalOf.date), sumber: e.reversalOf.source } : null,
        divisi: b.scope, divisiLabel: labelDivisi(b.scope), tahap: at?.tahap ?? "TIDAK_TERKLASIFIKASI", aturan: at?.aturan ?? "", konflik: at?.konflik ?? [], bobot: b.bobot,
        sensitif,
      });
    });
  }
  return baris;
}

/** Jumlahkan Decimal-exact (nilai baris sudah 2 desimal): hasil number. */
export function jumlah(baris, f) {
  return moneyToNumber(sumMoney(baris.map((r) => f(r) ?? ZERO)));
}

/** Total kartu dari baris (untuk dibandingkan dengan labaRugi().ringkasan). */
export function totalKartuDariBaris(baris) {
  const out = {};
  for (const m of METRIK_DRILLDOWN) out[m] = moneyToNumber(sumMoney(baris.map((r) => kontribusiMetrik(r, m) ?? 0)));
  return out;
}
