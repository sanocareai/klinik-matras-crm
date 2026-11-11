// DAFTAR PUTIH tautan notifikasi. `data.path` datang dari server, tapi tetap divalidasi: hanya layar yang
// diketahui dengan id berbentuk UUID — notifikasi tidak bisa membuka sembarang rute.

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const POLA = [new RegExp(`^/unit/${UUID}$`, "i"), new RegExp(`^/qc/${UUID}$`, "i"), /^\/kerja$/, /^\/papan$/, /^\/qc$/];

export function ruteDariNotifikasi(data: unknown): string | null {
  const path = (data as { path?: unknown } | null | undefined)?.path;
  if (typeof path !== "string" || path.length > 80) return null;
  return POLA.some((re) => re.test(path)) ? path : null;
}
