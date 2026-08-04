import express from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import {
  startOfDayWIB, endOfDayExclusiveWIB,
  startOfMonthWIB, endOfMonthExclusiveWIB, nowPartsWIB,
} from "../utils/wib.js";

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

// Periode sebelumnya dengan PANJANG SAMA, tepat bersambung sebelum `from`.
// Contoh: 1-30 Juni (30 hari) → periode sebelumnya 2-31 Mei (30 hari).
function buildPrevRange(from, to) {
  if (!from || !to) return null;
  const mulai   = startOfDayWIB(from);
  const selesai = endOfDayExclusiveWIB(to);
  const panjangMs = selesai - mulai;
  return {
    gte: new Date(mulai.getTime() - panjangMs),
    lt:  mulai,
  };
}

analyticsRouter.get("/overview", async (req, res) => {
  try {
    const { from, to } = req.query;
    const orderWhere = buildDateWhere(from, to);
    const convWhere  = buildDateWhere(from, to);
    const custWhere  = buildDateWhere(from, to);
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
    ] = await Promise.all([
      prisma.customer.count({ where: custWhere }),
      prevRange ? prisma.customer.count({ where: { createdAt: prevRange } }) : Promise.resolve(null),

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

      prisma.customer.groupBy({ by: ["leadSource"], _count: { _all: true }, where: custWhere }),

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
          ...custWhere,
          orders: { some: { status: { not: "CANCELLED" } } },
        },
      }),
    ]);

    // BUG YANG DIPERBAIKI (26 Jul 2026): dulu `prev === 0 && curr > 0` →
    // return 100, jadi UI menampilkan badge "+100%" percaya diri padahal
    // periode pembanding KOSONG (sistem baru jalan, belum ada baseline).
    // "+100%" itu bukan pertumbuhan — itu pembagian dengan nol. Di Laporan
    // produksi SEMUA kartu tampil "+100%" bersamaan, yang jelas menyesatkan
    // owner. Sekarang null = "tidak bisa dihitung", dan frontend merender
    // "—" / "belum ada pembanding", BUKAN angka palsu.
    function growth(curr, prev) {
      if (prev === null || prev === undefined) return null;
      if (prev === 0) return null;
      return Math.round(((curr - prev) / prev) * 100);
    }

    res.json({
      // Pelanggan
      newCustomers: totalCustomers,
      totalCustomers,
      growthCustomers: growth(totalCustomers, totalCustomersPrev),
      customersWithOrders: customersWithOrdersCount,

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
// Dipakai /revenue-series, /business-summary, dan /sales-report supaya
// granularitas & pengisian bucket kosong TIDAK diimplementasikan ulang
// (dan tidak bisa saling drift) di tiap endpoint.
//
// Granularitas: <= 92 hari → HARIAN, lebih panjang → BULANAN. Alasannya
// praktis: 30 hari dalam bucket BULANAN = 1 titik (grafik tampak kosong,
// bug yang sudah pernah terjadi di kartu Sales Overview), sedangkan 1 tahun
// harian = 365 titik yang tidak terbaca.
function seriesWindow(from, to) {
  const sekarang = nowPartsWIB();
  const mulai   = from ? startOfDayWIB(from) : startOfMonthWIB(sekarang.year, sekarang.month);
  const selesai = to   ? endOfDayExclusiveWIB(to) : new Date();
  const totalHari = Math.max(1, Math.round((selesai - mulai) / 86_400_000));
  return { mulai, selesai, harian: totalHari <= 92 };
}

// Nama bucket WIB dari sebuah instant UTC. `mulai` hasil startOfDayWIB()
// adalah instant UTC (mis. 1 Jul WIB = 30 Jun 17:00Z) — jadi getUTCMonth()
// LANGSUNG atas instant itu mengembalikan JUNI, bukan Juli. Pergeseran +7 jam
// di sini yang membuat nama bucket cocok dengan hasil
// `date_trunc(... AT TIME ZONE 'Asia/Jakarta')` di SQL.
function namaBucketWIB(instant, harian) {
  const wib = new Date(instant.getTime() + 7 * 3600_000);
  const iso = wib.toISOString();
  return harian ? iso.slice(0, 10) : iso.slice(0, 7);
}

// Bangun deret LENGKAP termasuk bucket bernilai 0. Bucket kosong WAJIB diisi:
// kalau hari tanpa transaksi dilewati, garis grafik "melompat" dan terbaca
// seolah penjualan berjalan kontinu.
function fillBuckets({ mulai, selesai, harian }, map) {
  const points = [];
  if (harian) {
    for (let t = mulai.getTime(); t < selesai.getTime(); t += 86_400_000) {
      const b = namaBucketWIB(new Date(t), true);
      points.push({ bucket: b, value: map[b] || 0 });
    }
  } else {
    const awal  = namaBucketWIB(mulai, false);
    const akhir = namaBucketWIB(new Date(selesai.getTime() - 1), false);
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
    const orderWhere = { ...buildDateWhere(from, to), status: { not: "CANCELLED" } };
    const win = seriesWindow(from, to);

    const [
      orderAgg, lunasAgg, dpAgg,
      statusGroups, categoryGroups,
      cityGroups, complaintCount,
      paidCustomers, totalCustomers, customersWithOrders, paidTanpaOrder,
      revenueRaw, customerRaw,
    ] = await Promise.all([
      prisma.order.aggregate({ where: orderWhere, _count: { _all: true }, _sum: { value: true }, _avg: { value: true } }),
      prisma.order.aggregate({ where: { ...orderWhere, paymentStatus: "LUNAS" }, _count: { _all: true }, _sum: { value: true } }),
      prisma.order.aggregate({ where: { ...orderWhere, paymentStatus: "DP" }, _count: { _all: true }, _sum: { value: true } }),

      prisma.order.groupBy({ by: ["status"], where: buildDateWhere(from, to), _count: { _all: true }, _sum: { value: true } }),
      prisma.order.groupBy({ by: ["category"], where: orderWhere, _count: { _all: true }, _sum: { value: true } }),

      prisma.customer.groupBy({ by: ["city"], where: custWhere, _count: { _all: true } }),
      prisma.order.count({ where: { ...buildDateWhere(from, to), hasComplaint: true } }),

      prisma.customer.count({ where: { ...custWhere, pipelineStage: { in: ["COMPLETED", "REVIEWED"] } } }),
      prisma.customer.count({ where: custWhere }),
      prisma.customer.count({ where: { ...custWhere, orders: { some: { status: { not: "CANCELLED" } } } } }),

      // PEMERIKSAAN INTEGRITAS: customer ditandai Completed/Already Reviewed
      // TAPI tidak punya satu pun order. Ini mustahil secara bisnis — kalau
      // pekerjaannya sudah selesai, harus ada order yang dikerjakan. Penyebabnya stage digeser manual
      // di Kanban tanpa membuat order, jadi PENDAPATANNYA TIDAK PERNAH
      // TERCATAT. Ini yang membuat angka seperti "1 pelanggan bayar tapi Rp0"
      // muncul di Laporan Sales — bukan salah hitung, tapi data yang memang
      // tidak lengkap. TIDAK difilter tanggal: ini utang data yang harus
      // dibereskan, kapan pun terjadinya.
      prisma.customer.count({
        where: {
          pipelineStage: { in: ["COMPLETED", "REVIEWED"] },
          NOT: { orders: { some: { status: { not: "CANCELLED" } } } },
        },
      }),

      // Deret pendapatan & pelanggan baru — granularitas mengikuti panjang
      // rentang (lihat seriesWindow), jadi rentang 30 hari = 30 titik HARIAN.
      win.harian
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

      win.harian
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
    ]);

    const gross     = orderAgg._sum.value || 0;
    const collected = lunasAgg._sum.value || 0;
    const totalOrders = orderAgg._count._all;

    res.json({
      granularity: win.harian ? "day" : "month",

      uang: {
        grossValue: gross,
        collectedValue: collected,
        dpValue: dpAgg._sum.value || 0,
        // Piutang = sudah di-order, belum lunas. Angka ini yang biasanya
        // hilang dari laporan padahal paling dicari owner.
        outstandingValue: gross - collected,
        collectedRate: gross > 0 ? Math.round((collected / gross) * 100) : null,
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
        paidRate:  totalCustomers > 0 ? Math.round((paidCustomers / totalCustomers) * 1000) / 10 : null,
        orderRate: totalCustomers > 0 ? Math.round((customersWithOrders / totalCustomers) * 1000) / 10 : null,
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

    const users = await prisma.user.findMany({
      where: { role: { not: "ADMIN" } },
      select: { id: true, name: true, avatarUrl: true },
      orderBy: { name: "asc" },
    });

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

    const rows = await Promise.all(users.map(async (u) => {
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
      const mine = { ...convWhere, assignedToId: u.id };
      const mineAtribusi = { type: "INDIVIDUAL", assignedToId: u.id };

      const [
        handled, replied, resolved, stalledRaw,
        stageGroups, orderAgg, lunasAgg, complaintCount, respRaw, slaBreach,
        neverReplied, paidRaw, orderingCustomers, takeoverRaw,
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
        // adalah keadaan, bukan aliran periode). Dilabeli jelas di UI supaya
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
        prisma.$queryRaw`
          SELECT AVG(EXTRACT(EPOCH FROM (o."createdAt" - i."createdAt")) / 60) AS avg_minutes,
                 COUNT(*)::int AS sample
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
          WHERE o."createdAt" > i."createdAt"`,

        // SLA breach = percakapan (dibuat dalam rentang) yang respons
        // pertamanya > 60 menit. Ambang 60 menit mengikuti aturan takeover
        // yang sudah dipakai di Inbox. Sama seperti di atas, dihitung dari
        // `firstResponderId` — siapa yang benar-benar terlambat membalas.
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
            WHERE o."createdAt" > i."createdAt"
              AND EXTRACT(EPOCH FROM (o."createdAt" - i."createdAt")) / 60 > 60
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

        // Berapa customer PINDAH ke COMPLETED (dulu PAID, dihapus dari
        // pipeline — lihat schema.prisma enum PipelineStage) di dalam
        // rentang — konversi sebagai ALIRAN periode, bukan keadaan. Ini
        // pembilang conversion rate yang sepadan dengan penyebutnya
        // (percakapan ditangani pada periode yang sama). Sebelumnya
        // pembilangnya memakai "stage sekarang" (keadaan sepanjang waktu)
        // sementara penyebutnya periode — campur aduk, dan itu yang membuat
        // 14.3% muncul bersamaan dengan Rp0.
        prisma.$queryRaw`
          SELECT COUNT(DISTINCT pt.customer_id)::int AS n
          FROM pipeline_transitions pt
          JOIN "Conversation" c ON c."customerId" = pt.customer_id
          WHERE pt.to_stage = 'COMPLETED'
            AND pt.created_at >= ${mulai} AND pt.created_at < ${selesai}
            AND c."assignedToId" = ${u.id} AND c."type" = 'INDIVIDUAL'`,

        // Customer DISTINCT yang punya order dalam rentang — hasil konkret
        // yang datanya sudah ada sekarang (tidak bergantung pada riwayat
        // transisi yang baru mulai direkam).
        prisma.customer.count({
          where: {
            conversations: { some: mineAtribusi },
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
      ]);

      const byStage = Object.fromEntries(stageGroups.map((g) => [g.pipelineStage, g._count._all]));
      const stageCount = (s) => byStage[s] || 0;
      const paidSekarang = stageCount("COMPLETED") + stageCount("REVIEWED");
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
        avgResponseMinutes: respRaw[0]?.avg_minutes != null ? Math.round(Number(respRaw[0].avg_minutes)) : null,
        respondedSample: respRaw[0]?.sample || 0,
        // `neverReplied` = percakapan yang RESOLVED tanpa satu pun balasan
        // (lihat catatan query di atas) — digabung ke slaBreach supaya
        // selalu ikut tampil di kolom "SLA >1j" yang sudah ada, tapi juga
        // diekspos terpisah untuk UI yang mau menyorotnya secara eksplisit.
        neverReplied: neverReplied || 0,
        slaBreach: (slaBreach[0]?.n || 0) + (neverReplied || 0),

        // POSISI SAAT INI (bukan aliran periode) — sengaja tidak difilter
        // tanggal, dan UI WAJIB melabelinya begitu.
        funnel: {
          NEW: stageCount("NEW"), QUALIFIED: stageCount("QUALIFIED"), QUOTED: stageCount("QUOTED"),
          BOOKED: stageCount("BOOKED"), SCHEDULED: stageCount("SCHEDULED"),
          COMPLETED: stageCount("COMPLETED"), REVIEWED: stageCount("REVIEWED"),
        },
        paidCustomersNow: paidSekarang,

        // ALIRAN PERIODE — ikut berubah saat tanggal diganti.
        paidCustomers: paidPeriode,
        orderingCustomers,
        // Konversi = customer yang PINDAH ke Paid dalam periode / percakapan
        // ditangani dalam periode. Dua-duanya aliran periode → sepadan.
        // null (UI: "—") kalau riwayat transisi belum ada datanya di periode
        // ini, supaya tidak terbaca sebagai "0% closing".
        conversionRate: adaDataTransisi && handled > 0
          ? Math.round((paidPeriode / handled) * 1000) / 10
          : null,
        // Konversi berbasis ORDER — datanya sudah ada sekarang, jadi ini yang
        // bisa dipercaya sebelum riwayat transisi terkumpul.
        orderConversionRate: handled > 0
          ? Math.round((orderingCustomers / handled) * 1000) / 10
          : null,

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
    }));

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
      slaBreach: a.slaBreach + r.slaBreach, neverReplied: a.neverReplied + r.neverReplied,
      complaints: a.complaints + r.complaints,
      target: a.target + r.target,
    }), { handled: 0, replied: 0, handledOwn: 0, handledTakeover: 0, stalled: 0, orders: 0, grossValue: 0, collectedValue: 0, paidCustomers: 0, orderingCustomers: 0, slaBreach: 0, neverReplied: 0, complaints: 0, target: 0 });

    res.json({
      periodeTarget: { year, month },
      // Dipakai UI untuk memutuskan menampilkan "—" vs 0% pada konversi
      // berbasis transisi stage.
      adaDataTransisi,
      stalledNow: stalledNowRaw[0]?.n || 0,
      rows: rows.sort((a, b) => b.grossValue - a.grossValue),
      total: {
        ...t,
        replyRate:      t.handled > 0 ? Math.round((t.replied / t.handled) * 100) : null,
        conversionRate: adaDataTransisi && t.handled > 0
          ? Math.round((t.paidCustomers / t.handled) * 1000) / 10 : null,
        orderConversionRate: t.handled > 0
          ? Math.round((t.orderingCustomers / t.handled) * 1000) / 10 : null,
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

    const [totalConversations, openCount, resolvedCount] = await Promise.all([
      prisma.conversation.count({ where: convWhere }),
      prisma.conversation.count({ where: { ...convWhere, status: "OPEN" } }),
      prisma.conversation.count({ where: { ...convWhere, status: "RESOLVED" } }),
    ]);

    const closingRate = totalConversations > 0
      ? Math.round((resolvedCount / totalConversations) * 100)
      : 0;

    // Rata-rata response time: selisih pesan INBOUND pertama vs OUTBOUND pertama per conv
    // (JOIN ke Conversation supaya grup WA internal tidak ikut terhitung)
    let avgResponseMinutes = null;
    try {
      const result = await prisma.$queryRaw`
        SELECT AVG(EXTRACT(EPOCH FROM (o."createdAt" - i."createdAt")) / 60) as avg_minutes
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
      `;
      avgResponseMinutes = result[0]?.avg_minutes
        ? Math.round(Number(result[0].avg_minutes))
        : null;
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
      const rows = await prisma.$queryRaw`
        SELECT to_char(date_trunc('month', i."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jakarta'), 'YYYY-MM') as month,
               AVG(EXTRACT(EPOCH FROM (o."createdAt" - i."createdAt")) / 60) as avg_minutes
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
        GROUP BY 1
        ORDER BY 1
      `;
      monthlyResponseTime = rows.map((r) => ({
        month: r.month,
        value: r.avg_minutes != null ? Math.round(Number(r.avg_minutes)) : 0,
      }));
    } catch (_) {}

    res.json({
      totalConversations, openCount, resolvedCount, closingRate,
      avgResponseMinutes, monthlyResponseTime,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

analyticsRouter.get("/cs-performance", async (req, res) => {
  try {
    const { from, to } = req.query;
    // type: INDIVIDUAL — grup WA internal (kalau pernah ke-assign lewat
    // takeover) tidak boleh ikut menghitung performa CS per sales.
    const convWhere = { ...buildDateWhere(from, to), type: "INDIVIDUAL" };

    const users = await prisma.user.findMany({ where: { role: { not: "ADMIN" } } });

    const rows = await Promise.all(
      users.map(async (u) => {
        const where = { ...convWhere, assignedToId: u.id };
        const [total, resolved, orderAgg] = await Promise.all([
          prisma.conversation.count({ where }),
          prisma.conversation.count({ where: { ...where, status: "RESOLVED" } }),
          // BUG (fix): sebelumnya `{ gte: new Date(from), lte: new Date(to) }`
          // — `new Date("2026-07-25")` = 25 Juli 00:00 UTC, jadi batas ATAS
          // jatuh di AWAL hari terakhir. Seluruh order di hari terakhir
          // rentang HILANG dari kolom "Total Nilai Order" per sales (dan
          // 7 jam pertama tiap hari WIB ikut bergeser). Sekarang pakai
          // buildDateWhere() yang sama dengan metrik lain — satu sumber
          // kebenaran batas periode.
          prisma.order.aggregate({
            where: {
              ...buildDateWhere(from, to),
              customer: { assignedSalesId: u.id },
              status: { not: "CANCELLED" },
            },
            _sum: { value: true },
          }),
        ]);

        let avgResponseMinutes = null;
        try {
          const result = await prisma.$queryRaw`
            SELECT AVG(EXTRACT(EPOCH FROM (o."createdAt" - i."createdAt")) / 60) as avg_minutes
            FROM (
              SELECT m."conversationId", MIN(m."createdAt") as "createdAt"
              FROM "Message" m
              JOIN "Conversation" c ON c.id = m."conversationId"
              WHERE m.direction = 'INBOUND' AND c."assignedToId" = ${u.id} AND c."type" = 'INDIVIDUAL'
              GROUP BY m."conversationId"
            ) i
            JOIN (
              SELECT m."conversationId", MIN(m."createdAt") as "createdAt"
              FROM "Message" m
              JOIN "Conversation" c ON c.id = m."conversationId"
              WHERE m.direction = 'OUTBOUND' AND c."assignedToId" = ${u.id} AND c."type" = 'INDIVIDUAL'
              GROUP BY m."conversationId"
            ) o ON i."conversationId" = o."conversationId"
            WHERE o."createdAt" > i."createdAt"
          `;
          avgResponseMinutes = result[0]?.avg_minutes
            ? Math.round(Number(result[0].avg_minutes))
            : null;
        } catch (_) {}

        return {
          userId: u.id,
          name: u.name,
          avatarUrl: u.avatarUrl,
          totalConversations: total,
          closingRate: total > 0 ? Math.round((resolved / total) * 100) : 0,
          avgResponseMinutes,
          totalOrderValue: orderAgg._sum.value || 0,
        };
      })
    );

    res.json(rows);
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

    const sources = await prisma.customer.groupBy({
      by: ["leadSource"],
      where: custDateWhere,
      _count: { id: true },
    });

    const result = await Promise.all(sources.map(async (s) => {
      const [won, orderAgg] = await Promise.all([
        prisma.customer.count({
          where: { leadSource: s.leadSource, pipelineStage: "COMPLETED", ...custDateWhere },
        }),
        prisma.order.aggregate({
          where: {
            customer: { leadSource: s.leadSource, ...custDateWhere },
            status: { not: "CANCELLED" },
          },
          _sum: { value: true },
        }),
      ]);
      return {
        source:     s.leadSource,
        leads:      s._count.id,
        won,
        convRate:   s._count.id > 0 ? Math.round((won / s._count.id) * 100) : 0,
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

    const salesUsers = await prisma.user.findMany({
      where: { role: "SALES" },
      orderBy: { name: "asc" },
    });

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

    const ORDER = ["NEW", "QUALIFIED", "QUOTED", "BOOKED", "SCHEDULED", "COMPLETED", "REVIEWED"];
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
    const rows = win.harian
      ? await prisma.$queryRaw`
          SELECT to_char(date_trunc('day', "createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jakarta'), 'YYYY-MM-DD') AS bucket,
                 COALESCE(SUM(value), 0)::bigint AS value
          FROM "Order"
          WHERE status != 'CANCELLED' AND "createdAt" >= ${win.mulai} AND "createdAt" < ${win.selesai}
          GROUP BY 1 ORDER BY 1`
      : await prisma.$queryRaw`
          SELECT to_char(date_trunc('month', "createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jakarta'), 'YYYY-MM') AS bucket,
                 COALESCE(SUM(value), 0)::bigint AS value
          FROM "Order"
          WHERE status != 'CANCELLED' AND "createdAt" >= ${win.mulai} AND "createdAt" < ${win.selesai}
          GROUP BY 1 ORDER BY 1`;

    const points = fillBuckets(win, Object.fromEntries(rows.map((r) => [r.bucket, Number(r.value)])));
    const total = points.reduce((s, p) => s + p.value, 0);
    res.json({ granularity: win.harian ? "day" : "month", points, total });
  } catch (err) {
    console.error("revenue-series error:", err);
    res.status(500).json({ error: "Gagal memuat deret pendapatan" });
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

      // Tren bulanan masuk COMPLETED (dulu PAID, dihapus dari pipeline) —
      // bucket WIB (lihat catatan di /overview)
      prisma.$queryRaw`
        SELECT to_char(date_trunc('month', created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jakarta'), 'YYYY-MM') AS month,
               COUNT(*)::int AS value
        FROM pipeline_transitions
        WHERE to_stage = 'COMPLETED'
          AND created_at >= NOW() - INTERVAL '6 months'
        GROUP BY 1 ORDER BY 1
      `,

      // Meta: sejak kapan data ada + total baris (untuk empty state jujur)
      prisma.$queryRaw`
        SELECT MIN(created_at) AS started_at, COUNT(*)::int AS total
        FROM pipeline_transitions
      `,
    ]);

    const STAGES = ["NEW", "QUALIFIED", "QUOTED", "BOOKED", "SCHEDULED", "COMPLETED", "REVIEWED"];
    const durasiMap = Object.fromEntries(durasiRaw.map((r) => [r.stage, r]));
    const masukMap  = Object.fromEntries(masukStageRaw.map((r) => [r.stage, r.count]));

    res.json({
      // Selalu 7 stage (urut kanonik) supaya UI tidak perlu handle stage hilang
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
const HOT_WEIGHTS = {
  stage:   { QUOTED: 35, QUALIFIED: 20 },
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

    // SCALABILITY: kandidat dibatasi (stage QUALIFIED/QUOTED + aktif 7 hari +
    // take 80), skoring di JS. Aman di skala saat ini. Kalau customer aktif
    // membengkak: pindahkan penyaringan kandidat & pra-agregasi (mis. MAX order
    // value, recency) ke SQL/prisma.aggregate atau materialized view, dan simpan
    // signalScore terhitung (cron) daripada menghitung tiap request.
    const customers = await prisma.customer.findMany({
      where: {
        pipelineStage: { in: ["QUALIFIED", "QUOTED"] },
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
      let score = HOT_WEIGHTS.stage[c.pipelineStage] || 0;
      if (c.pipelineStage === "QUOTED") signals.push("Sudah dikirim penawaran");
      for (const [maxMin, pts] of HOT_WEIGHTS.recency) { if (minsSince <= maxMin) { score += pts; break; } }

      let intentPts = 0;
      if (INTENT_RE.price.test(text))   { intentPts += HOT_WEIGHTS.intent.price;   signals.push("Tanya harga"); }
      if (INTENT_RE.catalog.test(text)) { intentPts += HOT_WEIGHTS.intent.catalog; signals.push("Minta katalog/foto"); }
      if (INTENT_RE.order.test(text))   { intentPts += HOT_WEIGHTS.intent.order;   signals.push("Sinyal order"); }
      score += Math.min(intentPts, 25);

      const unanswered = lastMsg?.direction === "INBOUND" && minsSince > 120;
      if (unanswered) { score += HOT_WEIGHTS.unansweredBonus; signals.push(`Belum dibalas ${Math.floor(minsSince / 60)}j`); }

      score = Math.max(0, Math.min(100, Math.round(score)));
      const reason = unanswered ? "Sinyal beli, belum di-follow up"
        : c.pipelineStage === "QUOTED" ? "Sudah ditawari, minat tinggi" : "Prospek aktif, minat tinggi";
      const nextAction = INTENT_RE.price.test(text) ? "Follow up — kirim rincian harga"
        : INTENT_RE.catalog.test(text) ? "Kirim katalog + tanyakan ukuran"
        : c.pipelineStage === "QUOTED" ? "Tindak lanjuti penawaran" : "Tawarkan rekomendasi + jadwalkan";

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
