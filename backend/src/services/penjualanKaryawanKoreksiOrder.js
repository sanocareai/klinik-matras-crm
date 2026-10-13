// KOREKSI DATA ORDER PKR + MATRIKS KEMAMPUAN KOREKSI (Okt 2026).
//
// Dua hal, satu sumber kebenaran di server:
//   1. kemampuanKoreksiPkr()  — field apa saja yang MASIH bisa dikoreksi untuk satu PKR, lewat jalur apa, dan bila terkunci: kenapa serta apa langkah resminya. Format lama TIDAK disembunyikan.
//   2. pratinjauKoreksiOrder()/terapkanKoreksiOrder() — koreksi data tingkat ORDER (alamat, kota, tanggal kirim, catatan permintaan customer, dan untuk format lama: merk/ukuran/dikirim)
//      dengan alasan wajib, pratinjau dampak (fungsi hitung yang sama dengan penerapan), revisi optimistis, Idempotency-Key, satu transaksi atomik, dan buku revisi append-only.
//
// Jumlah/harga/tambah-hapus item/ukuran per item/spesifikasi per item TETAP lewat koreksi-baris (terpadu) dan koreksi-item (order multi-item) yang sudah ada — modul ini tidak menduplikasinya.
// Tidak ada uang di sini: tidak membuat/mengubah Payment, invoice, jurnal, unit, atau job baru (kecuali job pengiriman kerangka bila order ditandai perlu dikirim, lewat jalur baku yang idempoten).
import { createHash } from "node:crypto";
import { PkrOrderError } from "./pkrGuard.js";
import { lockRowForUpdate } from "./inventoryLedger.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../lib/activityLog.js";
import { bacaNotesOrder } from "../lib/domain/pkrSpesifikasi.js";
import { revisiTerakhir, tulisRevisi } from "./pkrItemRevisi.js";
import { lengkapiSpesifikasi } from "./penjualanKaryawanOrder.js";

const gagal = (m, s = 400, c = null, e = null) => new PkrOrderError(m, s, c, e);
const POLA_KUNCI = /^[A-Za-z0-9_\-:.]{8,128}$/;
const BELUM_MULAI = ["AWAITING_PICKUP", "RECEIVED"];
const JOB_KIRIM_BERJALAN = ["EN_ROUTE", "ARRIVED", "COMPLETED", "FAILED"];
const hash = (v) => createHash("sha256").update(JSON.stringify(v ?? null)).digest("hex");

export const FORMAT_PKR = Object.freeze({
  TERPADU: "TERPADU", LAMA_ORDER_ITEM: "LAMA_ORDER_ITEM", LAMA_TANPA_ITEM: "LAMA_TANPA_ITEM", TANPA_ORDER: "TANPA_ORDER", DIBATALKAN: "DIBATALKAN",
});
const FORMAT_LABEL = {
  TERPADU: "Format terpadu (baris penjualan = pemenuhan)",
  LAMA_ORDER_ITEM: "Format lama dengan daftar item produksi",
  LAMA_TANPA_ITEM: "Format lama (satu spesifikasi untuk seluruh unit)",
  TANPA_ORDER: "Belum punya order CRM",
  DIBATALKAN: "Dibatalkan",
};
const FORMAT_PENJELASAN = {
  TERPADU: "Setiap baris penjualan memuat pemenuhan (ukuran, spesifikasi, dikirim/diambil), jadi jumlah dan harga bisa dikoreksi per baris dengan Finance, jurnal, dan Produksi ikut berubah bersama.",
  LAMA_ORDER_ITEM: "Item produksi sudah dirinci, tetapi baris penjualannya dicatat sebelum format terpadu (tanpa data pemenuhan). Item produksi bisa dikoreksi; jumlah dan harga di baris penjualan TIDAK bisa dikoreksi per baris.",
  LAMA_TANPA_ITEM: "Dicatat sebelum format item: satu spesifikasi untuk seluruh unit dan satu baris penjualan tanpa rincian pemenuhan. Jumlah unit dan harga TIDAK bisa dikoreksi di sini; merk, ukuran, dikirim/diambil, alamat, dan catatan bisa dikoreksi.",
  TANPA_ORDER: "Belum ada order CRM — buat/tautkan order dulu sebelum mengoreksi data order.",
  DIBATALKAN: "Penjualan sudah dibatalkan; tidak ada yang bisa dikoreksi.",
};
const LABEL_FIELD = { alamat: "Alamat pengiriman", kota: "Kota", tanggalKirim: "Tanggal kirim", catatan: "Catatan permintaan customer", perluDikirim: "Dikirim / diambil sendiri", merk: "Merk kasur", ukuran: "Ukuran" };
const FIELD_ORDER = ["alamat", "kota", "tanggalKirim", "catatan", "perluDikirim", "merk", "ukuran"];
const FIELD_HANYA_LAMA = new Set(["perluDikirim", "merk", "ukuran"]);
const FIELD_BERISIKO_PRODUKSI = new Set(["merk", "ukuran", "catatan", "perluDikirim"]);
const FIELD_PENGIRIMAN = new Set(["alamat", "kota", "tanggalKirim"]);
const JALUR_RESMI = "Langkah resmi: batalkan pembayaran lewat Riwayat Pembayaran (Finance), batalkan Penjualan Karyawan ini, lalu catat penjualan baru dengan data yang benar.";

const UNIT_SELECT = {
  id: true, unitCode: true, seq: true, status: true, currentStageId: true, merk: true, ukuran: true,
  productionRunsV2: { where: { status: { not: "CANCELLED" } }, select: { id: true }, take: 1 },
  _count: { select: { stageLogs: true } },
};

/** Alasan produksi sudah berjalan untuk satu unit (null = belum). Dihitung dari data resmi, bukan dari status tampilan. */
export function alasanProduksiBerjalan(u) {
  if (u.status === "CANCELLED") return null;
  if (!BELUM_MULAI.includes(u.status)) return `unit ${u.unitCode} berstatus ${u.status}`;
  if (u.currentStageId != null || (u._count?.stageLogs ?? 0) > 0) return `unit ${u.unitCode} sudah punya progres produksi`;
  if ((u.productionRunsV2?.length ?? 0) > 0) return `unit ${u.unitCode} sudah dijadwalkan/dibuka di Produksi`;
  return null;
}

async function muat(db, penjualanId, { kunci = false } = {}) {
  if (kunci) await lockRowForUpdate(db, '"fin_penjualan_karyawan"', penjualanId);
  const pkr = await db.finPenjualanKaryawan.findUnique({
    where: { id: penjualanId },
    select: { id: true, nomor: true, status: true, notes: true, buyerName: true, seller: { select: { name: true } }, items: { select: { id: true, fulfillment: true } }, orderCrm: { select: { id: true } } },
  });
  if (!pkr) throw gagal("Penjualan karyawan tidak ditemukan", 404, "PKR_TIDAK_ADA");
  if (!pkr.orderCrm) return { pkr, order: null, units: [], jobs: [], modeItem: false, format: pkr.status === "DIBATALKAN" ? FORMAT_PKR.DIBATALKAN : FORMAT_PKR.TANPA_ORDER, revisi: 0 };
  if (kunci) await db.$queryRawUnsafe('SELECT id FROM "Order" WHERE id = $1 FOR UPDATE', pkr.orderCrm.id);
  const order = await db.order.findUnique({
    where: { id: pkr.orderCrm.id },
    select: {
      id: true, orderNumber: true, status: true, notes: true, deliveryAddress: true, deliveryCity: true, deliveryConfirmedDate: true, pkrPerluDikirim: true, statusLocked: true,
      units: { orderBy: { seq: "asc" }, select: UNIT_SELECT },
      jobs: { select: { id: true, type: true, status: true, addressText: true } },
    },
  });
  const modeItem = (await db.pkrOrderItem.count({ where: { orderId: order.id } })) > 0;
  const terpadu = pkr.items.some((i) => i.fulfillment != null);
  const batal = pkr.status === "DIBATALKAN" || order.status === "CANCELLED";
  const format = batal ? FORMAT_PKR.DIBATALKAN : terpadu ? FORMAT_PKR.TERPADU : modeItem ? FORMAT_PKR.LAMA_ORDER_ITEM : FORMAT_PKR.LAMA_TANPA_ITEM;
  const revisi = await revisiTerakhir(db, order.id);
  return { pkr, order, units: order.units, jobs: order.jobs, modeItem, format, revisi };
}

const nilaiSekarang = (order, pkr) => ({
  alamat: order.deliveryAddress ?? null,
  kota: order.deliveryCity ?? null,
  tanggalKirim: order.deliveryConfirmedDate ? order.deliveryConfirmedDate.toISOString().slice(0, 10) : null,
  catatan: pkr.notes ?? null,
  perluDikirim: order.pkrPerluDikirim ?? null,
  merk: bacaNotesOrder(order.notes).merkKasur ?? null,
  ukuran: bacaNotesOrder(order.notes).ukuranKasur ?? null,
});

/** Status terkunci per field untuk keadaan ini (tanpa DB): { boleh, alasan, jalur }. */
function statusField(field, ctx) {
  const { format, units, jobs } = ctx;
  if (format === FORMAT_PKR.DIBATALKAN || format === FORMAT_PKR.TANPA_ORDER) return { boleh: false, alasan: FORMAT_PENJELASAN[format], jalur: null };
  if (FIELD_HANYA_LAMA.has(field) && format !== FORMAT_PKR.LAMA_TANPA_ITEM) {
    return { boleh: false, alasan: "Order ini memakai daftar item: ubah ukuran, spesifikasi, dan dikirim/diambil PER ITEM.", jalur: format === FORMAT_PKR.TERPADU ? "koreksi-baris" : "koreksi-item" };
  }
  const aktif = units.filter((u) => u.status !== "CANCELLED");
  if (FIELD_BERISIKO_PRODUKSI.has(field)) {
    const mulai = aktif.map(alasanProduksiBerjalan).filter(Boolean);
    if (mulai.length) return { boleh: false, alasan: `Produksi sudah berjalan: ${mulai.slice(0, 3).join("; ")}${mulai.length > 3 ? `; +${mulai.length - 3} unit lain` : ""}. Field ini terkunci supaya pekerjaan yang sedang dikerjakan tidak berubah diam-diam.`, jalur: "batal-catat-ulang" };
  }
  if (FIELD_PENGIRIMAN.has(field)) {
    const j = jobs.filter((x) => x.type === "DELIVERY" && JOB_KIRIM_BERJALAN.includes(x.status));
    if (j.length) return { boleh: false, alasan: `Pengiriman sudah berjalan (${[...new Set(j.map((x) => x.status))].join(", ")}). Ubah lewat Delivery (Kendali Rute) — bukan dari sini.`, jalur: "delivery" };
  }
  if (field === "perluDikirim") {
    const kirim = jobs.filter((x) => x.type === "DELIVERY");
    if (kirim.length) return { boleh: true, alasan: null, jalur: "koreksi-order", catatan: "Memilih 'diambil sendiri' ditolak bila job pengiriman sudah dibuat — batalkan atau ubah lewat Delivery dulu." };
  }
  return { boleh: true, alasan: null, jalur: "koreksi-order" };
}

/** Matriks kemampuan koreksi lengkap (read-only) — sumber kebenaran untuk layar Finance. */
export async function kemampuanKoreksiPkr(db, penjualanId) {
  const ctx = await muat(db, penjualanId);
  const { pkr, order, units, jobs, format } = ctx;
  const aktif = units.filter((u) => u.status !== "CANCELLED");
  const produksiBerjalan = aktif.map(alasanProduksiBerjalan).filter(Boolean);
  const kirimBerjalan = jobs.filter((x) => x.type === "DELIVERY" && JOB_KIRIM_BERJALAN.includes(x.status));
  const nilai = order ? nilaiSekarang(order, pkr) : null;
  const field = {};
  if (order) for (const f of FIELD_ORDER) field[f] = { label: LABEL_FIELD[f], nilai: nilai[f], ...statusField(f, ctx) };

  // Jumlah/harga/item: jalurnya berbeda per format.
  const alasanProduksi = produksiBerjalan.length ? `Produksi sudah berjalan: ${produksiBerjalan.slice(0, 3).join("; ")}.` : null;
  let uang;
  let item;
  if (format === FORMAT_PKR.TERPADU) {
    uang = { jumlah: { boleh: !produksiBerjalan.length, alasan: alasanProduksi, jalur: "koreksi-baris" }, harga: { boleh: true, alasan: null, jalur: "koreksi-baris", catatan: "Harga tetap bisa dikoreksi walau produksi berjalan; tidak boleh di bawah pembayaran aktif dan periode jurnal harus terbuka." } };
    item = { tambahHapus: { boleh: !produksiBerjalan.length, alasan: alasanProduksi, jalur: "koreksi-baris" }, perItem: { boleh: true, alasan: "Ukuran, spesifikasi, dan dikirim/diambil dikoreksi per baris; baris yang unitnya sudah dijadwalkan/diproses terkunci.", jalur: "koreksi-baris" } };
  } else if (format === FORMAT_PKR.LAMA_ORDER_ITEM) {
    uang = {
      jumlah: { boleh: false, alasan: "Baris penjualan format lama (tanpa data pemenuhan): jumlah unit item bisa dikoreksi di daftar item produksi, tetapi nilai baris penjualan tidak ikut berubah.", jalur: "koreksi-item" },
      harga: { boleh: false, alasan: "Baris penjualan format lama tidak bisa dikoreksi per baris.", jalur: "batal-catat-ulang" },
    };
    item = { tambahHapus: { boleh: !produksiBerjalan.length, alasan: alasanProduksi, jalur: "koreksi-item" }, perItem: { boleh: true, alasan: "Item yang unitnya sudah dijadwalkan/diproses terkunci.", jalur: "koreksi-item" } };
  } else if (format === FORMAT_PKR.LAMA_TANPA_ITEM) {
    uang = {
      jumlah: { boleh: false, alasan: "Format lama tidak punya rincian item: jumlah unit mengikuti pencatatan awal dan tidak bisa dikoreksi dari sini.", jalur: "batal-catat-ulang" },
      harga: { boleh: false, alasan: "Format lama hanya punya satu baris penjualan tanpa data pemenuhan — tidak bisa dikoreksi per baris.", jalur: "batal-catat-ulang" },
    };
    item = { tambahHapus: { boleh: false, alasan: "Format lama tidak punya daftar item.", jalur: "batal-catat-ulang" }, perItem: { boleh: false, alasan: "Format lama tidak punya daftar item.", jalur: "batal-catat-ulang" } };
  } else {
    const k = { boleh: false, alasan: FORMAT_PENJELASAN[format], jalur: null };
    uang = { jumlah: k, harga: k }; item = { tambahHapus: k, perItem: k };
  }

  const lama = format === FORMAT_PKR.LAMA_ORDER_ITEM || format === FORMAT_PKR.LAMA_TANPA_ITEM;
  return {
    penjualanId: pkr.id, nomor: pkr.nomor, statusPkr: pkr.status,
    format, formatLabel: FORMAT_LABEL[format], penjelasan: FORMAT_PENJELASAN[format], formatLama: lama,
    revisi: ctx.revisi,
    order: order ? { id: order.id, nomor: order.orderNumber, status: order.status } : null,
    unit: aktif.map((u) => ({ id: u.id, kode: u.unitCode, status: u.status, terkunci: alasanProduksiBerjalan(u) })),
    produksiBerjalan: produksiBerjalan.length > 0, pengirimanBerjalan: kirimBerjalan.length > 0,
    jumlah: uang.jumlah, harga: uang.harga, tambahHapusItem: item.tambahHapus, perItem: item.perItem,
    field,
    jalurResmi: lama || produksiBerjalan.length ? JALUR_RESMI : null,
    // Jalur migrasi format lama -> terpadu: BELUM tersedia sebagai perintah (butuh keputusan Owner atas pemetaan kategori/produk per baris — tidak ditebak). Lihat docs/pkr-migrasi-format-lama.md.
    migrasiFormat: lama ? { tersedia: false, alasan: "Perlu pemilihan kategori/produk katalog per baris penjualan oleh Finance (tidak ditebak sistem). Rancangan migrasi aditif sudah ditulis dan menunggu keputusan Owner." } : null,
  };
}

// ── PRATINJAU + PENERAPAN ─────────────────────────────────────────────────────────────

function bacaPerubahan(perubahan) {
  if (!perubahan || typeof perubahan !== "object" || Array.isArray(perubahan)) throw gagal("Isi perubahan tidak valid", 400, "PERUBAHAN_TIDAK_VALID");
  const asing = Object.keys(perubahan).filter((k) => !FIELD_ORDER.includes(k));
  if (asing.length) throw gagal(`Field tidak dikenal: ${asing.join(", ")}`, 400, "FIELD_TIDAK_DIKENAL");
  const o = {};
  const teks = (v, maks, nama) => {
    if (v === null) return null;
    const t = String(v).trim().replace(/\s+/g, " ");
    if (t.length > maks) throw gagal(`${nama} maksimal ${maks} karakter`, 400, "TERLALU_PANJANG");
    return t === "" ? null : t;
  };
  if ("alamat" in perubahan) o.alamat = teks(perubahan.alamat, 500, "Alamat pengiriman");
  if ("kota" in perubahan) o.kota = teks(perubahan.kota, 100, "Kota");
  if ("catatan" in perubahan) o.catatan = teks(perubahan.catatan, 500, "Catatan permintaan customer");
  if ("merk" in perubahan) o.merk = teks(perubahan.merk, 100, "Merk kasur");
  if ("ukuran" in perubahan) o.ukuran = teks(perubahan.ukuran, 100, "Ukuran");
  if ("tanggalKirim" in perubahan) {
    const t = teks(perubahan.tanggalKirim, 10, "Tanggal kirim");
    if (t && !/^\d{4}-\d{2}-\d{2}$/.test(t)) throw gagal("Tanggal kirim harus berformat YYYY-MM-DD", 400, "TANGGAL_TIDAK_VALID");
    o.tanggalKirim = t;
  }
  if ("perluDikirim" in perubahan) {
    if (typeof perubahan.perluDikirim !== "boolean") throw gagal("Pilih 'Dikirim' atau 'Diambil sendiri' (kembali ke 'belum ditentukan' tidak didukung)", 400, "PERLU_DIKIRIM_TIDAK_VALID");
    o.perluDikirim = perubahan.perluDikirim;
  }
  return o;
}

/** Rencana perubahan (tanpa menulis): daftar field yang benar-benar berubah + yang terblokir. Dipakai pratinjau DAN penerapan (di bawah kunci). */
function rencanakan(ctx, masukan) {
  const { order, pkr } = ctx;
  if (!order) throw gagal(FORMAT_PENJELASAN[ctx.format], 409, ctx.format === FORMAT_PKR.DIBATALKAN ? "PKR_DIBATALKAN" : "BELUM_ADA_ORDER");
  if (ctx.format === FORMAT_PKR.DIBATALKAN) throw gagal(FORMAT_PENJELASAN.DIBATALKAN, 409, "PKR_DIBATALKAN");
  const sekarang = nilaiSekarang(order, pkr);
  const berubah = []; const blokir = [];
  for (const f of FIELD_ORDER) {
    if (!(f in masukan)) continue;
    const dari = sekarang[f]; const ke = masukan[f];
    if ((dari ?? null) === (ke ?? null)) continue;
    const st = statusField(f, ctx);
    if (!st.boleh) { blokir.push({ field: f, label: LABEL_FIELD[f], kode: f in FIELD_HANYA_LAMA && st.jalur !== "batal-catat-ulang" && st.jalur !== null && ctx.format !== FORMAT_PKR.LAMA_TANPA_ITEM ? "SPEK_PER_ITEM" : "FIELD_TERKUNCI", pesan: st.alasan, jalur: st.jalur }); continue; }
    if (f === "perluDikirim" && ke === false && ctx.jobs.some((j) => j.type === "DELIVERY")) {
      blokir.push({ field: f, label: LABEL_FIELD[f], kode: "JOB_PENGIRIMAN_ADA", pesan: "Job pengiriman sudah ada. Batalkan atau ubah lewat Delivery dulu sebelum menandai order ini diambil sendiri.", jalur: "delivery" });
      continue;
    }
    berubah.push({ field: f, label: LABEL_FIELD[f], sebelum: dari ?? null, sesudah: ke ?? null });
  }
  return { berubah, blokir, sekarang };
}

function dampakDari(ctx, rencana) {
  const { order, jobs } = ctx;
  const f = new Set(rencana.berubah.map((x) => x.field));
  const alamatLama = [order.deliveryAddress, order.deliveryCity].filter(Boolean).join(", ") || null;
  const jobBisaSinkron = jobs.filter((j) => ["UNSCHEDULED", "SCHEDULED", "ASSIGNED", "RESCHEDULED"].includes(j.status) && (!j.addressText || j.addressText === alamatLama));
  const unitTerdampak = (f.has("merk") || f.has("ukuran")) ? ctx.units.filter((u) => u.status !== "CANCELLED").length : 0;
  return {
    orderNomor: order.orderNumber,
    jobAlamatDisinkron: (f.has("alamat") || f.has("kota")) ? jobBisaSinkron.length : 0,
    unitDisinkronMerkUkuran: unitTerdampak,
    perluDikirimMenjadiYa: rencana.berubah.some((x) => x.field === "perluDikirim" && x.sesudah === true),
    tidakBerubah: ["Total/harga dan jurnal Finance", "Pembayaran dan piutang", "Jumlah unit dan kode unit", "Jadwal dan PIC Produksi", "Order dan unit lain"],
  };
}

export async function pratinjauKoreksiOrder(db, { penjualanId, perubahan, expectedRevision = null }) {
  const masukan = bacaPerubahan(perubahan);
  if (Object.keys(masukan).length === 0) throw gagal("Pilih minimal satu field untuk dikoreksi", 400, "PERUBAHAN_KOSONG");
  const ctx = await muat(db, penjualanId);
  const r = rencanakan(ctx, masukan);
  const revisiBerubah = expectedRevision !== null && expectedRevision !== undefined && Number(expectedRevision) !== ctx.revisi;
  return {
    penjualanId, nomor: ctx.pkr.nomor, format: ctx.format, formatLabel: FORMAT_LABEL[ctx.format],
    revisi: ctx.revisi, revisiBerubah,
    boleh: r.berubah.length > 0 && r.blokir.length === 0 && !revisiBerubah,
    perubahan: r.berubah, blokir: r.blokir, tanpaPerubahan: r.berubah.length === 0 && r.blokir.length === 0,
    dampak: dampakDari(ctx, r),
    syarat: { alasanMinimal: 5, idempotencyKey: true, expectedRevision: true },
  };
}

const ringkasTeks = (berubah) => berubah.map((b) => `${b.label}: ${b.sebelum ?? "—"} → ${b.sesudah ?? "—"}`).join("; ");

export async function terapkanKoreksiOrder(tx, { penjualanId, perubahan, expectedRevision, alasan, idempotencyKey, userId = null }) {
  if (!idempotencyKey || !POLA_KUNCI.test(String(idempotencyKey))) throw gagal("Header Idempotency-Key wajib (8–128 karakter) untuk koreksi data order", 428, "IDEMPOTENCY_KEY_REQUIRED");
  const teksAlasan = String(alasan ?? "").trim().replace(/\s+/g, " ");
  if (teksAlasan.length < 5) throw gagal("Alasan koreksi wajib diisi (minimal 5 karakter)", 400, "ALASAN_WAJIB");
  if (teksAlasan.length > 500) throw gagal("Alasan maksimal 500 karakter", 400, "ALASAN_TERLALU_PANJANG");
  if (expectedRevision === undefined || expectedRevision === null || !Number.isInteger(Number(expectedRevision)) || Number(expectedRevision) < 0) {
    throw gagal("Revisi yang Anda lihat (expectedRevision) wajib dikirim — buka pratinjau dampak dulu", 400, "REVISI_WAJIB");
  }
  const masukan = bacaPerubahan(perubahan);
  if (Object.keys(masukan).length === 0) throw gagal("Pilih minimal satu field untuk dikoreksi", 400, "PERUBAHAN_KOSONG");
  const hashPermintaan = hash({ penjualanId, masukan, expectedRevision: Number(expectedRevision), alasan: teksAlasan });

  // Kunci (PKR -> order), lalu cek replay di bawah kunci: dua permintaan paralel dengan kunci sama diserialkan di sini.
  const ctx = await muat(tx, penjualanId, { kunci: true });
  if (!ctx.order) throw gagal(FORMAT_PENJELASAN[ctx.format], 409, ctx.format === FORMAT_PKR.DIBATALKAN ? "PKR_DIBATALKAN" : "BELUM_ADA_ORDER");
  const ada = await tx.pkrItemRevision.findFirst({ where: { orderId: ctx.order.id, idempotencyKey: String(idempotencyKey) } });
  if (ada) {
    if (ada.impact?.hashPermintaan !== hashPermintaan) throw gagal("Idempotency-Key ini sudah dipakai untuk koreksi lain. Pakai kunci baru.", 409, "IDEMPOTENCY_KEY_DIPAKAI");
    return { replayed: true, revisi: ada.revision, nomor: ctx.pkr.nomor, orderId: ctx.order.id, perubahan: ada.impact?.perubahan ?? [], dampak: ada.impact?.dampak ?? null };
  }
  if (Number(expectedRevision) !== ctx.revisi) {
    throw gagal("Data order sudah diubah orang lain atau di layar lain. Muat ulang lalu periksa dampaknya sebelum mengirim lagi.", 409, "REVISI_BERUBAH", { revisiSaatIni: ctx.revisi, revisiDikirim: Number(expectedRevision) });
  }
  const r = rencanakan(ctx, masukan);
  if (r.blokir.length) throw gagal(`Koreksi ditolak: ${r.blokir.map((b) => `${b.label} — ${b.pesan}`).join(" | ")}`, 409, r.blokir[0].kode, { blokir: r.blokir });
  if (r.berubah.length === 0) throw gagal("Tidak ada perubahan: nilai yang dikirim sama dengan yang tersimpan", 400, "TANPA_PERUBAHAN");

  const orderId = ctx.order.id;
  const sebelum = Object.fromEntries(r.berubah.map((b) => [b.field, b.sebelum]));
  const sesudah = Object.fromEntries(r.berubah.map((b) => [b.field, b.sesudah]));
  const dampak = dampakDari(ctx, r);

  // 1. Field order lewat penulis yang SAMA dengan "Lengkapi spesifikasi" (kunci produksi, sinkron alamat ke job, kerangka job pengiriman, audit) — izinTimpa karena ini koreksi beralasan.
  const masukanOrder = {};
  // normalisasiSpesifikasi memperlakukan null sebagai "tidak diubah"; mengosongkan field = string kosong.
  for (const f of ["alamat", "kota", "tanggalKirim", "merk", "ukuran"]) if (f in sesudah) masukanOrder[f] = sesudah[f] ?? "";
  if ("perluDikirim" in sesudah) masukanOrder.perluDikirim = sesudah.perluDikirim;
  let hasilLengkapi = null;
  if (Object.keys(masukanOrder).length) {
    hasilLengkapi = await lengkapiSpesifikasi(tx, { penjualanId, userId, masukan: masukanOrder, tanpaAudit: true });
  }
  // 2. Catatan permintaan customer: header PKR + cerminan di notes order, SATU transaksi.
  if ("catatan" in sesudah) {
    const baru = sesudah.catatan;
    await tx.finPenjualanKaryawan.update({ where: { id: ctx.pkr.id }, data: { notes: baru } });
    const orderTerkini = await tx.order.findUnique({ where: { id: orderId }, select: { notes: true } });
    const info = bacaNotesOrder(orderTerkini.notes);
    const prefiks = `Penjualan Karyawan ${ctx.pkr.nomor} — penjual ${ctx.pkr.seller.name}, pembeli ${ctx.pkr.buyerName}`;
    await tx.order.update({ where: { id: orderId }, data: { notes: JSON.stringify({ ...info, catatan: `${prefiks}${baru ? `. ${baru}` : ""}` }) } });
  }

  // 3. Buku revisi (token konkurensi + jejak sebelum/sesudah) + audit.
  const rev = await tulisRevisi(tx, {
    // kind "DIKOREKSI" (CHECK DB: DIBUAT/DILENGKAPI/DIKOREKSI; alasan >= 5 karakter ikut ditegakkan DB); jenis koreksi dibedakan di impact.jenis — tanpa migrasi skema.
    orderId, penjualanId, kind: "DIKOREKSI", reason: teksAlasan, before: sebelum, after: sesudah,
    impact: { jenis: "KOREKSI_ORDER", hashPermintaan, perubahan: r.berubah, dampak: { ...dampak, jobDisinkron: hasilLengkapi?.jobDisinkron ?? 0 }, ringkas: ringkasTeks(r.berubah) },
    userId, idempotencyKey: String(idempotencyKey), expected: Number(expectedRevision),
  });
  const meta = { aksi: "order_dikoreksi", nomorPkr: ctx.pkr.nomor, penjualanId, orderId, revisi: rev.revision, alasan: teksAlasan, ringkas: ringkasTeks(r.berubah), field: r.berubah.map((b) => b.field) };
  await recordActivity(tx, { entityType: ENTITY_TYPES.FIN_PENJUALAN_KARYAWAN, entityId: penjualanId, eventType: EVENT_TYPES.PKR_ORDER_SINKRON, actorId: userId, metadata: meta });
  await recordActivity(tx, { entityType: ENTITY_TYPES.ORDER, entityId: orderId, eventType: EVENT_TYPES.PKR_ORDER_SINKRON, actorId: userId, metadata: meta });
  return { replayed: false, revisi: rev.revision, nomor: ctx.pkr.nomor, orderId, perubahan: r.berubah, dampak: { ...dampak, jobDisinkron: hasilLengkapi?.jobDisinkron ?? 0 } };
}
