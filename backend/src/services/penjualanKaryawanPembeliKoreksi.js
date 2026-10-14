// KOREKSI PEMBELI / KONTAK / ALAMAT / CATATAN ORDER PKR + LENGKAPI/TAUTKAN CUSTOMER (order legacy) — satu pintu, dua tahap, fungsi hitung SAMA.
//
// Aturan (keputusan Owner, Okt 2026):
//   • Alasan WAJIB (≥5 karakter), pratinjau dampak (hitungKoreksi, tanpa menulis), audit sebelum/sesudah di buku revisi + log aktivitas, revisi optimistis (expectedRevision),
//     Idempotency-Key WAJIB, satu transaksi atomik.
//   • TIDAK membuat Order, Unit, Job, Payment, invoice, pendapatan, atau jurnal. Nominal tetap di PKR. Hanya kolom identitas/alamat/catatan Order dan relasi Order.customerId.
//   • Ganti customer = memindahkan relasi Order.customerId ke Customer lain (dikenali lewat nomor); riwayat PKR/Unit/Job/Payment/jurnal TIDAK disentuh.
//   • Data Customer yang sudah ada TIDAK ditimpa diam-diam. Nama customer hanya boleh dikoreksi bila customer itu tidak dipakai order lain dan tidak punya percakapan.
//   • Perubahan alamat/Maps saat ada job Delivery AKTIF: diperingatkan di pratinjau, job yang belum berjalan disinkronkan lewat aturan resmi (ubahan manual dispatcher tidak
//     ditimpa); job yang sedang di jalan (EN_ROUTE/ARRIVED) MEMBLOKIR perubahan alamat.
import { createHash } from "node:crypto";
import { PkrOrderError } from "./pkrGuard.js";
import { lockRowForUpdate } from "./inventoryLedger.js";
import { revisiTerakhir, snapshotItems, tulisRevisi } from "./pkrItemRevisi.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../lib/activityLog.js";
import { bacaNotesOrder } from "../lib/domain/pkrSpesifikasi.js";
import { bacaPemenuhan, normalisasiNomorTelepon, PembeliPkrError } from "../lib/domain/pkrPembeli.js";
import { identitasPkr, PKR_IDENTITAS_SELECT } from "../lib/domain/pkrIdentitas.js";
import { alasanCustomerTidakBisa } from "./penjualanKaryawanPembeli.js";
import { customerAktualUntukPkr } from "./penjualanKaryawanPembeli.js";
import { profilCustomerKaryawan } from "./penjualanKaryawanOrder.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POLA_KUNCI = /^[A-Za-z0-9_\-:.]{8,128}$/;
const gagal = (m, s = 400, c = null, e = null) => new PkrOrderError(m, s, c, e);
const JOB_BERJALAN = ["EN_ROUTE", "ARRIVED"];
const JOB_BISA_DISINKRON = ["UNSCHEDULED", "SCHEDULED", "ASSIGNED", "RESCHEDULED"];
// Kolom per JALUR IZIN: Finance/Admin = semua; Produksi = hanya catatan Produksi; Delivery = data penerima/pengiriman. Kolom di luar izin → 403.
export const KOLOM_ALAMAT_PENERIMA = Object.freeze(["alamat", "kota", "lokasiUrl", "patokan", "penerimaNama", "penerimaTelepon"]);
export const KOLOM_IZIN = Object.freeze({
  PENUH: null,
  PRODUKSI: Object.freeze(["catatanProduksi"]),
  DELIVERY: Object.freeze(["penerimaNama", "penerimaTelepon", "alamat", "kota", "lokasiUrl", "patokan", "waktuKirim", "waktuPickup", "catatanDelivery"]),
});
const TIDAK_DIBUAT = Object.freeze(["Order baru", "Unit baru", "Job baru", "Pembayaran (Payment)", "Invoice", "Pendapatan / jurnal"]);

const hash = (v) => createHash("sha256").update(JSON.stringify(v ?? null)).digest("hex");
const alamatGabung = (o) => [o?.deliveryAddress, o?.deliveryCity].filter(Boolean).join(", ") || null;
const teksOpsional = (v, maks, nama) => {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const t = String(v).replace(/\s+/g, " ").trim();
  if (t.length > maks) throw gagal(`${nama} maksimal ${maks} karakter`, 400, "TEKS_TERLALU_PANJANG");
  return t === "" ? null : t;
};

async function muatKeadaan(db, penjualanId, { kunci }) {
  if (!UUID.test(String(penjualanId))) throw gagal("Penjualan karyawan tidak ditemukan", 404);
  if (kunci) await lockRowForUpdate(db, '"fin_penjualan_karyawan"', penjualanId);
  const pkr = await db.finPenjualanKaryawan.findUnique({
    where: { id: penjualanId },
    select: { id: true, nomor: true, status: true, buyerName: true, sellerId: true, seller: { select: { id: true, name: true } }, orderCrm: { select: { id: true } } },
  });
  if (!pkr) throw gagal("Penjualan karyawan tidak ditemukan", 404);
  if (!pkr.orderCrm) throw gagal(`${pkr.nomor} belum punya order CRM — buat dulu`, 409, "BELUM_ADA_ORDER");
  if (pkr.status !== "AKTIF") throw gagal(`${pkr.nomor} sudah dibatalkan — tidak bisa dikoreksi`, 409, "PKR_DIBATALKAN");
  if (kunci) await db.$queryRawUnsafe('SELECT id FROM "Order" WHERE id = $1 FOR UPDATE', pkr.orderCrm.id);
  const order = await db.order.findUnique({
    where: { id: pkr.orderCrm.id },
    select: {
      ...PKR_IDENTITAS_SELECT, id: true, orderNumber: true, status: true, customerId: true, pickupEstimate: true, deliveryEstimate: true, productionNote: true, deliveryNote: true,
      jobs: { where: { status: { not: "FAILED" } }, select: { id: true, type: true, status: true, scheduledDate: true, addressText: true } },
    },
  });
  if (!order || order.status === "CANCELLED") throw gagal("Order CRM sudah dibatalkan — tidak bisa dikoreksi", 409, "ORDER_DIBATALKAN");
  return { pkr, order };
}

/** Bacaan masukan koreksi (tanpa DB). Tidak ada perubahan = galat. */
export function bacaMasukanKoreksi(masukan) {
  const m = masukan && typeof masukan === "object" && !Array.isArray(masukan) ? masukan : {};
  const pembeli = m.pembeli && typeof m.pembeli === "object" && !Array.isArray(m.pembeli) ? m.pembeli : null;
  const pem = bacaPemenuhan(m.pemenuhan ?? {});
  const alamat = teksOpsional(m.pemenuhan?.alamat, 500, "Alamat");
  const kota = teksOpsional(m.pemenuhan?.kota, 100, "Kota");
  const hasil = {
    pembeli: pembeli && {
      telepon: pembeli.telepon !== undefined && String(pembeli.telepon ?? "").trim() !== "" ? normalisasiNomorTelepon(pembeli.telepon) : null,
      adalahKaryawan: pembeli.adalahKaryawan === true,
      nama: teksOpsional(pembeli.nama, 200, "Nama pembeli"),
    },
    pemenuhan: { ...pem, alamat, kota },
  };
  const adaPemenuhan = Object.entries(hasil.pemenuhan).some(([k, v]) => v !== undefined && !(k === "penerima" && v === undefined));
  const adaPembeli = Boolean(hasil.pembeli && (hasil.pembeli.telepon || hasil.pembeli.adalahKaryawan || hasil.pembeli.nama));
  if (!adaPembeli && !adaPemenuhan) throw gagal("Tidak ada perubahan yang dikirim", 400, "TANPA_PERUBAHAN");
  return hasil;
}

/**
 * Hitung rencana koreksi terhadap keadaan TERKINI (tanpa menulis kecuali pembuatan customer saat `terapkan`).
 * @returns {{ pkr, order, perubahan: object[], orderData: object, notesBaru: string|null, target: object|null, dampak: object, peringatan: string[], jobDisinkron: string[], customerIds: string[] }}
 */
async function hitungKoreksi(tx, { penjualanId, masukan, kunci, terapkan, userId, kolomIzin = null }) {
  const { pkr, order } = await muatKeadaan(tx, penjualanId, { kunci });
  const m = bacaMasukanKoreksi(masukan);
  const idLama = identitasPkr(order);
  const perubahan = []; const peringatan = []; const orderData = {};
  const catat = (kolom, label, sebelum, sesudah) => perubahan.push({ kolom, label, sebelum: sebelum ?? null, sesudah: sesudah ?? null });
  const dampak = { customerBaru: false, customerDipakaiUlang: false, customerDiganti: false, jobAktif: 0, jobDisinkron: 0, jobDilewati: 0, jurnal: 0, orderBaru: 0, unitBaru: 0, jobBaru: 0, payment: 0 };

  // ── 1. Customer pemilik order ──────────────────────────────────────────────────────────────────────────────
  let target = null;           // { customer, mode }
  let namaCustomerBaru = null; // koreksi nama pada customer yang dipakai (hanya bila eksklusif)
  const customerIds = [];
  if (m.pembeli?.adalahKaryawan) {
    const profil = await profilCustomerKaryawan(tx, pkr.sellerId);
    if (order.customerId !== profil.customer.id) {
      target = { customer: profil.customer, mode: "KARYAWAN", baru: false };
    } else if (idLama?.legacy) {
      target = { customer: profil.customer, mode: "KARYAWAN", baru: false, hanyaTandai: true }; // tandai sah: pembeli = karyawan itu sendiri
    }
  } else if (m.pembeli?.telepon) {
    const nomor = m.pembeli.telepon;
    const ada = await tx.customer.findUnique({ where: { phone: nomor } });
    if (ada) {
      const tidak = alasanCustomerTidakBisa(ada);
      if (tidak) throw new PembeliPkrError(tidak.pesan, tidak.kode, 409);
      if (ada.id !== order.customerId) target = { customer: ada, mode: "AKTUAL", baru: false };
    } else {
      const nama = m.pembeli.nama ?? pkr.buyerName;
      if (String(nama ?? "").trim().length < 2) throw gagal("Nama pembeli wajib diisi untuk customer baru", 400, "NAMA_WAJIB");
      if (terapkan) {
        const r = await customerAktualUntukPkr(tx, { nama, telepon: nomor, kota: m.pemenuhan.kota ?? order.deliveryCity ?? null, userId });
        target = { customer: r.customer, mode: "AKTUAL", baru: r.dibuat };
      } else {
        target = { customer: { id: null, name: nama, phone: nomor }, mode: "AKTUAL", baru: true };
      }
    }
  } else if (m.pembeli?.nama && !idLama?.legacy) {
    namaCustomerBaru = m.pembeli.nama;
  }

  if (target) {
    const sebelum = idLama?.customer ?? {};
    dampak.customerDiganti = target.customer.id !== order.customerId;
    dampak.customerBaru = Boolean(target.baru);
    dampak.customerDipakaiUlang = !target.baru && dampak.customerDiganti;
    catat("customer", "Customer/pembeli", { nama: sebelum.nama ?? null, telepon: sebelum.telepon ?? null, legacy: Boolean(idLama?.legacy) },
      { nama: target.customer.name ?? null, telepon: target.customer.phone ?? null, mode: target.mode });
    if (target.customer.id && target.customer.id !== order.customerId) { orderData.customerId = target.customer.id; customerIds.push(order.customerId, target.customer.id); }
  }
  if (namaCustomerBaru && !target) {
    const c = await tx.customer.findUnique({ where: { id: order.customerId }, select: { id: true, name: true, staffUserId: true, isInternalStaff: true } });
    if (c.staffUserId || c.isInternalStaff) throw gagal("Nama profil internal karyawan tidak diubah dari sini. Lengkapi dengan nomor pembeli yang sebenarnya.", 409, "PROFIL_INTERNAL");
    const orderLain = await tx.order.count({ where: { customerId: c.id, id: { not: order.id }, status: { not: "CANCELLED" } } });
    const percakapan = await tx.conversation.count({ where: { customerId: c.id } });
    if (orderLain > 0 || percakapan > 0) {
      throw gagal(`Customer ini dipakai ${orderLain} order lain${percakapan ? ` dan punya ${percakapan} percakapan` : ""} — namanya tidak diubah dari order ini. Ubah lewat profil pelanggan, atau pindahkan order ke customer lain dengan nomor yang benar.`, 409, "CUSTOMER_DIPAKAI_ORDER_LAIN", { orderLain, percakapan });
    }
    if ((c.name ?? "") !== namaCustomerBaru) catat("namaCustomer", "Nama customer", c.name, namaCustomerBaru);
  }

  // ── 2. Alamat, Maps, penerima, catatan ─────────────────────────────────────────────────────────────────────
  const p = m.pemenuhan;
  const set = (kolom, label, nilaiBaru, nilaiLama, orderKey) => {
    if (nilaiBaru === undefined) return;
    if ((nilaiBaru ?? null) === (nilaiLama ?? null)) return;
    orderData[orderKey] = nilaiBaru; catat(kolom, label, nilaiLama, nilaiBaru);
  };
  const alamatLama = alamatGabung(order);
  set("alamat", "Alamat", p.alamat, order.deliveryAddress, "deliveryAddress");
  set("kota", "Kota", p.kota, order.deliveryCity, "deliveryCity");
  set("lokasiUrl", "Link Google Maps", p.lokasiUrl, order.locationUrl, "locationUrl");
  set("patokan", "Patokan lokasi", p.patokan, order.deliveryLandmark, "deliveryLandmark");
  set("waktuPickup", "Waktu pickup disarankan", p.waktuPickup, order.pickupEstimate, "pickupEstimate");
  set("waktuKirim", "Waktu pengiriman disarankan", p.waktuKirim, order.deliveryEstimate, "deliveryEstimate");
  set("catatanProduksi", "Catatan Produksi", p.catatanProduksi, order.productionNote, "productionNote");
  set("catatanDelivery", "Catatan Delivery", p.catatanDelivery, order.deliveryNote, "deliveryNote");
  if (p.penerima !== undefined) {
    set("penerimaNama", "Nama penerima", p.penerima.nama, order.recipientName, "recipientName");
    set("penerimaTelepon", "Telepon penerima", p.penerima.telepon, order.recipientPhone, "recipientPhone");
  }
  // Notes JSON: keluhan + catatan order + penanda pembeli karyawan (kunci lain, termasuk cerminan item, dipertahankan apa adanya).
  const notesObj = { ...bacaNotesOrder(order.notes) };
  let notesBerubah = false;
  const setNote = (kolom, label, kunciNote, nilaiBaru) => {
    if (nilaiBaru === undefined) return;
    const lama = notesObj[kunciNote] ?? null;
    if ((nilaiBaru ?? null) === lama) return;
    if (nilaiBaru === null) delete notesObj[kunciNote]; else notesObj[kunciNote] = nilaiBaru;
    notesBerubah = true; catat(kolom, label, lama, nilaiBaru);
  };
  setNote("keluhan", "Keluhan customer", "keluhanCustomer", p.keluhan);
  setNote("catatanOrder", "Catatan order", "catatanOrder", p.catatanOrder);
  if (target?.mode === "KARYAWAN" && notesObj.pembeliKaryawan !== true) { notesObj.pembeliKaryawan = true; notesBerubah = true; }
  if (target?.mode === "AKTUAL" && notesObj.pembeliKaryawan) { delete notesObj.pembeliKaryawan; notesBerubah = true; }
  if (target && target.mode === "AKTUAL" && idLama?.legacy === false && idLama?.pembeliAdalahKaryawan === false) { /* sudah aktual — tidak ada perubahan notes tambahan */ }
  const notesBaru = notesBerubah ? JSON.stringify(notesObj) : null;

  if (perubahan.length === 0 && !target?.hanyaTandai) throw gagal("Tidak ada perubahan dibanding data saat ini", 400, "TANPA_PERUBAHAN");
  // Izin kolom per jalur (Produksi/Delivery hanya kolom kerjanya sendiri).
  if (kolomIzin) {
    const luar = perubahan.filter((x) => !kolomIzin.includes(x.kolom)).map((x) => x.label);
    if (luar.length || target) throw gagal(`Peran Anda tidak boleh mengubah: ${[...luar, ...(target ? ["customer/pembeli"] : [])].join(", ")}. Hubungi Finance/Admin.`, 403, "KOLOM_TIDAK_DIIZINKAN");
  }
  // Delivery SELESAI: data historis penerima/alamat tidak ditimpa — hanya catatan/revisi baru.
  if (order.jobs.some((j) => j.type === "DELIVERY" && j.status === "COMPLETED") && perubahan.some((x) => KOLOM_ALAMAT_PENERIMA.includes(x.kolom))) {
    throw gagal("Delivery sudah selesai — data penerima/alamat historis tidak ditimpa. Tambahkan catatan Delivery, atau ajukan revisi/pengiriman baru lewat Delivery.", 409, "DELIVERY_SELESAI");
  }

  // ── 3. Dampak ke job Delivery/Pickup yang aktif (hanya bila alamat/Maps berubah) ─────────────────────────────
  const alamatBerubah = ["alamat", "kota", "lokasiUrl"].some((k) => perubahan.some((x) => x.kolom === k));
  const jobDisinkron = [];
  const jobAktif = order.jobs.filter((j) => j.status !== "COMPLETED");
  dampak.jobAktif = jobAktif.length;
  if (alamatBerubah && jobAktif.length) {
    const jalan = jobAktif.filter((j) => JOB_BERJALAN.includes(j.status));
    if (jalan.length) {
      throw gagal(`Alamat tidak bisa diubah: ${jalan.length} job sedang berjalan (${[...new Set(jalan.map((j) => j.status))].join(", ")}). Hubungi Delivery agar menyelesaikan/menjadwalkan ulang dulu.`, 409, "JOB_SEDANG_BERJALAN", { jobIds: jalan.map((j) => j.id) });
    }
    const baruTeks = alamatGabung({ deliveryAddress: orderData.deliveryAddress !== undefined ? orderData.deliveryAddress : order.deliveryAddress, deliveryCity: orderData.deliveryCity !== undefined ? orderData.deliveryCity : order.deliveryCity });
    for (const j of jobAktif.filter((x) => JOB_BISA_DISINKRON.includes(x.status))) {
      if (!j.addressText || j.addressText === alamatLama) jobDisinkron.push({ id: j.id, baruTeks });
    }
    dampak.jobDisinkron = jobDisinkron.length;
    dampak.jobDilewati = jobAktif.filter((x) => JOB_BISA_DISINKRON.includes(x.status)).length - jobDisinkron.length;
    peringatan.push(`Ada ${jobAktif.length} job Delivery/Pickup aktif untuk order ini. Alamat ${jobDisinkron.length} job diperbarui otomatis (sinkronisasi resmi; titik peta dikosongkan agar dicari ulang dari link).`);
    if (dampak.jobDilewati > 0) peringatan.push(`${dampak.jobDilewati} job punya alamat yang sudah diubah manual oleh dispatcher — TIDAK ditimpa. Periksa di Delivery.`);
    if (jobAktif.some((j) => j.status === "ASSIGNED" || j.status === "SCHEDULED")) peringatan.push("Job sudah terjadwal — beri tahu driver/dispatcher tentang perubahan alamat.");
  }
  if (dampak.customerDiganti) peringatan.push("Order akan berpindah ke customer lain. PKR, unit, job, pembayaran, dan jurnal TIDAK berubah; kolom Pelanggan di Produksi/Delivery ikut berubah.");

  return { pkr, order, perubahan, orderData, notesBaru, target, dampak, peringatan, jobDisinkron, customerIds: [...new Set(customerIds.filter(Boolean))], idLama };
}

/** Pratinjau dampak — TIDAK menulis apa pun. */
export async function pratinjauKoreksiPembeli(db, { penjualanId, masukan, kolomIzin = null }) {
  const h = await hitungKoreksi(db, { penjualanId, masukan, kunci: false, terapkan: false, userId: null, kolomIzin });
  return {
    nomor: h.pkr.nomor, orderId: h.order.id, orderNumber: h.order.orderNumber, revisi: await revisiTerakhir(db, h.order.id),
    identitasSaatIni: h.idLama, perubahan: h.perubahan, dampak: h.dampak, peringatan: h.peringatan, tidakDibuat: TIDAK_DIBUAT,
  };
}

/** Terapkan koreksi. Dipanggil di dalam transaksi. Pemanggil merapikan agregat customer untuk `customerIds` setelah commit. */
export async function terapkanKoreksiPembeli(tx, { penjualanId, masukan, expectedRevision, alasan, idempotencyKey, userId = null, kolomIzin = null }) {
  if (!idempotencyKey || !POLA_KUNCI.test(String(idempotencyKey))) throw gagal("Header Idempotency-Key wajib (8–128 karakter) untuk koreksi pembeli", 428, "IDEMPOTENCY_KEY_REQUIRED");
  const teksAlasan = String(alasan ?? "").trim().replace(/\s+/g, " ");
  if (teksAlasan.length < 5) throw gagal("Alasan koreksi wajib diisi (minimal 5 karakter)", 400, "ALASAN_WAJIB");
  if (teksAlasan.length > 500) throw gagal("Alasan maksimal 500 karakter", 400, "ALASAN_TERLALU_PANJANG");
  if (expectedRevision === undefined || expectedRevision === null || !Number.isInteger(Number(expectedRevision)) || Number(expectedRevision) < 0) {
    throw gagal("Revisi yang Anda lihat (expectedRevision) wajib dikirim — buka pratinjau dampak dulu", 400, "REVISI_WAJIB");
  }
  const hashPermintaan = hash({ penjualanId, masukan, expectedRevision: Number(expectedRevision), alasan: teksAlasan });

  const { pkr, order } = await muatKeadaan(tx, penjualanId, { kunci: true });
  const ada = await tx.pkrItemRevision.findFirst({ where: { orderId: order.id, idempotencyKey: String(idempotencyKey) } });
  if (ada) {
    if (ada.impact?.hashPermintaan !== hashPermintaan) throw gagal("Idempotency-Key ini sudah dipakai untuk koreksi lain. Pakai kunci baru.", 409, "IDEMPOTENCY_KEY_DIPAKAI");
    return { replayed: true, revisi: ada.revision, nomor: pkr.nomor, orderId: order.id, perubahan: ada.impact?.perubahan ?? [], dampak: ada.impact?.dampak ?? null, customerIds: [] };
  }
  const sekarang = await revisiTerakhir(tx, order.id);
  if (sekarang !== Number(expectedRevision)) {
    throw gagal("Order ini sudah diubah orang lain atau di layar lain. Muat ulang lalu periksa dampaknya sebelum mengirim lagi.", 409, "REVISI_BERUBAH", { revisiSaatIni: sekarang, revisiDikirim: Number(expectedRevision) });
  }

  const h = await hitungKoreksi(tx, { penjualanId, masukan, kunci: false, terapkan: true, userId, kolomIzin });
  const data = { ...h.orderData, ...(h.notesBaru !== null && { notes: h.notesBaru }) };
  if (Object.keys(data).length) await tx.order.update({ where: { id: order.id }, data });
  if (h.perubahan.some((x) => x.kolom === "namaCustomer")) {
    await tx.customer.update({ where: { id: order.customerId }, data: { name: h.perubahan.find((x) => x.kolom === "namaCustomer").sesudah, nameManuallyEdited: true } });
  }
  for (const j of h.jobDisinkron) await tx.job.update({ where: { id: j.id }, data: { addressText: j.baruTeks, lat: null, lng: null } });

  const sesudahIdentitas = identitasPkr(await tx.order.findUnique({ where: { id: order.id }, select: PKR_IDENTITAS_SELECT }));
  const tulis = await tulisRevisi(tx, {
    orderId: order.id, penjualanId, kind: "PEMBELI", reason: teksAlasan, before: null, after: await snapshotItems(tx, order.id),
    impact: { hashPermintaan, perubahan: h.perubahan, dampak: h.dampak, peringatan: h.peringatan, identitasSebelum: h.idLama, identitasSesudah: sesudahIdentitas },
    userId, idempotencyKey: String(idempotencyKey), expected: Number(expectedRevision),
  });
  const meta = { aksi: "pembeli_dikoreksi", nomorPkr: pkr.nomor, penjualanId, orderId: order.id, alasan: teksAlasan, perubahan: h.perubahan, dampak: h.dampak, revisi: tulis.revision };
  await recordActivity(tx, { entityType: ENTITY_TYPES.FIN_PENJUALAN_KARYAWAN, entityId: pkr.id, eventType: EVENT_TYPES.PKR_ORDER_SINKRON, actorId: userId, metadata: meta });
  await recordActivity(tx, { entityType: ENTITY_TYPES.ORDER, entityId: order.id, eventType: EVENT_TYPES.PKR_ORDER_SINKRON, actorId: userId, metadata: meta });
  return { replayed: false, revisi: tulis.revision, nomor: pkr.nomor, orderId: order.id, perubahan: h.perubahan, dampak: h.dampak, peringatan: h.peringatan, identitas: sesudahIdentitas, customerIds: h.customerIds };
}

/**
 * DRY-RUN migrasi relasi (baca-saja, tidak menulis): order PKR yang masih menunjuk profil internal karyawan (legacy) dan data apa yang tersedia/kosong.
 * Tidak ada backfill otomatis — pelengkapan dilakukan Admin lewat UI (Lengkapi/Tautkan Customer).
 */
export async function dryRunPembeliLegacy(db, { batas = 500 } = {}) {
  const rows = await db.order.findMany({
    where: { penjualanKaryawanId: { not: null } }, orderBy: { createdAt: "desc" }, take: batas,
    select: { ...PKR_IDENTITAS_SELECT, id: true, orderNumber: true, status: true, createdAt: true, _count: { select: { units: true } } },
  });
  const ringkasan = { totalOrderPkr: rows.length, legacy: 0, aktual: 0, pembeliKaryawan: 0, dibatalkan: 0 };
  const baris = [];
  for (const o of rows) {
    const id = identitasPkr(o);
    if (o.status === "CANCELLED") { ringkasan.dibatalkan += 1; continue; }
    if (id.pembeliAdalahKaryawan) { ringkasan.pembeliKaryawan += 1; continue; }
    if (!id.legacy) { ringkasan.aktual += 1; continue; }
    ringkasan.legacy += 1;
    const notes = bacaNotesOrder(o.notes);
    const tersedia = { namaPembeliSnapshot: Boolean(id.customer.nama), telepon: false, alamat: Boolean(id.alamat.teks), kota: Boolean(id.alamat.kota), lokasiUrl: Boolean(id.alamat.lokasiUrl), keluhan: Boolean(notes.keluhanCustomer) };
    baris.push({
      nomorPkr: id.nomorPkr, orderNumber: o.orderNumber, orderId: o.id, karyawanPenjual: id.karyawanPenjual.nama, pembeliSnapshot: id.customer.nama, unit: o._count.units,
      dibuat: o.createdAt.toISOString(), tersedia, masihKosong: Object.entries(tersedia).filter(([, v]) => !v).map(([k]) => k),
    });
  }
  return { ringkasan, baris, catatan: "Dry-run baca-saja: tidak ada Customer/Order yang diubah. Nomor telepon pembeli TIDAK ada di data lama dan tidak ditebak." };
}

/**
 * Riwayat perubahan satu PKR + order CRM-nya (baca-saja): revisi item/pembeli (sebelum/sesudah, pelaku, alasan) + peristiwa sinkronisasi di log aktivitas.
 * Tanpa nominal baris Finance kecuali `izinFinance` (before/after Finance hanya untuk yang berizin).
 */
export async function riwayatPerubahanPkr(db, penjualanId, { izinFinance = false, batas = 100 } = {}) {
  if (!UUID.test(String(penjualanId))) throw gagal("Penjualan karyawan tidak ditemukan", 404);
  const pkr = await db.finPenjualanKaryawan.findUnique({ where: { id: penjualanId }, select: { id: true, nomor: true, orderCrm: { select: { id: true, orderNumber: true } } } });
  if (!pkr) throw gagal("Penjualan karyawan tidak ditemukan", 404);
  const revisi = pkr.orderCrm ? await db.pkrItemRevision.findMany({ where: { orderId: pkr.orderCrm.id }, orderBy: { revision: "desc" }, take: batas }) : [];
  const aktor = await db.user.findMany({ where: { id: { in: [...new Set(revisi.map((r) => r.actorId).filter(Boolean))] } }, select: { id: true, name: true } });
  const nama = new Map(aktor.map((a) => [a.id, a.name]));
  const label = { DIBUAT: "Order dibuat", DILENGKAPI: "Spesifikasi dilengkapi", DIKOREKSI: "Item dikoreksi", PEMBELI: "Data customer/kontak dikoreksi", KOREKSI_BARIS: "Baris penjualan dikoreksi" };
  return {
    nomor: pkr.nomor, orderNumber: pkr.orderCrm?.orderNumber ?? null,
    revisi: revisi.map((r) => ({
      revisi: r.revision, jenis: r.kind, label: label[r.kind] ?? r.kind, alasan: r.reason, pelaku: r.actorId ? { id: r.actorId, nama: nama.get(r.actorId) ?? null } : null, waktu: r.createdAt.toISOString(),
      perubahan: r.impact?.perubahan ?? null, dampak: r.impact?.dampak ?? null,
      ...(izinFinance && r.financeBefore ? { financeBefore: r.financeBefore, financeAfter: r.financeAfter } : {}),
    })),
  };
}
