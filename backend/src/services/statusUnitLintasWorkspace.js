// SATU-SATUNYA JALUR perubahan status unit LINTAS WORKSPACE (keputusan Owner, 19 Okt 2026): Siap Kirim, Berangkat, Terkirim, Dibatalkan.
// Prinsip bisnis: status/kelengkapan pencatatan Produksi tidak boleh menjadi penghalang global bagi Sales dan Delivery. Pencatatan bahan/tahap/QC/penutupan Production Run bisa tertinggal dari kondisi fisik.
// Semua pemanggil — dropdown/Batalkan Order Sales, mulai/selesai job Delivery, Admin override Siap Kirim — memanggil fungsi yang SAMA ini, bukan menulis status unit/job/Run sendiri-sendiri:
//
//   SIAP_KIRIM  unit → READY_FOR_DELIVERY; Run berjalan DILEPAS (penanda, bukan ditutup); tepat satu job pengiriman (suggestDeliveryJob: dipakai ulang bila ada, tidak pernah ganda).
//   BERANGKAT   unit → IN_TRANSIT_OUT; Run berjalan dilepas; status order disinkronkan.
//   TERKIRIM    unit → DELIVERED; Run berjalan dilepas (boleh ditutup administratif kemudian tanpa mengubah status pengiriman); status order + job/rute (bila dari Sales) disinkronkan lewat jalur Delivery yang sama.
//   KEMBALI     (pengiriman gagal) unit yang sedang dibawa driver (IN_TRANSIT_OUT) kembali ke READY_FOR_DELIVERY; status order disinkronkan; penawaran retur ke Gudang oleh pemanggil (custody).
//   BATAL       unit → CANCELLED; Run/tahap/operasi dihentikan, permintaan bahan belum diserahkan dibatalkan, reservasi dilepas, rencana dibatalkan, job pengiriman belum berangkat dibatalkan. Bahan yang SUDAH keluar
//               TIDAK dibalik otomatis: dicatat di Antrean Retur Bahan Gudang (jumlah nyata diterima Gudang), pembatalan tidak menunggu koreksi stok.
//
// Tidak ada QC, foto, tahap, stok, atau bukti palsu: Produksi menyimpan riwayat sebenarnya (Run tidak ditutup/dipalsukan). Idempoten: unit yang sudah di status tujuan dilewati; job pengiriman tidak digandakan.
// Yang DITOLAK hanya karena fakta operasional: BATAL pada unit yang sudah berangkat/terkirim (dengan pilihan tindakan koreksi yang jelas).
// Pengecualian khusus: order PKR memakai aturan khususnya sendiri di pemanggil (tidak melewati fungsi ini untuk pembatalan PKR).
import { lockRowForUpdate } from "./inventoryLedger.js";
import { suggestDeliveryJob } from "./deliveryHandoff.js";
import { selaraskanProduksiDenganOrderInTx } from "./orderProduksiSelaras.js";
import { tandaiRunDilepasKarenaDispatchInTx } from "./unitCustodyCommandService.js";
import { cancelOrderDeliveryJobs } from "./deliveryJobCancellationService.js";
import { syncOrderStatusForUnits, selesaikanJobBelumJalan } from "./orderStatusSync.js";

export const KE_STATUS = Object.freeze({ SIAP_KIRIM: "SIAP_KIRIM", BERANGKAT: "BERANGKAT", TERKIRIM: "TERKIRIM", BATAL: "BATAL", KEMBALI: "KEMBALI" });
export const SUMBER_STATUS = Object.freeze({ SALES: "SALES", DELIVERY_JOB: "DELIVERY_JOB", ADMIN_OVERRIDE: "ADMIN_OVERRIDE" });
const STATUS_UNIT = Object.freeze({ SIAP_KIRIM: "READY_FOR_DELIVERY", BERANGKAT: "IN_TRANSIT_OUT", TERKIRIM: "DELIVERED", BATAL: "CANCELLED", KEMBALI: "READY_FOR_DELIVERY" });
const STATUS_SIAP = ["READY_FOR_DELIVERY", "READY_ON_CUSTOMER_HOLD"];

export class StatusLintasError extends Error {
  constructor(message, statusCode = 409, code = "STATUS_LINTAS_DITOLAK", pilihanKoreksi = [], extra = null) {
    super(message); this.name = "StatusLintasError"; this.statusCode = statusCode; this.code = code; this.pilihanKoreksi = pilihanKoreksi; if (extra) this.extra = extra;
  }
}

const PILIHAN_BERANGKAT = Object.freeze([
  "Selesaikan pengirimannya di Armada (Terkirim), lalu ubah order bila perlu.",
  "Bila barang tidak jadi dikirim: tandai pengiriman Gagal di Armada (unit kembali ke Gudang), lalu batalkan order.",
  "Bila memang harus dibatalkan sekarang: minta Admin/Kendali mengoreksi (hubungi Owner) — tidak bisa dibatalkan langsung dari Sales.",
]);
const PILIHAN_TERKIRIM = Object.freeze([
  "Order sudah terkirim: gunakan alur Komplain/Retur/Pembatalan resmi lewat Kendali/Admin — pembatalan langsung tidak diizinkan.",
  "Bila status Terkirim keliru: Admin dapat menarik balik lewat jalur resmi tarik-balik Delivered (hubungi Owner).",
]);

// Klasifikasi per unit terhadap target: "ubah" | "lewati" (sudah di tujuan / tidak relevan) | "tolak" (fakta operasional tidak cocok).
export function klasifikasiUnit(statusSekarang, ke) {
  if (statusSekarang === "CANCELLED") return { aksi: "lewati" };
  if (ke === KE_STATUS.BATAL) {
    if (statusSekarang === "IN_TRANSIT_OUT") return { aksi: "tolak", kode: "UNIT_SUDAH_BERANGKAT", pesan: "sudah berangkat (dalam pengiriman)", pilihan: PILIHAN_BERANGKAT };
    if (statusSekarang === "DELIVERED") return { aksi: "tolak", kode: "UNIT_SUDAH_TERKIRIM", pesan: "sudah terkirim", pilihan: PILIHAN_TERKIRIM };
    return { aksi: "ubah" };
  }
  if (ke === KE_STATUS.KEMBALI) return statusSekarang === "IN_TRANSIT_OUT" ? { aksi: "ubah" } : { aksi: "lewati" };
  if (statusSekarang === "DELIVERED") return { aksi: "lewati" };
  if (ke === KE_STATUS.SIAP_KIRIM) return STATUS_SIAP.includes(statusSekarang) ? { aksi: "lewati", jobIdempoten: true } : statusSekarang === "IN_TRANSIT_OUT" ? { aksi: "lewati" } : { aksi: "ubah" };
  if (ke === KE_STATUS.BERANGKAT) return statusSekarang === "IN_TRANSIT_OUT" ? { aksi: "lewati" } : { aksi: "ubah" };
  if (ke === KE_STATUS.TERKIRIM) return { aksi: "ubah" };
  return { aksi: "ubah" };
}

/**
 * @param tx transaksi Prisma milik pemanggil (satu transaksi untuk SEMUA efek)
 * @param {{
 *   unitIds: string[], ke: "SIAP_KIRIM"|"BERANGKAT"|"TERKIRIM"|"BATAL", aktor?: string|null, sumber: "SALES"|"DELIVERY_JOB"|"ADMIN_OVERRIDE", alasan?: string|null,
 *   jobId?: string|null, orderId?: string|null, orderStatusSebelum?: string|null, lokasiPengambilan?: string|null,
 *   sinkronOrder?: boolean, forceStaged?: boolean, batalkanJobOrder?: boolean, selesaikanJobOrder?: boolean,
 * }} p
 */
export async function ubahStatusUnitInTx(tx, p) {
  const { ke, aktor = null, sumber, alasan = null, jobId = null, orderId = null, orderStatusSebelum = null, lokasiPengambilan = null, sinkronOrder = true, forceStaged = false, batalkanJobOrder = false, selesaikanJobOrder = false } = p;
  if (!KE_STATUS[ke]) throw new Error(`target status tidak dikenal: ${ke}`);
  if (!SUMBER_STATUS[sumber]) throw new Error(`sumber perubahan tidak dikenal: ${sumber}`);
  const ids = [...new Set((p.unitIds ?? []).filter(Boolean))].sort();
  const hasil = { ke, sumber, diubah: [], dilewati: [], run: { dibatalkan: [], dilepas: [], peringatan: [], returGudang: [] }, jobSiap: [] };
  if (ids.length === 0) return hasil;

  // Kunci unit (urutan tetap) — serial dengan command Produksi yang juga mengunci unit; status dibaca ULANG di bawah kunci.
  for (const id of ids) await lockRowForUpdate(tx, "units", id);
  const units = await tx.unit.findMany({ where: { id: { in: ids } }, select: { id: true, unitCode: true, status: true, orderId: true }, orderBy: { id: "asc" } });

  const ubah = []; const tolak = [];
  for (const u of units) {
    const k = klasifikasiUnit(u.status, ke);
    if (k.aksi === "ubah") ubah.push(u);
    else if (k.aksi === "tolak") tolak.push({ ...u, ...k });
    else hasil.dilewati.push({ unitId: u.id, unitCode: u.unitCode, status: u.status, jobIdempoten: !!k.jobIdempoten });
  }
  if (tolak.length > 0) {
    const kode = tolak[0].kode;
    throw new StatusLintasError(
      `Tidak bisa ${ke === KE_STATUS.BATAL ? "membatalkan" : "mengubah"} — unit ${tolak.map((t) => `${t.unitCode} ${t.pesan}`).join(", ")}.`,
      409, kode, [...tolak[0].pilihan], { unitCodes: tolak.map((t) => t.unitCode) },
    );
  }
  const ubahIds = ubah.map((u) => u.id);
  const orderTujuan = orderId ?? units[0]?.orderId ?? null;

  // ── Sisi Produksi: SEBELUM status unit berubah (penanda Run membaca status produksi saat ini)
  if (ubahIds.length > 0) {
    if (ke === KE_STATUS.BATAL) {
      const r = await selaraskanProduksiDenganOrderInTx(tx, { orderId: orderTujuan, aksi: "CANCEL", actorId: aktor, alasan, orderStatusSebelum, unitIds: ubahIds });
      hasil.run.dibatalkan.push(...r.runDibatalkan); hasil.run.peringatan.push(...r.peringatan); hasil.run.returGudang.push(...r.returGudang);
    } else if (sumber === SUMBER_STATUS.SALES) {
      const aksi = ke === KE_STATUS.SIAP_KIRIM ? "READY" : ke === KE_STATUS.TERKIRIM ? "DELIVERED" : null;
      if (aksi) { const r = await selaraskanProduksiDenganOrderInTx(tx, { orderId: orderTujuan, aksi, actorId: aktor, alasan, orderStatusSebelum, unitIds: ubahIds }); hasil.run.dilepas.push(...r.runDilepas); }
    } else if (sumber === SUMBER_STATUS.DELIVERY_JOB) {
      // Berangkat/terkirim lewat job Delivery: Run yang belum ditutup diberi penanda dilepas (kind DISPATCH_ROUTE_PLANNER) dengan jejak job + pelaku.
      const via = ke === KE_STATUS.BERANGKAT ? "JOB_START" : "JOB_COMPLETE";
      const dilepas = await tandaiRunDilepasKarenaDispatchInTx(tx, { unitIds: ubahIds, jobId, actorId: aktor, via });
      hasil.run.dilepas.push(...dilepas.map((d) => ({ runId: d.runId, unitCode: d.unitCode })));
    }
    // ADMIN_OVERRIDE: penanda Run (kind ADMIN_OVERRIDE, rekam keputusan Admin) ditulis oleh pemanggil sesudah fungsi ini; di sini hanya status/job/order.
  }

  // ── Status unit (satu-satunya penulisan status pengiriman/batal lintas workspace)
  if (ubahIds.length > 0) {
    await tx.unit.updateMany({ where: { id: { in: ubahIds } }, data: { status: STATUS_UNIT[ke], ...(lokasiPengambilan && ke === KE_STATUS.SIAP_KIRIM ? { storageLocation: lokasiPengambilan } : {}) } });
    for (const u of ubah) hasil.diubah.push({ unitId: u.id, unitCode: u.unitCode, dari: u.status, ke: STATUS_UNIT[ke] });
  }

  // ── Sinkronisasi order/job/rute menurut target
  if (ke === KE_STATUS.SIAP_KIRIM) {
    // Tepat satu job pengiriman per unit: suggestDeliveryJob idempoten (job draf/ada dipakai, tidak pernah ganda). Juga untuk unit yang SUDAH siap (klik/request ganda aman).
    const siapIds = [...ubahIds, ...hasil.dilewati.filter((d) => d.jobIdempoten).map((d) => d.unitId)];
    for (const id of siapIds) { await suggestDeliveryJob(tx, id); hasil.jobSiap.push(id); }
    if (sinkronOrder && ubahIds.length) await syncOrderStatusForUnits(tx, ubahIds);
  } else if (ke === KE_STATUS.BERANGKAT || ke === KE_STATUS.KEMBALI) {
    if (sinkronOrder && ubahIds.length) await syncOrderStatusForUnits(tx, ubahIds);
  } else if (ke === KE_STATUS.TERKIRIM) {
    if (selesaikanJobOrder && orderTujuan) await selesaikanJobBelumJalan(tx, orderTujuan); // jalur Delivery yang sama: job + sinkron rute (tanpa foto/driver palsu: tampil "Belum Lengkap")
    if (sinkronOrder && ubahIds.length) await syncOrderStatusForUnits(tx, ubahIds, forceStaged ? { forceStagedUnitIds: new Set(ubahIds) } : undefined);
  } else if (ke === KE_STATUS.BATAL) {
    if (batalkanJobOrder && orderTujuan) await cancelOrderDeliveryJobs(tx, { orderId: orderTujuan, actorId: aktor, reason: String(alasan ?? "").trim() || "Dibatalkan" });
  }
  return hasil;
}
