// PENJUALAN KARYAWAN — ITEM PENJUALAN & PEMENUHAN TERPADU: INVARIAN LINTAS MODUL, terhadap PostgreSQL sungguhan.
// Melengkapi pkrItemTerpadu.integration.test.js. Yang dikunci di sini adalah janji arsitektur, bukan satu fitur:
//   (1) PETA NILAI: uang hanya hidup di baris penjualan Finance (+ jurnalnya); tabel Produksi/Delivery/Order tidak punya kolom uang;
//   (2) SATU SUMBER: total PKR = Σ jumlah × harga baris yang SAMA; piutang/jurnal sekali; Order CRM bernilai 0; unit = Σ jumlah × komponen;
//   (3) TIDAK ADA Payment / invoice / pengakuan pendapatan / jurnal operasional kedua — sampai order DELIVERED, dan lewat pintu CRM lama;
//   (4) HARGA TIDAK BOCOR: sapuan seluruh endpoint GET (dan export) sebagai peran non-Finance tidak memuat angka harga/total;
//   (5) MATRIKS progres Produksi: status/tahap/Run apa pun menutup jumlah/ukuran/hapus, tetapi harga tetap boleh dikoreksi;
//   (6) pemenuhan tidak bisa diubah di tempat (hapus + tambah baru, atomik); (7) replay & paralel tidak menggandakan apa pun.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";
import { suggestDeliveryJob } from "../../src/services/deliveryHandoff.js";
import { bukukanPengakuanPendapatan } from "../../src/services/finance/hooks.js";
import { MODUL_EXPORT } from "../../src/services/finance/export/registry.js";

let server; let app;
test.before(async () => { await truncateAll(); app = buildTestApp(); server = await startTestServer(app); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const BASE = "/api/finance/penjualan-karyawan";
const kunci = () => ({ "Idempotency-Key": `pkri-${randomUUID()}` });
const KATEGORI = {
  KASUR_BARU: ["Kasur Baru", "KASUR", "BARU", 10], SERVICE_UPGRADE: ["Service/Upgrade Kasur", "SERVICE", "LAYANAN", 20], DIVAN_BOX: ["Divan/Box", "DIVAN", "BARU", 30],
  SANDARAN: ["Sandaran/Headboard", "SANDARAN", "BARU", 40], SET_LENGKAP: ["Set Kasur Lengkap", "SET", "BARU", 50], CUSTOM_LAINNYA: ["Produk Custom Lainnya", "CUSTOM", "BARU", 60],
};
const RUTE = {
  KASUR_BARU: { productLine: "KASUR", productType: "KASUR_SEHAT" }, SERVICE_UPGRADE: { productLine: "KASUR", productType: null }, DIVAN_BOX: { productLine: "DIVAN", productType: "DIVAN_UTAMA" },
  SANDARAN: { productLine: "DIVAN", productType: "DIVAN_SANDARAN" }, SET_LENGKAP: { productLine: null, productType: null }, CUSTOM_LAINNYA: { productLine: "SOFA", productType: "SOFA_L" },
};
// Peran NON-Finance yang menyentuh Produksi/Gudang/Delivery/CRM. Tak satu pun boleh melihat harga/total PKR.
const PERAN_OPERASIONAL = ["PRODUCTION_LEAD", "PRODUCTION_WORKER", "QC_LEAD", "WAREHOUSE", "DISPATCHER", "DRIVER", "HELPER", "SALES"];

async function siapkan({ peranOperasional = [] } = {}) {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const bank = await testPrisma.finCashAccount.create({ data: { name: "BCA Operasional", kind: "BANK", accountId: akunBank.id } });
  const seller = await testPrisma.user.create({ data: { name: "Emon Uji", email: `emon-${randomUUID()}@example.test`, passwordHash: "x", role: "PRODUCTION_WORKER" } });
  const peran = async (r) => { const u = await createTestUser({ roles: [r] }); return { id: u.user.id, token: u.token, c: makeClient(server.baseUrl, u.token) }; };
  await testPrisma.pkrItemCategory.deleteMany({ where: { code: { notIn: Object.keys(KATEGORI) } } });
  const layanan = await testPrisma.serviceCatalog.findFirst({ where: { active: true }, orderBy: { code: "asc" } });
  assert.ok(layanan, "katalog layanan produksi dari migrasi harus ada");
  for (const [code, [name, shape, workKind, sortOrder]] of Object.entries(KATEGORI)) {
    const peta = { ...RUTE[code], productionServiceId: code === "SERVICE_UPGRADE" ? layanan.id : null };
    await testPrisma.pkrItemCategory.upsert({ where: { code }, update: { name, shape, workKind, sortOrder, active: true, ...peta }, create: { code, name, shape, workKind, sortOrder, ...peta } });
  }
  const kat = Object.fromEntries((await testPrisma.pkrItemCategory.findMany()).map((c) => [c.code, c]));
  await testPrisma.pkrBundleComponent.deleteMany({});
  for (const [i, kode] of ["KASUR_BARU", "DIVAN_BOX", "SANDARAN"].entries()) {
    await testPrisma.pkrBundleComponent.create({ data: { bundleCategoryId: kat.SET_LENGKAP.id, componentCategoryId: kat[kode].id, qty: 1, sortOrder: (i + 1) * 10 } });
  }
  const operasional = {};
  for (const r of peranOperasional) operasional[r] = await peran(r);
  return { seller, bank, admin: await peran("ADMIN"), finance: await peran("FINANCE"), operasional };
}

// Harga ANGKA UNIK supaya kebocoran mudah dideteksi.
const KASUR = { pemenuhan: "PRODUKSI_BARU", kategori: "KASUR_BARU", produkNama: "Kasur Sano Custom", jumlah: 1, harga: 7_654_321, panjang: 200, lebar: 160, tebal: 20, perluDikirim: true, spesifikasi: "Pegas bonnel, kain knit" };
const DIVAN = { pemenuhan: "PRODUKSI_BARU", kategori: "DIVAN_BOX", produkNama: "Divan Laci", jumlah: 1, harga: 1_234_567, panjang: 200, lebar: 160, tinggi: 30, perluDikirim: true };
const SANDARAN = { pemenuhan: "PRODUKSI_BARU", kategori: "SANDARAN", produkNama: "Sandaran Busa", jumlah: 1, harga: 876_543, lebar: 160, tinggi: 120, perluDikirim: false };
const SET = { pemenuhan: "PRODUKSI_BARU", kategori: "SET_LENGKAP", jumlah: 1, harga: 9_999_999, perluDikirim: true, komponen: [
  { panjang: 200, lebar: 160, tebal: 20, produkNama: "Kasur Set" }, { panjang: 200, lebar: 160, tinggi: 30, produkNama: "Divan Set" }, { lebar: 160, tinggi: 120, produkNama: "Sandaran Set" },
] };
const SERVICE = { pemenuhan: "SERVICE_PICKUP", kategori: "SERVICE_UPGRADE", produkNama: "Full Service", jumlah: 1, harga: 3_210_987, panjang: 190, lebar: 90, perluDikirim: true, spesifikasi: "Kempes bagian tengah" };
const STOK = { pemenuhan: "AMBIL_STOK", nama: "Bantal Sano", jumlah: 2, harga: 111_111 };
const JASA = { pemenuhan: "TANPA_OPERASIONAL", nama: "Biaya jasa pasang", jumlah: 1, harga: 55_555 };
const ALAMAT = { alamat: "Jl. Mawar 5, Bekasi", kota: "Bekasi" };

const badan = (seller, items, extra = {}) => ({ date: "2026-10-02", sellerId: seller.id, buyerName: "Bu Ani (kerabat)", items, orderCrm: { ...ALAMAT }, ...extra });
const catat = async (w, items, extra = {}) => {
  const r = await w.finance.c.post(BASE, badan(w.seller, items, extra), kunci());
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
};
const orderDari = (pkrId) => testPrisma.order.findFirst({ where: { penjualanKaryawanId: pkrId } });
const unitDi = (orderId) => testPrisma.unit.findMany({ where: { orderId }, orderBy: { seq: "asc" } });
const koreksi = (w, pkrId, operasi, expectedRevision, alasan = "Penyesuaian uji invarian", headers = kunci()) =>
  w.finance.c.post(`${BASE}/${pkrId}/koreksi-baris`, { operasi, expectedRevision, alasan }, headers);
const hitung = async (sql) => Number((await testPrisma.$queryRawUnsafe(sql))[0].n);
async function netPiutang(pkrId) {
  const akun = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.PIUTANG_KARYAWAN } });
  const e = await testPrisma.finJournalEntry.findMany({ where: { source: { in: ["PENJUALAN_KARYAWAN", "REVERSAL"] }, OR: [{ sourceId: pkrId }, { reversalOf: { sourceId: pkrId } }] }, include: { lines: true } });
  let net = 0;
  for (const j of e) for (const l of j.lines) if (l.accountId === akun.id) net += Number(l.debit) - Number(l.credit);
  return net;
}
const uangDokumenLain = async () => ({
  payment: await testPrisma.payment.count(), invoice: await testPrisma.invoice.count(), orderItem: await testPrisma.orderItem.count(),
  jurnalTotal: await testPrisma.finJournalEntry.count(), jurnalPkr: await testPrisma.finJournalEntry.count({ where: { source: "PENJUALAN_KARYAWAN" } }),
  pendapatan: await testPrisma.finJournalEntry.count({ where: { source: "PENGAKUAN_PENDAPATAN" } }), gap: await testPrisma.finPostingGap.count(),
});

// ═══ 1. Peta nilai: kolom uang hanya di sisi Finance ═══
test("peta nilai: tabel operasional (item order, unit, job, pengiriman sebagian) tidak punya kolom uang; revisi hanya menyimpan uang di finance_before/finance_after", async () => {
  const POLA_UANG = "(price|harga|amount|subtotal|total|nilai|value|biaya|cost|fee|tarif|rupiah|upah)";
  const kolom = await testPrisma.$queryRawUnsafe(
    `select table_name, column_name from information_schema.columns where table_schema = 'public' and column_name ~* '${POLA_UANG}' and table_name in
     ('pkr_order_items','pkr_order_item_units','units','unit_stage_logs','jobs','job_units','pkr_pengiriman_sebagian','pkr_item_revisions','pkr_item_categories','pkr_item_products','pkr_bundle_components')
     order by 1, 2`,
  );
  const temuan = kolom.map((k) => `${k.table_name}.${k.column_name}`);
  // Pengecualian yang SAH dan sudah ada sebelum fitur ini: biaya kurir eksternal pada Job bukan nilai penjualan PKR. Daftar ditulis eksplisit supaya kolom uang BARU
  // di tabel operasional langsung membuat tes ini gagal dan memaksa keputusan sadar.
  const SAH = new Set(["jobs.external_courier_cost"]); // biaya kurir eksternal (sudah ada sebelum fitur ini): biaya operasional Delivery, BUKAN harga jual PKR
  const asing = temuan.filter((t) => !SAH.has(t));
  assert.deepEqual(asing, [], `kolom uang tak terduga di tabel operasional: ${asing.join(", ")}`);
  // Penanda uang di revisi: HANYA finance_before / finance_after (dibaca endpoint Finance).
  assert.ok(!temuan.some((t) => t.startsWith("pkr_item_revisions.") && !/finance_(before|after)$/.test(t)));
  // Kolom kanonis uang ada TEPAT di baris penjualan Finance.
  const kanonis = await testPrisma.$queryRawUnsafe(`select column_name from information_schema.columns where table_schema='public' and table_name='fin_penjualan_karyawan_items' and column_name in ('unit_price','quantity')`);
  assert.equal(kanonis.length, 2);
});

// ═══ 2. Satu sumber: rekonsiliasi setelah rangkaian koreksi ═══
test("satu sumber nilai: total = Σ jumlah×harga baris yang sama; piutang & jurnal satu kali; Order CRM 0; unit = Σ jumlah×komponen; tetap benar setelah ubah/tambah/hapus", async () => {
  const w = await siapkan();
  const p = await catat(w, [KASUR, { ...SET, jumlah: 2 }, STOK, SERVICE]);
  const order = await orderDari(p.id);

  const rekonsiliasi = async (etiket) => {
    const pkr = await testPrisma.finPenjualanKaryawan.findUnique({ where: { id: p.id } });
    const baris = await testPrisma.finPenjualanKaryawanItem.findMany({ where: { penjualanId: p.id } });
    const sumBaris = baris.reduce((a, b) => a + Number(b.quantity) * Number(b.unitPrice), 0);
    assert.equal(Number(pkr.total), sumBaris, `${etiket}: total PKR = Σ jumlah×harga baris`);
    assert.equal(await netPiutang(p.id), sumBaris, `${etiket}: piutang bersih dari jurnal = total`);
    assert.equal(await testPrisma.finJournalEntry.count({ where: { source: "PENJUALAN_KARYAWAN", sourceId: p.id, status: "POSTED" } }), 1, `${etiket}: tepat satu jurnal penjualan berlaku`);
    const o = await testPrisma.order.findUnique({ where: { id: order.id } });
    assert.equal(o.value, 0, `${etiket}: Order CRM tidak membawa uang`);
    assert.equal(await testPrisma.orderItem.count(), 0, `${etiket}: tidak ada OrderItem (harga CRM)`);
    // unit aktif per baris = jumlah × Σ komponen (hanya baris berpekerjaan)
    for (const b of baris) {
      const rows = await testPrisma.pkrOrderItem.findMany({ where: { saleItemId: b.id, removedAt: null } });
      if (b.fulfillment === "AMBIL_STOK" || b.fulfillment === "TANPA_OPERASIONAL") { assert.equal(rows.length, 0, `${etiket}: ${b.name} tanpa item operasional`); continue; }
      const harapan = rows.reduce((a, r) => a + Number(b.quantity) * r.componentQty, 0);
      const qty = rows.reduce((a, r) => a + r.qty, 0);
      assert.equal(qty, harapan, `${etiket}: ${b.name} qty item operasional = jumlah×komponen`);
      const unitAktif = await hitung(`select count(*)::int n from units u join pkr_order_item_units l on l.unit_id = u.id join pkr_order_items i on i.id = l.item_id where i.sale_item_id = '${b.id}' and u.status::text <> 'CANCELLED'`);
      assert.equal(unitAktif, harapan, `${etiket}: ${b.name} unit aktif = jumlah×komponen`);
    }
    // Order.notes (cermin operasional) tidak memuat satu pun nilai uang baris
    const notes = String(o.notes ?? "");
    for (const b of baris) assert.ok(!new RegExp(`(?<![0-9])${Number(b.unitPrice)}(?![0-9])`).test(notes), `${etiket}: notes order memuat harga ${b.unitPrice}`);
  };

  await rekonsiliasi("awal");
  const r1 = await koreksi(w, p.id, [{ op: "ubah", no: 1, harga: 7_000_000 }, { op: "ubah", no: 2, jumlah: 3, harga: 9_000_000 }], 1);
  assert.equal(r1.status, 201, JSON.stringify(r1.body));
  await rekonsiliasi("ubah harga + jumlah (Set)");
  const r2 = await koreksi(w, p.id, [{ op: "tambah", item: { ...DIVAN, produkNama: "Divan Tambahan", harga: 1_500_000 } }, { op: "hapus", no: 3 }], 2);
  assert.equal(r2.status, 201, JSON.stringify(r2.body));
  await rekonsiliasi("tambah + hapus");
  const revisi = await testPrisma.pkrItemRevision.findMany({ where: { orderId: order.id }, orderBy: { revision: "asc" } });
  assert.deepEqual(revisi.map((r) => r.revision), [1, 2, 3], "revisi berurutan tanpa celah");
  assert.ok(revisi.slice(1).every((r) => r.financeBefore && r.financeAfter), "setiap koreksi mencatat sisi Finance sebelum/sesudah");
  assert.equal(await testPrisma.finJournalEntry.count({ where: { source: "REVERSAL" } }), 2, "dua koreksi nilai = dua jurnal pembalik, tidak lebih");
});

// ═══ 3. Tidak ada uang kedua: sampai DELIVERED dan lewat pintu CRM lama ═══
test("tidak ada Payment/invoice/pengakuan pendapatan/jurnal operasional kedua: order dikirim sampai DELIVERED, hook pendapatan melewati, pintu CRM lama menolak", async () => {
  const w = await siapkan();
  const p = await catat(w, [KASUR, DIVAN, SERVICE, STOK]);
  const order = await orderDari(p.id);
  const sebelum = await uangDokumenLain();
  assert.deepEqual([sebelum.payment, sebelum.invoice, sebelum.orderItem, sebelum.pendapatan, sebelum.jurnalPkr], [0, 0, 0, 0, 1]);

  // Order berjalan sampai diserahkan.
  await testPrisma.unit.updateMany({ where: { orderId: order.id }, data: { status: "DELIVERED" } });
  await testPrisma.order.update({ where: { id: order.id }, data: { status: "DELIVERED" } });
  const hook = await testPrisma.$transaction((tx) => bukukanPengakuanPendapatan(tx, { orderId: order.id, status: "DELIVERED", userId: w.admin.id }));
  assert.equal(hook.posted, false); assert.equal(hook.skipped, true); assert.equal(hook.reason, "penjualan_karyawan");
  // Panggil sekali lagi (replay) — tetap tidak ada jurnal.
  await testPrisma.$transaction((tx) => bukukanPengakuanPendapatan(tx, { orderId: order.id, status: "DELIVERED", userId: w.admin.id }));
  assert.deepEqual(await uangDokumenLain(), sebelum, "diserahkan TIDAK menambah pembayaran/invoice/pendapatan/jurnal");

  // Pintu CRM lama: pembayaran, invoice, status bayar, item/harga, pembatalan langsung — semua ditolak untuk order PKR.
  const tolak = async (aksi, r) => assert.ok(r.status >= 400 && r.status < 500, `${aksi}: ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
  await tolak("bayar", await w.admin.c.post(`/api/orders/${order.id}/payments`, { amount: 100000, method: "TRANSFER", cashAccountId: w.bank.id }, kunci()));
  await tolak("invoice", await w.admin.c.post(`/api/orders/${order.id}/invoice`, {}, kunci()));
  await tolak("status bayar", await w.admin.c.patch(`/api/orders/${order.id}`, { paymentStatus: "LUNAS" }));
  await tolak("item", await w.admin.c.post(`/api/orders/${order.id}/items`, { layananName: "Tambahan", harga: 500000 }, kunci()));
  await tolak("batal langsung", await w.admin.c.post(`/api/orders/${order.id}/cancel`, { reason: "uji" }, kunci()));
  const sesudah = await testPrisma.order.findUnique({ where: { id: order.id } });
  assert.equal(sesudah.value, 0); assert.equal(sesudah.paymentStatus, "BELUM_BAYAR");
  assert.deepEqual(await uangDokumenLain(), sebelum, "pintu CRM lama tidak menulis apa pun");
  // Harga setelah diserahkan tetap bisa dikoreksi — satu jalur, jurnal pembalik + pengganti, bukan pembayaran.
  const k = await koreksi(w, p.id, [{ op: "ubah", no: 1, harga: 7_000_000 }], 1);
  assert.equal(k.status, 201, JSON.stringify(k.body));
  const akhir = await uangDokumenLain();
  assert.deepEqual([akhir.payment, akhir.invoice, akhir.orderItem, akhir.pendapatan], [0, 0, 0, 0]);
  assert.equal(await netPiutang(p.id), 7_000_000 + 1_234_567 + 3_210_987 + 2 * 111_111);
});

// ═══ 4. Matriks progres Produksi ═══
test("matriks progres: status IN_PRODUCTION / READY_FOR_DELIVERY / IN_TRANSIT_OUT / DELIVERED, tahap aktif, atau log tahap menutup jumlah/ukuran/hapus (ITEM_TERKUNCI); harga tetap boleh", async () => {
  const w = await siapkan();
  const tahap = await testPrisma.routingStage.findFirst({ orderBy: { sequence: "asc" } });
  assert.ok(tahap, "tahap routing dari migrasi harus ada");
  const pemicu = [
    ["status IN_PRODUCTION", (u) => testPrisma.unit.update({ where: { id: u.id }, data: { status: "IN_PRODUCTION" } })],
    ["status READY_FOR_DELIVERY", (u) => testPrisma.unit.update({ where: { id: u.id }, data: { status: "READY_FOR_DELIVERY" } })],
    ["status IN_TRANSIT_OUT", (u) => testPrisma.unit.update({ where: { id: u.id }, data: { status: "IN_TRANSIT_OUT" } })],
    ["status DELIVERED", (u) => testPrisma.unit.update({ where: { id: u.id }, data: { status: "DELIVERED" } })],
    ["tahap aktif (currentStageId)", (u) => testPrisma.unit.update({ where: { id: u.id }, data: { currentStageId: tahap.id } })],
    ["log tahap", (u) => testPrisma.unitStageLog.create({ data: { unitId: u.id, stageId: tahap.id, action: "START" } })],
  ];
  for (const [nama, picu] of pemicu) {
    const p = await catat(w, [KASUR, DIVAN], { buyerName: `Pembeli ${nama}` });
    const order = await orderDari(p.id);
    const unit = (await unitDi(order.id))[0];
    await picu(unit);
    const lamaRows = JSON.stringify(await testPrisma.pkrOrderItem.findMany({ where: { orderId: order.id }, orderBy: { seq: "asc" }, select: { qty: true, productName: true, lengthCm: true, perluDikirim: true, removedAt: true } }));
    const jumlahUnit = (await unitDi(order.id)).length;
    for (const [aksi, op] of [["jumlah", { op: "ubah", no: 1, jumlah: 2 }], ["ukuran", { op: "ubah", no: 1, panjang: 210 }], ["hapus", { op: "hapus", no: 1 }], ["kirim", { op: "ubah", no: 1, perluDikirim: false }]]) {
      const r = await koreksi(w, p.id, [op], 1, `Coba ubah ${aksi} saat ${nama}`);
      assert.equal(r.status, 409, `${nama}/${aksi}: ${r.status} ${JSON.stringify(r.body)}`);
      assert.equal(r.body.code, "ITEM_TERKUNCI", `${nama}/${aksi}`);
      assert.match(r.body.petunjuk ?? r.body.error, /pembatalan/i);
    }
    assert.equal(JSON.stringify(await testPrisma.pkrOrderItem.findMany({ where: { orderId: order.id }, orderBy: { seq: "asc" }, select: { qty: true, productName: true, lengthCm: true, perluDikirim: true, removedAt: true } })), lamaRows, `${nama}: tidak ada yang berubah`);
    assert.equal((await unitDi(order.id)).length, jumlahUnit, `${nama}: jumlah unit tetap`);
    const harga = await koreksi(w, p.id, [{ op: "ubah", no: 1, harga: 7_000_000 }], 1, `Harga administratif saat ${nama}`);
    assert.equal(harga.status, 201, `${nama}/harga: ${JSON.stringify(harga.body)}`);
    assert.equal(await netPiutang(p.id), 7_000_000 + 1_234_567, `${nama}: jurnal mengikuti harga baru`);
  }
});

// ═══ 5. Pemenuhan tidak bisa diubah di tempat ═══
test("pemenuhan/kategori tidak bisa diubah di tempat (409); hapus + tambah baru dalam satu permintaan = atomik: item lama CANCELLED, unit baru, jurnal & revisi konsisten", async () => {
  const w = await siapkan();
  const p = await catat(w, [KASUR, DIVAN]);
  const order = await orderDari(p.id);
  const tolak = await koreksi(w, p.id, [{ op: "ubah", no: 1, pemenuhan: "AMBIL_STOK" }], 1);
  assert.equal(tolak.status, 409); assert.equal(tolak.body.code, "KATEGORI_TIDAK_BISA_DIUBAH");
  const tolak2 = await koreksi(w, p.id, [{ op: "ubah", no: 1, kategori: "DIVAN_BOX" }], 1);
  assert.equal(tolak2.body.code, "KATEGORI_TIDAK_BISA_DIUBAH");
  assert.equal((await unitDi(order.id)).length, 2);
  // Ganti Kasur produksi baru -> ambil dari stok: hapus baris 1, tambah baris stok, satu permintaan
  const ganti = await koreksi(w, p.id, [{ op: "hapus", no: 1 }, { op: "tambah", item: { ...STOK, nama: "Kasur stok display", jumlah: 1, harga: 6_500_000 } }], 1, "Customer memilih kasur display dari stok");
  assert.equal(ganti.status, 201, JSON.stringify(ganti.body));
  const units = await unitDi(order.id);
  assert.equal(units.filter((u) => u.status !== "CANCELLED").length, 1, "tinggal divan");
  const aktif = await testPrisma.pkrOrderItem.findMany({ where: { orderId: order.id, removedAt: null } });
  assert.equal(aktif.length, 1);
  assert.equal(await netPiutang(p.id), 1_234_567 + 6_500_000);
  assert.equal(await testPrisma.finJournalEntry.count({ where: { source: "PENJUALAN_KARYAWAN", sourceId: p.id, status: "POSTED" } }), 1);
  assert.equal(await testPrisma.pkrItemRevision.count({ where: { orderId: order.id } }), 2);
  assert.equal((await testPrisma.order.findUnique({ where: { id: order.id } })).value, 0);
  const uang = await uangDokumenLain();
  assert.deepEqual([uang.payment, uang.invoice, uang.orderItem], [0, 0, 0]);
});

// ═══ 6. Replay & paralel (kunci sama) ═══
test("replay & paralel: koreksi dengan KUNCI SAMA dikirim bersamaan = satu revisi, satu jurnal pembalik; Lengkapi spesifikasi ulang tidak menggandakan unit/item/revisi", async () => {
  const w = await siapkan();
  const p = await catat(w, [KASUR, DIVAN]);
  const order = await orderDari(p.id);
  const k = kunci();
  const operasi = [{ op: "ubah", no: 2, harga: 1_500_000 }];
  const [a, b] = await Promise.all([koreksi(w, p.id, operasi, 1, "Harga divan naik", k), koreksi(w, p.id, operasi, 1, "Harga divan naik", k)]);
  assert.ok([a.status, b.status].includes(201), JSON.stringify([a.status, b.status, a.body, b.body]));
  assert.ok([a.status, b.status].every((s) => [200, 201, 409].includes(s)), JSON.stringify([a.status, b.status]));
  const c = await koreksi(w, p.id, operasi, 1, "Harga divan naik", k);
  assert.ok([200, 201].includes(c.status), JSON.stringify(c.body));
  assert.equal(await testPrisma.pkrItemRevision.count({ where: { orderId: order.id } }), 2, "tepat dua revisi (awal + satu koreksi)");
  assert.equal(await testPrisma.finJournalEntry.count({ where: { source: "REVERSAL" } }), 1);
  assert.equal(await testPrisma.finJournalEntry.count({ where: { source: "PENJUALAN_KARYAWAN", sourceId: p.id, status: "POSTED" } }), 1);
  assert.equal(await netPiutang(p.id), 7_654_321 + 1_500_000);
  assert.equal((await unitDi(order.id)).length, 2);

  // Lengkapi spesifikasi: kunci sama = tidak menambah unit/item; tidak mengubah uang
  const kl = kunci();
  const body = { items: [{ no: 1, spesifikasi: "Kain premium abu" }] };
  const [x, y] = await Promise.all([w.finance.c.put(`${BASE}/${p.id}/order-crm`, body, kl), w.finance.c.put(`${BASE}/${p.id}/order-crm`, body, kl)]);
  assert.ok([x.status, y.status].every((s) => [200, 201, 409].includes(s)), JSON.stringify([x.body, y.body]));
  assert.equal(await testPrisma.pkrOrderItem.count({ where: { orderId: order.id } }), 2);
  assert.equal((await unitDi(order.id)).length, 2);
  assert.equal(await netPiutang(p.id), 7_654_321 + 1_500_000);
  const uang = await uangDokumenLain();
  assert.deepEqual([uang.payment, uang.invoice, uang.orderItem], [0, 0, 0]);
});

// ═══ 7. Set Kasur: satu harga induk, tiap komponen tanpa nilai ═══
test("Set Kasur: satu harga induk di Finance; komponen tidak punya harga di mana pun; koreksi harga Set mengubah SATU angka dan tidak menyentuh unit", async () => {
  const w = await siapkan();
  const p = await catat(w, [{ ...SET, jumlah: 2 }]);
  const order = await orderDari(p.id);
  const baris = await testPrisma.finPenjualanKaryawanItem.findMany({ where: { penjualanId: p.id } });
  assert.equal(baris.length, 1, "satu baris induk, bukan tiga baris anak");
  assert.equal(Number(baris[0].unitPrice), 9_999_999);
  const rows = await testPrisma.pkrOrderItem.findMany({ where: { orderId: order.id }, orderBy: { seq: "asc" } });
  assert.equal(rows.length, 3);
  assert.ok(rows.every((r) => r.saleItemId === baris[0].id && r.bundleNo === 1), "tiga komponen menautkan ke SATU baris induk");
  assert.equal(await testPrisma.finPenjualanKaryawanItem.count({ where: { name: { in: ["Kasur Set", "Divan Set", "Sandaran Set"] } } }), 0, "komponen bukan baris penjualan");
  const unitSebelum = JSON.stringify((await unitDi(order.id)).map((u) => [u.id, u.status]));
  const r = await koreksi(w, p.id, [{ op: "ubah", no: 1, harga: 8_888_888 }], 1);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(JSON.stringify((await unitDi(order.id)).map((u) => [u.id, u.status])), unitSebelum, "unit tidak tersentuh oleh koreksi harga");
  assert.equal(await netPiutang(p.id), 2 * 8_888_888);
  assert.equal(await testPrisma.finPenjualanKaryawanItem.count({ where: { penjualanId: p.id } }), 1);
});

// ═══ 8. Item tanpa pekerjaan tidak membuat unit/job ═══
test("item stok & tanpa operasional: tidak ada item operasional, unit, job pengiriman/pickup; hanya masuk total, jurnal, dan catatan order TANPA harga", async () => {
  const w = await siapkan();
  const p = await catat(w, [KASUR, STOK, JASA]);
  const order = await orderDari(p.id);
  assert.equal(await testPrisma.pkrOrderItem.count({ where: { orderId: order.id } }), 1);
  assert.equal((await unitDi(order.id)).length, 1);
  const stokBaris = await testPrisma.finPenjualanKaryawanItem.findMany({ where: { penjualanId: p.id, fulfillment: { in: ["AMBIL_STOK", "TANPA_OPERASIONAL"] } } });
  assert.equal(stokBaris.length, 2);
  assert.equal(await testPrisma.pkrOrderItem.count({ where: { saleItemId: { in: stokBaris.map((b) => b.id) } } }), 0);
  // siapkan unit kasur → job; stok/jasa tidak menambah job
  const [u] = await unitDi(order.id);
  await testPrisma.unit.update({ where: { id: u.id }, data: { status: "READY_FOR_DELIVERY" } });
  await testPrisma.$transaction((tx) => suggestDeliveryJob(tx, u.id));
  assert.equal(await testPrisma.job.count({ where: { orderId: order.id } }), 1);
  assert.equal(await netPiutang(p.id), 7_654_321 + 2 * 111_111 + 55_555);
  // Hanya stok + jasa: tidak ada order sama sekali
  const q = await catat(w, [STOK, JASA], { buyerName: "Pak Stok" });
  assert.equal(await orderDari(q.id), null);
  assert.equal(await testPrisma.job.count({ where: { orderId: order.id } }), 1, "tidak ada job tambahan");
});

// ═══ 9. Sapuan kebocoran: SEMUA endpoint GET (+ export) sebagai peran non-Finance ═══
function daftarGet(appExpress) {
  const hasil = [];
  const prefixDari = (layer) => {
    if (layer.regexp?.fast_slash) return "";
    const s = layer.regexp.source.replace("\\/?(?=\\/|$)", "").replace(/^\^/, "").replace(/\\\//g, "/");
    return /[()[\]?*+|\\]/.test(s) ? null : s;
  };
  const jalan = (stack, awalan) => {
    for (const l of stack) {
      if (l.route) {
        if (typeof l.route.path === "string" && l.route.methods.get) hasil.push(awalan + (l.route.path === "/" ? "" : l.route.path));
      } else if (l.name === "router" && l.handle?.stack) {
        const p = prefixDari(l);
        if (p !== null) jalan(l.handle.stack, awalan + p);
      }
    }
  };
  jalan(appExpress._router.stack, "");
  return [...new Set(hasil)];
}

test("sapuan kebocoran: tak satu pun endpoint GET (Produksi/Delivery/Gudang/CRM/Finance) memuat angka harga atau total PKR bagi peran non-Finance; export Finance menolak peran operasional", async () => {
  const w = await siapkan({ peranOperasional: PERAN_OPERASIONAL });
  const p = await catat(w, [KASUR, DIVAN, SANDARAN, { ...SET, jumlah: 1 }, SERVICE, STOK, JASA]);
  const order = await orderDari(p.id);
  const units = await unitDi(order.id);
  // Job pengiriman nyata + satu koreksi (revisi bernilai) supaya semua tabel turunan terisi.
  await testPrisma.unit.updateMany({ where: { orderId: order.id, productLine: { not: null } }, data: { status: "READY_FOR_DELIVERY" } });
  for (const u of units) await testPrisma.$transaction((tx) => suggestDeliveryJob(tx, u.id)).catch(() => null);
  const k = await koreksi(w, p.id, [{ op: "ubah", no: 1, harga: 8_000_001 }], 1, "Naik harga bahan baku");
  assert.equal(k.status, 201, JSON.stringify(k.body));
  const job = await testPrisma.job.findFirst({ where: { orderId: order.id } });
  const pkrBaru = await testPrisma.finPenjualanKaryawan.findUnique({ where: { id: p.id } });

  const HARGA = [7654321, 1234567, 876543, 9999999, 3210987, 111111, 55555, 8000001, Number(pkrBaru.total), p.total];
  const polaBocor = new RegExp(`(?<![0-9])(${[...new Set(HARGA)].join("|")})(?![0-9.])`);
  const dasar = {
    orderId: order.id, orderID: order.id, unitId: units[0].id, jobId: job?.id ?? randomUUID(), penjualanId: p.id, pkrId: p.id, customerId: order.customerId,
    stageId: randomUUID(), itemId: randomUUID(), date: "2026-10-02", code: "KASUR_BARU",
  };
  const alternatifId = [order.id, units[0].id, job?.id ?? randomUUID(), p.id];
  const sub = (path) => {
    const nama = [...path.matchAll(/:(\w+)\??/g)].map((m) => m[1]);
    if (nama.length === 0) return [path];
    const kandidat = nama.map((n) => (n === "id" ? alternatifId : [dasar[n] ?? randomUUID()]));
    const hasil = [];
    const rakit = (i, acc) => {
      if (i === nama.length) { let s = path; nama.forEach((n, j) => { s = s.replace(new RegExp(`:${n}\\??`), acc[j]); }); hasil.push(s); return; }
      for (const v of kandidat[i]) rakit(i + 1, [...acc, v]);
    };
    rakit(0, []);
    return hasil.slice(0, 4);
  };
  const semuaGet = daftarGet(app).filter((x) => x.startsWith("/api/") && !/\/(stream|events|socket|download|zip)\b/.test(x));
  const url = [...new Set(semuaGet.flatMap(sub))];
  assert.ok(url.length > 100, `sapuan harus mencakup banyak endpoint (${url.length})`);

  const bocor = []; let dipanggil = 0; let galat5xx = 0;
  const periksa = async (peran, u) => {
    let r;
    try { r = await fetch(`${server.baseUrl}${u}`, { headers: { Authorization: `Bearer ${peran.token}` }, signal: AbortSignal.timeout(15000) }); } catch { return; }
    dipanggil += 1;
    if (r.status >= 500) galat5xx += 1;
    const ct = r.headers.get("content-type") || "";
    if (!/json|text|csv|xml|html/.test(ct)) return;
    const teks = await r.text();
    const m = polaBocor.exec(teks);
    if (m) bocor.push(`${peran.nama} GET ${u} -> ${r.status} memuat ${m[1]}`);
  };
  const pekerja = [];
  for (const [nama, peran] of Object.entries(w.operasional)) for (const u of url) pekerja.push({ peran: { ...peran, nama }, u });
  const KONKUREN = 10;
  let idx = 0;
  await Promise.all(Array.from({ length: KONKUREN }, async () => { while (idx < pekerja.length) { const t = pekerja[idx++]; await periksa(t.peran, t.u); } }));
  console.log(`  sapuan kebocoran: ${url.length} URL × ${Object.keys(w.operasional).length} peran = ${dipanggil} panggilan; 5xx=${galat5xx}`);
  assert.deepEqual(bocor, [], `harga/total PKR bocor:\n${bocor.slice(0, 10).join("\n")}`);

  // Export Finance: peran operasional tidak boleh menghasilkan berkas (401/403).
  const dibuka = [];
  for (const modul of Object.keys(MODUL_EXPORT)) {
    for (const [nama, peran] of Object.entries(w.operasional)) {
      const r = await peran.c.post(`/api/finance/export/${modul}`, { periode: { from: "2026-10-01", to: "2026-10-31" } });
      if (![401, 403].includes(r.status)) dibuka.push(`${nama} ${modul} -> ${r.status}`);
    }
  }
  assert.deepEqual(dibuka, [], `export Finance terbuka bagi peran operasional: ${dibuka.join("; ")}`);
});

// ═══ 10. Uji perilaku rehearsal skrip rilis (SQL yang SAMA) ═══
test("uji perilaku rehearsal pada skrip rilis: blok SQL yang dijalankan di DB hasil restore menolak 14 data salah, meloloskan 5 data benar, lalu dibatalkan semua", async () => {
  const { readFileSync } = await import("node:fs");
  const skrip = readFileSync(new URL("../../../scripts/release-pkr-item-penjualan-pemenuhan.sh", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const m = /<<'UJISQL'\n([\s\S]*?)\nUJISQL\n/.exec(skrip);
  assert.ok(m, "blok UJISQL tidak ditemukan di skrip rilis");
  const w = await siapkan();
  await catat(w, [KASUR, DIVAN]); // contoh baris untuk blok uji (Order + PKR + kategori katalog)
  const sebelum = { baris: await testPrisma.finPenjualanKaryawanItem.count(), item: await testPrisma.pkrOrderItem.count(), revisi: await testPrisma.pkrItemRevision.count() };
  await assert.rejects(() => testPrisma.$executeRawUnsafe(m[1]), (e) => {
    const pesan = String(e.message);
    assert.ok(!/TIDAK_DITOLAK/.test(pesan), `ada data salah yang lolos: ${pesan.slice(0, 300)}`);
    assert.match(pesan, /ROLLBACK_UJI tolak=14 lolos=5 lewat=0/);
    return true;
  });
  assert.deepEqual({ baris: await testPrisma.finPenjualanKaryawanItem.count(), item: await testPrisma.pkrOrderItem.count(), revisi: await testPrisma.pkrItemRevision.count() }, sebelum, "blok uji dibatalkan seluruhnya");
});
