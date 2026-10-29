// Penjaga akses tiga tool laporan Meta Ads di jalur /mcp dan /gpt-actions.
//
// Latar belakang: laporan ini di REST (/api/atribusi/iklan) HANYA ADMIN. Jalur /mcp dan /gpt-actions hanya memverifikasi TOKEN (statis atau OAuth bersandi
// audience /mcp) dan tidak memuat ulang user saat panggilan: access token OAuth berlaku 1 jam dan refresh token tidak memeriksa ulang role/aktif, jadi admin
// yang diturunkan/dinonaktifkan masih bisa memanggil tool selama token masih ada. Untuk tool lain itu perilaku lama yang tidak diubah di sini; untuk tiga tool
// laporan Meta aksesnya harus sama ketat dengan endpoint REST-nya.
//
// Aturan: token STATIS (kredensial mesin MCP_API_TOKEN, sama kepercayaannya dengan seluruh /mcp) lolos; token OAuth hanya lolos bila user MASIH aktif dan ADMIN
// (dibaca dari tabel user_roles, D-010). Gagal memuat user = tolak (fail-closed). Tidak menyentuh tool lain dan tidak menyentuh /mcp-chatgpt (fasad itu sudah
// memuat ulang user dan mewajibkan ADMIN pada setiap request).
import { prisma } from "../db.js";
import { rolesOf } from "../middleware/authorize.js";

export const TOOL_LAPORAN_META = Object.freeze(["performa_campaign_meta", "rekap_harian_meta", "kesehatan_atribusi_meta"]);

async function muatPrincipal(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, active: true, role: true, roles: { select: { role: true } } } });
  if (!user) return null;
  return { id: user.id, active: user.active, role: user.role, roles: user.roles.map((r) => r.role) };
}

/** Nama tool yang diminta oleh request ini (JSON-RPC tunggal/batch di /mcp; /tools/:nama di /gpt-actions). */
export function namaToolDiminta(req) {
  const nama = [];
  const kumpul = (m) => { if (m && m.method === "tools/call" && typeof m.params?.name === "string") nama.push(m.params.name); };
  if (Array.isArray(req.body)) req.body.forEach(kumpul); else kumpul(req.body);
  const gpt = /^\/tools\/([^/]+)\/?$/.exec(req.path || "");
  if (gpt) nama.push(decodeURIComponent(gpt[1]));
  return nama;
}

export function buatPenjagaAksesLaporan({ pemuat = muatPrincipal } = {}) {
  return async function penjagaAksesLaporan(req, res, next) {
    if (!namaToolDiminta(req).some((n) => TOOL_LAPORAN_META.includes(n))) return next();
    if (req.mcpAuth?.type === "static") return next();
    if (req.mcpAuth?.type !== "oauth" || !req.mcpAuth.userId) return res.status(403).json({ error: "Akses laporan Meta Ads hanya untuk Admin" });
    let principal = null;
    try { principal = await pemuat(req.mcpAuth.userId); } catch { principal = null; }
    if (!principal?.active || !rolesOf(principal).includes("ADMIN")) return res.status(403).json({ error: "Akses laporan Meta Ads hanya untuk Admin" });
    return next();
  };
}

export const penjagaAksesLaporan = buatPenjagaAksesLaporan();
