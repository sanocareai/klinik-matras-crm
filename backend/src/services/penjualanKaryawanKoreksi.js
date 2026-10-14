// KOREKSI ITEM PKR — tambah/hapus item, ubah jumlah, ukuran, spesifikasi, dan dikirim/diambil, SEBELUM unit dijadwalkan/diproses.
//
// Aturan (keputusan Owner):
//   • Alasan WAJIB (minimal 5 karakter), pratinjau dampak (fungsi hitung yang SAMA dengan penerapan), audit sebelum/sesudah, revisi optimistis (expectedRevision),
//     Idempotency-Key WAJIB, dan semua perubahan dalam SATU transaksi atomik (gagal di mana pun = tidak ada yang berubah).
//   • Dihitung PER ITEM: item yang unitnya sudah dijadwalkan/dibuka di Produksi/diambil/masuk job yang berjalan TERKUNCI. Mengoreksinya DIBLOKIR dengan arahan pembatalan resmi
//     (batalkan Penjualan Karyawan lewat pembatalan resmi lalu catat ulang) — tidak ada jalur diam-diam yang mengubah unit yang sedang dikerjakan.
//   • Tidak ada uang: tidak membuat/mengubah Payment, invoice, pendapatan, jurnal, atau OrderItem. Nominal tetap di PKR.
//   • Item tidak pernah dihapus fisik: dihapus lunak (removed_at + alasan); unitnya dibatalkan (CANCELLED) lewat jalur baku; nomor item tidak dipakai ulang.
//
// Dua tahap dengan fungsi hitung yang sama: hitungKoreksi() membaca & merencanakan (tanpa menulis) -> pratinjau; terapkanKoreksi() menulis. Penerapan MENGHITUNG ULANG di bawah
// kunci (PKR -> order -> unit) sehingga yang diterapkan adalah yang dihitung terhadap keadaan terkini, bukan keadaan saat pratinjau dibuka.
import { createHash } from "node:crypto";
import { PkrOrderError } from "./pkrGuard.js";
import { lockRowForUpdate } from "./inventoryLedger.js";
import { assertUnitNotV2Owned } from "./unitV2Ownership.js";
import { cancelOrderDeliveryJobs } from "./deliveryJobCancellationService.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../lib/activityLog.js";
import { bacaNotesOrder } from "../lib/domain/pkrSpesifikasi.js";
import { classifyProduct } from "../lib/domain/productionBuildTrack.js";
import {
  ItemPkrError, normalisasiItem, validasiHimpunan, kategoriOrderDariItems, perluDikirimDariItems, peringatanHimpunan, kelengkapanItems, kurangItem, deskripsiUnit, pemetaanRute,
} from "../lib/domain/pkrItem.js";
import {
  itemDariRow, siapkanItems, susunCerminan, productLineDariItems, lahirkanItemRows, lahirkanUnitItem, rencanaUnit, ringkasItemPratinjau, ITEM_AKTIF,
} from "./penjualanKaryawanItem.js";
import { revisiTerakhir, snapshotItems, tulisRevisi } from "./pkrItemRevisi.js";
import { ruteBelumDipetakanBoleh } from "./produksiRuteMode.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const gagal = (m, s = 400, c = null, e = null) => new PkrOrderError(m, s, c, e);
const POLA_KUNCI = /^[A-Za-z0-9_\-:.]{8,128}$/;
const BELUM_MULAI = ["AWAITING_PICKUP", "RECEIVED"];
const MAKS_OPERASI = 30;
const TIDAK_DIBUAT = Object.freeze(["Pembayaran (Payment)", "Invoice", "Pendapatan / jurnal baru", "Item order bernilai (OrderItem)"]);
const PETUNJUK_BATAL = "Ajukan pembatalan resmi: batalkan Penjualan Karyawan ini di Finance › Penjualan Karyawan (bila Produksi/Delivery sudah berjalan, lewat alur pembatalan order oleh Kepala Produksi/Admin), lalu catat penjualan baru dengan item yang benar.";
const FIELD_UBAH = ["panjang", "lebar", "tebal", "tinggi", "spesifikasi", "produkNama", "produkId", "perluDikirim", "jumlah"];
const LABEL_FIELD = { panjang: "panjang", lebar: "lebar", tebal: "tebal", tinggi: "tinggi", spesifikasi: "spesifikasi", produkNama: "nama produk", produkId: "produk", perluDikirim: "dikirim/diambil", jumlah: "jumlah" };

const INCLUDE_UNIT = {
  unit: {
    select: {
      id: true, unitCode: true, seq: true, status: true, currentStageId: true, serviceId: true, merk: true, ukuran: true,
      productionRunsV2: { where: { status: { not: "CANCELLED" } }, select: { id: true, status: true }, take: 1 },
      _count: { select: { stageLogs: true } },
      jobUnits: { select: { id: true, jobId: true, job: { select: { id: true, type: true, status: true } } } },
    },
  },
};

/** Alasan unit TERKUNCI (sudah dijadwalkan/diproses/diambil), atau null bila masih bisa dikoreksi. */
export function alasanUnitTerkunci(u) {
  if (u.status === "CANCELLED") return null; // unit yang sudah dibatalkan tidak menghalangi
  if (!BELUM_MULAI.includes(u.status)) return `unit ${u.unitCode} berstatus ${u.status}`;
  if (u.currentStageId != null || (u._count?.stageLogs ?? 0) > 0) return `unit ${u.unitCode} sudah punya progres produksi`;
  if ((u.productionRunsV2?.length ?? 0) > 0) return `unit ${u.unitCode} sudah dijadwalkan/dibuka di Produksi`;
  const job = (u.jobUnits ?? []).find((j) => j.job.status !== "UNSCHEDULED");
  if (job) return `unit ${u.unitCode} sudah masuk job ${job.job.type === "PICKUP" ? "pengambilan" : "pengiriman"} yang dijadwalkan/berjalan`;
  return null;
}

const hash = (v) => createHash("sha256").update(JSON.stringify(v ?? null)).digest("hex");
const angkaAtauNull = (v) => (v === undefined || v === null || v === "" ? null : v);

/** Validasi bentuk masukan operasi (tanpa DB). */
function bacaOperasi(operasi, { izinKosong = false } = {}) {
  if (izinKosong && Array.isArray(operasi) && operasi.length === 0) return [];
  if (!Array.isArray(operasi) || operasi.length === 0) throw gagal("Pilih minimal satu perubahan item", 400, "OPERASI_KOSONG");
  if (operasi.length > MAKS_OPERASI) throw gagal(`Maksimal ${MAKS_OPERASI} perubahan per koreksi`, 400, "OPERASI_TERLALU_BANYAK");
  return operasi.map((o, i) => {
    if (!o || typeof o !== "object" || Array.isArray(o)) throw gagal(`Perubahan ${i + 1}: isian tidak valid`, 400, "OPERASI_TIDAK_VALID");
    if (!["ubah", "hapus", "tambah"].includes(o.op)) throw gagal(`Perubahan ${i + 1}: jenis harus ubah, hapus, atau tambah`, 400, "OPERASI_TIDAK_VALID");
    if (o.op !== "tambah" && !Number.isInteger(Number(o.no))) throw gagal(`Perubahan ${i + 1}: nomor item wajib`, 400, "OPERASI_TIDAK_VALID");
    if (o.op === "tambah" && !o.siap && (!o.item || typeof o.item !== "object" || Array.isArray(o.item))) throw gagal(`Perubahan ${i + 1}: isian item baru wajib`, 400, "OPERASI_TIDAK_VALID");
    return { ...o, no: o.op === "tambah" ? null : Number(o.no) };
  });
}

async function muatKeadaan(tx, penjualanId, { kunci }) {
  if (!UUID.test(String(penjualanId))) throw gagal("Penjualan karyawan tidak ditemukan", 404);
  if (kunci) await lockRowForUpdate(tx, '"fin_penjualan_karyawan"', penjualanId);
  const pkr = await tx.finPenjualanKaryawan.findUnique({
    where: { id: penjualanId }, include: { seller: { select: { id: true, name: true } }, orderCrm: { select: { id: true, orderNumber: true } } },
  });
  if (!pkr) throw gagal("Penjualan karyawan tidak ditemukan", 404);
  if (!pkr.orderCrm) throw gagal(`${pkr.nomor} belum punya order CRM — buat dulu`, 409, "BELUM_ADA_ORDER");
  if (kunci) await tx.$queryRawUnsafe('SELECT id FROM "Order" WHERE id = $1 FOR UPDATE', pkr.orderCrm.id);
  const order = await tx.order.findUnique({ where: { id: pkr.orderCrm.id } });
  if (pkr.status !== "AKTIF" || order.status === "CANCELLED") throw gagal("Penjualan/order ini sudah dibatalkan — tidak bisa dikoreksi", 409, "SUDAH_DIBATALKAN");
  if (kunci) {
    // Kunci semua unit order (urut id, tanpa deadlock dengan Produksi yang mengunci per unit): penjadwalan yang berjalan bersamaan selesai dulu, lalu kita membaca keadaan sesudahnya.
    await tx.$queryRawUnsafe('SELECT id FROM units WHERE order_id = $1 ORDER BY id FOR UPDATE', order.id);
  }
  const rows = await tx.pkrOrderItem.findMany({ where: { orderId: order.id }, orderBy: { seq: "asc" }, include: { units: { include: INCLUDE_UNIT } } });
  return { pkr, order, rows };
}

/** Rute efektif satu baris item (kategori + produk saat ini) — dipakai menstempel unit baru dan memeriksa produk yang diganti. */
async function ruteBaris(tx, row, produkId = row.productId) {
  const kategori = await tx.pkrItemCategory.findUnique({ where: { id: row.categoryId } });
  const produk = produkId ? await tx.pkrItemProduct.findUnique({ where: { id: produkId } }) : null;
  const rute = pemetaanRute({
    kategori: { code: kategori.code, name: kategori.name, productLine: kategori.productLine, productType: kategori.productType, productionServiceId: kategori.productionServiceId },
    produk: produk && { id: produk.id, name: produk.name, productLine: produk.productLine, productType: produk.productType, productionServiceId: produk.productionServiceId },
    jenisKerja: row.workKind,
  }, classifyProduct);
  return { rute, kategori, produk };
}

/**
 * Hitung rencana koreksi (TANPA menulis). `kunci:true` = di bawah kunci (dipakai penerapan).
 * @returns {{ pkr, order, rows, revisiSekarang, plan, impact, itemsSesudah, kunciPermintaan }}
 */
export async function hitungKoreksi(tx, { penjualanId, operasi, expectedRevision = null, kunci = false, viaBaris = false, izinTanpaPerubahan = false }) {
  const ops = bacaOperasi(operasi, { izinKosong: izinTanpaPerubahan });
  const { pkr, order, rows } = await muatKeadaan(tx, penjualanId, { kunci });
  const aktif = rows.filter((r) => !r.removedAt);
  // Item operasional yang TERTAUT ke baris penjualan hanya boleh dikoreksi lewat Koreksi baris penjualan (Finance + operasional atomik): jalur ini tidak menyentuh harga/total.
  if (!viaBaris && aktif.some((r) => r.saleItemId)) {
    throw gagal(`${pkr.nomor} memakai daftar item penjualan terpadu. Koreksi lewat "Koreksi item" pada baris penjualan (jumlah/harga/spesifikasi diubah bersama, atomik).`, 409, "KOREKSI_PAKAI_BARIS");
  }
  if (aktif.length === 0) {
    throw gagal(`${pkr.nomor} tidak memakai daftar item (order lama). Ubah merk/ukuran lewat "Lengkapi spesifikasi order"; untuk menambah item, batalkan lalu catat ulang.`, 409, "KOREKSI_ORDER_LAMA");
  }
  const revisiSekarang = await revisiTerakhir(tx, order.id);
  if (expectedRevision !== null && Number(expectedRevision) !== revisiSekarang) {
    throw gagal("Daftar item sudah diubah orang lain atau di layar lain. Muat ulang lalu periksa dampaknya sebelum mengirim lagi.", 409, "REVISI_BERUBAH", { revisiSaatIni: revisiSekarang, revisiDikirim: Number(expectedRevision) });
  }

  // Keadaan kerja per item (salinan di memori; baris DB tidak disentuh di tahap ini).
  const kerja = new Map(aktif.map((r) => {
    const unitAktif = r.units.map((x) => x.unit).filter((u) => u.status !== "CANCELLED").sort((a, b) => a.seq - b.seq);
    const terkunciAlasan = unitAktif.map(alasanUnitTerkunci).find(Boolean) ?? null;
    return [r.seq, { row: r, lama: itemDariRow(r), baru: itemDariRow(r), unitAktif, terkunciAlasan, hapus: false, tambahUnit: 0, batalUnit: [], beda: {}, produkBerubah: false, rute: null }];
  }));
  const baruItems = []; // item domain baru (hasil siapkanItems), no = seq baru
  let seqBerikut = Math.max(...rows.map((r) => r.seq)) + 1;
  let bundelBerikut = Math.max(0, ...rows.map((r) => r.bundleNo ?? 0)) + 1;
  const blokir = (item, pesan) => gagal(`Item ${item}: ${pesan}`, 409, "ITEM_TERKUNCI", { petunjuk: PETUNJUK_BATAL });

  for (const op of ops) {
    if (op.op === "tambah") {
      // op.siap = item operasional yang sudah disiapkan dari baris penjualan baru (jalur terpadu): beri nomor item/set lanjutan tanpa menyiapkan ulang.
      const diterima = op.siap
        ? op.siap.map((it, i) => ({ ...it, no: seqBerikut + i, ...(it.bundleNo != null && { bundleNo: it.bundleNo + bundelBerikut - 1 }) }))
        : await siapkanItems(tx, [op.item], { noAwal: seqBerikut, validasi: false, bundelAwal: bundelBerikut - 1 });
      for (const it of diterima) { baruItems.push(it); seqBerikut = Math.max(seqBerikut, it.no + 1); if (it.bundleNo != null) bundelBerikut = Math.max(bundelBerikut, it.bundleNo + 1); }
      continue;
    }
    const k = kerja.get(op.no);
    if (!k) throw gagal(`Item ${op.no} tidak ditemukan atau sudah dihapus`, 404, "ITEM_TIDAK_ADA");
    if (k.terkunciAlasan) throw blokir(op.no, `tidak bisa dikoreksi — ${k.terkunciAlasan}. ${PETUNJUK_BATAL}`);
    if (op.op === "hapus") { k.hapus = true; continue; }
    // ubah
    if (k.hapus) throw gagal(`Item ${op.no} sudah ditandai dihapus pada permintaan yang sama`, 400, "OPERASI_BERTENTANGAN");
    if (op.kategori !== undefined && op.kategori !== k.row.categoryCode) throw gagal(`Item ${op.no}: kategori tidak bisa diubah — hapus item lalu tambahkan item baru`, 409, "KATEGORI_TIDAK_BISA_DIUBAH");
    const mentah = {
      jumlah: k.baru.jumlah, panjang: k.baru.panjang, lebar: k.baru.lebar, tebal: k.baru.tebal, tinggi: k.baru.tinggi, spesifikasi: k.baru.spesifikasi,
      perluDikirim: k.baru.perluDikirim, produkNama: k.baru.produkNama, produkId: k.baru.produkId,
    };
    for (const f of FIELD_UBAH) if (f in op) mentah[f] = op[f];
    let produk = null;
    if (mentah.produkId) {
      const p = await tx.pkrItemProduct.findUnique({ where: { id: mentah.produkId } });
      if (!p || p.categoryId !== k.row.categoryId) throw gagal(`Item ${op.no}: produk tidak termasuk kategori ${k.row.categoryName}`, 400, "PRODUK_TIDAK_SESUAI");
      if (!p.active && mentah.produkId !== k.lama.produkId) throw gagal(`Item ${op.no}: produk "${p.name}" sudah dinonaktifkan Admin`, 400, "PRODUK_NONAKTIF");
      produk = p;
    }
    let baru;
    try {
      baru = normalisasiItem(mentah, {
        kategori: { id: k.row.categoryId, code: k.row.categoryCode, name: k.row.categoryName, shape: k.row.shape, workKind: k.row.workKind },
        produk: produk && { id: produk.id, name: produk.name, productionServiceId: produk.productionServiceId }, no: k.row.seq,
      });
    } catch (e) { if (e instanceof ItemPkrError) throw gagal(e.message, 400, e.code); throw e; }
    const produkIdBaru = produk ? produk.id : ("produkId" in op ? null : k.baru.produkId ?? null);
    k.produkBerubah = k.produkBerubah || (produkIdBaru ?? null) !== (k.lama.produkId ?? null);
    k.baru = { ...k.lama, ...baru, no: k.row.seq, produkId: produkIdBaru, bundleNo: k.lama.bundleNo, bundleCategoryCode: k.lama.bundleCategoryCode, bundleName: k.lama.bundleName };
    k.baru.ukuranLabel = baru.ukuranLabel;
    if (k.produkBerubah) {
      const { rute } = await ruteBaris(tx, k.row, produkIdBaru);
      if (!rute.ok && !(await ruteBelumDipetakanBoleh(tx))) throw gagal(`Item ${op.no}: ${rute.pesan}`, 422, rute.kode);
      if (k.row.workKind === "LAYANAN" && k.unitAktif.some((u) => (u.serviceId ?? null) !== (rute.serviceId ?? null))) {
        throw gagal(`Item ${op.no}: produk baru memakai layanan produksi yang berbeda. Hapus item ini lalu tambahkan item baru.`, 409, "LAYANAN_BERBEDA");
      }
      k.rute = rute;
    }
  }

  // Selisih per item + rencana unit.
  const itemsSesudah = [];
  const diubah = []; const dihapus = []; const ditambah = [];
  for (const k of kerja.values()) {
    if (k.hapus) { dihapus.push({ no: k.row.seq, produk: k.lama.produkNama || k.lama.kategoriNama, kategori: k.lama.kategoriNama, jumlah: k.lama.jumlah, unit: k.unitAktif.map((u) => u.unitCode) }); k.batalUnit = k.unitAktif.slice(); continue; }
    const beda = {};
    for (const f of ["panjang", "lebar", "tebal", "tinggi", "spesifikasi", "produkNama", "perluDikirim", "jumlah", "produkId"]) {
      const a = k.lama[f] ?? null; const b = k.baru[f] ?? null;
      if (a !== b) beda[f] = { sebelum: a, sesudah: b };
    }
    k.beda = beda;
    if (beda.jumlah) {
      const selisih = k.baru.jumlah - k.lama.jumlah;
      if (selisih > 0) k.tambahUnit = selisih;
      else k.batalUnit = k.unitAktif.slice(selisih); // unit bernomor TERTINGGI yang dilepas (nomor unit awal dipertahankan)
    }
    if (Object.keys(beda).length) diubah.push({ no: k.row.seq, produk: k.lama.produkNama || k.lama.kategoriNama, perubahan: beda, unitBaru: k.tambahUnit, unitDibatalkan: k.batalUnit.map((u) => u.unitCode) });
    itemsSesudah.push(k.baru);
  }
  for (const it of baruItems) { itemsSesudah.push(it); ditambah.push({ no: it.no, produk: it.produkNama || it.kategoriNama, kategori: it.kategoriNama, jumlah: it.jumlah, jenisKerja: it.jenisKerja, bundel: it.bundleNo ?? null }); }
  itemsSesudah.sort((a, b) => a.no - b.no);

  if (itemsSesudah.length === 0) throw gagal("Koreksi ini menghapus semua item. Bila penjualan memang batal, batalkan Penjualan Karyawan-nya.", 409, "SEMUA_ITEM_DIHAPUS");
  try { validasiHimpunan(itemsSesudah); } catch (e) { if (e instanceof ItemPkrError) throw gagal(e.message, 400, e.code, e.extra); throw e; }
  const adaPerubahan = diubah.length + dihapus.length + ditambah.length > 0;
  if (!adaPerubahan && !izinTanpaPerubahan) throw gagal("Tidak ada perubahan yang dikirim", 400, "TANPA_PERUBAHAN");

  // Dampak.
  const kategoriSesudah = kategoriOrderDariItems(itemsSesudah);
  const unitDibatalkan = [...kerja.values()].flatMap((k) => k.batalUnit);
  const rencanaBaru = rencanaUnit(baruItems, { awalNomor: Math.max(0, ...rows.flatMap((r) => r.units.map((x) => x.unit.seq))) });
  const unitBaruTotal = [...kerja.values()].reduce((a, k) => a + k.tambahUnit, 0) + baruItems.reduce((a, i) => a + i.jumlah, 0);
  const jobDariUnit = new Map(); // jobId -> { job, unitIds:Set }
  for (const u of unitDibatalkan) for (const ju of u.jobUnits ?? []) {
    const e = jobDariUnit.get(ju.job.id) ?? { job: ju.job, unitIds: new Set() };
    e.unitIds.add(u.id); jobDariUnit.set(ju.job.id, e);
  }
  const jobTersentuh = []; const jobDibatalkan = [];
  for (const [jobId, e] of jobDariUnit) {
    const semuaUnitJob = await tx.jobUnit.findMany({ where: { jobId }, select: { unitId: true } });
    const sisa = semuaUnitJob.filter((x) => !e.unitIds.has(x.unitId)).length;
    jobTersentuh.push({ jobId, tipe: e.job.type, unitDikeluarkan: e.unitIds.size });
    if (sisa === 0) jobDibatalkan.push(jobId);
  }
  const alamat = order.deliveryAddress && String(order.deliveryAddress).trim() ? String(order.deliveryAddress).trim() : null;
  const kel = kelengkapanItems(itemsSesudah.map((i) => ({ ...i, kurang: undefined })), { alamat });
  const perluDikirimSebelum = order.pkrPerluDikirim ?? null; const perluDikirimSesudah = perluDikirimDariItems(itemsSesudah);
  const peringatan = [...peringatanHimpunan(itemsSesudah)];
  // Set yang tidak utuh lagi setelah koreksi (komponen dihapus) — bukan blokir, hanya pemberitahuan.
  const perBundel = new Map();
  for (const i of itemsSesudah) if (i.bundleNo != null) perBundel.set(i.bundleNo, [...(perBundel.get(i.bundleNo) ?? []), i]);
  for (const d of dihapus) {
    const lamaItem = kerja.get(d.no)?.lama;
    if (lamaItem?.bundleNo != null) peringatan.push({ kode: "SET_TIDAK_UTUH", pesan: `Item ${d.no} adalah komponen Set ${lamaItem.bundleNo}; set itu tidak utuh lagi (komponen ini dihapus).` });
  }
  const itemDomainDenganRute = itemsSesudah;
  const impact = {
    revisiSekarang, revisiBaru: revisiSekarang + 1,
    kategoriOrder: { sebelum: order.category, sesudah: kategoriSesudah },
    item: { ditambah, dihapus, diubah },
    unit: { dibuat: unitBaruTotal, dibatalkan: unitDibatalkan.map((u) => u.unitCode), rencanaItemBaru: rencanaBaru },
    pickup: { jobTersentuh: jobTersentuh.filter((j) => j.tipe === "PICKUP"), jobDibatalkan },
    delivery: {
      perluDikirimSebelum, perluDikirimSesudah, jobTersentuh: jobTersentuh.filter((j) => j.tipe === "DELIVERY"),
      catatan: "Delivery tetap menunggu seluruh unit yang dikirim siap lalu membuat SATU job; item baru yang dikirim memerlukan aksi eksplisit bila job sudah ada.",
    },
    produksi: { lengkap: kel.lengkap, kurang: kel.kurang },
    peringatan, tidakDibuat: TIDAK_DIBUAT,
    ringkasItem: itemDomainDenganRute.map((i) => ringkasItemPratinjau({ ...i, kurang: i.kurang ?? kurangItem(i), rute: null }, null)),
  };
  return { pkr, order, rows, revisiSekarang, kerja, baruItems, itemsSesudah, impact, unitDibatalkan, jobDibatalkan, kategoriSesudah, perluDikirimSesudah };
}

/** Pratinjau dampak koreksi (tidak menulis). Kesalahan masukan/keadaan dikembalikan sebagai { valid:false, galat } supaya layar menampilkannya. */
export async function pratinjauKoreksi(db, { penjualanId, operasi, expectedRevision = null }) {
  try {
    const h = await db.$transaction((tx) => hitungKoreksi(tx, { penjualanId, operasi, expectedRevision, kunci: false }));
    return { valid: true, revisi: h.revisiSekarang, nomor: h.pkr.nomor, order: { id: h.order.id, nomor: h.order.orderNumber }, dampak: h.impact };
  } catch (e) {
    if (e instanceof PkrOrderError || e instanceof ItemPkrError) {
      return { valid: false, galat: { pesan: e.message, kode: e.code ?? null, status: e.statusCode ?? 400, ...(e.extra ?? {}) } };
    }
    throw e;
  }
}

function ringkasTeks(impact) {
  const b = [];
  if (impact.item.ditambah.length) b.push(`+${impact.item.ditambah.length} item`);
  if (impact.item.dihapus.length) b.push(`−${impact.item.dihapus.length} item`);
  if (impact.item.diubah.length) b.push(`${impact.item.diubah.length} item diubah`);
  b.push(`unit +${impact.unit.dibuat}/−${impact.unit.dibatalkan.length}`);
  return b.join(", ");
}

/**
 * Terapkan koreksi. Dipanggil di DALAM transaksi pemanggil (atomik). Mengembalikan hasil replay bila Idempotency-Key yang sama dengan isi yang sama sudah diterapkan.
 */
export async function terapkanKoreksi(tx, { penjualanId, operasi, expectedRevision, alasan, idempotencyKey, userId = null, viaBaris = false, finance = null, hashPermintaanLuar = null, dampakTambahan = null, kind = "DIKOREKSI" }) {
  if (!idempotencyKey || !POLA_KUNCI.test(String(idempotencyKey))) {
    throw gagal("Header Idempotency-Key wajib (8–128 karakter) untuk koreksi item", 428, "IDEMPOTENCY_KEY_REQUIRED");
  }
  const teksAlasan = String(alasan ?? "").trim().replace(/\s+/g, " ");
  if (teksAlasan.length < 5) throw gagal("Alasan koreksi wajib diisi (minimal 5 karakter)", 400, "ALASAN_WAJIB");
  if (teksAlasan.length > 500) throw gagal("Alasan maksimal 500 karakter", 400, "ALASAN_TERLALU_PANJANG");
  if (expectedRevision === undefined || expectedRevision === null || !Number.isInteger(Number(expectedRevision)) || Number(expectedRevision) < 1) {
    throw gagal("Revisi yang Anda lihat (expectedRevision) wajib dikirim — buka pratinjau dampak dulu", 400, "REVISI_WAJIB");
  }
  const ops = bacaOperasi(operasi, { izinKosong: Boolean(finance) });
  // Koreksi baris penjualan menghitung hash dari masukan ASLI (termasuk harga) — operasi operasional hasil terjemahan bisa sama untuk dua permintaan harga yang berbeda.
  const hashPermintaan = hashPermintaanLuar ?? hash({ penjualanId, ops, expectedRevision: Number(expectedRevision), alasan: teksAlasan });

  // Kunci dulu (PKR -> order), lalu cek replay di bawah kunci: dua permintaan paralel dengan kunci sama diserialkan di sini.
  const { pkr, order } = await muatKeadaan(tx, penjualanId, { kunci: false });
  await lockRowForUpdate(tx, '"fin_penjualan_karyawan"', penjualanId);
  const ada = await tx.pkrItemRevision.findFirst({ where: { orderId: order.id, idempotencyKey: String(idempotencyKey) } });
  if (ada) {
    if (ada.impact?.hashPermintaan !== hashPermintaan) throw gagal("Idempotency-Key ini sudah dipakai untuk koreksi lain. Pakai kunci baru.", 409, "IDEMPOTENCY_KEY_DIPAKAI");
    return { replayed: true, revisi: ada.revision, nomor: pkr.nomor, orderId: order.id, dampak: ada.impact };
  }

  const h = await hitungKoreksi(tx, { penjualanId, operasi: ops, expectedRevision: Number(expectedRevision), kunci: true, viaBaris, izinTanpaPerubahan: Boolean(finance) });
  let jejakFinance = null;
  const sebelum = await snapshotItems(tx, h.order.id);
  const orderId = h.order.id;

  // 1. Hapus lunak item + batalkan unitnya; jumlah turun -> batalkan unit tertinggi.
  const batalIds = h.unitDibatalkan.map((u) => u.id);
  for (const k of h.kerja.values()) {
    if (!k.hapus) continue;
    await tx.pkrOrderItem.update({ where: { id: k.row.id }, data: { removedAt: new Date(), removedById: userId, removedReason: teksAlasan } });
  }
  if (batalIds.length) {
    // Pagar kepemilikan Production V2 PER UNIT (tambahan di atas pemeriksaan unit terkunci): unit yang sudah dimiliki Run V2 tidak pernah dibatalkan dari sini.
    for (const u of h.unitDibatalkan) await assertUnitNotV2Owned(tx, u.id, "Koreksi item Penjualan Karyawan");
    await tx.unit.updateMany({ where: { id: { in: batalIds }, status: { in: BELUM_MULAI } }, data: { status: "CANCELLED" } });
    // Keluarkan dari job yang belum dijadwalkan; job yang jadi kosong dibatalkan lewat jalur baku (tombstone + peristiwa).
    await tx.jobUnit.deleteMany({ where: { unitId: { in: batalIds }, job: { status: "UNSCHEDULED" } } });
    if (h.jobDibatalkan.length) {
      await cancelOrderDeliveryJobs(tx, { orderId, jobIds: h.jobDibatalkan, reason: `Koreksi item ${pkr.nomor} — ${teksAlasan}`, actorId: userId });
    }
  }

  // 2. Ubah item (kolom + sinkron merk/ukuran unit + stempel rute bila produk berganti + tambah unit bila jumlah naik).
  for (const k of h.kerja.values()) {
    if (k.hapus || Object.keys(k.beda).length === 0) continue;
    const b = k.baru;
    await tx.pkrOrderItem.update({
      where: { id: k.row.id },
      data: {
        qty: b.jumlah, lengthCm: b.panjang, widthCm: b.lebar, thicknessCm: b.tebal, heightCm: b.tinggi, specNotes: b.spesifikasi, perluDikirim: b.perluDikirim,
        productId: b.produkId ?? null, productName: b.produkNama,
      },
    });
    const idUnit = k.unitAktif.filter((u) => !k.batalUnit.some((x) => x.id === u.id)).map((u) => u.id);
    const dLama = deskripsiUnit(k.lama); const dBaru = deskripsiUnit(b);
    if (idUnit.length) {
      if (dLama.merk !== dBaru.merk) await tx.unit.updateMany({ where: { id: { in: idUnit }, OR: [{ merk: null }, { merk: dLama.merk }] }, data: { merk: dBaru.merk } });
      if (dLama.ukuran !== dBaru.ukuran) await tx.unit.updateMany({ where: { id: { in: idUnit }, OR: [{ ukuran: null }, { ukuran: dLama.ukuran ?? "" }] }, data: { ukuran: dBaru.ukuran } });
      if (k.produkBerubah && k.rute) await tx.unit.updateMany({ where: { id: { in: idUnit } }, data: { productLine: k.rute.productLine ?? null, productType: k.rute.productType ?? null } });
    }
    if (k.tambahUnit > 0) {
      const { rute } = await ruteBaris(tx, k.row, b.produkId ?? null);
      if (!rute.ok && !(await ruteBelumDipetakanBoleh(tx))) throw gagal(`Item ${k.row.seq}: ${rute.pesan}`, 422, rute.kode);
      await lahirkanUnitItem(tx, {
        orderId, rowId: k.row.id, userId, jumlah: k.tambahUnit,
        it: { ...b, jenisKerja: k.row.workKind, productLine: rute.productLine ?? null, productType: rute.productType ?? null, productionServiceId: k.row.workKind === "LAYANAN" ? (rute.serviceId ?? null) : null },
      });
    }
  }

  // 3. Item baru.
  if (h.baruItems.length) await lahirkanItemRows(tx, { pkrId: pkr.id, orderId, items: h.baruItems, userId });

  // 4. Turunan tingkat order dari tabel (satu sumber) + cerminan notes.
  const aktifSesudah = (await tx.pkrOrderItem.findMany({ where: { orderId, ...ITEM_AKTIF }, orderBy: { seq: "asc" } })).map(itemDariRow);
  const unitAktifSesudah = await tx.unit.findMany({ where: { orderId, status: { not: "CANCELLED" } }, select: { id: true, status: true, currentStageId: true } });
  const info = bacaNotesOrder(h.order.notes);
  const dataOrder = {
    notes: JSON.stringify({ ...info, pkrItems: susunCerminan(aktifSesudah) }),
    pkrPerluDikirim: perluDikirimDariItems(aktifSesudah),
    category: kategoriOrderDariItems(aktifSesudah),
    productLine: productLineDariItems(aktifSesudah),
    quantity: aktifSesudah.reduce((a, i) => a + i.jumlah, 0),
  };
  // Status order mengikuti kategori hasil koreksi (aturan yang sama dengan pembuatan): semua BARU & semua unit sudah di workshop -> Diproses; kembali ke LAYANAN murni
  // sebelum ada yang berjalan -> Menunggu. statusLocked (override manual) dihormati.
  let statusBaru = null;
  if (!h.order.statusLocked) {
    const semuaDiWorkshop = unitAktifSesudah.length > 0 && unitAktifSesudah.every((u) => u.status === "RECEIVED");
    if (dataOrder.category === "BARU" && semuaDiWorkshop && ["PENDING", "PICKUP"].includes(h.order.status)) statusBaru = "PROCESSING";
    if (dataOrder.category === "LAYANAN" && h.order.status === "PROCESSING" && unitAktifSesudah.every((u) => u.status === "AWAITING_PICKUP" && u.currentStageId == null)) statusBaru = "PENDING";
  }
  if (statusBaru) dataOrder.status = statusBaru;
  await tx.order.update({ where: { id: orderId }, data: dataOrder });
  if (statusBaru) await tx.orderStatusTransition.create({ data: { orderId, fromStatus: h.order.status, toStatus: statusBaru, changedById: userId } });

  // 4b. Sisi Finance (koreksi baris penjualan): dijalankan di transaksi yang SAMA setelah semua perubahan operasional — sinkron nama/ukuran ke baris penjualan, hapus baris,
  // total + jurnal pengganti. Mengembalikan jejak audit { before, after } untuk buku revisi.
  if (finance) jejakFinance = typeof finance === "function" ? await finance(tx, h) : finance;

  // 5. Buku revisi (token konkurensi) + audit.
  const sesudah = await snapshotItems(tx, orderId);
  const dampak = { ...h.impact, hashPermintaan, ringkas: ringkasTeks(h.impact), kategoriOrder: { sebelum: h.order.category, sesudah: dataOrder.category }, ...(dampakTambahan && { keuangan: dampakTambahan }) };
  const rev = await tulisRevisi(tx, {
    orderId, penjualanId: pkr.id, kind, reason: teksAlasan, before: sebelum, after: sesudah, impact: dampak, userId, idempotencyKey: String(idempotencyKey),
    expected: Number(expectedRevision), ...(jejakFinance && { financeBefore: jejakFinance.before, financeAfter: jejakFinance.after }),
  });
  const meta = { aksi: "dikoreksi", nomorPkr: pkr.nomor, penjualanId: pkr.id, orderId, revisi: rev.revision, alasan: teksAlasan, ringkas: ringkasTeks(h.impact), kategoriSebelum: h.order.category, kategoriSesudah: dataOrder.category };
  await recordActivity(tx, { entityType: ENTITY_TYPES.FIN_PENJUALAN_KARYAWAN, entityId: pkr.id, eventType: EVENT_TYPES.PKR_ORDER_SINKRON, actorId: userId, metadata: meta });
  await recordActivity(tx, { entityType: ENTITY_TYPES.ORDER, entityId: orderId, eventType: EVENT_TYPES.PKR_ORDER_SINKRON, actorId: userId, metadata: meta });

  return { replayed: false, revisi: rev.revision, nomor: pkr.nomor, orderId, dampak, customerId: h.order.customerId };
}
