import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { portalsFor } from "../middleware/authorize.js";
import { capabilitiesFor } from "../services/capabilities.js";
import { divisiEfektif, muatDivisiPengguna } from "../services/expenseSubmission/access.js";
import { createFailureLimiter, clientIp, tooMany } from "../lib/rateLimit.js";

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
export async function loadRoles(user) {
  const rows = await prisma.userRole.findMany({
    where: { userId: user.id },
    select: { role: true },
  });
  const roles = rows.map((r) => r.role);
  return roles.length > 0 ? roles : [user.role];
}

// BATAS PERCOBAAN LOGIN (19 Sep 2026, Finance Android S0). Sebelumnya tidak ada
// pembatasan sama sekali. Yang dihitung hanya KEGAGALAN: 5 gagal / 15 menit
// per (email + IP) dan 30 gagal / 15 menit per IP. Login yang berhasil
// mereset hitungan email+IP, jadi pengguna sah tidak pernah terkunci oleh
// salah ketik sesekali. Dipakai bersama oleh /api/mobile/auth/login.
export const loginLimiterPair = createFailureLimiter({ windowMs: 15 * 60_000, max: 5 });
export const loginLimiterIp = createFailureLimiter({ windowMs: 15 * 60_000, max: 30 });
const PESAN_TERKUNCI = "Terlalu banyak percobaan login yang gagal. Coba lagi beberapa menit lagi.";

/** Cek batas; balas 429 & kembalikan null bila terkunci, selain itu kembalikan kunci-kuncinya. */
export function gerbangLogin(req, res, email) {
  const ip = clientIp(req);
  const kunciPasangan = `${String(email || "").trim().toLowerCase()}|${ip}`;
  for (const [lim, kunci] of [[loginLimiterPair, kunciPasangan], [loginLimiterIp, ip]]) {
    const g = lim.check(kunci);
    if (g.blocked) {
      tooMany(res, g.retryAfterSeconds, PESAN_TERKUNCI);
      return null;
    }
  }
  return {
    gagal() { loginLimiterPair.fail(kunciPasangan); loginLimiterIp.fail(ip); },
    berhasil() { loginLimiterPair.success(kunciPasangan); },
  };
}

// C2.1 — divisi EFEKTIF untuk menu klien (keanggotaan eksplisit + adapter peran lama). Hanya tampilan; server menegakkan ulang setiap permintaan.
async function divisiUntukKlien(userId, roles) {
  try {
    return [...divisiEfektif({ roles, divisi: await muatDivisiPengguna(prisma, userId) })];
  } catch (err) {
    console.error("[auth] muat divisi gagal:", err.message);
    return [];
  }
}

authRouter.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const gerbang = gerbangLogin(req, res, email);
    if (!gerbang) return;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) { gerbang.gagal(); return res.status(401).json({ error: "Email atau password salah" }); }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) { gerbang.gagal(); return res.status(401).json({ error: "Email atau password salah" }); }
    gerbang.berhasil();

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
        divisions: await divisiUntukKlien(user.id, roles),
        avatarUrl: user.avatarUrl,
        portals: portalsFor({ roles }),
        capabilities: capabilitiesFor({ roles, role: user.role }),
        // isOnline/onlineSince (12 Sep 2026) — driver-mobile langsung tahu
        // status Online/Offline sejak login pertama, tidak perlu panggilan
        // /users/me kedua cuma untuk field ini.
        isOnline: user.isOnline,
        onlineSince: user.onlineSince,
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
    // capabilities (19 Sep 2026): daftar kemampuan dari role/permission AKTUAL,
    // supaya klien tidak menyalin peta role→izin. Additive — field lama utuh.
    res.json({ ...user, roles, divisions: await divisiUntukKlien(user.id, roles), portals: portalsFor({ roles }), capabilities: capabilitiesFor({ roles, role: user.role }) });
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
      // Enum PipelineStage (restrukturisasi 24 Agustus 2026, 7→4 nilai):
      // NEW, PROSPECT, TRANSACTION, SPAM. Sumber kebenaran: schema.prisma.
      //
      // Dihitung PROSPECT saja (dulu QUALIFIED+QUOTED), BUKAN NEW: NEW berisi
      // ribuan chat masuk mentah yang belum disaring siapa pun, jadi
      // menghitungnya sebagai "lead aktif" menghasilkan angka besar yang tidak
      // bisa ditindaklanjuti. PROSPECT yang benar-benar sedang digarap sales.
      safe("growth", "LEAD DALAM PROSES", () =>
        prisma.customer.count({ where: { pipelineStage: "PROSPECT" } })),
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
