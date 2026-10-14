// SINKRONISASI PENJUALAN KARYAWAN (PKR Finance) → ORDER CRM → UNIT PRODUKSI → DELIVERY.
//
// PRINSIP (jangan dilanggar):
//   1. PKR (fin_penjualan_karyawan) tetap SATU-SATUNYA sumber nominal, cicilan, pembayaran, piutang, dan jurnal. Order CRM hasil sinkronisasi HANYA dokumen operasional:
//      value = 0, tanpa OrderItem, tanpa Payment, tanpa invoice, tanpa jurnal, salesOwnerId = null. Trigger DB (migrasi 20261031090000) menolak payments / invoices / baris
//      jurnal / OrderItem baru yang menunjuk order ini; kode aplikasi menolak lebih dulu dengan pesan yang jelas.
//   2. Tautan PKR ↔ Order 1:1: UNIQUE pada Order.penjualanKaryawanId. Pembuatan di bawah KUNCI BARIS PKR (lockRowForUpdate) dan idempoten: permintaan ulang / paralel mengembalikan
//      order yang sama, tidak pernah membuat order atau unit kedua. Pemilik order = SATU profil Customer internal PER KARYAWAN (Customer.staffUserId UNIQUE, diisi dari PKR.sellerId = ID
//      akun yang stabil — bukan nama/email): semua PKR karyawan yang sama memakai ulang profil itu, tiap PKR tetap punya Order sendiri. Nama di profil hanyalah snapshot; nama pembeli
//      (kerabat) tetap di PKR.buyerName dan disalin sebagai snapshot ke catatan order.
//   3. Unit lahir lewat jalur BAKU createOrderForCustomer → createUnitsForOrder (unitProvisioning.js); job pickup/delivery lewat ensurePickup/DeliveryJob yang SUDAH idempoten.
//      Tidak ada jalur Produksi/Delivery baru.
//   4. Spesifikasi produksi (merk, ukuran, dikirim/diambil, alamat bila dikirim) dihitung dinamis (lib/domain/pkrSpesifikasi.js). Belum lengkap = "Perlu dilengkapi" dan
//      startStageInTx menolak memulai tahap. Delivery job otomatis HANYA bila order ditandai perlu dikirim (suggestDeliveryJob).
//   5. Pembatalan PKR setelah Produksi/Delivery berjalan DIBLOKIR; sebelum itu order, unit, dan job (yang belum berjalan) dibatalkan lewat jalur baku — tidak ada yang dihapus.
//   6. MULTI-ITEM (Okt 2026): satu PKR -> satu Order -> banyak item produksi (kasur + divan + sandaran, dst) di pkr_order_items, tiap item melahirkan unitnya sendiri lewat jalur
//      baku (services/penjualanKaryawanItem.js). Masukan lama (kategori/jumlahUnit/merk/ukuran) TETAP bekerja untuk klien lama; order lama tanpa item dibaca sebagai "item virtual".
import { prisma } from "../db.js";
import { lockRowForUpdate } from "./inventoryLedger.js";
import { createOrderForCustomer } from "./orderCreation.js";
import { cancelOrderDeliveryJobs } from "./deliveryJobCancellationService.js";
import { assertOrderUnitsNotV2Owned } from "./productionRunGuards.js";
import { kunciKanonis } from "./finance/urutanKunci.js";
import { ensureDeliveryJobForOrder } from "./armadaAutoJob.js";
import { syncCustomerOrderAggregate } from "./customerOrderAggregate.js";
import { siapkanNotesUkuran, sinkronUkuranUnit } from "../lib/ukuranKasur.js";
import { ukuranCustomWajibSejak } from "./ukuranWajib.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../lib/activityLog.js";
import { bacaSpesifikasiPkr, bacaNotesOrder } from "../lib/domain/pkrSpesifikasi.js";
import { toMoney, sumMoney, moneyToNumber, ZERO } from "./finance/money.js";
import {
  siapkanItems, lahirkanItemDanUnit, ubahItemOrder, susunCerminan, kunciHimpunan, productLineDariItems, itemDariRow, ITEM_AKTIF,
} from "./penjualanKaryawanItem.js";
import { revisiTerakhir } from "./pkrItemRevisi.js";
import { LABEL_UNIT, LABEL_JOB, susunBarisUnitPkr } from "../lib/domain/pkrUnitBaris.js";
import { bacaPembeli, bacaPemenuhan } from "../lib/domain/pkrPembeli.js";
import { identitasPkr, proyeksiIdentitas, PKR_IDENTITAS_SELECT } from "../lib/domain/pkrIdentitas.js";
import { customerAktualUntukPkr } from "./penjualanKaryawanPembeli.js";
import { MAKS_UNIT_ORDER, kategoriOrderDariItems, perluDikirimDariItems, itemVirtualLama } from "../lib/domain/pkrItem.js";

import { PkrOrderError, tolakJikaOrderPkr } from "./pkrGuard.js";
export { PkrOrderError, tolakJikaOrderPkr };
const gagal = (m, s = 400, c = null, e = null) => new PkrOrderError(m, s, c, e);

export const KATEGORI_PKR = ["BARU", "LAYANAN"];
const STATUS_UNIT_AWAL = ["AWAITING_PICKUP", "RECEIVED"];
const STATUS_JOB_BERJALAN = ["ASSIGNED", "EN_ROUTE", "ARRIVED", "COMPLETED", "FAILED"];
const TAG_PKR = "Penjualan Karyawan";

const teks = (v, maks, nama) => {
  if (v === undefined || v === null) return undefined;
  const t = String(v).trim();
  if (t.length > maks) throw gagal(`${nama} maksimal ${maks} karakter`);
  return t === "" ? null : t;
};

/** Normalisasi masukan spesifikasi (semua opsional). `undefined` = tidak diubah/tidak diisi. */
export function normalisasiSpesifikasi(m = {}) {
  const o = m ?? {};
  // Daftar item (multi-item). Tidak boleh dicampur dengan isian lama — satu bentuk per permintaan supaya tidak ambigu.
  let items;
  if (o.items !== undefined && o.items !== null) {
    if (!Array.isArray(o.items)) throw gagal("Daftar item produksi tidak valid");
    const lama = ["kategori", "jumlahUnit", "merk", "ukuran"].filter((k) => o[k] !== undefined && o[k] !== null && o[k] !== "");
    if (lama.length) throw gagal(`Isian lama (${lama.join(", ")}) tidak bisa dipakai bersama daftar item — pakai salah satu`, 400, "SPEK_CAMPUR");
    items = o.items;
  }
  const kategori = o.kategori === undefined || o.kategori === null || o.kategori === "" ? undefined : String(o.kategori);
  if (kategori !== undefined && !KATEGORI_PKR.includes(kategori)) throw gagal("Jenis pekerjaan harus Kasur Baru atau Service/Upgrade");
  let jumlahUnit;
  if (o.jumlahUnit !== undefined && o.jumlahUnit !== null && o.jumlahUnit !== "") {
    jumlahUnit = Number(o.jumlahUnit);
    if (!Number.isInteger(jumlahUnit) || jumlahUnit < 1 || jumlahUnit > MAKS_UNIT_ORDER) throw gagal(`Jumlah unit harus bilangan bulat 1–${MAKS_UNIT_ORDER}`);
  }
  let perluDikirim;
  if (o.perluDikirim !== undefined && o.perluDikirim !== null && o.perluDikirim !== "") {
    if (typeof o.perluDikirim !== "boolean") throw gagal("Pilihan dikirim atau diambil sendiri tidak valid");
    perluDikirim = o.perluDikirim;
  }
  const tanggalKirim = teks(o.tanggalKirim, 10, "Tanggal kirim");
  if (tanggalKirim && !/^\d{4}-\d{2}-\d{2}$/.test(tanggalKirim)) throw gagal("Tanggal kirim harus berformat YYYY-MM-DD");
  return {
    items, kategori, jumlahUnit, perluDikirim,
    merk: teks(o.merk, 100, "Merk kasur"), ukuran: teks(o.ukuran, 100, "Ukuran"),
    alamat: teks(o.alamat, 500, "Alamat pengiriman"), kota: teks(o.kota, 100, "Kota"), tanggalKirim,
  };
}

// Keluhan/catatan order + penanda "pembeli adalah karyawan" (jalur eksplisit; tanpa penanda ini profil karyawan dianggap data legacy).
const ekstraNotes = (e = {}) => ({
  ...(e.keluhan && { keluhanCustomer: e.keluhan }), ...(e.catatanOrder && { catatanOrder: e.catatanOrder }), ...(e.pembeliKaryawan && { pembeliKaryawan: true }),
});

const susunNotes = ({ merk, ukuran, pkr, catatan, ekstra }) => JSON.stringify({
  ...(merk && { merkKasur: merk }), ...(ukuran && { ukuranKasur: ukuran }), ...ekstraNotes(ekstra),
  pkrNomor: pkr.nomor, pembeliPkr: pkr.buyerName, catatan: `Penjualan Karyawan ${pkr.nomor} — penjual ${pkr.seller.name}, pembeli ${pkr.buyerName}${catatan ? `. ${catatan}` : ""}`,
});

const susunNotesItems = ({ items, pkr, catatan, nonProduksi = [], ekstra }) => JSON.stringify({
  pkrItems: susunCerminan(items), ...ekstraNotes(ekstra),
  // Item penjualan tanpa unit (Ambil dari Stok / Tanpa Operasional): nama + jumlah + cara pemenuhan, TANPA harga — supaya Gudang/CRM tahu apa yang dijual bersama pekerjaan ini.
  ...(nonProduksi.length && { pkrNonProduksi: nonProduksi }),
  pkrNomor: pkr.nomor, pembeliPkr: pkr.buyerName, catatan: `Penjualan Karyawan ${pkr.nomor} — penjual ${pkr.seller.name}, pembeli ${pkr.buyerName}${catatan ? `. ${catatan}` : ""}`,
});

/**
 * Profil Customer internal karyawan: SATU per karyawan, dikenali lewat ID akun (Customer.staffUserId), dipakai ulang oleh semua PKR-nya. Pencarian-lalu-buat dilakukan di bawah kunci
 * baris User supaya dua PKR bersamaan milik karyawan yang sama menghasilkan SATU profil (yang kalah menunggu lalu melihat profil yang sudah ada). Nama = snapshot saat dibuat.
 */
export async function profilCustomerKaryawan(tx, sellerId) {
  await lockRowForUpdate(tx, '"User"', sellerId, { cast: "text" });
  const ada = await tx.customer.findUnique({ where: { staffUserId: sellerId } });
  if (ada) return { customer: ada, baru: false };
  const u = await tx.user.findUnique({ where: { id: sellerId }, select: { id: true, name: true } });
  if (!u) throw gagal("Karyawan penjual tidak ditemukan", 404);
  const customer = await tx.customer.create({
    data: {
      staffUserId: u.id, name: u.name, tags: [TAG_PKR], leadSource: "OTHER", leadSourceDetail: "Profil internal karyawan (Penjualan Karyawan)", leadSourceConfirmed: true,
      pipelineStage: "TRANSACTION", assignedSalesId: null,
    },
  });
  return { customer, baru: true };
}

/**
 * Customer pemilik order: pembeli AKTUAL (dikenali lewat nomor) atau profil internal karyawan (jalur eksplisit "Pembeli adalah karyawan" / klien lama tanpa `pembeli`).
 * Dipanggil di dalam transaksi pemanggil (kunci PKR sudah dipegang).
 */
async function customerUntukPkr(tx, pkr, pembeli, { kota = null, userId = null } = {}) {
  if (pembeli.mode === "AKTUAL") {
    const r = await customerAktualUntukPkr(tx, { nama: pkr.buyerName, telepon: pembeli.telepon, kota, userId });
    return { customer: r.customer, mode: "AKTUAL", customerBaru: r.dibuat, namaBeda: r.namaBeda };
  }
  const { customer } = await profilCustomerKaryawan(tx, pkr.sellerId);
  return { customer, mode: pembeli.mode, customerBaru: false, namaBeda: null };
}

// Bagian pemenuhan yang dipetakan ke KOLOM order yang SAMA dengan order Sales (locationUrl, pickupEstimate, deliveryEstimate) + kolom penerima/catatan baru.
const bodyPemenuhan = (f) => ({
  ...(f.lokasiUrl && { locationUrl: f.lokasiUrl }), ...(f.waktuPickup && { pickupEstimate: f.waktuPickup }), ...(f.waktuKirim && { deliveryEstimate: f.waktuKirim }),
});
const dataPemenuhan = (f) => ({
  ...(f.penerima?.nama && { recipientName: f.penerima.nama }), ...(f.penerima?.telepon && { recipientPhone: f.penerima.telepon }),
  ...(f.patokan && { deliveryLandmark: f.patokan }), ...(f.catatanProduksi && { productionNote: f.catatanProduksi }), ...(f.catatanDelivery && { deliveryNote: f.catatanDelivery }),
});

async function muatPkr(tx, penjualanId) {
  await lockRowForUpdate(tx, '"fin_penjualan_karyawan"', penjualanId);
  const pkr = await tx.finPenjualanKaryawan.findUnique({
    where: { id: penjualanId },
    include: { seller: { select: { id: true, name: true } }, orderCrm: { select: { id: true, orderNumber: true } } },
  });
  if (!pkr) throw gagal("Penjualan karyawan tidak ditemukan", 404);
  return pkr;
}

// ── BUAT / TAUTKAN ───────────────────────────────────────────────────────────────────────────────────

/**
 * Buat SATU order CRM untuk PKR (atau tautkan order kosong yang sudah ada). Dipanggil di DALAM transaksi pemanggil. Idempoten: bila PKR sudah punya order, mengembalikannya (`dibuat:false`).
 * `orderId` (opsional) menautkan order yang SUDAH ada — hanya bila benar-benar kosong secara keuangan (tanpa nilai, item, pembayaran, invoice, atau tautan lain).
 */
export async function buatAtauTautkanOrder(tx, { penjualanId, userId = null, spesifikasi = {}, orderId = null, sumber = "dibuat", itemsSiap = null, nonProduksi = [], pembeli = null, pemenuhan = null }) {
  const pkr = await muatPkr(tx, penjualanId);
  const spek = normalisasiSpesifikasi(spesifikasi);
  // Validasi masukan pembeli/pemenuhan SEBELUM menulis apa pun (nomor, link Maps, penerima).
  const pmb = bacaPembeli(pembeli);
  const pem = bacaPemenuhan(pemenuhan ?? spesifikasi);
  const ekstra = { keluhan: pem.keluhan, catatanOrder: pem.catatanOrder, pembeliKaryawan: pmb.mode === "KARYAWAN" };
  // Jalur TERPADU: item operasional sudah disiapkan dari baris penjualan yang sama (penjualanKaryawanTerpadu.js) — tidak ada daftar item kedua.
  if (itemsSiap) spek.items = itemsSiap;
  if (pkr.orderCrm) {
    // Replay/klik ganda: kembalikan order yang ada. Daftar item yang dikirim ulang HARUS sama dengan yang tersimpan — isi berbeda = konflik, bukan order kedua yang diam-diam diabaikan.
    if (spek.items !== undefined) {
      const ada = (await tx.pkrOrderItem.findMany({ where: { orderId: pkr.orderCrm.id, ...ITEM_AKTIF }, orderBy: { seq: "asc" } })).map(itemDariRow);
      const baru = itemsSiap ?? await siapkanItems(tx, spek.items, { izinNonaktif: true, periksaRute: false });
      if (ada.length === 0 || kunciHimpunan(ada) !== kunciHimpunan(baru)) {
        throw gagal(`${pkr.nomor} sudah punya order CRM ${pkr.orderCrm.orderNumber} dengan isi item berbeda. Ubah spesifikasi lewat "Lengkapi spesifikasi"; tambah/hapus item atau ubah jumlah lewat "Koreksi item" (sebelum unit dijadwalkan).`, 409, "ORDER_SUDAH_ADA_BEDA");
      }
    }
    return { orderId: pkr.orderCrm.id, orderNumber: pkr.orderCrm.orderNumber, dibuat: false, nomor: pkr.nomor };
  }
  if (pkr.status !== "AKTIF") throw gagal(`${pkr.nomor} sudah dibatalkan — order CRM tidak dibuat`, 409);

  if (spek.items !== undefined) {
    if (orderId) throw gagal("Daftar item tidak bisa dipakai untuk menautkan order yang sudah ada — buat order baru atau tautkan tanpa daftar item", 400, "ITEM_TIDAK_UNTUK_TAUTAN");
    const items = itemsSiap ?? await siapkanItems(tx, spek.items);
    const { customer, mode, customerBaru, namaBeda } = await customerUntukPkr(tx, pkr, pmb, { kota: spek.kota, userId });
    const totalUnit = items.reduce((a, i) => a + i.jumlah, 0);
    const kategoriOrder = kategoriOrderDariItems(items);
    const order = await createOrderForCustomer(customer.id, {
      category: kategoriOrder, unitCount: 0, quantity: totalUnit, productLine: productLineDariItems(items),
      notes: susunNotesItems({ items, pkr, catatan: pkr.notes, nonProduksi, ekstra }),
      ...(spek.alamat && { deliveryAddress: spek.alamat }), ...(spek.kota && { deliveryCity: spek.kota }),
      ...(spek.tanggalKirim && { deliveryConfirmedDate: spek.tanggalKirim }), ...bodyPemenuhan(pem),
    }, userId, {
      tx, tanpaInvoice: true,
      dataTambahan: { salesOwnerId: null, penjualanKaryawanId: pkr.id, pkrPerluDikirim: perluDikirimDariItems(items), ...dataPemenuhan(pem) },
    });
    const lahir = await lahirkanItemDanUnit(tx, { pkrId: pkr.id, orderId: order.id, items, userId });
    const akhir = await tx.order.findUnique({ where: { id: order.id }, select: { notes: true, deliveryAddress: true, deliveryCity: true, pkrPerluDikirim: true } });
    await catatAudit(tx, {
      pkr, orderId: order.id, userId, aksi: sumber,
      metadata: {
        orderNumber: order.orderNumber, kategori: kategoriOrder, jumlahUnit: totalUnit, unit: lahir.flatMap((x) => x.unit),
        item: items.map((i) => ({ no: i.no, kategori: i.kategoriCode, produk: i.produkNama, jumlah: i.jumlah, kirim: i.perluDikirim, ...(i.bundleNo != null && { set: i.bundleNo }) })),
        spesifikasi: bacaSpesifikasiPkr(akhir).lengkap ? "lengkap" : "perlu dilengkapi",
        pembeli: { mode, customerId: customer.id, customerBaru, ...(namaBeda && { namaCustomerTersimpan: namaBeda }), penerimaBerbeda: Boolean(pem.penerima?.nama) },
      },
    });
    return { orderId: order.id, orderNumber: order.orderNumber, dibuat: true, nomor: pkr.nomor, customerId: customer.id, customerBaru, namaBeda, item: lahir };
  }

  if (orderId) {
    await tx.$queryRawUnsafe('SELECT id FROM "Order" WHERE id = $1 FOR UPDATE', orderId);
    const o = await tx.order.findUnique({
      where: { id: orderId },
      include: { _count: { select: { items: true, payments: true } }, invoice: { select: { id: true } } },
    });
    if (!o) throw gagal("Order yang akan ditautkan tidak ditemukan", 404);
    if (o.penjualanKaryawanId) throw gagal("Order itu sudah tertaut ke penjualan karyawan lain", 409);
    if (o.status === "CANCELLED") throw gagal("Order itu sudah dibatalkan", 409);
    if (o.value !== 0 || o._count.items > 0 || o._count.payments > 0 || o.invoice || o.salesOwnerId || o.staffSellerId || o.ongkir) {
      throw gagal("Order itu sudah punya nilai, item, pembayaran, invoice, atau Sales. Menautkannya akan menghitung uang dua kali — hanya order kosong yang boleh ditautkan.", 409, "ORDER_SUDAH_BERNILAI");
    }
    const diperbarui = await tx.order.update({ where: { id: o.id }, data: { penjualanKaryawanId: pkr.id, pkrPerluDikirim: spek.perluDikirim ?? null } });
    await catatAudit(tx, { pkr, orderId: diperbarui.id, userId, aksi: "ditautkan", metadata: { orderNumber: diperbarui.orderNumber } });
    return { orderId: diperbarui.id, orderNumber: diperbarui.orderNumber, dibuat: false, ditautkan: true, nomor: pkr.nomor };
  }

  const kategori = spek.kategori ?? "BARU";
  const jumlahUnit = spek.jumlahUnit ?? 1;
  // Pemilik order = profil Customer internal karyawan penjual (satu per karyawan, dipakai ulang). Tanpa nomor/IG, tanpa sales, ditandai tag. Tidak ada percakapan/pipeline sales.
  const { customer, mode, customerBaru, namaBeda } = await customerUntukPkr(tx, pkr, pmb, { kota: spek.kota, userId });
  const order = await createOrderForCustomer(customer.id, {
    category: kategori, unitCount: jumlahUnit, quantity: jumlahUnit,
    notes: susunNotes({ merk: spek.merk, ukuran: spek.ukuran, pkr, catatan: pkr.notes, ekstra }),
    ...(spek.alamat && { deliveryAddress: spek.alamat }), ...(spek.kota && { deliveryCity: spek.kota }),
    ...(spek.tanggalKirim && { deliveryConfirmedDate: spek.tanggalKirim }), ...bodyPemenuhan(pem),
  }, userId, {
    tx, tanpaInvoice: true,
    dataTambahan: { salesOwnerId: null, penjualanKaryawanId: pkr.id, pkrPerluDikirim: spek.perluDikirim ?? null, ...dataPemenuhan(pem) },
  });
  await catatAudit(tx, {
    pkr, orderId: order.id, userId, aksi: sumber,
    metadata: {
      orderNumber: order.orderNumber, kategori, jumlahUnit, unit: (order.units || []).map((u) => u.unitCode), spesifikasi: bacaSpesifikasiPkr(order).lengkap ? "lengkap" : "perlu dilengkapi",
      pembeli: { mode, customerId: customer.id, customerBaru, ...(namaBeda && { namaCustomerTersimpan: namaBeda }), penerimaBerbeda: Boolean(pem.penerima?.nama) },
    },
  });
  return { orderId: order.id, orderNumber: order.orderNumber, dibuat: true, nomor: pkr.nomor, customerId: customer.id, customerBaru, namaBeda };
}

async function catatAudit(tx, { pkr, orderId, userId, aksi, metadata = {} }) {
  const meta = { aksi, nomorPkr: pkr.nomor, penjualanId: pkr.id, orderId, ...metadata };
  await recordActivity(tx, { entityType: ENTITY_TYPES.FIN_PENJUALAN_KARYAWAN, entityId: pkr.id, eventType: EVENT_TYPES.PKR_ORDER_SINKRON, actorId: userId, metadata: meta });
  await recordActivity(tx, { entityType: ENTITY_TYPES.ORDER, entityId: orderId, eventType: EVENT_TYPES.PKR_ORDER_SINKRON, actorId: userId, metadata: meta });
}

// ── LENGKAPI SPESIFIKASI / ALAMAT / JADWAL ────────────────────────────────────────────────────────────

const alamatGabung = (o) => [o?.deliveryAddress, o?.deliveryCity].filter(Boolean).join(", ") || null;

/**
 * Lengkapi atau ubah spesifikasi + logistik order PKR. Merk/ukuran hanya boleh berubah selama belum ada unit yang mulai dikerjakan Produksi. Alamat disinkronkan ke job yang masih
 * bisa diubah (alamat job yang sama dengan alamat order lama atau kosong; ubahan manual dispatcher tidak ditimpa). Setiap perubahan diaudit (sebelum/sesudah).
 */
export async function lengkapiSpesifikasi(tx, { penjualanId, userId = null, masukan = {} }) {
  const pkr = await muatPkr(tx, penjualanId);
  if (!pkr.orderCrm) throw gagal(`${pkr.nomor} belum punya order CRM — buat dulu`, 409, "BELUM_ADA_ORDER");
  await tx.$queryRawUnsafe('SELECT id FROM "Order" WHERE id = $1 FOR UPDATE', pkr.orderCrm.id);
  const order = await tx.order.findUnique({ where: { id: pkr.orderCrm.id }, include: { units: { select: { id: true, status: true, currentStageId: true, unitCode: true } } } });
  if (order.status === "CANCELLED" || pkr.status !== "AKTIF") throw gagal("Order ini sudah dibatalkan — tidak bisa diubah", 409);
  const spek = normalisasiSpesifikasi(masukan);
  const modeItem = (await tx.pkrOrderItem.count({ where: { orderId: order.id } })) > 0; // termasuk item yang dihapus lunak (order tetap multi-item)
  if (modeItem && [spek.merk, spek.ukuran, spek.perluDikirim, spek.kategori, spek.jumlahUnit].some((v) => v !== undefined)) {
    throw gagal("Order ini memakai daftar item: ubah spesifikasi dan pilihan dikirim/diambil PER ITEM (bukan merk/ukuran di tingkat order)", 400, "SPEK_PER_ITEM");
  }
  if (!modeItem && spek.items !== undefined) throw gagal("Order ini order lama (tanpa daftar item). Ubah lewat isian merk/ukuran/dikirim biasa.", 409, "ORDER_TANPA_ITEM");
  const sebelumSpek = bacaSpesifikasiPkr(order);
  const unitMulai = order.units.filter((u) => u.currentStageId != null && u.status !== "CANCELLED");
  const data = {}; const perubahan = {};
  const catat = (k, dari, ke) => { perubahan[k] = { sebelum: dari ?? null, sesudah: ke ?? null }; };

  let notesBaru = order.notes;
  const info = bacaNotesOrder(order.notes);
  const info2 = { ...info };
  if (spek.merk !== undefined && spek.merk !== sebelumSpek.merk) {
    if (unitMulai.length) throw gagal("Merk tidak bisa diubah: Produksi sudah mulai mengerjakan unit", 409);
    if (spek.merk) info2.merkKasur = spek.merk; else delete info2.merkKasur;
    catat("merk", sebelumSpek.merk, spek.merk);
  }
  if (spek.ukuran !== undefined && spek.ukuran !== sebelumSpek.ukuran) {
    if (unitMulai.length) throw gagal("Ukuran tidak bisa diubah: Produksi sudah mulai mengerjakan unit", 409);
    if (spek.ukuran) info2.ukuranKasur = spek.ukuran; else delete info2.ukuranKasur;
    catat("ukuran", sebelumSpek.ukuran, spek.ukuran);
  }
  if (perubahan.merk || perubahan.ukuran) {
    notesBaru = siapkanNotesUkuran(JSON.stringify(info2), { wajib: Boolean(await ukuranCustomWajibSejak(tx)), notesLama: order.notes });
    data.notes = notesBaru;
  }

  let hasilItem = null;
  if (modeItem && spek.items !== undefined) {
    hasilItem = await ubahItemOrder(tx, { order, masukan: spek.items, userId });
    Object.assign(data, hasilItem.data);
    if (hasilItem.perubahan.length) perubahan.item = hasilItem.perubahan;
  }
  if (spek.perluDikirim !== undefined && spek.perluDikirim !== order.pkrPerluDikirim) {
    if (spek.perluDikirim === false) {
      const jobKirim = await tx.job.count({ where: { orderId: order.id, type: "DELIVERY" } });
      if (jobKirim > 0) throw gagal("Job pengiriman sudah ada. Batalkan atau ubah lewat Delivery dulu sebelum menandai order ini diambil sendiri.", 409);
    }
    data.pkrPerluDikirim = spek.perluDikirim;
    catat("perluDikirim", order.pkrPerluDikirim, spek.perluDikirim);
  }
  const alamatLama = alamatGabung(order);
  if (spek.alamat !== undefined && spek.alamat !== (order.deliveryAddress ?? null)) { data.deliveryAddress = spek.alamat; catat("alamat", order.deliveryAddress, spek.alamat); }
  if (spek.kota !== undefined && spek.kota !== (order.deliveryCity ?? null)) { data.deliveryCity = spek.kota; catat("kota", order.deliveryCity, spek.kota); }
  if (spek.tanggalKirim !== undefined) {
    const baru = spek.tanggalKirim ? new Date(`${spek.tanggalKirim}T00:00:00.000Z`) : null;
    const lama = order.deliveryConfirmedDate ? order.deliveryConfirmedDate.toISOString().slice(0, 10) : null;
    if ((spek.tanggalKirim ?? null) !== lama) { data.deliveryConfirmedDate = baru; catat("tanggalKirim", lama, spek.tanggalKirim); }
  }
  if (Object.keys(data).length === 0) throw gagal("Tidak ada perubahan yang dikirim", 400, "TANPA_PERUBAHAN");

  const diperbarui = await tx.order.update({ where: { id: order.id }, data });
  if (data.notes !== undefined && !modeItem) {
    await sinkronUkuranUnit(tx, order.id, order.notes, data.notes);
    if (perubahan.merk) await tx.unit.updateMany({ where: { orderId: order.id, status: { not: "CANCELLED" }, OR: [{ merk: null }, { merk: perubahan.merk.sebelum ?? "" }] }, data: { merk: perubahan.merk.sesudah } });
  }
  // Sinkron alamat ke job yang belum selesai: hanya yang alamatnya kosong atau masih sama dengan alamat order lama (ubahan manual dispatcher tidak ditimpa). Cache koordinat dikosongkan.
  let jobDisinkron = 0;
  if (perubahan.alamat || perubahan.kota) {
    const baruTeks = alamatGabung(diperbarui);
    const jobs = await tx.job.findMany({ where: { orderId: order.id, status: { in: ["UNSCHEDULED", "SCHEDULED", "ASSIGNED", "RESCHEDULED"] } }, select: { id: true, addressText: true } });
    for (const j of jobs) {
      if (!j.addressText || j.addressText === alamatLama) { await tx.job.update({ where: { id: j.id }, data: { addressText: baruTeks, lat: null, lng: null } }); jobDisinkron += 1; }
    }
  }
  // Order ditandai perlu dikirim padahal unit sudah siap kirim: buat kerangka job lewat jalur baku (idempoten).
  if (perubahan.perluDikirim?.sesudah === true || hasilItem?.perluKirimBaru) await ensureDeliveryJobForOrder(tx, diperbarui);
  await catatAudit(tx, { pkr, orderId: order.id, userId, aksi: "dilengkapi", metadata: { perubahan, jobDisinkron, lengkapSesudah: bacaSpesifikasiPkr(diperbarui).lengkap } });
  return { orderId: order.id, perubahan, jobDisinkron, spesifikasi: bacaSpesifikasiPkr(diperbarui) };
}

// ── PEMBATALAN ───────────────────────────────────────────────────────────────────────────────────────

/** Hambatan pembatalan: Produksi atau Delivery sudah berjalan. Daftar kosong = aman dibatalkan lewat jalur baku. */
export async function hambatanPembatalan(tx, orderId) {
  const [units, jobs, revisi, order] = await Promise.all([
    tx.unit.findMany({ where: { orderId, status: { not: "CANCELLED" } }, select: { unitCode: true, status: true, currentStageId: true } }),
    tx.job.findMany({ where: { orderId, status: { in: STATUS_JOB_BERJALAN } }, select: { type: true, status: true } }),
    tx.scopeRevision.count({ where: { orderId } }),
    tx.order.findUnique({ where: { id: orderId }, select: { status: true } }),
  ]);
  const h = [];
  const mulai = units.filter((u) => u.currentStageId != null || !STATUS_UNIT_AWAL.includes(u.status));
  if (mulai.length) h.push(`Produksi atau pengiriman sudah berjalan pada unit ${mulai.map((u) => u.unitCode).join(", ")}`);
  if (jobs.length) h.push(`${jobs.length} job Delivery sudah berjalan (${[...new Set(jobs.map((j) => j.status))].join(", ")})`);
  if (revisi > 0) h.push(`${revisi} revisi lingkup kerja`);
  if (order?.status === "DELIVERED") h.push("order sudah selesai");
  return h;
}

/**
 * Dipanggil dari pembatalan PKR (di dalam transaksi pemanggil, setelah PKR dikunci). Order yang belum diproses dibatalkan lewat jalur baku (unit CANCELLED, job dibatalkan dengan
 * tombstone, riwayat status); yang sudah berjalan MEMBLOKIR pembatalan PKR. Tidak ada yang dihapus.
 */
export async function batalkanOrderBersamaPkr(tx, { penjualanId, userId = null, alasan }) {
  const order = await tx.order.findUnique({ where: { penjualanKaryawanId: penjualanId } });
  if (!order || order.status === "CANCELLED") return { dibatalkan: false };
  await tx.$queryRawUnsafe('SELECT id FROM "Order" WHERE id = $1 FOR UPDATE', order.id);
  const hambatan = await hambatanPembatalan(tx, order.id);
  if (hambatan.length) {
    throw gagal(`Penjualan karyawan tidak bisa dibatalkan: ${hambatan.join("; ")}. Gunakan alur pembatalan resmi order (Kendali/Admin) — order, unit, job, dan jurnal tidak dihapus.`, 409, "PRODUKSI_DELIVERY_BERJALAN", { hambatan });
  }
  await kunciKanonis(tx, { orderIds: [order.id] });
  await assertOrderUnitsNotV2Owned(tx, order.id, "Membatalkan penjualan karyawan");
  await tx.unit.updateMany({ where: { orderId: order.id, status: { not: "CANCELLED" } }, data: { status: "CANCELLED" } });
  await cancelOrderDeliveryJobs(tx, { orderId: order.id, actorId: userId, reason: `Penjualan karyawan dibatalkan — ${alasan}` });
  const hasil = await tx.order.update({
    where: { id: order.id },
    data: { status: "CANCELLED", statusLocked: true, statusOverrideById: userId, statusOverrideAt: new Date(), statusOverrideNote: `Penjualan karyawan dibatalkan — ${alasan}` },
  });
  await tx.orderStatusTransition.create({ data: { orderId: order.id, fromStatus: order.status, toStatus: "CANCELLED", changedById: userId } });
  const pkr = await tx.finPenjualanKaryawan.findUnique({ where: { id: penjualanId }, select: { id: true, nomor: true } });
  await catatAudit(tx, { pkr, orderId: order.id, userId, aksi: "dibatalkan", metadata: { alasan, orderNumber: order.orderNumber } });
  return { dibatalkan: true, orderId: hasil.id, customerId: hasil.customerId };
}

/** Setelah transaksi pembatalan commit: rapikan agregat customer (di luar transaksi, sama dengan pembatalan order baku). */
export async function rapikanAgregatCustomer(customerId) { if (customerId) await syncCustomerOrderAggregate(customerId); }

// ── BACA ─────────────────────────────────────────────────────────────────────────────────────────────

const LABEL_ORDER = { PENDING: "Menunggu", PICKUP: "Pengambilan", PROCESSING: "Diproses", READY: "Siap kirim", DELIVERED: "Selesai", CANCELLED: "Dibatalkan" };
const LABEL_PEMBAYARAN = { DIBATALKAN: "Dibatalkan", LUNAS: "Lunas", SEBAGIAN: "Dibayar sebagian", BELUM_BAYAR: "Belum dibayar" };

function statusProduksi(order, units, spek) {
  const aktif = units.filter((u) => u.status !== "CANCELLED");
  if (order.status === "CANCELLED" || (units.length > 0 && aktif.length === 0)) return { kode: "DIBATALKAN", label: "Dibatalkan" };
  if (!spek.lengkap && aktif.every((u) => u.currentStageId == null)) return { kode: "PERLU_DILENGKAPI", label: "Perlu dilengkapi" };
  if (aktif.length === 0) return { kode: "BELUM_ADA_UNIT", label: "Belum ada unit" };
  if (aktif.every((u) => ["READY_FOR_DELIVERY", "READY_ON_CUSTOMER_HOLD", "IN_TRANSIT_OUT", "DELIVERED"].includes(u.status))) return { kode: "SELESAI", label: "Produksi selesai" };
  if (aktif.some((u) => u.currentStageId != null || u.status === "IN_PRODUCTION")) return { kode: "BERJALAN", label: "Sedang diproduksi" };
  return { kode: "MENUNGGU", label: "Menunggu produksi" };
}
function statusDelivery(order, jobs, units) {
  if (order.status === "CANCELLED") return { kode: "DIBATALKAN", label: "Dibatalkan" };
  if (order.pkrPerluDikirim === false) return { kode: "AMBIL_SENDIRI", label: "Diambil sendiri (tanpa pengiriman)" };
  if (order.pkrPerluDikirim == null) return { kode: "BELUM_DITENTUKAN", label: "Belum ditentukan (dikirim atau diambil sendiri)" };
  const kirim = jobs.filter((j) => j.type === "DELIVERY");
  if (kirim.length === 0) return { kode: "BELUM_ADA_JOB", label: units.some((u) => u.status === "READY_FOR_DELIVERY") ? "Siap kirim — job belum terbentuk" : "Menunggu produksi selesai" };
  const j = kirim[kirim.length - 1];
  return { kode: j.status, label: LABEL_JOB[j.status] || j.status, jobId: j.id };
}

/**
 * Ringkasan sinkronisasi per PKR untuk layar Finance/CRM: order, spesifikasi, unit, produksi, delivery, dan status pembayaran DARI LEDGER PKR (bukan dari Order).
 * `izinNominal=false` membuang total/terbayar/sisa (tampilan Sales/Produksi/Delivery).
 */
export async function ringkasOrderPkr(db, penjualanIds, { izinNominal = true, izinPembayaran = izinNominal } = {}) {
  if (!penjualanIds.length) return new Map();
  const pkrs = await db.finPenjualanKaryawan.findMany({
    where: { id: { in: penjualanIds } },
    include: {
      seller: { select: { id: true, name: true } },
      payments: { where: { cancelledAt: null }, select: { amount: true } },
      orderCrm: { include: { customer: { select: { id: true, name: true, phone: true, staffUserId: true, leadSource: true } }, pkrItems: { where: ITEM_AKTIF, orderBy: { seq: "asc" }, include: { units: { select: { unit: { select: { unitCode: true, status: true } } } } } }, units: { orderBy: { seq: "asc" }, select: { id: true, unitCode: true, seq: true, status: true, currentStageId: true, merk: true, ukuran: true, productionDueAt: true, currentStage: { select: { labelId: true } },
          // Rencana produksi V2 terbaru + job pengiriman yang menaungi unit (representasi multi-unit Order CRM).
          productionRunsV2: { where: { status: { not: "CANCELLED" } }, orderBy: { createdAt: "desc" }, take: 1, select: { status: true, plan: { select: { status: true, productionDate: true, targetDate: true, stationCode: true, operator: { select: { user: { select: { name: true } } } }, cornerOperator: { select: { user: { select: { name: true } } } } } } } },
          jobUnits: { select: { job: { select: { id: true, type: true, status: true, scheduledDate: true, createdAt: true } } } } } },
      jobs: { orderBy: { createdAt: "asc" }, select: { id: true, type: true, status: true, scheduledDate: true, createdAt: true, units: { select: { unitId: true } } } } } },
    },
  });
  const hasil = new Map();
  for (const p of pkrs) {
    const total = toMoney(p.total);
    const terbayar = p.payments.length ? sumMoney(p.payments.map((x) => x.amount)) : ZERO;
    const batal = p.status === "DIBATALKAN";
    const sisa = batal ? ZERO : total.minus(terbayar);
    const statusBayar = batal ? "DIBATALKAN" : sisa.lessThanOrEqualTo(0) ? "LUNAS" : terbayar.greaterThan(0) ? "SEBAGIAN" : "BELUM_BAYAR";
    // Status pembayaran PKR hanya untuk yang berizin harga (Finance/Sales/Admin). Produksi/Gudang/Driver TIDAK menerimanya sama sekali (null).
    const pembayaran = !izinPembayaran ? null : { status: statusBayar, label: LABEL_PEMBAYARAN[statusBayar], sumber: "Penjualan Karyawan (Finance)", ...(izinNominal && { total: moneyToNumber(total), terbayar: moneyToNumber(batal ? ZERO : terbayar), sisa: moneyToNumber(sisa) }) };
    const o = p.orderCrm;
    if (!o) { hasil.set(p.id, { penjualanId: p.id, nomor: p.nomor, statusPkr: p.status, penjual: p.seller, pembeli: p.buyerName, pembayaran, order: null }); continue; }
    const spek = bacaSpesifikasiPkr(o);
    const modeItem = o.pkrItems.length > 0;
    const unitPerItem = (r) => r.units.map((x) => ({ kode: x.unit.unitCode, status: x.unit.status, label: LABEL_UNIT[x.unit.status] || x.unit.status }));
    const revisi = modeItem ? await revisiTerakhir(db, o.id) : 0;
    const bentukItem = (i, extra = {}) => ({
      no: i.no, kategori: i.kategoriCode, kategoriNama: i.kategoriNama, bentuk: i.bentuk, jenisKerja: i.jenisKerja, produkId: i.produkId ?? null, produk: i.produkNama ?? null, jumlah: i.jumlah, ukuran: i.ukuranLabel || null,
      panjang: i.panjang ?? null, lebar: i.lebar ?? null, tebal: i.tebal ?? null, tinggi: i.tinggi ?? null, spesifikasi: i.spesifikasi ?? null,
      perluDikirim: i.perluDikirim ?? null, kirimLabel: i.perluDikirim === true ? "Dikirim" : i.perluDikirim === false ? "Diambil sendiri" : "Belum ditentukan", kurang: i.kurang ?? [],
      bundel: i.bundleNo != null ? { no: i.bundleNo, nama: i.bundleName ?? null } : null, ...extra,
    });
    const items = modeItem
      ? o.pkrItems.map((r) => bentukItem({ ...itemDariRow(r), kurang: (spek.items?.find((x) => x.no === r.seq)?.kurang) ?? [] }, { unit: unitPerItem(r), virtual: false, saleItemId: r.saleItemId ?? null, komponenSeq: r.componentSeq ?? null, pemenuhan: r.fulfillment ?? null }))
      : itemVirtualLama({ kategori: o.category, merk: spek.merk, ukuran: spek.ukuran, jumlahUnit: o.units.filter((u) => u.status !== "CANCELLED").length, perluDikirim: o.pkrPerluDikirim })
        .map((i) => bentukItem({ ...i, kurang: spek.kurang }, { unit: o.units.map((u) => ({ kode: u.unitCode, status: u.status, label: LABEL_UNIT[u.status] || u.status })), virtual: true }));
    const unitBaris = susunBarisUnitPkr({ order: { status: o.status, pkrPerluDikirim: o.pkrPerluDikirim }, units: o.units, items, jobsOrder: o.jobs.map((j) => ({ ...j, unitIds: j.units.map((x) => x.unitId) })) });
    hasil.set(p.id, {
      penjualanId: p.id, nomor: p.nomor, statusPkr: p.status, penjual: p.seller, pembeli: p.buyerName, pembayaran,
      identitas: identitasPkr({ ...o, penjualanKaryawan: { nomor: p.nomor, buyerName: p.buyerName, seller: p.seller } }),
      order: { id: o.id, nomor: o.orderNumber, status: o.status, statusLabel: LABEL_ORDER[o.status] || o.status, kategori: o.category, spesifikasi: spek, modeItem, revisi, nonProduksi: bacaNotesOrder(o.notes).pkrNonProduksi ?? [] },
      items,
      units: o.units.map((u) => ({ id: u.id, kode: u.unitCode, status: u.status, label: LABEL_UNIT[u.status] || u.status, merk: u.merk, ukuran: u.ukuran })),
      unitBaris: unitBaris.baris, ringkasUnit: unitBaris.ringkas,
      produksi: statusProduksi(o, o.units, spek),
      delivery: statusDelivery(o, o.jobs, o.units),
      jobs: o.jobs.map((j) => ({ id: j.id, tipe: j.type, status: j.status, label: LABEL_JOB[j.status] || j.status })),
    });
  }
  return hasil;
}

/** Dry-run PKR lama: dokumen AKTIF yang belum punya order CRM (tidak menulis apa pun). */
export async function dryRunPkrTanpaOrder(db, { batas = 200 } = {}) {
  const rows = await db.finPenjualanKaryawan.findMany({
    where: { status: "AKTIF", orderCrm: null }, orderBy: [{ date: "asc" }, { createdAt: "asc" }], take: batas,
    select: { id: true, nomor: true, date: true, buyerName: true, total: true, seller: { select: { id: true, name: true } } },
  });
  return rows.map((r) => ({ penjualanId: r.id, nomor: r.nomor, tanggal: r.date.toISOString().slice(0, 10), pembeli: r.buyerName, penjual: r.seller, total: moneyToNumber(toMoney(r.total)), aksi: "BUAT_ORDER_CRM" }));
}

/** Rujukan PKR ringan untuk model baca Produksi/Delivery/CRM: { nomor, penjualanId } per orderId (hanya order PKR). */
export async function rujukanPkrPerOrder(db, orderIds) {
  const ids = [...new Set((orderIds || []).filter(Boolean))];
  if (!ids.length) return new Map();
  const rows = await db.order.findMany({ where: { id: { in: ids }, penjualanKaryawanId: { not: null } }, select: { ...PKR_IDENTITAS_SELECT, id: true, pkrPerluDikirim: true } });
  // Proyeksi DELIVERY: nama/telepon penerima, alamat, Maps, patokan, catatan Delivery — tanpa nominal, tanpa keluhan/catatan Produksi.
  return new Map(rows.map((r) => {
    const id = identitasPkr(r);
    return [r.id, {
      penjualanId: r.penjualanKaryawanId, nomor: r.penjualanKaryawan.nomor, penjual: r.penjualanKaryawan.seller.name, perluDikirim: r.pkrPerluDikirim,
      pembeli: id.customer.nama, identitas: proyeksiIdentitas(id, "DELIVERY"),
    }];
  }));
}
