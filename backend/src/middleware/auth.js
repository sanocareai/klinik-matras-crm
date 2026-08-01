import jwt from "jsonwebtoken";
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

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) return res.status(401).json({ error: "Belum login" });

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Sesi tidak valid, silakan login ulang" });
  }
}
