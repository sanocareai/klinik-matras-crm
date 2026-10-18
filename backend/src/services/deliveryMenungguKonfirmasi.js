// UNIT YANG MASIH DALAM PRODUKSI BOLEH MASUK ROUTE PLANNER (keputusan Owner, 18 Okt 2026, kasus RES-03102026-018-U1 / rute RTE-161026-02).
//
// Dulu (16 Okt) unit RECEIVED/IN_PRODUCTION hanya boleh ditempatkan sebagai job DRAF yang tidak bisa diterbitkan, diberi driver, atau dijalankan sampai unitnya "siap". Akibatnya barang yang
// sudah benar-benar berangkat tetap tidak bisa dicatat di rute hanya karena pencatatan produksinya (bahan baku, tahap) belum selesai. Aturan sekarang: STATUS PRODUKSI TIDAK MENAHAN PENGIRIMAN.
//   • unit RECEIVED/IN_PRODUCTION (order PROCESSING/READY) ditempatkan sebagai job BIASA, boleh diberi driver, diterbitkan, dijalankan, dan diselesaikan — tanpa saklar, tanpa catatan wajib;
//   • tidak ada pemeriksaan/QC/bukti/stok palsu: status unit dan Production Run TIDAK diubah saat penempatan. Saat unit BENAR-BENAR berangkat/terkirim sementara Run belum ditutup, Run diberi
//     penanda "dilepas untuk pengiriman" otomatis (services/unitCustodyCommandService.js: tandaiRunDilepasKarenaDispatchInTx) — jejak jujur, bukan konflik V1;
//   • layar hanya MENANDAI (informasi) bahwa produksi unit itu belum selesai: `menungguKonfirmasi`/`labelMenunggu` kini bersifat informasi, TIDAK memblokir apa pun.
// Yang tetap ditolak: unit batal/terkirim/sudah berangkat, unit yang belum sampai ke bengkel (AWAITING_PICKUP/IN_TRANSIT_IN), order yang bukan PROCESSING/READY, dan job pengiriman ganda.
// Murni baca (kecuali yang memanggil menulis job); tidak ada tabel/kolom baru — penanda selalu TURUNAN dari status unit saat ini.
import { bacaSiapFisik, nilaiSiap } from "./deliverySiapFisik.js";
import { ACTIVE_JOB_STATUSES } from "./jobStatus.js";

export const LABEL_MENUNGGU_KONFIRMASI = "Produksi belum selesai";
/** Status unit yang masih dikerjakan Produksi dan SAH dikirim lewat Route Planner (pencatatan produksi tidak menahan). */
export const STATUS_PRODUKSI_BISA_DIKIRIM = Object.freeze(["RECEIVED", "IN_PRODUCTION"]);
const STATUS_SIAP = ["READY_FOR_DELIVERY", "READY_ON_CUSTOMER_HOLD"];
const STATUS_TUNTAS = ["IN_TRANSIT_OUT", "DELIVERED", "CANCELLED"];
/** Status order yang sah untuk unit yang masih diproduksi: sedang diproduksi (PROCESSING) atau sudah READY. Order PENDING/CANCELLED/DELIVERED tidak. */
export const STATUS_ORDER_SAH_PRODUKSI = Object.freeze(["PROCESSING", "READY"]);

export class PenempatanUnitError extends Error {
  constructor(message, statusCode = 409, code = "PENEMPATAN_UNIT_DITOLAK", extra = null) { super(message); this.name = "PenempatanUnitError"; this.statusCode = statusCode; this.code = code; if (extra) this.extra = extra; }
}

/** Unit {id, unitCode, status} → apakah produksinya belum selesai? (tidak: sudah siap, sudah berangkat/terkirim, atau batal). Informasi tampilan saja. */
export function unitMenunggu(unit, siapFisik) {
  if (!unit) return false;
  if (STATUS_SIAP.includes(unit.status) || STATUS_TUNTAS.includes(unit.status)) return false;
  return !nilaiSiap(unit, siapFisik).siap;
}

/**
 * Untuk sekumpulan job: Map<jobId, [{ unitId, unitCode, status }]> unit yang produksinya MASIH berjalan (job DELIVERY saja; job tanpa unit seperti itu tidak ada di peta). Informasi tampilan.
 * `db` = prisma atau tx.
 */
export async function unitMenungguPerJob(db, jobIds) {
  const ids = [...new Set((jobIds ?? []).filter(Boolean))];
  const hasil = new Map();
  if (ids.length === 0) return hasil;
  const baris = await db.jobUnit.findMany({
    where: { jobId: { in: ids }, job: { type: "DELIVERY" } },
    select: { jobId: true, unit: { select: { id: true, unitCode: true, status: true } } },
  });
  const siapFisik = await bacaSiapFisik(db, baris.map((b) => b.unit.id));
  for (const b of baris) {
    if (!unitMenunggu(b.unit, siapFisik)) continue;
    if (!hasil.has(b.jobId)) hasil.set(b.jobId, []);
    hasil.get(b.jobId).push({ unitId: b.unit.id, unitCode: b.unit.unitCode, status: b.unit.status });
  }
  return hasil;
}

/** Tempel `menungguKonfirmasi` (daftar unit yang produksinya belum selesai, kosong bila tidak ada) + `labelMenunggu` pada tiap job (mutasi in-place, mengembalikan array yang sama). INFORMASI, bukan gerbang. */
export async function tandaiJobMenunggu(db, jobs) {
  const peta = await unitMenungguPerJob(db, (jobs ?? []).map((j) => j.id));
  for (const j of jobs ?? []) {
    const m = peta.get(j.id) ?? [];
    j.menungguKonfirmasi = m;
    j.labelMenunggu = m.length ? LABEL_MENUNGGU_KONFIRMASI : null;
  }
  return jobs;
}

/**
 * Validasi penempatan unit yang MASIH DIPRODUKSI ke job pengiriman: order sah, unit tidak batal/terkirim/sudah berangkat, dan tidak sudah ada di job DELIVERY aktif (tidak ada job ganda).
 * Hanya untuk unit berstatus RECEIVED/IN_PRODUCTION (unit siap kirim mengikuti jalur biasa). Mengembalikan daftar unit yang divalidasi; melempar PenempatanUnitError dengan alasan per unit.
 */
export async function validasiPenempatanUnitProduksi(db, units, { statusOrderSah = STATUS_ORDER_SAH_PRODUKSI } = {}) {
  const galat = [];
  const ada = await db.jobUnit.findMany({
    where: { unitId: { in: units.map((u) => u.id) }, job: { type: "DELIVERY", status: { in: [...ACTIVE_JOB_STATUSES] } } }, // definisi yang SAMA dengan papan (job RESCHEDULED tidak menahan unit: job penggantinya dibuat baru)
    select: { unitId: true, jobId: true },
  });
  const sudahDiJob = new Map(ada.map((a) => [a.unitId, a.jobId]));
  for (const u of units) {
    if (STATUS_TUNTAS.includes(u.status)) galat.push({ unitCode: u.unitCode, kode: u.status === "CANCELLED" ? "UNIT_BATAL" : "UNIT_SUDAH_BERANGKAT", pesan: `Unit ${u.unitCode} berstatus ${u.status}` });
    else if (!STATUS_PRODUKSI_BISA_DIKIRIM.includes(u.status)) galat.push({ unitCode: u.unitCode, kode: "UNIT_BELUM_DI_BENGKEL", pesan: `Unit ${u.unitCode} berstatus ${u.status} — barang belum sampai di bengkel` });
    else if (u.order && !statusOrderSah.includes(u.order.status)) galat.push({ unitCode: u.unitCode, kode: "ORDER_TIDAK_SAH", pesan: `Order ${u.order.orderNumber ?? ""} berstatus ${u.order.status}` });
    if (sudahDiJob.has(u.id)) galat.push({ unitCode: u.unitCode, kode: "JOB_GANDA", pesan: `Unit ${u.unitCode} sudah ada di job pengiriman aktif` });
  }
  if (galat.length) throw new PenempatanUnitError(`Penempatan ditolak: ${galat.map((g) => g.pesan).join("; ")}`, 409, galat[0].kode, { galat });
  return units;
}
