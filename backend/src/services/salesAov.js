// AOV TIM SALES — dua metrik yang SENGAJA dipisah (Okt 2026, permintaan Owner): jangan campur pembilang berbasis tanggal LUNAS dengan penyebut berbasis tanggal DIBUAT.
//
//   AOV Order Masuk Tim = Σ nilai bersih order Tim yang DIBUAT dalam periode ÷ jumlah order Tim yang DIBUAT dalam periode.
//   AOV Order Lunas Tim = Σ nilai bersih order Tim yang MENJADI LUNAS (Order.paidAt) dalam periode ÷ jumlah order Tim yang menjadi lunas dalam periode.
//
// Untuk masing-masing, pembilang DAN penyebut diambil dari SATU himpunan order yang sama (satu query, satu daftar) — kartu, daftar drilldown, dan Export tidak mungkin berbeda.
//
// Aturan yang dipakai SAMA dengan Laporan Sales (routes/analytics.js computeSalesRow + /sales-report):
//   • Periode = tanggal kalender WIB [from, to], batas atas EKSKLUSIF (awal hari berikutnya) — utils/wib.js. Tanpa from/to = semua waktu.
//   • Status CANCELLED dan PENDING tidak dihitung (belum pasti); pelanggan berlabel SPAM tidak dihitung; order operasional Penjualan Karyawan (PKR) tidak dihitung (nominalnya dikelola PKR di Finance).
//   • Nilai = NILAI BERSIH (Order.value − Nota Kredit aktif, tidak pernah negatif) per order — services/orderNilaiBersih.js. Order Rp0 TETAP dihitung sebagai order (ditandai di daftar).
//   • Tim Sales = akun AKTIF berperan utama SALES + akun AKTIF bertanda Team Lead (isSalesTeamLead; mis. Novi yang berperan ADMIN). Closing pribadi Team Lead MASUK (sama dengan kartu "Nilai Penjualan Tim").
//   • Atribusi order ke Tim: pemilik eksplisit (Order.salesOwnerId) ada di Tim; bila pemilik KOSONG → ada percakapan INDIVIDUAL pelanggan yang dipegang anggota Tim (atribusi percakapan lama).
//     Order tanpa atribusi, order milik akun di luar Tim (mis. Sales yang sudah nonaktif) tidak masuk Tim — dicatat terpisah di `diagnosa`, bukan dibuang diam-diam.
//   • Satu order dihitung SATU kali (himpunan, bukan penjumlahan per Sales) — pelanggan dengan beberapa percakapan yang dipegang beberapa Sales tidak membuat order terhitung ganda.
//   • Pembatalan: CANCELLED keluar dari kedua metrik. Refund: AOV Masuk tidak berubah (order tetap tercatat masuk); refund yang membuat order tidak lagi Lunas mengosongkan paidAt (routes/orders.js) sehingga
//     order itu keluar dari AOV Lunas; refund pada order yang tetap Lunas tidak mengubah nilai (hanya Nota Kredit yang mengurangi) — jumlahnya ditampilkan sebagai `orderBerefund`.
import { startOfDayWIB, endOfDayExclusiveWIB } from "../utils/wib.js";
import { PILIH_KREDIT, nilaiBersih } from "./orderNilaiBersih.js";

export const OMSET_EXCLUDED_STATUS = Object.freeze(["CANCELLED", "PENDING"]);
const STATUS_REFUND_TIDAK_AKTIF = ["DITOLAK", "DIBATALKAN"];
export const METRIK = Object.freeze({ MASUK: "masuk", LUNAS: "lunas" });
export const BATAS_DAFTAR_MAKS = 200;
const SEMUA_MULAI = new Date("1970-01-01T00:00:00Z");
const SEMUA_SELESAI = new Date("2999-01-01T00:00:00Z");

export const DEFINISI = Object.freeze({
  [METRIK.MASUK]: {
    label: "AOV Order Masuk Tim",
    ringkas: "Rata-rata nilai bersih per order Tim yang DIBUAT pada periode.",
    rumus: "Σ nilai bersih order yang dibuat di periode ÷ jumlah order yang dibuat di periode",
    tanggalAcuan: "tanggal order dibuat (WIB)",
  },
  [METRIK.LUNAS]: {
    label: "AOV Order Lunas Tim",
    ringkas: "Rata-rata nilai bersih per order Tim yang MENJADI LUNAS pada periode — termasuk order yang dibuat bulan sebelumnya.",
    rumus: "Σ nilai bersih order yang menjadi lunas di periode ÷ jumlah order yang menjadi lunas di periode",
    tanggalAcuan: "tanggal order menjadi lunas / paidAt (WIB)",
  },
});
const CATATAN_UMUM = [
  "Tim Sales = akun Sales aktif + Team Lead aktif (closing pribadi Team Lead ikut). Tiap order dihitung satu kali.",
  "Nilai = nilai bersih (nilai order dikurangi Nota Kredit aktif). Order Rp0 tetap dihitung sebagai order.",
  "Dikecualikan: order Dibatalkan, Menunggu, pelanggan Spam, order Penjualan Karyawan (PKR), dan order tanpa atribusi ke Tim (dirinci di bawah).",
  "Refund tidak mengubah AOV Masuk. Refund yang membuat order tidak lagi Lunas mengeluarkannya dari AOV Lunas; refund pada order yang tetap Lunas tidak mengubah nilai (hanya Nota Kredit yang mengurangi).",
];

/** Batas periode WIB. Tanpa from/to → semua waktu (sentinel, pola yang sama dengan Laporan Sales). */
export function periodeWib(from, to) {
  const ada = Boolean(from && to);
  const mulai = ada ? startOfDayWIB(from) : SEMUA_MULAI;
  const selesai = ada ? endOfDayExclusiveWIB(to) : SEMUA_SELESAI;
  return { from: ada ? from : null, to: ada ? to : null, mulai, selesai, semuaWaktu: !ada, zona: "WIB (UTC+7)", label: ada ? (from === to ? from : `${from} s.d. ${to}`) : "Semua waktu" };
}

/** Tim Sales: Sales aktif (peran utama SALES) + Team Lead aktif. */
export async function muatTim(db) {
  const users = await db.user.findMany({
    where: { active: true, OR: [{ role: "SALES" }, { isSalesTeamLead: true }] },
    select: { id: true, name: true, role: true, isSalesTeamLead: true },
    orderBy: { name: "asc" },
  });
  return { users, ids: users.map((u) => u.id), nama: new Map(users.map((u) => [u.id, u.name])) };
}

const whereDasar = () => ({ status: { notIn: [...OMSET_EXCLUDED_STATUS] }, penjualanKaryawanId: null, customer: { pipelineStage: { not: "SPAM" } } });
const whereJendela = (metrik, p) => (metrik === METRIK.LUNAS ? { paidAt: { gte: p.mulai, lt: p.selesai } } : { createdAt: { gte: p.mulai, lt: p.selesai } });
const whereAtribusiTim = (timIds) => ({
  OR: [
    { salesOwnerId: { in: timIds } },
    { salesOwnerId: null, customer: { conversations: { some: { type: "INDIVIDUAL", assignedToId: { in: timIds } } } } },
  ],
});
/** `where` Prisma himpunan order SATU metrik untuk Tim (satu-satunya definisi — kartu dan daftar memakainya). */
export function whereAov(metrik, p, timIds) {
  return { AND: [whereDasar(), whereJendela(metrik, p), whereAtribusiTim(timIds)] };
}

const SELECT_ORDER = (timIds) => ({
  id: true, orderNumber: true, value: true, status: true, paymentStatus: true, category: true, createdAt: true, paidAt: true, salesOwnerId: true, ...PILIH_KREDIT,
  customer: { select: { id: true, name: true, conversations: { where: { type: "INDIVIDUAL", assignedToId: { in: timIds } }, select: { assignedToId: true } } } },
});

function bentukBaris(o, metrik, p, tim, refund) {
  // Pemilik eksplisit menang; bila kosong, SEMUA anggota Tim yang memegang percakapan pelanggan (urut nama) — satu order tetap dihitung SATU kali.
  const pemegang = o.salesOwnerId ? [o.salesOwnerId] : [...new Set((o.customer?.conversations ?? []).map((c) => c.assignedToId).filter(Boolean))];
  const namaSales = pemegang.map((id) => tim.nama.get(id)).filter(Boolean).sort((a, b) => a.localeCompare(b, "id")).join(", ");
  const bersih = nilaiBersih(o);
  const baris = {
    id: o.id,
    orderNumber: o.orderNumber,
    tanggalDibuat: o.createdAt,
    tanggalLunas: o.paidAt ?? null,
    kategori: o.category,
    statusOrder: o.status,
    statusBayar: o.paymentStatus,
    customerId: o.customer?.id ?? null,
    customerName: o.customer?.name ?? null,
    sales: namaSales || null,
    atribusi: o.salesOwnerId ? "PEMILIK_ORDER" : "PERCAKAPAN",
    nilaiKotor: o.value,
    nilaiBersih: bersih,
    refundAktif: refund.get(o.id) ?? 0,
    // Dibuat sebelum periode tetapi lunas di dalamnya (hanya bermakna untuk AOV Lunas).
    lintasPeriode: metrik === METRIK.LUNAS && new Date(o.createdAt) < p.mulai,
  };
  // Nota Kredit efektif = kotor − bersih (identitas kotor − nota = bersih selalu berlaku, termasuk bila nota melebihi nilai order dan bersih ditahan di Rp0).
  baris.notaKredit = baris.nilaiKotor - bersih;
  baris.rp0 = baris.nilaiKotor === 0;
  return baris;
}

async function refundAktifPerOrder(db, ids) {
  if (ids.length === 0) return new Map();
  const g = await db.finRefund.groupBy({ by: ["orderId"], where: { orderId: { in: ids }, status: { notIn: STATUS_REFUND_TIDAK_AKTIF } }, _sum: { amount: true } });
  return new Map(g.map((r) => [r.orderId, Math.round(Number(r._sum.amount ?? 0))]));
}

/** Semua order satu metrik untuk Tim, lengkap dengan nilai bersih — SATU himpunan untuk kartu dan daftar. Urut: terbaru dulu (tanggal acuan metrik), id sebagai pemutus seri. */
export async function muatOrderAov(db, { metrik, p, tim }) {
  if (!Object.values(METRIK).includes(metrik)) throw Object.assign(new Error('metrik harus "masuk" atau "lunas"'), { statusCode: 400 });
  if (tim.ids.length === 0) return [];
  const orders = await db.order.findMany({
    where: whereAov(metrik, p, tim.ids),
    select: SELECT_ORDER(tim.ids),
    orderBy: metrik === METRIK.LUNAS ? [{ paidAt: "desc" }, { id: "asc" }] : [{ createdAt: "desc" }, { id: "asc" }],
  });
  const refund = await refundAktifPerOrder(db, orders.map((o) => o.id));
  return orders.map((o) => bentukBaris(o, metrik, p, tim, refund));
}

/** Angka ringkasan dari daftar baris (pembilang dan penyebut dari baris yang SAMA). */
export function ringkasBaris(baris) {
  const jumlahOrder = baris.length;
  const totalNilaiBersih = baris.reduce((s, r) => s + r.nilaiBersih, 0);
  return {
    jumlahOrder,
    totalNilaiBersih,
    totalNilaiKotor: baris.reduce((s, r) => s + r.nilaiKotor, 0),
    totalNotaKredit: baris.reduce((s, r) => s + r.notaKredit, 0),
    aov: jumlahOrder > 0 ? Math.round(totalNilaiBersih / jumlahOrder) : 0,
    orderRp0: baris.filter((r) => r.rp0).length,
    orderBernota: baris.filter((r) => r.notaKredit > 0).length,
    orderBerefund: baris.filter((r) => r.refundAktif > 0).length,
    orderLintasPeriode: baris.filter((r) => r.lintasPeriode).length,
    nilaiLintasPeriode: baris.filter((r) => r.lintasPeriode).reduce((s, r) => s + r.nilaiBersih, 0),
  };
}

/** Yang dikecualikan dari himpunan Tim pada periode/metrik yang sama — supaya selisih terhadap angka perusahaan bisa dijelaskan, bukan dibuang diam-diam. */
async function diagnosa(db, { metrik, p, tim, idTim }) {
  const jendela = whereJendela(metrik, p);
  const dasarTanpaStatus = { penjualanKaryawanId: null, customer: { pipelineStage: { not: "SPAM" } } };
  // Selisih himpunan di JS, BUKAN `NOT (atribusi Tim)` di SQL: salesOwnerId NULL membuat NOT(...) bernilai NULL (tereliminasi) sehingga order tanpa atribusi justru hilang.
  const semuaDasar = await db.order.findMany({ where: { AND: [whereDasar(), jendela] }, select: { id: true, value: true, salesOwnerId: true, ...PILIH_KREDIT } });
  const luarTim = semuaDasar.filter((o) => !idTim.has(o.id));
  const tanpaAtribusi = luarTim.filter((o) => !o.salesOwnerId);
  const pemilikLuarTim = luarTim.filter((o) => o.salesOwnerId);
  const [dibatalkan, menunggu, pkr, spam] = await Promise.all([
    db.order.count({ where: { AND: [{ ...dasarTanpaStatus, status: "CANCELLED" }, jendela] } }),
    db.order.count({ where: { AND: [{ ...dasarTanpaStatus, status: "PENDING" }, jendela] } }),
    db.order.count({ where: { AND: [{ status: { notIn: [...OMSET_EXCLUDED_STATUS] }, penjualanKaryawanId: { not: null } }, jendela] } }),
    db.order.count({ where: { AND: [{ status: { notIn: [...OMSET_EXCLUDED_STATUS] }, penjualanKaryawanId: null, customer: { pipelineStage: "SPAM" } }, jendela] } }),
  ]);
  const nilai = (arr) => arr.reduce((s, o) => s + nilaiBersih(o), 0);
  return {
    tanpaAtribusi: { jumlahOrder: tanpaAtribusi.length, totalNilaiBersih: nilai(tanpaAtribusi) },
    pemilikLuarTim: { jumlahOrder: pemilikLuarTim.length, totalNilaiBersih: nilai(pemilikLuarTim) },
    dibatalkanDikecualikan: dibatalkan,
    menungguDikecualikan: menunggu,
    pkrDikecualikan: pkr,
    spamDikecualikan: spam,
  };
}

/** Respons kartu: kedua metrik + periode WIB + definisi + diagnosa pengecualian. */
export async function ringkasanAov(db, { from, to } = {}) {
  const p = periodeWib(from, to);
  const tim = await muatTim(db);
  const hasil = {};
  for (const metrik of Object.values(METRIK)) {
    const baris = await muatOrderAov(db, { metrik, p, tim });
    const dx = await diagnosa(db, { metrik, p, tim, idTim: new Set(baris.map((r) => r.id)) });
    const r = ringkasBaris(baris);
    // Pembanding seluruh perusahaan (tanpa batas atribusi Tim) = Tim + order tanpa atribusi + order milik akun di luar Tim. Untuk AOV Order Masuk ini SAMA dengan AOV di Dashboard dan
    // Ringkasan Laporan (populasi: dibuat di periode, bukan batal/menunggu/spam, bukan PKR, nilai bersih) — selisih terhadap angka Tim adalah persis dua kelompok itu.
    const jumlahPerusahaan = r.jumlahOrder + dx.tanpaAtribusi.jumlahOrder + dx.pemilikLuarTim.jumlahOrder;
    const nilaiPerusahaan = r.totalNilaiBersih + dx.tanpaAtribusi.totalNilaiBersih + dx.pemilikLuarTim.totalNilaiBersih;
    hasil[metrik] = {
      metrik, ...DEFINISI[metrik], ...r, diagnosa: dx,
      pembandingPerusahaan: {
        keterangan: metrik === METRIK.MASUK ? "Sama dengan AOV di Dashboard dan Ringkasan Laporan (seluruh perusahaan)." : "Seluruh perusahaan, order yang menjadi lunas di periode (belum ada kartu AOV Lunas lain di Dashboard).",
        jumlahOrder: jumlahPerusahaan, totalNilaiBersih: nilaiPerusahaan, aov: jumlahPerusahaan > 0 ? Math.round(nilaiPerusahaan / jumlahPerusahaan) : 0,
        selisihJumlahOrder: jumlahPerusahaan - r.jumlahOrder, selisihNilaiBersih: nilaiPerusahaan - r.totalNilaiBersih,
        penyebabSelisih: "Order tanpa atribusi ke Tim Sales dan order milik akun di luar Tim (mis. Sales yang sudah nonaktif) — lihat `diagnosa`.",
      },
    };
  }
  return {
    periode: { from: p.from, to: p.to, zona: p.zona, label: p.label, semuaWaktu: p.semuaWaktu, mulaiUtc: p.semuaWaktu ? null : p.mulai.toISOString(), selesaiUtcEksklusif: p.semuaWaktu ? null : p.selesai.toISOString() },
    tim: { jumlahAnggota: tim.users.length, anggota: tim.users.map((u) => ({ id: u.id, nama: u.name, teamLead: u.isSalesTeamLead })) },
    catatan: CATATAN_UMUM,
    ...hasil,
  };
}

/** Daftar drilldown satu metrik (halaman dari himpunan YANG SAMA dengan kartu). q mencari nomor order / nama pelanggan / nama Sales. */
export async function daftarOrderAov(db, { metrik, from, to, q, limit, offset } = {}) {
  const lim = limit === undefined || limit === "" ? 50 : Number(limit);
  const off = offset === undefined || offset === "" ? 0 : Number(offset);
  if (!Number.isInteger(lim) || lim < 1 || lim > BATAS_DAFTAR_MAKS) throw Object.assign(new Error(`limit harus bilangan bulat 1–${BATAS_DAFTAR_MAKS}`), { statusCode: 400 });
  if (!Number.isInteger(off) || off < 0) throw Object.assign(new Error("offset harus bilangan bulat ≥ 0"), { statusCode: 400 });
  const p = periodeWib(from, to);
  const tim = await muatTim(db);
  const semua = await muatOrderAov(db, { metrik, p, tim });
  const kata = String(q ?? "").trim().toLowerCase().slice(0, 80);
  const cocok = kata ? semua.filter((r) => [r.orderNumber, r.customerName, r.sales].some((x) => x && String(x).toLowerCase().includes(kata))) : semua;
  const halaman = cocok.slice(off, off + lim);
  return {
    metrik, label: DEFINISI[metrik].label, periode: { from: p.from, to: p.to, zona: p.zona, label: p.label, semuaWaktu: p.semuaWaktu },
    // ringkasan seluruh himpunan (= kartu) DAN himpunan terfilter (bila ada pencarian) — keduanya dari baris yang sama
    ringkasan: ringkasBaris(semua),
    ringkasanTersaring: kata ? ringkasBaris(cocok) : null,
    orders: halaman, total: cocok.length, limit: lim, offset: off, hasMore: off + halaman.length < cocok.length,
  };
}
