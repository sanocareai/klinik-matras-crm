// PEMBACA kesiapan fisik (tanpa efek samping) — dipisah dari deliveryKesiapanFisik.js supaya bisa diimpor pkrPengirimanSebagian/armada tanpa siklus impor.
import { bacaModeRute, MODE_RUTE } from "./produksiRuteMode.js";

export const AKSI_SIAP_FISIK = "UNIT_READY_PHYSICAL";
export const STATUS_SIAP_PRODUKSI = Object.freeze(["READY_FOR_DELIVERY", "READY_ON_CUSTOMER_HOLD"]);
export const SUDAH_BERANGKAT = ["IN_TRANSIT_OUT", "DELIVERED", "CANCELLED"];

/** Himpunan id unit yang punya konfirmasi kesiapan fisik. Mode KETAT: selalu kosong (hanya status Produksi yang berlaku). */
export async function bacaSiapFisik(db, unitIds, { mode = null } = {}) {
  const ids = [...new Set((unitIds ?? []).filter(Boolean).map(String))];
  if (ids.length === 0) return new Set();
  if ((mode ?? await bacaModeRute(db)) !== MODE_RUTE.TRANSISI) return new Set();
  const rows = await db.$queryRawUnsafe(
    `SELECT DISTINCT x AS id FROM delivery_execution_events e, jsonb_array_elements_text(e.payload->'unitIds') x WHERE e.action = $1 AND x = ANY($2::text[])`,
    AKSI_SIAP_FISIK, ids,
  );
  return new Set(rows.map((r) => String(r.id)));
}

/** Penilaian siap kirim SATU unit: { siap, dasar: "PRODUKSI" | "FISIK" | null }. */
export function nilaiSiap(unit, siapFisik) {
  if (STATUS_SIAP_PRODUKSI.includes(unit.status)) return { siap: true, dasar: "PRODUKSI" };
  if (siapFisik?.has(unit.id) && !SUDAH_BERANGKAT.includes(unit.status)) return { siap: true, dasar: "FISIK" };
  return { siap: false, dasar: null };
}

/**
 * ATURAN TRANSISI (job lama): pemeriksaan unit fisik hanya berlaku untuk job yang DIBUAT SETELAH penanda ini (fin_settings, ditulis skrip rilis saat deploy).
 * Job yang sudah ada sebelum aturan diperkenalkan (terjadwal/berjalan) TIDAK pernah gagal muat/POD karena konfirmasi yang baru dikenal. Penanda belum ada = aturan belum berlaku
 * (aman: tidak menolak apa pun). Nilai = waktu ISO; baca dengan bacaBerlakuSejak().
 */
export const KUNCI_BERLAKU_SEJAK = "PRODUKSI_SIAP_FISIK_BERLAKU_SEJAK";
export async function bacaBerlakuSejak(db) {
  try {
    const r = await db.finSetting.findUnique({ where: { key: KUNCI_BERLAKU_SEJAK } });
    const t = r?.value ? new Date(r.value) : null;
    return t && Number.isFinite(t.getTime()) ? t : null;
  } catch { return null; }
}

/**
 * Periksa unit FISIK pada sebuah job sebelum dimuat/diserahkan (dipanggil konfirmasi muat dan penyelesaian). Order PKR saja.
 * Unit tanpa dasar siap (status Produksi atau konfirmasi fisik) → 409 UNIT_BELUM_SIAP_FISIK + daftar unit. Pengiriman sebagian lewat alur resmi, bukan diam-diam.
 * Job LAMA (dibuat sebelum penanda berlaku, atau penanda belum ada) dikecualikan: `{ ok:true, warisan:true }`. `abaikanWarisan` = simulasi tanpa pengecualian (untuk audit).
 */
export async function periksaUnitSiapKirim(db, { jobId, unitIds = null, abaikanWarisan = false }) {
  const job = await db.job.findUnique({ where: { id: jobId }, select: { id: true, type: true, createdAt: true, order: { select: { penjualanKaryawanId: true } }, units: { select: { unitId: true, unit: { select: { id: true, unitCode: true, status: true } } } } } });
  if (!job || job.type !== "DELIVERY" || !job.order?.penjualanKaryawanId) return { ok: true, belum: [] };
  if (!abaikanWarisan) {
    const sejak = await bacaBerlakuSejak(db);
    if (!sejak || job.createdAt < sejak) return { ok: true, belum: [], warisan: true };
  }
  const target = job.units.map((x) => x.unit).filter((u) => u.status !== "CANCELLED" && (!unitIds || unitIds.includes(u.id)));
  const fisik = await bacaSiapFisik(db, target.map((u) => u.id));
  // Unit yang sudah berangkat/terkirim tidak dinilai lagi; selain itu harus siap.
  const belum = target.filter((u) => !["IN_TRANSIT_OUT", "DELIVERED"].includes(u.status) && !nilaiSiap(u, fisik).siap).map((u) => ({ unitCode: u.unitCode, status: u.status }));
  return { ok: belum.length === 0, belum };
}
