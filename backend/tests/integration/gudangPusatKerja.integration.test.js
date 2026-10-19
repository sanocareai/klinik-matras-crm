// UX GUDANG TAHAP 4 — Pusat Kerja: antrean kerja, terlambat/tertahan berdasarkan penyebab nyata, selesai terbaru, Pusat Masalah, pencarian. DB terisolasi, 100+ dokumen. Semua endpoint BACA-SAJA.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser, createTestMaterial, seedBalance } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { geser, tgl, mundurHari, TIBA, nomor, isiData } from "./setup/duniaPusatKerja.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const PK = "/api/inventory/pusat-kerja";
async function dunia() {
  const [gudang, lead, owner] = await Promise.all(["WAREHOUSE", "PRODUCTION_LEAD", "OWNER"].map((r) => createTestUser({ roles: [r] })));
  const c = (u) => makeClient(server.baseUrl, u.token);
  const bahan = await createTestMaterial({ code: "BUSA-A", name: "Busa A", unit: "SHEET", itemGroup: "REBONDED" });
  const bahan2 = await createTestMaterial({ code: "KAIN-B", name: "Kain B", unit: "METER", itemGroup: "KAIN" });
  const minus = await createTestMaterial({ code: "LEM-MINUS", name: "Lem Minus", unit: "KG" }); await seedBalance(minus.id, -4);
  await createTestMaterial({ code: "TANPA-CATATAN", name: "Tanpa Catatan", unit: "PCS" });
  await seedBalance(bahan.id, 10); await seedBalance(bahan2.id, 100);
  return { g: c(gudang), p: c(lead), o: c(owner), gudang, lead, owner, bahan, bahan2, minus };
}
const antrean = (b, kode) => b.antrean.find((a) => a.kode === kode);
const tertahan = (b, kode) => b.tertahan.find((a) => a.kode === kode);
const total = async () => ({ mov: await testPrisma.stockMovement.count(), jurnal: await testPrisma.finJournalEntry.count(), gr: await testPrisma.goodsReceipt.count(), mi: await testPrisma.materialIssue.count(), ev: await testPrisma.activityEvent.count(), st: await testPrisma.stockTransfer.count() });


test("Beranda kerja: antrean per jenis dengan hitungan, definisi, alasan, aksi utama, pemilik; 100+ dokumen; kosong lama tidak dihitung; Produksi V2 tidak dihitung bila pembaca mati", async () => {
  const w = await dunia(); const n = await isiData(w); const awal = await total();
  const r = await w.g.get(PK); assert.equal(r.status, 200, JSON.stringify(r.body)); const b = r.body;
  assert.ok(n.gr + n.mi + n.tr >= 100, "volume 100+ dokumen");
  assert.equal(antrean(b, "PENERIMAAN_AKAN_DATANG").jumlah, 60); assert.equal(antrean(b, "PENERIMAAN_PERIKSA").jumlah, 25, "15 tiba + 10 pemeriksaan; 10 dokumen kosong lama TIDAK dihitung");
  assert.equal(antrean(b, "PENERIMAAN_SIAP_STOK").jumlah, 5); assert.equal(antrean(b, "PERMINTAAN_BAHAN").jumlah, 30);
  assert.equal(antrean(b, "TRANSFER").jumlah, 14, "12 berjalan + 2 selesai dengan selisih terbuka (yang tanpa selisih tidak)"); assert.equal(antrean(b, "STOCK_COUNT").jumlah, 4);
  assert.equal(antrean(b, "KOREKSI_PENYESUAIAN").jumlah, 0, "gudang bukan penyetuju → pindah ke 'menunggu workspace lain'"); assert.equal(antrean(b, "PRODUKSI_BAHAN"), undefined, "antrean Produksi V2 tidak muncul bila pembaca mati"); assert.equal(b.ringkasan.produksiV2, "TIDAK_AKTIF");
  // batas per antrean + lebih
  const gd = antrean(b, "PENERIMAAN_AKAN_DATANG"); assert.equal(gd.item.length, 8); assert.equal(gd.lebih, 52); assert.equal(b.batasPerAntrean, 8);
  // isi item: dokumen, terkait, umur, status, alasan, aksi utama, pemilik, tautan fokus
  const it = gd.item[0]; for (const k of ["jenis", "id", "nomor", "terkait", "umurTeks", "status", "alasan", "pemilikLabel", "tautan"]) assert.ok(it[k] !== undefined && it[k] !== null, k); assert.ok(it.tautan.startsWith("/warehouse/dashboard/penerimaan/")); assert.equal(it.aksi.label, "Catat barang tiba");
  assert.ok(antrean(b, "PENERIMAAN_PERIKSA").item.some((x) => x.aksi?.label === "Periksa barang")); assert.equal(antrean(b, "PENERIMAAN_SIAP_STOK").item[0].aksi.label, "Simpan ke stok");
  assert.deepEqual([...new Set(antrean(b, "PERMINTAAN_BAHAN").item.map((x) => x.aksi?.kode))].sort(), ["KONFIRMASI_KELUAR", "SETUJUI", "SIAPKAN", "TANDAI_DIAMBIL"].filter((k) => antrean(b, "PERMINTAAN_BAHAN").item.some((x) => x.aksi?.kode === k)).sort());
  for (const a of b.antrean) assert.ok(a.definisi.tabel && a.definisi.masuk && a.definisi.keluar && a.definisi.pemilik && a.definisi.satuan, `definisi ${a.kode}`);
  // baca-saja: tidak ada yang tertulis
  assert.deepEqual(await total(), awal, "memanggil Beranda tidak menulis apa pun (dokumen, stok, jurnal, aktivitas)");
});

test("Terlambat/tertahan hanya dengan sebab NYATA: tanpa tanggal tidak pernah terlambat; stok tidak cukup per bahan; data wajib; menunggu workspace lain; perlu koreksi resmi", async () => {
  const w = await dunia(); await isiData(w); const b = (await w.g.get(`${PK}?batas=50`)).body;
  const lewat = tertahan(b, "JADWAL_LEWAT"); const grLewat = lewat.item.filter((x) => x.jenis === "penerimaan");
  assert.equal(grLewat.length, 20, "hanya 20 penerimaan dengan jadwal yang SUDAH lewat; 20 tanpa tanggal, 10 hari ini, 10 masa depan tidak"); assert.ok(grLewat.every((x) => /Lewat jadwal \d+ hari/.test(x.tertahan.teks)));
  assert.equal(lewat.item.filter((x) => x.jenis === "pengeluaran-material").length, 5, "permintaan dengan tanggal dibutuhkan lewat"); assert.equal(lewat.item.filter((x) => x.jenis === "opname").length, 1, "hitung terjadwal yang lewat; yang tanpa tanggal tidak");
  const gdTanpaTanggal = antrean(b, "PENERIMAAN_AKAN_DATANG").item.filter((x) => /tanpa tanggal/.test(x.alasan)); assert.equal(gdTanpaTanggal.length, 20); assert.ok(!lewat.item.some((x) => gdTanpaTanggal.some((y) => y.id === x.id)), "tanpa tanggal ≠ terlambat");
  const stok = tertahan(b, "STOK_TIDAK_CUKUP"); assert.equal(stok.item.filter((x) => x.jenis === "pengeluaran-material").length, 5, "hanya 5 permintaan yang meminta 50 > saldo 10"); assert.ok(stok.item.every((x) => x.cakupan === "BAHAN" && x.tertahan.teks.includes("BUSA-A")));
  const data = tertahan(b, "DATA_WAJIB"); assert.equal(data.item.filter((x) => /belum punya hasil/.test(x.tertahan.teks)).length, 5, "pemeriksaan belum lengkap"); assert.equal(data.item.filter((x) => /jumlah baik/.test(x.tertahan.teks)).length, 1, "Siap masuk stok tanpa jumlah baik");
  const ws = tertahan(b, "MENUNGGU_WORKSPACE"); assert.ok(ws.item.some((x) => x.jenis === "koreksi" && x.pemilik === "OWNER" && x.aksi === null), "koreksi menunggu penyetuju — bukan tindakan Gudang"); assert.ok(ws.item.some((x) => x.jenis === "penyesuaian"));
  const koreksiResmi = tertahan(b, "PERLU_KOREKSI_RESMI"); assert.equal(koreksiResmi.item.filter((x) => x.masalah === "SELISIH_TRANSFER").length, 2); assert.equal(koreksiResmi.item.filter((x) => x.masalah === "STOCK_COUNT_SELISIH").length, 1);
  assert.ok(b.tidakDihitung.some((x) => x.kode === "KONFLIK_REVISI"), "konflik revisi tidak punya sumber data → dinyatakan, tidak dikarang");
  // penyetuju (OWNER) justru mendapat koreksi di antrean kerjanya
  const o = (await w.o.get(`${PK}?batas=50`)).body; assert.equal(antrean(o, "KOREKSI_PENYESUAIAN").jumlah, 2); assert.equal(antrean(o, "KOREKSI_PENYESUAIAN").item.find((x) => x.jenis === "koreksi").aksi.label, "Putuskan koreksi");
});

test("Izin: akun baca-saja melihat antrean tanpa tombol aksi; penyetuju berbeda; paginasi antrean per halaman; selesai terbaru; definisi sebab", async () => {
  const w = await dunia(); await isiData(w);
  const ro = (await w.p.get(`${PK}?batas=50`)).body; assert.equal(ro.izin.tulis, false); assert.ok(ro.antrean.flatMap((a) => a.item).every((x) => x.aksi === null), "tidak ada tombol yang tidak bisa dijalankan");
  assert.equal(antrean(ro, "PENERIMAAN_AKAN_DATANG").jumlah, 60, "tetap melihat pekerjaan");
  const sem = new Set(); let offset = 0; for (;;) { const h = (await w.g.get(`${PK}/antrean/PENERIMAAN_AKAN_DATANG?offset=${offset}&limit=25`)).body; h.item.forEach((x) => sem.add(x.id)); offset += 25; if (h.lebih === 0) break; assert.ok(offset < 500); }
  assert.equal(sem.size, 60, "halaman antrean menutup seluruh 60 dokumen tanpa duplikat");
  assert.equal((await w.g.get(`${PK}/antrean/TIDAK_ADA`)).status, 404); const th = (await w.g.get(`${PK}/tertahan/JADWAL_LEWAT?limit=10&offset=10`)).body; assert.equal(th.item.length, 10); assert.ok(th.definisi.includes("tanggal"));
  const b = (await w.g.get(PK)).body; assert.equal(b.selesaiTerbaru.length, 5, "1 penerimaan + 1 permintaan + 3 transfer selesai"); assert.ok(b.selesaiTerbaru.some((x) => x.jenis === "penerimaan" && /Masuk stok/.test(x.teks)) && b.selesaiTerbaru.some((x) => x.jenis === "pengeluaran-material"));
  assert.ok(b.selesaiTerbaru.every((x) => x.tautan.startsWith("/warehouse/dashboard/")));
  assert.equal((await testPrisma.user.count()) >= 3, true);
});

test("Pusat Masalah: masalah nyata + dampak + pemilik + tindakan resmi + CAKUPAN; tidak ada blocker global; hanya bahan/dokumen/fitur", async () => {
  const w = await dunia(); await isiData(w);
  const r = await w.g.get(`${PK}/perhatian`); assert.equal(r.status, 200, JSON.stringify(r.body)); const kode = (k) => r.body.masalah.find((m) => m.kode === k);
  const neg = kode("STOK_NEGATIF"); assert.equal(neg.jumlah, 1); assert.equal(neg.cakupan, "BAHAN"); assert.match(neg.cakupanTeks, /bahan lain tetap berjalan/); assert.ok(neg.tindakan.length >= 1 && neg.dampak && neg.apa && neg.pemilikLabel);
  assert.ok(kode("SALDO_BELUM_DIKETAHUI") && kode("BATAS_MINIMUM_BELUM_DIATUR").cakupan === "FITUR" && kode("BATAS_MINIMUM_BELUM_DIATUR").memblokir === "Tidak ada");
  assert.equal(kode("STOK_TIDAK_CUKUP").jumlah, 5); assert.equal(kode("STOK_TIDAK_CUKUP").cakupan, "DOKUMEN"); assert.equal(kode("SELISIH_TRANSFER").jumlah, 2); assert.equal(kode("STOCK_COUNT_SELISIH").jumlah, 1); assert.equal(kode("KOREKSI_MENUNGGU").pemilik, "OWNER"); assert.equal(kode("KOREKSI_MENUNGGU").jumlah, 2);
  assert.ok(kode("PENERIMAAN_TERTAHAN").jumlah >= 26, "jadwal lewat + data wajib");
  assert.ok(r.body.masalah.every((m) => ["BAHAN", "DOKUMEN", "FITUR"].includes(m.cakupan)), "tidak ada masalah ber-cakupan PROSES"); assert.match(r.body.catatan, /Tidak ada masalah yang memblokir SELURUH proses/);
  assert.ok(r.body.masalah.every((m) => m.contoh.length <= 8 && m.tindakan.length > 0 && m.pemilikLabel), "contoh dibatasi; tiap masalah punya tindakan resmi dan pemilik");
});

test("Pencarian lintas dokumen: GR, PO, bahan, supplier, unit/order, Stock Count, Pengeluaran Material, Transfer, Koreksi; minimal 2 karakter; baca-saja; tautan membuka jendela fokus", async () => {
  const w = await dunia(); await isiData(w);
  const supplier = await testPrisma.finSupplier.create({ data: { code: "SUP-OC", name: "PT OCEAN CENTRA", paymentTermType: "HARI", paymentTermDays: 30 } });
  const po = await testPrisma.finPurchaseOrder.create({ data: { poNumber: "PO-OCEAN-77", supplierId: supplier.id, orderDate: tgl(-3), status: "DISETUJUI" } });
  const { unit } = await (await import("./setup/fixtures.js")).createTestUnit({ unitCode: "BASAH-ZZ-9" });
  const mi = await testPrisma.materialIssue.findFirst({ orderBy: { issueNumber: "asc" } }); await testPrisma.materialIssue.update({ where: { id: mi.id }, data: { unitId: unit.id } });
  const awal = await total(); const cari = async (q) => (await w.g.get(`${PK}/cari?q=${encodeURIComponent(q)}`)).body; const jenis = (b) => b.kelompok.map((k) => k.jenis);
  assert.equal((await cari("a")).total, 0); assert.match((await cari("a")).pesan, /minimal 2/);
  assert.ok(jenis(await cari("GR-0007")).includes("penerimaan")); assert.ok(jenis(await cari("PO-OCEAN")).includes("po")); assert.ok(jenis(await cari("OCEAN")).includes("po"), "supplier PO");
  const bah = await cari("BUSA-A"); assert.ok(jenis(bah).includes("bahan") && jenis(bah).includes("penerimaan") && jenis(bah).includes("pengeluaran-material"), "bahan menemukan dokumen yang memuatnya");
  assert.ok(jenis(await cari("Toko 3")).includes("penerimaan"), "supplier GR"); assert.ok(jenis(await cari("BASAH-ZZ")).includes("pengeluaran-material"), "unit"); assert.ok(jenis(await cari("CC-4")).includes("opname")); assert.ok(jenis(await cari("TR-0003")).includes("transfer")); assert.ok(jenis(await cari("KG-1")).includes("koreksi")); assert.ok(jenis(await cari("ADJ-1")).includes("penyesuaian"));
  const gr = (await cari("GR-0001")).kelompok.find((k) => k.jenis === "penerimaan").hasil[0]; assert.ok(gr.tautan.startsWith("/warehouse/dashboard/penerimaan/") && gr.sub && gr.status);
  assert.ok((await cari("BUSA-A")).kelompok.find((k) => k.jenis === "bahan").hasil[0].tautan.startsWith("/warehouse/inventory?q="));
  assert.ok((await cari("GR-")).kelompok.find((k) => k.jenis === "penerimaan").hasil.length <= 6, "batas per jenis");
  // Tindakan cepat: hanya bila sah untuk status SAAT INI dan pengguna berizin; akun baca-saja tidak mendapat tombol
  const hit = (b, j) => b.kelompok.find((k) => k.jenis === j).hasil[0];
  assert.equal(hit(await cari("GR-0001"), "penerimaan").aksi?.label, "Catat barang tiba"); assert.equal(hit(await cari("MI-0001"), "pengeluaran-material").aksi?.label, "Setujui permintaan"); assert.equal(hit(await cari("CC-4"), "opname").aksi?.label, "Tinjau & selesaikan");
  assert.equal(hit(await cari("BUSA-A"), "bahan").aksi, null, "bahan tidak punya tindakan cepat");
  const ro = (await w.p.get(`${PK}/cari?q=GR-0001`)).body; assert.equal(hit(ro, "penerimaan").aksi, null, "akun baca-saja tanpa tombol tindakan");
  assert.equal((await w.p.get(`${PK}/cari?q=GR-0001`)).status, 200, "akun baca-saja boleh mencari"); assert.deepEqual(await total(), awal, "pencarian baca-saja");
  void po;
});

test("Tanpa izin baca Inventory ditolak; semua endpoint baca-saja tidak menerima tulis", async () => {
  const sales = await createTestUser({ roles: ["SALES"] }); const c = makeClient(server.baseUrl, sales.token);
  for (const p of [PK, `${PK}/perhatian`, `${PK}/cari?q=GR`, `${PK}/selesai`]) assert.equal((await c.get(p)).status, 403, p);
  const w = await dunia(); assert.equal((await w.g.post(PK, {})).status, 404, "tidak ada jalur tulis");
});
