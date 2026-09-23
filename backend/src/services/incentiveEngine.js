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
//   - Dedup kunci (orderId, tanggal WIB completedAt) — 1 pelanggan/lokasi/
//     tanggal sama = 1 alamat, TIDAK peduli PICKUP/DELIVERY terpisah.
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
export const INCENTIVE_FORMULA_VERSION = "v1";

export function tanggalWIBdariCompletedAt(completedAt) {
  return new Date(completedAt.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
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
      order: { select: { orderNumber: true, customer: { select: { name: true } } } },
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
  function catat(map, key, j, tanggalWIB) {
    let entri = map.get(key);
    if (!entri) {
      entri = {
        orderId: j.orderId, orderNumber: j.order?.orderNumber || "-",
        customerName: j.order?.customer?.name || "Tanpa nama",
        addressText: j.addressText?.trim() || "-", date: tanggalWIB, types: new Set(), jobIds: [],
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
  const ringkasDetail = (b) => [...b.allMap.values()]
    .map((e) => {
      const key = `${e.orderId}|${e.date}`;
      return { ...e, types: [...e.types], asDriver: b.asDriverMap.has(key), asHelper: b.asHelperMap.has(key) };
    })
    .sort((a, c) => c.date.localeCompare(a.date));

  const userIds = [...perOrang.keys()];
  const users = userIds.length
    ? await db.user.findMany({ where: { id: { in: userIds }, isFreelance: false, isExternalCourier: false }, select: { id: true, name: true, avatarUrl: true, hasSim: true } })
    : [];

  const orang = users
    .map((u) => {
      const b = perOrang.get(u.id);
      const totalAlamat = b.allMap.size;
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
