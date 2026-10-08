// Landing setelah login (murni, diuji `node --test`). Portal tunggal tetap dilompati langsung (PRD §4); yang baru: operator lantai
// (PIC Meja) mendarat di Aplikasi Meja, bukan Status Produksi desktop. Aturan SEMPIT sengaja: hanya pengguna yang peran produksinya
// HANYA PRODUCTION_WORKER (tanpa Lead/QC/Dokumenter/Admin/Owner/peran lain yang punya portal sendiri). ADMIN/OWNER/LEAD tidak pernah
// dialihkan ke Meja — mereka tetap ke portal masing-masing dan membuka Aplikasi Meja lewat Akun > Mode aplikasi bila perlu.
import { allowedModes } from "@/features/production/workerApp/workerAppModel.js";

export const WORKER_MODE_KEY = "km.worker.lastMode";
const NON_FLOOR_ROLES = ["ADMIN", "OWNER", "PRODUCTION_LEAD", "QC_LEAD", "PRODUCTION_DOCUMENTER"];

export function isFloorOnlyUser(roles = []) {
  const r = roles || [];
  return r.includes("PRODUCTION_WORKER") && !r.some((x) => NON_FLOOR_ROLES.includes(x));
}

// `lastMode` = mode terakhir yang dibuka pengguna ini (disimpan per perangkat); dipakai hanya bila MASIH diizinkan peran sekarang.
export function floorLandingFor(roles = [], lastMode = null) {
  if (!isFloorOnlyUser(roles)) return null;
  const modes = allowedModes(roles).filter((m) => m.lane); // mode berlini (Meja/Corner/Bahan); Dokumentasi bukan landing PIC
  if (!modes.length) return null;
  return (modes.find((m) => m.key === lastMode) || modes.find((m) => m.key === "meja") || modes[0]).to;
}

// Portal tunggal: PIC Meja -> Aplikasi Meja; selain itu path portal apa adanya.
export function landingPathFor({ roles = [], portals = [], lastMode = null } = {}) {
  if (portals.length !== 1) return null;
  return floorLandingFor(roles, lastMode) || portals[0].path;
}

export function readLastWorkerMode() { try { return localStorage.getItem(WORKER_MODE_KEY); } catch { return null; } }
export function rememberWorkerMode(key) { try { localStorage.setItem(WORKER_MODE_KEY, key); } catch { /* penyimpanan boleh gagal */ } }
