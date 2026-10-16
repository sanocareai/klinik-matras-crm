// "MENUNGGU KONFIRMASI SIAP KIRIM" — kandidat Route Planner untuk unit yang masih dalam Produksi (16 Okt 2026, kasus RES-03102026-018-U1).
//
// Unit yang masih RECEIVED/IN_PRODUCTION boleh DITEMPATKAN sebagai job DELIVERY berstatus draf (tanpa driver) supaya dispatcher bisa merencanakan rute lebih awal. Itu BUKAN kesiapan:
//   • status unit TIDAK berubah, tidak ada bukti tahap/QC/stok/serah terima yang dibuat;
//   • job semacam itu TIDAK boleh diterbitkan (publish), diberi driver, atau dijalankan sampai SETIAP unitnya siap: status Produksi READY_FOR_DELIVERY/READY_ON_CUSTOMER_HOLD, atau
//     kesiapan fisik terkonfirmasi (order PKR, mode transisi — services/deliverySiapFisik.js). Kesiapan datang dari "Selesaikan Produksi"/"Konfirmasi Barang Jadi" atau penerimaan Gudang resmi.
//   • dinilai PER UNIT: job multi-unit menunggu selama masih ada satu unit yang belum siap; label menyebut unit yang menunggu.
// Murni baca (kecuali yang memanggil menulis job); tidak ada tabel/kolom baru — status "menunggu" selalu TURUNAN dari status unit saat ini.
import { bacaSiapFisik, nilaiSiap } from "./deliverySiapFisik.js";

export const LABEL_MENUNGGU_KONFIRMASI = "Menunggu konfirmasi siap kirim";
/** Status unit yang masih dikerjakan Produksi dan sah ditempatkan sebagai draf. */
export const STATUS_BISA_DITEMPATKAN_DRAF = Object.freeze(["RECEIVED", "IN_PRODUCTION"]);
const STATUS_SIAP = ["READY_FOR_DELIVERY", "READY_ON_CUSTOMER_HOLD"];
const STATUS_TUNTAS = ["IN_TRANSIT_OUT", "DELIVERED", "CANCELLED"];
/** Status order yang sah untuk penempatan DRAF: order yang sedang diproduksi (PROCESSING) atau sudah READY. Order PENDING/CANCELLED/DELIVERED tidak. (Job biasa tetap mensyaratkan order READY.) */
export const STATUS_ORDER_SAH_DRAF = Object.freeze(["PROCESSING", "READY"]);

export class MenungguKonfirmasiError extends Error {
  constructor(message, statusCode = 409, code = "MENUNGGU_KONFIRMASI_SIAP_KIRIM", extra = null) { super(message); this.name = "MenungguKonfirmasiError"; this.statusCode = statusCode; this.code = code; if (extra) this.extra = extra; }
}

/** Unit {id, unitCode, status} → apakah menunggu konfirmasi? (tidak menunggu: sudah siap, sudah berangkat/terkirim, atau batal). */
export function unitMenunggu(unit, siapFisik) {
  if (!unit) return false;
  if (STATUS_SIAP.includes(unit.status) || STATUS_TUNTAS.includes(unit.status)) return false;
  return !nilaiSiap(unit, siapFisik).siap;
}

/**
 * Untuk sekumpulan job: Map<jobId, [{ unitId, unitCode, status }]> unit yang MASIH menunggu (job DELIVERY saja; job tanpa unit menunggu tidak ada di peta).
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

/** Tempel `menungguKonfirmasi` (daftar unit, kosong bila siap) + `labelMenunggu` pada tiap job (mutasi in-place, mengembalikan array yang sama). */
export async function tandaiJobMenunggu(db, jobs) {
  const peta = await unitMenungguPerJob(db, (jobs ?? []).map((j) => j.id));
  for (const j of jobs ?? []) {
    const m = peta.get(j.id) ?? [];
    j.menungguKonfirmasi = m;
    j.labelMenunggu = m.length ? LABEL_MENUNGGU_KONFIRMASI : null;
  }
  return jobs;
}

/** Gerbang dispatch: lempar 409 bila ada job DELIVERY yang masih punya unit menunggu. Dipakai publish rute, penugasan driver, dan start. */
export async function pastikanJobSiapDispatch(db, jobIds, { aksi = "diterbitkan" } = {}) {
  const peta = await unitMenungguPerJob(db, jobIds);
  if (peta.size === 0) return;
  const unit = [...peta.values()].flat();
  const kode = [...new Set(unit.map((u) => u.unitCode))];
  throw new MenungguKonfirmasiError(
    `${LABEL_MENUNGGU_KONFIRMASI}: ${kode.join(", ")}. Rute/job tidak bisa ${aksi} sebelum setiap unit siap kirim (selesaikan produksi atau konfirmasi barang jadi dulu).`,
    409, "MENUNGGU_KONFIRMASI_SIAP_KIRIM", { menungguKonfirmasi: unit, jobIds: [...peta.keys()] },
  );
}

/**
 * Validasi penempatan DRAF (POST /jobs { menungguKonfirmasi: true }): hanya unit yang masih dikerjakan Produksi, order sah, tidak batal/terkirim, tidak sudah ada di job DELIVERY aktif
 * (tidak ada job ganda). Mengembalikan daftar unit yang divalidasi; melempar MenungguKonfirmasiError dengan alasan per unit.
 */
export async function validasiPenempatanDraf(db, units, { statusOrderSah = STATUS_ORDER_SAH_DRAF } = {}) {
  const galat = [];
  const ada = await db.jobUnit.findMany({
    where: { unitId: { in: units.map((u) => u.id) }, job: { type: "DELIVERY", status: { notIn: ["COMPLETED", "FAILED"] } } },
    select: { unitId: true, jobId: true },
  });
  const sudahDiJob = new Map(ada.map((a) => [a.unitId, a.jobId]));
  for (const u of units) {
    if (STATUS_TUNTAS.includes(u.status)) galat.push({ unitCode: u.unitCode, kode: u.status === "CANCELLED" ? "UNIT_BATAL" : "UNIT_SUDAH_BERANGKAT", pesan: `Unit ${u.unitCode} berstatus ${u.status}` });
    else if (STATUS_SIAP.includes(u.status)) galat.push({ unitCode: u.unitCode, kode: "UNIT_SUDAH_SIAP", pesan: `Unit ${u.unitCode} sudah siap kirim — jadwalkan sebagai job biasa` });
    else if (!STATUS_BISA_DITEMPATKAN_DRAF.includes(u.status)) galat.push({ unitCode: u.unitCode, kode: "UNIT_BUKAN_PRODUKSI", pesan: `Unit ${u.unitCode} berstatus ${u.status} — bukan pekerjaan Produksi yang sedang berjalan` });
    else if (u.order && !statusOrderSah.includes(u.order.status)) galat.push({ unitCode: u.unitCode, kode: "ORDER_TIDAK_SAH", pesan: `Order ${u.order.orderNumber ?? ""} berstatus ${u.order.status}` });
    if (sudahDiJob.has(u.id)) galat.push({ unitCode: u.unitCode, kode: "JOB_GANDA", pesan: `Unit ${u.unitCode} sudah ada di job pengiriman aktif` });
  }
  if (galat.length) throw new MenungguKonfirmasiError(`Penempatan draf ditolak: ${galat.map((g) => g.pesan).join("; ")}`, 409, galat[0].kode, { galat });
  return units;
}
