// Mesin perhitungan Insentif Driver & Helper — SATU SUMBER KEBENARAN (audit
// insentif, 24 September 2026, slice Snapshot). Diekstrak PERSIS dari logika
// yang sebelumnya inline di GET /armada/incentive-summary (armada.js) —
// TIDAK ADA perubahan rumus/dedup/exclude di ekstraksi ini, cuma dipindah
// supaya endpoint LIVE (armada.js) dan endpoint SNAPSHOT
// (incentiveSnapshot.js) memanggil FUNGSI YANG SAMA, bukan menyalin logika
// dua kali (itulah makna "satu sumber kebenaran" — sama secara harfiah di
// level kode, bukan cuma "rumus yang katanya sama").
//
// Riwayat aturan yang sudah ditutup di sini (lihat commit sebelumnya untuk
// detail lengkap tiap satu):
//   - Batas periode WAJIB lewat startOfDayWIB/startOfMonthWIB/
//     endOfDayExclusiveWIB (utils/wib.js), BUKAN Date.UTC/toDateOnly.
//   - Dedup "alamat" = 1 pelanggan + 1 lokasi (addressText dinormalisasi) +
//     1 tanggal WIB completedAt, TIDAK peduli PICKUP/DELIVERY ATAU berapa
//     order terpisah ke tempat yang sama hari itu (v2, 3 Nov 2026 — v1
//     SEBELUMNYA salah kunci pakai orderId, jadi 1 pelanggan 3 order ke
//     alamat sama hari sama dihitung 3, bukan 1; lihat catatan di
//     alamatKeyDari di bawah).
//   - Exclude: job FAILED/RESCHEDULED (status != COMPLETED tersaring lewat
//     where), redelivery ComplaintCase (complaintCaseId: null), rework
//     UnitRevision (revisionJobLink: null, dari tabel riwayat append-only —
//     BUKAN dari UnitRevision.jobId/revisionLinks yang bisa ditimpa), order
//     CANCELLED, dan staf isFreelance/isExternalCourier.
//   - Tarif per ORANG (User.hasSim), BUKAN per peran — LIVE recompute dari
//     hasSim SAAT QUERY DIJALANKAN (bukan snapshot/dibekukan) — pembekuan
//     nilai HANYA terjadi di lapisan Snapshot, bukan di mesin ini.
import { startOfDayWIB, startOfMonthWIB, endOfDayExclusiveWIB } from "../utils/wib.js";

export const RATE_PER_ALAMAT = { withSim: 7000, withoutSim: 3000 };

// Versi rumus dibekukan ke tiap Snapshot (proteksi #6 di spec) — naikkan
// SETIAP kali aturan dedup/exclude/tarif di file ini berubah secara
// substantif, supaya Snapshot lama tetap bisa ditelusuri balik memakai
// rumus versi berapa saat dibuat, walau kode ini terus berubah.
export const INCENTIVE_FORMULA_VERSION = "v2"; // v1->v2 (3 Nov 2026): dedup "alamat" per pelanggan+lokasi+tanggal (bukan per order+tanggal) — lihat catatan di tanggalWIBdariCompletedAt

export function tanggalWIBdariCompletedAt(completedAt) {
  return new Date(completedAt.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
}

// BUG DIPERBAIKI (audit insentif, 3 Nov 2026 — laporan nyata "1 alamat 3
// order masih dihitung 3"). Kunci dedup SEBELUM ini (`${orderId}|${tgl}`)
// TIDAK PERNAH cocok dengan komentar di atas/di hook driver-mobile
// (useIncentiveSummary.js, keputusan D-162 13 Sep 2026: "1 pelanggan,
// lokasi sama, tanggal sama... dihitung 1") — orderId berbeda SELALU
// menghasilkan baris berbeda walau pelanggan+alamat+tanggalnya SAMA PERSIS,
// jadi pelanggan yang order 3x ke alamat sama hari yang sama dihitung 3
// alamat, bukan 1, sejak file ini dibuat (satu-satunya commit ke file ini,
// satu-satunya logika hitung yang dipakai web admin, Finance Snapshot, DAN
// driver-mobile — sudah ditelusuri, tidak ada hitung ulang terpisah di
// tempat lain).
//
// PENTING: ini HANYA mengubah kunci BILLING (totalAlamat/totalInsentif).
// Granularitas PENYIMPANAN (`detail[]`, satu baris per order+tanggal, yang
// menjadi IncentiveSnapshotDetail + IncentiveSourceClaim di incentiveSnapshot.js)
// SENGAJA TIDAK diubah — itu penjaga anti-bayar-ganda per ORDER (unique
// constraint level database), mengubahnya jadi per-kelompok akan
// melubangi proteksi itu (order lain dalam kelompok yang sama tidak akan
// tercatat "sudah diklaim" sama sekali). `alamatKey` di bawah cuma
// penanda TAMBAHAN di tiap baris detail yang sudah ada, dipakai untuk
// MENGHITUNG distinct count (bukan mengganti struktur baris).
function normalisasiAlamat(addressText) {
  return (addressText || "").trim().toLowerCase().replace(/\s+/g, " ");
}
function alamatKeyDari(j) {
  return `${j.order?.customerId || "?"}|${normalisasiAlamat(j.addressText)}`;
}

// Batas periode WIB dari input {from, to} (string YYYY-MM-DD, opsional) —
// default "bulan ini" kalau `from` tidak dikirim. Dipisah jadi fungsi murni
// (tanpa DB) supaya endpoint preview/create Snapshot bisa memvalidasi &
// menampilkan periode SEBELUM benar-benar query, dan supaya test bisa
// menguji batasnya tanpa fixture database.
export function batasPeriodeWIB({ from, to } = {}) {
  const nowWIB = new Date(Date.now() + 7 * 3600_000);
  const gte = from ? startOfDayWIB(from) : startOfMonthWIB(nowWIB.getUTCFullYear(), nowWIB.getUTCMonth() + 1);
  return {
    gte,
    ...(to && { lt: endOfDayExclusiveWIB(to) }),
    fromLabel: gte.toISOString().slice(0, 10),
    toLabel: to || null,
  };
}

/**
 * Hitung ringkasan insentif untuk satu rentang periode — dipakai LANGSUNG
 * oleh GET /armada/incentive-summary (live) dan oleh alur Snapshot (preview
 * & create, dijalankan di dalam transaksi lewat `db` = klien tx Prisma).
 *
 * @param {import("@prisma/client").PrismaClient | import("@prisma/client").Prisma.TransactionClient} db
 * @param {{from?: string, to?: string}} periode
 * @returns {Promise<{fromLabel: string, toLabel: string|null, ratePerAlamat: object, orang: Array}>}
 */
export async function computeIncentiveSummary(db, { from, to } = {}) {
  const completedAtWhere = batasPeriodeWIB({ from, to });

  const jobs = await db.job.findMany({
    where: {
      status: "COMPLETED",
      completedAt: { gte: completedAtWhere.gte, ...(completedAtWhere.lt && { lt: completedAtWhere.lt }) },
      complaintCaseId: null,
      revisionJobLink: null,
      order: { status: { not: "CANCELLED" } },
    },
    select: {
      id: true, orderId: true, completedAt: true, driverId: true, helperId: true, type: true, addressText: true,
      order: { select: { orderNumber: true, customerId: true, customer: { select: { name: true } } } },
    },
  });

  const perOrang = new Map();
  function baris(userId) {
    let b = perOrang.get(userId);
    if (!b) { b = { asDriverMap: new Map(), asHelperMap: new Map(), allMap: new Map() }; perOrang.set(userId, b); }
    return b;
  }
  // jobIds ditambahkan (24 September 2026, slice Snapshot) — TIDAK ada di
  // versi live sebelumnya karena tidak diperlukan sana, tapi Snapshot WAJIB
  // membekukan "jobIds sumber" per alamat (lihat spec proteksi). Murni
  // aditif, tidak mengubah hasil totalAlamat/totalInsentif sama sekali.
  //
  // `alamatKey` ditambahkan (3 Nov 2026, fix bug di atas) — PENANDA
  // TAMBAHAN di baris yang SUDAH ADA (granularitas order+tanggal tetap
  // sama persis, lihat catatan di atas), dipakai HANYA untuk menghitung
  // distinct count di bawah. Entri PER ORDER tetap satu-satu seperti
  // sebelumnya — ini bukan penggabungan baris.
  function catat(map, key, j, tanggalWIB) {
    let entri = map.get(key);
    if (!entri) {
      entri = {
        orderId: j.orderId, orderNumber: j.order?.orderNumber || "-",
        customerName: j.order?.customer?.name || "Tanpa nama",
        addressText: j.addressText?.trim() || "-", date: tanggalWIB, types: new Set(), jobIds: [],
        alamatKey: alamatKeyDari(j) + "|" + tanggalWIB,
      };
      map.set(key, entri);
    }
    entri.types.add(j.type);
    entri.jobIds.push(j.id);
  }
  for (const j of jobs) {
    const tgl = tanggalWIBdariCompletedAt(j.completedAt);
    const key = `${j.orderId}|${tgl}`;
    if (j.driverId) { const b = baris(j.driverId); catat(b.asDriverMap, key, j, tgl); catat(b.allMap, key, j, tgl); }
    if (j.helperId) { const b = baris(j.helperId); catat(b.asHelperMap, key, j, tgl); catat(b.allMap, key, j, tgl); }
  }

  // asDriver/asHelper PER ENTRI (24 September 2026, slice Snapshot) — beda
  // dari asDriverMap.size/asHelperMap.size (yang cuma HITUNGAN total),
  // Snapshot wajib membekukan PERAN per alamat individual. Dicek lewat
  // keanggotaan key di asDriverMap/asHelperMap milik orang yang sama —
  // murni pembacaan tambahan, tidak mengubah allMap/dedup sama sekali.
  //
  // `satuKelompokDengan` (3 Nov 2026) — berapa ORDER LAIN milik orang yang
  // sama berbagi `alamatKey` (pelanggan+alamat+tanggal) ini; dipakai UI
  // menandai "digabung jadi 1 alamat" tanpa mengubah bentuk baris.
  const ringkasDetail = (b) => {
    const entries = [...b.allMap.values()];
    const jumlahPerKelompok = new Map();
    for (const e of entries) jumlahPerKelompok.set(e.alamatKey, (jumlahPerKelompok.get(e.alamatKey) || 0) + 1);
    return entries
      .map((e) => {
        const key = `${e.orderId}|${e.date}`;
        return {
          ...e, types: [...e.types], asDriver: b.asDriverMap.has(key), asHelper: b.asHelperMap.has(key),
          satuKelompokDengan: jumlahPerKelompok.get(e.alamatKey) - 1,
        };
      })
      .sort((a, c) => c.date.localeCompare(a.date));
  };
  // totalAlamat SEKARANG = jumlah alamatKey DISTINCT (pelanggan+alamat+
  // tanggal), bukan allMap.size (yang = jumlah order+tanggal distinct,
  // bug-nya). 1 pelanggan dengan 3 order ke alamat sama hari yang sama
  // sekarang benar-benar dihitung 1, sesuai komentar/spec di atas.
  const totalAlamatDari = (b) => new Set([...b.allMap.values()].map((e) => e.alamatKey)).size;

  const userIds = [...perOrang.keys()];
  const users = userIds.length
    ? await db.user.findMany({ where: { id: { in: userIds }, isFreelance: false, isExternalCourier: false }, select: { id: true, name: true, avatarUrl: true, hasSim: true } })
    : [];

  const orang = users
    .map((u) => {
      const b = perOrang.get(u.id);
      const totalAlamat = totalAlamatDari(b);
      const ratePerAlamat = u.hasSim ? RATE_PER_ALAMAT.withSim : RATE_PER_ALAMAT.withoutSim;
      return {
        id: u.id, name: u.name, avatarUrl: u.avatarUrl, hasSim: u.hasSim,
        asDriver: b.asDriverMap.size, asHelper: b.asHelperMap.size,
        totalAlamat, ratePerAlamat, totalInsentif: totalAlamat * ratePerAlamat,
        detail: ringkasDetail(b),
      };
    })
    .sort((a, b) => b.totalAlamat - a.totalAlamat);

  return { fromLabel: completedAtWhere.fromLabel, toLabel: completedAtWhere.toLabel, ratePerAlamat: RATE_PER_ALAMAT, orang };
}
