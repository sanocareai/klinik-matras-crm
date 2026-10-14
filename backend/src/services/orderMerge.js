// GABUNGKAN ORDER DUPLIKAT (Admin) — kasus Pak Indra: order resmi NEW-11102026-023 (dari PKR-11102026-005, U1/U2/U3) dan NEW-01092026-001 (dibuat manual sebagai
// workaround saat integrasi PKR–Delivery belum benar) tampil sebagai dua pesanan aktif.
//
// Prinsip:
//   • Order duplikat TIDAK dihapus dan TIDAK dimodifikasi isinya: ia hanya diberi relasi `mergedIntoOrderId` (+ waktu/pelaku/alasan) dan satu baris buku `order_merges` (append-only).
//   • Unit/Job/Route/POD/Payment/invoice/jurnal/refund/nota kredit TIDAK dipindah, tidak dibuat, tidak dihapus → omzet/KPI/saldo tidak berubah dan tidak ada yang berlipat.
//   • Bukti kuat wajib: customer/HP SAMA + barang SERUPA + konteks PKR (utama = order PKR, duplikat bukan). Nama saja TIDAK cukup.
//   • Dua order yang sama-sama punya job AKTIF → DIBLOKIR (Admin memilih job yang dipertahankan dan membatalkan yang lain lewat alur resmi dulu).
//   • Pratinjau = fungsi hitung yang SAMA dengan penerapan (tanpa menulis); penerapan butuh alasan ≥5, Idempotency-Key, kunci baris, dan sidik jari pratinjau (revisi optimistis).
import { createHash } from "node:crypto";
import { lockRowForUpdate } from "./inventoryLedger.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../lib/activityLog.js";

const POLA_KUNCI = /^[A-Za-z0-9_\-:.]{8,128}$/;
const JOB_AKTIF = ["UNSCHEDULED", "SCHEDULED", "ASSIGNED", "EN_ROUTE", "ARRIVED", "RESCHEDULED"];
const hash = (v) => createHash("sha256").update(JSON.stringify(v ?? null)).digest("hex");
const teks = (v) => String(v ?? "").replace(/\s+/g, " ").trim().toLowerCase();

export class OrderMergeError extends Error {
  constructor(message, statusCode = 400, code = null, extra = null) { super(message); this.name = "OrderMergeError"; this.statusCode = statusCode; this.code = code; if (extra) this.extra = extra; }
}
const gagal = (m, s = 400, c = null, e = null) => new OrderMergeError(m, s, c, e);

const SELECT_ORDER = {
  id: true, orderNumber: true, status: true, category: true, value: true, createdAt: true, updatedAt: true, notes: true, customerId: true, penjualanKaryawanId: true,
  mergedIntoOrderId: true, mergedAt: true, deliveryAddress: true, paymentStatus: true, quantity: true,
  customer: { select: { id: true, name: true, phone: true, assignedSales: { select: { id: true, name: true } } } },
  penjualanKaryawan: { select: { id: true, nomor: true, status: true, seller: { select: { id: true, name: true } } } },
  units: { select: { id: true, unitCode: true, seq: true, status: true, merk: true, ukuran: true }, orderBy: { seq: "asc" } },
  jobs: {
    select: { id: true, type: true, status: true, completedAt: true, routeId: true, proofPhotoUrls: true, scheduledDate: true, route: { select: { id: true, code: true, status: true } }, driver: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  },
  payments: { select: { id: true, amount: true, method: true, createdAt: true } },
};

async function muatOrder(db, nomorAtauId) {
  const cari = String(nomorAtauId ?? "").trim();
  if (!cari) return null;
  return (await db.order.findUnique({ where: { id: cari }, select: SELECT_ORDER })) || (await db.order.findFirst({ where: { orderNumber: cari }, select: SELECT_ORDER }));
}

async function hitungJejakKeuangan(db, orderId) {
  const [inv, kredit, refund, jurnal] = await Promise.all([
    db.invoice.count({ where: { orderId } }),
    db.$queryRawUnsafe(`select count(*)::int n from fin_order_credits where order_id = $1`, orderId).then((r) => Number(r[0].n)).catch(() => 0),
    db.$queryRawUnsafe(`select count(*)::int n from fin_refunds where order_id = $1`, orderId).then((r) => Number(r[0].n)).catch(() => 0),
    db.$queryRawUnsafe(`select count(*)::int n from fin_journal_entries where source_id = $1`, orderId).then((r) => Number(r[0].n)).catch(() => 0),
  ]);
  return { invoice: inv, notaKredit: kredit, refund, jurnalBersumberOrder: jurnal };
}

const ringkasOrder = (o, keu) => ({
  id: o.id, nomor: o.orderNumber, status: o.status, kategori: o.category, nilai: o.value, dibuat: o.createdAt.toISOString(),
  customer: { id: o.customer?.id ?? null, nama: o.customer?.name ?? null, telepon: o.customer?.phone ?? null, salesLead: o.customer?.assignedSales?.name ?? null },
  pkr: o.penjualanKaryawan ? { nomor: o.penjualanKaryawan.nomor, penjual: o.penjualanKaryawan.seller?.name ?? null, status: o.penjualanKaryawan.status } : null,
  unit: o.units.map((u) => ({ kode: u.unitCode, status: u.status, merk: u.merk, ukuran: u.ukuran })),
  job: o.jobs.map((j) => ({
    id: j.id, tipe: j.type, status: j.status, selesai: j.completedAt ? j.completedAt.toISOString() : null, rute: j.route?.code ?? null, driver: j.driver?.name ?? null,
    punyaFotoBukti: Array.isArray(j.proofPhotoUrls) && j.proofPhotoUrls.length > 0, aktif: JOB_AKTIF.includes(j.status),
  })),
  pembayaran: { jumlah: o.payments.length, total: o.payments.reduce((a, p) => a + Number(p.amount), 0) },
  keuangan: keu,
  digabungKe: o.mergedIntoOrderId,
});

/** Analisis bukti + hambatan + dampak. Murni baca. */
export async function analisisGabung(db, { utama, duplikat }) {
  const [a, b] = await Promise.all([muatOrder(db, utama), muatOrder(db, duplikat)]);
  if (!a) throw gagal("Order utama tidak ditemukan", 404, "UTAMA_TIDAK_ADA");
  if (!b) throw gagal("Order duplikat tidak ditemukan", 404, "DUPLIKAT_TIDAK_ADA");
  const [ka, kb] = await Promise.all([hitungJejakKeuangan(db, a.id), hitungJejakKeuangan(db, b.id)]);
  const hambatan = [];
  if (a.id === b.id) hambatan.push({ kode: "ORDER_SAMA", pesan: "Order utama dan duplikat tidak boleh sama" });
  if (a.status === "CANCELLED") hambatan.push({ kode: "UTAMA_BATAL", pesan: "Order utama sudah dibatalkan" });
  if (b.status === "CANCELLED") hambatan.push({ kode: "DUPLIKAT_BATAL", pesan: "Order duplikat sudah dibatalkan — tidak perlu digabung" });
  if (a.mergedIntoOrderId) hambatan.push({ kode: "UTAMA_SUDAH_DIGABUNG", pesan: "Order utama sendiri sudah digabungkan ke order lain" });
  if (b.mergedIntoOrderId) hambatan.push({ kode: "DUPLIKAT_SUDAH_DIGABUNG", pesan: "Order duplikat sudah digabungkan sebelumnya" });
  if (!a.penjualanKaryawanId) hambatan.push({ kode: "UTAMA_BUKAN_PKR", pesan: "Order utama harus order resmi Penjualan Karyawan (konteks PKR)" });
  if (b.penjualanKaryawanId) hambatan.push({ kode: "DUPLIKAT_JUGA_PKR", pesan: "Order duplikat juga order Penjualan Karyawan — dua PKR tidak digabung dari sini" });
  const jobAktifA = a.jobs.filter((j) => JOB_AKTIF.includes(j.status));
  const jobAktifB = b.jobs.filter((j) => JOB_AKTIF.includes(j.status));
  if (jobAktifA.length > 0 && jobAktifB.length > 0) {
    hambatan.push({
      kode: "DUA_JOB_AKTIF",
      pesan: "Kedua order sama-sama punya job aktif — berpotensi mengirim barang yang sama. Pilih job yang dipertahankan dan batalkan job lain lewat alur resmi (alasan + audit) sebelum menggabungkan.",
      job: { utama: jobAktifA.map((j) => j.id), duplikat: jobAktifB.map((j) => j.id) },
    });
  }

  // Bukti: NAMA SAJA tidak cukup.
  const telA = String(a.customer?.phone ?? "").replace(/\D/g, ""); const telB = String(b.customer?.phone ?? "").replace(/\D/g, "");
  const customerSama = a.customerId === b.customerId;
  const teleponSama = Boolean(telA) && telA === telB;
  const namaSama = teks(a.customer?.name) !== "" && teks(a.customer?.name) === teks(b.customer?.name);
  const merkA = new Set(a.units.map((u) => teks(u.merk)).filter(Boolean)); const merkB = new Set(b.units.map((u) => teks(u.merk)).filter(Boolean));
  const barangSerupa = [...merkA].some((m) => merkB.has(m) || [...merkB].some((n) => n.includes(m) || m.includes(n)))
    || (a.units.length > 0 && a.units.length === b.units.length && a.units.every((u, i) => teks(u.ukuran) !== "" && teks(u.ukuran) === teks(b.units[i]?.ukuran)));
  const bukti = {
    customerAtauTeleponSama: customerSama || teleponSama,
    customerSama, teleponSama, namaSama,
    barangSerupa,
    konteksPkr: Boolean(a.penjualanKaryawanId) && !b.penjualanKaryawanId,
    jumlahUnit: { utama: a.units.length, duplikat: b.units.length },
  };
  const cukup = bukti.customerAtauTeleponSama && bukti.barangSerupa && bukti.konteksPkr;
  if (!cukup) {
    hambatan.push({
      kode: "BUKTI_KURANG",
      pesan: `Bukti belum cukup untuk menyatakan duplikat (perlu: customer/HP sama + barang serupa + konteks PKR). Nama customer yang sama SAJA tidak cukup. Terpenuhi: customer/HP ${bukti.customerAtauTeleponSama ? "ya" : "TIDAK"}, barang ${bukti.barangSerupa ? "ya" : "TIDAK"}, PKR ${bukti.konteksPkr ? "ya" : "TIDAK"}.`,
    });
  }
  const peringatan = [];
  // Sinyal waktu (temuan audit produksi Indra, 14 Okt 2026): order duplikat yang dibuat JAUH SEBELUM order resmi hampir pasti transaksi terpisah, bukan workaround.
  const selisihHari = Math.round((a.createdAt.getTime() - b.createdAt.getTime()) / 86400000);
  if (selisihHari >= 3) peringatan.push(`Order duplikat dibuat ${selisihHari} hari SEBELUM order resmi — kemungkinan besar transaksi terpisah, bukan duplikat. Periksa barang, tanggal, dan pembayarannya sebelum menggabungkan.`);
  if (b.jobs.length > 0 && b.jobs.every((j) => j.type === "PICKUP") && a.jobs.some((j) => j.type === "DELIVERY")) peringatan.push("Job order duplikat hanya Pengambilan (PICKUP), sementara order resmi punya Pengiriman — bukan job yang sama.");
  if (b.payments.length > 0) peringatan.push(`Order duplikat punya ${b.payments.length} pembayaran (Rp${b.payments.reduce((x, p) => x + Number(p.amount), 0).toLocaleString("id-ID")}) — TIDAK dipindah dan tidak dihapus; tetap di order lama sebagai histori.`);
  if (b.value > 0) peringatan.push(`Order duplikat bernilai Rp${b.value.toLocaleString("id-ID")} (omzet Sales): penggabungan TIDAK mengubah laporan omzet/KPI — tinjau terpisah bila perlu.`);
  if (b.jobs.some((j) => j.status === "COMPLETED")) peringatan.push("Order duplikat punya job yang sudah SELESAI (histori Delivery nyata) — dipertahankan dan tampil sebagai \"Histori dari order lama\" pada order utama.");
  if (jobAktifB.length > 0 && jobAktifA.length === 0) peringatan.push("Hanya order duplikat yang punya job aktif; job itu tetap berjalan apa adanya (tidak dipindah, tidak dibatalkan).");
  if (a.units.length > 0 && b.units.length > 0 && b.units.some((u) => ["IN_TRANSIT_OUT", "DELIVERED"].includes(u.status)) && a.units.every((u) => !["IN_TRANSIT_OUT", "DELIVERED"].includes(u.status))) {
    peringatan.push("Unit order duplikat sudah dikirim/diterima sementara unit order utama belum — pastikan ini memang barang yang sama sebelum menggabungkan.");
  }
  const dampak = {
    dihapus: 0, unitBaru: 0, jobBaru: 0, unitDipindah: 0, jobDipindah: 0, paymentBaru: 0, invoiceBaru: 0, jurnalBaru: 0,
    perubahan: [`Order ${b.orderNumber} ditandai "Digabungkan ke ${a.orderNumber}" (relasi + pelaku + alasan).`, "Daftar aktif CRM/Produksi/Delivery hanya menampilkan order utama.", "Pencarian nomor order lama menemukan order utama; order lama menampilkan banner."],
  };
  const sidikJari = hash({ a: [a.id, a.updatedAt.toISOString(), a.mergedIntoOrderId, a.jobs.map((j) => [j.id, j.status])], b: [b.id, b.updatedAt.toISOString(), b.mergedIntoOrderId, b.jobs.map((j) => [j.id, j.status])] });
  return { utama: ringkasOrder(a, ka), duplikat: ringkasOrder(b, kb), bukti, cukup, hambatan, peringatan, dampak, bolehDigabung: cukup && hambatan.length === 0, sidikJari, _a: a, _b: b };
}

const bentukPublik = ({ _a, _b, ...r }) => r;

/** Pratinjau (baca-saja). */
export async function pratinjauGabung(db, { utama, duplikat }) {
  return bentukPublik(await analisisGabung(db, { utama, duplikat }));
}

/** Terapkan di dalam transaksi pemanggil. */
export async function terapkanGabung(tx, { utama, duplikat, alasan, idempotencyKey, sidikJari, userId = null }) {
  if (!idempotencyKey || !POLA_KUNCI.test(String(idempotencyKey))) throw gagal("Header Idempotency-Key wajib (8–128 karakter) untuk penggabungan order", 428, "IDEMPOTENCY_KEY_REQUIRED");
  const teksAlasan = String(alasan ?? "").trim().replace(/\s+/g, " ");
  if (teksAlasan.length < 5) throw gagal("Alasan penggabungan wajib diisi (minimal 5 karakter)", 400, "ALASAN_WAJIB");
  if (teksAlasan.length > 500) throw gagal("Alasan maksimal 500 karakter", 400, "ALASAN_TERLALU_PANJANG");
  if (!sidikJari) throw gagal("Sidik jari pratinjau wajib dikirim — buka pratinjau dampak dulu", 400, "SIDIK_JARI_WAJIB");

  const [ida, idb] = await Promise.all([muatOrder(tx, utama), muatOrder(tx, duplikat)]);
  if (!ida || !idb) throw gagal("Order tidak ditemukan", 404, "ORDER_TIDAK_ADA");
  // Replay: kunci yang sama dengan isi yang sama = hasil yang sama (tidak ada relasi ganda).
  const ada = await tx.orderMerge.findFirst({ where: { OR: [{ idempotencyKey: String(idempotencyKey) }, { duplicateOrderId: idb.id }] } });
  if (ada) {
    if (ada.idempotencyKey === String(idempotencyKey) && ada.primaryOrderId === ida.id && ada.duplicateOrderId === idb.id) return { replayed: true, penggabunganId: ada.id, utama: ida.orderNumber, duplikat: idb.orderNumber };
    throw gagal(ada.idempotencyKey === String(idempotencyKey) ? "Idempotency-Key ini sudah dipakai untuk penggabungan lain. Pakai kunci baru." : `Order ${idb.orderNumber} sudah digabungkan sebelumnya.`, 409, ada.idempotencyKey === String(idempotencyKey) ? "IDEMPOTENCY_KEY_DIPAKAI" : "SUDAH_DIGABUNG");
  }
  // Kunci baris (urut id → tanpa deadlock), lalu hitung ulang di bawah kunci.
  for (const id of [ida.id, idb.id].sort()) await lockRowForUpdate(tx, '"Order"', id, { cast: null });
  const a = await analisisGabung(tx, { utama: ida.id, duplikat: idb.id });
  if (a.sidikJari !== sidikJari) throw gagal("Keadaan order sudah berubah sejak pratinjau dibuka. Muat ulang pratinjau lalu periksa dampaknya.", 409, "REVISI_BERUBAH", { sidikJariSaatIni: a.sidikJari });
  if (!a.bolehDigabung) {
    const h = a.hambatan[0];
    throw gagal(h?.pesan ?? "Penggabungan ditolak", 409, h?.kode ?? "DITOLAK", { hambatan: a.hambatan });
  }
  const sebelum = { duplikat: { id: idb.id, nomor: idb.orderNumber, status: idb.status, mergedIntoOrderId: idb.mergedIntoOrderId }, utama: { id: ida.id, nomor: ida.orderNumber, status: ida.status } };
  const sekarang = new Date();
  await tx.order.update({ where: { id: idb.id }, data: { mergedIntoOrderId: ida.id, mergedAt: sekarang, mergedById: userId, mergeReason: teksAlasan } });
  const sesudah = { duplikat: { ...sebelum.duplikat, mergedIntoOrderId: ida.id, mergedAt: sekarang.toISOString() }, utama: sebelum.utama };
  const baris = await tx.orderMerge.create({
    data: { primaryOrderId: ida.id, duplicateOrderId: idb.id, actorId: userId, reason: teksAlasan, idempotencyKey: String(idempotencyKey), before: sebelum, after: sesudah, evidence: { bukti: a.bukti, peringatan: a.peringatan } },
  });
  const meta = { aksi: "order_digabung", utama: ida.orderNumber, duplikat: idb.orderNumber, alasan: teksAlasan, penggabunganId: baris.id };
  await recordActivity(tx, { entityType: ENTITY_TYPES.ORDER, entityId: idb.id, eventType: EVENT_TYPES.PKR_ORDER_SINKRON, actorId: userId, metadata: meta });
  await recordActivity(tx, { entityType: ENTITY_TYPES.ORDER, entityId: ida.id, eventType: EVENT_TYPES.PKR_ORDER_SINKRON, actorId: userId, metadata: meta });
  return { replayed: false, penggabunganId: baris.id, utama: ida.orderNumber, duplikat: idb.orderNumber, sebelum, sesudah };
}

/** Kandidat duplikat untuk satu order utama: order lain customer/HP sama yang belum digabung & bukan PKR, DAN buktinya kuat. Hanya daftar bukti; tidak ada penerapan otomatis. */
export async function kandidatDuplikat(db, { orderId }) {
  const o = await muatOrder(db, orderId);
  if (!o) throw gagal("Order tidak ditemukan", 404);
  const telepon = String(o.customer?.phone ?? "");
  const lain = await db.order.findMany({
    where: {
      id: { not: o.id }, mergedIntoOrderId: null, penjualanKaryawanId: null, status: { not: "CANCELLED" },
      OR: [{ customerId: o.customerId }, ...(telepon ? [{ customer: { phone: telepon } }] : [])],
    },
    select: { id: true },
  });
  const hasil = [];
  for (const l of lain) {
    const a = await analisisGabung(db, { utama: o.id, duplikat: l.id });
    // Hanya pasangan dengan bukti duplikat KUAT yang ditawarkan (customer/HP sama + barang serupa + konteks PKR). Order lain milik customer yang sama = transaksi berbeda, tidak diusulkan.
    if (!a.cukup) continue;
    hasil.push({ duplikat: a.duplikat, bukti: a.bukti, cukup: a.cukup, bolehDigabung: a.bolehDigabung, hambatan: a.hambatan.map((h) => h.kode) });
  }
  return { utama: o.orderNumber, kandidat: hasil };
}

/** Untuk daftar: peta { duplikatId -> {id,nomor} } dan { utamaId -> [{id,nomor,...}] } pada sekumpulan id order. */
export async function relasiGabungUntuk(db, orderIds) {
  if (!orderIds?.length) return { keUtama: new Map(), dariLama: new Map() };
  const rows = await db.orderMerge.findMany({
    where: { OR: [{ duplicateOrderId: { in: orderIds } }, { primaryOrderId: { in: orderIds } }] },
    select: {
      primaryOrderId: true, duplicateOrderId: true, createdAt: true, reason: true,
      primaryOrder: { select: { id: true, orderNumber: true } },
      duplicateOrder: {
        select: {
          id: true, orderNumber: true, status: true, createdAt: true,
          jobs: { select: { id: true, type: true, status: true, completedAt: true, route: { select: { code: true } } }, orderBy: { createdAt: "asc" } },
        },
      },
    },
  });
  const keUtama = new Map(); const dariLama = new Map();
  for (const r of rows) {
    keUtama.set(r.duplicateOrderId, { id: r.primaryOrder.id, nomor: r.primaryOrder.orderNumber, alasan: r.reason, pada: r.createdAt.toISOString() });
    const arr = dariLama.get(r.primaryOrderId) ?? [];
    arr.push({
      id: r.duplicateOrder.id, nomor: r.duplicateOrder.orderNumber, status: r.duplicateOrder.status, dibuat: r.duplicateOrder.createdAt.toISOString(), alasan: r.reason, pada: r.createdAt.toISOString(),
      job: r.duplicateOrder.jobs.map((j) => ({ id: j.id, tipe: j.type, status: j.status, selesai: j.completedAt ? j.completedAt.toISOString() : null, rute: j.route?.code ?? null })),
    });
    dariLama.set(r.primaryOrderId, arr);
  }
  return { keUtama, dariLama };
}
