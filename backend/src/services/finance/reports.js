// LAPORAN KEUANGAN — SEMUANYA diturunkan dari fin_journal_lines.
//
// TIDAK ADA satu pun angka di file ini yang dibaca dari kolom saldo
// tersimpan, karena tidak ada kolom saldo tersimpan sama sekali. Prinsipnya
// sama dengan yang sudah dipegang repo ini di dua tempat lain: stok dihitung
// dari SUM(stock_movements), status bayar dihitung dari ledger Payment.
// Saldo yang disimpan = sumber kebenaran kedua yang pasti akan drift.
//
// ── KEJUJURAN LAPORAN ───────────────────────────────────────────────────
// Setiap laporan di sini mengembalikan `catatan` berisi hal-hal yang
// membuat angkanya BELUM lengkap: berapa gap posting yang masih terbuka,
// sejak kapan pembukuan dimulai, apakah saldo awal pernah diinput. Itu
// BUKAN hiasan — tanpa itu, neraca yang belum punya saldo awal akan terbaca
// sebagai "perusahaan ini baru lahir bulan lalu". UI WAJIB menampilkannya.
//
// ── ARUS KAS: METODE LANGSUNG ───────────────────────────────────────────
// Dihitung dari baris jurnal yang menyentuh akun kas/bank, dikelompokkan
// menurut kategori akun LAWAN-nya dalam jurnal yang sama. Metode tidak
// langsung (dari laba bersih + penyesuaian non-kas) sengaja TIDAK dipakai:
// ia butuh data penyusutan & perubahan modal kerja yang belum ada di sistem
// ini, jadi hasilnya akan lebih banyak asumsi daripada fakta.

import { STATUS_DIHITUNG } from "./journal.js";
import { toMoney, sumMoney, ZERO, moneyToNumber } from "./money.js";
import { SETTING_KEYS, getSettingRaw } from "./settings.js";

// Tipe akun yang masuk LABA RUGI vs NERACA.
const TIPE_LABA_RUGI = ["PENDAPATAN", "BEBAN_POKOK", "BEBAN"];
const TIPE_NERACA = ["ASET", "KEWAJIBAN", "EKUITAS"];

/**
 * Saldo per akun dalam satu rentang tanggal.
 * `from` boleh null = sejak awal pembukuan (dipakai akun neraca, yang
 * saldonya kumulatif; akun laba rugi selalu dibatasi periode).
 */
export async function saldoPerAkun(db, { from = null, to, accountIds = null } = {}) {
  const where = {
    entry: {
      status: { in: STATUS_DIHITUNG },
      date: { ...(from ? { gte: from } : {}), lte: to },
    },
    ...(accountIds ? { accountId: { in: accountIds } } : {}),
  };

  const grouped = await db.finJournalLine.groupBy({
    by: ["accountId"],
    where,
    _sum: { debit: true, credit: true },
  });

  const peta = new Map();
  for (const g of grouped) {
    peta.set(g.accountId, {
      debit: toMoney(g._sum.debit || 0),
      credit: toMoney(g._sum.credit || 0),
    });
  }
  return peta;
}

/**
 * Saldo menurut SALDO NORMAL akun — positif berarti "normal", negatif
 * berarti terbalik (mis. kas bersaldo kredit = uang keluar melebihi yang
 * pernah masuk, sinyal ada jurnal yang salah arah).
 *
 * ⚠️ ARAHNYA DITENTUKAN `normalBalance`, BUKAN `type`. Akun KONTRA —
 * "Retur & Potongan Penjualan" (tipe PENDAPATAN, saldo normal DEBIT) dan
 * "Akumulasi Penyusutan" (tipe ASET, saldo normal KREDIT) — akan terbalik
 * total kalau arahnya ditebak dari tipe, dan retur akan terhitung sebagai
 * penjualan.
 *
 * `toMoney` di sini BUKAN hiasan: fungsi ini di-export dan dipanggil dari
 * beberapa laporan. Pemanggil internal mengoper Decimal (hasil
 * saldoPerAkun), tapi pemanggil lain wajar mengoper angka biasa dari hasil
 * groupBy Prisma — tanpa koreksi di sini, itu gagal dengan
 * "debit.minus is not a function", bukan dengan angka yang salah.
 */
export function saldoNormal(account, totals) {
  const debit = toMoney(totals?.debit ?? ZERO);
  const credit = toMoney(totals?.credit ?? ZERO);
  return account.normalBalance === "DEBIT" ? debit.minus(credit) : credit.minus(debit);
}

async function ambilAkun(db, { hanyaPostable = true } = {}) {
  return db.finAccount.findMany({
    where: hanyaPostable ? { isPostable: true } : {},
    orderBy: { code: "asc" },
    select: {
      id: true, code: true, name: true, type: true, normalBalance: true,
      parentId: true, isPostable: true, active: true, cashFlowCategory: true, systemKey: true,
    },
  });
}

/**
 * Catatan kejujuran yang menempel di SEMUA laporan. Lihat blok komentar di
 * kepala file soal kenapa ini wajib ikut, bukan opsional.
 */
export async function catatanLaporan(db) {
  const [gapTerbuka, bookStart, adaSaldoAwal, periodeTerbuka] = await Promise.all([
    db.finPostingGap.count({ where: { resolvedAt: null } }),
    getSettingRaw(db, SETTING_KEYS.BOOK_START_DATE),
    db.finJournalEntry.count({ where: { source: "SALDO_AWAL", status: { in: STATUS_DIHITUNG } } }),
    db.finPeriod.count({ where: { status: "OPEN" } }),
  ]);

  const pesan = [];
  if (!adaSaldoAwal) {
    pesan.push(
      "Saldo awal belum pernah diinput. Angka di laporan ini hanya mencakup transaksi yang tercatat " +
      "SEJAK sistem finance aktif — bukan posisi keuangan perusahaan secara keseluruhan."
    );
  }
  if (gapTerbuka > 0) {
    pesan.push(
      `${gapTerbuka} transaksi belum bisa dibukukan (lihat Finance > Data Belum Lengkap). ` +
      "Selama itu belum dibereskan, angka di laporan ini KURANG dari kenyataan."
    );
  }

  return {
    gapTerbuka,
    saldoAwalTerisi: adaSaldoAwal > 0,
    mulaiPembukuan: bookStart || null,
    periodeTerbuka,
    pesan,
  };
}

/**
 * NERACA SALDO (trial balance) — daftar seluruh akun dengan total debit &
 * kredit periode itu. Total debit dan total kredit WAJIB sama; kalau tidak,
 * ada jurnal cacat yang lolos ke database lewat jalur di luar postJournal.
 * Laporan ini yang pertama kali akan memperlihatkannya.
 */
export async function neracaSaldo(db, { from, to }) {
  const akun = await ambilAkun(db);
  const saldoPeriode = await saldoPerAkun(db, { from, to });
  // Akun NERACA butuh saldo KUMULATIF sejak awal, bukan cuma periode ini.
  const saldoKumulatif = await saldoPerAkun(db, { to });

  const baris = akun
    .map((a) => {
      const periode = saldoPeriode.get(a.id) || { debit: ZERO, credit: ZERO };
      const kumulatif = saldoKumulatif.get(a.id) || { debit: ZERO, credit: ZERO };
      const pakai = TIPE_NERACA.includes(a.type) ? kumulatif : periode;
      const saldo = saldoNormal(a, pakai);
      return {
        accountId: a.id,
        code: a.code,
        name: a.name,
        type: a.type,
        normalBalance: a.normalBalance,
        mutasiDebit: moneyToNumber(periode.debit),
        mutasiKredit: moneyToNumber(periode.credit),
        // Kolom neraca saldo klasik: saldo akhir ditaruh di sisi normalnya.
        saldoDebit: a.normalBalance === "DEBIT" ? moneyToNumber(saldo) : 0,
        saldoKredit: a.normalBalance === "KREDIT" ? moneyToNumber(saldo) : 0,
        saldo: moneyToNumber(saldo),
      };
    })
    .filter((b) => b.mutasiDebit !== 0 || b.mutasiKredit !== 0 || b.saldo !== 0);

  const totalDebit = sumMoney(baris.map((b) => b.mutasiDebit));
  const totalKredit = sumMoney(baris.map((b) => b.mutasiKredit));

  return {
    periode: { from, to },
    baris,
    total: {
      mutasiDebit: moneyToNumber(totalDebit),
      mutasiKredit: moneyToNumber(totalKredit),
      // true = buku besar sehat. false = ada jurnal timpang yang masuk lewat
      // jalur di luar postJournal — itu keadaan darurat, bukan selisih biasa.
      seimbang: totalDebit.equals(totalKredit),
      selisih: moneyToNumber(totalDebit.minus(totalKredit)),
    },
    catatan: await catatanLaporan(db),
  };
}

/**
 * LABA RUGI. Struktur mengikuti kebiasaan Indonesia:
 *   Pendapatan − Retur = Pendapatan Bersih
 *   Pendapatan Bersih − Beban Pokok = LABA KOTOR
 *   Laba Kotor − Beban Operasional = LABA BERSIH
 */
export async function labaRugi(db, { from, to }) {
  const akun = (await ambilAkun(db)).filter((a) => TIPE_LABA_RUGI.includes(a.type));
  const saldo = await saldoPerAkun(db, { from, to, accountIds: akun.map((a) => a.id) });

  const kelompok = { PENDAPATAN: [], BEBAN_POKOK: [], BEBAN: [] };
  for (const a of akun) {
    const nilai = saldoNormal(a, saldo.get(a.id));
    if (nilai.isZero()) continue;
    kelompok[a.type].push({
      accountId: a.id, code: a.code, name: a.name,
      normalBalance: a.normalBalance,
      nilai: moneyToNumber(nilai),
    });
  }

  // Akun KONTRA pendapatan (Retur & Potongan Penjualan) bersaldo normal
  // DEBIT walau bertipe PENDAPATAN — ia MENGURANGI pendapatan, bukan
  // menambah. Memakai `type` saja untuk menjumlahkan adalah kesalahan klasik
  // yang membuat retur terhitung sebagai penjualan.
  const pendapatanBruto = sumMoney(
    kelompok.PENDAPATAN.filter((r) => r.normalBalance === "KREDIT").map((r) => r.nilai)
  );
  const retur = sumMoney(
    kelompok.PENDAPATAN.filter((r) => r.normalBalance === "DEBIT").map((r) => r.nilai)
  );
  const pendapatanBersih = pendapatanBruto.minus(retur);
  const bebanPokok = sumMoney(kelompok.BEBAN_POKOK.map((r) => r.nilai));
  const labaKotor = pendapatanBersih.minus(bebanPokok);
  const bebanOperasional = sumMoney(kelompok.BEBAN.map((r) => r.nilai));
  const labaBersih = labaKotor.minus(bebanOperasional);

  return {
    periode: { from, to },
    pendapatan: kelompok.PENDAPATAN.filter((r) => r.normalBalance === "KREDIT"),
    retur: kelompok.PENDAPATAN.filter((r) => r.normalBalance === "DEBIT"),
    bebanPokok: kelompok.BEBAN_POKOK,
    bebanOperasional: kelompok.BEBAN,
    ringkasan: {
      pendapatanBruto: moneyToNumber(pendapatanBruto),
      retur: moneyToNumber(retur),
      pendapatanBersih: moneyToNumber(pendapatanBersih),
      bebanPokok: moneyToNumber(bebanPokok),
      labaKotor: moneyToNumber(labaKotor),
      marginKotor: pendapatanBersih.isZero() ? null : moneyToNumber(labaKotor.dividedBy(pendapatanBersih).times(100)),
      bebanOperasional: moneyToNumber(bebanOperasional),
      labaBersih: moneyToNumber(labaBersih),
      marginBersih: pendapatanBersih.isZero() ? null : moneyToNumber(labaBersih.dividedBy(pendapatanBersih).times(100)),
    },
    catatan: await catatanLaporan(db),
  };
}

/**
 * NERACA per satu tanggal.
 *
 * LABA TAHUN BERJALAN dihitung LANGSUNG dari akun pendapatan & beban sejak
 * 1 Januari tahun itu — TIDAK diambil dari akun Laba Ditahan. Alasannya:
 * kalau neraca bergantung pada proses tutup buku tahunan, maka neraca akan
 * salah sepanjang tahun sampai tutup buku dijalankan, dan akan salah
 * SELAMANYA kalau tutup buku lupa dijalankan. Dengan cara ini neraca selalu
 * seimbang tanpa proses apa pun.
 */
export async function neraca(db, { to }) {
  const akun = await ambilAkun(db);
  const saldo = await saldoPerAkun(db, { to });

  const awalTahun = new Date(Date.UTC(to.getUTCFullYear(), 0, 1));
  const saldoTahunIni = await saldoPerAkun(db, { from: awalTahun, to });

  const kelompok = { ASET: [], KEWAJIBAN: [], EKUITAS: [] };
  let labaBerjalan = ZERO;

  for (const a of akun) {
    if (TIPE_LABA_RUGI.includes(a.type)) {
      const nilai = saldoNormal(a, saldoTahunIni.get(a.id));
      if (a.type === "PENDAPATAN") {
        labaBerjalan = a.normalBalance === "KREDIT" ? labaBerjalan.plus(nilai) : labaBerjalan.minus(nilai);
      } else {
        labaBerjalan = labaBerjalan.minus(nilai);
      }
      continue;
    }
    const nilai = saldoNormal(a, saldo.get(a.id));
    if (nilai.isZero()) continue;
    kelompok[a.type].push({
      accountId: a.id, code: a.code, name: a.name,
      normalBalance: a.normalBalance,
      nilai: moneyToNumber(nilai),
    });
  }

  const totalAset = sumMoney(kelompok.ASET.map((r) => r.nilai));
  const totalKewajiban = sumMoney(kelompok.KEWAJIBAN.map((r) => r.nilai));
  const ekuitasTercatat = sumMoney(kelompok.EKUITAS.map((r) => r.nilai));
  const totalEkuitas = ekuitasTercatat.plus(labaBerjalan);
  const totalPasiva = totalKewajiban.plus(totalEkuitas);

  return {
    perTanggal: to,
    aset: kelompok.ASET,
    kewajiban: kelompok.KEWAJIBAN,
    ekuitas: kelompok.EKUITAS,
    labaTahunBerjalan: moneyToNumber(labaBerjalan),
    ringkasan: {
      totalAset: moneyToNumber(totalAset),
      totalKewajiban: moneyToNumber(totalKewajiban),
      totalEkuitas: moneyToNumber(totalEkuitas),
      totalPasiva: moneyToNumber(totalPasiva),
      seimbang: totalAset.equals(totalPasiva),
      selisih: moneyToNumber(totalAset.minus(totalPasiva)),
    },
    catatan: await catatanLaporan(db),
  };
}

/**
 * ARUS KAS — metode LANGSUNG. Lihat komentar di kepala file.
 *
 * TRANSFER ANTAR REKENING SENDIRI DIKECUALIKAN TOTAL (source TRANSFER_KAS):
 * setor tunai ke bank akan tampil sebagai "kas keluar Rp X" DAN "kas masuk
 * Rp X" kalau ikut dihitung — menggelembungkan kedua sisi laporan untuk
 * uang yang sebenarnya tidak ke mana-mana.
 */
export async function arusKas(db, { from, to }) {
  const akunKasIds = (await db.finAccount.findMany({
    where: { OR: [{ systemKey: "KAS" }, { systemKey: "BANK" }] },
    select: { id: true },
  })).map((a) => a.id);

  if (akunKasIds.length === 0) {
    return {
      periode: { from, to },
      operasi: [], investasi: [], pendanaan: [], takTerkategori: [],
      ringkasan: { saldoAwal: 0, masuk: 0, keluar: 0, arusBersih: 0, saldoAkhir: 0 },
      catatan: await catatanLaporan(db),
    };
  }

  // Saldo awal kas = seluruh mutasi kas SEBELUM tanggal mulai.
  const sebelum = await db.finJournalLine.aggregate({
    where: {
      accountId: { in: akunKasIds },
      entry: { status: { in: STATUS_DIHITUNG }, date: { lt: from } },
    },
    _sum: { debit: true, credit: true },
  });
  const saldoAwal = toMoney(sebelum._sum.debit || 0).minus(toMoney(sebelum._sum.credit || 0));

  // Ambil jurnal yang menyentuh kas dalam periode, LENGKAP dengan seluruh
  // barisnya — kategori arus ditentukan akun LAWAN dalam jurnal yang sama.
  const entries = await db.finJournalEntry.findMany({
    where: {
      status: { in: STATUS_DIHITUNG },
      date: { gte: from, lte: to },
      source: { not: "TRANSFER_KAS" },
      lines: { some: { accountId: { in: akunKasIds } } },
    },
    select: {
      id: true, entryNumber: true, date: true, description: true, source: true,
      lines: {
        select: {
          debit: true, credit: true, accountId: true,
          account: { select: { id: true, code: true, name: true, type: true, cashFlowCategory: true } },
        },
      },
    },
  });

  const bucket = { OPERASI: new Map(), INVESTASI: new Map(), PENDANAAN: new Map(), LAIN: new Map() };
  let masuk = ZERO;
  let keluar = ZERO;

  for (const e of entries) {
    const barisKas = e.lines.filter((l) => akunKasIds.includes(l.accountId));
    const barisLawan = e.lines.filter((l) => !akunKasIds.includes(l.accountId));

    const kasMasuk = sumMoney(barisKas.map((l) => l.debit));
    const kasKeluar = sumMoney(barisKas.map((l) => l.credit));
    const arusBersih = kasMasuk.minus(kasKeluar);
    if (arusBersih.isZero()) continue;

    masuk = masuk.plus(kasMasuk);
    keluar = keluar.plus(kasKeluar);

    // Bobot per akun lawan — jurnal dengan beberapa lawan (mis. pendapatan
    // + ongkir) dibagi proporsional, bukan dilempar semua ke lawan pertama.
    const bobotTotal = sumMoney(barisLawan.map((l) => toMoney(l.debit).plus(toMoney(l.credit))));
    for (const l of barisLawan) {
      const bobot = toMoney(l.debit).plus(toMoney(l.credit));
      if (bobot.isZero() || bobotTotal.isZero()) continue;
      const porsi = arusBersih.times(bobot).dividedBy(bobotTotal);
      const kategori = l.account.cashFlowCategory || "LAIN";
      const map = bucket[kategori] || bucket.LAIN;
      const key = l.account.id;
      if (!map.has(key)) {
        map.set(key, { code: l.account.code, name: l.account.name, nilai: ZERO });
      }
      const row = map.get(key);
      row.nilai = row.nilai.plus(porsi);
    }
  }

  const bentuk = (map) =>
    [...map.values()]
      .map((r) => ({ code: r.code, name: r.name, nilai: moneyToNumber(r.nilai) }))
      .filter((r) => r.nilai !== 0)
      .sort((a, b) => a.code.localeCompare(b.code));

  const arusBersih = masuk.minus(keluar);

  return {
    periode: { from, to },
    operasi: bentuk(bucket.OPERASI),
    investasi: bentuk(bucket.INVESTASI),
    pendanaan: bentuk(bucket.PENDANAAN),
    // Akun yang belum diberi kategori arus kas oleh admin — ditampilkan
    // TERPISAH & apa adanya, bukan dipaksa masuk "Operasi" supaya laporannya
    // kelihatan rapi. Rapi tapi salah lebih buruk daripada terlihat belum
    // selesai.
    takTerkategori: bentuk(bucket.LAIN),
    ringkasan: {
      saldoAwal: moneyToNumber(saldoAwal),
      masuk: moneyToNumber(masuk),
      keluar: moneyToNumber(keluar),
      arusBersih: moneyToNumber(arusBersih),
      saldoAkhir: moneyToNumber(saldoAwal.plus(arusBersih)),
    },
    catatan: await catatanLaporan(db),
  };
}

/** BUKU BESAR satu akun — mutasi berurut + saldo berjalan. */
export async function bukuBesar(db, { accountId, from, to, limit = 500 }) {
  const account = await db.finAccount.findUnique({
    where: { id: accountId },
    select: { id: true, code: true, name: true, type: true, normalBalance: true },
  });
  if (!account) return null;

  const sebelum = await db.finJournalLine.aggregate({
    where: { accountId, entry: { status: { in: STATUS_DIHITUNG }, date: { lt: from } } },
    _sum: { debit: true, credit: true },
  });
  const debitAwal = toMoney(sebelum._sum.debit || 0);
  const kreditAwal = toMoney(sebelum._sum.credit || 0);
  let saldo = account.normalBalance === "DEBIT" ? debitAwal.minus(kreditAwal) : kreditAwal.minus(debitAwal);
  const saldoAwal = saldo;

  const lines = await db.finJournalLine.findMany({
    where: { accountId, entry: { status: { in: STATUS_DIHITUNG }, date: { gte: from, lte: to } } },
    orderBy: [{ entry: { date: "asc" } }, { entry: { entryNumber: "asc" } }, { lineNo: "asc" }],
    take: limit,
    select: {
      id: true, debit: true, credit: true, description: true,
      entry: { select: { id: true, entryNumber: true, date: true, description: true, source: true, status: true } },
      order: { select: { id: true, orderNumber: true } },
      customer: { select: { id: true, name: true } },
      supplier: { select: { id: true, name: true } },
      cashAccount: { select: { id: true, name: true } },
    },
  });

  const baris = lines.map((l) => {
    const d = toMoney(l.debit);
    const k = toMoney(l.credit);
    saldo = account.normalBalance === "DEBIT" ? saldo.plus(d).minus(k) : saldo.plus(k).minus(d);
    return {
      lineId: l.id,
      entryId: l.entry.id,
      entryNumber: l.entry.entryNumber,
      tanggal: l.entry.date,
      keterangan: l.description || l.entry.description,
      source: l.entry.source,
      status: l.entry.status,
      debit: moneyToNumber(d),
      kredit: moneyToNumber(k),
      saldo: moneyToNumber(saldo),
      orderNumber: l.order?.orderNumber || null,
      customerName: l.customer?.name || null,
      supplierName: l.supplier?.name || null,
      cashAccountName: l.cashAccount?.name || null,
    };
  });

  return {
    account,
    periode: { from, to },
    saldoAwal: moneyToNumber(saldoAwal),
    saldoAkhir: moneyToNumber(saldo),
    baris,
    terpotong: lines.length >= limit,
  };
}

// ── UMUR PIUTANG & UTANG ────────────────────────────────────────────────
const EMBER_UMUR = [
  { key: "belum_jatuh_tempo", label: "Belum jatuh tempo", max: 0 },
  { key: "1_30", label: "1–30 hari", max: 30 },
  { key: "31_60", label: "31–60 hari", max: 60 },
  { key: "61_90", label: "61–90 hari", max: 90 },
  { key: "90_plus", label: "> 90 hari", max: Infinity },
];

function emberUmur(hariLewat) {
  if (hariLewat <= 0) return "belum_jatuh_tempo";
  for (const e of EMBER_UMUR) {
    if (e.max > 0 && hariLewat <= e.max) return e.key;
  }
  return "90_plus";
}

/**
 * UMUR PIUTANG per order — dari saldo akun Piutang Usaha per dimensi
 * orderId, bukan dari Order.value dikurangi pembayaran.
 *
 * Order yang sudah ditandai LUNAS di CRM TIDAK ditampilkan sebagai piutang
 * (19 Sep 2026): sales sudah menyatakan uangnya diterima, tinggal finance
 * memverifikasi & mencatat rekeningnya (Pembayaran & Verifikasi). Jumlahnya
 * dilaporkan terpisah di `menungguVerifikasi` supaya angka piutang di
 * halaman ini tetap bisa direkonsiliasi ke saldo Piutang Usaha di neraca:
 * neraca = piutang di daftar + menungguVerifikasi.
 *
 * Bedanya penting: order yang belum diserahkan TIDAK punya piutang sama
 * sekali (uangnya masih uang muka), dan order yang sudah dilunasi saldonya
 * nol tanpa perlu membandingkan dua angka dari sumber berbeda.
 */
export async function umurPiutang(db, { to = new Date() } = {}) {
  const akunPiutang = await db.finAccount.findUnique({
    where: { systemKey: "PIUTANG_USAHA" },
    select: { id: true },
  });
  if (!akunPiutang) return { baris: [], ringkasan: {}, ember: EMBER_UMUR, menungguVerifikasi: { jumlah: 0, total: 0 }, catatan: await catatanLaporan(db) };

  const grouped = await db.finJournalLine.groupBy({
    by: ["orderId"],
    where: {
      accountId: akunPiutang.id,
      orderId: { not: null },
      entry: { status: { in: STATUS_DIHITUNG }, date: { lte: to } },
    },
    _sum: { debit: true, credit: true },
  });

  const bersaldo = grouped
    .map((g) => ({ orderId: g.orderId, saldo: toMoney(g._sum.debit || 0).minus(toMoney(g._sum.credit || 0)) }))
    .filter((g) => g.saldo.greaterThan(0));

  if (bersaldo.length === 0) {
    return { baris: [], ringkasan: ringkasanKosong(), ember: EMBER_UMUR, menungguVerifikasi: { jumlah: 0, total: 0 }, catatan: await catatanLaporan(db) };
  }

  const orders = await db.order.findMany({
    where: { id: { in: bersaldo.map((b) => b.orderId) } },
    select: {
      id: true, orderNumber: true, value: true, createdAt: true, status: true, paymentStatus: true,
      customer: { select: { id: true, name: true, phone: true, assignedSales: { select: { name: true } } } },
      invoice: { select: { invoiceNumber: true, dueDate: true, lifecycleStatus: true } },
    },
  });
  const byId = new Map(orders.map((o) => [o.id, o]));

  const lunasDiCrm = bersaldo.filter((b) => byId.get(b.orderId)?.paymentStatus === "LUNAS");
  const menungguVerifikasi = {
    jumlah: lunasDiCrm.length,
    total: moneyToNumber(lunasDiCrm.length ? sumMoney(lunasDiCrm.map((b) => b.saldo)) : ZERO),
  };

  const ringkasan = ringkasanKosong();
  const baris = bersaldo.filter((b) => byId.get(b.orderId)?.paymentStatus !== "LUNAS").map((b) => {
    const o = byId.get(b.orderId);
    // Tanpa jatuh tempo eksplisit di invoice, umur dihitung dari tanggal
    // order dibuat — dinyatakan apa adanya lewat `sumberJatuhTempo` supaya
    // UI tidak menyajikan tanggal karangan sebagai kesepakatan.
    const dueDate = o?.invoice?.dueDate || null;
    const acuan = dueDate || o?.createdAt || to;
    const hariLewat = Math.floor((to - new Date(acuan)) / 86400000);
    const ember = emberUmur(hariLewat);
    ringkasan[ember] = ringkasan[ember].plus(b.saldo);
    return {
      orderId: b.orderId,
      orderNumber: o?.orderNumber || null,
      invoiceNumber: o?.invoice?.invoiceNumber || null,
      customerId: o?.customer?.id || null,
      customerName: o?.customer?.name || "—",
      salesName: o?.customer?.assignedSales?.name || null,
      nilaiOrder: o?.value || 0,
      sisaTagihan: moneyToNumber(b.saldo),
      dueDate,
      sumberJatuhTempo: dueDate ? "invoice" : "tanggal_order",
      hariLewat,
      ember,
      orderStatus: o?.status || null,
    };
  }).sort((a, b) => b.hariLewat - a.hariLewat);

  return {
    perTanggal: to,
    baris,
    ringkasan: Object.fromEntries(Object.entries(ringkasan).map(([k, v]) => [k, moneyToNumber(v)])),
    total: moneyToNumber(baris.length ? sumMoney(baris.map((b) => b.sisaTagihan)) : ZERO),
    menungguVerifikasi,
    ember: EMBER_UMUR,
    catatan: await catatanLaporan(db),
  };
}

function ringkasanKosong() {
  return Object.fromEntries(EMBER_UMUR.map((e) => [e.key, ZERO]));
}

/** UMUR UTANG per tagihan supplier — dari dokumen tagihan + alokasi bayarnya. */
export async function umurUtang(db, { to = new Date() } = {}) {
  const bills = await db.finSupplierBill.findMany({
    where: { status: { in: ["DISETUJUI", "DIBAYAR_SEBAGIAN"] }, billDate: { lte: to } },
    select: {
      id: true, billNumber: true, supplierRef: true, amount: true, billDate: true, dueDate: true, description: true,
      supplier: { select: { id: true, name: true } },
      allocations: { where: { payment: { cancelledAt: null } }, select: { amount: true } },
    },
  });

  const ringkasan = ringkasanKosong();
  const baris = bills.map((b) => {
    const terbayar = b.allocations.length === 0 ? ZERO : sumMoney(b.allocations.map((a) => a.amount));
    const sisa = toMoney(b.amount).minus(terbayar);
    const acuan = b.dueDate || b.billDate;
    const hariLewat = Math.floor((to - new Date(acuan)) / 86400000);
    const ember = emberUmur(hariLewat);
    ringkasan[ember] = ringkasan[ember].plus(sisa);
    return {
      billId: b.id,
      billNumber: b.billNumber,
      supplierRef: b.supplierRef,
      supplierId: b.supplier.id,
      supplierName: b.supplier.name,
      description: b.description,
      nilaiTagihan: moneyToNumber(b.amount),
      terbayar: moneyToNumber(terbayar),
      sisa: moneyToNumber(sisa),
      billDate: b.billDate,
      dueDate: b.dueDate,
      sumberJatuhTempo: b.dueDate ? "tagihan" : "tanggal_tagihan",
      hariLewat,
      ember,
    };
  }).filter((b) => b.sisa > 0).sort((a, b) => b.hariLewat - a.hariLewat);

  return {
    perTanggal: to,
    baris,
    ringkasan: Object.fromEntries(Object.entries(ringkasan).map(([k, v]) => [k, moneyToNumber(v)])),
    total: moneyToNumber(sumMoney(baris.map((b) => b.sisa))),
    ember: EMBER_UMUR,
    catatan: await catatanLaporan(db),
  };
}

/** Saldo tiap rekening kas/bank menurut BUKU (bukan menurut koran bank). */
export async function saldoKasBank(db, { to = new Date() } = {}) {
  const rekening = await db.finCashAccount.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, kind: true, bankName: true, accountNumber: true, accountId: true },
  });
  if (rekening.length === 0) return [];

  const grouped = await db.finJournalLine.groupBy({
    by: ["cashAccountId"],
    where: {
      cashAccountId: { in: rekening.map((r) => r.id) },
      entry: { status: { in: STATUS_DIHITUNG }, date: { lte: to } },
    },
    _sum: { debit: true, credit: true },
  });
  const peta = new Map(grouped.map((g) => [g.cashAccountId, g]));

  return rekening.map((r) => {
    const g = peta.get(r.id);
    const saldo = toMoney(g?._sum.debit || 0).minus(toMoney(g?._sum.credit || 0));
    return { ...r, saldo: moneyToNumber(saldo) };
  });
}
