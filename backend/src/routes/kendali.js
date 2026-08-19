// Kendali — dashboard lintas portal (PRD §7.7, FR-C). Sano Hub Phase 1.
//
// SEMUANYA di sini dihitung dari data yang BENAR-BENAR ADA, bukan ditebak.
// Dua metrik yang PRD minta (FR-C-01 "unit berisiko lewat tanggal janji",
// FR-C-04 "on-time delivery rate") SENGAJA TIDAK dibangun — Order tidak
// punya kolom tanggal janji kirim sama sekali, jadi tidak ada dasar untuk
// menghitungnya. Frontend menampilkan ini sebagai catatan eksplisit
// ("belum bisa dihitung"), bukan diam-diam dihilangkan begitu saja.
//
// Cycle time per tahap HANYA dari baris requires_photo... — bukan, HANYA
// dari baris COMPLETE yang punya duration_seconds terisi (bukan NULL).
// Pencatatan retrospektif (D-014) sengaja menyimpan NULL kalau durasi
// memang tidak terukur — rata-rata di sini WAJIB mengecualikan NULL, dan
// jumlah sampel WAJIB ditampilkan supaya tidak disalahartikan sebagai data
// lengkap.

import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission, PERMISSIONS as P } from "../middleware/authorize.js";
import { prisma } from "../db.js";

export const kendaliRouter = express.Router();
kendaliRouter.use(requireAuth);

// GET /api/kendali/overview
kendaliRouter.get("/overview", requirePermission(P.DASHBOARD_READ), async (req, res) => {
  try {
    // 1. Unit per status — potret LIVE sekarang, bukan agregat historis.
    const statusCounts = await prisma.unit.groupBy({ by: ["status"], _count: true });
    const byStatus = Object.fromEntries(statusCounts.map((s) => [s.status, s._count]));

    // 2. Unit terblokir — DERIVED dari ledger (log TERAKHIR di tahap sekarang
    // = FAIL), bukan kolom status (D-014/unitStageEngine.js, prinsip yang
    // sama). Raw SQL: mengecek log terakhir per unit itu murah dalam SATU
    // query lewat subquery berkorelasi, dibanding N+1 dari Prisma per unit.
    const blocked = await prisma.$queryRaw`
      SELECT u.id, u.unit_code AS "unitCode", rs.label_id AS "stageLabel",
             usl.block_reason AS "blockReason", usl.created_at AS "blockedSince"
      FROM units u
      JOIN routing_stages rs ON rs.id = u.current_stage_id
      JOIN LATERAL (
        SELECT action, block_reason, created_at FROM unit_stage_logs
        WHERE unit_id = u.id AND stage_id = u.current_stage_id
        ORDER BY created_at DESC LIMIT 1
      ) usl ON true
      WHERE u.current_stage_id IS NOT NULL AND usl.action = 'FAIL'
      ORDER BY usl.created_at ASC
    `;

    // 3. Cycle time per tahap — HANYA baris COMPLETE dengan duration_seconds
    // terisi. sampleCount ikut dikembalikan supaya UI bisa jujur soal "ini
    // dari berapa banyak data" alih-alih menyembunyikan ukuran sampel.
    const cycleTimeRaw = await prisma.$queryRaw`
      SELECT rs.code AS "stageCode", rs.label_id AS "stageLabel",
             AVG(usl.duration_seconds)::float AS "avgSeconds",
             COUNT(*)::int AS "sampleCount"
      FROM unit_stage_logs usl
      JOIN routing_stages rs ON rs.id = usl.stage_id
      WHERE usl.action = 'COMPLETE' AND usl.duration_seconds IS NOT NULL
      GROUP BY rs.code, rs.label_id, rs.sequence, rs.phase
      ORDER BY rs.phase, rs.sequence
    `;

    // 4. Alasan kegagalan job (pickup+delivery) — FR-C-04 bagian yang BISA
    // dihitung tanpa tanggal janji: "kenapa kunjungan gagal", bukan "apa
    // tepat waktu".
    const jobFailures = await prisma.job.groupBy({
      by: ["type", "failureReason"],
      where: { status: "FAILED" },
      _count: true,
      orderBy: { _count: { failureReason: "desc" } },
    });

    // 5. Rework rate — QC yang TIDAK lolos TANPA override customer (override
    // berarti unit tetap lanjut, lihat unitStageEngine.js recordQcFitTest).
    const [totalQc, reworkQc] = await Promise.all([
      prisma.qcFitTest.count(),
      prisma.qcFitTest.count({ where: { verdict: { not: "PAS" }, customerPreferenceOverride: null } }),
    ]);

    // 6. Aktivitas driver HARI INI — job selesai/gagal, per driver.
    const todayStart = new Date(`${new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10)}T00:00:00.000Z`);
    const driverJobsToday = await prisma.job.findMany({
      where: { updatedAt: { gte: todayStart }, status: { in: ["COMPLETED", "FAILED"] }, driverId: { not: null } },
      select: { driverId: true, status: true, driver: { select: { name: true } } },
    });
    const byDriver = {};
    for (const j of driverJobsToday) {
      const key = j.driverId;
      byDriver[key] ??= { driverName: j.driver?.name || "—", completed: 0, failed: 0 };
      if (j.status === "COMPLETED") byDriver[key].completed++;
      else byDriver[key].failed++;
    }

    res.json({
      units: {
        byStatus,
        totalUnits: statusCounts.reduce((n, s) => n + s._count, 0),
        blocked,
      },
      cycleTime: cycleTimeRaw,
      jobFailures: jobFailures.map((f) => ({ type: f.type, reason: f.failureReason, count: f._count })),
      rework: { totalQc, reworkQc, reworkRate: totalQc > 0 ? reworkQc / totalQc : null },
      driverActivity: Object.entries(byDriver).map(([driverId, v]) => ({ driverId, ...v })),
      // Ditandai eksplisit supaya frontend TIDAK menebak-nebak kenapa field
      // ini kosong — sengaja belum dibangun, bukan bug.
      unavailable: {
        atRiskUnits: "Order belum punya kolom tanggal janji kirim (promisedDeliveryDate) — belum bisa dihitung.",
        onTimeDeliveryRate: "Sama seperti di atas — butuh tanggal janji kirim untuk dibandingkan.",
      },
    });
  } catch (err) {
    console.error("Kendali overview error:", err);
    res.status(500).json({ error: "Server error: " + err.message });
  }
});

// GET /api/kendali/kesiapan — "Kesiapan Operasional".
//
// Menjawab satu pertanyaan: APA YANG MASIH KURANG sebelum Bengkel/Armada/
// Gudang benar-benar bisa dipakai kerja?
//
// LATAR BELAKANG (audit 19 Agustus 2026): seluruh kode & master data ketiga
// modul SUDAH lengkap, tapi nol data operasional — dan penyebab paling
// dasarnya nyaris tidak kelihatan dari UI mana pun: dari 10 user, TIDAK ADA
// SATU PUN yang punya role PRODUCTION_LEAD/QC_LEAD/WAREHOUSE/DISPATCHER/
// DRIVER. Akibatnya tiap tombol aksi dijawab 403, dan gejalanya di layar
// cuma "tidak terjadi apa-apa" — sangat mahal untuk didiagnosa manual.
// Halaman ini membuat penyebab semacam itu terbaca dalam sekali lihat.
//
// ⚠️ ADMIN SENGAJA TIDAK dihitung sebagai pemenuh peran operasional.
// permissions.js menahan UNIT_STAGE_WRITE/QC_WRITE/INVENTORY_WRITE dari
// ADMIN demi integritas ledger "siapa yang mengerjakan" — jadi punya banyak
// admin TIDAK membuat bengkel/gudang bisa jalan. Menghitungnya di sini akan
// menyembunyikan blokir yang sebenarnya.
//
// Semua angka DIHITUNG dari data nyata; tidak ada ambang yang ditebak.
kendaliRouter.get("/kesiapan", requirePermission(P.DASHBOARD_READ), async (req, res) => {
  try {
    // Peran yang WAJIB ada minimal 1 akun aktif supaya modulnya bisa dipakai.
    // Dipetakan ke modul supaya pesan yang muncul menyebut dampaknya, bukan
    // sekadar nama role yang tidak berarti apa-apa bagi non-teknis.
    const PERAN_WAJIB = [
      { role: "PRODUCTION_LEAD", modul: "Bengkel", dampak: "tidak ada yang bisa memajukan tahap produksi" },
      { role: "QC_LEAD",         modul: "Bengkel", dampak: "Uji Berat Badan (QC) tidak bisa dicatat" },
      { role: "WAREHOUSE",       modul: "Gudang",  dampak: "stok tidak bisa diterima/dikeluarkan sama sekali" },
      { role: "DISPATCHER",      modul: "Armada",  dampak: "job pickup/pengiriman tidak bisa dijadwalkan" },
      { role: "DRIVER",          modul: "Armada",  dampak: "tidak ada yang bisa menerima & menyelesaikan job di lapangan" },
    ];

    const [roleRows, materialAktif, kendaraanAktif, gudangAktif,
           totalUnit, unitJalan, totalJob, jobTanpaDriver, stokAda] = await Promise.all([
      // HANYA user AKTIF — akun nonaktif tidak bisa login, jadi tidak
      // menyelesaikan blokir apa pun kalau ikut dihitung.
      prisma.userRole.findMany({
        where: { user: { active: true } },
        select: { role: true },
      }),
      prisma.material.count({ where: { active: true } }),
      prisma.vehicle.count({ where: { active: true } }),
      prisma.warehouse.count({ where: { active: true } }),
      prisma.unit.count(),
      prisma.unit.count({ where: { currentStageId: { not: null } } }),
      prisma.job.count(),
      prisma.job.count({ where: { driverId: null, status: { notIn: ["COMPLETED", "FAILED"] } } }),
      prisma.stockMovement.count(),
    ]);

    const jumlahPerRole = {};
    for (const r of roleRows) jumlahPerRole[r.role] = (jumlahPerRole[r.role] || 0) + 1;

    const peran = PERAN_WAJIB.map((p) => ({
      ...p,
      jumlah: jumlahPerRole[p.role] || 0,
      siap: (jumlahPerRole[p.role] || 0) > 0,
    }));

    // Tiap butir: siap/tidak + kenapa itu penting + apa langkah perbaikannya.
    // "aksi" ditulis sebagai kalimat perintah konkret, bukan nama teknis —
    // yang membaca halaman ini belum tentu yang menulis kodenya.
    const butir = [
      ...peran.map((p) => ({
        modul: p.modul,
        nama: `Akun dengan peran ${p.role}`,
        siap: p.siap,
        nilai: `${p.jumlah} akun aktif`,
        catatan: p.siap ? null : `Tanpa ini, ${p.dampak}.`,
        aksi: p.siap ? null : "Pengguna & Peran → beri peran ini ke akun yang sesuai",
      })),
      {
        modul: "Gudang", nama: "Katalog material", siap: materialAktif > 0,
        nilai: `${materialAktif} material aktif`,
        catatan: materialAktif > 0 ? null : "Tanpa material, terima barang / issue ke unit / stock count semuanya mati.",
        aksi: materialAktif > 0 ? null : "Gudang → Inventory → tambah material, atau jalankan scripts/seed-operasional.js",
      },
      {
        modul: "Gudang", nama: "Lokasi gudang", siap: gudangAktif > 0,
        nilai: `${gudangAktif} gudang aktif`,
        catatan: gudangAktif > 0 ? null : "Pergerakan stok butuh minimal satu gudang terdaftar.",
        aksi: gudangAktif > 0 ? null : "Hubungi admin sistem — gudang dibuat lewat migrasi/seed",
      },
      {
        modul: "Armada", nama: "Kendaraan terdaftar", siap: kendaraanAktif > 0,
        nilai: `${kendaraanAktif} kendaraan aktif`,
        catatan: kendaraanAktif > 0 ? null : "Rute & cek kapasitas tidak bisa disusun tanpa kendaraan.",
        aksi: kendaraanAktif > 0 ? null : "Armada → Sumber Daya → tambah kendaraan",
      },
    ];

    const belumSiap = butir.filter((b) => !b.siap);

    res.json({
      // `siap` = SEMUA prasyarat terpenuhi. Sengaja boolean tegas, bukan
      // persentase — "80% siap" menyesatkan kalau 20% yang kurang itu justru
      // yang bikin seluruh modul tidak bisa dibuka.
      siap: belumSiap.length === 0,
      jumlahBelumSiap: belumSiap.length,
      butir,
      // Denyut operasional — BUKAN prasyarat, tapi jawaban atas "sudah
      // benar-benar dipakai belum?". Angka 0 di sini wajar untuk sistem yang
      // memang baru mau mulai; yang penting jangan disalahartikan sebagai
      // kerusakan.
      aktivitas: {
        totalUnit,
        unitSedangDikerjakan: unitJalan,
        unitBelumMasukProduksi: totalUnit - unitJalan,
        totalJob,
        jobBelumAdaDriver: jobTanpaDriver,
        totalPergerakanStok: stokAda,
        pernahDipakai: unitJalan > 0 || totalJob > 0 || stokAda > 0,
      },
    });
  } catch (err) {
    console.error("Kendali kesiapan error:", err);
    res.status(500).json({ error: "Server error: " + err.message });
  }
});
