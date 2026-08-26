import express from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import {
  startOfDayWIB, endOfDayExclusiveWIB,
  startOfMonthWIB, endOfMonthExclusiveWIB, nowPartsWIB,
  effectiveResponseMinutes,
} from "../utils/wib.js";

// Rata-rata dari array pasangan {inboundAt, outboundAt} pakai
// effectiveResponseMinutes (jam operasional 09-21 WIB) per pasangan, BUKAN
// AVG(EXTRACT(EPOCH...)) mentah di SQL — lihat catatan panjang di
// utils/wib.js soal kenapa (rata-rata mentah digelembungkan pesan malam
// yang baru dibalas paginya). Dipakai di 4 tempat: /sales-report per-sales,
// /performance tim & tren bulanan, /response-time-series.
function avgEffectiveMinutes(pairs) {
  if (!pairs.length) return null;
  const total = pairs.reduce((s, r) => s + effectiveResponseMinutes(r.inboundAt, r.outboundAt), 0);
  return total / pairs.length;
}
import { platformDariDetail, PLATFORM } from "../services/platformIklan.js";
import { pctOrNull } from "../services/conversionMetrics.js";

export const analyticsRouter = express.Router();
analyticsRouter.use(requireAuth);

// Bangun where clause dari query params ?from=YYYY-MM-DD&to=YYYY-MM-DD.
//
// ?from/?to adalah tanggal KALENDER WIB (user memilih "25 Juli" di
// DateRangePicker, maksudnya 25 Juli menurut jam Jakarta). Sebelumnya
// tanggal ini dibaca sebagai UTC ("...T00:00:00.000Z") — akibatnya seluruh
// jendela laporan bergeser 7 jam: order jam 00:00-07:00 WIB terhitung di
// HARI SEBELUMNYA. Sekarang batasnya diturunkan dari WIB (lihat utils/wib.js).
//
// Batas atas EKSKLUSIF (`lt` = awal hari berikutnya), bukan `lte` 23:59:59.999
// — tidak ada celah 1ms di ujung hari.
function buildDateWhere(from, to, field = "createdAt") {
  if (!from || !to) return {};
  return { [field]: { gte: startOfDayWIB(from), lt: endOfDayExclusiveWIB(to) } };
}

// ⚠️ Sebelumnya ada helper grantedSalesUserIds() di sini yang menghitung
// siapa pun DIBERI peran SALES tambahan (multi-role D-010) dan
// memasukkannya ke Laporan Sales / Target Sales. DIHAPUS 22 Agustus 2026:
// terbukti salah untuk kasus nyata — Natasha diberi SEMUA peran (termasuk
// SALES) supaya bisa MENGAKSES data lintas divisi (CLAUDE.md §1), bukan
// karena dia sales performer. Leaderboard sales sekarang HANYA membaca
// `User.role === "SALES"` (peran UTAMA), titik — lihat /sales-report dan
// /sales-performance di bawah. Kalau nanti memang ada admin yang betulan
// berjualan dan perlu ikut dinilai di sini, itu keputusan eksplisit yang
// ditulis langsung di filter masing-masing endpoint, bukan helper generik
// yang diam-diam menganggap "punya akses SALES" = "adalah sales".

// Periode sebelumnya dengan PANJANG SAMA, tepat bersambung sebelum `from`.
// Contoh: 1-30 Juni (30 hari) → periode sebelumnya 2-31 Mei (30 hari).
//
// BUG YANG DIPERBAIKI (26 Agustus 2026): kalau `to` = HARI INI yang belum
// selesai (mis. jam 10 pagi), periode SEKARANG cuma benar-benar berisi data
// 00:00-10:00 (belum ada data masa depan) — tapi dulu dibandingkan ke
// periode sebelumnya PENUH 24 jam. Itu bikin growth% selalu negatif di
// jam-jam awal hari, bukan karena performa turun tapi cuma karena harinya
// belum selesai. Ini persis yang diselesaikan Shopee Seller Center lewat
// comparison window "vs Kemarin pada 00:00-X:00" — dipotong ke elapsed time
// yang SAMA, bukan hari penuh. Sekarang `lt` ikut dipotong proporsional
// (elapsedMs), jadi kedua sisi membandingkan jam yang sama-sama sudah
// berjalan. Untuk periode yang SUDAH SELESAI (mis. "7 hari terakhir" yang
// tidak mencakup hari ini), elapsedMs === panjangMs, jadi `lt` tetap sama
// seperti sebelumnya — tidak ada regresi untuk kasus yang sudah benar.
function buildPrevRange(from, to) {
  if (!from || !to) return null;
  const mulai   = startOfDayWIB(from);
  const selesai = endOfDayExclusiveWIB(to);
  const panjangMs = selesai - mulai;
  const elapsedMs = Math.min(panjangMs, Math.max(0, Date.now() - mulai.getTime()));
  const prevMulai = mulai.getTime() - panjangMs;
  return {
    gte: new Date(prevMulai),
    lt:  new Date(prevMulai + elapsedMs),
  };
}

// Persentase pertumbuhan curr vs prev — SATU sumber kebenaran dipakai
// /overview, /sales-report, /performance (dan endpoint lain nanti), supaya
// aturan null-safety di bawah cuma perlu benar SEKALI.
//
// BUG YANG DIPERBAIKI (26 Jul 2026): dulu `prev === 0 && curr > 0` →
// return 100, jadi UI menampilkan badge "+100%" percaya diri padahal
// periode pembanding KOSONG (sistem baru jalan, belum ada baseline).
// "+100%" itu bukan pertumbuhan — itu pembagian dengan nol. Sekarang
// null = "tidak bisa dihitung", frontend merender "—", BUKAN angka palsu.
function growth(curr, prev) {
  if (prev === null || prev === undefined) return null;
  if (prev === 0) return null;
  return Math.round(((curr - prev) / prev) * 100);
}

analyticsRouter.get("/overview", async (req, res) => {
  try {
    const { from, to } = req.query;
    const orderWhere = buildDateWhere(from, to);
    const convWhere  = buildDateWhere(from, to);
    const custWhere  = buildDateWhere(from, to);
    // Khusus untuk customer-count yang jadi dasar KPI "New Leads"/"Conversion"
    // di Dashboard, DAN leadSourceGroups di bawah (RingkasanTab.jsx "Sumber
    // Lead", sejak 26 Agustus 2026 — sebelumnya field ini punya scope SPAM
    // berbeda dari "New Leads" karena tidak ada UI yang memakainya) —
    // restrukturisasi 25 Agustus 2026: chat junk/salah sasaran
    // (SPAM) tidak boleh ikut membesarkan "New Leads" ataupun jadi penyebut
    // "Conversion", sama alasannya dengan custWhereKonversi di
    // /business-summary. Endpoint ini sebelumnya TERLEWAT saat fix itu
    // dilakukan — ditemukan karena kartu "Conversion" di Dashboard tidak
    // sinkron dengan Laporan.
    const custWhereKonversi = { ...custWhere, pipelineStage: { not: "SPAM" } };
    const prevRange  = buildPrevRange(from, to);

    // Kalau ada date filter, hitung juga periode sebelumnya untuk persentase pertumbuhan
    const [
      totalCustomers, totalCustomersPrev,
      orderAgg, orderAggPrev,
      thisMonthAgg,
      leadSourceGroups,
      monthlyTrafficRaw,
      monthlyRevenueRaw,
      monthlyCustomersRaw,
      channelBreakdownRaw,
      customersWithOrdersCount,
      customersWithOrdersCountPrev,
      repeatCustomersCount,
    ] = await Promise.all([
      prisma.customer.count({ where: custWhereKonversi }),
      prevRange ? prisma.customer.count({ where: { createdAt: prevRange, pipelineStage: { not: "SPAM" } } }) : Promise.resolve(null),

      prisma.order.aggregate({
        where: { ...orderWhere, status: { not: "CANCELLED" } },
        _count: { _all: true },
        _sum: { value: true },
      }),
      prevRange
        ? prisma.order.aggregate({
            where: { createdAt: prevRange, status: { not: "CANCELLED" } },
            _count: { _all: true },
            _sum: { value: true },
          })
        : Promise.resolve(null),

      // thisMonth = range saat ini (atau bulan ini kalau tidak ada filter)
      (from && to)
        ? prisma.order.aggregate({
            where: { ...orderWhere, status: { not: "CANCELLED" } },
            _sum: { value: true },
          })
        : (async () => {
            // "Bulan ini" menurut kalender WIB. setHours(0,0,0,0) yang lama
            // memakai jam container (UTC) → tanggal 1 jam 00:00-07:00 WIB
            // tidak terhitung sebagai bulan berjalan.
            const { year, month } = nowPartsWIB();
            return prisma.order.aggregate({
              where: {
                createdAt: { gte: startOfMonthWIB(year, month) },
                status: { not: "CANCELLED" },
              },
              _sum: { value: true },
            });
          })(),

      // BUG YANG DIPERBAIKI (26 Agustus 2026, sambil memberi field ini
      // konsumen UI PERTAMANYA — RingkasanTab.jsx "Sumber Lead"): dulu pakai
      // `custWhere` (termasuk SPAM), padahal KPI "New Leads" di tab yang SAMA
      // sudah lama pakai `custWhereKonversi` (SPAM dikecualikan). Kalau
      // dibiarkan, jumlah breakdown per sumber tidak akan pernah sama dengan
      // "New Leads" di atasnya — persis kelas bug conversion-rate yang sudah
      // diperbaiki 25 Agustus 2026.
      prisma.customer.groupBy({ by: ["leadSource"], _count: { _all: true }, where: custWhereKonversi }),

      // ⚠️ BUCKET BULANAN WAJIB WIB, BUKAN UTC.
      // Kolom "createdAt" adalah timestamp UTC, jadi date_trunc('month', ...)
      // polos mengelompokkan menurut kalender UTC — order tanggal 1 jam
      // 00:00-07:00 WIB nyasar ke bucket BULAN SEBELUMNYA. Digeser dulu ke
      // wall-clock WIB (`AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jakarta'`)
      // supaya bucket-nya cocok dengan bulan yang dilihat user.
      // Lihat backend/src/utils/wib.js.
      //
      // type = 'INDIVIDUAL' — grup WA internal (Grup Sales/Driver/Produksi)
      // BUKAN lead/customer, tidak boleh ikut hitungan traffic.
      prisma.$queryRaw`
        SELECT to_char(date_trunc('month', "createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jakarta'), 'YYYY-MM') as month,
               COUNT(*)::int as count
        FROM "Conversation"
        WHERE "createdAt" >= NOW() - INTERVAL '6 months'
          AND "type" = 'INDIVIDUAL'
        GROUP BY 1
        ORDER BY 1
      `,

      // Pendapatan bulanan 6 bulan terakhir
      prisma.$queryRaw`
        SELECT to_char(date_trunc('month', "createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jakarta'), 'YYYY-MM') as month,
               COALESCE(SUM(value), 0)::bigint as value
        FROM "Order"
        WHERE status != 'CANCELLED'
          AND "createdAt" >= NOW() - INTERVAL '6 months'
        GROUP BY 1
        ORDER BY 1
      `,

      // Pelanggan baru per bulan 6 bulan terakhir
      prisma.$queryRaw`
        SELECT to_char(date_trunc('month', "createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jakarta'), 'YYYY-MM') as month,
               COUNT(*)::int as count
        FROM "Customer"
        WHERE "createdAt" >= NOW() - INTERVAL '6 months'
        GROUP BY 1
        ORDER BY 1
      `,

      // Channel breakdown percakapan — hanya INDIVIDUAL, grup WA internal
      // bukan lead dan selalu channel WHATSAPP juga (akan skew breakdown).
      prisma.conversation.groupBy({
        by: ["channel"],
        _count: { _all: true },
        where: { ...convWhere, type: "INDIVIDUAL" },
      }),

      // Jumlah pelanggan yang punya minimal 1 order
      prisma.customer.count({
        where: {
          ...custWhereKonversi,
          orders: { some: { status: { not: "CANCELLED" } } },
        },
      }),
      // Padanan periode sebelumnya, dipakai `growthConversion` di bawah —
      // sama pola dengan totalCustomersPrev/orderAggPrev di atas.
      prevRange ? prisma.customer.count({
        where: {
          createdAt: prevRange, pipelineStage: { not: "SPAM" },
          orders: { some: { status: { not: "CANCELLED" } } },
        },
      }) : Promise.resolve(null),

      // Repeat order — lihat catatan sama di /business-summary.
      prisma.customer.count({ where: { ...custWhereKonversi, orderCount: { gte: 2 } } }),
    ]);

    // Conversion rate periode ini vs sebelumnya (dipakai kartu "Conversion"
    // di Dashboard — sebelumnya kartu ini SATU-SATUNYA dari 4 KPI yang tidak
    // punya angka pertumbuhan sama sekali, cuma teks statis "X dari Y").
    const conversionRateCurr = pctOrNull(customersWithOrdersCount, totalCustomers);
    const conversionRatePrev = pctOrNull(customersWithOrdersCountPrev, totalCustomersPrev);

    res.json({
      // Pelanggan
      newCustomers: totalCustomers,
      totalCustomers,
      growthCustomers: growth(totalCustomers, totalCustomersPrev),
      customersWithOrders: customersWithOrdersCount,
      growthConversion: growth(conversionRateCurr, conversionRatePrev),
      repeatCustomers: repeatCustomersCount,
      // Dari pelanggan yang pernah order, berapa persen order LAGI.
      repeatRate: pctOrNull(repeatCustomersCount, customersWithOrdersCount),

      // Order
      totalOrders: orderAgg._count._all,
      growthOrders: growth(orderAgg._count._all, orderAggPrev?._count._all ?? null),
      totalOrderValue: orderAgg._sum.value || 0,
      growthOrderValue: growth(orderAgg._sum.value || 0, orderAggPrev?._sum.value || null),
      thisMonthValue: thisMonthAgg._sum.value || 0,

      // Breakdown
      leadSourceBreakdown: leadSourceGroups.map((g) => ({
        leadSource: g.leadSource || "OTHER",
        count: g._count._all,
      })),
      channelBreakdown: channelBreakdownRaw.map((g) => ({
        channel: g.channel,
        count: g._count._all,
      })),

      // Tren bulanan
      monthlyRevenue: monthlyRevenueRaw.map((r) => ({ month: r.month, value: Number(r.value) })),
      monthlyCustomers: monthlyCustomersRaw.map((r) => ({ month: r.month, count: Number(r.count) })),
      monthlyTraffic: monthlyTrafficRaw,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ═══ DERET WAKTU ADAPTIF — HELPER BERSAMA ═════════════════════════════════
// Dipakai /revenue-series, /business-summary, /response-time-series supaya
// granularitas & pengisian bucket kosong TIDAK diimplementasikan ulang
// (dan tidak bisa saling drift) di tiap endpoint.
//
// Granularitas 3 tingkat: rentang 1 HARI → per JAM (26 Agustus 2026,
// permintaan owner — gaya dashboard marketplace seperti Shopee Seller
// Center: pilih "Hari Ini" menunjukkan 24 titik per jam, bukan 1 titik
// harian yang tidak menyampaikan apa pun untuk rentang sesingkat itu).
// <= 92 hari → HARIAN. Lebih panjang → BULANAN (30 hari dalam bucket
// bulanan = 1 titik, grafik tampak kosong — bug yang sudah pernah
// terjadi di kartu Sales Overview; 1 tahun harian = 365 titik yang
// tidak terbaca di kartu selebar itu).
function seriesWindow(from, to) {
  const sekarang = nowPartsWIB();
  const mulai   = from ? startOfDayWIB(from) : startOfMonthWIB(sekarang.year, sekarang.month);
  let   selesai = to   ? endOfDayExclusiveWIB(to) : new Date();
  const totalHari = Math.max(1, Math.round((selesai - mulai) / 86_400_000));
  const granularity = totalHari <= 1 ? "hour" : totalHari <= 92 ? "day" : "month";
  // "Hari Ini" (to = hari ini) — `selesai` dari endOfDayExclusiveWIB() adalah
  // BATAS HARI PENUH (besok jam 00:00), padahal jam-jam yang belum terjadi
  // belum ada datanya sama sekali. Dipotong sampai SEKARANG supaya grafik
  // per-jam berhenti di jam saat ini (persis seperti Shopee) — bukan garis
  // yang "anjlok ke 0" di jam-jam yang belum berjalan.
  const now = new Date();
  if (granularity === "hour" && selesai > now) selesai = now;
  return { mulai, selesai, granularity };
}

// Nama bucket WIB dari sebuah instant UTC. `mulai` hasil startOfDayWIB()
// adalah instant UTC (mis. 1 Jul WIB = 30 Jun 17:00Z) — jadi getUTCMonth()
// LANGSUNG atas instant itu mengembalikan JUNI, bukan Juli. Pergeseran +7 jam
// di sini yang membuat nama bucket cocok dengan hasil
// `date_trunc(... AT TIME ZONE 'Asia/Jakarta')` di SQL.
function namaBucketWIB(instant, granularity) {
  const wib = new Date(instant.getTime() + 7 * 3600_000);
  const iso = wib.toISOString();
  if (granularity === "hour") return iso.slice(0, 13); // "YYYY-MM-DDTHH"
  if (granularity === "day")  return iso.slice(0, 10); // "YYYY-MM-DD"
  return iso.slice(0, 7);                              // "YYYY-MM"
}

// Bangun deret LENGKAP termasuk bucket bernilai 0. Bucket kosong WAJIB diisi:
// kalau jam/hari tanpa transaksi dilewati, garis grafik "melompat" dan
// terbaca seolah penjualan berjalan kontinu.
function fillBuckets({ mulai, selesai, granularity }, map) {
  const points = [];
  if (granularity === "hour") {
    for (let t = mulai.getTime(); t < selesai.getTime(); t += 3_600_000) {
      const b = namaBucketWIB(new Date(t), "hour");
      points.push({ bucket: b, value: map[b] || 0 });
    }
  } else if (granularity === "day") {
    for (let t = mulai.getTime(); t < selesai.getTime(); t += 86_400_000) {
      const b = namaBucketWIB(new Date(t), "day");
      points.push({ bucket: b, value: map[b] || 0 });
    }
  } else {
    const awal  = namaBucketWIB(mulai, "month");
    const akhir = namaBucketWIB(new Date(selesai.getTime() - 1), "month");
    let [y, m] = awal.split("-").map(Number);
    const [ay, am] = akhir.split("-").map(Number);
    while (y < ay || (y === ay && m <= am)) {
      const b = `${y}-${String(m).padStart(2, "0")}`;
      points.push({ bucket: b, value: map[b] || 0 });
      m++; if (m > 12) { m = 1; y++; }
    }
  }
  return points;
}

// ── GET /analytics/business-summary?from=&to= ──────────────────────────────
// RINGKASAN EKSEKUTIF untuk owner: satu request yang menjawab "bagaimana
// kondisi bisnis pada periode ini" tanpa harus pindah-pindah tab.
//
// KENAPA ENDPOINT BARU, bukan menambah /overview: /overview dipakai Dashboard
// (dipanggil tiap buka halaman) dan sudah berat. Metrik di bawah ini hanya
// dibutuhkan halaman Laporan.
//
// SEMUA metrik di sini menghormati ?from/?to. Ini penting: deret bulanan di
// /overview justru MENGABAIKAN rentang (hardcode 6 bulan terakhir), sehingga
// grafik lama bertentangan dengan header "Periode: ..." di halaman yang sama.
//
// Uang: `grossValue` = nilai order masuk (booked, CANCELLED dikecualikan).
// `collectedValue` = yang benar-benar LUNAS (Order.paymentStatus). Dua angka
// ini SENGAJA dipisah — order Rp10jt yang belum dibayar bukan uang di tangan,
// dan owner perlu melihat selisihnya (piutang) secara eksplisit.
analyticsRouter.get("/business-summary", async (req, res) => {
  try {
    const { from, to } = req.query;
    const custWhere  = buildDateWhere(from, to);
    // Khusus untuk blok `konversi` di bawah (bukan cityGroups/leadSource dst
    // yang tetap pakai custWhere biasa) — restrukturisasi 24 Agustus 2026:
    // chat junk/salah sasaran yang ditandai SPAM tidak boleh ikut membesarkan
    // penyebut totalCustomers, sama alasannya dengan fix `mine` di
    // /sales-report. Sebelumnya blok ini TIDAK mengecualikan SPAM sama
    // sekali (beda dari /sales-report yang sudah benar) — inkonsistensi yang
    // diperbaiki di sini.
    const custWhereKonversi = { ...custWhere, pipelineStage: { not: "SPAM" } };
    const orderWhere = { ...buildDateWhere(from, to), status: { not: "CANCELLED" } };
    const win = seriesWindow(from, to);

    const [
      orderAgg, lunasAgg, dpAgg,
      statusGroups, categoryGroups,
      cityGroups, complaintCount,
      paidCustomers, totalCustomers, customersWithOrders, repeatCustomers, paidTanpaOrder,
      revenueRaw, customerRaw, outstandingOrders,
    ] = await Promise.all([
      prisma.order.aggregate({ where: orderWhere, _count: { _all: true }, _sum: { value: true }, _avg: { value: true } }),
      prisma.order.aggregate({ where: { ...orderWhere, paymentStatus: "LUNAS" }, _count: { _all: true }, _sum: { value: true } }),
      prisma.order.aggregate({ where: { ...orderWhere, paymentStatus: "DP" }, _count: { _all: true }, _sum: { value: true } }),

      prisma.order.groupBy({ by: ["status"], where: buildDateWhere(from, to), _count: { _all: true }, _sum: { value: true } }),
      prisma.order.groupBy({ by: ["category"], where: orderWhere, _count: { _all: true }, _sum: { value: true } }),

      prisma.customer.groupBy({ by: ["city"], where: custWhere, _count: { _all: true } }),
      prisma.order.count({ where: { ...buildDateWhere(from, to), hasComplaint: true } }),

      // IN [TRANSACTION, REVIEWED] — REVIEWED (dikembalikan 26 Agustus 2026)
      // adalah customer yang SUDAH lewat TRANSACTION dan lanjut kasih review
      // publik, jadi tetap "paid customer" — hanya posisinya sudah bergerak
      // maju, bukan lagi customer yang belum bayar.
      prisma.customer.count({ where: { ...custWhere, pipelineStage: { in: ["TRANSACTION", "REVIEWED"] } } }),
      prisma.customer.count({ where: custWhereKonversi }),
      prisma.customer.count({ where: { ...custWhereKonversi, orders: { some: { status: { not: "CANCELLED" } } } } }),
      // Repeat order — customer dengan >=2 order (CANCELLED sudah
      // dikecualikan di kolom denormalized ini, lihat customerOrderAggregate.js,
      // konsisten dengan customersWithOrders di atas). Indikator loyalitas:
      // AOV/Total Revenue bisa naik cuma karena lebih banyak pelanggan BARU,
      // padahal yang lebih murah didapat & lebih menandakan puas adalah
      // pelanggan LAMA yang balik order lagi.
      prisma.customer.count({ where: { ...custWhereKonversi, orderCount: { gte: 2 } } }),

      // PEMERIKSAAN INTEGRITAS: customer ditandai TRANSACTION/REVIEWED (pesan
      // sudah dipastikan order, atau malah sudah lanjut kasih review) TAPI
      // tidak punya satu pun order. Ini mustahil secara bisnis — kalau order
      // sudah dipastikan, harus ada order yang tercatat. Penyebabnya stage
      // digeser manual di Kanban tanpa membuat order, jadi PENDAPATANNYA
      // TIDAK PERNAH TERCATAT. Ini yang membuat angka seperti "1 pelanggan
      // bayar tapi Rp0" muncul di Laporan Sales — bukan salah hitung, tapi
      // data yang memang tidak lengkap. TIDAK difilter tanggal: ini utang
      // data yang harus dibereskan, kapan pun terjadinya.
      prisma.customer.count({
        where: {
          pipelineStage: { in: ["TRANSACTION", "REVIEWED"] },
          NOT: { orders: { some: { status: { not: "CANCELLED" } } } },
        },
      }),

      // Deret pendapatan & pelanggan baru — granularitas mengikuti panjang
      // rentang (lihat seriesWindow): 1 hari = per JAM, <=92 hari = HARIAN,
      // lebih panjang = BULANAN.
      win.granularity === "hour"
        ? prisma.$queryRaw`
            SELECT to_char(date_trunc('hour', "createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jakarta'), 'YYYY-MM-DD"T"HH24') AS bucket,
                   COALESCE(SUM(value), 0)::bigint AS value
            FROM "Order" WHERE status != 'CANCELLED'
              AND "createdAt" >= ${win.mulai} AND "createdAt" < ${win.selesai}
            GROUP BY 1 ORDER BY 1`
      : win.granularity === "day"
        ? prisma.$queryRaw`
            SELECT to_char(date_trunc('day', "createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jakarta'), 'YYYY-MM-DD') AS bucket,
                   COALESCE(SUM(value), 0)::bigint AS value
            FROM "Order" WHERE status != 'CANCELLED'
              AND "createdAt" >= ${win.mulai} AND "createdAt" < ${win.selesai}
            GROUP BY 1 ORDER BY 1`
        : prisma.$queryRaw`
            SELECT to_char(date_trunc('month', "createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jakarta'), 'YYYY-MM') AS bucket,
                   COALESCE(SUM(value), 0)::bigint AS value
            FROM "Order" WHERE status != 'CANCELLED'
              AND "createdAt" >= ${win.mulai} AND "createdAt" < ${win.selesai}
            GROUP BY 1 ORDER BY 1`,

      win.granularity === "hour"
        ? prisma.$queryRaw`
            SELECT to_char(date_trunc('hour', "createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jakarta'), 'YYYY-MM-DD"T"HH24') AS bucket,
                   COUNT(*)::int AS value
            FROM "Customer"
            WHERE "createdAt" >= ${win.mulai} AND "createdAt" < ${win.selesai}
            GROUP BY 1 ORDER BY 1`
      : win.granularity === "day"
        ? prisma.$queryRaw`
            SELECT to_char(date_trunc('day', "createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jakarta'), 'YYYY-MM-DD') AS bucket,
                   COUNT(*)::int AS value
            FROM "Customer"
            WHERE "createdAt" >= ${win.mulai} AND "createdAt" < ${win.selesai}
            GROUP BY 1 ORDER BY 1`
        : prisma.$queryRaw`
            SELECT to_char(date_trunc('month', "createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jakarta'), 'YYYY-MM') AS bucket,
                   COUNT(*)::int AS value
            FROM "Customer"
            WHERE "createdAt" >= ${win.mulai} AND "createdAt" < ${win.selesai}
            GROUP BY 1 ORDER BY 1`,

      // Aging piutang — order yang belum LUNAS, dikelompokkan berdasarkan
      // SEBERAPA LAMA sudah menunggak (dari createdAt sampai SEKARANG, bukan
      // dari kapan order dibuat relatif ke rentang tanggal laporan — piutang
      // yang sudah 40 hari menunggak tetap "40 hari" apa pun periode yang
      // sedang dilihat). Diambil mentah (bukan groupBy DB) dan di-bucket di
      // JS karena bucket-nya berbasis usia relatif ke NOW(), bukan kolom
      // tetap yang bisa di-GROUP BY langsung.
      prisma.order.findMany({
        where: { ...orderWhere, paymentStatus: { not: "LUNAS" } },
        select: { value: true, createdAt: true },
      }),
    ]);

    const gross     = orderAgg._sum.value || 0;
    const collected = lunasAgg._sum.value || 0;
    const totalOrders = orderAgg._count._all;

    // Bucket: <7 hari / 7-30 hari / >30 hari sejak order dibuat. Piutang
    // yang makin lama menunggak makin butuh ditindaklanjuti — angka gabungan
    // `outstandingValue` tidak bisa membedakan "baru kemarin, wajar belum
    // dibayar" dari "sudah sebulan, ini masalah".
    const agingNow = Date.now();
    const aging = { under7: { count: 0, value: 0 }, d7to30: { count: 0, value: 0 }, over30: { count: 0, value: 0 } };
    for (const o of outstandingOrders) {
      const umurHari = (agingNow - new Date(o.createdAt).getTime()) / 86_400_000;
      const bucket = umurHari < 7 ? aging.under7 : umurHari < 30 ? aging.d7to30 : aging.over30;
      bucket.count += 1;
      bucket.value += o.value || 0;
    }

    res.json({
      granularity: win.granularity,

      uang: {
        grossValue: gross,
        collectedValue: collected,
        dpValue: dpAgg._sum.value || 0,
        // Piutang = sudah di-order, belum lunas. Angka ini yang biasanya
        // hilang dari laporan padahal paling dicari owner.
        outstandingValue: gross - collected,
        collectedRate: gross > 0 ? Math.round((collected / gross) * 100) : null,
        // Rincian umur piutang — lihat catatan bucket di atas.
        outstandingAging: [
          { label: "<7 hari",   count: aging.under7.count, value: aging.under7.value },
          { label: "7-30 hari", count: aging.d7to30.count, value: aging.d7to30.value },
          { label: ">30 hari",  count: aging.over30.count, value: aging.over30.value },
        ],
        totalOrders,
        // AOV — nilai rata-rata per order. Naik/turunnya AOV menjelaskan
        // perubahan revenue yang tidak terjelaskan oleh jumlah order.
        aov: totalOrders > 0 ? Math.round(gross / totalOrders) : 0,
      },

      // Konversi NYATA (bukan "percakapan selesai / total" yang dulu
      // dilabeli "Closing Rate" dan menyesatkan — itu metrik kebersihan
      // inbox, bukan penjualan).
      konversi: {
        totalCustomers,
        paidCustomers,
        customersWithOrders,
        repeatCustomers,
        // totalCustomers/customersWithOrders/repeatCustomers di atas sudah
        // mengecualikan SPAM (custWhereKonversi) — chat junk/salah sasaran
        // tidak boleh ikut membesarkan penyebut, konsisten dengan
        // /sales-report.
        paidRate:   pctOrNull(paidCustomers, totalCustomers),
        orderRate:  pctOrNull(customersWithOrders, totalCustomers),
        // Dari pelanggan yang PERNAH order, berapa persen order LAGI —
        // penyebutnya customersWithOrders (bukan totalCustomers), karena
        // yang belum pernah order sama sekali tidak relevan untuk "repeat".
        repeatRate: pctOrNull(repeatCustomers, customersWithOrders),
      },

      // Beban produksi per status order — ini antrean kerja tim, bukan
      // sekadar statistik. CANCELLED ikut supaya totalnya jujur.
      orderStatus: statusGroups.map((g) => ({
        status: g.status, count: g._count._all, value: g._sum.value || 0,
      })),

      revenueByCategory: categoryGroups.map((g) => ({
        category: g.category, count: g._count._all, value: g._sum.value || 0,
      })),

      topCities: cityGroups
        .map((g) => ({ city: g.city || "Belum diisi", count: g._count._all }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8),

      komplain: {
        count: complaintCount,
        rate: totalOrders > 0 ? Math.round((complaintCount / totalOrders) * 1000) / 10 : null,
      },

      // Masalah data yang HARUS kelihatan, bukan disembunyikan — laporan tidak
      // bisa "100% akurat" kalau sumber datanya sendiri tidak konsisten; yang
      // bisa dilakukan sistem adalah mendeteksi & menunjukkannya.
      integritas: {
        paidTanpaOrder,
      },

      revenueSeries:  fillBuckets(win, Object.fromEntries(revenueRaw.map((r) => [r.bucket, Number(r.value)]))),
      customerSeries: fillBuckets(win, Object.fromEntries(customerRaw.map((r) => [r.bucket, Number(r.value)]))),
    });
  } catch (err) {
    console.error("business-summary error:", err);
    res.status(500).json({ error: "Gagal memuat ringkasan bisnis" });
  }
});

// ── GET /analytics/sales-report?from=&to= ──────────────────────────────────
// LAPORAN SALES mendalam — pengganti tabel "Performa CS" yang lama (yang cuma
// 4 kolom: percakapan, closing rate, avg response, nilai order).
//
// ⚠️ ATRIBUSI (keputusan bisnis, jangan diubah tanpa diskusi): seluruh metrik
// di sini memakai `Conversation.assignedToId` — "percakapan yang SAYA pegang".
// BUKAN `Customer.assignedSalesId` (kepemilikan lead di CRM). Dua field ini
// bisa TIDAK SINKRON, dan mencampurnya di satu tabel membuat conversion rate
// tidak bisa dibaca (pembilang dan penyebut dari populasi berbeda).
// Konsekuensi yang harus disadari: order dari customer yang percakapannya
// dipegang sales lain TIDAK masuk ke angka orang ini.
//
// "Dibalas" = ada MINIMAL SATU pesan OUTBOUND di percakapan itu. Ini yang
// membedakan sales yang benar-benar merespons dari yang cuma "kebagian"
// percakapan — masalah nyata yang jadi alasan fitur takeover dibuat.
//
// REVISI 4 Agustus 2026 — `assignedToId` BERPINDAH TANGAN saat "Ambil"/
// "Ambil Alih" dipakai (lihat routes/conversations.js), jadi memakainya
// mentah-mentah untuk `handled` ("Beban Percakapan") menghitung riwayat
// percakapan orang lain yang diwarisi lewat takeover sebagai milik penuh
// pengambil-alih — sales yang rajin membersihkan chat mangkrak (biasanya
// lead dingin yang sudah gagal duluan) tampak PALING SIBUK dan PALING
// RENDAH closing rate-nya, padahal itu bukan performa dia. Sekarang
// dipecah: `handled` tetap "beban SEKARANG" (dipakai untuk operasional/
// antrean), `handledOwn` = bagian yang dia pegang sejak klaim pertama
// (dipakai untuk menilai performa), `handledTakeover` = sisanya (warisan).
// Lihat query HandoverEvent di bawah. Metrik waktu respons pertama juga
// dipindah dari `assignedToId` ke `Conversation.firstResponderId`
// (immutable, tidak ikut berpindah saat takeover) supaya kecepatan
// membalas tetap menempel ke orang yang benar-benar mengetik balasannya.
// Dipisah jadi fungsi (25 Agustus 2026, sebelumnya inline di dalam
// users.map()) supaya bisa dipanggil ULANG untuk baris "Team Lead" (Novi)
// tanpa duplikasi blok query yang panjang ini. Perhitungan PERSIS SAMA untuk
// sales biasa maupun team lead — bedanya cuma siapa `u` yang dikirim &
// bagaimana hasilnya dipakai di caller (team lead TIDAK ikut masuk ke Total
// Tim, lihat /sales-report di bawah).
async function computeSalesRow(u, ctx) {
  const { convWhere, mulai, selesai, from, to, adaDataTransisi, targetMap } = ctx;
  // DUA lingkup yang HARUS dibedakan — inilah sumber bug yang diperbaiki:
  //
  // `mine`        = percakapan yang DIBUAT dalam rentang → untuk metrik
  //                 AKTIVITAS periode (ditangani, dibalas, respons, SLA).
  // `mineAtribusi`= percakapan KAPAN SAJA → untuk MENGHUBUNGKAN order ke
  //                 sales. Order hari ini bisa datang dari lead bulan lalu;
  //                 kalau tautannya ikut difilter tanggal, order itu tidak
  //                 teratribusi ke siapa pun dan kolom Nilai jadi Rp0
  //                 padahal perusahaan jelas ada penjualan. Itu yang
  //                 terjadi sebelum perbaikan ini (dan yang membuat
  //                 "7 percakapan · Rp0 · 14.3% konversi" tampak aneh).
  // `mine` DIKECUALIKAN dari pipelineStage SPAM (restrukturisasi 24
  // Agustus 2026) — inilah fix untuk masalah "closing rate tercemar chat
  // junk": `mine` adalah penyebut conversionRate & orderConversionRate
  // (lewat `handled` di bawah), jadi chat 1-2x balas/salah sasaran yang
  // sudah ditandai SPAM tidak lagi ikut membesarkan penyebut & menekan
  // persentase closing sales yang sebenarnya bagus.
  const mine = { ...convWhere, assignedToId: u.id, customer: { pipelineStage: { not: "SPAM" } } };
  const mineAtribusi = { type: "INDIVIDUAL", assignedToId: u.id };

  const [
    handled, replied, resolved, stalledRaw,
    stageGroups, orderAgg, lunasAgg, complaintCount, respRaw, slaBreach,
    neverReplied, paidRaw, orderingCustomers, takeoverRaw, spamCount,
  ] = await Promise.all([
    prisma.conversation.count({ where: mine }),
    // Dibalas = ada >=1 OUTBOUND. `some` di relasi messages.
    //
    // CATATAN JUJUR soal metrik ini: di data nyata replyRate hampir SELALU
    // 100%, karena `assignedToId` justru terisi PADA SAAT sales membalas.
    // Jadi angka ini berguna sebagai pemeriksaan kewarasan (kalau <100%
    // berarti ada percakapan diklaim tapi tidak pernah dibalas), BUKAN
    // sebagai pembeda performa. Yang benar-benar membedakan adalah
    // `stalled` di bawah — pola "dibalas sekali lalu hilang" yang jadi
    // alasan fitur takeover dibuat (lihat CLAUDE.md §7C poin 4).
    prisma.conversation.count({ where: { ...mine, messages: { some: { direction: "OUTBOUND" } } } }),
    prisma.conversation.count({ where: { ...mine, status: "RESOLVED" } }),

    // MENGGANTUNG dalam rentang: percakapan yang dia pegang (dibuat dalam
    // rentang), pesan TERAKHIR dari customer, >60 menit tanpa balasan.
    // Sengaja DIBATASI rentang supaya ikut berubah saat tanggal diganti —
    // sebelumnya query ini tanpa filter tanggal, sehingga baris "0
    // percakapan · 8 menggantung" bisa muncul (angka dari sepanjang waktu
    // ditempel di sebelah angka periode). Angka "sekarang, lintas periode"
    // tetap dilaporkan terpisah sebagai `stalledNow` di total tim.
    prisma.$queryRaw`
      SELECT COUNT(*)::int AS n
      FROM "Conversation" c
      JOIN (
        SELECT DISTINCT ON ("conversationId") "conversationId", direction, "createdAt"
        FROM "Message" ORDER BY "conversationId", "createdAt" DESC
      ) m ON m."conversationId" = c.id
      WHERE c."assignedToId" = ${u.id} AND c."type" = 'INDIVIDUAL'
        AND c.status != 'RESOLVED'
        AND c."createdAt" >= ${mulai} AND c."createdAt" < ${selesai}
        AND m.direction = 'INBOUND'
        AND m."createdAt" < NOW() - INTERVAL '60 minutes'`,

    // Sebaran stage — POSISI SAAT INI dari seluruh customer yang
    // percakapannya dia pegang (TIDAK difilter tanggal: "stage sekarang"
    // adalah keadaan, bukan kejadian di dalam periode). Dilabeli jelas di UI supaya
    // tidak dibaca sebagai kejadian dalam periode.
    prisma.customer.groupBy({
      by: ["pipelineStage"],
      where: { conversations: { some: mineAtribusi } },
      _count: { _all: true },
    }),

    // Order dalam rentang, TAUTAN sales tidak difilter tanggal (lihat
    // catatan `mineAtribusi`).
    prisma.order.aggregate({
      where: {
        ...buildDateWhere(from, to), status: { not: "CANCELLED" },
        customer: { conversations: { some: mineAtribusi } },
      },
      _count: { _all: true }, _sum: { value: true },
    }),
    prisma.order.aggregate({
      where: {
        ...buildDateWhere(from, to), status: { not: "CANCELLED" }, paymentStatus: "LUNAS",
        customer: { conversations: { some: mineAtribusi } },
      },
      _sum: { value: true },
    }),
    prisma.order.count({
      where: {
        ...buildDateWhere(from, to), hasComplaint: true,
        customer: { conversations: { some: mineAtribusi } },
      },
    }),

    // Waktu respons PERTAMA per percakapan (inbound pertama → outbound
    // pertama), DIBATASI percakapan yang dibuat dalam rentang.
    //
    // ATRIBUSI DIPERBAIKI: JOIN memakai `c."firstResponderId"` (siapa
    // yang SUNGGUHAN mengirim balasan pertama, diset SEKALI dan tidak
    // pernah berubah — lihat model Conversation di schema.prisma), BUKAN
    // `c."assignedToId"` (bisa berpindah tangan lewat "Ambil Alih").
    // Sebelumnya field ini dipakai, jadi kalau sales A membalas cepat
    // lalu percakapan di-takeover sales B (mis. lanjut chat basa-basi
    // berbulan-bulan kemudian), waktu respons A yang sebenarnya cepat
    // malah tercatat sebagai milik B — mencemari rata-rata B dengan
    // performa orang lain.
    // Ambil PASANGAN mentah (bukan AVG di SQL) — rata-ratanya dihitung di JS
    // via effectiveResponseMinutes (jam operasional 09-21 WIB), lihat
    // avgEffectiveMinutes() & catatan panjang di utils/wib.js.
    //
    // ATRIBUSI DIPERBAIKI LAGI (25 Agustus 2026) — kasus nyata yang
    // ditemukan owner: lead masuk jam 09:20 TANPA ada yang pegang, baru
    // diambil sales jam 10:00 lalu LANGSUNG dibalas. Sebelum ini, jeda
    // 40 menit "menganggur di antrean" itu ikut kehitung sebagai waktu
    // respons SALES yang mengambilnya — menghukum orang yang justru
    // menyelamatkan lead terbengkalai, padahal 40 menit itu salah TIM
    // (tidak ada yang ambil), bukan salah dia. `inboundAt` sekarang
    // di-clamp ke waktu dia BENAR-BENAR memegang percakapan itu (klaim
    // pertama TANPA fromUserId, atau ambil alih — HandoverEvent
    // toUserId=dia, SEBELUM/pas balasan pertamanya), kalau itu LEBIH
    // BARU dari pesan masuknya. Kalau dia sudah pegang dari awal (tidak
    // ada jeda antrean), tidak ada bedanya dengan sebelumnya.
    //
    // SENGAJA cuma di sini (metrik PER-SALES) — bukan di /performance
    // (tim) atau /response-time-series, yang tetap harus menjawab
    // "berapa lama CUSTOMER menunggu balasan apa pun", bukan "salah
    // siapa". Jeda antrean tetap kelihatan lewat unassignedInPeriod.
    //
    // KOREKSI (25 Agustus 2026, sore) — fix di atas TIDAK BERFUNGSI untuk
    // sebagian besar kasus nyata: klaim lewat "langsung ketik balasan ke
    // lead belum ber-pemilik" (routes/conversations.js, auto-assign saat
    // kirim pesan) TIDAK PERNAH mencatat HandoverEvent — cuma klik tombol
    // "Ambil Percakapan" eksplisit yang tercatat, dan hampir semua sales
    // memakai jalur pertama (diverifikasi: hanya 2 HandoverEvent cocok di
    // seluruh Agustus 2026 utk kolom ini). Sekarang conversations.js JUGA
    // mencatat HandoverEvent (reason:"auto-claim", createdAt disamakan
    // dgn pesan balasannya) di jalur auto-assign itu, jadi query di sini
    // akhirnya bertemu klaim yang dicari — clamp di atas efektif berlaku
    // untuk KEDUA jalur klaim, bukan cuma yang jarang dipakai.
    prisma.$queryRaw`
      SELECT
        CASE WHEN claim."createdAt" IS NOT NULL AND claim."createdAt" > i."createdAt"
             THEN claim."createdAt" ELSE i."createdAt" END AS "inboundAt",
        o."createdAt" AS "outboundAt"
      FROM (
        SELECT m."conversationId", MIN(m."createdAt") AS "createdAt"
        FROM "Message" m JOIN "Conversation" c ON c.id = m."conversationId"
        WHERE m.direction = 'INBOUND' AND c."firstResponderId" = ${u.id} AND c."type" = 'INDIVIDUAL'
          AND c."createdAt" >= ${mulai} AND c."createdAt" < ${selesai}
        GROUP BY 1
      ) i
      JOIN (
        SELECT m."conversationId", MIN(m."createdAt") AS "createdAt"
        FROM "Message" m JOIN "Conversation" c ON c.id = m."conversationId"
        WHERE m.direction = 'OUTBOUND' AND c."firstResponderId" = ${u.id} AND c."type" = 'INDIVIDUAL'
          AND c."createdAt" >= ${mulai} AND c."createdAt" < ${selesai}
        GROUP BY 1
      ) o ON i."conversationId" = o."conversationId"
      LEFT JOIN LATERAL (
        SELECT he."createdAt"
        FROM "HandoverEvent" he
        WHERE he."conversationId" = i."conversationId" AND he."toUserId" = ${u.id}
          AND he."createdAt" <= o."createdAt"
        ORDER BY he."createdAt" DESC
        LIMIT 1
      ) claim ON true
      WHERE o."createdAt" > i."createdAt"`,

    // SLA breach = percakapan (dibuat dalam rentang) yang respons
    // pertamanya > 60 menit. Ambang 60 menit mengikuti aturan takeover
    // yang sudah dipakai di Inbox. Sama seperti di atas, dihitung dari
    // `firstResponderId` — siapa yang benar-benar terlambat membalas.
    //
    // Pakai clamp klaim yang SAMA dengan `respRaw` di atas (LEFT JOIN
    // LATERAL ke HandoverEvent) — tanpa ini, sales yang MENYELAMATKAN lead
    // terbengkalai (antre lama sebelum diklaim) malah kena tanda "SLA
    // terlanggar" untuk keterlambatan yang bukan salahnya. Lihat catatan
    // panjang di `respRaw`.
    prisma.$queryRaw`
      SELECT COUNT(*)::int AS n FROM (
        SELECT i."conversationId"
        FROM (
          SELECT m."conversationId", MIN(m."createdAt") AS "createdAt"
          FROM "Message" m JOIN "Conversation" c ON c.id = m."conversationId"
          WHERE m.direction = 'INBOUND' AND c."firstResponderId" = ${u.id} AND c."type" = 'INDIVIDUAL'
            AND c."createdAt" >= ${mulai} AND c."createdAt" < ${selesai}
          GROUP BY 1
        ) i
        JOIN (
          SELECT m."conversationId", MIN(m."createdAt") AS "createdAt"
          FROM "Message" m JOIN "Conversation" c ON c.id = m."conversationId"
          WHERE m.direction = 'OUTBOUND' AND c."firstResponderId" = ${u.id} AND c."type" = 'INDIVIDUAL'
            AND c."createdAt" >= ${mulai} AND c."createdAt" < ${selesai}
          GROUP BY 1
        ) o ON i."conversationId" = o."conversationId"
        LEFT JOIN LATERAL (
          SELECT he."createdAt"
          FROM "HandoverEvent" he
          WHERE he."conversationId" = i."conversationId" AND he."toUserId" = ${u.id}
            AND he."createdAt" <= o."createdAt"
          ORDER BY he."createdAt" DESC
          LIMIT 1
        ) claim ON true
        WHERE o."createdAt" > i."createdAt"
          AND EXTRACT(EPOCH FROM (
            o."createdAt" - (CASE WHEN claim."createdAt" IS NOT NULL AND claim."createdAt" > i."createdAt"
                                   THEN claim."createdAt" ELSE i."createdAt" END)
          )) / 60 > 60
      ) t`,

    // BUG YANG DIPERBAIKI (5 Agustus 2026): `respRaw`/SLA breach di atas
    // memakai INNER JOIN inbound↔outbound — percakapan yang TIDAK
    // PERNAH dibalas sama sekali (tidak ada pesan OUTBOUND) otomatis
    // TIDAK IKUT terhitung sama sekali, bukannya dianggap "sangat
    // terlambat". Kalau percakapan itu masih OPEN itu tertutup oleh
    // `stalled` di atas (last message inbound & >60 menit, status
    // != RESOLVED) — TAPI begitu ditandai RESOLVED (oleh siapa pun,
    // termasuk auto-resolve), ia lolos dari stalled JUGA (excluded by
    // status filter), jadi lolos dari SEMUA sinyal: avg respons, SLA
    // breach, dan menggantung. Sales yang mengabaikan lead lalu
    // percakapannya ditutup begitu saja tidak pernah tercatat sebagai
    // pelanggaran apa pun. Dihitung terpisah di sini dan digabung ke
    // `slaBreach` supaya tidak ada celah "menghilang" dari radar.
    //
    // Diatribusikan ke `assignedToId` (bukan `firstResponderId`, yang
    // NULL untuk percakapan begini — tidak ada yang pernah membalas).
    prisma.conversation.count({
      where: { ...mine, status: "RESOLVED", messages: { none: { direction: "OUTBOUND" } } },
    }),

    // Berapa customer PINDAH ke TRANSACTION (dulu COMPLETED, dihapus saat
    // restrukturisasi pipeline 7→4 stage 24 Agustus 2026 — lihat
    // schema.prisma enum PipelineStage) di dalam rentang — konversi
    // sebagai ALIRAN periode, bukan keadaan. Ini pembilang conversion
    // rate yang sepadan dengan penyebutnya (percakapan ditangani pada
    // periode yang sama, DIKECUALIKAN dari SPAM — lihat `mine`).
    // Sebelumnya pembilangnya memakai "stage sekarang" (keadaan
    // sepanjang waktu) sementara penyebutnya periode — campur aduk, dan
    // itu yang membuat 14.3% muncul bersamaan dengan Rp0.
    prisma.$queryRaw`
      SELECT COUNT(DISTINCT pt.customer_id)::int AS n
      FROM pipeline_transitions pt
      JOIN "Conversation" c ON c."customerId" = pt.customer_id
      WHERE pt.to_stage = 'TRANSACTION'
        AND pt.created_at >= ${mulai} AND pt.created_at < ${selesai}
        AND c."assignedToId" = ${u.id} AND c."type" = 'INDIVIDUAL'`,

    // Customer DISTINCT yang punya order dalam rentang — hasil konkret
    // yang datanya sudah ada sekarang (tidak bergantung pada riwayat
    // transisi yang baru mulai direkam).
    //
    // BUG DIPERBAIKI (25 Agustus 2026): sebelumnya pakai `mineAtribusi`
    // (percakapan KAPAN SAJA pernah dipegang, tidak dibatasi tanggal) —
    // populasi pembilang ini TIDAK SEPADAN dengan `handled` (penyebut
    // orderConversionRate, yang dibatasi percakapan dibuat DALAM
    // periode). Sekarang pakai `mine` (sama seperti `handled`) supaya
    // pembilang & penyebut orderConversionRate dari populasi yang sama.
    prisma.customer.count({
      where: {
        conversations: { some: mine },
        orders: { some: { ...buildDateWhere(from, to), status: { not: "CANCELLED" } } },
      },
    }),

    // Dari `handled` (percakapan yang SEKARANG dia pegang, dibuat dalam
    // rentang), berapa yang datang lewat AMBIL/AMBIL ALIH dari orang lain
    // — bukan dia yang klaim/pegang dari awal. HandoverEvent dicatat
    // SETIAP kali assignedToId berpindah (lihat routes/conversations.js
    // takeover & transfer), jadi event TERAKHIR per percakapan selalu
    // mencerminkan siapa pemilik SEKARANG. Kalau event terakhir itu
    // punya fromUserId (artinya pindah tangan dari seseorang, bukan
    // klaim pertama dari percakapan yang belum ber-pemilik), percakapan
    // ini "beban warisan", bukan tanggung jawab asli dia.
    //
    // BUG YANG DIPERBAIKI: sebelumnya `handled` dipakai apa adanya
    // sebagai "Beban Percakapan" di Laporan — sales yang rajin
    // Ambil Alih chat mangkrak (biasanya lead dingin yang sudah gagal
    // duluan) angkanya jadi TERTINGGI, padahal bukan dia yang aktif
    // menangani sejak awal, dan closing rate-nya wajar rendah karena
    // yang dia warisi memang sudah sulit dikonversi.
    prisma.$queryRaw`
      SELECT COUNT(*)::int AS n
      FROM "Conversation" c
      WHERE c."assignedToId" = ${u.id} AND c."type" = 'INDIVIDUAL'
        AND c."createdAt" >= ${mulai} AND c."createdAt" < ${selesai}
        AND (
          SELECT he."fromUserId" FROM "HandoverEvent" he
          WHERE he."conversationId" = c.id
          ORDER BY he."createdAt" DESC LIMIT 1
        ) IS NOT NULL`,

    // Percakapan (dibuat dalam rentang, dia pegang) yang customer-nya
    // ditandai SPAM — populasi SAMA dengan `mine`, cuma tanpa pengecualian
    // SPAM-nya. Dipakai untuk `spamRate`: bukan untuk menghukum, tapi
    // pengawas risiko SPAM dipakai sebagai jalan pintas menghindari lead
    // sulit (lihat catatan `mine` di atas soal pengecualian SPAM dari
    // conversionRate/orderConversionRate).
    prisma.conversation.count({
      where: { ...convWhere, assignedToId: u.id, customer: { pipelineStage: "SPAM" } },
    }),
  ]);

  const byStage = Object.fromEntries(stageGroups.map((g) => [g.pipelineStage, g._count._all]));
  const stageCount = (s) => byStage[s] || 0;
  // TRANSACTION + REVIEWED — REVIEWED (dikembalikan 26 Agustus 2026) sudah
  // lewat TRANSACTION, jadi tetap "paid" secara posisi, cuma sudah maju lebih
  // jauh (kasih review publik).
  const paidSekarang = stageCount("TRANSACTION") + stageCount("REVIEWED");
  const paidPeriode = paidRaw[0]?.n || 0;
  const orders = orderAgg._count._all;
  const gross = orderAgg._sum.value || 0;
  const target = targetMap[u.id] || 0;

  return {
    userId: u.id, name: u.name, avatarUrl: u.avatarUrl,

    // Aktivitas
    // `handled` = total percakapan yang SEKARANG dia pegang (beban kerja
    // saat ini, termasuk warisan takeover — berguna untuk tahu antrean
    // riil). `handledOwn` = bagian dari situ yang dia pegang dari awal
    // (klaim pertama, bukan pindahan) — inilah yang mencerminkan
    // performa penanganan sendiri. `handledTakeover` = sisanya (warisan
    // dari Ambil/Ambil Alih orang lain). UI "Beban Percakapan" dan
    // leaderboard HARUS memakai `handledOwn`, bukan `handled` mentah.
    handled, replied, resolved,
    handledTakeover: takeoverRaw[0]?.n || 0,
    handledOwn: handled - (takeoverRaw[0]?.n || 0),
    stalled: stalledRaw[0]?.n || 0,
    replyRate: handled > 0 ? Math.round((replied / handled) * 100) : null,
    avgResponseMinutes: (() => {
      const avg = avgEffectiveMinutes(respRaw);
      return avg != null ? Math.round(avg) : null;
    })(),
    respondedSample: respRaw.length,
    // `neverReplied` = percakapan yang RESOLVED tanpa satu pun balasan
    // (lihat catatan query di atas) — digabung ke slaBreach supaya
    // selalu ikut tampil di kolom "SLA >1j" yang sudah ada, tapi juga
    // diekspos terpisah untuk UI yang mau menyorotnya secara eksplisit.
    neverReplied: neverReplied || 0,
    slaBreach: (slaBreach[0]?.n || 0) + (neverReplied || 0),

    // POSISI SAAT INI (bukan aliran periode) — sengaja tidak difilter
    // tanggal, dan UI WAJIB melabelinya begitu.
    funnel: {
      NEW: stageCount("NEW"), PROSPECT: stageCount("PROSPECT"),
      TRANSACTION: stageCount("TRANSACTION"), REVIEWED: stageCount("REVIEWED"),
      SPAM: stageCount("SPAM"),
    },
    paidCustomersNow: paidSekarang,

    // ALIRAN PERIODE — ikut berubah saat tanggal diganti.
    paidCustomers: paidPeriode,
    orderingCustomers,
    // Konversi UTAMA (25 Agustus 2026: dijadikan metrik "Konversi" utama
    // di UI, menggantikan orderConversionRate) = customer yang PINDAH ke
    // Transaction dalam periode / percakapan ditangani dalam periode
    // (SPAM sudah dikecualikan dari `handled` lewat `mine`). Dua-duanya
    // aliran periode dari populasi yang sama → sepadan. null (UI: "—")
    // kalau riwayat transisi belum ada datanya di periode ini, supaya
    // tidak terbaca sebagai "0% closing".
    conversionRate: adaDataTransisi ? pctOrNull(paidPeriode, handled) : null,
    // Konversi SEKUNDER berbasis ORDER — pelengkap conversionRate,
    // mengukur hal yang genuinely beda (order benar-benar dibuat, bukan
    // cuma kartu Kanban digeser). Populasi pembilang sudah diselaraskan
    // dengan `handled` (lihat catatan di query `orderingCustomers`).
    orderConversionRate: pctOrNull(orderingCustomers, handled),
    // Berapa % lead yang DIA PEGANG ditandai SPAM — bukan metrik
    // performa, tapi pengawas: kalau tiba-tiba jauh di atas rata-rata
    // tim, layak ditinjau manual (lihat catatan query `spamCount`).
    spamCount,
    spamRate: pctOrNull(spamCount, handled + spamCount),

    // Hasil
    orders,
    grossValue: gross,
    collectedValue: lunasAgg._sum.value || 0,
    aov: orders > 0 ? Math.round(gross / orders) : 0,
    target,
    percentToTarget: target > 0 ? Math.round((gross / target) * 100) : null,
    complaints: complaintCount,
    complaintRate: orders > 0 ? Math.round((complaintCount / orders) * 1000) / 10 : null,
  };
}

analyticsRouter.get("/sales-report", async (req, res) => {
  try {
    const { from, to } = req.query;
    const convWhere = { ...buildDateWhere(from, to), type: "INDIVIDUAL" };
    const { year, month } = nowPartsWIB();

    // Batas rentang sebagai Date untuk $queryRaw (buildDateWhere menghasilkan
    // objek Prisma, tidak bisa dipakai di raw SQL). Sentinel dipakai saat
    // preset "Semua" supaya SQL-nya tetap satu bentuk — tanpa ini query raw
    // di bawah harus dirakit kondisional dan mudah salah.
    const mulai   = from ? startOfDayWIB(from) : new Date("1970-01-01T00:00:00Z");
    const selesai = to   ? endOfDayExclusiveWIB(to) : new Date("2999-01-01T00:00:00Z");

    // active: true — sales yang sudah dinonaktifkan (mis. resign) hilang
    // dari baris per-sales di sini, TAPI order/percakapan yang pernah dia
    // tangani tetap ada di database dan tetap dihitung penuh di angka
    // company-wide (/overview, /business-summary — tidak scoped per-user).
    // Lihat catatan `active` di schema.prisma User.
    const usersRaw = await prisma.user.findMany({
      where: { active: true },
      select: { id: true, name: true, avatarUrl: true, role: true, isSalesTeamLead: true },
      orderBy: { name: "asc" },
    });
    // BUG DIPERBAIKI (22 Agustus 2026): filter LAMA "role !== ADMIN" berarti
    // "siapa pun yang bukan admin" — aman selama satu-satunya role non-admin
    // di sistem memang SALES, tapi begitu akun Produksi/Driver/dst ditambah
    // (lihat CLAUDE.md §19), SEMUANYA ikut nyasar ke laporan sales/widget
    // "Top Performing Reps" di Dashboard (ditemukan nyata: driver baru
    // langsung nangkring di Top Reps dengan Rp0).
    //
    // REVISI KEDUA (sama hari) — percobaan pertama masih menambahkan
    // `grantedSalesIds.has(u.id)` (siapa pun yang DIBERI peran SALES
    // tambahan lewat multi-role D-010), dengan asumsi itu berarti "admin
    // yang juga jualan". TERNYATA SALAH untuk kasus nyata: Natasha diberi
    // SEMUA 9 peran (termasuk SALES) supaya bisa MENGAKSES data lintas
    // divisi (lihat CLAUDE.md §1) — itu urusan hak akses, BUKAN pernyataan
    // "dia sales performer yang harus dinilai di leaderboard". Ditegaskan
    // eksplisit oleh owner: leaderboard ini HANYA untuk role SALES primer.
    // Kalau nanti memang ada admin yang betulan berjualan dan perlu masuk
    // sini, keputusannya harus eksplisit di baris ini, bukan otomatis ikut
    // menempel gara-gara punya akses SALES untuk alasan lain.
    const users = usersRaw.filter((u) => u.role === "SALES");

    const targets = await prisma.salesTarget.findMany({ where: { year, month } });
    const targetMap = Object.fromEntries(targets.map((t) => [t.userId, t.targetValue]));

    // Ada transisi stage tercatat di periode ini? pipeline_transitions baru
    // mulai merekam 25 Jul 2026 dan TIDAK bisa di-backfill, jadi untuk periode
    // sebelum itu konversi harus tampil "—" (belum ada datanya), BUKAN 0%
    // (yang terbaca sebagai "tidak ada yang closing" — kesimpulan yang salah).
    const transisiPeriode = await prisma.$queryRaw`
      SELECT COUNT(*)::int AS n FROM pipeline_transitions
      WHERE created_at >= ${mulai} AND created_at < ${selesai}`;
    const adaDataTransisi = (transisiPeriode[0]?.n || 0) > 0;

    const ctx = { convWhere, mulai, selesai, from, to, adaDataTransisi, targetMap };
    const rows = await Promise.all(users.map((u) => computeSalesRow(u, ctx)));

    // Baris "Team Lead" (Novi) — dihitung dengan FUNGSI YANG SAMA PERSIS
    // (computeSalesRow) supaya angkanya sepadan/bisa dipercaya sama dengan
    // baris sales biasa, TAPI dipanggil TERPISAH dari `users`/`rows` di atas
    // dan ditambahkan SETELAH `t` (Total Tim) dihitung di bawah — sengaja
    // TIDAK ikut masuk ke Total Tim 8 sales, supaya closing Novi tidak
    // dobel-hitung ke angka tim yang sudah dihitung dari 8 sales itu sendiri.
    // `target`-nya (dari SalesTarget miliknya sendiri) mewakili TARGET TIM
    // gabungan (keputusan bisnis 25 Agustus 2026), bukan target closing
    // pribadi — makanya frontend membandingkan progres ke target ini
    // memakai grossValue TIM + grossValue pribadi Novi, bukan grossValue
    // pribadi Novi saja (lihat SalesReportTab.jsx).
    const teamLeadUsers = usersRaw.filter((u) => u.isSalesTeamLead);
    const teamLeadRows = await Promise.all(
      teamLeadUsers.map(async (u) => ({ ...(await computeSalesRow(u, ctx)), isTeamLead: true }))
    );

    // Nilai Penjualan Tim periode SEBELUMNYA — dipakai badge pertumbuhan di
    // kartu hero SalesReportTab.jsx. SENGAJA BUKAN dengan menjalankan ulang
    // computeSalesRow() untuk tiap sales (endpoint ini sudah berat, 8+ sales
    // x ~15 query paralel masing-masing — menjalankannya dua kali demi 1
    // angka pertumbuhan tidak sepadan). Query tunggal ini secara matematis
    // SAMA dengan menjumlah orderAgg._sum.value per-sales (assignedToId
    // adalah FK tunggal, jadi tidak ada percakapan yang ke-double-count
    // lintas sales) — populasinya DISENGAJA sama persis dengan
    // `mineAtribusi` di computeSalesRow (lihat catatan panjang di atas),
    // digabung utk 8 sales AKTIF + team lead sekaligus jadi SATU angka
    // (growth rate tidak valid dijumlah terpisah lintas sub-populasi).
    const prevRangeSales = buildPrevRange(from, to);
    const allTeamIds = [...users.map((u) => u.id), ...teamLeadUsers.map((u) => u.id)];
    const teamGrossPrevAgg = prevRangeSales ? await prisma.order.aggregate({
      where: {
        createdAt: prevRangeSales, status: { not: "CANCELLED" },
        customer: { conversations: { some: { assignedToId: { in: allTeamIds }, type: "INDIVIDUAL" } } },
      },
      _sum: { value: true },
    }) : null;

    // "Percakapan Ditangani" (total.handled) periode sebelumnya — dipakai
    // kartu KPI yang sama di PerformaTimTab.jsx. Populasi SAMA PERSIS dengan
    // `mine` di computeSalesRow (8 sales AKTIF, TIDAK termasuk team lead —
    // total.handled memang tidak menjumlahkan teamLeadRows, lihat reduce di
    // atas), jadi query gabungan pakai assignedToId IN 8 sales itu saja.
    const handledPrevRaw = prevRangeSales ? await prisma.conversation.count({
      where: {
        createdAt: prevRangeSales, type: "INDIVIDUAL",
        assignedToId: { in: users.map((u) => u.id) },
        customer: { pipelineStage: { not: "SPAM" } },
      },
    }) : null;

    // "Menggantung SEKARANG" lintas periode — sinyal operasional yang tidak
    // boleh hilang hanya karena user memilih rentang "hari ini". Dipisah dari
    // kolom per-periode supaya tidak tercampur (lihat catatan `stalled`).
    const stalledNowRaw = await prisma.$queryRaw`
      SELECT COUNT(*)::int AS n
      FROM "Conversation" c
      JOIN (
        SELECT DISTINCT ON ("conversationId") "conversationId", direction, "createdAt"
        FROM "Message" ORDER BY "conversationId", "createdAt" DESC
      ) m ON m."conversationId" = c.id
      WHERE c."type" = 'INDIVIDUAL' AND c."assignedToId" IS NOT NULL
        AND c.status != 'RESOLVED'
        AND m.direction = 'INBOUND'
        AND m."createdAt" < NOW() - INTERVAL '60 minutes'`;

    // Percakapan DALAM PERIODE yang belum diambil siapa pun — ini bagian
    // terbesar dari selisih "Total Percakapan" (/performance, semua
    // percakapan) vs "Percakapan Ditangani" (total.handled di bawah, cuma
    // yang dipegang salah satu sales AKTIF). Ditemukan 25 Agustus 2026 lewat
    // pertanyaan user kenapa dua angka itu beda — sebelumnya selisihnya
    // nyata tapi tidak pernah dijelaskan di UI mana pun. Sisa selisih kecil
    // (percakapan dipegang admin/non-SALES seperti Novi/Natasha) SENGAJA
    // tidak dipecah lagi di sini — porsinya kecil, tidak sepadan dengan
    // query tambahan.
    const unassignedInPeriodRaw = await prisma.conversation.count({
      where: { ...convWhere, assignedToId: null },
    });

    // Total tim — supaya UI tidak menjumlahkan sendiri (dan tidak salah
    // menjumlahkan rata-rata, kesalahan klasik di laporan seperti ini).
    const t = rows.reduce((a, r) => ({
      handled: a.handled + r.handled, replied: a.replied + r.replied,
      handledOwn: a.handledOwn + r.handledOwn, handledTakeover: a.handledTakeover + r.handledTakeover,
      stalled: a.stalled + r.stalled,
      orders: a.orders + r.orders, grossValue: a.grossValue + r.grossValue,
      collectedValue: a.collectedValue + r.collectedValue,
      paidCustomers: a.paidCustomers + r.paidCustomers,
      orderingCustomers: a.orderingCustomers + r.orderingCustomers,
      spamCount: a.spamCount + r.spamCount,
      slaBreach: a.slaBreach + r.slaBreach, neverReplied: a.neverReplied + r.neverReplied,
      complaints: a.complaints + r.complaints,
      target: a.target + r.target,
    }), { handled: 0, replied: 0, handledOwn: 0, handledTakeover: 0, stalled: 0, orders: 0, grossValue: 0, collectedValue: 0, paidCustomers: 0, orderingCustomers: 0, spamCount: 0, slaBreach: 0, neverReplied: 0, complaints: 0, target: 0 });

    // Sama seperti "teamGrossAll" yang SUDAH dihitung frontend (SalesReportTab.jsx
    // — total.grossValue + closing pribadi team lead) — dihitung ULANG di sini
    // supaya growth% dibandingkan terhadap populasi yang SAMA PERSIS, bukan
    // cuma total.grossValue (8 sales) yang akan meleset kalau team lead ikut
    // closing sendiri.
    const teamGrossAllCurr = t.grossValue + teamLeadRows.reduce((s, r) => s + r.grossValue, 0);
    const growthTeamGrossValue = growth(teamGrossAllCurr, prevRangeSales ? (teamGrossPrevAgg?._sum.value || 0) : null);
    const growthHandled = growth(t.handled, handledPrevRaw);

    res.json({
      periodeTarget: { year, month },
      // Dipakai UI untuk memutuskan menampilkan "—" vs 0% pada konversi
      // berbasis transisi stage.
      adaDataTransisi,
      stalledNow: stalledNowRaw[0]?.n || 0,
      unassignedInPeriod: unassignedInPeriodRaw,
      growthTeamGrossValue,
      growthHandled,
      // teamLeadRows DITARUH SETELAH sort — dia tidak ikut ranking-by-revenue
      // 8 sales biasa (lihat catatan di atas). Frontend memisahkannya via
      // `isTeamLead`, bukan lewat posisi di array ini.
      rows: [...rows.sort((a, b) => b.grossValue - a.grossValue), ...teamLeadRows],
      total: {
        ...t,
        replyRate:      t.handled > 0 ? Math.round((t.replied / t.handled) * 100) : null,
        conversionRate: adaDataTransisi ? pctOrNull(t.paidCustomers, t.handled) : null,
        orderConversionRate: pctOrNull(t.orderingCustomers, t.handled),
        spamRate:       pctOrNull(t.spamCount, t.handled + t.spamCount),
        aov:            t.orders  > 0 ? Math.round(t.grossValue / t.orders) : 0,
        percentToTarget: t.target > 0 ? Math.round((t.grossValue / t.target) * 100) : null,
      },
    });
  } catch (err) {
    console.error("sales-report error:", err);
    res.status(500).json({ error: "Gagal memuat laporan sales" });
  }
});

analyticsRouter.get("/performance", async (req, res) => {
  try {
    const { from, to } = req.query;
    // type: INDIVIDUAL — grup WA internal bukan percakapan lead, tidak boleh
    // ikut menghitung Total Percakapan/Closing Rate di Laporan.
    const convWhere = { ...buildDateWhere(from, to), type: "INDIVIDUAL" };
    const prevRangePerf = buildPrevRange(from, to);

    const [totalConversations, openCount, resolvedCount, statusGroups, totalConversationsPrev] = await Promise.all([
      prisma.conversation.count({ where: convWhere }),
      prisma.conversation.count({ where: { ...convWhere, status: "OPEN" } }),
      prisma.conversation.count({ where: { ...convWhere, status: "RESOLVED" } }),
      // Ditambahkan 25 Agustus 2026 — ditemukan sambil menggabungkan tab
      // Percakapan+Penjualan: PercakapanTab.jsx sudah lama membaca
      // `perf.statusBreakdown` untuk chart "Status Percakapan", tapi field
      // ini TIDAK PERNAH ada di response endpoint ini — chart itu sudah
      // lama selalu kosong. Pola sama persis dengan channelBreakdown yang
      // sudah ada & benar di /overview.
      prisma.conversation.groupBy({ by: ["status"], where: convWhere, _count: { _all: true } }),
      // Periode sebelumnya (panjang sama) — dipakai badge pertumbuhan kartu
      // "Total Percakapan" di PerformaTimTab.jsx.
      prevRangePerf ? prisma.conversation.count({ where: { createdAt: prevRangePerf, type: "INDIVIDUAL" } }) : Promise.resolve(null),
    ]);
    const growthTotalConversations = growth(totalConversations, totalConversationsPrev);

    // DIRENAME dari `closingRate` (25 Agustus 2026) — nama lama menyesatkan:
    // ini rasio percakapan berstatus RESOLVED, metrik kebersihan inbox, BUKAN
    // closing penjualan. Untuk konversi penjualan sungguhan lihat
    // /sales-report `conversionRate`.
    const resolvedRate = pctOrNull(resolvedCount, totalConversations, 0);

    // Rata-rata response time: selisih pesan INBOUND pertama vs OUTBOUND pertama per conv
    // (JOIN ke Conversation supaya grup WA internal tidak ikut terhitung)
    let avgResponseMinutes = null;
    try {
      // BUG YANG DIPERBAIKI (26 Agustus 2026): query ini TIDAK PERNAH difilter
      // tanggal — selalu menghitung rata-rata SEPANJANG WAKTU biarpun `range`
      // di-set "Hari ini"/"7 hari"/dst, sementara SEMUA metrik lain di
      // endpoint ini (totalConversations, resolvedRate, dst) sudah benar ikut
      // `convWhere`. Sekarang dibatasi `c."createdAt"` (kapan percakapan itu
      // MULAI) memakai batas WIB yang SAMA seperti `convWhere`, supaya
      // konsisten dengan kartu lain di tab yang sama.
      const mulaiResp   = from ? startOfDayWIB(from) : new Date("1970-01-01T00:00:00Z");
      const selesaiResp = to   ? endOfDayExclusiveWIB(to) : new Date("2999-01-01T00:00:00Z");
      // Pasangan mentah, rata-rata dihitung di JS via avgEffectiveMinutes
      // (jam operasional 09-21 WIB) — lihat catatan panjang di utils/wib.js.
      // Rata-rata WALL-CLOCK mentah sebelumnya digelembungkan pesan malam
      // yang baru dibalas paginya (dilaporkan owner: rata-rata 14 jam 30
      // menit yang tidak masuk akal).
      const pairs = await prisma.$queryRaw`
        SELECT i."createdAt" AS "inboundAt", o."createdAt" AS "outboundAt"
        FROM (
          SELECT "conversationId", MIN("createdAt") as "createdAt"
          FROM "Message" WHERE direction = 'INBOUND'
          GROUP BY "conversationId"
        ) i
        JOIN (
          SELECT "conversationId", MIN("createdAt") as "createdAt"
          FROM "Message" WHERE direction = 'OUTBOUND'
          GROUP BY "conversationId"
        ) o ON i."conversationId" = o."conversationId"
        JOIN "Conversation" c ON c.id = i."conversationId"
        WHERE o."createdAt" > i."createdAt" AND c."type" = 'INDIVIDUAL'
          AND c."createdAt" >= ${mulaiResp} AND c."createdAt" < ${selesaiResp}
      `;
      const avg = avgEffectiveMinutes(pairs);
      avgResponseMinutes = avg != null ? Math.round(avg) : null;
    } catch (_) {}

    // Tren bulanan avg response time (6 bulan terakhir) — dipakai sparkline
    // di MetricCard "Avg Response Time" (features/laporan/components/MetricCard.jsx).
    // Sebelumnya endpoint ini cuma mengembalikan SATU angka, jadi tidak ada
    // cara menampilkan apakah kecepatan respons tim membaik atau memburuk.
    //
    // Di-bucket menurut bulan pesan INBOUND-nya (kapan customer bertanya) —
    // itu cohort yang natural untuk "seberapa cepat kami menjawab bulan itu".
    // Bucket WIB, bukan UTC — lihat catatan di /overview.
    let monthlyResponseTime = [];
    try {
      // Bucket + pasangan mentah (bukan AVG di SQL) — dirata-ratakan per
      // bulan di JS via avgEffectiveMinutes, sama alasan dengan
      // avgResponseMinutes di atas.
      const rows = await prisma.$queryRaw`
        SELECT to_char(date_trunc('month', i."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jakarta'), 'YYYY-MM') as month,
               i."createdAt" AS "inboundAt", o."createdAt" AS "outboundAt"
        FROM (
          SELECT "conversationId", MIN("createdAt") as "createdAt"
          FROM "Message" WHERE direction = 'INBOUND'
          GROUP BY "conversationId"
        ) i
        JOIN (
          SELECT "conversationId", MIN("createdAt") as "createdAt"
          FROM "Message" WHERE direction = 'OUTBOUND'
          GROUP BY "conversationId"
        ) o ON i."conversationId" = o."conversationId"
        JOIN "Conversation" c ON c.id = i."conversationId"
        WHERE o."createdAt" > i."createdAt"
          AND c."type" = 'INDIVIDUAL'
          AND i."createdAt" >= NOW() - INTERVAL '6 months'
      `;
      const byMonth = new Map();
      for (const r of rows) {
        if (!byMonth.has(r.month)) byMonth.set(r.month, []);
        byMonth.get(r.month).push(r);
      }
      monthlyResponseTime = [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, pairs]) => ({
        month,
        value: (() => {
          const avg = avgEffectiveMinutes(pairs);
          return avg != null ? Math.round(avg) : 0;
        })(),
      }));
    } catch (_) {}

    res.json({
      totalConversations, openCount, resolvedCount, resolvedRate,
      growthTotalConversations,
      avgResponseMinutes, monthlyResponseTime,
      statusBreakdown: statusGroups.map((g) => ({ status: g.status, count: g._count._all })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Performance per sumber lead — untuk menghitung ROI per channel
analyticsRouter.get("/source-performance", async (req, res) => {
  try {
    const { from, to } = req.query;
    const custDateWhere = buildDateWhere(from, to);

    // SPAM SENGAJA TIDAK dikecualikan di sini (beda dari /sales-report &
    // /business-summary) — restrukturisasi 24 Agustus 2026: ini metrik
    // KUALITAS CHANNEL/SUMBER, bukan performa sales. Channel dengan targeting
    // buruk yang banyak menghasilkan chat junk/salah sasaran HARUS kelihatan
    // buruk di sini (leads mentah, termasuk spam) — kalau SPAM dibuang dari
    // penyebut, channel itu malah tampak bagus (convRate/nilaiPerLead dihitung
    // cuma dari sisa lead "layak"), menyembunyikan pemborosan belanja iklan.
    // `spamRate` per sumber ditambahkan sebagai diagnostik kualitas terpisah.
    const sources = await prisma.customer.groupBy({
      by: ["leadSource"],
      where: custDateWhere,
      _count: { id: true },
    });

    const result = await Promise.all(sources.map(async (s) => {
      const [won, spamCount, orderAgg] = await Promise.all([
        // IN [TRANSACTION, REVIEWED] — "won" = sudah pernah closing, REVIEWED
        // (dikembalikan 26 Agustus 2026) sudah lewat TRANSACTION jadi tetap won.
        prisma.customer.count({
          where: { leadSource: s.leadSource, pipelineStage: { in: ["TRANSACTION", "REVIEWED"] }, ...custDateWhere },
        }),
        prisma.customer.count({
          where: { leadSource: s.leadSource, pipelineStage: "SPAM", ...custDateWhere },
        }),
        prisma.order.aggregate({
          where: {
            customer: { leadSource: s.leadSource, ...custDateWhere },
            status: { not: "CANCELLED" },
          },
          _sum: { value: true },
        }),
      ]);
      const leads = s._count.id;
      return {
        source:     s.leadSource,
        leads,
        won,
        convRate:   pctOrNull(won, leads),
        spamCount,
        spamRate:   pctOrNull(spamCount, leads),
        totalValue: orderAgg._sum.value || 0,
      };
    }));

    // Urutkan dari leads terbanyak
    result.sort((a, b) => b.leads - a.leads);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/analytics/sales-performance?year=&month=
// Per-sales: totalOrderValue bulan itu, target dari SalesTarget, persentase pencapaian
analyticsRouter.get("/sales-performance", async (req, res) => {
  try {
    // Default = bulan berjalan menurut WIB (bukan menurut jam container UTC).
    const sekarang = nowPartsWIB();
    const year  = Number(req.query.year  || sekarang.year);
    const month = Number(req.query.month || sekarang.month);

    // Rentang bulan menurut kalender WIB. `new Date(year, month-1, 1)` yang
    // lama memakai timezone server — di container (UTC) batasnya bergeser
    // 7 jam, jadi order awal/akhir bulan bisa masuk bulan yang salah.
    const startOfMonth = startOfMonthWIB(year, month);
    const endOfMonth   = endOfMonthExclusiveWIB(year, month); // exclusive

    // active: true — sama seperti /sales-report, sales nonaktif hilang dari
    // widget Target Sales, tapi order historisnya tidak hilang dari mana pun.
    const salesUsersRaw = await prisma.user.findMany({
      where: { active: true },
      select: { id: true, name: true, avatarUrl: true, role: true },
      orderBy: { name: "asc" },
    });
    // role === SALES SAJA (diperbaiki 22 Agustus 2026 bersamaan dengan
    // /sales-report — lihat catatan panjang di sana). Punya peran SALES
    // TAMBAHAN untuk akses lintas divisi (mis. Natasha) BUKAN berarti masuk
    // hitungan target/performa sales.
    const salesUsers = salesUsersRaw.filter((u) => u.role === "SALES");

    const targets = await prisma.salesTarget.findMany({ where: { year, month } });
    const targetMap = Object.fromEntries(targets.map((t) => [t.userId, t.targetValue]));

    const result = await Promise.all(salesUsers.map(async (u) => {
      const orderAgg = await prisma.order.aggregate({
        where: {
          customer: { assignedSalesId: u.id },
          status:   { not: "CANCELLED" },
          createdAt: { gte: startOfMonth, lt: endOfMonth },
        },
        _sum: { value: true },
      });

      const totalOrderValue  = orderAgg._sum.value || 0;
      const target           = targetMap[u.id] ?? 0;
      const percentToTarget  = target > 0 ? Math.round((totalOrderValue / target) * 100) : null;

      return { userId: u.id, name: u.name, avatarUrl: u.avatarUrl, totalOrderValue, target, percentToTarget };
    }));

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ?from=&to= OPSIONAL — kalau diisi, funnel dihitung dari lead yang MASUK
// (Customer.createdAt) pada periode itu, dikelompokkan menurut stage mereka
// SEKARANG. Tanpa filter (perilaku lama): seluruh customer, sepanjang waktu.
// Dulu endpoint ini tidak menerima parameter tanggal sama sekali — tombol
// pemilih periode di kartu "Deal Pipeline" tidak melakukan apa-apa.
analyticsRouter.get("/pipeline-funnel", async (req, res) => {
  try {
    const { from, to } = req.query;
    const custWhere = buildDateWhere(from, to);

    const stageGroups = await prisma.customer.groupBy({
      by: ["pipelineStage"],
      _count: { _all: true },
      where: custWhere,
    });

    const stageValues = await Promise.all(
      stageGroups.map(async (g) => {
        const agg = await prisma.order.aggregate({
          where: {
            customer: { pipelineStage: g.pipelineStage, ...custWhere },
            status: { not: "CANCELLED" },
          },
          _sum: { value: true },
        });
        return {
          stage: g.pipelineStage,
          count: g._count._all,
          value: agg._sum.value || 0,
        };
      })
    );

    const ORDER = ["NEW", "PROSPECT", "TRANSACTION", "REVIEWED", "SPAM"];
    const sorted = ORDER.map((s) => stageValues.find((r) => r.stage === s) || { stage: s, count: 0, value: 0 });

    res.json(sorted);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /analytics/revenue-series?from=&to= ────────────────────────────────
// Deret pendapatan untuk grafik "Sales Overview".
//
// MASALAH YANG DIPERBAIKI: kartu itu tadinya memakai `monthlyRevenue` dari
// /overview, yang SELALU 6 bulan terakhir dan mengabaikan rentang yang dipilih.
// Di produksi data order baru terkumpul 1 bulan → deretnya hanya 1 titik →
// Recharts tidak bisa menggambar garis dari satu titik, jadi grafiknya tampak
// KOSONG (hanya satu dot). Endpoint ini memberi granularitas HARIAN sehingga
// rentang 30 hari menghasilkan 30 titik.
//
// Granularitas otomatis: <= 92 hari → HARIAN, lebih panjang → BULANAN.
// Alasannya praktis: 1 tahun harian = 365 titik yang tidak terbaca di kartu
// selebar itu, sedangkan 30 hari bulanan = 1 titik (bug yang sama terulang).
//
// Bucket kosong DIISI 0 — kalau hari tanpa order dilewati, garisnya akan
// "melompat" dan menyesatkan (terlihat seperti penjualan kontinu).
analyticsRouter.get("/revenue-series", async (req, res) => {
  try {
    const { from, to } = req.query;
    // Granularitas & pengisian bucket kosong dipindah ke helper bersama
    // (seriesWindow/fillBuckets di atas) — dulu diimplementasikan di sini
    // saja, lalu /business-summary butuh logika yang SAMA. Menyalinnya berarti
    // dua tempat yang bisa drift. Sekalian memperbaiki off-by-one bucket
    // BULANAN: `mulai.getUTCMonth()` dihitung atas instant UTC (1 Jul WIB =
    // 30 Jun 17:00Z → JUNI), jadi deret bulanan dulu selalu diawali satu
    // bucket nol yang tidak ada isinya. Lihat namaBucketWIB().
    const win = seriesWindow(from, to);

    // date_trunc di zona WIB — lihat catatan bucket WIB di /overview.
    let rows;
    if (win.granularity === "hour") {
      rows = await prisma.$queryRaw`
          SELECT to_char(date_trunc('hour', "createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jakarta'), 'YYYY-MM-DD"T"HH24') AS bucket,
                 COALESCE(SUM(value), 0)::bigint AS value
          FROM "Order"
          WHERE status != 'CANCELLED' AND "createdAt" >= ${win.mulai} AND "createdAt" < ${win.selesai}
          GROUP BY 1 ORDER BY 1`;
    } else if (win.granularity === "day") {
      rows = await prisma.$queryRaw`
          SELECT to_char(date_trunc('day', "createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jakarta'), 'YYYY-MM-DD') AS bucket,
                 COALESCE(SUM(value), 0)::bigint AS value
          FROM "Order"
          WHERE status != 'CANCELLED' AND "createdAt" >= ${win.mulai} AND "createdAt" < ${win.selesai}
          GROUP BY 1 ORDER BY 1`;
    } else {
      rows = await prisma.$queryRaw`
          SELECT to_char(date_trunc('month', "createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jakarta'), 'YYYY-MM') AS bucket,
                 COALESCE(SUM(value), 0)::bigint AS value
          FROM "Order"
          WHERE status != 'CANCELLED' AND "createdAt" >= ${win.mulai} AND "createdAt" < ${win.selesai}
          GROUP BY 1 ORDER BY 1`;
    }

    const points = fillBuckets(win, Object.fromEntries(rows.map((r) => [r.bucket, Number(r.value)])));
    const total = points.reduce((s, p) => s + p.value, 0);

    // AOV ditambahkan di sini (bukan cuma di Laporan) — kartu "Sales Overview"
    // di Dashboard sebelumnya cuma nunjukkin Total Revenue mentah, padahal
    // penjelasan NAIK/TURUNnya revenue seringkali bukan dari jumlah order,
    // tapi dari nilai rata-rata per order. Query terpisah (bukan reuse
    // `points`) karena butuh COUNT, bukan cuma SUM — win.mulai/selesai yang
    // SAMA supaya AOV selalu sepadan dengan Total Revenue di atasnya.
    const orderCountAgg = await prisma.order.aggregate({
      where: { status: { not: "CANCELLED" }, createdAt: { gte: win.mulai, lt: win.selesai } },
      _count: { _all: true },
    });
    const totalOrders = orderCountAgg._count._all;

    res.json({
      granularity: win.granularity, points, total,
      totalOrders, aov: totalOrders > 0 ? Math.round(total / totalOrders) : 0,
    });
  } catch (err) {
    console.error("revenue-series error:", err);
    res.status(500).json({ error: "Gagal memuat deret pendapatan" });
  }
});

// ── GET /analytics/response-time-series?from=&to= ──────────────────────────
// Tren TIM (bukan per-sales — lihat /sales-report untuk itu) dari waktu
// respons pertama & pelanggaran SLA, dari waktu ke waktu. Sebelumnya cuma
// ada ANGKA satu periode (di /sales-report, /performance) — tidak kelihatan
// apakah tim membaik atau memburuk dari waktu ke waktu, cuma snapshot.
//
// Sama seperti /sales-report (lihat catatan panjang di situ soal takeover):
// waktu respons dihitung dari INBOUND pertama → OUTBOUND pertama per
// percakapan (bukan per-sales, jadi tidak perlu firstResponderId di sini).
// SLA breach = balasan pertama >60 menit, DITAMBAH percakapan yang RESOLVED
// tanpa satu pun balasan (celah yang sama yang diperbaiki 5 Agustus 2026 di
// /sales-report — lihat catatan di situ) supaya lead yang diabaikan total
// sampai ditutup tidak lolos dari tren ini juga.
//
// avgResponseMinutes BUKAN diisi 0 untuk bucket kosong (beda dari
// fillBuckets biasa) — 0 menit berarti "dibalas instan", padahal artinya
// "tidak ada data hari itu". null supaya frontend merender celah di garis,
// bukan turun ke nol yang menyesatkan.
analyticsRouter.get("/response-time-series", async (req, res) => {
  try {
    const { from, to } = req.query;
    const win = seriesWindow(from, to);

    // Bucket + PASANGAN mentah (bukan AVG/COUNT FILTER di SQL untuk
    // avg_minutes) — avgResponseSeries dihitung di JS via
    // effectiveResponseMinutes (jam operasional 09-21 WIB, lihat catatan
    // panjang di utils/wib.js), slaBreachSeries TETAP wall-clock 60 menit
    // apa adanya (ambang operasional, tidak boleh ikut berubah — lihat
    // catatan avgEffectiveMinutes di atas file ini).
    const bucketExpr =
      win.granularity === "hour" ? `date_trunc('hour', c."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jakarta')`
      : win.granularity === "day" ? `date_trunc('day', c."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jakarta')`
      : `date_trunc('month', c."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jakarta')`;
    const bucketFmt = win.granularity === "hour" ? 'YYYY-MM-DD"T"HH24' : win.granularity === "day" ? "YYYY-MM-DD" : "YYYY-MM";

    // bucketExpr DIBANGUN dari `win.granularity` (3 nilai literal TETAP dari
    // kode di atas, TIDAK PERNAH dari req.query/input user) sebelum
    // disisipkan lewat Prisma.raw() ke $queryRaw — bukan string bebas yang
    // lolos ke SQL mentah. bucketFmt tetap parameter BIASA (${bucketFmt}),
    // cuma bucketExpr (ekspresi date_trunc, bukan nilai skalar) yang perlu
    // disisipkan mentah karena to_char() butuh EKSPRESI di argumen pertama,
    // bukan string.
    const respRows = await prisma.$queryRaw`
        SELECT to_char(${Prisma.raw(bucketExpr)}, ${bucketFmt}) AS bucket,
               i."createdAt" AS "inboundAt", o."createdAt" AS "outboundAt"
        FROM "Conversation" c
        JOIN (
          SELECT m."conversationId", MIN(m."createdAt") AS "createdAt"
          FROM "Message" m WHERE m.direction = 'INBOUND' GROUP BY 1
        ) i ON i."conversationId" = c.id
        JOIN (
          SELECT m."conversationId", MIN(m."createdAt") AS "createdAt"
          FROM "Message" m WHERE m.direction = 'OUTBOUND' GROUP BY 1
        ) o ON o."conversationId" = c.id
        WHERE c."type" = 'INDIVIDUAL' AND c."createdAt" >= ${win.mulai} AND c."createdAt" < ${win.selesai}
          AND o."createdAt" > i."createdAt"`;

    const neverRepliedRows = await prisma.$queryRaw`
        SELECT to_char(${Prisma.raw(bucketExpr)}, ${bucketFmt}) AS bucket,
               COUNT(*)::int AS n
        FROM "Conversation" c
        WHERE c."type" = 'INDIVIDUAL' AND c.status = 'RESOLVED'
          AND c."createdAt" >= ${win.mulai} AND c."createdAt" < ${win.selesai}
          AND NOT EXISTS (SELECT 1 FROM "Message" m WHERE m."conversationId" = c.id AND m.direction = 'OUTBOUND')
        GROUP BY 1 ORDER BY 1`;

    const byBucket = new Map();
    for (const r of respRows) {
      if (!byBucket.has(r.bucket)) byBucket.set(r.bucket, []);
      byBucket.get(r.bucket).push(r);
    }
    const avgMap = {};
    const slaMap = {};
    for (const [bucket, pairs] of byBucket) {
      avgMap[bucket] = avgEffectiveMinutes(pairs);
      // SLA breach TETAP wall-clock 60 menit mentah (ambang operasional yang
      // sama dengan takeover/eskalasi — TIDAK ikut jadi jam-kerja-aware).
      slaMap[bucket] = pairs.filter((r) =>
        (new Date(r.outboundAt).getTime() - new Date(r.inboundAt).getTime()) / 60_000 > 60
      ).length;
    }
    for (const r of neverRepliedRows) {
      slaMap[r.bucket] = (slaMap[r.bucket] || 0) + Number(r.n);
    }

    // Bucket kosong untuk slaBreach WAJAR 0 (fillBuckets biasa) — tidak ada
    // data berarti tidak ada pelanggaran. avgResponseMinutes TIDAK boleh
    // ikut fillBuckets (default 0 salah, lihat catatan di atas) — dipetakan
    // manual dari urutan bucket yang SAMA (fillBuckets dengan map kosong
    // cuma dipakai untuk dapat daftar nama bucket-nya, bukan nilainya).
    const slaBreachSeries = fillBuckets(win, slaMap);
    const avgResponseSeries = slaBreachSeries.map((p) => ({
      bucket: p.bucket, value: avgMap[p.bucket] ?? null,
    }));

    res.json({
      granularity: win.granularity,
      avgResponseSeries, slaBreachSeries,
    });
  } catch (err) {
    console.error("response-time-series error:", err);
    res.status(500).json({ error: "Gagal memuat tren waktu respons" });
  }
});

// ── GET /analytics/traffic?from=&to= ───────────────────────────────────────
// LAPORAN TRAFFIC LEAD — "kapan lead masuk, dan apakah kami ada di sana saat
// itu". Menjawab pertanyaan yang TIDAK terjawab endpoint lain: /overview cuma
// kasih total lead periode, /response-time-series cuma tren waktu.
//
// DEFINISI "LEAD" DI SINI (penting, jangan diubah diam-diam): 1 lead = 1 baris
// Customer BARU. Customer dibuat otomatis saat pesan WA masuk dari nomor yang
// belum terdaftar (routes/webhooks.js upsert by phone). Jadi ini "nomor WA unik
// yang pertama kali chat", TERMASUK salah sambung/spam/supplier — belum ada
// mekanisme menandai lead sampah. Angka di sini akan sedikit lebih tinggi dari
// "calon pembeli sungguhan".
//
// DETEKSI SPIKE — baseline statistik, bukan ambang persen yang dikarang:
// tiap hari dibandingkan dengan rata-rata bergerak 7 hari SEBELUMNYA (trailing,
// TIDAK termasuk hari itu sendiri — kalau ikut, hari yang melonjak akan
// menaikkan baseline-nya sendiri dan lonjakannya jadi tersamar) ± 2 standar
// deviasi. Keunggulan dibanding "naik >30%": otomatis menyesuaikan skala bisnis
// (tidak perlu diatur ulang saat volume tumbuh) dan tidak menuduh "drop" untuk
// hari yang memang selalu sepi.
// GET /api/analytics/lead-source-detail?from=&to=
//
// Rincian per IKLAN SPESIFIK, bukan cuma per platform. "/source-performance"
// & atribusi.bySource di /traffic sudah menjawab "berapa lead dari Meta
// Ads secara keseluruhan" — pertanyaan ini beda: "iklan/kreatif MANA yang
// sebenarnya menghasilkan" (mis. "Meta CTWA - facebook - fb.me/77pJdJNsy"
// vs "Meta CTWA - instagram - instagram.com/p/DXWbO-EAOeT" vs
// "Website - google-cpc-srch-service").
//
// Sumbernya Customer.leadSourceDetail — string yang SUDAH tersimpan sejak
// leadAttribution.js menulisnya di webhooks.js, tapi sebelum endpoint ini
// tidak pernah diagregasi ke mana pun. TIDAK dinormalisasi/ditebak lebih
// lanjut (mis. tidak coba menerjemahkan fb.me/xxx jadi nama campaign asli)
// — apa yang tersimpan itulah yang ditampilkan, konsisten dengan prinsip
// "jujur tidak tahu lebih baik daripada menebak" yang dipakai di seluruh
// sistem atribusi ini.
//
// ⚠️ BASIS PERIODE BEDA DENGAN DASHBOARD & LAPORAN SALES — ini WAJIB
// dijelaskan di UI, bukan dibiarkan jadi teka-teki:
//   - Dashboard / sales-report : order yang DIBUAT dalam periode
//     ("bulan ini kita jual berapa"), tak peduli kapan leadnya masuk.
//   - Endpoint ini             : SELURUH order dari lead yang MASUK dalam
//     periode ("iklan yang jalan bulan ini menghasilkan berapa").
// Keduanya SAMA-SAMA BENAR dan menjawab pertanyaan berbeda. Untuk menilai
// iklan, basis "kapan leadnya masuk" yang tepat — kalau tidak, order hari
// ini dari lead 3 bulan lalu akan dikreditkan ke iklan yang jalan sekarang.
// Selisih di data 30 hari (14 Agt 2026): 309jt vs 291jt.
/**
 * Metrik KUALITAS lead — menjawab "sumber mana yang leadnya bagus",
 * bukan cuma "sumber mana yang leadnya banyak".
 *
 * `nilaiPerLead` adalah angka paling penting untuk keputusan belanja
 * iklan: berapa rupiah yang dihasilkan SATU lead dari sumber ini. Iklan
 * dengan 100 lead murah tapi Rp0 per lead jelas kalah dari 10 lead mahal
 * yang menghasilkan Rp2jt per lead — perbandingan itu MUSTAHIL dilihat
 * dari kolom "jumlah lead" saja, dan itulah kenapa laporan ini gampang
 * menyesatkan tanpa metrik ini.
 *
 * Dikembalikan null (bukan 0) kalau penyebutnya nol — "belum ada closing"
 * BEDA dari "rata-ratanya nol rupiah", dan UI harus bisa membedakannya.
 */
function metrikKualitas(leads, won, totalValue, spam = 0) {
  return {
    convRate: pctOrNull(won, leads),
    nilaiPerLead: leads > 0 ? Math.round(totalValue / leads) : null,
    avgOrderValue: won > 0 ? Math.round(totalValue / won) : null,
    // SPAM SENGAJA TIDAK dikecualikan dari `leads` — lihat catatan panjang di
    // /source-performance (metrik kualitas channel, beda tujuan dari
    // /sales-report). spamRate = diagnostik terpisah, bukan dikurangkan dari
    // convRate/nilaiPerLead.
    spamRate: pctOrNull(spam, leads),
  };
}

analyticsRouter.get("/lead-source-detail", async (req, res) => {
  try {
    const { from, to } = req.query;
    // ⚠️ BUG BESAR YANG DIPERBAIKI (14 Agt 2026): dulu `where` di sini
    // menyertakan `leadSourceDetail: { not: null }`. Akibatnya SELURUH
    // pelanggan WHATSAPP_DIRECT (yang memang tidak punya detail) dibuang
    // dari tabel — termasuk Rp175.276.000 dari 76 order dalam 30 hari.
    // Angka di tabel jadi 116jt sementara Dashboard menunjukkan ~309jt,
    // tanpa penjelasan apa pun. Laporan yang tidak bisa direkonsiliasi
    // dengan angka lain lebih berbahaya daripada laporan yang tidak ada,
    // karena orang tetap memakainya untuk mengambil keputusan.
    //
    // Sekarang SEMUA pelanggan periode ini ikut; yang tanpa detail
    // dikelompokkan terang-terangan sebagai "tidak diketahui".
    // Sentinel untuk preset "Semua" — pola sama dengan /sales-report, supaya
    // bentuk SQL-nya tetap satu (tidak dirakit kondisional yang mudah salah).
    const mulai   = from ? startOfDayWIB(from) : new Date("1970-01-01T00:00:00Z");
    const selesai = to   ? endOfDayExclusiveWIB(to) : new Date("2999-01-01T00:00:00Z");

    // SATU query, bukan N+1 seperti versi sebelumnya (yang menembak 2 query
    // per baris detail — puluhan query untuk satu halaman laporan).
    //
    // COUNT(DISTINCT c.id) WAJIB: LEFT JOIN ke Order menggandakan baris
    // customer sebanyak ordernya, jadi COUNT(*) biasa akan menghitung
    // pelanggan ber-3-order sebagai 3 lead.
    // pipelineStage <> 'SPAM' di WHERE (restrukturisasi 24 Agustus 2026) —
    // chat junk/salah sasaran yang sudah ditandai SPAM tidak boleh ikut
    // membesarkan penyebut `leads`, sama alasannya dengan fix `mine` di
    // /sales-report & `sources` di /source-performance.
    const baris = await prisma.$queryRaw`
      SELECT
        c."leadSource"                                                             AS source,
        c."leadSourceDetail"                                                       AS detail,
        COUNT(DISTINCT c.id)::int                                                  AS leads,
        -- won = IN (TRANSACTION, REVIEWED) — REVIEWED (dikembalikan 26 Agustus
        -- 2026) sudah lewat TRANSACTION, tetap dihitung "won".
        COUNT(DISTINCT c.id) FILTER (WHERE c."pipelineStage" IN ('TRANSACTION', 'REVIEWED'))::int AS won,
        COUNT(DISTINCT c.id) FILTER (WHERE c."pipelineStage" = 'SPAM')::int        AS spam_count,
        COALESCE(SUM(o.value) FILTER (WHERE o.status <> 'CANCELLED'), 0)::bigint   AS total_value
      FROM "Customer" c
      LEFT JOIN "Order" o ON o."customerId" = c.id
      WHERE c."createdAt" >= ${mulai} AND c."createdAt" < ${selesai}
      GROUP BY 1, 2`;

    const semua = baris.map((b) => {
      const leads = Number(b.leads);
      const won = Number(b.won);
      const spam = Number(b.spam_count);
      // bigint dari Postgres — JSON.stringify melempar error untuk BigInt,
      // jadi WAJIB dikonversi sebelum dikirim.
      const totalValue = Number(b.total_value);
      return {
        source: b.source,
        detail: b.detail,
        platform: platformDariDetail(b.detail),
        leads,
        won,
        spamCount: spam,
        totalValue,
        ...metrikKualitas(leads, won, totalValue, spam),
      };
    });

    semua.sort((a, b) => b.leads - a.leads);

    // Total SELURUH baris dihitung SEBELUM dipotong — dipakai UI untuk
    // menunjukkan bahwa tabel ini rekonsiliasi dengan angka Dashboard.
    // Versi sebelumnya memotong 30 baris teratas TANPA menyebut sisanya,
    // jadi menjumlah kolom di layar tidak pernah ketemu total mana pun.
    const total = semua.reduce((a, r) => ({
      leads: a.leads + r.leads,
      won: a.won + r.won,
      spamCount: a.spamCount + r.spamCount,
      totalValue: a.totalValue + r.totalValue,
    }), { leads: 0, won: 0, spamCount: 0, totalValue: 0 });

    // ── Jembatan rekonsiliasi ke Ringkasan/Dashboard ──────────────────────
    // Pertanyaan yang berulang muncul (15-16 Agt 2026): "kenapa nilai order
    // di sini beda dengan Ringkasan?" Jawabannya SELALU sama — order yang
    // DIBUAT di periode ini tapi customernya sudah masuk SEBELUM periode
    // (lead lama yang baru closing sekarang). Dihitung eksplisit di sini,
    // bukan dibiarkan jadi pertanyaan berulang di UI.
    const [leadLamaRaw] = await prisma.$queryRaw`
      SELECT COUNT(*)::int AS n, COALESCE(SUM(o.value), 0)::bigint AS nilai
      FROM "Order" o
      JOIN "Customer" c ON c.id = o."customerId"
      WHERE o.status <> 'CANCELLED'
        AND o."createdAt" >= ${mulai} AND o."createdAt" < ${selesai}
        AND c."createdAt" < ${mulai}`;
    const leadLama = { order: Number(leadLamaRaw.n), totalValue: Number(leadLamaRaw.nilai) };

    const BATAS = 30;
    const tampil = semua.slice(0, BATAS);
    const sisa = semua.slice(BATAS);
    // Sisanya diringkas jadi SATU baris, bukan dibuang diam-diam.
    if (sisa.length > 0) {
      const l = sisa.reduce((a, r) => a + r.leads, 0);
      const w = sisa.reduce((a, r) => a + r.won, 0);
      const sp = sisa.reduce((a, r) => a + r.spamCount, 0);
      const v = sisa.reduce((a, r) => a + r.totalValue, 0);
      tampil.push({
        source: "LAINNYA",
        detail: `${sisa.length} sumber lain dengan lead sedikit`,
        platform: PLATFORM.UNKNOWN,
        leads: l, won: w, spamCount: sp, totalValue: v,
        ...metrikKualitas(l, w, v, sp),
        agregat: true,
      });
    }

    res.json({
      data: tampil,
      total: { ...total, ...metrikKualitas(total.leads, total.won, total.totalValue, total.spamCount) },
      // Dinyatakan eksplisit supaya UI bisa menjelaskan angkanya ke pengguna
      // — lihat catatan panjang di atas soal beda definisi periode.
      basisPeriode: "customer_dibuat",
      leadLama,
      // = angka yang akan cocok dengan "Total Nilai Order" di Ringkasan/
      // Dashboard untuk periode yang SAMA. Kalau dua-duanya dibuka
      // berdampingan, angka ini yang harus dicocokkan, bukan total.totalValue.
      sesuaiRingkasan: total.totalValue + leadLama.totalValue,
    });
  } catch (err) {
    console.error("lead-source-detail error:", err);
    res.status(500).json({ error: "Gagal memuat rincian sumber lead" });
  }
});

analyticsRouter.get("/traffic", async (req, res) => {
  try {
    const { from, to } = req.query;
    // Traffic SELALU harian — "spike" itu konsep harian; bucket bulanan
    // membuat lonjakan 1 hari lenyap ditelan rata-rata sebulan.
    const sekarang = nowPartsWIB();
    const mulai   = from ? startOfDayWIB(from) : startOfMonthWIB(sekarang.year, sekarang.month);
    const selesai = to   ? endOfDayExclusiveWIB(to) : new Date();
    const panjangMs = selesai - mulai;

    // Ditarik mundur 7 hari supaya hari-hari PERTAMA di rentang juga punya
    // baseline (kalau tidak, minggu pertama selalu "tidak ada pembanding").
    const WARMUP_HARI = 7;
    const warmup = new Date(mulai.getTime() - WARMUP_HARI * 86_400_000);
    const prevMulai = new Date(mulai.getTime() - panjangMs);

    const [dailyRaw, volHeatRaw, respHeatRaw, prevCount, sourceGroups] = await Promise.all([
      prisma.$queryRaw`
        SELECT to_char(date_trunc('day', "createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jakarta'), 'YYYY-MM-DD') AS bucket,
               COUNT(*)::int AS value
        FROM "Customer"
        WHERE "createdAt" >= ${warmup} AND "createdAt" < ${selesai}
        GROUP BY 1 ORDER BY 1`,

      // Heatmap VOLUME: kapan lead masuk (hari-dalam-minggu × jam WIB).
      prisma.$queryRaw`
        SELECT EXTRACT(dow  FROM "createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jakarta')::int AS dow,
               EXTRACT(hour FROM "createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jakarta')::int AS jam,
               COUNT(*)::int AS n
        FROM "Customer"
        WHERE "createdAt" >= ${mulai} AND "createdAt" < ${selesai}
        GROUP BY 1, 2`,

      // Heatmap RESPONS: seberapa cepat dibalas, di-bucket menurut jam pesan
      // PERTAMA customer masuk (bukan jam balasan) — itu yang menjawab
      // "kalau customer chat jam segini, berapa lama dia menunggu".
      prisma.$queryRaw`
        SELECT EXTRACT(dow  FROM i.ts AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jakarta')::int AS dow,
               EXTRACT(hour FROM i.ts AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jakarta')::int AS jam,
               COUNT(*)::int AS n,
               AVG(EXTRACT(EPOCH FROM (o.ts - i.ts)) / 60)::float AS avg_minutes,
               COUNT(*) FILTER (WHERE EXTRACT(EPOCH FROM (o.ts - i.ts)) / 60 > 60)::int AS sla_breach
        FROM (SELECT "conversationId" cid, MIN("createdAt") ts FROM "Message" WHERE direction = 'INBOUND'  GROUP BY 1) i
        JOIN (SELECT "conversationId" cid, MIN("createdAt") ts FROM "Message" WHERE direction = 'OUTBOUND' GROUP BY 1) o ON o.cid = i.cid
        JOIN "Conversation" c ON c.id = i.cid
        WHERE c."type" = 'INDIVIDUAL' AND o.ts > i.ts
          AND i.ts >= ${mulai} AND i.ts < ${selesai}
        GROUP BY 1, 2`,

      prisma.customer.count({ where: { createdAt: { gte: prevMulai, lt: mulai } } }),

      prisma.customer.groupBy({
        by: ["leadSource", "leadSourceConfirmed"],
        where: { createdAt: { gte: mulai, lt: selesai } },
        _count: { _all: true },
      }),
    ]);

    // ── Deret harian + baseline + flag spike ──────────────────────────────
    const countByDay = Object.fromEntries(dailyRaw.map((r) => [r.bucket, Number(r.value)]));
    const semuaHari = [];
    for (let t = warmup.getTime(); t < selesai.getTime(); t += 86_400_000) {
      const b = namaBucketWIB(new Date(t), true);
      semuaHari.push({ bucket: b, value: countByDay[b] || 0 });
    }
    // Nama bucket hari pertama yang BOLEH dilaporkan (sebelum ini = warm-up
    // yang cuma dipakai menghitung baseline). String ISO "YYYY-MM-DD" aman
    // dibandingkan secara leksikografis.
    const bucketMulai = namaBucketWIB(mulai, true);
    // Hari BERJALAN (WIB) belum lengkap — jam-jam sisanya belum terjadi, jadi
    // angkanya pasti lebih rendah dari hari penuh. Tanpa penanda ini "hari ini"
    // hampir SELALU ditandai "drop" tiap kali laporan dibuka siang hari, yang
    // terbaca sebagai alarm palsu.
    const bucketHariIni = `${sekarang.year}-${String(sekarang.month).padStart(2, "0")}-${String(sekarang.day).padStart(2, "0")}`;

    const daily = [];
    for (let i = 0; i < semuaHari.length; i++) {
      const d = semuaHari[i];
      if (d.bucket < bucketMulai) continue; // masih warm-up, tidak dilaporkan
      const window = semuaHari.slice(Math.max(0, i - WARMUP_HARI), i).map((x) => x.value);
      let baseline = null, upper = null, lower = null, status = "normal";
      if (window.length >= 4) { // butuh minimal 4 hari supaya SD tidak omong kosong
        const mean = window.reduce((s, v) => s + v, 0) / window.length;
        const varians = window.reduce((s, v) => s + (v - mean) ** 2, 0) / window.length;
        const sd = Math.sqrt(varians);
        baseline = Math.round(mean * 10) / 10;
        upper = Math.round((mean + 2 * sd) * 10) / 10;
        lower = Math.round(Math.max(0, mean - 2 * sd) * 10) / 10;
        if (d.value > upper) status = "spike";
        else if (d.value < lower) status = "drop";
      }
      // Hari berjalan: tetap tampilkan angkanya, TAPI jangan divonis
      // spike/drop — pembandingnya tidak setara (hari belum selesai).
      const partial = d.bucket === bucketHariIni;
      if (partial) status = "normal";
      daily.push({
        bucket: d.bucket, value: d.value, baseline, upper, lower, status, partial,
        deltaPct: baseline > 0 && !partial ? Math.round(((d.value - baseline) / baseline) * 100) : null,
      });
    }

    // ── Heatmap 7×24 ─────────────────────────────────────────────────────
    const volCell  = {};
    for (const r of volHeatRaw)  volCell[`${r.dow}-${r.jam}`] = Number(r.n);
    const respCell = {};
    for (const r of respHeatRaw) {
      respCell[`${r.dow}-${r.jam}`] = {
        n: Number(r.n),
        avgMinutes: r.avg_minutes != null ? Math.round(Number(r.avg_minutes)) : null,
        slaBreach: Number(r.sla_breach),
      };
    }
    const heatmap = [];
    for (let dow = 0; dow < 7; dow++) {
      for (let jam = 0; jam < 24; jam++) {
        const rc = respCell[`${dow}-${jam}`];
        heatmap.push({
          dow, jam,
          leads: volCell[`${dow}-${jam}`] || 0,
          responded: rc?.n || 0,
          avgMinutes: rc?.avgMinutes ?? null,
          slaBreach: rc?.slaBreach || 0,
        });
      }
    }

    // ── Agregat per JAM (lintas hari) → jam sibuk & jam rawan ────────────
    const perJam = Array.from({ length: 24 }, (_, jam) => ({ jam, leads: 0, responded: 0, totalMenit: 0, slaBreach: 0 }));
    for (const c of heatmap) {
      const p = perJam[c.jam];
      p.leads += c.leads;
      p.slaBreach += c.slaBreach;
      if (c.avgMinutes != null && c.responded > 0) {
        p.responded += c.responded;
        p.totalMenit += c.avgMinutes * c.responded; // rata-rata TERBOBOT, bukan rata-rata dari rata-rata
      }
    }
    const hourly = perJam.map((p) => ({
      jam: p.jam, leads: p.leads, responded: p.responded, slaBreach: p.slaBreach,
      avgMinutes: p.responded > 0 ? Math.round(p.totalMenit / p.responded) : null,
    }));

    const totalLeads = hourly.reduce((s, h) => s + h.leads, 0);

    // ── Rata-rata harian, dan respons keseluruhan ────────────────────────
    // Sebelum ini tab Traffic cuma punya TOTAL — tidak ada cara melihat
    // "apakah progress-nya membaik" tanpa membagi sendiri di kepala.
    //
    // Hari BERJALAN (partial) DIKECUALIKAN dari rata-rata — kalau ikut,
    // rata-rata selalu turun palsu tiap kali laporan dibuka siang hari
    // (hari itu belum selesai), bukan karena traffic beneran turun.
    const hariLengkap = daily.filter((d) => !d.partial);
    const rataRataHarian = hariLengkap.length > 0
      ? Math.round((hariLengkap.reduce((s, d) => s + d.value, 0) / hariLengkap.length) * 10) / 10
      : null;

    // Pembanding: rata-rata harian periode SEBELUMNYA (panjang sama persis).
    // prevCount sudah dihitung di atas untuk growthPct total; di sini
    // dipakai lagi supaya konsisten dengan angka itu, bukan query baru.
    const jumlahHariPeriode = Math.max(1, Math.round(panjangMs / 86_400_000));
    const rataRataHarianPrev = jumlahHariPeriode > 0
      ? Math.round((prevCount / jumlahHariPeriode) * 10) / 10
      : null;
    const rataRataGrowthPct = rataRataHarianPrev > 0 && rataRataHarian != null
      ? Math.round(((rataRataHarian - rataRataHarianPrev) / rataRataHarianPrev) * 100)
      : null;

    // Rata-rata waktu respons SELURUH periode (bukan per-jam seperti
    // `hourly`) — angka tunggal untuk "secara umum kita cepat atau lambat
    // balas". Terbobot per jumlah percakapan, BUKAN rata-rata dari
    // rata-rata 24 angka jam (itu akan menyamakan bobot jam sepi dengan
    // jam ramai, padahal jam ramai jauh lebih menentukan pengalaman
    // customer secara keseluruhan).
    const totalRespondedKeseluruhan = hourly.reduce((s, h) => s + h.responded, 0);
    const totalMenitKeseluruhan = hourly.reduce((s, h) => s + (h.avgMinutes != null ? h.avgMinutes * h.responded : 0), 0);
    const avgResponseMinutes = totalRespondedKeseluruhan > 0
      ? Math.round(totalMenitKeseluruhan / totalRespondedKeseluruhan)
      : null;
    const busiestHours = [...hourly].sort((a, b) => b.leads - a.leads).slice(0, 3);
    // Jam RAWAN = respons terburuk, TAPI dibatasi jam yang volumenya berarti
    // (>=5% rata-rata per jam). Tanpa filter ini, jam 03:00 dengan 2 chat
    // yang kebetulan telat akan selalu menang — bukan masalah nyata.
    const ambangVolume = Math.max(3, (totalLeads / 24) * 0.05);
    const riskiestHours = hourly
      .filter((h) => h.avgMinutes != null && h.leads >= ambangVolume)
      .sort((a, b) => b.avgMinutes - a.avgMinutes)
      .slice(0, 3);

    // ── Kualitas atribusi ────────────────────────────────────────────────
    // Lead dianggap "teridentifikasi" kalau sumbernya BUKAN default
    // WHATSAPP_DIRECT-belum-dikonfirmasi. Angkanya ditampilkan apa adanya
    // sebagai ukuran KUALITAS DATA, bukan disamarkan jadi donut satu irisan
    // yang terlihat seperti insight.
    //
    // Riwayat: angka ini pernah ~1% karena atribusi Meta CTWA tidak pernah
    // kena (path payload salah) dan tag website belum ada. Setelah keduanya
    // dibereskan + backfill 13 Agt 2026, jadi ~63%. Sisa WHATSAPP_DIRECT
    // adalah lead yang memang tidak berjejak teknis (mis. lihat profil IG
    // lalu ketik nomor manual) — hanya bisa ditutup lewat konfirmasi sales.
    let teridentifikasi = 0;
    let belumDikonfirmasi = 0;
    const bySource = {};
    for (const g of sourceGroups) {
      const n = g._count._all;
      const src = g.leadSource || "OTHER";
      bySource[src] = (bySource[src] || 0) + n;
      if (src !== "WHATSAPP_DIRECT" || g.leadSourceConfirmed) teridentifikasi += n;
      // Dipakai widget "Konfirmasi Sumber" — antrean WHATSAPP_DIRECT dalam
      // periode ini yang belum pernah ditanya/dikoreksi manual oleh sales.
      // Ini SATU-SATUNYA cara menutup lead yang lihat IG/dari mulut ke
      // mulut lalu chat manual (tidak ada jejak teknis untuk itu).
      if (src === "WHATSAPP_DIRECT" && !g.leadSourceConfirmed) belumDikonfirmasi += n;
    }

    res.json({
      totalLeads,
      prevTotalLeads: prevCount,
      growthPct: prevCount > 0 ? Math.round(((totalLeads - prevCount) / prevCount) * 100) : null,
      rataRataHarian,
      rataRataHarianPrev,
      rataRataGrowthPct,
      avgResponseMinutes,
      daily,
      heatmap,
      hourly,
      busiestHours,
      riskiestHours,
      atribusi: {
        total: totalLeads,
        teridentifikasi,
        rate: totalLeads > 0 ? Math.round((teridentifikasi / totalLeads) * 1000) / 10 : null,
        bySource: Object.entries(bySource).map(([source, count]) => ({ source, count })),
        belumDikonfirmasi,
      },
    });
  } catch (err) {
    console.error("traffic error:", err);
    res.status(500).json({ error: "Gagal memuat laporan traffic" });
  }
});

// ── GET /analytics/pipeline-velocity?from=&to= ─────────────────────────────
// Sisi WAKTU dari pipeline — pembaca pertama tabel pipeline_transitions.
// /pipeline-funnel menjawab "berapa banyak di stage X SEKARANG"; endpoint ini
// menjawab "berapa LAMA mereka tertahan di sana" dan "berapa yang BERGERAK".
//
// CARA HITUNG "lama di stage": untuk setiap transisi, waktu yang dihabiskan di
// `from_stage` = created_at transisi ini − created_at transisi SEBELUMNYA
// (customer yang sama, via LAG). Untuk transisi PERTAMA seorang customer kita
// tidak punya catatan kapan dia masuk stage itu, jadi fallback ke
// Customer.createdAt.
//
// ⚠️ KETERBATASAN YANG HARUS DIKOMUNIKASIKAN KE UI: tabel ini baru mulai
// merekam 25 Juli 2026 dan TIDAK BISA di-backfill (perpindahan stage sebelum
// itu tidak pernah dicatat di mana pun — Customer.updatedAt hanya tahu KAPAN
// terakhir berubah, bukan DARI stage apa). Jadi `dataStartedAt` +
// `totalTransitions` ikut dikirim supaya UI bisa jujur bilang "data baru
// terkumpul sejak ..." alih-alih terlihat seperti fitur rusak.
//
// Scoping: mengikuti /pipeline-funnel (requireAuth level router, tanpa role
// scoping tambahan) — halaman Laporan sendiri sudah adminOnly di sidebar.
analyticsRouter.get("/pipeline-velocity", async (req, res) => {
  try {
    const { from, to } = req.query;
    // Default 90 hari terakhir kalau tidak ada filter — cukup panjang supaya
    // rata-rata tidak liar saat data masih sedikit.
    const mulai   = from ? startOfDayWIB(from) : new Date(Date.now() - 90 * 86_400_000);
    const selesai = to   ? endOfDayExclusiveWIB(to) : new Date();

    const [durasiRaw, masukStageRaw, bulananRaw, metaRaw] = await Promise.all([
      // Rata-rata hari tertahan di tiap stage
      prisma.$queryRaw`
        WITH t AS (
          SELECT pt.customer_id, pt.from_stage, pt.created_at,
                 LAG(pt.created_at) OVER (PARTITION BY pt.customer_id ORDER BY pt.created_at) AS prev_at,
                 c."createdAt" AS cust_created
          FROM pipeline_transitions pt
          JOIN "Customer" c ON c.id = pt.customer_id
        )
        SELECT from_stage AS stage,
               AVG(EXTRACT(EPOCH FROM (created_at - COALESCE(prev_at, cust_created))) / 86400.0) AS avg_days,
               COUNT(*)::int AS sample
        FROM t
        WHERE created_at >= ${mulai} AND created_at < ${selesai}
          -- buang durasi negatif (data aneh: Customer.createdAt > transisi)
          AND COALESCE(prev_at, cust_created) <= created_at
        GROUP BY 1
      `,

      // Berapa customer BERGERAK masuk ke tiap stage dalam periode
      prisma.$queryRaw`
        SELECT to_stage AS stage, COUNT(*)::int AS count
        FROM pipeline_transitions
        WHERE created_at >= ${mulai} AND created_at < ${selesai}
        GROUP BY 1
      `,

      // Tren bulanan masuk TRANSACTION (dulu COMPLETED, dihapus saat
      // restrukturisasi pipeline 7→4 stage 24 Agustus 2026) — bucket WIB
      // (lihat catatan di /overview)
      prisma.$queryRaw`
        SELECT to_char(date_trunc('month', created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jakarta'), 'YYYY-MM') AS month,
               COUNT(*)::int AS value
        FROM pipeline_transitions
        WHERE to_stage = 'TRANSACTION'
          AND created_at >= NOW() - INTERVAL '6 months'
        GROUP BY 1 ORDER BY 1
      `,

      // Meta: sejak kapan data ada + total baris (untuk empty state jujur)
      prisma.$queryRaw`
        SELECT MIN(created_at) AS started_at, COUNT(*)::int AS total
        FROM pipeline_transitions
      `,
    ]);

    const STAGES = ["NEW", "PROSPECT", "TRANSACTION", "REVIEWED", "SPAM"];
    const durasiMap = Object.fromEntries(durasiRaw.map((r) => [r.stage, r]));
    const masukMap  = Object.fromEntries(masukStageRaw.map((r) => [r.stage, r.count]));

    res.json({
      // Selalu 4 stage (urut kanonik) supaya UI tidak perlu handle stage hilang
      avgDaysInStage: STAGES.map((s) => ({
        stage:   s,
        avgDays: durasiMap[s]?.avg_days != null ? Number(Number(durasiMap[s].avg_days).toFixed(1)) : null,
        sample:  durasiMap[s]?.sample || 0,
      })),
      movedToStage: STAGES.map((s) => ({ stage: s, count: masukMap[s] || 0 })),
      monthlyWon: bulananRaw.map((r) => ({ month: r.month, value: Number(r.value) })),
      dataStartedAt: metaRaw[0]?.started_at || null,
      totalTransitions: metaRaw[0]?.total || 0,
    });
  } catch (err) {
    console.error("pipeline-velocity error:", err);
    res.status(500).json({ error: "Gagal memuat kecepatan pipeline" });
  }
});

// Order terbaru (untuk widget "Recent Orders" di Dashboard) — dibuat karena
// belum ada endpoint listing Order langsung, cuma agregat per-customer di
// GET /api/customers (lihat CLAUDE.md/riset dashboard redesign).
analyticsRouter.get("/recent-orders", async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 8, 50);
  try {
    const orders = await prisma.order.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        items: { orderBy: { sortOrder: "asc" }, select: { layananName: true } },
      },
    });

    const CATEGORY_FALLBACK = { BARU: "Kasur Baru", SEWA: "Kasur Sewa", LAYANAN: "Layanan" };

    const result = orders.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      customerId: o.customer?.id || null,
      customerName: o.customer?.name || o.customer?.phone || "Pelanggan",
      product: o.items.map((i) => i.layananName).filter(Boolean).join(", ") || CATEGORY_FALLBACK[o.category] || "Layanan",
      category: o.category,
      value: o.value,
      status: o.status,
      hasComplaint: o.hasComplaint,
      createdAt: o.createdAt,
    }));

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   WAVE 2B — DASHBOARD BAND 2 ("Sano Intelligence"), 3 endpoint READ-ONLY.
   Semua di bawah requireAuth (router-level, lihat atas). SCOPING per-role:
     ADMIN → seluruh tim; SALES → miliknya + yang belum diambil (claimable).
   TIDAK menyentuh WAHA/SSE/webhook/inbox/schema. Bentuk respons = kontrak di
   frontend features/dashboard/data/contracts.js.
   ═══════════════════════════════════════════════════════════════════════════ */

// Rupiah singkat untuk field `impact` (server tak punya util frontend).
function rpShort(n) {
  const v = n || 0;
  if (v >= 1_000_000) return "Rp" + (v / 1_000_000).toFixed(1).replace(/\.0$/, "") + "jt";
  if (v >= 1_000) return "Rp" + Math.round(v / 1_000) + "rb";
  return "Rp" + v;
}

// ── GET /analytics/follow-ups ──────────────────────────────────────────────
// Percakapan OPEN yang pesan TERAKHIRNYA dari customer (INBOUND) = menunggu
// balasan. Semua ditampilkan, diberi severity tier (>1j/>3j/>24j).
analyticsRouter.get("/follow-ups", async (req, res) => {
  try {
    const { id: userId, role } = req.user;
    const scope = role === "ADMIN"
      ? {}
      : { OR: [{ assignedToId: userId }, { assignedToId: null }] };

    // SCALABILITY: fetch dibatasi 100 conv OPEN + filter "pesan terakhir INBOUND"
    // di JS. Aman di skala saat ini (≤ratusan conv open). Kalau volume tumbuh
    // besar, ganti dengan denormalisasi (mis. Conversation.lastMessageDirection)
    // atau raw SQL DISTINCT ON + WHERE direction='INBOUND' supaya filter terjadi
    // di DB, bukan mem-fetch semua lalu buang sebagian.
    const convos = await prisma.conversation.findMany({
      where: { status: "OPEN", type: "INDIVIDUAL", ...scope },
      select: {
        id: true, customerId: true, assignedToId: true, lastMessageAt: true, sessionId: true,
        customer: { select: { name: true } },
        assignedTo: { select: { name: true } },
        messages: { orderBy: { createdAt: "desc" }, take: 1, select: { direction: true, content: true } },
      },
      orderBy: { lastMessageAt: "asc" },
      take: 100,
    });

    // ── VERIFIKASI LOGIKA FOLLOW-UP (refinement Wave 2B) ──────────────────────
    // "Menunggu balasan kita" HANYA bila pesan TERAKHIR di percakapan itu dari
    // customer (direction=INBOUND). Kalau sales SUDAH membalas, pesan terakhir
    // pasti OUTBOUND → OTOMATIS TIDAK lolos filter ini (tidak di-flag). Jadi
    // "sales sudah balas, customer diam" TIDAK muncul; hanya "customer sudah
    // kirim, sales belum balas" yang muncul.
    const now = Date.now();
    const waiting = convos
      .filter((c) => c.messages[0]?.direction === "INBOUND")
      .map((c) => ({ c, waitingMinutes: Math.floor((now - new Date(c.lastMessageAt).getTime()) / 60000) }))
      .sort((a, b) => b.waitingMinutes - a.waitingMinutes);

    // DEDUP per customer: 1 customer bisa punya >1 conversation OPEN — tampilkan
    // sekali saja (yang paling lama menunggu). Lihat catatan dedup lintas-widget
    // di header hot-leads.
    const seen = new Set();
    const items = [];
    for (const { c, waitingMinutes } of waiting) {
      if (c.customerId && seen.has(c.customerId)) continue;
      if (c.customerId) seen.add(c.customerId);
      const severity =
        waitingMinutes >= 1440 ? "critical" :
        waitingMinutes >= 180  ? "high" :
        waitingMinutes >= 60   ? "medium" : "low";
      items.push({
        id: c.id,
        customerName: c.customer?.name || "Tanpa nama",
        preview: c.messages[0]?.content || "",
        waitingMinutes,
        severity,
        nextAction: c.assignedToId ? "Balas" : "Ambil & balas",
        assignedTo: c.assignedTo?.name || null,
        unassigned: !c.assignedToId,
        sessionLabel: c.sessionId || "CS-1",
      });
      if (items.length >= 20) break;
    }

    res.json({ items });
  } catch (err) {
    console.error("follow-ups error:", err);
    res.status(500).json({ error: "Gagal memuat follow-up" });
  }
});

// ── GET /analytics/hot-leads ───────────────────────────────────────────────
// Skoring TRANSPARAN & bisa diatur — bobot di satu const. Kembalikan score +
// signals + reason + nextAction (bukan skor buram).
//
// PEMISAHAN SKOR (refinement Wave 2B): `signalScore` = skor rule-based sinyal
// (yang sekarang). `aiConfidence` disiapkan NULL untuk keyakinan model AI di
// masa depan (Phase 4) — supaya dua konsep tidak tercampur. `score` = signalScore
// untuk kompatibilitas UI sekarang.
//
// DEDUP LINTAS-WIDGET: hot-leads sudah 1 baris per customer (findMany Customer),
// follow-ups sudah dedup per customer. Overlap ANTAR widget (customer panas yang
// JUGA menunggu balasan) DISENGAJA — dua lensa berbeda dari aksi yang sama.
// Recommendations hanya menampilkan HITUNGAN agregat (bukan daftar customer),
// jadi tidak menduplikasi nama. Kalau nanti ingin saling-eksklusif, koordinasikan
// via customerId lintas endpoint (belum diperlukan sekarang).
// HOT_WEIGHTS.stage REDESIGN (24 Agustus 2026, restrukturisasi pipeline
// 7→4): dulu {QUOTED:35, QUALIFIED:20} — dua stage aktif dengan bobot
// beda, QUOTED lebih tinggi karena "sudah ditawari harga". Sekarang cuma
// ada SATU stage aktif (PROSPECT), jadi diferensiasi "seberapa panas"
// dipindah SEPENUHNYA ke sinyal intent keyword di bawah (price/catalog/
// order) — customer PROSPECT yang pesannya mengandung kata harga/order
// otomatis lebih tinggi skornya lewat `intent`, bukan lewat field stage
// yang sudah tidak membedakan itu lagi.
const HOT_WEIGHTS = {
  stage:   { PROSPECT: 20 },
  recency: [[30, 25], [120, 18], [360, 10], [1440, 5]], // [maxMenit, poin]
  intent:  { price: 15, catalog: 10, order: 12 },        // cap total 25
  unansweredBonus: 10,                                    // pesan terakhir INBOUND & nunggu >2j
};
const INTENT_RE = {
  price:   /harga|berapa|price|nego/i,
  catalog: /katalog|foto|gambar|brosur/i,
  order:   /order|beli|pesan|\bdp\b|bayar|checkout/i,
};

analyticsRouter.get("/hot-leads", async (req, res) => {
  try {
    const { id: userId, role } = req.user;
    const scope = role === "ADMIN"
      ? {}
      : { OR: [{ assignedSalesId: userId }, { assignedSalesId: null }] };
    const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000);

    // SCALABILITY: kandidat dibatasi (stage PROSPECT + aktif 7 hari +
    // take 80), skoring di JS. Aman di skala saat ini. Kalau customer aktif
    // membengkak: pindahkan penyaringan kandidat & pra-agregasi (mis. MAX order
    // value, recency) ke SQL/prisma.aggregate atau materialized view, dan simpan
    // signalScore terhitung (cron) daripada menghitung tiap request.
    const customers = await prisma.customer.findMany({
      where: {
        pipelineStage: "PROSPECT",
        ...scope,
        conversations: { some: { type: "INDIVIDUAL", lastMessageAt: { gt: sevenDaysAgo } } },
      },
      select: {
        id: true, name: true, phone: true, pipelineStage: true,
        assignedSales: { select: { name: true } },
        orders: { select: { value: true } },
        conversations: {
          where: { type: "INDIVIDUAL" },
          orderBy: { lastMessageAt: "desc" }, take: 1,
          select: {
            // `id` ditambahkan supaya frontend bisa deep-link langsung ke
            // percakapan ini di Inbox (?conv=<id>) — sebelumnya tidak dipilih,
            // jadi kartu "Lead Panas" hanya bisa mengarah ke /pipeline umum,
            // sales harus cari sendiri percakapannya secara manual.
            id: true, lastMessageAt: true, sessionId: true,
            messages: { orderBy: { createdAt: "desc" }, take: 1, select: { direction: true, content: true } },
          },
        },
      },
      take: 80,
    });

    const now = Date.now();
    const items = customers.map((c) => {
      const conv = c.conversations[0];
      const lastMsg = conv?.messages[0];
      const minsSince = conv ? Math.floor((now - new Date(conv.lastMessageAt).getTime()) / 60000) : 99999;
      const valueEstimate = c.orders.reduce((m, o) => Math.max(m, o.value || 0), 0);
      const text = lastMsg?.content || "";
      const signals = [];

      // — skoring transparan —
      // Sinyal intent dihitung SEKALI di sini (dulu di-test ulang 2x per jenis
      // di reason/nextAction) — sekaligus jadi sub-sinyal yang menggantikan
      // peran QUOTED lama untuk membedakan "prospek biasa" vs "prospek yang
      // sudah tunjukkan minat beli konkret" (lihat catatan HOT_WEIGHTS.stage).
      const sinyalHarga = INTENT_RE.price.test(text);
      const sinyalKatalog = INTENT_RE.catalog.test(text);
      const sinyalOrder = INTENT_RE.order.test(text);

      let score = HOT_WEIGHTS.stage[c.pipelineStage] || 0;
      for (const [maxMin, pts] of HOT_WEIGHTS.recency) { if (minsSince <= maxMin) { score += pts; break; } }

      let intentPts = 0;
      if (sinyalHarga)   { intentPts += HOT_WEIGHTS.intent.price;   signals.push("Tanya harga"); }
      if (sinyalKatalog) { intentPts += HOT_WEIGHTS.intent.catalog; signals.push("Minta katalog/foto"); }
      if (sinyalOrder)   { intentPts += HOT_WEIGHTS.intent.order;   signals.push("Sinyal order"); }
      score += Math.min(intentPts, 25);

      const unanswered = lastMsg?.direction === "INBOUND" && minsSince > 120;
      if (unanswered) { score += HOT_WEIGHTS.unansweredBonus; signals.push(`Belum dibalas ${Math.floor(minsSince / 60)}j`); }

      score = Math.max(0, Math.min(100, Math.round(score)));
      const reason = unanswered ? "Sinyal beli, belum di-follow up"
        : (sinyalHarga || sinyalOrder) ? "Sudah tunjukkan minat beli, minat tinggi"
        : "Prospek aktif, minat tinggi";
      const nextAction = sinyalHarga ? "Follow up — kirim rincian harga"
        : sinyalKatalog ? "Kirim katalog + tanyakan ukuran"
        : sinyalOrder ? "Bantu proses order — konfirmasi detail & pembayaran"
        : "Tawarkan rekomendasi + jadwalkan";

      return {
        id: c.id, name: c.name || "Tanpa nama", phone: c.phone || "",
        stage: c.pipelineStage,
        score,                 // = signalScore (kompat UI sekarang)
        signalScore: score,    // skor rule-based sinyal (eksplisit)
        aiConfidence: null,    // RESERVED: keyakinan model AI (Phase 4)
        reason, signals, nextAction,
        valueEstimate,
        assignedTo: c.assignedSales?.name || null,
        lastMessageAt: conv?.lastMessageAt || null,
        sessionLabel: conv?.sessionId || "CS-1",
        // null kalau customer ini belum pernah punya percakapan INDIVIDUAL —
        // frontend HARUS jaga-jaga (fallback ke /pipeline), jangan asumsikan selalu ada.
        conversationId: conv?.id || null,
      };
    })
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    res.json({ items });
  } catch (err) {
    console.error("hot-leads error:", err);
    res.status(500).json({ error: "Gagal memuat hot leads" });
  }
});

// ── GET /analytics/recommendations ─────────────────────────────────────────
// Sintesis rule-based (BUKAN LLM) atas sinyal nyata → aksi terurut.
const SEV_RANK = { high: 0, med: 1, low: 2 };

analyticsRouter.get("/recommendations", async (req, res) => {
  try {
    const { id: userId, role } = req.user;
    const isAdmin = role === "ADMIN";
    const custScopeRel = isAdmin ? {} : { customer: { assignedSalesId: userId } };
    const convScope = isAdmin ? {} : { OR: [{ assignedToId: userId }, { assignedToId: null }] };
    const now = Date.now();

    // Kumpulkan sinyal (query kecil, paralel).
    const [openConvos, unassignedCount, readyOrders, complaintCount] = await Promise.all([
      prisma.conversation.findMany({
        where: { status: "OPEN", type: "INDIVIDUAL", ...convScope },
        select: { lastMessageAt: true, messages: { orderBy: { createdAt: "desc" }, take: 1, select: { direction: true } } },
        take: 300,
      }),
      prisma.conversation.count({ where: { status: "OPEN", type: "INDIVIDUAL", assignedToId: null } }),
      prisma.order.findMany({ where: { status: "READY", ...custScopeRel }, select: { value: true } }),
      prisma.order.count({ where: { hasComplaint: true, ...custScopeRel } }),
    ]);

    const unansweredOver2h = openConvos.filter(
      (c) => c.messages[0]?.direction === "INBOUND" && (now - new Date(c.lastMessageAt).getTime()) > 2 * 3_600_000
    ).length;

    const items = [];
    if (unansweredOver2h > 0)
      items.push({ id: "followup", type: "followup", severity: "high", count: unansweredOver2h,
        title: `${unansweredOver2h} lead belum di-follow up`, detail: "Pesan terakhir dari customer >2 jam lalu, belum dibalas.",
        actionLabel: "Buka lead", href: "/inbox" });
    if (complaintCount > 0)
      items.push({ id: "complaint", type: "complaint", severity: "high", count: complaintCount,
        title: `${complaintCount} komplain perlu ditangani`, detail: "Komplain butuh telepon langsung — jangan biarkan menunggu.",
        actionLabel: "Lihat", href: "/customers" });
    if (isAdmin && unassignedCount > 0)
      items.push({ id: "unassigned", type: "unassigned", severity: "high", count: unassignedCount,
        title: `${unassignedCount} percakapan belum diambil`, detail: "Masuk antrean, belum ada sales yang klaim.",
        actionLabel: "Ambil sekarang", href: "/inbox" });
    if (readyOrders.length > 0) {
      const sum = readyOrders.reduce((s, o) => s + (o.value || 0), 0);
      items.push({ id: "order", type: "order", severity: "med", count: readyOrders.length,
        title: `${readyOrders.length} order siap dikonfirmasi`, detail: "Status siap kirim — hubungi customer untuk penjadwalan.",
        impact: sum > 0 ? `${rpShort(sum)} menunggu` : undefined, actionLabel: "Lihat order", href: "/customers" });
    }

    // Rule target: rep < 50% dengan sisa hari <= 12 (bulan berjalan).
    // Bulan & sisa hari dihitung menurut kalender WIB — kalau pakai jam
    // container (UTC), tanggal 1 jam 00:00-07:00 WIB masih dianggap bulan
    // lalu sehingga "sisa hari" salah ~30 hari.
    const { year, month } = nowPartsWIB();
    const monthStart = startOfMonthWIB(year, month);
    const monthEnd = endOfMonthExclusiveWIB(year, month);
    const daysLeft = Math.ceil((monthEnd - Date.now()) / 86_400_000);
    if (daysLeft <= 12) {
      const targets = await prisma.salesTarget.findMany({
        where: { year, month, targetValue: { gt: 0 }, ...(isAdmin ? {} : { userId }) },
        include: { user: { select: { name: true } } },
      });
      // SCALABILITY: 1 aggregate per target (≤7 sales sekarang → ≤7 query kecil).
      // Kalau jumlah sales tumbuh banyak, ganti loop N-query ini dengan SATU
      // groupBy (butuh salesId di Order, atau raw SQL join Customer→Order
      // GROUP BY assignedSalesId) supaya cukup 1 query.
      for (const t of targets) {
        const agg = await prisma.order.aggregate({
          _sum: { value: true },
          where: { createdAt: { gte: monthStart, lt: monthEnd }, customer: { assignedSalesId: t.userId } },
        });
        const achieved = agg._sum.value || 0;
        const pct = Math.round((achieved / t.targetValue) * 100);
        if (pct < 50)
          items.push({ id: `target-${t.userId}`, type: "target", severity: "med",
            title: `Target ${t.user?.name || "sales"} ${pct}% · ${daysLeft} hari tersisa`,
            detail: "Perlu dorongan untuk mengejar target bulan ini.",
            impact: `${rpShort(t.targetValue - achieved)} di bawah target`,
            actionLabel: "Lihat performa", href: "/laporan" });
      }
    }

    items.sort((a, b) => (SEV_RANK[a.severity] ?? 9) - (SEV_RANK[b.severity] ?? 9));
    res.json({ items: items.slice(0, 6) });
  } catch (err) {
    console.error("recommendations error:", err);
    res.status(500).json({ error: "Gagal memuat rekomendasi" });
  }
});
