// IZIN LAPORAN DIVISI (Fase 2) — ditegakkan di SERVER (menu frontend hanya kosmetik).
//
//   SEMUA    : Finance (finance:read), Admin, Owner → semua divisi + Biaya Bersama + Tidak Terklasifikasi + jembatan + data sensitif.
//   LEADER   : leader divisi → HANYA divisinya, rincian + drill-down dokumen, TANPA data sensitif (gaji/kasbon/investor/rekening/bukti/catatan internal).
//   ANGGOTA  : anggota biasa divisi → HANYA ringkasan divisinya (angka total & kelompok), tanpa daftar dokumen, tanpa nama penerima/catatan.
//
// Leader = baris UserDivision.isLeader (ditetapkan Admin/Owner), ATAU peran yang memang kepemimpinan divisi: PRODUCTION_LEAD → Produksi, LEADER_DRIVER → Delivery,
// isSalesTeamLead → Sales. Peran operasional lain (Driver/Helper/Dispatcher/Warehouse/Sales biasa) TIDAK otomatis mendapat akses. SALES bukan Marketing.
// Akses divisi tidak pernah menambah izin Finance, dan menjadi anggota satu divisi tidak membuka divisi lain.
//
// SAKELAR: laporan_divisi_aktif (MATI = tidak ada yang melihat), laporan_divisi_workspace (daftar scope yang sudah dibuka untuk workspace divisinya).
import { hasPermission, rolesOf } from "../../../middleware/authorize.js";
import { PERMISSIONS as P } from "../../../constants/permissions.js";
import { getSettingRaw, parseBool, SETTING_KEYS } from "../settings.js";
import { DIVISI, SEMUA_KELOMPOK } from "./divisi.js";

export class AksesError extends Error {
  constructor(message, statusCode = 403, code = "LAPORAN_DIVISI_DILARANG") { super(message); this.statusCode = statusCode; this.code = code; }
}

export const LEVEL = Object.freeze({ SEMUA: "SEMUA", LEADER: "LEADER", ANGGOTA: "ANGGOTA" });
const PERAN_PIMPINAN = { PRODUCTION_LEAD: "PRODUCTION", LEADER_DRIVER: "DELIVERY" };

export const adalahStafFinance = (user) => hasPermission(user, P.FINANCE_READ) || rolesOf(user).some((r) => r === "ADMIN" || r === "OWNER");
export const adalahAdminFinance = (user) => hasPermission(user, P.FINANCE_ADMIN) || rolesOf(user).some((r) => r === "ADMIN" || r === "OWNER");

export async function statusSakelar(db) {
  const aktif = parseBool(await getSettingRaw(db, SETTING_KEYS.LAPORAN_DIVISI_AKTIF));
  const mentah = String((await getSettingRaw(db, SETTING_KEYS.LAPORAN_DIVISI_WORKSPACE)) || "");
  const workspace = mentah.split(",").map((s) => s.trim()).filter((s) => DIVISI.includes(s));
  return { aktif, workspace };
}

/**
 * Hak akses pengguna ini (dihitung dari DB per permintaan — tidak dari JWT yang bisa basi).
 * @returns { sakelar, level, scopes: Map<scope, 'LEADER'|'ANGGOTA'>, semua:boolean }  `scopes` hanya berisi scope yang BOLEH dilihat sekarang (sakelar sudah diperhitungkan).
 */
export async function muatAkses(db, user) {
  const sakelar = await statusSakelar(db);
  const scopes = new Map();
  if (!sakelar.aktif) return { sakelar, level: null, scopes, semua: false };

  if (adalahStafFinance(user)) {
    for (const s of SEMUA_KELOMPOK) scopes.set(s, "SEMUA");
    return { sakelar, level: LEVEL.SEMUA, scopes, semua: true };
  }

  const [anggota, profil] = await Promise.all([
    db.userDivision.findMany({ where: { userId: user.id }, select: { division: true, isLeader: true } }),
    db.user.findUnique({ where: { id: user.id }, select: { isSalesTeamLead: true } }),
  ]);
  const kandidat = new Map(); // scope → 'LEADER' | 'ANGGOTA'
  const naikkan = (scope, peran) => { if (kandidat.get(scope) !== "LEADER") kandidat.set(scope, peran); };
  for (const a of anggota) if (DIVISI.includes(a.division)) naikkan(a.division, a.isLeader ? "LEADER" : "ANGGOTA");
  for (const r of rolesOf(user)) if (PERAN_PIMPINAN[r]) naikkan(PERAN_PIMPINAN[r], "LEADER");
  if (profil?.isSalesTeamLead) naikkan("SALES", "LEADER");

  for (const [scope, peran] of kandidat) if (sakelar.workspace.includes(scope)) scopes.set(scope, peran);
  const level = [...scopes.values()].includes("LEADER") ? LEVEL.LEADER : scopes.size ? LEVEL.ANGGOTA : null;
  return { sakelar, level, scopes, semua: false };
}

/** Pastikan pengguna boleh melihat setiap scope yang diminta; kembalikan daftar scope final (permintaan kosong = semua yang boleh). */
export function tetapkanScope(akses, diminta) {
  if (!akses.sakelar.aktif) throw new AksesError("Laporan Divisi belum diaktifkan oleh Admin Finance.", 403, "LAPORAN_DIVISI_MATI");
  if (akses.scopes.size === 0) throw new AksesError("Anda tidak punya akses ke Laporan Divisi manapun.", 403, "TANPA_AKSES");
  const minta = (Array.isArray(diminta) ? diminta : diminta ? [diminta] : []).filter(Boolean);
  for (const s of minta) if (!SEMUA_KELOMPOK.includes(s)) throw new AksesError("Divisi tidak dikenal.", 400, "DIVISI_TIDAK_VALID");
  for (const s of minta) if (!akses.scopes.has(s)) throw new AksesError("Anda tidak punya akses ke Laporan Divisi ini.", 403, "SCOPE_DILARANG");
  return minta.length ? minta : [...akses.scopes.keys()];
}

/** Level rincian untuk satu scope: SEMUA/LEADER → rinci (boleh drill-down), ANGGOTA → ringkasan saja. */
export const bolehRinci = (akses, scope) => ["SEMUA", "LEADER"].includes(akses.scopes.get(scope));
export const bolehSensitif = (akses) => akses.semua;
