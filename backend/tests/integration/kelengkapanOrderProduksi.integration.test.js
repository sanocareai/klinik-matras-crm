// PENYARINGAN KELENGKAPAN ORDER PRODUKSI (Okt 2026): Bahan belum dicatat · Bahan perlu dicek · HPP belum lengkap · Data order kurang.
// Dibuktikan di server dengan DB sungguhan: klasifikasi, filter + hitungan atas SELURUH unit (bukan halaman), pagination, kombinasi filter, periode, urutan, pernyataan "tanpa bahan baru", izin, dan BACA-SAJA.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser, createTestMaterial, createTestUnit, seedBalance } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

let seq = 0; const kunci = (t) => `uji-${t}-${Date.now().toString(36)}-${++seq}-aaaaaaaa`;
const HARI = 86_400_000;
const tgl = (d) => new Date(Date.now() - d * HARI);

async function dunia() {
  const admin = await createTestUser({ roles: ["ADMIN"] }); const sales = await createTestUser({ roles: ["SALES"] });
  const c = makeClient(server.baseUrl, admin.token);
  const busa = await createTestMaterial({ code: "KL-BUSA", name: "BUSA KELENGKAPAN", unit: "SHEET" }); await seedBalance(busa.id, 100, { unitCost: 20000 });
  await testPrisma.materialHargaBerlaku.create({ data: { materialId: busa.id, jenis: "HARGA", unitPrice: "20000", satuan: "SHEET", effectiveFrom: new Date(Date.now() - 60 * HARI), createdAt: new Date(Date.now() - 60 * HARI), reason: "Harga uji kelengkapan HPP", idempotencyKey: kunci("hb-busa") } });
  const lem = await createTestMaterial({ code: "KL-LEM", name: "LEM KELENGKAPAN", unit: "KG" }); await seedBalance(lem.id, 100);
  return { admin, sales, a: c, s: makeClient(server.baseUrl, sales.token), busa, lem };
}
/** Unit dengan status + umur (hari sejak dibuat) + nomor order yang bisa dicari. */
async function unit(status, umur, nomor, extra = {}) {
  const { order, unit: u } = await createTestUnit({ status, createdAt: tgl(umur), ...extra });
  await testPrisma.order.update({ where: { id: order.id }, data: { orderNumber: nomor, status: status === "DELIVERED" ? "DELIVERED" : status === "AWAITING_PICKUP" ? "PICKUP" : "PROCESSING" } });
  return { u, order };
}
const tandaiKerja = (w, u, status = "DIKERJAKAN") => w.a.post(`/api/production/units/${u.id}/work-progress`, { status, note: "uji" });
const issue = (w, u, mat, qty = 1) => w.a.post(`/api/units/${u.id}/materials`, { materialId: mat.id, qty }, { "Idempotency-Key": kunci("iss") });
const daftar = async (w, q = "") => (await w.a.get(`/api/production/work-orders?${/pageSize=/.test(q) ? "" : "pageSize=200"}${q}`)).body;
const kel = (baris) => baris.adopsi.kelengkapan;
const hitungTabel = async (nama) => Number((await testPrisma.$queryRawUnsafe(`select count(*)::int n from ${nama}`))[0].n);
const efek = async () => ({ sm: await hitungTabel("stock_movements"), mi: await hitungTabel("material_issues"), jur: await hitungTabel("fin_journal_entries"), jl: await hitungTabel("fin_journal_lines"), pu: await hitungTabel("unit_provisional_usages"), dec: await hitungTabel("unit_material_declarations"), ev: await hitungTabel("activity_events"), runs: await hitungTabel("production_runs_v2"), sch: await hitungTabel("production_unit_schedules") });

test("C1. klasifikasi per unit: menunggu dijemput TIDAK kurang bahan; selesai tanpa catatan = Bahan belum dicatat + HPP; sudah ada ISSUE bernilai = lengkap", async () => {
  const w = await dunia();
  const tunggu = await unit("AWAITING_PICKUP", 2, "RES-KL-01"); const selesaiKosong = await unit("READY_FOR_DELIVERY", 9, "RES-KL-02"); const lengkap = await unit("IN_PRODUCTION", 5, "RES-KL-03");
  assert.equal((await tandaiKerja(w, lengkap.u)).status, 201);
  assert.equal((await issue(w, lengkap.u, w.busa, 2)).status, 201);
  const d = await daftar(w); const by = (n) => d.units.find((x) => x.unitCode === n.u.unitCode);
  assert.deepEqual(kel(by(tunggu)).keys, [], "menunggu dijemput: bukan kekurangan");
  assert.deepEqual(kel(by(selesaiKosong)).keys, ["BAHAN_BELUM_DICATAT", "HPP_BELUM_LENGKAP"]);
  assert.deepEqual(kel(by(lengkap)).keys, [], "ada ISSUE bernilai dan harga berlaku → lengkap");
  assert.equal(by(selesaiKosong).adopsi.kelengkapan.items.BAHAN_BELUM_DICATAT.alasan[0].kode, "BAHAN_TIDAK_ADA_CATATAN");
});

test("C2. catatan SEMENTARA: dihitung sebagai catatan ada (bukan 'belum dicatat'), tetapi Bahan perlu dicek + HPP belum lengkap dengan alasan konkret", async () => {
  const w = await dunia(); const { u } = await unit("IN_PRODUCTION", 4, "RES-KL-10");
  const r = await w.a.post(`/api/production/units/${u.id}/provisional-usages`, { name: "BAHAN TAK TERDAFTAR", qty: 2, uom: "KG", originNote: "Beli sendiri", alasanPencatatan: "Bahan belum ada di katalog" }, { "Idempotency-Key": kunci("sem") });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const b = (await daftar(w)).units.find((x) => x.unitCode === u.unitCode); const k = kel(b);
  assert.ok(!k.keys.includes("BAHAN_BELUM_DICATAT"));
  assert.deepEqual(k.keys, ["BAHAN_PERLU_DICEK", "HPP_BELUM_LENGKAP"]);
  assert.equal(k.items.BAHAN_PERLU_DICEK.alasan[0].kode, "SEMENTARA_BELUM_TERPETAKAN"); assert.match(k.items.BAHAN_PERLU_DICEK.alasan[0].teks, /belum terpetakan ke katalog/);
  assert.ok(k.items.HPP_BELUM_LENGKAP.alasan.some((a) => a.kode === "HPP_SEMENTARA"));
});

test("C3. HPP: ISSUE tanpa harga berlaku → harga belum diketahui; setelah harga diisi → perlu penerapan (BUKAN otomatis lengkap); GAGAL pembekuan terlihat", async () => {
  const w = await dunia(); const tanpaHarga = await createTestMaterial({ code: "KL-TH", name: "BAHAN TANPA HARGA", unit: "KG" }); await seedBalance(tanpaHarga.id, 50);
  const { u } = await unit("IN_PRODUCTION", 3, "RES-KL-20"); await tandaiKerja(w, u);
  assert.equal((await issue(w, u, tanpaHarga, 1)).status, 201);
  let k = kel((await daftar(w)).units.find((x) => x.unitCode === u.unitCode));
  assert.deepEqual(k.keys, ["HPP_BELUM_LENGKAP"]); assert.equal(k.items.HPP_BELUM_LENGKAP.alasan[0].kode, "HPP_HARGA_BELUM_DIKETAHUI"); assert.equal(k.items.HPP_BELUM_LENGKAP.alasan[0].jumlah, 1);
  // harga berlaku mulai 3 jam lalu; pemakaian "terjadi" 2 jam lalu (sesudah harga berlaku) tetapi saat diposting belum ada harga → dibekukan TANPA harga → perlu penerapan khusus (tidak otomatis)
  await testPrisma.materialHargaBerlaku.create({ data: { materialId: tanpaHarga.id, jenis: "HARGA", unitPrice: "1000", satuan: "KG", effectiveFrom: new Date(Date.now() - 3 * 3600_000), createdAt: new Date(Date.now() - 3 * 3600_000), reason: "Harga uji kelengkapan HPP", idempotencyKey: kunci("hb") } });
  await testPrisma.$executeRawUnsafe(`update stock_movements set created_at = now() - interval '2 hours' where unit_id = '${u.id}' and type = 'ISSUE'`);
  k = kel((await daftar(w)).units.find((x) => x.unitCode === u.unitCode));
  assert.equal(k.items.HPP_BELUM_LENGKAP.alasan[0].kode, "HPP_BELUM_DITERAPKAN", "harga ada pada waktu ini, tetapi pemakaian lama tidak otomatis diberi harga");
  // kegagalan pembekuan (penanda persisten) dihitung sendiri
  const mv = await testPrisma.stockMovement.findFirst({ where: { unitId: u.id, type: "ISSUE" } });
  await testPrisma.stockMovementBiayaOperasional.create({ data: { movementId: mv.id, materialId: tanpaHarga.id, unitId: u.id, status: "GAGAL_PEMBEKUAN", qty: 1, sumber: "GAGAL_SAAT_POSTING", basisHarga: "TIDAK_DIKETAHUI", gagalKode: "UJI", gagalAlasan: "uji" } });
  k = kel((await daftar(w)).units.find((x) => x.unitCode === u.unitCode));
  assert.equal(k.items.HPP_BELUM_LENGKAP.alasan[0].kode, "HPP_GAGAL_PEMBEKUAN");
});

test("C4. Data order kurang: order PKR belum lengkap SAJA; target/PIC/rencana bahan kosong pada order biasa TIDAK dianggap kurang", async () => {
  const w = await dunia();
  const pkr = await testPrisma.finPenjualanKaryawan.create({ data: { nomor: "PKR-KL-001", date: new Date(), sellerId: w.sales.user.id, buyerName: "Kerabat", total: 1_000_000, status: "AKTIF", items: { create: [{ name: "Kasur", quantity: 1, unitPrice: 1_000_000, sortOrder: 0 }] } } });
  const { u: uPkr, order } = await unit("RECEIVED", 2, "RES-KL-30"); await testPrisma.order.update({ where: { id: order.id }, data: { penjualanKaryawanId: pkr.id } });
  const { u: uBiasa } = await unit("RECEIVED", 2, "RES-KL-31"); // tanpa target, tanpa PIC, tanpa rencana bahan
  const d = await daftar(w);
  const kp = kel(d.units.find((x) => x.unitCode === uPkr.unitCode)); const kb = kel(d.units.find((x) => x.unitCode === uBiasa.unitCode));
  assert.deepEqual(kp.keys, ["DATA_ORDER_KURANG"]); assert.match(kp.items.DATA_ORDER_KURANG.alasan[0].teks, /PKR-KL-001 belum lengkap: .*Merk kasur/);
  assert.deepEqual(kb.keys, [], "target/PIC/rencana bahan opsional: bukan kekurangan");
  // melengkapi → hilang dari kategori
  await testPrisma.order.update({ where: { id: order.id }, data: { notes: JSON.stringify({ merkKasur: "Sano", ukuranKasur: "160x200" }), pkrPerluDikirim: false } });
  assert.deepEqual(kel((await daftar(w)).units.find((x) => x.unitCode === uPkr.unitCode)).keys, [], "hasil diperbarui setelah data dilengkapi");
});

test("C5. FILTER di server atas SELURUH unit: kelengkapan=…; hitungan dari server; total gabungan = unit UNIK; bukan hanya halaman yang dimuat", async () => {
  const w = await dunia();
  // 7 unit selesai tanpa bahan (Bahan belum dicatat + HPP), 2 unit lengkap, 1 menunggu dijemput
  const kurang = []; for (let i = 0; i < 7; i++) kurang.push((await unit("READY_FOR_DELIVERY", 10 + i, `RES-KL-4${i}`)).u);
  for (let i = 0; i < 2; i++) { const { u } = await unit("IN_PRODUCTION", 2 + i, `RES-KL-5${i}`); await tandaiKerja(w, u); await issue(w, u, w.busa, 1); }
  await unit("AWAITING_PICKUP", 1, "RES-KL-60");
  const h = await daftar(w, "&kelengkapan=BAHAN_BELUM_DICATAT&pageSize=3");
  assert.equal(h.total, 7, "total jujur atas seluruh unit yang cocok"); assert.equal(h.units.length, 3, "halaman 1 hanya 3"); assert.equal(h.hasMore, true);
  const p2 = await daftar(w, "&kelengkapan=BAHAN_BELUM_DICATAT&pageSize=3&page=2"); const p3 = await daftar(w, "&kelengkapan=BAHAN_BELUM_DICATAT&pageSize=3&page=3");
  assert.equal(p2.units.length, 3); assert.equal(p3.units.length, 1); assert.equal(p3.hasMore, false);
  const semuaKode = [...h.units, ...p2.units, ...p3.units].map((x) => x.unitCode); assert.equal(new Set(semuaKode).size, 7, "tanpa duplikat/hilang antar halaman");
  const hit = (await w.a.get("/api/production/work-orders/kelengkapan-hitung?displayStatus=DIPROSES,SIAP_KIRIM,PENGAMBILAN")).body;
  assert.equal(hit.counts.BAHAN_BELUM_DICATAT, 7); assert.equal(hit.counts.HPP_BELUM_LENGKAP, 7); assert.equal(hit.unik, 7, "unit yang masuk dua kategori dihitung SEKALI");
  assert.equal(hit.totalUnit, 10); assert.equal(hit.counts.DATA_ORDER_KURANG, 0);
  const gabung = await daftar(w, "&kelengkapan=BAHAN_BELUM_DICATAT,HPP_BELUM_LENGKAP"); assert.equal(gabung.total, 7, "gabungan OR menghitung unit unik, bukan 14");
});

test("C6. kombinasi filter: kelengkapan × status order × status kerja × pencarian × periode, dihitung bersama", async () => {
  const w = await dunia();
  const a = await unit("READY_FOR_DELIVERY", 3, "RES-KL-70"); const b = await unit("DELIVERED", 40, "RES-KL-71"); const c = await unit("READY_FOR_DELIVERY", 20, "RES-KL-72"); await unit("IN_PRODUCTION", 1, "RES-KL-73");
  const q = async (s) => (await daftar(w, s)).units.map((x) => x.unitCode).sort();
  const kode = (x) => x.u.unitCode;
  assert.deepEqual(await q("&kelengkapan=BAHAN_BELUM_DICATAT"), [kode(a), kode(b), kode(c)].sort(), "riwayat (Terkirim) ikut bila tidak dibatasi");
  assert.deepEqual(await q("&kelengkapan=BAHAN_BELUM_DICATAT&displayStatus=SIAP_KIRIM"), [kode(a), kode(c)].sort(), "× status order");
  assert.deepEqual(await q("&kelengkapan=BAHAN_BELUM_DICATAT&displayStatus=TERKIRIM"), [kode(b)], "akses ke unit selesai/riwayat");
  assert.deepEqual(await q("&kelengkapan=BAHAN_BELUM_DICATAT&statusKerja=SELESAI&q=RES-KL-72"), [kode(c)], "× status kerja × pencarian");
  const hariIni = new Date().toISOString().slice(0, 10); const dari15 = new Date(Date.now() - 15 * HARI).toISOString().slice(0, 10); const dari30 = new Date(Date.now() - 30 * HARI).toISOString().slice(0, 10);
  assert.deepEqual(await q(`&kelengkapan=BAHAN_BELUM_DICATAT&dari=${dari15}&sampai=${hariIni}`), [kode(a)], "periode: hanya yang masuk ≤15 hari");
  assert.deepEqual(await q(`&kelengkapan=BAHAN_BELUM_DICATAT&dari=${dari30}&sampai=${dari15}`), [kode(c)], "periode: batas atas inklusif per hari WIB");
  const hit = (await w.a.get(`/api/production/work-orders/kelengkapan-hitung?displayStatus=SIAP_KIRIM&dari=${dari15}&sampai=${hariIni}`)).body;
  assert.equal(hit.counts.BAHAN_BELUM_DICATAT, 1); assert.equal(hit.riwayat.totalUnit, 0, "hitungan riwayat mengikuti periode yang sama");
  assert.equal(hit.dasarPeriode, "Tanggal order masuk (unit dibuat)");
});

test("C7. periode tidak valid/terbalik ditolak (400, bukan diabaikan); urutan 'paling lama belum ditangani' = tanggal masuk terlama dulu; tie stabil", async () => {
  const w = await dunia();
  assert.equal((await w.a.get("/api/production/work-orders?dari=bukan-tanggal")).status, 400);
  const t = await w.a.get("/api/production/work-orders?dari=2026-10-10&sampai=2026-10-01"); assert.equal(t.status, 400); assert.equal(t.body.code, "PERIODE_TERBALIK");
  assert.equal((await w.a.get("/api/production/work-orders/kelengkapan-hitung?sampai=2026-02-31x")).status, 400);
  await unit("READY_FOR_DELIVERY", 2, "RES-KL-80"); await unit("READY_FOR_DELIVERY", 30, "RES-KL-81"); await unit("READY_FOR_DELIVERY", 11, "RES-KL-82");
  const lama = await daftar(w, "&kelengkapan=BAHAN_BELUM_DICATAT&urut=terlama"); assert.deepEqual(lama.units.map((x) => x.order.orderNumber), ["RES-KL-81", "RES-KL-82", "RES-KL-80"]);
  const baru = await daftar(w, "&kelengkapan=BAHAN_BELUM_DICATAT"); assert.deepEqual(baru.units.map((x) => x.order.orderNumber), ["RES-KL-80", "RES-KL-82", "RES-KL-81"]);
  assert.equal(lama.filterDipakai.urut, "terlama"); assert.deepEqual(lama.filterDipakai.kelengkapan, ["BAHAN_BELUM_DICATAT"]);
});

test("C8. PERNYATAAN 'tanpa bahan baru': alasan wajib, idempoten, satu aktif per unit, audit pelaku+waktu, ditolak bila sudah ada catatan, dicabut tercatat — TANPA stok/Material Issue/jurnal/status", async () => {
  const w = await dunia(); const { u } = await unit("READY_FOR_DELIVERY", 6, "RES-KL-90"); const e0 = await efek();
  const url = `/api/production/units/${u.id}/pernyataan-tanpa-bahan`;
  assert.equal((await w.a.post(url, { alasan: "ok" }, { "Idempotency-Key": kunci("p") })).status, 400, "alasan terlalu pendek");
  assert.equal((await w.a.post(url, { alasan: "Hanya servis jahitan, tanpa bahan" })).status, 400, "Idempotency-Key wajib");
  const k1 = kunci("p"); const r = await w.a.post(url, { alasan: "Hanya servis jahitan, tanpa bahan" }, { "Idempotency-Key": k1 }); assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.pernyataan.status, "ACTIVE"); assert.ok(r.body.pernyataan.oleh); assert.ok(r.body.pernyataan.at);
  assert.equal((await w.a.post(url, { alasan: "Hanya servis jahitan, tanpa bahan" }, { "Idempotency-Key": k1 })).status, 200, "replay idempoten");
  assert.equal((await w.a.post(url, { alasan: "Alasan lain lagi" }, { "Idempotency-Key": k1 })).status, 409, "kunci sama, isian beda");
  const dua = await w.a.post(url, { alasan: "Dinyatakan lagi" }, { "Idempotency-Key": kunci("p") }); assert.equal(dua.status, 409); assert.equal(dua.body.code, "PERNYATAAN_SUDAH_ADA");
  const e1 = await efek(); assert.equal(e1.dec, e0.dec + 1); assert.equal(e1.sm, e0.sm); assert.equal(e1.mi, e0.mi); assert.equal(e1.jur, e0.jur); assert.equal(e1.jl, e0.jl); assert.equal(e1.pu, e0.pu); assert.equal(e1.runs, e0.runs); assert.equal(e1.sch, e0.sch);
  assert.equal(e1.ev, e0.ev + 1, "tepat satu peristiwa audit");
  const b = (await daftar(w)).units.find((x) => x.unitCode === u.unitCode);
  assert.deepEqual(kel(b).keys, [], "pernyataan menggantikan kekurangan bahan + HPP-karena-bahan"); assert.equal(kel(b).pernyataan.alasan, "Hanya servis jahitan, tanpa bahan"); assert.equal(b.status, "READY_FOR_DELIVERY", "status unit tidak berubah"); assert.equal(b.adopsi.kerja.key, "SELESAI");
  const dr = (await w.a.get(`/api/production/units/${u.id}/adopsi`)).body; assert.equal(dr.pernyataanTanpaBahan.aktif.status, "ACTIVE"); assert.equal(dr.izin.pernyataanTanpaBahan, true); assert.deepEqual(dr.adopsi.kelengkapan.keys, [], "drawer = daftar");
  // cabut: alasan wajib; baris tidak hilang
  assert.equal((await w.a.post(`${url}/cabut`, { alasan: "x" })).status, 400);
  const cb = await w.a.post(`${url}/cabut`, { alasan: "Ternyata dipakai busa" }); assert.equal(cb.status, 200, JSON.stringify(cb.body)); assert.equal(cb.body.pernyataan.status, "REVOKED"); assert.equal(cb.body.pernyataan.alasanCabut, "Ternyata dipakai busa");
  assert.equal(await hitungTabel("unit_material_declarations"), e0.dec + 1, "baris tidak dihapus");
  assert.equal((await w.a.post(`${url}/cabut`, { alasan: "Cabut lagi saja" })).status, 404);
  assert.deepEqual(kel((await daftar(w)).units.find((x) => x.unitCode === u.unitCode)).keys, ["BAHAN_BELUM_DICATAT", "HPP_BELUM_LENGKAP"], "kekurangan muncul lagi setelah dicabut");
  // sudah ada catatan pemakaian → pernyataan ditolak
  await w.a.post(`/api/production/units/${u.id}/provisional-usages`, { name: "BAHAN X", qty: 1, uom: "KG", originNote: "Beli sendiri", alasanPencatatan: "uji" }, { "Idempotency-Key": kunci("sem") });
  const tolak = await w.a.post(url, { alasan: "Padahal ada catatan sementara" }, { "Idempotency-Key": kunci("p") }); assert.equal(tolak.status, 409); assert.equal(tolak.body.code, "SUDAH_ADA_CATATAN_BAHAN");
});

test("C9. IZIN: Sales (hanya-lihat) boleh membaca daftar/hitungan tetapi DITOLAK menyatakan/mencabut; unit dibatalkan ditolak", async () => {
  const w = await dunia(); const { u } = await unit("READY_FOR_DELIVERY", 6, "RES-KL-95"); const { u: batal } = await unit("CANCELLED", 6, "RES-KL-96");
  const url = `/api/production/units/${u.id}/pernyataan-tanpa-bahan`;
  assert.equal((await w.s.get("/api/production/work-orders?kelengkapan=BAHAN_BELUM_DICATAT")).status, 200);
  assert.equal((await w.s.get("/api/production/work-orders/kelengkapan-hitung")).status, 200);
  assert.equal((await w.s.post(url, { alasan: "Mau menyatakan sendiri" }, { "Idempotency-Key": kunci("p") })).status, 403);
  assert.equal((await w.s.post(`${url}/cabut`, { alasan: "Mau mencabut sendiri" })).status, 403);
  assert.equal(await hitungTabel("unit_material_declarations"), 0);
  assert.equal((await w.a.post(`/api/production/units/${batal.id}/pernyataan-tanpa-bahan`, { alasan: "Unit dibatalkan" }, { "Idempotency-Key": kunci("p") })).status, 409);
  assert.equal((await (await makeClient(server.baseUrl, null).get("/api/production/work-orders/kelengkapan-hitung")).status), 401);
});

test("C10. BACA-SAJA: daftar, hitungan, filter, drawer, dan ekspor TIDAK menulis status bisnis apa pun", async () => {
  const w = await dunia(); const { u } = await unit("READY_FOR_DELIVERY", 6, "RES-KL-97"); await unit("IN_PRODUCTION", 3, "RES-KL-98"); const e0 = await efek();
  await daftar(w, "&kelengkapan=BAHAN_BELUM_DICATAT"); await w.a.get("/api/production/work-orders/kelengkapan-hitung"); await w.a.get(`/api/production/units/${u.id}/adopsi`); await w.a.get(`/api/production/units/${u.id}/pernyataan-tanpa-bahan`);
  const x = await fetch(`${server.baseUrl}/api/production/work-orders/export.xlsx?kelengkapan=BAHAN_BELUM_DICATAT`, { headers: { Authorization: `Bearer ${w.admin.token}` } }); assert.equal(x.status, 200);
  assert.deepEqual(await efek(), e0);
});

test("C11. EKSPOR memakai klasifikasi yang SAMA dan filter yang SAMA dengan daftar; Info memuat filter kelengkapan, periode+dasar, dan urutan", async () => {
  const w = await dunia(); const a = await unit("READY_FOR_DELIVERY", 6, "RES-KL-99"); const b = await unit("IN_PRODUCTION", 3, "RES-KL-100"); await tandaiKerja(w, b.u); await issue(w, b.u, w.busa, 1);
  await w.a.post(`/api/production/units/${a.u.id}/pernyataan-tanpa-bahan`, { alasan: "Hanya servis" }, { "Idempotency-Key": kunci("p") });
  const { u: c } = await unit("READY_FOR_DELIVERY", 12, "RES-KL-101");
  const dari = new Date(Date.now() - 20 * HARI).toISOString().slice(0, 10); const sampai = new Date().toISOString().slice(0, 10);
  const res = await fetch(`${server.baseUrl}/api/production/work-orders/export.xlsx?kelengkapan=BAHAN_BELUM_DICATAT,HPP_BELUM_LENGKAP&urut=terlama&dari=${dari}&sampai=${sampai}`, { headers: { Authorization: `Bearer ${w.admin.token}` } });
  assert.equal(res.status, 200); const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await res.arrayBuffer()));
  const ws = wb.getWorksheet("Ringkasan Unit"); const head = Array.from(ws.getRow(1).values, (v) => String(v ?? "")); const col = (h) => head.findIndex((x) => x.startsWith(h));
  assert.equal(ws.rowCount - 1, 1, "hanya unit yang cocok filter (c); unit a dinyatakan tanpa bahan, b lengkap"); assert.equal(ws.getRow(2).getCell(col("Kode Unit")).value, c.unitCode);
  assert.match(String(ws.getRow(2).getCell(col("Kelengkapan")).value), /Bahan belum dicatat · HPP belum lengkap/); assert.match(String(ws.getRow(2).getCell(col("Alasan Kekurangan")).value), /belum ada catatan pemakaian bahan/);
  const info = Object.fromEntries(wb.getWorksheet("Info Ekspor").getSheetValues().filter(Boolean).map((r) => [r[1], r[2]]));
  assert.match(info["Filter: kelengkapan"], /Bahan belum dicatat ATAU HPP belum lengkap/); assert.match(info["Filter: periode"], new RegExp(`${dari} s\\.d\\. ${sampai} \\(dasar: Tanggal order masuk`)); assert.match(info["Urutan"], /Paling lama belum ditangani/);
  assert.match(info["HPP operasional"], /Bukan nilai persediaan/);
  const daft = await daftar(w, `&kelengkapan=BAHAN_BELUM_DICATAT,HPP_BELUM_LENGKAP&dari=${dari}&sampai=${sampai}`); assert.equal(daft.total, 1, "ekspor == daftar");
  const semua = await fetch(`${server.baseUrl}/api/production/work-orders/export.xlsx`, { headers: { Authorization: `Bearer ${w.admin.token}` } }); const wb2 = new ExcelJS.Workbook(); await wb2.xlsx.load(Buffer.from(await semua.arrayBuffer()));
  const ws2 = wb2.getWorksheet("Ringkasan Unit"); const kodeUnit = (r) => String(ws2.getRow(r).getCell(col("Kode Unit")).value); let adaA = null; for (let r = 2; r <= ws2.rowCount; r++) if (kodeUnit(r) === a.u.unitCode) adaA = r;
  assert.match(String(ws2.getRow(adaA).getCell(col("Pernyataan Tanpa Bahan Baru")).value), /Dinyatakan tanpa bahan baru oleh .*: Hanya servis/);
});

test("C12. hitungan menghormati lingkup: Aktif vs Riwayat; unit Terkirim berkekurangan tetap ditemukan lewat blok 'riwayat'", async () => {
  const w = await dunia(); await unit("READY_FOR_DELIVERY", 4, "RES-KL-110"); await unit("DELIVERED", 50, "RES-KL-111"); await unit("DELIVERED", 60, "RES-KL-112");
  const aktif = (await w.a.get("/api/production/work-orders/kelengkapan-hitung?displayStatus=PENGAMBILAN,DIPROSES,SIAP_KIRIM")).body;
  assert.equal(aktif.unik, 1); assert.equal(aktif.riwayat.unik, 2, "kekurangan historis tidak tersembunyi saat lingkup Aktif"); assert.equal(aktif.riwayat.totalUnit, 2);
  const riw = (await w.a.get("/api/production/work-orders/kelengkapan-hitung?displayStatus=TERKIRIM")).body; assert.equal(riw.unik, 2);
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€ aturan 1 (kasus nyata): status resmi order/unit menang atas status kerja yang tertinggal â”€â”€â”€â”€â”€â”€â”€â”€â”€
test("C13. unit RECEIVED pada order DELIVERED (kasus nyata di production) dengan status kerja tertinggal TIDAK lolos dari filter Bahan belum dicatat", async () => {
  const w = await dunia();
  const tertinggal = await unit("RECEIVED", 6, "RES-KL-120"); // order DELIVERED, unit masih RECEIVED, status kerja "Belum dijadwalkan"
  await testPrisma.order.update({ where: { id: tertinggal.order.id }, data: { status: "DELIVERED" } });
  const tertunda = await unit("RECEIVED", 7, "RES-KL-121"); // order READY + status kerja manual Tertunda
  await testPrisma.order.update({ where: { id: tertunda.order.id }, data: { status: "READY" } });
  assert.equal((await tandaiKerja(w, tertunda.u, "TERTUNDA")).status, 201);
  const biasa = await unit("RECEIVED", 8, "RES-KL-122"); // order PROCESSING, belum dikerjakan → tidak dinilai
  const d = await daftar(w, "&kelengkapan=BAHAN_BELUM_DICATAT"); const kode = d.units.map((x) => x.unitCode);
  assert.ok(kode.includes(tertinggal.u.unitCode) && kode.includes(tertunda.u.unitCode), "unit selesai menurut status resmi order tidak lolos");
  assert.ok(!kode.includes(biasa.u.unitCode));
  const b = d.units.find((x) => x.unitCode === tertinggal.u.unitCode);
  assert.equal(b.adopsi.kerja.key, "BELUM_DIJADWALKAN", "status kerja memang tertinggal"); assert.equal(kel(b).dasarBahan, "STATUS_RESMI_ORDER");
  assert.match(kel(b).items.BAHAN_BELUM_DICATAT.alasan[0].teks, /Status order sudah Siap Kirim atau sesudahnya/);
  const hit = (await w.a.get("/api/production/work-orders/kelengkapan-hitung")).body; assert.equal(hit.counts.BAHAN_BELUM_DICATAT, 2);
  const mat = await createTestMaterial({ code: "KL-C13", name: "BAHAN C13", unit: "KG" }); await seedBalance(mat.id, 10);
  assert.equal((await issue(w, tertinggal.u, mat, 1)).status, 201);
  assert.ok(!kel((await daftar(w)).units.find((x) => x.unitCode === tertinggal.u.unitCode)).keys.includes("BAHAN_BELUM_DICATAT"));
  const dr = (await w.a.get(`/api/production/units/${tertunda.u.id}/adopsi`)).body; assert.deepEqual(dr.adopsi.kelengkapan.keys, kel((await daftar(w)).units.find((x) => x.unitCode === tertunda.u.unitCode)).keys, "drawer = daftar");
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€ aturan 2: "Belum dinilai" â”€â”€â”€â”€â”€â”€â”€â”€â”€
test("C14. order biasa = data order 'Belum dinilai' (bukan lengkap, bukan kurang): di daftar, drawer, hitungan, dan ekspor; PKR dinilai", async () => {
  const w = await dunia(); const { u } = await unit("IN_PRODUCTION", 3, "RES-KL-130"); await tandaiKerja(w, u); await issue(w, u, w.busa, 1);
  const pkrLengkap = await testPrisma.finPenjualanKaryawan.create({ data: { nomor: "PKR-KL-130", date: new Date(), sellerId: w.sales.user.id, buyerName: "K", total: 1, status: "AKTIF", items: { create: [{ name: "Kasur", quantity: 1, unitPrice: 1, sortOrder: 0 }] } } });
  const lengkap = await unit("RECEIVED", 2, "RES-KL-131"); await testPrisma.order.update({ where: { id: lengkap.order.id }, data: { penjualanKaryawanId: pkrLengkap.id, notes: JSON.stringify({ merkKasur: "Sano", ukuranKasur: "160x200" }), pkrPerluDikirim: false } });
  const d = await daftar(w); const b = d.units.find((x) => x.unitCode === u.unitCode); const k = kel(b);
  assert.deepEqual(k.keys, [], "bahan + HPP lengkap"); assert.equal(k.dataOrder.status, "BELUM_DINILAI"); assert.equal(k.ringkas, "Tidak ada kekurangan terdeteksi · Data order belum dinilai");
  assert.equal(kel(d.units.find((x) => x.unitCode === lengkap.u.unitCode)).dataOrder.status, "LENGKAP");
  const hit = (await w.a.get("/api/production/work-orders/kelengkapan-hitung")).body;
  assert.deepEqual(hit.dataOrder, { lengkap: 1, kurang: 0, belumDinilai: 1 }); assert.equal(hit.counts.DATA_ORDER_KURANG, 0, "belum dinilai tidak dihitung kekurangan");
  assert.equal((await daftar(w, "&kelengkapan=DATA_ORDER_KURANG")).total, 0);
  const x = await fetch(`${server.baseUrl}/api/production/work-orders/export.xlsx`, { headers: { Authorization: `Bearer ${w.admin.token}` } }); const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await x.arrayBuffer()));
  const ws = wb.getWorksheet("Ringkasan Unit"); const head = Array.from(ws.getRow(1).values, (v) => String(v ?? "")); const ci = head.findIndex((h) => h.startsWith("Status Data Order"));
  const nilai = []; for (let r = 2; r <= ws.rowCount; r++) nilai.push(String(ws.getRow(r).getCell(ci).value)); assert.deepEqual(nilai.sort(), ["Belum dinilai", "Lengkap"]);
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€ aturan 3: pernyataan tidak menyembunyikan masalah setelah catatan bahan ditambahkan â”€â”€â”€â”€â”€â”€â”€â”€â”€
test("C15. pernyataan lalu catatan bahan ditambahkan kemudian: unit masuk Bahan perlu dicek (alasan konkret); filter, hitungan, drawer konsisten; dicabut → kembali normal", async () => {
  const w = await dunia(); const { u } = await unit("READY_FOR_DELIVERY", 6, "RES-KL-140");
  const url = `/api/production/units/${u.id}/pernyataan-tanpa-bahan`;
  assert.equal((await w.a.post(url, { alasan: "Hanya servis jahitan" }, { "Idempotency-Key": kunci("p") })).status, 201);
  const ambil = async () => kel((await daftar(w)).units.find((x) => x.unitCode === u.unitCode));
  assert.deepEqual((await ambil()).keys, []);
  const mat = await createTestMaterial({ code: "KL-C15", name: "BAHAN C15", unit: "KG" }); await seedBalance(mat.id, 10);
  assert.equal((await issue(w, u, mat, 1)).status, 201);
  let k = await ambil(); assert.ok(k.pernyataanBertentangan); assert.ok(k.keys.includes("BAHAN_PERLU_DICEK")); assert.equal(k.items.BAHAN_PERLU_DICEK.alasan[0].kode, "PERNYATAAN_BERTENTANGAN");
  assert.equal((await daftar(w, "&kelengkapan=BAHAN_PERLU_DICEK")).total, 1);
  assert.equal((await w.a.get("/api/production/work-orders/kelengkapan-hitung")).body.counts.BAHAN_PERLU_DICEK, 1);
  const dr = (await w.a.get(`/api/production/units/${u.id}/adopsi`)).body; assert.ok(dr.adopsi.kelengkapan.pernyataanBertentangan); assert.equal(dr.pernyataanTanpaBahan.aktif.status, "ACTIVE");
  const { u: u2 } = await unit("READY_FOR_DELIVERY", 7, "RES-KL-141"); await w.a.post(`/api/production/units/${u2.id}/pernyataan-tanpa-bahan`, { alasan: "Tanpa bahan, hanya servis" }, { "Idempotency-Key": kunci("p") });
  assert.equal((await w.a.post(`/api/production/units/${u2.id}/provisional-usages`, { name: "BAHAN SEMENTARA", qty: 1, uom: "KG", originNote: "Beli sendiri", alasanPencatatan: "uji" }, { "Idempotency-Key": kunci("sem") })).status, 201);
  assert.ok(kel((await daftar(w)).units.find((x) => x.unitCode === u2.unitCode)).keys.includes("BAHAN_PERLU_DICEK"));
  assert.equal((await w.a.post(`${url}/cabut`, { alasan: "Ternyata dipakai bahan" })).status, 200);
  k = await ambil(); assert.ok(!k.pernyataanBertentangan); assert.ok(!k.keys.includes("BAHAN_PERLU_DICEK")); assert.ok(!k.keys.includes("BAHAN_BELUM_DICATAT"));
});

test("C16. pencatatan bahan dan pernyataan BERJALAN BERSAMAAN: hasil akhir selalu konsisten (pernyataan ditolak 409 ATAU pertentangan terdeteksi) — tidak pernah lengkap diam-diam", async () => {
  const w = await dunia(); const mat = await createTestMaterial({ code: "KL-C16", name: "BAHAN C16", unit: "KG" }); await seedBalance(mat.id, 100);
  const hasil = [];
  for (let i = 0; i < 8; i++) {
    const { u } = await unit("READY_FOR_DELIVERY", 5 + i, `RES-KL-15${i}`);
    const catat = i % 2 === 0
      ? () => w.a.post(`/api/production/units/${u.id}/provisional-usages`, { name: `BAHAN BERSAMAAN ${i}`, qty: 1, uom: "KG", originNote: "Beli sendiri", alasanPencatatan: "uji" }, { "Idempotency-Key": kunci("sem") })
      : () => w.a.post(`/api/units/${u.id}/materials`, { materialId: mat.id, qty: 1 }, { "Idempotency-Key": kunci("iss") });
    const [p, c] = await Promise.all([w.a.post(`/api/production/units/${u.id}/pernyataan-tanpa-bahan`, { alasan: "Tanpa bahan baru, servis" }, { "Idempotency-Key": kunci("p") }), catat()]);
    assert.equal(c.status, 201, `pencatatan selalu berhasil: ${JSON.stringify(c.body).slice(0, 120)}`); assert.ok([201, 409].includes(p.status), `pernyataan 201/409, dapat ${p.status}`);
    const k = kel((await daftar(w)).units.find((x) => x.unitCode === u.unitCode)); const aktif = await testPrisma.unitMaterialDeclaration.count({ where: { unitId: u.id, status: "ACTIVE" } });
    assert.ok(!k.keys.includes("BAHAN_BELUM_DICATAT"), "ada catatan bahan → tidak pernah 'belum dicatat'");
    if (aktif === 1) { assert.equal(p.status, 201); assert.ok(k.keys.includes("BAHAN_PERLU_DICEK") && k.pernyataanBertentangan, "pernyataan lolos bersamaan → pertentangan WAJIB terlihat"); }
    else { assert.equal(p.status, 409); assert.equal(p.body.code, "SUDAH_ADA_CATATAN_BAHAN"); assert.ok(!k.pernyataanBertentangan); }
    hasil.push(p.status);
    const dr = (await w.a.get(`/api/production/units/${u.id}/adopsi`)).body; assert.deepEqual(dr.adopsi.kelengkapan.keys, k.keys, "drawer = daftar");
  }
  console.log("C16 hasil pernyataan (201=lolos lalu bertentangan, 409=ditolak):", JSON.stringify(hasil));
});

