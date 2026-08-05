import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { portalsFor } from "../middleware/authorize.js";

export const authRouter = express.Router();

// Ambil semua role user dari tabel user_roles (D-010).
//
// `user.role` yang lama TETAP dikirim dan TETAP dipakai kode yang sudah ada
// (requireAdmin, sidebar frontend). Ini penambahan, bukan penggantian —
// mengganti arti field yang dipakai 7 orang di jam kerja bukan langkah Phase 0.
//
// Fallback ke [user.role] kalau tabel user_roles kosong untuk user itu:
// backfill migrasi seharusnya sudah mengisinya, tapi user yang DIBUAT setelah
// migrasi lewat jalur lama (routes/users.js) belum tentu punya barisnya.
// Tanpa fallback, user baru langsung kehilangan seluruh akses.
async function loadRoles(user) {
  const rows = await prisma.userRole.findMany({
    where: { userId: user.id },
    select: { role: true },
  });
  const roles = rows.map((r) => r.role);
  return roles.length > 0 ? roles : [user.role];
}

authRouter.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(401).json({ error: "Email atau password salah" });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: "Email atau password salah" });

    // Akun nonaktif (mis. sudah resign) — dicek SETELAH password benar,
    // supaya pesannya tidak jadi oracle "email ini terdaftar" untuk akun
    // nonaktif. JWT lama yang mungkin masih beredar (berlaku 7 hari) TIDAK
    // otomatis ikut dicabut oleh pengecekan ini — requireAuth di
    // middleware/auth.js cuma verifikasi tanda tangan token, tidak query DB
    // tiap request (murah, tapi berarti sesi yang SUDAH berjalan tetap
    // jalan sampai token-nya kedaluwarsa). Dampaknya kecil untuk kasus
    // resign (bukan pemecatan darurat) — cukup untuk mencegah login BARU.
    if (user.active === false) {
      return res.status(403).json({ error: "Akun ini sudah dinonaktifkan. Hubungi admin kalau ini keliru." });
    }

    const roles = await loadRoles(user);

    const token = jwt.sign(
      { id: user.id, name: user.name, role: user.role, roles },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        role: user.role,
        roles,
        avatarUrl: user.avatarUrl,
        portals: portalsFor({ roles }),
      },
    });
  } catch (err) {
    console.error("Login error:", err.message);
    res.status(500).json({ error: "Server error: " + err.message });
  }
});

// GET /api/auth/me — identitas + role + portal yang boleh dibuka.
//
// Dipakai landing page portal. Sengaja membaca role dari DATABASE, bukan dari
// token: kalau admin menambah/mencabut role seseorang, perubahannya berlaku
// begitu halaman di-refresh — tidak perlu menunggu token 7 hari kedaluwarsa.
authRouter.get("/me", requireAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, name: true, role: true, avatarUrl: true },
    });
    if (!user) return res.status(401).json({ error: "User tidak ditemukan" });

    const roles = await loadRoles(user);
    res.json({ ...user, roles, portals: portalsFor({ roles }) });
  } catch (err) {
    console.error("Auth me error:", err.message);
    res.status(500).json({ error: "Server error: " + err.message });
  }
});

// GET /api/auth/portal-summary — satu angka HIDUP per workspace, untuk kartu
// di halaman Portal (redesign SANSS, 1 Agustus 2026).
//
// SENGAJA angka NYATA, bukan contoh. Mockup desain menampilkan angka seperti
// "24 lead perlu follow-up" — kalau itu di-hardcode, kartu Portal berubah jadi
// hiasan yang berbohong begitu data asli bergerak. Lebih baik satu angka jujur
// per workspace (atau tidak sama sekali) daripada empat angka palsu.
//
// HANYA menghitung workspace yang boleh dibuka user ini — tidak membocorkan
// angka divisi yang bukan haknya. Tiap hitungan dibungkus sendiri: satu query
// gagal TIDAK menggagalkan seluruh response (kartu itu saja yang tanpa angka).
authRouter.get("/portal-summary", requireAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { id: true, role: true } });
    if (!user) return res.status(401).json({ error: "User tidak ditemukan" });
    const roles = await loadRoles(user);
    const allowed = new Set(portalsFor({ roles }).map((p) => p.key));

    const safe = async (key, label, fn) => {
      if (!allowed.has(key)) return null;
      try {
        return { key, value: await fn(), label };
      } catch (err) {
        console.error(`[portal-summary:${key}]`, err.message);
        return null;
      }
    };

    const todayWIB = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

    const results = await Promise.all([
      // Enum PipelineStage yang BENAR: NEW, QUALIFIED, QUOTED, BOOKED,
      // SCHEDULED, COMPLETED, REVIEWED. (CLAUDE.md sempat mendokumentasikan
      // LEAD/WON/LOST — itu SUDAH TIDAK AKURAT; percobaan pertama endpoint ini
      // memakai "LEAD" dan gagal diam-diam. Sumber kebenaran: schema.prisma.)
      //
      // Dihitung QUALIFIED + QUOTED saja, BUKAN semua tahap terbuka: NEW
      // berisi ribuan chat masuk mentah yang belum disaring siapa pun, jadi
      // menghitungnya sebagai "lead aktif" menghasilkan angka besar yang tidak
      // bisa ditindaklanjuti. Dua tahap ini yang benar-benar sedang digarap sales.
      safe("growth", "LEAD DALAM PROSES", () =>
        prisma.customer.count({ where: { pipelineStage: { in: ["QUALIFIED", "QUOTED"] } } })),
      safe("bengkel", "UNIT DIKERJAKAN", () =>
        prisma.unit.count({ where: { status: "IN_PRODUCTION" } })),
      safe("warehouse", "ITEM DI BAWAH MINIMUM", async () => {
        const rows = await prisma.$queryRaw`
          SELECT COUNT(*)::int AS n FROM (
            SELECT m.id, m.reorder_point, COALESCE(SUM(sm.qty), 0)::float AS balance
            FROM materials m
            LEFT JOIN stock_movements sm ON sm.material_id = m.id
            WHERE m.reorder_point IS NOT NULL
            GROUP BY m.id, m.reorder_point
          ) t WHERE t.balance <= t.reorder_point`;
        return rows[0]?.n ?? 0;
      }),
      safe("armada", "JOB HARI INI", () =>
        prisma.job.count({
          where: {
            scheduledDate: new Date(`${todayWIB}T00:00:00.000Z`),
            status: { in: ["UNSCHEDULED", "SCHEDULED", "ASSIGNED", "EN_ROUTE", "ARRIVED"] },
          },
        })),
      safe("kendali", "UNIT AKTIF", () =>
        prisma.unit.count({ where: { status: { notIn: ["DELIVERED", "CANCELLED"] } } })),
    ]);

    const summary = {};
    for (const r of results) if (r) summary[r.key] = { value: r.value, label: r.label };

    // Ringkasan KPI hero Sales CRM (3 angka, bukan 1) — dipakai
    // pages/DivisionPage.jsx menggantikan hero yang dulu cuma mengulang nama
    // workspace. Ditaruh di key TERPISAH, bukan menambah field ke summary[key],
    // supaya konsumen lama (Portal.jsx membaca summary[portal.key]) tidak
    // berubah bentuknya sama sekali.
    //
    // Angkanya NYATA, konsisten dengan aturan endpoint ini: label di frontend
    // harus persis menggambarkan apa yang dihitung di sini, jangan diberi nama
    // yang lebih menjanjikan daripada querinya.
    if (allowed.has("growth")) {
      const bataspFollowUp = new Date(Date.now() - 60 * 60 * 1000); // ambang takeover 60 menit
      const [perluFollowUp, belumDibaca] = await Promise.all([
        // Percakapan customer yang pesan masuknya menggantung >60 menit —
        // ambang yang sama dengan aturan takeover di CLAUDE.md §7C.
        prisma.conversation.count({
          where: {
            type: "INDIVIDUAL",
            status: { not: "RESOLVED" },
            unreadCount: { gt: 0 },
            lastMessageAt: { lt: bataspFollowUp },
          },
        }).catch(() => null),
        prisma.conversation.count({
          where: { type: "INDIVIDUAL", status: { not: "RESOLVED" }, unreadCount: { gt: 0 } },
        }).catch(() => null),
      ]);

      summary.growthKpi = {
        leadDiproses: summary.growth?.value ?? null,
        perluFollowUp,
        belumDibaca,
      };
    }

    res.json(summary);
  } catch (err) {
    console.error("Portal summary error:", err.message);
    res.status(500).json({ error: "Server error: " + err.message });
  }
});
