// KOREKSI ORDER PENJUALAN KARYAWAN — satu pintu resmi untuk memperbaiki / menambah order PKR di semua tahap progres.
//
// Dua JENIS yang sengaja dibedakan:
//   • PERBAIKAN (salah input): data di SANSS salah, pekerjaan fisik mengikuti data yang benar. Alasan wajib, sebelum→sesudah, buku revisi append-only, tanpa Unit/Order/Job/jurnal
//     baru kecuali memang terdampak. Cakupan: customer/penerima/alamat/catatan, spesifikasi (merk, ukuran, spesifikasi), jumlah (turun, sebelum dikerjakan), harga baris (nilai).
//   • TAMBAHAN (customer menambah produk/jumlah/layanan): item + unit baru + baris Finance baru + jurnal delta. Unit lama tidak disentuh; tampil sebagai "Tambahan pesanan".
//
// Matriks progres (ditegakkan SERVER; layar hanya menampilkannya):
//   Produksi belum mulai  → spesifikasi/jumlah/kirim boleh langsung (unit yang sama diperbarui atomik).
//   Produksi berjalan     → data fisik unit yang sudah berjalan TERKUNCI (jadikan Tambahan pesanan); customer/kontak/catatan tetap boleh.
//   Produksi selesai      → spesifikasi hanya lewat PERBAIKAN ADMINISTRATIF (konfirmasi eksplisit; snapshot lama tersimpan; tidak menyentuh BOM/bahan/stok/milestone/PIC/jurnal).
//   Delivery terjadwal    → penerima/alamat/Maps/patokan/catatan memperbarui job yang SAMA (tidak ada job kedua).
//   Delivery berjalan/selesai → alamat/penerima TERKUNCI: arahkan ke Reschedule/Koreksi Delivery resmi; histori pengiriman tidak ditimpa.
// Nilai (harga) selalu lewat dokumen koreksi: total baru → jurnal penjualan dibalik + diposting ulang (delta); Payment lama tidak diubah; Order CRM tetap Rp0; kelebihan bayar
// → peringatan + arahan Koreksi Pembayaran/Refund resmi (kas tidak keluar otomatis).
//
// Order LAMA (tanpa daftar item, mis. PKR-11102026-005) dikoreksi apa adanya. Untuk jumlah/tambahan, order dicatat dulu sebagai SATU item "Pesanan awal (order lama)" (ADOPSI):
// unit yang ada hanya DITAUTKAN, tidak diubah; ini dicatat di buku revisi. Tidak ada backfill otomatis.
import { createHash } from "node:crypto";
import { PkrOrderError } from "./pkrGuard.js";
import { lockRowForUpdate } from "./inventoryLedger.js";
import { revisiTerakhir, snapshotItems, tulisRevisi } from "./pkrItemRevisi.js";
import { terapkanKoreksiPembeli } from "./penjualanKaryawanPembeliKoreksi.js";
import { terapkanKoreksiBaris } from "./penjualanKaryawanKoreksiBaris.js";
import { terapkanKoreksi, alasanUnitTerkunci } from "./penjualanKaryawanKoreksi.js";
import { lengkapiSpesifikasi } from "./penjualanKaryawanOrder.js";
import { itemDariRow, susunCerminan, ITEM_AKTIF } from "./penjualanKaryawanItem.js";
import { deskripsiUnit, perluDikirimDariItems } from "../lib/domain/pkrItem.js";
import { bacaSpesifikasiPkr, bacaNotesOrder } from "../lib/domain/pkrSpesifikasi.js";
import { toMoney, sumMoney, moneyToNumber } from "./finance/money.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../lib/activityLog.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POLA_KUNCI = /^[A-Za-z0-9_\-:.]{8,128}$/;
const gagal = (m, s = 400, c = null, e = null) => new PkrOrderError(m, s, c, e);
const hash = (v) => createHash("sha256").update(JSON.stringify(v ?? null)).digest("hex");

export const JENIS = Object.freeze({ PERBAIKAN: "PERBAIKAN", TAMBAHAN: "TAMBAHAN" });
const SELESAI_PRODUKSI = ["READY_FOR_DELIVERY", "READY_ON_CUSTOMER_HOLD", "IN_TRANSIT_OUT", "DELIVERED"];
const BELUM_MULAI = ["AWAITING_PICKUP", "RECEIVED"];
const JOB_BERJALAN = ["EN_ROUTE", "ARRIVED"];
const JOB_BISA_DISINKRON = ["UNSCHEDULED", "SCHEDULED", "ASSIGNED", "RESCHEDULED"];
const FIELD_ITEM_ADMIN = ["spesifikasi", "panjang", "lebar", "tebal", "tinggi"];
const TIDAK_DIUBAH_ADMIN = Object.freeze(["BOM / resep", "Pemakaian bahan", "Stok", "Milestone & tahap produksi", "PIC / penugasan", "Jurnal & saldo"]);
const PETUNJUK_TAMBAHAN = "Jadikan Tambah Pesanan Customer (item/unit baru) — unit yang sudah berjalan tidak ditimpa.";
const PETUNJUK_DELIVERY = "Ajukan Reschedule / Koreksi Delivery resmi di Delivery (Armada) — histori pengiriman lama tidak ditimpa.";

const INCLUDE_UNIT = {
  select: {
    id: true, unitCode: true, seq: true, status: true, currentStageId: true, serviceId: true, merk: true, ukuran: true,
    productionRunsV2: { where: { status: { not: "CANCELLED" } }, select: { id: true, status: true }, take: 1 },
    _count: { select: { stageLogs: true } },
    jobUnits: { select: { id: true, jobId: true, job: { select: { id: true, type: true, status: true } } } },
  },
};

// ── PEMBACA KEADAAN ──────────────────────────────────────────────────────────────────────────────────────────

/** Muat PKR + order + unit + item + job. `kunci` = kunci PKR → order → unit (urutan sama dengan koreksi lain; tanpa deadlock). */
async function muat(tx, penjualanId, { kunci }) {
  if (!UUID.test(String(penjualanId))) throw gagal("Penjualan karyawan tidak ditemukan", 404);
  if (kunci) await lockRowForUpdate(tx, '"fin_penjualan_karyawan"', penjualanId);
  const pkr = await tx.finPenjualanKaryawan.findUnique({
    where: { id: penjualanId },
    include: {
      seller: { select: { id: true, name: true } }, items: { orderBy: { sortOrder: "asc" } },
      payments: { where: { cancelledAt: null }, select: { amount: true } }, orderCrm: { select: { id: true, orderNumber: true } },
    },
  });
  if (!pkr) throw gagal("Penjualan karyawan tidak ditemukan", 404);
  if (pkr.status !== "AKTIF") throw gagal(`${pkr.nomor} sudah dibatalkan — tidak bisa dikoreksi`, 409, "SUDAH_DIBATALKAN");
  if (!pkr.orderCrm) throw gagal(`${pkr.nomor} belum punya order CRM — buat dulu`, 409, "BELUM_ADA_ORDER");
  if (kunci) {
    await tx.$queryRawUnsafe('SELECT id FROM "Order" WHERE id = $1 FOR UPDATE', pkr.orderCrm.id);
    await tx.$queryRawUnsafe('SELECT id FROM units WHERE order_id = $1 ORDER BY id FOR UPDATE', pkr.orderCrm.id);
  }
  const order = await tx.order.findUnique({ where: { id: pkr.orderCrm.id } });
  if (!order || order.status === "CANCELLED") throw gagal("Order CRM sudah dibatalkan — tidak bisa dikoreksi", 409, "ORDER_DIBATALKAN");
  const units = await tx.unit.findMany({ where: { orderId: order.id }, orderBy: { seq: "asc" }, ...INCLUDE_UNIT });
  const rows = await tx.pkrOrderItem.findMany({ where: { orderId: order.id }, orderBy: { seq: "asc" }, include: { units: { select: { unitId: true } } } });
  const jobs = await tx.job.findMany({ where: { orderId: order.id, type: "DELIVERY" }, select: { id: true, status: true, scheduledDate: true } });
  return { pkr, order, units, rows, jobs };
}

const unitMulai = (u) => u.currentStageId != null || (u._count?.stageLogs ?? 0) > 0 || (u.productionRunsV2?.length ?? 0) > 0 || !BELUM_MULAI.includes(u.status);

/** Profil progres: tahap Produksi, tahap Delivery, dan unit yang terkunci beserta alasannya. */
export function profilProgres(units, jobs) {
  const aktif = units.filter((u) => u.status !== "CANCELLED");
  const selesai = aktif.length > 0 && aktif.every((u) => SELESAI_PRODUKSI.includes(u.status));
  const tahapProduksi = selesai ? "SELESAI" : aktif.some(unitMulai) ? "BERJALAN" : "BELUM_MULAI";
  let tahapDelivery = "BELUM_ADA";
  if (jobs.some((j) => j.status === "COMPLETED")) tahapDelivery = "SELESAI";
  else if (jobs.some((j) => JOB_BERJALAN.includes(j.status))) tahapDelivery = "BERJALAN";
  else if (jobs.some((j) => JOB_BISA_DISINKRON.includes(j.status))) tahapDelivery = jobs.some((j) => j.status !== "UNSCHEDULED") ? "TERJADWAL" : "BELUM_DIJADWALKAN";
  const terkunci = aktif.map((u) => ({ kode: u.unitCode, status: u.status, alasan: alasanUnitTerkunci(u), mulai: unitMulai(u) })).filter((u) => u.alasan);
  return { tahapProduksi, tahapDelivery, unitAktif: aktif.length, unitTerkunci: terkunci };
}

/** Matriks kemampuan: per kelompok field → mode (LANGSUNG | ADMINISTRATIF | KOREKSI_NILAI | TERKUNCI | TAMBAHAN), alasan, dan tindakan yang benar. */
export function matriksKemampuan(profil, { legacy, terpadu }) {
  const { tahapProduksi: tp, tahapDelivery: td } = profil;
  const deliveryTerkunci = td === "BERJALAN" || td === "SELESAI";
  const kel = [];
  kel.push({ kode: "customer", label: "Customer & kontak", mode: "LANGSUNG", boleh: true, alasan: null, tindakan: null });
  kel.push({
    kode: "alamat", label: "Alamat, Maps, patokan & penerima", mode: deliveryTerkunci ? "TERKUNCI" : "LANGSUNG", boleh: !deliveryTerkunci,
    alasan: td === "BERJALAN" ? "Pengiriman sedang berjalan — alamat/penerima tidak boleh ditimpa langsung." : td === "SELESAI" ? "Pengiriman sudah selesai — data penerima/alamat historis tidak ditimpa." : td === "TERJADWAL" ? "Job pengiriman terjadwal akan diperbarui (job yang sama, bukan job baru)." : null,
    tindakan: deliveryTerkunci ? { kode: "KOREKSI_DELIVERY", label: "Reschedule / Koreksi Delivery", petunjuk: PETUNJUK_DELIVERY } : null,
  });
  kel.push({ kode: "catatan", label: "Keluhan & catatan (umum, Produksi, Delivery)", mode: "LANGSUNG", boleh: true, alasan: null, tindakan: null });
  const spesifikasi = tp === "BELUM_MULAI"
    ? { mode: "LANGSUNG", boleh: true, alasan: "Produksi belum mulai — unit yang sama diperbarui atomik.", tindakan: null }
    : tp === "BERJALAN"
      ? { mode: "TERKUNCI", boleh: false, alasan: "Produksi sedang berjalan — data fisik unit yang sudah dikerjakan tidak ditimpa.", tindakan: { kode: "TAMBAHAN", label: "Tambah Pesanan Customer", petunjuk: PETUNJUK_TAMBAHAN } }
      : { mode: "ADMINISTRATIF", boleh: true, alasan: "Produksi selesai — hanya perbaikan data administratif (snapshot lama tersimpan; BOM/bahan/stok/milestone/jurnal tidak berubah).", tindakan: null };
  kel.push({ kode: "spesifikasi", label: "Merk, ukuran & spesifikasi", ...spesifikasi });
  kel.push({
    kode: "jumlah", label: "Jumlah, produk & kategori", mode: tp === "BELUM_MULAI" ? "LANGSUNG" : "TERKUNCI", boleh: tp === "BELUM_MULAI",
    alasan: tp === "BELUM_MULAI" ? (terpadu ? "Gunakan Koreksi Item & Pemenuhan (harga dan unit berubah bersama)." : "Jumlah boleh diturunkan sebelum dikerjakan; menaikkan = tambahan pesanan.") : "Unit sudah berjalan/selesai — jumlah dan produk tidak diubah diam-diam.",
    tindakan: tp === "BELUM_MULAI" ? null : { kode: "TAMBAHAN", label: "Tambah Pesanan Customer", petunjuk: PETUNJUK_TAMBAHAN },
  });
  kel.push({
    kode: "nilai", label: "Harga dan nilai", mode: "KOREKSI_NILAI", boleh: true,
    alasan: "Nilai diubah lewat dokumen koreksi: jurnal penjualan dibalik lalu diposting ulang (delta). Payment lama tidak diubah; Order CRM tetap Rp0.",
    tindakan: null,
  });
  kel.push({ kode: "tambahan", label: "Tambahan pesanan", mode: "TAMBAHAN", boleh: true, alasan: "Item/unit baru + nilai delta; unit lama tidak disentuh.", tindakan: null });
  return kel;
}

/** Keadaan lengkap untuk layar Koreksi Order (baca-saja). */
export async function kemampuanKoreksiOrder(db, penjualanId) {
  const { pkr, order, units, rows, jobs } = await muat(db, penjualanId, { kunci: false });
  const profil = profilProgres(units, jobs);
  const aktifRows = rows.filter((r) => !r.removedAt);
  const legacy = rows.length === 0;
  const terpadu = pkr.items.some((i) => i.fulfillment != null);
  const terbayar = pkr.payments.length ? sumMoney(pkr.payments.map((p) => p.amount)) : toMoney(0);
  const spek = bacaSpesifikasiPkr(order);
  const revisi = await revisiTerakhir(db, order.id);
  const tambahan = await db.pkrItemRevision.findMany({ where: { orderId: order.id, kind: "TAMBAHAN" }, orderBy: { revision: "asc" }, select: { revision: true, createdAt: true, impact: true } });
  const noTambahan = new Set(tambahan.flatMap((t) => (t.impact?.item?.ditambah ?? []).map((i) => i.no)));
  return {
    nomor: pkr.nomor, orderId: order.id, orderNumber: order.orderNumber, revisi, legacy, terpadu,
    progres: { tahapProduksi: profil.tahapProduksi, tahapDelivery: profil.tahapDelivery, unitAktif: profil.unitAktif, unitTerkunci: profil.unitTerkunci },
    matriks: matriksKemampuan(profil, { legacy, terpadu }),
    spesifikasi: { merk: spek.merk ?? null, ukuran: spek.ukuran ?? null, perluDikirim: order.pkrPerluDikirim ?? null },
    unit: units.filter((u) => u.status !== "CANCELLED").map((u) => ({ kode: u.unitCode, status: u.status, merk: u.merk, ukuran: u.ukuran, terkunci: Boolean(alasanUnitTerkunci(u)), alasan: alasanUnitTerkunci(u), mulai: unitMulai(u) })),
    item: aktifRows.map((r) => ({
      no: r.seq, kategori: r.categoryName, produk: r.productName, jumlah: r.qty, panjang: r.lengthCm == null ? null : Number(r.lengthCm), lebar: r.widthCm == null ? null : Number(r.widthCm),
      tebal: r.thicknessCm == null ? null : Number(r.thicknessCm), tinggi: r.heightCm == null ? null : Number(r.heightCm), spesifikasi: r.specNotes, perluDikirim: r.perluDikirim,
      tambahan: noTambahan.has(r.seq), pesananAwalLama: r.categoryCode === "CUSTOM_LAINNYA" && /^Pesanan awal/.test(r.categoryName),
    })),
    keuangan: {
      total: moneyToNumber(toMoney(pkr.total)), terbayar: moneyToNumber(terbayar), sisa: moneyToNumber(toMoney(pkr.total).minus(terbayar)),
      baris: pkr.items.map((i) => ({ no: i.sortOrder + 1, nama: i.name, jumlah: Number(i.quantity), harga: moneyToNumber(toMoney(i.unitPrice)), bisaKoreksiHarga: true, lama: i.fulfillment == null })),
    },
  };
}

// ── PEMBACA MASUKAN ──────────────────────────────────────────────────────────────────────────────────────────

function angkaCmOpsional(v, nama) {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  if (!Number.isFinite(n) || n <= 0 || n > 1000) throw gagal(`${nama} harus berupa angka dalam cm (lebih dari 0)`, 400, "ANGKA_TIDAK_VALID");
  return Math.round(n * 10) / 10;
}

/** Bacaan masukan (tanpa DB). Mengembalikan struktur baku; melempar PkrOrderError bila tidak masuk akal. */
export function bacaMasukanOrder(masukan) {
  const m = masukan && typeof masukan === "object" && !Array.isArray(masukan) ? masukan : {};
  const jenis = m.jenis;
  if (!Object.values(JENIS).includes(jenis)) throw gagal("Pilih jenis koreksi: Perbaikan salah input atau Tambahan permintaan customer", 400, "JENIS_WAJIB");
  const hasil = { jenis, pembeli: null, pemenuhan: null, spesifikasi: null, jumlah: null, nilai: null, tambahan: null, konfirmasiAdministratif: m.konfirmasiAdministratif === true };
  if (jenis === JENIS.TAMBAHAN) {
    if (!Array.isArray(m.tambahan) || m.tambahan.length === 0) throw gagal("Isi minimal satu item tambahan", 400, "TAMBAHAN_KOSONG");
    if (m.tambahan.length > 30) throw gagal("Maksimal 30 item tambahan per koreksi", 400, "TAMBAHAN_TERLALU_BANYAK");
    hasil.tambahan = m.tambahan;
    return hasil;
  }
  if (m.pembeli && typeof m.pembeli === "object") hasil.pembeli = m.pembeli;
  if (m.pemenuhan && typeof m.pemenuhan === "object" && Object.keys(m.pemenuhan).length) hasil.pemenuhan = m.pemenuhan;
  const s = m.spesifikasi;
  if (s && typeof s === "object" && !Array.isArray(s)) {
    const spek = {};
    for (const k of ["merk", "ukuran"]) if (s[k] !== undefined) spek[k] = s[k] === null ? null : String(s[k]).trim().slice(0, 160) || null;
    if (s.perluDikirim !== undefined) { if (typeof s.perluDikirim !== "boolean") throw gagal("Pilihan dikirim/diambil harus ya atau tidak", 400, "PERLU_DIKIRIM_TIDAK_VALID"); spek.perluDikirim = s.perluDikirim; }
    if (Array.isArray(s.item)) {
      spek.item = s.item.map((it, i) => {
        if (!it || typeof it !== "object" || !Number.isInteger(Number(it.no))) throw gagal(`Perubahan item ${i + 1}: nomor item wajib`, 400, "OPERASI_TIDAK_VALID");
        const o = { no: Number(it.no) };
        for (const f of FIELD_ITEM_ADMIN) {
          if (it[f] === undefined) continue;
          o[f] = f === "spesifikasi" ? (it[f] === null ? null : String(it[f]).trim().slice(0, 1000) || null) : angkaCmOpsional(it[f], f[0].toUpperCase() + f.slice(1));
        }
        if (Object.keys(o).length < 2) throw gagal(`Perubahan item ${o.no}: tidak ada isian yang diubah`, 400, "OPERASI_TIDAK_VALID");
        return o;
      });
    }
    if (Object.keys(spek).length) hasil.spesifikasi = spek;
  }
  if (m.jumlah !== undefined && m.jumlah !== null) {
    const n = Number(m.jumlah);
    if (!Number.isInteger(n) || n < 1 || n > 200) throw gagal("Jumlah unit harus bilangan bulat 1–200", 400, "JUMLAH_TIDAK_VALID");
    hasil.jumlah = n;
  }
  if (Array.isArray(m.nilai) && m.nilai.length) {
    hasil.nilai = m.nilai.map((n, i) => {
      if (!n || typeof n !== "object" || !Number.isInteger(Number(n.no))) throw gagal(`Perubahan nilai ${i + 1}: nomor baris wajib`, 400, "OPERASI_TIDAK_VALID");
      if (n.harga === undefined || n.harga === null || n.harga === "") throw gagal(`Baris ${n.no}: harga baru wajib`, 400, "HARGA_JUMLAH_TIDAK_VALID");
      return { op: "ubah", no: Number(n.no), harga: n.harga };
    });
  }
  if (!hasil.pembeli && !hasil.pemenuhan && !hasil.spesifikasi && hasil.jumlah === null && !hasil.nilai) throw gagal("Tidak ada perubahan yang dikirim", 400, "TANPA_PERUBAHAN");
  return hasil;
}

// ── PENULIS BAGIAN ───────────────────────────────────────────────────────────────────────────────────────────

const snapUnit = (units) => units.filter((u) => u.status !== "CANCELLED").map((u) => ({ unit: u.unitCode, merk: u.merk ?? null, ukuran: u.ukuran ?? null }));

/**
 * ADOPSI order lama: catat unit aktif sebagai SATU item "Pesanan awal (order lama)". Unit hanya ditautkan (tidak diubah). Idempoten oleh pemanggil (hanya bila belum ada item).
 * Kategori bentuk CUSTOM supaya tidak memunculkan "kurang ukuran/tebal" palsu pada order yang sudah jadi; ukuran asli tetap di label unit dan spesifikasi item.
 */
async function adopsiOrderLama(tx, { pkr, order, units, userId, alasan, key, expected }) {
  const ada = await tx.pkrItemRevision.findFirst({ where: { orderId: order.id, idempotencyKey: `${key}:adopsi` } });
  if (ada) return { revisi: ada.revision, unit: ada.impact?.adopsi?.unit ?? [], replayed: true };
  const aktif = units.filter((u) => u.status !== "CANCELLED");
  if (aktif.length === 0) throw gagal("Order ini tidak punya unit aktif — tidak ada yang bisa dicatat sebagai pesanan awal", 409, "TANPA_UNIT");
  const kat = await tx.pkrItemCategory.findUnique({ where: { code: "CUSTOM_LAINNYA" } });
  if (!kat) throw gagal('Katalog "Produk Custom Lainnya" tidak tersedia — hubungi Admin katalog PKR.', 409, "KATALOG_TIDAK_ADA");
  const spek = bacaSpesifikasiPkr(order);
  const lanyan = order.category === "LAYANAN";
  const baris = await tx.pkrOrderItem.create({
    data: {
      penjualanId: pkr.id, orderId: order.id, seq: 1, categoryId: kat.id, categoryCode: kat.code, categoryName: "Pesanan awal (order lama)", shape: "CUSTOM",
      workKind: lanyan ? "LAYANAN" : "BARU", productName: (spek.merk ?? null) ? String(spek.merk).slice(0, 160) : null, qty: aktif.length,
      specNotes: `Pesanan awal (order lama)${spek.ukuran ? ` · ukuran ${spek.ukuran}` : ""}`.slice(0, 1000), perluDikirim: order.pkrPerluDikirim ?? null,
    },
  });
  await tx.pkrOrderItemUnit.createMany({ data: aktif.map((u) => ({ itemId: baris.id, unitId: u.id })) });
  const sesudah = await snapshotItems(tx, order.id);
  const rev = await tulisRevisi(tx, {
    orderId: order.id, penjualanId: pkr.id, kind: "ADOPSI", reason: alasan, before: [], after: sesudah,
    impact: { hashPermintaan: hash({ adopsi: order.id }), adopsi: { unit: aktif.map((u) => u.unitCode), jumlah: aktif.length }, tidakDiubah: ["Unit", "Produksi", "Delivery", "Jurnal"] },
    userId, idempotencyKey: `${key}:adopsi`, expected,
  });
  return { revisi: rev.revision, unit: aktif.map((u) => u.unitCode) };
}

/** Perbaikan SPESIFIKASI (order lama: merk/ukuran/dikirim; order berdaftar item: spesifikasi + ukuran per item). Administratif bila Produksi selesai. */
async function terapkanSpesifikasi(tx, ctx, spek, { konfirmasi, alasan, key, userId }) {
  const { pkr, order, rows, profil } = ctx;
  const tp = profil.tahapProduksi;
  const hashBagian = hash({ spek, konfirmasi, order: order.id, alasan });
  const ada = await tx.pkrItemRevision.findFirst({ where: { orderId: order.id, idempotencyKey: `${key}:spesifikasi` } });
  if (ada) {
    if (ada.impact?.hashPermintaan !== hashBagian) throw gagal("Idempotency-Key ini sudah dipakai untuk koreksi lain. Pakai kunci baru.", 409, "IDEMPOTENCY_KEY_DIPAKAI");
    return { revisi: ada.revision, jenis: "spesifikasi", mode: ada.impact?.mode ?? null, perubahan: ada.impact?.perubahan ?? [], replayed: true };
  }
  const revSekarang = await revisiTerakhir(tx, order.id);
  const aktifRows = rows.filter((r) => !r.removedAt);
  const unitsSebelum = snapUnit(ctx.units);

  if (rows.length === 0) {
    // ORDER LAMA
    if (spek.item) throw gagal("Order ini order lama (tanpa daftar item): ubah merk, ukuran, dan dikirim/diambil di tingkat order.", 409, "ORDER_TANPA_ITEM");
    if (tp === "BERJALAN") {
      throw gagal("Produksi sedang berjalan — data fisik unit tidak ditimpa. Jadikan tambahan pesanan, atau tunggu produksi selesai untuk perbaikan administratif.", 409, "SPEK_TERKUNCI_PRODUKSI", { petunjuk: PETUNJUK_TAMBAHAN });
    }
    const administratif = tp === "SELESAI";
    if (administratif && !konfirmasi) {
      throw gagal("Produksi sudah selesai: perubahan ini perbaikan data ADMINISTRATIF. Centang konfirmasi bahwa data lama memang salah dan pekerjaan fisik mengikuti data yang benar.", 409, "KONFIRMASI_ADMINISTRATIF_WAJIB");
    }
    const masukan = {};
    for (const k of ["merk", "ukuran", "perluDikirim"]) if (spek[k] !== undefined) masukan[k] = spek[k];
    const hasil = await lengkapiSpesifikasi(tx, { penjualanId: pkr.id, userId, masukan, izinSetelahProduksi: administratif });
    const unitsSesudah = snapUnit(await tx.unit.findMany({ where: { orderId: order.id }, orderBy: { seq: "asc" }, select: { unitCode: true, status: true, merk: true, ukuran: true } }));
    const rev = await tulisRevisi(tx, {
      orderId: order.id, penjualanId: pkr.id, kind: "ORDER_ADMIN", reason: alasan, before: unitsSebelum, after: unitsSesudah,
      impact: {
        hashPermintaan: hashBagian, perubahan: hasil.perubahan, mode: administratif ? "ADMINISTRATIF_SETELAH_PRODUKSI" : "LANGSUNG",
        ...(administratif && { tidakDiubah: TIDAK_DIUBAH_ADMIN, snapshotSebelum: { unit: unitsSebelum, spesifikasi: ctx.spekSebelum } }),
      },
      userId, idempotencyKey: `${key}:spesifikasi`, expected: revSekarang,
    });
    return { revisi: rev.revision, jenis: "spesifikasi", mode: administratif ? "ADMINISTRATIF" : "LANGSUNG", perubahan: hasil.perubahan };
  }

  // ORDER BERDAFTAR ITEM: spesifikasi + ukuran per item
  if (spek.merk !== undefined || spek.ukuran !== undefined || spek.perluDikirim !== undefined) {
    throw gagal("Order ini memakai daftar item: ubah spesifikasi per item. Pilihan dikirim/diambil lewat Koreksi Item & Pemenuhan.", 400, "SPEK_PER_ITEM");
  }
  if (!spek.item?.length) throw gagal("Tidak ada perubahan item yang dikirim", 400, "TANPA_PERUBAHAN");
  const perubahan = [];
  const sebelum = await snapshotItems(tx, order.id);
  const unitById = new Map(ctx.units.map((u) => [u.id, u]));
  for (const op of spek.item) {
    const row = aktifRows.find((r) => r.seq === op.no);
    if (!row) throw gagal(`Item ${op.no} tidak ditemukan atau sudah dihapus`, 404, "ITEM_TIDAK_ADA");
    const unitItem = row.units.map((x) => unitById.get(x.unitId)).filter((u) => u && u.status !== "CANCELLED");
    const mulai = unitItem.some(unitMulai);
    const selesai = unitItem.length > 0 && unitItem.every((u) => SELESAI_PRODUKSI.includes(u.status));
    if (mulai && !selesai) {
      throw gagal(`Item ${op.no}: unit sedang diproduksi — data fisik tidak ditimpa. ${PETUNJUK_TAMBAHAN}`, 409, "ITEM_TERKUNCI", { petunjuk: PETUNJUK_TAMBAHAN });
    }
    if (selesai && !konfirmasi) {
      throw gagal(`Item ${op.no}: produksi sudah selesai — ini perbaikan data ADMINISTRATIF. Centang konfirmasi bahwa data lama memang salah.`, 409, "KONFIRMASI_ADMINISTRATIF_WAJIB");
    }
    const data = {}; const beda = {};
    const peta = { spesifikasi: ["specNotes", row.specNotes], panjang: ["lengthCm", row.lengthCm == null ? null : Number(row.lengthCm)], lebar: ["widthCm", row.widthCm == null ? null : Number(row.widthCm)],
      tebal: ["thicknessCm", row.thicknessCm == null ? null : Number(row.thicknessCm)], tinggi: ["heightCm", row.heightCm == null ? null : Number(row.heightCm)] };
    for (const f of FIELD_ITEM_ADMIN) {
      if (op[f] === undefined) continue;
      const [kolom, lama] = peta[f];
      if ((lama ?? null) !== (op[f] ?? null)) { data[kolom] = op[f]; beda[f] = { sebelum: lama ?? null, sesudah: op[f] ?? null }; }
    }
    if (!Object.keys(data).length) continue;
    if (row.shape === "CUSTOM" && "specNotes" in data && !String(data.specNotes ?? "").trim()) throw gagal(`Item ${op.no}: spesifikasi produk custom wajib diisi`, 400, "SPEK_WAJIB");
    const lamaDomain = itemDariRow(row);
    const baru = await tx.pkrOrderItem.update({ where: { id: row.id }, data });
    const dLama = deskripsiUnit(lamaDomain); const dBaru = deskripsiUnit(itemDariRow(baru));
    const idUnit = unitItem.map((u) => u.id);
    if (idUnit.length && dLama.ukuran !== dBaru.ukuran) {
      await tx.unit.updateMany({ where: { id: { in: idUnit }, OR: [{ ukuran: null }, { ukuran: dLama.ukuran ?? "" }] }, data: { ukuran: dBaru.ukuran } });
    }
    // Cerminan ke baris penjualan (spesifikasi/ukuran saja; nama/jumlah/harga tidak disentuh). Komponen Set tidak memiliki baris penjualan sendiri.
    if (row.saleItemId && row.bundleNo == null) {
      const f = {};
      if ("specNotes" in data) f.specNotes = data.specNotes;
      if ("lengthCm" in data) f.lengthCm = data.lengthCm; if ("widthCm" in data) f.widthCm = data.widthCm;
      if ("thicknessCm" in data) f.thicknessCm = data.thicknessCm; if ("heightCm" in data) f.heightCm = data.heightCm;
      if (Object.keys(f).length) await tx.finPenjualanKaryawanItem.update({ where: { id: row.saleItemId }, data: f });
    }
    perubahan.push({ no: op.no, produk: row.productName || row.categoryName, perubahan: beda, mode: selesai ? "ADMINISTRATIF" : "LANGSUNG" });
  }
  if (!perubahan.length) throw gagal("Tidak ada perubahan yang dikirim", 400, "TANPA_PERUBAHAN");
  const aktifSesudah = (await tx.pkrOrderItem.findMany({ where: { orderId: order.id, ...ITEM_AKTIF }, orderBy: { seq: "asc" } })).map(itemDariRow);
  const info = bacaNotesOrder(order.notes);
  await tx.order.update({ where: { id: order.id }, data: { notes: JSON.stringify({ ...info, pkrItems: susunCerminan(aktifSesudah) }), pkrPerluDikirim: perluDikirimDariItems(aktifSesudah) } });
  const sesudah = await snapshotItems(tx, order.id);
  const administratif = perubahan.some((p) => p.mode === "ADMINISTRATIF");
  const rev = await tulisRevisi(tx, {
    orderId: order.id, penjualanId: pkr.id, kind: "ORDER_ADMIN", reason: alasan, before: sebelum, after: sesudah,
    impact: { hashPermintaan: hashBagian, perubahan, mode: administratif ? "ADMINISTRATIF_SETELAH_PRODUKSI" : "LANGSUNG", ...(administratif && { tidakDiubah: TIDAK_DIUBAH_ADMIN }) },
    userId, idempotencyKey: `${key}:spesifikasi`, expected: revSekarang,
  });
  return { revisi: rev.revision, jenis: "spesifikasi", mode: administratif ? "ADMINISTRATIF" : "LANGSUNG", perubahan };
}

// ── ORKESTRATOR ──────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Terapkan Koreksi Order. Dipanggil di DALAM transaksi pemanggil (atomik); dipakai juga oleh pratinjau (dijalankan lalu DIBATALKAN) sehingga pratinjau memakai fungsi hitung yang SAMA.
 * @returns {{ replayed:boolean, revisi:number, nomor:string, orderId:string, bagian:object[], customerIds:string[] }}
 */
export async function terapkanKoreksiOrder(tx, { penjualanId, masukan, expectedRevision, alasan, idempotencyKey, userId = null }) {
  if (!idempotencyKey || !POLA_KUNCI.test(String(idempotencyKey))) throw gagal("Header Idempotency-Key wajib (8–128 karakter) untuk Koreksi Order", 428, "IDEMPOTENCY_KEY_REQUIRED");
  const teksAlasan = String(alasan ?? "").trim().replace(/\s+/g, " ");
  if (teksAlasan.length < 5) throw gagal("Alasan koreksi wajib diisi (minimal 5 karakter)", 400, "ALASAN_WAJIB");
  if (teksAlasan.length > 500) throw gagal("Alasan maksimal 500 karakter", 400, "ALASAN_TERLALU_PANJANG");
  if (expectedRevision === undefined || expectedRevision === null || !Number.isInteger(Number(expectedRevision)) || Number(expectedRevision) < 0) {
    throw gagal("Revisi yang Anda lihat (expectedRevision) wajib dikirim — buka pratinjau dampak dulu", 400, "REVISI_WAJIB");
  }
  const m = bacaMasukanOrder(masukan);
  const key = String(idempotencyKey);
  const hashRoot = hash({ penjualanId, masukan: m, alasan: teksAlasan });

  const ctx = await muat(tx, penjualanId, { kunci: true });
  const { pkr, order } = ctx;
  ctx.profil = profilProgres(ctx.units, ctx.jobs);
  ctx.spekSebelum = bacaSpesifikasiPkr(order);

  // Replay: bagian yang sudah ditulis dengan kunci turunan yang sama diperiksa hash-nya oleh penulis masing-masing (replay bila sama, 409 bila beda). Atomik: semuanya ada atau tidak ada.
  const prior = await tx.pkrItemRevision.count({ where: { orderId: order.id, idempotencyKey: { startsWith: `${key}:` } } });
  const sekarang = await revisiTerakhir(tx, order.id);
  if (prior === 0 && sekarang !== Number(expectedRevision)) {
    throw gagal("Order ini sudah diubah orang lain atau di layar lain. Muat ulang lalu periksa dampaknya sebelum mengirim lagi.", 409, "REVISI_BERUBAH", { revisiSaatIni: sekarang, revisiDikirim: Number(expectedRevision) });
  }

  const bagian = []; const customerIds = [];
  const rev = () => revisiTerakhir(tx, order.id);

  if (m.jenis === JENIS.TAMBAHAN) {
    if (ctx.rows.length === 0) await adopsiOrderLama(tx, { pkr, order, units: ctx.units, userId, alasan: teksAlasan, key, expected: await rev() }).then((a) => bagian.push({ jenis: "ADOPSI", ...a }));
    const hasil = await terapkanKoreksiBaris(tx, {
      penjualanId, operasi: m.tambahan.map((item) => ({ op: "tambah", item })), expectedRevision: await rev(), alasan: teksAlasan, idempotencyKey: `${key}:tambahan`, userId, kind: "TAMBAHAN",
    });
    bagian.push({ jenis: "TAMBAHAN", revisi: hasil.revisi, dampak: hasil.dampak ?? null, keuangan: hasil.keuangan ?? null });
  } else {
    if (m.pembeli || m.pemenuhan) {
      const h = await terapkanKoreksiPembeli(tx, {
        penjualanId, masukan: { ...(m.pembeli && { pembeli: m.pembeli }), ...(m.pemenuhan && { pemenuhan: m.pemenuhan }) }, expectedRevision: await rev(), alasan: teksAlasan,
        idempotencyKey: `${key}:pembeli`, userId,
      });
      customerIds.push(...(h.customerIds ?? []));
      bagian.push({ jenis: "PEMBELI", revisi: h.revisi, perubahan: h.perubahan, dampak: h.dampak, peringatan: h.peringatan });
    }
    if (m.spesifikasi) {
      bagian.push(await terapkanSpesifikasi(tx, ctx, m.spesifikasi, { konfirmasi: m.konfirmasiAdministratif, alasan: teksAlasan, key, userId }));
    }
    if (m.jumlah !== null) {
      if (ctx.rows.length > 0 && ctx.pkr.items.some((i) => i.fulfillment != null)) {
        throw gagal("Penjualan ini memakai daftar item terpadu: ubah jumlah lewat Koreksi Item & Pemenuhan (harga dan unit berubah bersama).", 409, "KOREKSI_PAKAI_BARIS");
      }
      if (ctx.profil.tahapProduksi !== "BELUM_MULAI" || ctx.profil.unitTerkunci.length) {
        throw gagal("Unit sudah dijadwalkan/berjalan/selesai — jumlah tidak diubah diam-diam. Jadikan tambahan pesanan (naik) atau ajukan pembatalan resmi (turun).", 409, "JUMLAH_TERKUNCI", { petunjuk: PETUNJUK_TAMBAHAN });
      }
      const aktifUnit = ctx.units.filter((u) => u.status !== "CANCELLED").length;
      if (m.jumlah > aktifUnit) throw gagal("Menaikkan jumlah = tambahan pesanan. Gunakan Tambah Pesanan Customer (unit lama tidak diubah).", 409, "JUMLAH_NAIK_TAMBAHAN", { petunjuk: PETUNJUK_TAMBAHAN });
      if (m.jumlah === aktifUnit) throw gagal("Jumlah sama dengan yang sekarang", 400, "TANPA_PERUBAHAN");
      if (ctx.rows.length === 0) await adopsiOrderLama(tx, { pkr, order, units: ctx.units, userId, alasan: teksAlasan, key, expected: await rev() }).then((a) => bagian.push({ jenis: "ADOPSI", ...a }));
      const h = await terapkanKoreksi(tx, {
        penjualanId, operasi: [{ op: "ubah", no: 1, jumlah: m.jumlah }], expectedRevision: await rev(), alasan: teksAlasan, idempotencyKey: `${key}:jumlah`, userId,
      });
      bagian.push({ jenis: "JUMLAH", revisi: h.revisi, dampak: h.dampak });
    }
    if (m.nilai) {
      const h = await terapkanKoreksiBaris(tx, { penjualanId, operasi: m.nilai, expectedRevision: await rev(), alasan: teksAlasan, idempotencyKey: `${key}:nilai`, userId });
      bagian.push({ jenis: "NILAI", revisi: h.revisi, keuangan: h.keuangan ?? null });
    }
  }

  // Penanda akar permintaan pada bagian pertama? Buku revisi append-only: hash akar dicatat di audit aktivitas, replay memakai kunci turunan + hash tiap bagian.
  await recordActivity(tx, {
    entityType: ENTITY_TYPES.FIN_PENJUALAN_KARYAWAN, entityId: pkr.id, eventType: EVENT_TYPES.PKR_ORDER_SINKRON, actorId: userId,
    metadata: { aksi: "koreksi_order", jenis: m.jenis, nomorPkr: pkr.nomor, orderId: order.id, alasan: teksAlasan, bagian: bagian.map((b) => ({ jenis: b.jenis, revisi: b.revisi })), hashRoot },
  });
  return { replayed: prior > 0, revisi: await rev(), nomor: pkr.nomor, orderId: order.id, bagian, customerIds };
}

class BatalkanPratinjau extends Error {}

/** Pratinjau = terapkan di DALAM transaksi lalu DIBATALKAN (fungsi hitung yang sama; tidak ada yang tersimpan). Kesalahan aturan dikembalikan sebagai { valid:false, galat }. */
export async function pratinjauKoreksiOrder(db, { penjualanId, masukan, expectedRevision, alasan, userId = null }) {
  try {
    const hasil = await db.$transaction(async (tx) => {
      let ekspektasi = expectedRevision;
      if (ekspektasi === undefined || ekspektasi === null) {
        const p = await tx.finPenjualanKaryawan.findUnique({ where: { id: penjualanId }, select: { orderCrm: { select: { id: true } } } });
        ekspektasi = p?.orderCrm ? await revisiTerakhir(tx, p.orderCrm.id) : 0;
      }
      const r = await terapkanKoreksiOrder(tx, {
        penjualanId, masukan, expectedRevision: ekspektasi, alasan: String(alasan ?? "").trim().length >= 5 ? alasan : "Pratinjau dampak koreksi",
        idempotencyKey: `pratinjau-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`, userId,
      });
      throw Object.assign(new BatalkanPratinjau(), { hasil: r });
    }, { timeout: 30000, maxWait: 10000 });
    return hasil;
  } catch (e) {
    if (e instanceof BatalkanPratinjau) return { valid: true, ...ringkasHasil(e.hasil) };
    if (e instanceof PkrOrderError) return { valid: false, galat: { pesan: e.message, kode: e.code ?? null, status: e.statusCode ?? 400, ...(e.extra ?? {}) } };
    throw e;
  }
}

function ringkasHasil(h) {
  return {
    nomor: h.nomor, orderId: h.orderId,
    bagian: h.bagian.map((b) => ({ jenis: b.jenis, perubahan: b.perubahan ?? null, mode: b.mode ?? null, dampak: b.dampak ?? null, keuangan: b.keuangan ?? null, peringatan: b.peringatan ?? null, unit: b.unit ?? null })),
  };
}
