// P12B.2 — tab Pengaturan Produksi menurut peran. TIDAK memperluas izin backend: tiap tab hanya menampilkan halaman yang endpoint-nya SUDAH dijaga
// server (work_center:read, production_operator:read, production_route:read, production_report:read). Production Lead melihat/mengelola sesuai izin
// bawaannya; menulis Target Produksi tetap hanya ADMIN/OWNER (production_target:write — server menegakkan).
const MANAGERS = Object.freeze(["ADMIN", "OWNER", "PRODUCTION_LEAD"]);
export const SETTINGS_TABS = Object.freeze([
  { key: "area-kerja", label: "Area Kerja", roles: MANAGERS },
  { key: "operator", label: "Operator & PIC", roles: MANAGERS },
  { key: "layanan", label: "Layanan & Tahapan", roles: MANAGERS },
  { key: "target", label: "Target Produksi", roles: MANAGERS },
  { key: "tampilan", label: "Tampilan", roles: MANAGERS },
]);
const has = (roles, allowed) => (roles || []).some((r) => allowed.includes(r));
export const canOpenSettings = (roles) => has(roles, MANAGERS);
export const settingsTabsFor = (roles) => SETTINGS_TABS.filter((t) => has(roles, t.roles));
export const canWriteTarget = (roles) => has(roles, ["ADMIN", "OWNER"]);
