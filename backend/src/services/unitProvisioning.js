// Pembuatan Unit dari Order — mata rantai PERTAMA tulang punggung operasi.
//
// KONTEKS TEMUAN 1 Agustus 2026. Sebelum file ini ada, TIDAK ADA satu pun jalur
// runtime yang membuat Unit: 186 unit di production semuanya lahir dari migrasi
// backfill sekali-jalan (20260731100100). Akibatnya setiap order baru sejak 31
// Juli tidak punya unit sama sekali — dan karena dispatcher memilih unit
// ber-status AWAITING_PICKUP untuk menjadwalkan pickup, order-order itu TIDAK
// BISA masuk ke bengkel/armada sama sekali. Saat file ini ditulis sudah ada 10
// order yang menumpuk seperti itu.
//
// ⚠️ JUMLAH UNIT TIDAK DIAMBIL DARI `Order.quantity`. PHASE-0.md mencatatnya
// sebagai asumsi terbuka ("Order.quantity = jumlah kasur fisik?") dan migrasi
// backfill sudah terlanjur memakainya. Asumsi itu SALAH, dibuktikan dari data
// production: dari 4 order ber-quantity 2, tiga di antaranya adalah 2 BANTAL /
// 2 GULING, bukan 2 kasur ("Pembelian bantal baru", "Ganti kain guling",
// "Ganti kain bantal"). `quantity` adalah jumlah barang yang dipesan — yang
// KEBETULAN kasur di mayoritas kasus (191 dari 195 order ber-quantity 1).
// Memakainya sebagai jumlah kasur menciptakan unit hantu yang akan
// nyangkut selamanya di papan pickup.
//
// Karena itu jumlah unit bersifat EKSPLISIT dengan default 1 — sesuai maksud
// asli D-002 ("Order lama di-backfill sebagai order 1 unit"). Klien yang tahu
// ada lebih dari satu kasur mengirim `unitCount`; klien lama yang tidak
// mengirim apa-apa tetap benar untuk 94% kasus.

import { prisma } from "../db.js";
import { ensurePickupJobForOrder } from "./armadaAutoJob.js";

// Peta status Order → status Unit. SENGAJA sama persis dengan CASE di migrasi
// backfill supaya unit hasil backfill dan unit hasil runtime tidak pernah
// berbeda aturan. Kalau OrderStatus bertambah nilai, TAMBAHKAN di sini juga —
// default AWAITING_PICKUP adalah jaring pengaman, bukan izin untuk malas.
const UNIT_STATUS_BY_ORDER_STATUS = {
  PENDING: "AWAITING_PICKUP",
  PICKUP: "IN_TRANSIT_IN",
  PROCESSING: "IN_PRODUCTION",
  READY: "READY_FOR_DELIVERY",
  DELIVERED: "DELIVERED",
  CANCELLED: "CANCELLED",
};

export function unitStatusFromOrderStatus(orderStatus) {
  return UNIT_STATUS_BY_ORDER_STATUS[orderStatus] || "AWAITING_PICKUP";
}

// merk/ukuran hari ini disimpan sebagai blob JSON di dalam Order.notes lewat
// buildNotes() di frontend web DAN mobile (D-012) — bukan kolom asli. Baris
// lama berisi teks polos. Parser ini WAJIB gagal jadi null, tidak boleh
// melempar: satu order lawas berformat aneh tidak boleh menggagalkan
// pembuatan order baru.
export function parseOrderNotes(notes) {
  if (!notes || typeof notes !== "string") return {};
  try {
    const parsed = JSON.parse(notes);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function cleanString(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

// Awalan unitCode. Order lama hasil import Excel tidak punya orderNumber →
// fallback "LEG-<8 char id>", identik dengan yang dipakai migrasi backfill
// supaya kode unit tidak pernah punya dua format untuk kasus yang sama.
function unitCodePrefix(order) {
  return order.orderNumber || `LEG-${order.id.slice(0, 8)}`;
}

/**
 * Membuat `count` unit baru untuk sebuah order.
 *
 * Dipanggil DI DALAM transaksi pemanggil (parameter `tx`) supaya order dan
 * unit-unitnya lahir bersama — order tanpa unit adalah keadaan yang justru
 * sedang kita perbaiki, jangan sampai dibuat ulang oleh kegagalan separuh
 * jalan.
 *
 * `seq` melanjutkan dari nomor tertinggi yang sudah ada, bukan selalu dari 1 —
 * fungsi ini juga dipakai saat menambah kasur ke order yang sudah punya unit.
 */
export async function createUnitsForOrder(tx, { order, count = 1, statusOverride } = {}) {
  const jumlah = Math.floor(Number(count));
  if (!Number.isFinite(jumlah) || jumlah < 1) return [];

  const info = parseOrderNotes(order.notes);
  const merk = cleanString(info.merkKasur);
  const ukuran = cleanString(info.ukuranKasur);
  // D-051 (4 September 2026) — laporan owner: "layanan baru itu bikin
  // produk/kasur baru, prosesnya beda dari service/upgrade, jangan status
  // pengambilan". unitStatusFromOrderStatus() SELALU menghasilkan
  // AWAITING_PICKUP untuk order yang baru dibuat (Order.status masih
  // PENDING) — itu benar untuk LAYANAN/SEWA (memang ada barang lama yang
  // perlu diambil dari customer), tapi SALAH untuk BARU: tidak ada apa pun
  // untuk "diambil", unit-nya adalah kasur baru yang akan DIBUAT dari nol
  // di workshop. Skip AWAITING_PICKUP → PICKUP job → RECEIVED sama sekali;
  // unit BARU lahir langsung RECEIVED (setara "sudah di workshop, siap
  // mulai tahap produksi pertama"). Efek berantai yang diinginkan:
  //   1. Baris `if (status === "AWAITING_PICKUP")` di bawah TIDAK terpicu
  //      → ensurePickupJobForOrder() tidak pernah membuat Job PICKUP.
  //   2. Unit langsung masuk daftar IN_WORKSHOP (production.js) — tampil
  //      di Papan Produksi hari itu juga, bukan nyangkut menunggu "diambil"
  //      dulu oleh driver yang sebenarnya tidak perlu datang.
  //   3. Begitu seluruh tahap produksi tuntas, unit jadi READY_FOR_DELIVERY
  //      → suggestDeliveryJob() (unitStageEngine.js) buat Job DELIVERY —
  //      jalur ini SUDAH kategori-agnostik, tidak perlu disentuh.
  // Bukan cabang berdasar Order.status (yang tetap PENDING) — SENGAJA
  // berdasar Order.category, supaya statusOverride pemanggil lain (mis.
  // menambah unit ke order yang sudah PROCESSING) tetap menang seperti
  // biasa lewat `statusOverride ||` di bawah.
  const status = statusOverride || (order.category === "BARU" ? "RECEIVED" : unitStatusFromOrderStatus(order.status));
  const prefix = unitCodePrefix(order);

  // Nomor urut terakhir di order ini. Unique constraint @@unique([orderId, seq])
  // + unitCode unique adalah penjaga sebenarnya kalau ada dua request barengan;
  // yang kalah akan gagal keras, bukan menimpa diam-diam.
  const terakhir = await tx.unit.findFirst({
    where: { orderId: order.id },
    orderBy: { seq: "desc" },
    select: { seq: true },
  });
  const mulai = (terakhir?.seq || 0) + 1;

  const data = Array.from({ length: jumlah }, (_, i) => ({
    unitCode: `${prefix}-U${mulai + i}`,
    orderId: order.id,
    seq: mulai + i,
    merk,
    ukuran,
    status,
  }));

  await tx.unit.createMany({ data });

  // Jembatan otomatis ke Delivery Hub (24 Agustus 2026, lihat
  // services/armadaAutoJob.js) — HANYA relevan kalau unit yang baru lahir
  // langsung AWAITING_PICKUP (order status PENDING/PICKUP saat dibuat).
  // Unit yang lahir di bucket lain (mis. status order sudah PROCESSING saat
  // unit ditambahkan belakangan) tidak butuh job pickup sama sekali.
  if (status === "AWAITING_PICKUP") {
    // Lewat `order` utuh (bukan cuma id) — D-040, alamat sales
    // (deliveryAddress/deliveryCity) langsung diisi ke job baru, lihat
    // catatan lengkap di armadaAutoJob.js.
    await ensurePickupJobForOrder(tx, order);
  }

  // KOREKSI D-051 lanjutan (4 September 2026) — ditemukan lewat halaman
  // "Semua Order" yang baru dibuat: order BARU yang unit-nya baru saja
  // dipaksa RECEIVED di atas TETAP tampil "Pengambilan" di Sales CRM/
  // Delivery, karena Order.status TIDAK ikut berubah. syncOrderStatus()
  // (orderStatusSync.js) SENGAJA no-op selama belum ada unit yang
  // currentStageId-nya terisi (baru diisi startStage(), begitu Produksi
  // benar-benar menekan "Mulai Tahap") — jaring pengaman itu dirancang
  // untuk backfill lama, BUKAN untuk kasus ini: di sini kita SUDAH TAHU
  // PASTI unit sedang di workshop siap produksi (kita yang barusan
  // menetapkannya RECEIVED), tidak ada alasan menunggu.
  // Set LANGSUNG (bukan lewat syncOrderStatus) — hormati statusLocked (D-006:
  // override manual menang mutlak) dan JANGAN mundurkan order yang kebetulan
  // sudah lebih maju (mis. menambah unit ke-2 ke order BARU yang sudah READY).
  if (order.category === "BARU" && status === "RECEIVED" && !order.statusLocked && ["PENDING", "PICKUP"].includes(order.status)) {
    await tx.order.update({ where: { id: order.id }, data: { status: "PROCESSING" } });
    await tx.orderStatusTransition.create({
      data: { orderId: order.id, fromStatus: order.status, toStatus: "PROCESSING", changedById: null },
    });
  }

  return tx.unit.findMany({
    where: { orderId: order.id, seq: { gte: mulai } },
    orderBy: { seq: "asc" },
  });
}

/**
 * Daftar order yang belum punya unit sama sekali — dipakai script pemulihan
 * untuk order yang terlanjur dibuat selagi mata rantai ini putus.
 */
export function findOrdersWithoutUnits(client = prisma) {
  return client.order.findMany({
    where: { units: { none: {} } },
    orderBy: { createdAt: "asc" },
    select: { id: true, orderNumber: true, status: true, notes: true, createdAt: true },
  });
}
