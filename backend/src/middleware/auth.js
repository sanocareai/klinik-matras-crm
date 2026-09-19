import jwt from "jsonwebtoken";
import { prisma } from "../db.js";
import { rolesOf } from "./authorize.js";

// BUG (QA 1 Agustus 2026): SEBELUMNYA `req.user?.role !== "ADMIN"` — field
// legacy JWT tunggal, bukan `roles` array dari sistem multi-role (D-010).
// Middleware ini dipakai di admin.js/auth.js/conversations.js/products.js/
// settings.js/tracking.js — user yang HANYA dapat ADMIN lewat halaman
// Pengguna & Peran (bukan field legacy) ditolak 403 di SEMUA route itu,
// walau backend permission system (authorize.js) sudah benar mengakuinya.
// rolesOf() sama persis dengan yang dipakai requirePermission.
export function requireAdmin(req, res, next) {
  if (!rolesOf(req.user).includes("ADMIN"))
    return res.status(403).json({ error: "Hanya Admin yang bisa melakukan aksi ini" });
  next();
}

// SESI GESER (sliding session) — laporan owner: sales/driver "suka keluar
// sendiri" di tengah balas chat. Bukan gara-gara deploy (JWT_SECRET tetap,
// verifikasi stateless, restart backend tidak membatalkan token apa pun) —
// tapi token berumur TETAP 7 hari sejak login tanpa perpanjangan: siapa pun
// dipaksa keluar tepat 7 hari kemudian, mau lagi aktif atau tidak, dan karena
// akun-akun tim login berdekatan waktunya, kena serentak.
// Sekarang: begitu sisa umur token < REFRESH_SISA_DETIK, respons membawa token
// baru di header `X-Refreshed-Token` (frontend menyimpannya otomatis, api.js).
// User yang aktif tiap hari praktis tidak pernah kena kadaluarsa; yang tidak
// buka aplikasi 7 hari penuh tetap harus login ulang.
const REFRESH_SISA_DETIK = 6 * 24 * 3600;
const JEDA_REFRESH_MS = 60_000; // burst polling 5 detik tidak boleh memicu N query
const terakhirRefresh = new Map();

async function tokenBaruJikaPerlu(payload) {
  const sisa = (payload.exp || 0) - Math.floor(Date.now() / 1000);
  if (sisa > REFRESH_SISA_DETIK) return null;
  const last = terakhirRefresh.get(payload.id) || 0;
  if (Date.now() - last < JEDA_REFRESH_MS) return null;
  terakhirRefresh.set(payload.id, Date.now());
  try {
    // Baca DB di sini (sekali per ~hari per user, bukan tiap request):
    // akun yang sudah dinonaktifkan TIDAK boleh diperpanjang (login sudah
    // memblokirnya, refresh ini tidak boleh jadi celah), dan role/nama
    // terbaru ikut masuk token baru.
    const user = await prisma.user.findUnique({
      where: { id: payload.id },
      select: { id: true, name: true, role: true, active: true },
    });
    if (!user || user.active === false) return null;
    const rows = await prisma.userRole.findMany({ where: { userId: user.id }, select: { role: true } });
    const roles = rows.length > 0 ? rows.map((r) => r.role) : [user.role];
    return jwt.sign(
      { id: user.id, name: user.name, role: user.role, roles },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );
  } catch (err) {
    // Gagal refresh (mis. DB sedang restart) TIDAK boleh menjatuhkan request
    // aslinya — token lama masih sah, coba lagi di request berikutnya.
    terakhirRefresh.delete(payload.id);
    console.error("[auth] refresh token gagal:", err.message);
    return null;
  }
}

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) return res.status(401).json({ error: "Belum login" });

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: "Sesi tidak valid, silakan login ulang" });
  }
  req.user = payload;
  const baru = await tokenBaruJikaPerlu(payload);
  if (baru) res.setHeader("X-Refreshed-Token", baru);
  next();
}
