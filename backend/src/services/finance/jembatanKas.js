// JEMBATAN "UANG MASUK TERVERIFIKASI" → "KAS MASUK DARI PELANGGAN (MENURUT BUKU)" (Fase 1 — Kontrak Angka, 1 Okt 2026). BACA-SAJA: tidak menulis jurnal/data apa pun.
//
// Dua angka yang sering disangka sama tetapi punya basis berbeda:
//   A  Uang Masuk Terverifikasi : Σ Payment aktif terverifikasi, tanggal = Payment.createdAt WIB  (angka layar Pembayaran/Pemasukan)
//   B  Kas Masuk dari Pelanggan : Σ debit akun Kas/Bank pada jurnal PEMBAYARAN_ORDER, tanggal = jurnal.date  (angka buku besar / Arus Kas)
// Selisih A − B tidak boleh "misterius". Penyusunnya (tiap Payment masuk TEPAT SATU kelas):
//   1. Sebelum saldo awal   : diterima sebelum tanggal cutoff → dijurnal ke Laba Ditahan, kas TIDAK bertambah (sudah ada di saldo riil)
//   2. Belum dibukukan      : terverifikasi, setelah cutoff, tetapi belum ada jurnal kas (mis. rekening belum dipetakan) → antrean "Data belum lengkap"
//   3. Beda tanggal buku    : jurnal dibuat bertanggal UTC dari createdAt, sedangkan layar memakai tanggal WIB → pembayaran 00:00–06:59 WIB jatuh di hari/bulan buku sebelumnya
//   4. Selisih nominal      : debit kas ≠ nominal Payment (seharusnya 0)
//   + (arah sebaliknya) Jurnal periode ini yang berasal dari Payment tanggal WIB di luar periode.
// Identitas:  A − (1) − (2) − (3 keluar) − (4) + (3 masuk) = B   → residual dihitung dari B yang dibaca LANGSUNG dari jurnal (bukan dari bridge), HARUS 0.

import { startOfDayWIB, endOfDayExclusiveWIB, WIB_OFFSET_MS } from "../../utils/wib.js";
import { STATUS_DIHITUNG } from "./journal.js";
import { KEY as KEY_ORDER } from "./posting/orderRevenue.js";
import { tanggalCutoff } from "./cutoff.js";

const rp = (n) => Math.round(Number(n) || 0);
const tglWib = (d) => new Date(d.getTime() + WIB_OFFSET_MS).toISOString().slice(0, 10);
const tglJurnal = (d) => d.toISOString().slice(0, 10);

export async function jembatanKas(db, { from, to, denganDetail = false } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from || "") || !/^\d{4}-\d{2}-\d{2}$/.test(to || "")) throw Object.assign(new Error("Periode (from/to) wajib diisi"), { statusCode: 400 });
  const mulai = startOfDayWIB(from);
  const selesai = endOfDayExclusiveWIB(to);
  const cutoff = await tanggalCutoff(db);

  const akunKas = (await db.finAccount.findMany({ where: { OR: [{ systemKey: "KAS" }, { systemKey: "BANK" }] }, select: { id: true } })).map((a) => a.id);

  // A — Payment aktif terverifikasi pada periode (basis tanggal pembayaran WIB)
  const bayarA = await db.payment.findMany({
    where: { cancelledAt: null, createdAt: { gte: mulai, lt: selesai }, verifications: { some: {} } },
    select: { id: true, amount: true, createdAt: true, method: true, order: { select: { orderNumber: true, customer: { select: { name: true } } } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  // Jurnal PEMBAYARAN_ORDER milik Payment-Payment itu (kunci idempotensi), lengkap dengan debit kas
  const jurnalDari = async (idPay) => {
    if (!idPay.length) return new Map();
    const es = await db.finJournalEntry.findMany({
      where: { idempotencyKey: { in: idPay.map((i) => KEY_ORDER.payment(i)) }, status: { in: STATUS_DIHITUNG } },
      select: { id: true, entryNumber: true, date: true, status: true, idempotencyKey: true, lines: { where: { accountId: { in: akunKas } }, select: { debit: true, credit: true } } },
    });
    return new Map(es.map((e) => [e.idempotencyKey, { id: e.id, nomor: e.entryNumber, tanggal: e.date, status: e.status, kasDebit: rp(e.lines.reduce((s, l) => s + Number(l.debit), 0)) }]));
  };
  const jA = await jurnalDari(bayarA.map((p) => p.id));

  const KELAS = { SEBELUM_SALDO_AWAL: [], BELUM_DIBUKUKAN: [], BEDA_TANGGAL_KELUAR: [], SELISIH_NOMINAL: [], DI_PERIODE: [] };
  for (const p of bayarA) {
    const j = jA.get(KEY_ORDER.payment(p.id)) ?? null;
    const nominal = rp(p.amount);
    const item = { paymentId: p.id, tanggalBayar: tglWib(p.createdAt), nomorOrder: p.order?.orderNumber ?? null, pelanggan: p.order?.customer?.name ?? null, metode: p.method, nominal, jurnal: j ? { id: j.id, nomor: j.nomor, tanggal: tglJurnal(j.tanggal) } : null, kasDebit: j?.kasDebit ?? 0 };
    if (!j || j.kasDebit === 0) {
      // Tanpa debit kas: sebelum cutoff = wajar (Laba Ditahan); setelah cutoff = belum dibukukan
      (tglWib(p.createdAt) < cutoff ? KELAS.SEBELUM_SALDO_AWAL : KELAS.BELUM_DIBUKUKAN).push(item);
      continue;
    }
    const jd = tglJurnal(j.tanggal);
    if (jd < from || jd > to) { KELAS.BEDA_TANGGAL_KELUAR.push({ ...item, keterangan: `Tanggal bayar ${item.tanggalBayar} (WIB) tetapi jurnal bertanggal ${jd}` }); continue; }
    if (j.kasDebit !== nominal) KELAS.SELISIH_NOMINAL.push({ ...item, selisih: nominal - j.kasDebit });
    KELAS.DI_PERIODE.push(item);
  }

  // B — dibaca LANGSUNG dari jurnal (independen dari bridge)
  const jurnalB = akunKas.length ? await db.finJournalEntry.findMany({
    where: { source: "PEMBAYARAN_ORDER", status: { in: STATUS_DIHITUNG }, date: { gte: new Date(`${from}T00:00:00.000Z`), lte: new Date(`${to}T00:00:00.000Z`) } },
    select: { id: true, entryNumber: true, date: true, sourceId: true, lines: { where: { accountId: { in: akunKas } }, select: { debit: true } } },
  }) : [];
  const idA = new Set(bayarA.map((p) => p.id));
  const B = jurnalB.reduce((s, e) => s + rp(e.lines.reduce((x, l) => x + Number(l.debit), 0)), 0);

  // Arah sebaliknya: jurnal periode ini dari Payment yang tanggal WIB-nya DI LUAR periode (atau yang tak lagi memenuhi A, mis. dibatalkan/ditolak)
  const asing = jurnalB.filter((e) => !idA.has(e.sourceId) && e.lines.some((l) => Number(l.debit) > 0));
  const payAsing = asing.length ? await db.payment.findMany({ where: { id: { in: asing.map((e) => e.sourceId) } }, select: { id: true, amount: true, createdAt: true, cancelledAt: true, order: { select: { orderNumber: true, customer: { select: { name: true } } } }, verifications: { select: { id: true }, take: 1 } } }) : [];
  const petaAsing = new Map(payAsing.map((p) => [p.id, p]));
  const BEDA_MASUK = []; const TIDAK_LAGI_AKTIF = [];
  for (const e of asing) {
    const p = petaAsing.get(e.sourceId);
    const jumlah = rp(e.lines.reduce((x, l) => x + Number(l.debit), 0));
    const item = { paymentId: e.sourceId, tanggalBayar: p ? tglWib(p.createdAt) : null, nomorOrder: p?.order?.orderNumber ?? null, pelanggan: p?.order?.customer?.name ?? null, nominal: jumlah, jurnal: { id: e.id, nomor: e.entryNumber, tanggal: tglJurnal(e.date) } };
    if (p && !p.cancelledAt && p.verifications.length > 0) BEDA_MASUK.push({ ...item, keterangan: `Tanggal bayar ${item.tanggalBayar} (WIB) di luar periode, jurnal bertanggal ${tglJurnal(e.date)}` });
    else TIDAK_LAGI_AKTIF.push({ ...item, keterangan: p?.cancelledAt ? "Payment sudah dibatalkan (jurnal pembalik tampil di Arus Kas › REVERSAL)" : "Payment belum/tidak terverifikasi" });
  }

  const jml = (arr, f = "nominal") => arr.reduce((s, x) => s + (x[f] || 0), 0);
  const A = jml(bayarA.map((p) => ({ nominal: rp(p.amount) })));
  const c1 = jml(KELAS.SEBELUM_SALDO_AWAL);
  const c2 = jml(KELAS.BELUM_DIBUKUKAN);
  const c3k = jml(KELAS.BEDA_TANGGAL_KELUAR);
  const c4 = jml(KELAS.SELISIH_NOMINAL, "selisih");
  const c3m = jml(BEDA_MASUK);
  const c5 = jml(TIDAK_LAGI_AKTIF);
  const hitungB = A - c1 - c2 - c3k - c4 + c3m + c5;
  const residual = rp(hitungB) - rp(B);

  const langkah = (kunci, label, tanda, jumlah, keterangan, daftar) => ({ kunci, label, tanda, jumlah: rp(jumlah), keterangan, nOrder: daftar ? daftar.length : 0 });
  const urutan = [
    langkah("UANG_MASUK", "Uang Masuk Terverifikasi", 0, A, "Payment aktif terverifikasi, tanggal pembayaran diterima (WIB)", bayarA),
    langkah("SEBELUM_SALDO_AWAL", "Diterima Sebelum Saldo Awal", -1, c1, `Sebelum ${cutoff}: sudah termasuk saldo riil kas/bank, dijurnal ke Laba Ditahan — kas tidak bertambah`, KELAS.SEBELUM_SALDO_AWAL),
    langkah("BELUM_DIBUKUKAN", "Terverifikasi tetapi Belum Dibukukan ke Kas", -1, c2, "Belum ada jurnal kas (mis. rekening belum dipetakan) — selesaikan di Data belum lengkap", KELAS.BELUM_DIBUKUKAN),
    langkah("BEDA_TANGGAL_KELUAR", "Jurnal Bertanggal di Luar Periode (UTC vs WIB)", -1, c3k, "Pembayaran 00:00–06:59 WIB dibukukan di tanggal UTC hari sebelumnya", KELAS.BEDA_TANGGAL_KELUAR),
    langkah("SELISIH_NOMINAL", "Selisih Nominal Payment vs Jurnal Kas", -1, c4, "Seharusnya Rp0", KELAS.SELISIH_NOMINAL),
    langkah("BEDA_TANGGAL_MASUK", "Jurnal Periode Ini dari Pembayaran Tanggal Lain", 1, c3m, "Pembayaran periode sebelumnya yang jurnalnya bertanggal periode ini", BEDA_MASUK),
    langkah("TIDAK_LAGI_AKTIF", "Jurnal dari Payment yang Dibatalkan / Belum Terverifikasi", 1, c5, "Masih terhitung di buku (gross); pembaliknya ada di Arus Kas › REVERSAL", TIDAK_LAGI_AKTIF),
    langkah("KAS_MASUK_PELANGGAN", "Kas Masuk dari Pelanggan (Menurut Buku)", 0, hitungB, "Σ debit Kas/Bank jurnal PEMBAYARAN_ORDER pada periode", null),
  ];
  const lipat = (arr) => {
    const ujung = new Set([arr[0].kunci, arr[arr.length - 1].kunci]);
    const nol = arr.filter((b) => !ujung.has(b.kunci) && b.jumlah === 0 && b.nOrder === 0);
    return { langkah: arr.filter((b) => !nol.includes(b)), komponenLain: { jumlah: 0, nOrder: 0, daftar: nol.map((b) => b.label) } };
  };
  const { langkah: tampil, komponenLain } = lipat(urutan);

  const hasil = {
    periode: { from, to }, cutoff,
    uangMasukTerverifikasi: rp(A), kasMasukBuku: rp(B), selisih: rp(A) - rp(B),
    langkah: tampil, komponenLain,
    pembanding: { label: "Σ debit Kas/Bank jurnal PEMBAYARAN_ORDER (dibaca langsung dari buku besar)", jumlah: rp(B) },
    residual,
    status: {
      perhitungan: residual === 0 ? "COCOK" : "TIDAK_COCOK", perhitunganLabel: residual === 0 ? "Perhitungan cocok" : "Perhitungan tidak cocok",
      perluDitinjau: c2 > 0 || c4 !== 0 || KELAS.BEDA_TANGGAL_KELUAR.length + BEDA_MASUK.length > 0,
      alasanTinjau: [
        ...(c2 > 0 ? [{ kunci: "BELUM_DIBUKUKAN", nOrder: KELAS.BELUM_DIBUKUKAN.length, jumlah: rp(c2), alasan: "Uang terverifikasi yang belum menambah saldo kas/bank di buku" }] : []),
        ...(c4 !== 0 ? [{ kunci: "SELISIH_NOMINAL", nOrder: KELAS.SELISIH_NOMINAL.length, jumlah: rp(c4), alasan: "Nominal jurnal kas berbeda dari Payment" }] : []),
        ...(KELAS.BEDA_TANGGAL_KELUAR.length + BEDA_MASUK.length > 0 ? [{ kunci: "BEDA_TANGGAL_BUKU", nOrder: KELAS.BEDA_TANGGAL_KELUAR.length + BEDA_MASUK.length, jumlah: rp(c3k) + rp(c3m), alasan: "Tanggal buku (UTC) berbeda dari tanggal pembayaran (WIB) — wajar, namun menggeser angka antar hari/bulan" }] : []),
      ],
    },
    metrikKunci: { uangMasuk: "uang_masuk_terverifikasi", kasMasuk: "kas_masuk_pelanggan" },
    detailTersedia: denganDetail,
  };
  if (denganDetail) hasil.detail = { SEBELUM_SALDO_AWAL: KELAS.SEBELUM_SALDO_AWAL, BELUM_DIBUKUKAN: KELAS.BELUM_DIBUKUKAN, BEDA_TANGGAL_KELUAR: KELAS.BEDA_TANGGAL_KELUAR, SELISIH_NOMINAL: KELAS.SELISIH_NOMINAL, BEDA_TANGGAL_MASUK: BEDA_MASUK, TIDAK_LAGI_AKTIF };
  return hasil;
}

