// HPP & PENANDA MUTU MARGIN (BACA-SAJA).
//
// Margin kotor hanya boleh dibaca "final" bila konsumsi bahan periode itu BERNILAI. Modul ini memisahkan EMPAT hal yang tidak boleh dicampur:
//   1. TERBUKUKAN          — beban pokok yang benar-benar ada di jurnal (ikut laba): pembelian bahan manual, pemakaian bahan, upah, overhead, susut, selisih.
//   2. TIDAK TERBUKTI      — biaya yang kemungkinan ada tetapi TIDAK bisa dibuktikan: unit terkirim tanpa catatan pemakaian, pemakaian tanpa harga. Nominal = null (bukan Rp0).
//   3. ESTIMASI INFORMATIF — pembanding dari harga referensi (snapshot Excel) × qty pemakaian. TIDAK PERNAH masuk laba, margin, atau jurnal (dimasukkanKeLaba=false).
//   4. PERSEDIAAN          — penerimaan bahan bernilai (aset, bukan HPP) dan pembalik lintas-periode yang mengubah beban pokok periode ini.
//
// Status margin:
//   TIDAK_BERLAKU    belum ada unit diserahkan & belum ada pendapatan pada periode (tidak ada margin yang perlu dinilai).
//   BELUM_LENGKAP    ada unit diserahkan tetapi konsumsi bahan periode belum bernilai (nol pemakaian terbukukan) ATAU tidak semua unit terkirim punya pemakaian bernilai.
//   LENGKAP          setiap unit terkirim punya pemakaian bahan bernilai dan ada pemakaian terbukukan.
// Selama BELUM_LENGKAP layar menampilkan "HPP bahan belum lengkap — margin belum final". Rumus margin & angka laba TIDAK berubah.

import { sumMoney, moneyToNumber, toMoney, Decimal } from "../money.js";
import { startOfDayWIB, endOfDayExclusiveWIB } from "../../../utils/wib.js";

export const STATUS_MARGIN = Object.freeze({ TIDAK_BERLAKU: "TIDAK_BERLAKU", BELUM_LENGKAP: "BELUM_LENGKAP", LENGKAP: "LENGKAP" });
export const PESAN_MARGIN = Object.freeze({
  BELUM_LENGKAP: "HPP bahan belum lengkap — margin belum final",
  LENGKAP: "HPP bahan tercatat untuk seluruh unit terkirim",
  TIDAK_BERLAKU: "Tidak ada unit terkirim pada periode ini",
});
const LABEL_AKUN_HPP = Object.freeze({
  "5-1100": "Pemakaian bahan baku (perpetual)", "5-1150": "Pembelian bahan baku — input manual (dibebankan saat beli)", "5-1200": "Upah produksi", "5-1300": "Overhead produksi",
  "5-1900": "Susut & bahan rusak", "5-1950": "Selisih harga pembelian", "5-1960": "Selisih stok opname",
});
const BULAN_ENAM = 6;

const rp = (d) => moneyToNumber(d);

export async function hitungHpp(tx, { fromStr, toStr, baris }) {
  const mulai = startOfDayWIB(fromStr); const selesai = endOfDayExclusiveWIB(toStr);
  const hppRows = baris.filter((r) => r.akunTipe === "BEBAN_POKOK");

  // 1. TERBUKUKAN
  const perAkun = new Map();
  for (const r of hppRows) { const a = perAkun.get(r.akunKode) ?? { kode: r.akunKode, nama: r.akunNama, label: LABEL_AKUN_HPP[r.akunKode] ?? r.akunNama, nilai: toMoney(0), nBaris: 0 }; a.nilai = a.nilai.plus(r.nilai); a.nBaris++; perAkun.set(r.akunKode, a); }
  const terbukukanAkun = [...perAkun.values()].map((a) => ({ ...a, nilai: rp(a.nilai) })).sort((x, y) => x.kode.localeCompare(y.kode));
  const terbukukanTotal = rp(sumMoney(hppRows.map((r) => r.nilai)));
  const pemakaianRows = hppRows.filter((r) => r.sumber === "PEMAKAIAN_BAHAN");
  const pemakaianTerbukukan = rp(sumMoney(pemakaianRows.map((r) => r.nilai)));
  const bahanManual = rp(sumMoney(hppRows.filter((r) => r.akunKode === "5-1150").map((r) => r.nilai)));
  // Pembalik yang mengubah beban pokok periode ini padahal jurnal aslinya di periode lain (artefak waktu).
  const lintas = hppRows.filter((r) => r.membalik && r.membalik.tanggal < fromStr);
  const pembalikLintasPeriode = {
    nilai: rp(sumMoney(lintas.map((r) => r.nilai))), jumlahBaris: lintas.length,
    baris: lintas.map((r) => ({ nomorJurnal: r.nomorJurnal, tanggal: r.tanggal, akun: r.akunKode, nilai: r.nilai, membalik: r.membalik, deskripsi: r.deskripsi })),
    pengaruh: lintas.length ? "Pembalik jurnal periode sebelumnya ikut mengurangi beban pokok periode ini; margin kotor tampak lebih tinggi dari pemakaian bahan sebenarnya." : "",
  };

  // 2. KONSUMSI BAHAN & UNIT TERKIRIM
  const [issue, jobsSelesai] = await Promise.all([
    tx.stockMovement.findMany({ where: { type: "ISSUE", createdAt: { gte: mulai, lt: selesai } }, select: { id: true, qty: true, unitId: true, materialId: true, material: { select: { code: true, name: true, referenceUnitCost: true } } } }),
    tx.job.findMany({ where: { type: "DELIVERY", status: "COMPLETED", completedAt: { gte: mulai, lt: selesai } }, select: { id: true, orderId: true, units: { select: { unitId: true } }, order: { select: { penjualanKaryawanId: true } } } }),
  ]);
  const unitTerkirim = new Set(); let jobTanpaUnit = 0;
  for (const j of jobsSelesai) { if (j.units.length === 0) jobTanpaUnit += 1; else j.units.forEach((u) => unitTerkirim.add(u.unitId)); }
  const nUnitTerkirim = unitTerkirim.size + jobTanpaUnit;
  const idUnit = [...unitTerkirim];
  const valuasi = idIssue(issue).length ? await tx.finStockMovementValuation.findMany({ where: { movementId: { in: idIssue(issue) } }, select: { movementId: true, status: true, value: true } }) : [];
  const vMap = new Map(valuasi.map((v) => [v.movementId, v]));
  const issueTanpaHarga = issue.filter((m) => !vMap.has(m.id) || vMap.get(m.id).status !== "DINILAI");
  // Unit terkirim yang punya pemakaian bernilai (kapan pun — bahan bisa dipakai sebelum diserahkan).
  const unitBernilai = idUnit.length ? await tx.finStockMovementValuation.findMany({ where: { unitId: { in: idUnit }, movementType: "ISSUE", status: "DINILAI" }, select: { unitId: true }, distinct: ["unitId"] }) : [];
  const unitCatatan = idUnit.length ? await tx.stockMovement.findMany({ where: { unitId: { in: idUnit }, type: "ISSUE" }, select: { unitId: true }, distinct: ["unitId"] }) : [];
  const nBernilai = unitBernilai.length;
  const nAdaCatatan = unitCatatan.length;
  const unitTanpaCatatan = Math.max(0, nUnitTerkirim - nAdaCatatan);
  const unitCatatanTanpaHarga = Math.max(0, nAdaCatatan - nBernilai);

  const alasan = [];
  let status;
  if (nUnitTerkirim === 0) status = STATUS_MARGIN.TIDAK_BERLAKU;
  else {
    if (pemakaianTerbukukan <= 0) alasan.push("Tidak ada pemakaian bahan yang dibukukan sebagai HPP pada periode ini.");
    if (issue.length === 0) alasan.push("Tidak ada catatan pemakaian bahan (ISSUE) dari Gudang pada periode ini.");
    if (issueTanpaHarga.length) alasan.push(`${issueTanpaHarga.length} catatan pemakaian periode ini tanpa harga perolehan (tidak dinilai).`);
    if (unitTanpaCatatan > 0) alasan.push(`${unitTanpaCatatan} dari ${nUnitTerkirim} unit terkirim belum punya catatan pemakaian bahan.`);
    if (unitCatatanTanpaHarga > 0) alasan.push(`${unitCatatanTanpaHarga} unit terkirim punya catatan pemakaian tanpa harga.`);
    status = pemakaianTerbukukan > 0 && nBernilai >= nUnitTerkirim && issueTanpaHarga.length === 0 ? STATUS_MARGIN.LENGKAP : STATUS_MARGIN.BELUM_LENGKAP;
  }

  // 3. ESTIMASI INFORMATIF — tidak pernah masuk laba/jurnal
  const estimasiPeriode = (() => {
    const dengan = issue.filter((m) => m.material?.referenceUnitCost != null);
    if (!dengan.length) return null;
    return rp(sumMoney(dengan.map((m) => new Decimal(String(m.qty)).abs().times(new Decimal(String(m.material.referenceUnitCost))).toDecimalPlaces(2))));
  })();
  const awalHistoris = new Date(startOfDayWIB(fromStr).getTime() - BULAN_ENAM * 31 * 86_400_000);
  const historis = await tx.stockMovement.findMany({ where: { type: "ISSUE", createdAt: { gte: awalHistoris, lt: selesai } }, select: { createdAt: true, qty: true, unitId: true, material: { select: { referenceUnitCost: true } } } });
  const perBulan = new Map();
  for (const m of historis) {
    const k = new Date(m.createdAt.getTime() + 7 * 3600e3).toISOString().slice(0, 7);
    const b = perBulan.get(k) ?? { bulan: k, nilai: new Decimal(0), unit: new Set(), nTanpaReferensi: 0, nCatatan: 0 };
    b.nCatatan += 1; if (m.unitId) b.unit.add(m.unitId);
    if (m.material?.referenceUnitCost != null) b.nilai = b.nilai.plus(new Decimal(String(m.qty)).abs().times(new Decimal(String(m.material.referenceUnitCost)))); else b.nTanpaReferensi += 1;
    perBulan.set(k, b);
  }
  const estimasiHistoris = [...perBulan.values()].sort((a, b) => a.bulan.localeCompare(b.bulan)).map((b) => ({
    bulan: b.bulan, estimasi: rp(b.nilai.toDecimalPlaces(2)), unit: b.unit.size, catatan: b.nCatatan, tanpaReferensi: b.nTanpaReferensi,
    perUnit: b.unit.size ? rp(b.nilai.dividedBy(b.unit.size).toDecimalPlaces(2)) : null,
  }));

  // 4. PERSEDIAAN bertambah (info, bukan HPP)
  const persediaan = await tx.finJournalLine.aggregate({
    where: { account: { systemKey: "PERSEDIAAN_BAHAN" }, entry: { source: "PENERIMAAN_BAHAN", status: { in: ["POSTED", "REVERSED"] }, date: { gte: new Date(`${fromStr}T00:00:00.000Z`), lte: new Date(`${toStr}T00:00:00.000Z`) } } },
    _sum: { debit: true, credit: true },
  });
  const persediaanBertambah = rp(toMoney(persediaan._sum.debit ?? 0).minus(toMoney(persediaan._sum.credit ?? 0)));

  return {
    status, pesan: PESAN_MARGIN[status], final: status === STATUS_MARGIN.LENGKAP, alasan,
    terbukukan: { total: terbukukanTotal, akun: terbukukanAkun, pemakaianBahanTerbukukan: pemakaianTerbukukan, pembelianBahanManual: bahanManual, catatan: "Pembelian bahan manual dibebankan saat dibeli; ini BUKAN HPP berbasis pemakaian." },
    pembalikLintasPeriode,
    konsumsiBahan: { unitTerkirim: nUnitTerkirim, unitDenganPemakaianBernilai: nBernilai, unitDenganCatatan: nAdaCatatan, unitTanpaCatatan, catatanPemakaianPeriode: issue.length, catatanTanpaHarga: issueTanpaHarga.length },
    tidakTerbukti: {
      nominal: null, unitTanpaCatatanPemakaian: unitTanpaCatatan, unitCatatanTanpaHarga, catatanPemakaianTanpaHarga: issueTanpaHarga.length,
      keterangan: "Biaya bahan unit-unit ini belum dapat dibuktikan; nominalnya sengaja dikosongkan (bukan Rp0) dan TIDAK dihitung di laba.",
    },
    estimasiInformatif: {
      dimasukkanKeLaba: false, periode: estimasiPeriode, historisPerBulan: estimasiHistoris,
      keterangan: "Estimasi memakai harga referensi (snapshot Excel Agustus 2026) × qty pemakaian — hanya pembanding. Tidak masuk laba, margin, atau jurnal.",
    },
    persediaan: { penerimaanBahanBernilai: persediaanBertambah, keterangan: "Penerimaan barang menambah Persediaan (aset). Menjadi HPP hanya saat bahan dipakai produksi." },
  };
}
const idIssue = (issue) => issue.map((m) => m.id);
