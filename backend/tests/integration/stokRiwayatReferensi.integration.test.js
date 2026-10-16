// Catatan REFERENSI historis dari file: pratinjau → simpan idempoten → tampil. Invarian utama: saldo, movement, GR, Material Issue, adjustment, jurnal TIDAK berubah; tanggal pemakaian tidak pernah terisi.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestMaterial, createTestUser, seedBalance } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.after(async () => { await server.close(); await truncateAll(); await testPrisma.$disconnect(); });
test.afterEach(async () => { await truncateAll(); });

const akun = async (roles) => { const u = await createTestUser({ roles }); return { ...u, c: makeClient(server.baseUrl, u.token) }; };
const kol = (o) => { const r = Array(22).fill(""); r[0] = o.no; r[1] = o.resi; r[2] = "DONE F"; r[3] = "PIC"; r[4] = "Pelanggan"; r[8] = o.tgl; r[9] = o.label; r[10] = "Bahan"; r[11] = o.nama; r[14] = o.qty; r[15] = o.sat; return r.join(","); };
const pakaiCsv = (rows) => ["JURNAL", "x", "No,Resi", ...rows.map((r, i) => kol({ no: i + 1, ...r }))].join("\n");
const beliHead = "BULAN KRM,TGL PO,TANGGAL KIRIM,NO SURAT JALAN,NO INVOICE,JENIS,Product Code,Product Description,VENDOR NAME,HARGA EXC,harga inc,satuan,PACK,PO,QTY kirim,PURCHASE INC,PURCHASE EXC,CATATAN,CAT BARANG,BRAND,FOTO,TOP,JATUH TEMPO,BULAN TEMPO,PEMBAYARAN";
const beliRow = (kirim, sj, nama, qty, sat = "METER") => { const r = Array(25).fill(""); r[0] = "OKT"; r[1] = kirim; r[2] = kirim; r[3] = sj; r[5] = "BAHAN BAKU"; r[7] = nama; r[8] = "VENDOR"; r[11] = sat; r[14] = qty; return r.join(","); };
const snapshot = async () => ({
  mov: await testPrisma.stockMovement.count(), saldo: String((await testPrisma.stockMovement.aggregate({ _sum: { qty: true } }))._sum.qty ?? 0), adj: await testPrisma.stockAdjustmentRequest.count(), cnt: await testPrisma.stockCount.count(),
  jurnal: await testPrisma.finJournalEntry.count(), gr: await testPrisma.goodsReceipt.count(), mi: await testPrisma.materialIssue.count(),
});

async function siapkan() {
  const a = await createTestMaterial({ unit: "METER", name: "Kain Ref A" }); const b = await createTestMaterial({ unit: "METER", name: "Kain Ref B" });
  const c = await createTestMaterial({ unit: "ROLL", name: "List Ref C" }); const d = await createTestMaterial({ unit: "PCS", name: "Paku Ref D" });
  for (const m of [a, b, c, d]) await seedBalance(m.id, 100);
  const cust = await testPrisma.customer.create({ data: { name: "P" } });
  const mkOrder = async (no) => { const o = await testPrisma.order.create({ data: { customerId: cust.id, value: 0, orderNumber: no } }); const u = await testPrisma.unit.create({ data: { unitCode: `${no}-U1`, orderId: o.id, seq: 1 } }); return { o, u }; };
  return { a, b, c, d, mkOrder };
}
const post = (u, path, body) => u.c.post(`/api/inventory/riwayat-referensi${path}`, body);

test("hak akses: SALES ditolak semua; pembaca saja boleh melihat tetapi tidak pratinjau/impor", async () => {
  const sales = await akun(["SALES"]); const lead = await akun(["PRODUCTION_LEAD"]); const gudang = await akun(["WAREHOUSE"]);
  for (const [m, p] of [["get", ""], ["get", "/ringkasan"], ["get", "/impor"]]) assert.equal((await sales.c[m](`/api/inventory/riwayat-referensi${p}`)).status, 403, `SALES ${p}`);
  assert.equal((await post(sales, "/pratinjau", { pakaiCsv: "x" })).status, 403); assert.equal((await post(sales, "/impor", { pakaiCsv: "x" })).status, 403);
  assert.equal((await lead.c.get("/api/inventory/riwayat-referensi")).status, 200, "PRODUCTION_LEAD memegang inventory:read");
  assert.equal((await post(lead, "/pratinjau", { pakaiCsv: "x" })).status, 403); assert.equal((await post(lead, "/impor", { pakaiCsv: "x" })).status, 403);
  assert.equal((await post(gudang, "/pratinjau", {})).status, 400, "berkas wajib");
  assert.equal((await gudang.c.get("/api/inventory/riwayat-referensi/material/bukan-uuid")).status, 400);
});

test("pratinjau tidak menulis; impor wajib hash pratinjau; impor ulang idempoten; saldo/movement/GR/Issue/adjustment/jurnal tidak berubah", async () => {
  const w = await akun(["WAREHOUSE"]); const { a, b } = await siapkan();
  const csv = pakaiCsv([{ resi: "RES-23092026-145", tgl: "2026-09-23", label: "OKT", nama: a.name, qty: '"2,0"', sat: "METER" }, { resi: "RES-05102026-010", tgl: "2026-10-05", label: "OKT", nama: b.name, qty: "3", sat: "METER" }]);
  const awal = await snapshot(); const refAwal = await testPrisma.stokRiwayatReferensi.count();
  const pv = await post(w, "/pratinjau", { pakaiCsv: csv, namaBerkasPakai: "Pemakaian.csv" }); assert.equal(pv.status, 200, JSON.stringify(pv.body));
  assert.match(pv.body.label, /bukan transaksi resmi/); assert.equal(pv.body.ringkasan.pemakaianOrderBahan, 2); assert.equal(pv.body.ringkasan.tanggalPemakaian, "KOSONG untuk semua baris (tidak ada bukti)");
  assert.equal(await testPrisma.stokRiwayatReferensi.count(), refAwal, "pratinjau tidak menyimpan"); assert.deepEqual(await snapshot(), awal);

  const tanpaHash = await post(w, "/impor", { pakaiCsv: csv }); assert.equal(tanpaHash.status, 409); assert.equal(tanpaHash.body.code, "PRATINJAU_BERUBAH");
  const hashSalah = await post(w, "/impor", { pakaiCsv: csv + "\n", konfirmasiHash: pv.body.hashKonten.replace(/^./, "0") }); assert.equal(hashSalah.status, 409);
  assert.equal(await testPrisma.stokRiwayatReferensi.count(), 0, "gagal konfirmasi = tidak ada yang tersimpan");

  const i1 = await post(w, "/impor", { pakaiCsv: csv, namaBerkasPakai: "Pemakaian.csv", konfirmasiHash: pv.body.hashKonten }); assert.equal(i1.status, 201, JSON.stringify(i1.body));
  assert.equal(i1.body.baru, 2); assert.equal(i1.body.dilewati, 0);
  const i2 = await post(w, "/impor", { pakaiCsv: csv, namaBerkasPakai: "Pemakaian.csv", konfirmasiHash: pv.body.hashKonten }); assert.equal(i2.status, 201);
  assert.equal(i2.body.baru, 0); assert.equal(i2.body.dilewati, 2); assert.equal(await testPrisma.stokRiwayatReferensi.count(), 2, "impor ulang tidak menggandakan");
  assert.equal(await testPrisma.stokRiwayatImpor.count(), 2, "setiap percobaan impor tercatat sebagai batch (audit)");
  assert.deepEqual(await snapshot(), awal, "saldo, movement, adjustment, count, jurnal, GR, Material Issue tidak berubah");
  const audit = await testPrisma.activityEvent.findMany({ where: { entityType: "stok_riwayat_referensi" } }); assert.equal(audit.length, 2); assert.equal(audit[0].actorId, w.user.id);
  const baris = await testPrisma.stokRiwayatReferensi.findMany(); assert.ok(baris.every((r) => r.tanggalPemakaian === null && r.statusVerifikasi === "BELUM_DIVERIFIKASI"));
  const x = baris.find((r) => r.nomorOrder === "RES-23092026-145"); assert.equal(x.labelBulanFile, "OKT"); assert.equal(x.tanggalOrder.toISOString().slice(0, 10), "2026-09-23");
  assert.ok(x.peringatan.some((p) => /Label bulan file "OKT" tidak cocok/.test(p)), "label OKT pada tanggal September tidak dipercaya");
});

test("revisi: isi berubah → revisi baru, yang lama aktif=false tetap tersimpan; DB menolak DELETE/UPDATE selain aktif, dan tanggal pemakaian terisi", async () => {
  const w = await akun(["WAREHOUSE"]); const { a } = await siapkan();
  const impor = async (qty) => { const csv = pakaiCsv([{ resi: "RES-05102026-010", tgl: "2026-10-05", label: "OKT", nama: a.name, qty, sat: "METER" }]); const pv = await post(w, "/pratinjau", { pakaiCsv: csv }); return post(w, "/impor", { pakaiCsv: csv, konfirmasiHash: pv.body.hashKonten }); };
  assert.equal((await impor("3")).body.baru, 1); const r2 = await impor("4"); assert.equal(r2.body.direvisi, 1);
  const semua = await testPrisma.stokRiwayatReferensi.findMany({ orderBy: { revisi: "asc" } }); assert.deepEqual(semua.map((r) => [r.revisi, r.aktif, Number(r.jumlah)]), [[1, false, 3], [2, true, 4]]);
  const aktif = await w.c.get("/api/inventory/riwayat-referensi"); assert.equal(aktif.body.baris.length, 1); assert.equal(aktif.body.baris[0].jumlah, 4);
  assert.equal((await w.c.get("/api/inventory/riwayat-referensi?semuaRevisi=1")).body.baris.length, 2);
  const id = semua[1].id;
  await assert.rejects(testPrisma.$executeRawUnsafe(`DELETE FROM stok_riwayat_referensi WHERE id='${id}'`), /append-only/);
  await assert.rejects(testPrisma.$executeRawUnsafe(`UPDATE stok_riwayat_referensi SET jumlah=99 WHERE id='${id}'`), /append-only/);
  await assert.rejects(testPrisma.$executeRawUnsafe(`UPDATE stok_riwayat_referensi SET tanggal_pemakaian='2026-10-05' WHERE id='${id}'`), /append-only|tanpa_tanggal_pemakaian/);
  await assert.rejects(testPrisma.$executeRawUnsafe(`UPDATE stok_riwayat_referensi SET aktif=true WHERE id='${semua[0].id}'`), /append-only/);
  await assert.rejects(testPrisma.$executeRawUnsafe("DELETE FROM stok_riwayat_impor"), /append-only/);
  await assert.rejects(testPrisma.$executeRawUnsafe(`INSERT INTO stok_riwayat_referensi (id, impor_id, kunci, revisi, konten_hash, jenis, nama_di_file, satuan_file, sumber_file, sumber_baris, status_verifikasi, tanggal_pemakaian, alasan_blocker, peringatan) SELECT gen_random_uuid(), impor_id, 'k', 1, 'h', 'PEMAKAIAN_ORDER', 'n', 's', 'f', '{1}', 'BELUM_DIVERIFIKASI', '2026-10-05', '{}', '{}' FROM stok_riwayat_referensi LIMIT 1`), /tanpa_tanggal_pemakaian/);
});

test("duplikasi terhadap resmi: Issue di ledger (order+bahan) → SUDAH_ADA_DI_RESMI; Issue belum diposting → ADA_DOKUMEN_RESMI_BELUM_DIPOSTING; bahan lain di order yang sama → peringatan; T0 tidak dipakai sebagai bukti 'sudah dipakai'", async () => {
  const w = await akun(["WAREHOUSE"]); const { a, b, c, d, mkOrder } = await siapkan();
  const o1 = await mkOrder("RES-05102026-010"); const o2 = await mkOrder("RES-06102026-011");
  await testPrisma.stockMovement.create({ data: { materialId: a.id, type: "ISSUE", qty: -3, unitId: o1.u.id, note: "Material Issue resmi", createdAt: new Date() } });
  await testPrisma.materialIssue.create({ data: { issueNumber: "MI-PEND-1", sourceType: "MANUAL", status: "APPROVED", unitId: o2.u.id, lines: { create: [{ materialId: b.id, requestedQty: 2 }] } } });
  const csv = pakaiCsv([
    { resi: "RES-05102026-010", tgl: "2026-10-05", label: "OKT", nama: a.name, qty: "3", sat: "METER" },      // sudah di ledger, qty sama
    { resi: "RES-05102026-010", tgl: "2026-10-05", label: "OKT", nama: c.name, qty: "1", sat: "ROLL" },      // order sama, bahan lain belum tercatat
    { resi: "RES-06102026-011", tgl: "2026-10-06", label: "OKT", nama: b.name, qty: "2", sat: "METER" },     // Material Issue belum diposting
    { resi: "RES-30092026-001", tgl: "2026-09-30", label: "OKT", nama: d.name, qty: "5", sat: "PCS" },       // sebelum T0, tanpa dokumen resmi: BUKAN dianggap sudah dipakai
    { resi: "RES-20102026-020", tgl: "2026-10-20", label: "OKT", nama: d.name, qty: "5", sat: "PCS" },       // tanggal ORDER ≥ T0: TETAP disimpan sebagai referensi (tanggal order bukan tanggal pemakaian)
  ]);
  const body = { pakaiCsv: csv, mulai: "2026-10-10T00:00:00+07:00" };
  const pv = await post(w, "/pratinjau", body); assert.equal(pv.status, 200);
  assert.equal(pv.body.ringkasan.dikecualikanKarenaT0, 0, "T0 tidak menyaring baris"); assert.equal(pv.body.ringkasan.baris, 5); assert.equal(pv.body.ringkasan.tanggalOrderSetelahT0, 1);
  const imp = await post(w, "/impor", { ...body, konfirmasiHash: pv.body.hashKonten }); assert.equal(imp.status, 201);
  const sel = async (kode) => (await w.c.get(`/api/inventory/riwayat-referensi/material/${kode}`)).body.baris[0];
  const ra = await sel(a.id); assert.equal(ra.statusVerifikasi, "SUDAH_ADA_DI_RESMI"); assert.equal(ra.dokumenResmi.jenis, "ISSUE_DI_LEDGER"); assert.equal(ra.dokumenResmi.qty, 3);
  const rc = await sel(c.id); assert.equal(rc.statusVerifikasi, "BELUM_DIVERIFIKASI"); assert.ok(rc.peringatan.some((p) => /ORDER_SUDAH_PUNYA_ISSUE_RESMI_BAHAN_LAIN/.test(p)));
  const rb = await sel(b.id); assert.equal(rb.statusVerifikasi, "ADA_DOKUMEN_RESMI_BELUM_DIPOSTING"); assert.match(JSON.stringify(rb.dokumenResmi), /MI-PEND-1/);
  const dRows = (await w.c.get(`/api/inventory/riwayat-referensi/material/${d.id}`)).body.baris; assert.equal(dRows.length, 2, "order sebelum dan sesudah T0 sama-sama tersimpan");
  const sebelumT0 = dRows.find((r) => r.nomorOrder === "RES-30092026-001"); const sesudahT0 = dRows.find((r) => r.nomorOrder === "RES-20102026-020");
  assert.equal(sebelumT0.statusVerifikasi, "BELUM_DIVERIFIKASI"); assert.equal(sebelumT0.tanggalPemakaian, null, "sebelum T0 ≠ pasti sudah dipakai");
  assert.equal(sesudahT0.statusVerifikasi, "BELUM_DIVERIFIKASI"); assert.equal(sesudahT0.tanggalPemakaian, null); assert.ok(sesudahT0.peringatan.some((p) => /Tanggal ORDER ≥ T0/.test(p)));
  assert.ok(ra.dokumenResmi.waktu, "waktu transaksi resmi dicatat"); assert.equal(ra.dokumenResmi.setelahT0, true, "Issue resmi dibuat sesudah T0 (waktu movement terbukti)");
  assert.equal(await testPrisma.stockMovement.count(), 4 + 1, "hanya seed 4 + 1 Issue resmi; impor tidak menambah movement");
});

test("antrean penyelesaian: tanpa pasangan, pemetaan tanda baca, satuan beda/campur, angka tidak valid — tidak dipetakan otomatis; alias manusia menyelesaikan", async () => {
  const w = await akun(["WAREHOUSE"]); const { a, b } = await siapkan();
  const m = await createTestMaterial({ unit: "METER", name: "Kain, Ref (X)" });
  const csv = pakaiCsv([
    { resi: "RES-05102026-001", tgl: "2026-10-05", label: "OKT", nama: "BAHAN TAK DIKENAL", qty: "1", sat: "PCS" },
    { resi: "RES-05102026-002", tgl: "2026-10-05", label: "OKT", nama: "Kain Ref X", qty: "1", sat: "METER" },           // hanya cocok tanpa tanda baca
    { resi: "RES-05102026-003", tgl: "2026-10-05", label: "OKT", nama: a.name, qty: "2", sat: "KG" },                    // satuan beda
    { resi: "RES-05102026-004", tgl: "2026-10-05", label: "OKT", nama: b.name, qty: "1", sat: "METER" },
    { resi: "RES-05102026-004", tgl: "2026-10-05", label: "OKT", nama: b.name, qty: "1", sat: "LEMBAR" },               // satuan campur
    { resi: "RES-05102026-005", tgl: "2026-10-05", label: "OKT", nama: b.name, qty: "abc", sat: "METER" },              // angka rusak
  ]);
  const pv = await post(w, "/pratinjau", { pakaiCsv: csv }); const A = pv.body.ringkasan.antrean;
  assert.deepEqual(A, { TANPA_PASANGAN: 1, PEMETAAN_PERLU_KONFIRMASI: 1, SATUAN_BEDA: 1, SATUAN_CAMPUR: 1, ANGKA_TIDAK_VALID: 1 }, JSON.stringify(A));
  assert.ok(pv.body.antrean.every((r) => r.statusVerifikasi === "PERLU_PENYELESAIAN"));
  const rusak = pv.body.antrean.find((r) => r.antrean === "ANGKA_TIDAK_VALID"); assert.equal(rusak.jumlah, null, "jumlah rusak bukan nol");
  const pemetaan = pv.body.antrean.find((r) => r.antrean === "PEMETAAN_PERLU_KONFIRMASI"); assert.equal(pemetaan.materialId, null, "tidak dipetakan otomatis");
  // alias manusia
  const pv2 = await post(w, "/pratinjau", { pakaiCsv: csv, alias: { "KAIN REF X": m.code } }); assert.equal(pv2.body.ringkasan.antrean.PEMETAAN_PERLU_KONFIRMASI, undefined);
  const imp = await post(w, "/impor", { pakaiCsv: csv, alias: { "KAIN REF X": m.code }, konfirmasiHash: pv2.body.hashKonten }); assert.equal(imp.status, 201);
  const antrean = await w.c.get("/api/inventory/riwayat-referensi?antrean=ADA"); assert.equal(antrean.body.baris.length, 4);
  assert.equal((await w.c.get("/api/inventory/riwayat-referensi?status=PERLU_PENYELESAIAN")).body.baris.length, 4);
  assert.equal((await w.c.get(`/api/inventory/riwayat-referensi/material/${m.id}`)).body.baris[0].statusVerifikasi, "BELUM_DIVERIFIKASI");
});

test("penerimaan: terbukti tiba tanpa GR = catatan pemeriksaan (bukan stok); ada GR selesai = SUDAH_ADA_DI_RESMI; estimasi dilewati; satuan beda → antrean", async () => {
  const w = await akun(["WAREHOUSE"]); const { a, b } = await siapkan();
  const kayu = await createTestMaterial({ unit: "ROD", name: "Kayu Ref K" });
  await testPrisma.goodsReceipt.create({ data: { receiptNumber: "GR-REF-1", sourceType: "PURCHASE_ORDER", status: "COMPLETED", receivedDate: new Date("2026-10-06T00:00:00Z"), arrivedDate: new Date("2026-10-06T00:00:00Z"), arrivalRecordedAt: new Date("2026-10-06T03:00:00Z"), arrivalReceiver: "IMAM", arrivalNote: "UTUH", arrivalWorkspace: "GUDANG", arrivalRevision: 1, deliveryNote: "SJ-1", lines: { create: [{ materialId: a.id, orderedQty: 10, receivedQty: 10, acceptedQty: 10 }] } } });
  const beli = [beliHead, beliRow("6 Oktober 2026", "SJ-1", a.name, 10), beliRow("9 Oktober 2026", "SJ-2", b.name, 5), beliRow("EST 12 oct", "", b.name, 9), beliRow("10 Oktober 2026", "", kayu.name, 2, "KUBIK")].join("\n");
  const awal = await snapshot();
  const pv = await post(w, "/pratinjau", { beliCsv: beli }); assert.equal(pv.status, 200, JSON.stringify(pv.body));
  assert.equal(pv.body.ringkasan.estimasiDilewati, 1); assert.equal(pv.body.ringkasan.penerimaanTerbuktiTanpaGR, 3);
  const imp = await post(w, "/impor", { beliCsv: beli, konfirmasiHash: pv.body.hashKonten }); assert.equal(imp.status, 201);
  const rows = (await w.c.get("/api/inventory/riwayat-referensi?jenis=PENERIMAAN_TERBUKTI_TANPA_GR")).body.baris;
  const byMat = (id) => rows.find((r) => r.material?.id === id);
  assert.equal(byMat(a.id).statusVerifikasi, "SUDAH_ADA_DI_RESMI"); assert.equal(byMat(a.id).dokumenResmi.nomor, "GR-REF-1");
  assert.equal(byMat(b.id).statusVerifikasi, "PERLU_PEMERIKSAAN"); assert.ok(byMat(b.id).peringatan.some((p) => /BUKAN stok masuk/.test(p)));
  assert.equal(byMat(kayu.id).antrean, "SATUAN_BEDA");
  assert.deepEqual(await snapshot(), awal, "penerimaan referensi tidak menambah stok");
});

test("ringkasan & daftar: label jelas, bukanSaldo, cakupan; tanggal pemakaian null", async () => {
  const w = await akun(["WAREHOUSE"]); const { a } = await siapkan();
  const csv = pakaiCsv([{ resi: "RES-05102026-010", tgl: "2026-10-05", label: "OKT", nama: a.name, qty: "3", sat: "METER" }]);
  const pv = await post(w, "/pratinjau", { pakaiCsv: csv }); await post(w, "/impor", { pakaiCsv: csv, konfirmasiHash: pv.body.hashKonten });
  const rg = await w.c.get("/api/inventory/riwayat-referensi/ringkasan"); assert.equal(rg.status, 200);
  assert.equal(rg.body.bukanSaldo, true); assert.match(rg.body.label, /bukan transaksi resmi/); assert.equal(rg.body.cakupan.tanggalOrderSampai, "2026-10-05"); assert.match(rg.body.tanggalPemakaian, /Tidak pernah diisi/);
  const ls = await w.c.get(`/api/inventory/riwayat-referensi?q=${encodeURIComponent(a.code)}`); assert.equal(ls.body.baris.length, 1); assert.equal(ls.body.baris[0].tanggalPemakaian, null); assert.equal((await w.c.get("/api/inventory/riwayat-referensi/impor")).body.impor.length, 1);
});

test("STATUS TERKINI tanpa impor ulang: belum diverifikasi → dokumen belum diposting → sudah diposting (termasuk transaksi sesudah T0); revisi append-only lewat /segarkan; idempoten", async () => {
  const w = await akun(["WAREHOUSE"]); const { a, b, mkOrder } = await siapkan(); const o = await mkOrder("RES-08102026-050");
  const csv = pakaiCsv([{ resi: "RES-08102026-050", tgl: "2026-10-08", label: "OKT", nama: a.name, qty: "2", sat: "METER" }, { resi: "RES-08102026-050", tgl: "2026-10-08", label: "OKT", nama: b.name, qty: "1", sat: "METER" }]);
  const T0 = "2026-10-10T00:00:00+07:00";
  const pv = await post(w, "/pratinjau", { pakaiCsv: csv, mulai: T0 }); await post(w, "/impor", { pakaiCsv: csv, mulai: T0, konfirmasiHash: pv.body.hashKonten });
  const lihat = async (m) => (await w.c.get(`/api/inventory/riwayat-referensi/material/${m.id}`)).body.baris[0];
  const awal = await snapshot();
  // (1) belum ada dokumen resmi
  let r = await lihat(a); assert.equal(r.statusVerifikasi, "BELUM_DIVERIFIKASI"); assert.equal(r.statusTersimpan, "BELUM_DIVERIFIKASI"); assert.equal(r.revisiTertinggal, false);
  // (2) Material Issue resmi dibuat (belum diposting) SESUDAH T0 — tanpa impor ulang
  const mi = await testPrisma.materialIssue.create({ data: { issueNumber: "MI-TRANS-1", sourceType: "MANUAL", status: "APPROVED", unitId: o.u.id, lines: { create: [{ materialId: a.id, requestedQty: 2 }] } } });
  r = await lihat(a); assert.equal(r.statusVerifikasi, "ADA_DOKUMEN_RESMI_BELUM_DIPOSTING", "status mengikuti tanpa impor ulang"); assert.equal(r.statusTersimpan, "BELUM_DIVERIFIKASI"); assert.equal(r.revisiTertinggal, true); assert.match(JSON.stringify(r.dokumenResmi), /MI-TRANS-1/);
  assert.equal((await lihat(b)).statusVerifikasi, "BELUM_DIVERIFIKASI", "bahan lain di order yang sama tidak ikut berubah");
  const ring1 = (await w.c.get("/api/inventory/riwayat-referensi/ringkasan")).body; assert.equal(ring1.perStatus.ADA_DOKUMEN_RESMI_BELUM_DIPOSTING, 1); assert.equal(ring1.revisiTertinggal, 1);
  assert.equal((await w.c.get("/api/inventory/riwayat-referensi?status=ADA_DOKUMEN_RESMI_BELUM_DIPOSTING")).body.baris.length, 1, "filter memakai status terkini");
  // (3) diposting → movement ISSUE sesudah T0
  await testPrisma.materialIssue.update({ where: { id: mi.id }, data: { status: "ISSUED" } });
  await testPrisma.stockMovement.create({ data: { materialId: a.id, type: "ISSUE", qty: -2, unitId: o.u.id, materialIssueId: mi.id, note: "Material Issue diposting", createdAt: new Date("2026-10-12T03:00:00Z") } });
  r = await lihat(a); assert.equal(r.statusVerifikasi, "SUDAH_ADA_DI_RESMI"); assert.equal(r.dokumenResmi.jenis, "ISSUE_DI_LEDGER"); assert.equal(r.dokumenResmi.setelahT0, true, "transaksi resmi sesudah T0 ditandai"); assert.equal(r.dokumenResmi.waktu, "2026-10-12T03:00:00.000Z");
  assert.deepEqual(r.dokumenResmi.dokumen, ["MI-TRANS-1"]);
  // MEMBUKA / MENYEGARKAN TAB = hanya GET: status terkini tampil, tetapi tidak ada revisi/batch/audit baru
  const hitungTulis = async () => ({ ref: await testPrisma.stokRiwayatReferensi.count(), aktif: await testPrisma.stokRiwayatReferensi.count({ where: { aktif: true } }), impor: await testPrisma.stokRiwayatImpor.count(), audit: await testPrisma.activityEvent.count({ where: { entityType: "stok_riwayat_referensi" } }) });
  const sebelumBuka = await hitungTulis(); const snapBuka = await snapshot();
  for (let ulang = 0; ulang < 3; ulang++) {
    for (const p of ["", "/ringkasan", "/impor", `/material/${a.id}`, `/material/${b.id}`, "?semuaRevisi=1", "?status=SUDAH_ADA_DI_RESMI", "?antrean=ADA"]) assert.equal((await w.c.get(`/api/inventory/riwayat-referensi${p}`)).status, 200, p);
  }
  assert.deepEqual(await hitungTulis(), sebelumBuka, "GET (membuka/menyegarkan tab, 3x) tidak menambah revisi, batch impor, atau audit"); assert.deepEqual(await snapshot(), snapBuka);
  const masihTertinggal = await lihat(a); assert.equal(masihTertinggal.statusVerifikasi, "SUDAH_ADA_DI_RESMI", "status terkini tetap dihitung saat GET"); assert.equal(masihTertinggal.revisiTertinggal, true, "snapshot belum dicatat karena tidak ada tindakan manual");
  // revisi dicatat append-only lewat /segarkan (TINDAKAN MANUAL, wajib konfirmasi); pembaca tanpa izin tulis ditolak
  assert.equal((await (await akun(["PRODUCTION_LEAD"])).c.post("/api/inventory/riwayat-referensi/segarkan", { konfirmasi: true })).status, 403);
  const tanpaKonfirmasi = await post(w, "/segarkan", {}); assert.equal(tanpaKonfirmasi.status, 400); assert.equal(tanpaKonfirmasi.body.code, "KONFIRMASI_DIPERLUKAN"); assert.equal(await testPrisma.stokRiwayatReferensi.count(), 2, "tanpa konfirmasi tidak menulis revisi");
  const sg = await post(w, "/segarkan", { konfirmasi: true }); assert.equal(sg.status, 200, JSON.stringify(sg.body)); assert.equal(sg.body.direvisi, 2, "bahan a berubah status; bahan b mendapat peringatan baru (order kini punya Issue resmi bahan lain)"); const pa = sg.body.perubahan.find((x) => x.dari === "BELUM_DIVERIFIKASI" && x.ke === "SUDAH_ADA_DI_RESMI"); assert.ok(pa); const pb = sg.body.perubahan.find((x) => x.ke === "BELUM_DIVERIFIKASI"); assert.ok(pb, "status b tetap BELUM; hanya peringatan");
  const revisi = (await w.c.get("/api/inventory/riwayat-referensi?semuaRevisi=1&order=RES-08102026-050")).body.baris.filter((x) => x.material.kode === a.code);
  assert.deepEqual(revisi.map((x) => [x.revisi, x.aktif, x.statusVerifikasi]), [[1, false, "BELUM_DIVERIFIKASI"], [2, true, "SUDAH_ADA_DI_RESMI"]], "revisi lama tetap tersimpan");
  r = await lihat(a); assert.equal(r.revisiTertinggal, false); assert.equal(r.statusTersimpan, "SUDAH_ADA_DI_RESMI"); assert.equal(r.revisi, 2);
  const lagi = await post(w, "/segarkan", { konfirmasi: true }); assert.equal(lagi.body.direvisi, 0, "idempoten");
  assert.equal(await testPrisma.stokRiwayatReferensi.count({ where: { aktif: true } }), 2);
  const audit = await testPrisma.activityEvent.findMany({ where: { entityType: "stok_riwayat_referensi" }, orderBy: { createdAt: "asc" } }); assert.deepEqual(audit.map((e) => e.metadata.aksi), ["IMPOR_RIWAYAT_REFERENSI", "SEGARKAN_STATUS_REFERENSI"]);
  // impor ulang file yang sama sesudah transisi: tidak menggandakan, tidak menimpa revisi 2
  const pv2 = await post(w, "/pratinjau", { pakaiCsv: csv, mulai: T0 }); const i2 = await post(w, "/impor", { pakaiCsv: csv, mulai: T0, konfirmasiHash: pv2.body.hashKonten });
  assert.equal(i2.body.baru, 0); assert.equal(i2.body.direvisi, 0, "hasil impor = hasil segarkan (konsisten)"); assert.equal(i2.body.dilewati, 2);
  // referensi tidak pernah mengubah saldo: hanya Issue resmi yang menambah movement
  const sesudah = await snapshot(); assert.equal(sesudah.mov, awal.mov + 1);
});

test("T0 tidak menyaring penerimaan: tanggal kirim sesudah T0 tetap tersimpan; GR resmi sesudah T0 menaikkan status tanpa impor ulang", async () => {
  const w = await akun(["WAREHOUSE"]); const { a } = await siapkan();
  const beli = [beliHead, beliRow("12 Oktober 2026", "SJ-NEW", a.name, 7)].join("\n"); const T0 = "2026-10-10T00:00:00+07:00";
  const pv = await post(w, "/pratinjau", { beliCsv: beli, mulai: T0 }); assert.equal(pv.body.ringkasan.penerimaanTerbuktiTanpaGR, 1);
  await post(w, "/impor", { beliCsv: beli, mulai: T0, konfirmasiHash: pv.body.hashKonten });
  const lihat = async () => (await w.c.get(`/api/inventory/riwayat-referensi/material/${a.id}`)).body.baris[0];
  assert.equal((await lihat()).statusVerifikasi, "PERLU_PEMERIKSAAN");
  const gr = await testPrisma.goodsReceipt.create({ data: { receiptNumber: "GR-NEW-1", sourceType: "PURCHASE_ORDER", status: "READY_FOR_PUTAWAY", arrivedDate: new Date("2026-10-12T00:00:00Z"), arrivalRecordedAt: new Date("2026-10-12T03:00:00Z"), arrivalReceiver: "IMAM", arrivalNote: "UTUH", arrivalWorkspace: "GUDANG", arrivalRevision: 1, deliveryNote: "SJ-NEW", lines: { create: [{ materialId: a.id, orderedQty: 7, receivedQty: 7, acceptedQty: 7 }] } } });
  let r = await lihat(); assert.equal(r.statusVerifikasi, "ADA_DOKUMEN_RESMI_BELUM_DIPOSTING"); assert.match(r.peringatan.join(" "), /belum diputaway/);
  await testPrisma.goodsReceipt.update({ where: { id: gr.id }, data: { status: "COMPLETED", receivedDate: new Date("2026-10-12T00:00:00Z") } });
  r = await lihat(); assert.equal(r.statusVerifikasi, "SUDAH_ADA_DI_RESMI"); assert.equal(r.dokumenResmi.nomor, "GR-NEW-1"); assert.equal(r.dokumenResmi.setelahT0, true);
  assert.equal(await testPrisma.stockMovement.count({ where: { goodsReceiptId: gr.id } }), 0, "catatan referensi tidak membuat movement/putaway");
});

test("GERBANG TERPISAH: impor catatan referensi jalan TANPA T0, TANPA cek fisik P1, dan dengan GR tertunda; tidak membuka transaksi operasional; saldo/movement/GR/jurnal tetap", async () => {
  const w = await akun(["WAREHOUSE"]);
  // bahan P1-like: ledger <= 0 (tanpa seedBalance) + GR draf tertunda → jalur operasional memang masih tertahan, tetapi impor referensi tidak boleh bergantung padanya
  const p1 = await createTestMaterial({ unit: "METER", name: "Busa P1 Uji" }); const ok = await createTestMaterial({ unit: "METER", name: "Kain Siap Uji" }); await seedBalance(ok.id, 50);
  const gr = await testPrisma.goodsReceipt.create({ data: { receiptNumber: "GR-TUNDA-1", sourceType: "PURCHASE_ORDER", status: "DRAFT", lines: { create: [{ materialId: p1.id, orderedQty: 5, receivedQty: 0, acceptedQty: 0 }] } } });
  const cust = await testPrisma.customer.create({ data: { name: "P" } }); const o = await testPrisma.order.create({ data: { customerId: cust.id, value: 0, orderNumber: "RES-02102026-070" } });
  await testPrisma.unit.create({ data: { unitCode: "RES-02102026-070-U1", orderId: o.id, seq: 1 } });
  const csv = pakaiCsv([{ resi: "RES-02102026-070", tgl: "2026-10-02", label: "OKT", nama: p1.name, qty: "2", sat: "METER" }, { resi: "RES-02102026-070", tgl: "2026-10-02", label: "OKT", nama: ok.name, qty: "1", sat: "METER" }]);
  const awal = await snapshot();
  // TANPA mulai (T0 belum ditetapkan)
  const pv = await post(w, "/pratinjau", { pakaiCsv: csv }); assert.equal(pv.status, 200, JSON.stringify(pv.body)); assert.equal(pv.body.ringkasan.t0, null); assert.equal(pv.body.ringkasan.tanggalOrderSetelahT0, null, "tanpa T0 tidak ada penilaian sebelum/sesudah T0");
  const imp = await post(w, "/impor", { pakaiCsv: csv, konfirmasiHash: pv.body.hashKonten }); assert.equal(imp.status, 201, JSON.stringify(imp.body)); assert.equal(imp.body.baru, 2);
  const batch = await testPrisma.stokRiwayatImpor.findFirst({ orderBy: { waktuImpor: "desc" } }); assert.equal(batch.mulaiT0, null, "T0 tidak diwajibkan");
  const rows = (await w.c.get("/api/inventory/riwayat-referensi?order=RES-02102026-070")).body.baris; assert.equal(rows.length, 2);
  for (const r of rows) { assert.equal(r.tanggalPemakaian, null); assert.equal(r.statusVerifikasi, "BELUM_DIVERIFIKASI"); assert.ok(!r.peringatan.some((x) => /Tanggal ORDER ≥ T0/.test(x)), "tanpa T0 tidak ada peringatan T0"); }
  const ring = (await w.c.get("/api/inventory/riwayat-referensi/ringkasan")).body; assert.equal(ring.t0, null); assert.equal(ring.resmiSetelahT0, 0);
  // gerbang operasional TIDAK terbuka oleh impor: tidak ada movement/GR/Issue/jurnal baru, GR tertunda tetap draf, ledger P1 tetap 0
  assert.deepEqual(await snapshot(), awal, "impor referensi tidak mengubah saldo/movement/adjustment/count/jurnal/GR/Material Issue");
  assert.equal((await testPrisma.goodsReceipt.findUnique({ where: { id: gr.id } })).status, "DRAFT");
  assert.equal(await testPrisma.stockMovement.count({ where: { materialId: p1.id } }), 0);
  // T0 kemudian ditetapkan (impor lain dengan T0): hanya PERINGATAN pada baris yang waktu pemakaiannya tak diketahui; baris tidak hilang, tanggal pemakaian tetap kosong
  const T0 = "2026-10-01T00:00:00+07:00"; const pv2 = await post(w, "/pratinjau", { pakaiCsv: csv, mulai: T0 }); const imp2 = await post(w, "/impor", { pakaiCsv: csv, mulai: T0, konfirmasiHash: pv2.body.hashKonten }); assert.equal(imp2.status, 201);
  const rows2 = (await w.c.get("/api/inventory/riwayat-referensi?order=RES-02102026-070")).body.baris; assert.equal(rows2.length, 2, "T0 tidak menyaring");
  assert.ok(rows2.every((r) => r.tanggalPemakaian === null && r.peringatan.some((x) => /Tanggal ORDER ≥ T0/.test(x))), "T0 hanya peringatan");
  assert.deepEqual(await snapshot(), awal);
});
