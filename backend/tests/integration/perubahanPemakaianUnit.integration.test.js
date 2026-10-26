// PERUBAHAN PEMAKAIAN per bahan (Okt 2026): UBAH JUMLAH dan GANTI BAHAN dari tabel "Pemakaian aktual" drawer order, unit berjalan DAN terkirim.
// Hanya jalur stok resmi (RETURN/ISSUE baru, ledger lama utuh); ganti bahan atomik (dua pergerakan sekaligus atau tidak sama sekali); harga HPP mengikuti tanggal pemakaian dilaporkan (unit terkirim);
// perubahan yang perlu persetujuan memakai koreksi pemakaian berpersetujuan yang sudah ada.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser, createTestMaterial, createTestUnit, seedBalance } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

let seq = 0; const kunci = (p = "ubh") => `${p}-${Date.now()}-${++seq}-uji-kunci`;
const HARI = 86400_000;
const wib = (d) => new Date(new Date(d).getTime() + 7 * 3600_000).toISOString().slice(0, 10);
const tgl = (hariLalu = 0) => wib(Date.now() - hariLalu * HARI);
async function dunia({ status = "IN_PRODUCTION", saldoA = 100, saldoB = 50 } = {}) {
  const admin = await createTestUser({ roles: ["ADMIN"] }); const fin = await createTestUser({ roles: ["FINANCE"] }); const sales = await createTestUser({ roles: ["SALES"] });
  const A = await createTestMaterial({ code: `BHN-A${++seq}`, name: "BUSA A", unit: "KG" }); const B = await createTestMaterial({ code: `BHN-B${++seq}`, name: "BUSA B", unit: "KG" });
  if (saldoA) await seedBalance(A.id, saldoA, { unitCost: 20000 }); if (saldoB) await seedBalance(B.id, saldoB, { unitCost: 10000 });
  const { unit, order } = await createTestUnit({ status: "IN_PRODUCTION", createdAt: new Date(Date.now() - 20 * HARI) });
  const c = (u) => makeClient(server.baseUrl, u.token);
  const w = { admin, fin, sales, a: c(admin), f: c(fin), s: c(sales), A, B, unit, order, status };
  w.selesaikan = async () => { await testPrisma.unit.update({ where: { id: unit.id }, data: { status: "DELIVERED" } }); w.status = "DELIVERED"; };
  return w;
}
const saldo = async (id) => Number((await testPrisma.$queryRaw`SELECT COALESCE(SUM(qty),0)::float AS s FROM stock_movements WHERE material_id = ${id}::uuid`)[0].s);
const jumlahMov = (w) => testPrisma.stockMovement.count({ where: { unitId: w.unit.id } });
const PRA = (w) => `/api/production/units/${w.unit.id}/perubahan-pemakaian/pratinjau`;
const PASANG = (w) => `/api/production/units/${w.unit.id}/perubahan-pemakaian`;
const pakai = async (w, mat, qty) => { const r = await w.a.post(`/api/units/${w.unit.id}/materials`, { materialId: mat.id, qty }, { "Idempotency-Key": kunci("pakai") }); assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body; };
const lihat = async (w, body) => { const p = await w.a.post(PRA(w), body); assert.equal(p.status, 200, JSON.stringify(p.body)); return p.body; };
const terap = (w, body, p, extra = {}, k = kunci()) => w.a.post(PASANG(w), { ...body, alasan: "Salah catat saat produksi", dilihat: p ? p.sidik : undefined, ...extra }, { "Idempotency-Key": k });
const hargaDiTgl = (matId, harga, mulai, k) => testPrisma.materialHargaBerlaku.create({ data: { materialId: matId, jenis: "HARGA", unitPrice: String(harga), satuan: "KG", effectiveFrom: mulai, createdAt: mulai, reason: "harga uji", idempotencyKey: kunci(k ?? "hb") } });
const op = (movementId) => testPrisma.stockMovementBiayaOperasional.findFirst({ where: { movementId }, orderBy: { createdAt: "desc" } });

test("U1. UBAH JUMLAH turun pada unit berjalan: pratinjau jelas (RETURN baru), tersimpan sebagai baris BARU; ledger lama utuh; alasan + riwayat; klik tanpa pratinjau/alasan ditolak", async () => {
  const w = await dunia(); const asal = await pakai(w, w.A, 5);
  const body = { materialId: w.A.id, qtyBaru: 3 }; const p = await lihat(w, body);
  assert.equal(p.mode, "UBAH_JUMLAH"); assert.equal(p.jalur, "LANGSUNG"); assert.equal(p.boleh, true); assert.equal(p.dari.bersihSebelum, 5); assert.equal(p.dari.bersihSesudah, 3);
  assert.equal(p.langkah.length, 1); assert.equal(p.langkah[0].jenis, "RETURN"); assert.equal(p.langkah[0].qty, 2); assert.equal(p.langkah[0].stok.saldoSebelum, 95); assert.equal(p.langkah[0].stok.saldoSesudah, 97);
  assert.equal(p.waktu.pemakaianDilaporkan, null); assert.equal(p.tanggalWajib, false); assert.equal(typeof p.langkah[0].hppOperasional.sidik, "string");
  const n0 = await jumlahMov(w);
  assert.equal((await terap(w, body, null)).body.code, "UNIT_PRATINJAU_WAJIB"); assert.equal((await terap(w, body, p, { alasan: "x" })).body.code, "UNIT_ALASAN_PEMBETULAN_WAJIB");
  assert.equal((await w.a.post(PASANG(w), { ...body, alasan: "Salah catat", dilihat: p.sidik })).body.code, "IDEMPOTENCY_KEY_INVALID");
  assert.equal(await jumlahMov(w), n0, "ditolak = tidak ada tulisan");
  const ok = await terap(w, body, p); assert.equal(ok.status, 201, JSON.stringify(ok.body)); assert.equal(ok.body.langkah.length, 1); assert.equal(ok.body.bersihSesudah, 3);
  const rows = await testPrisma.stockMovement.findMany({ where: { unitId: w.unit.id }, orderBy: { createdAt: "asc" } });
  assert.equal(rows.length, 2); assert.equal(rows[0].id, asal.id); assert.equal(Number(rows[0].qty), -5, "baris lama TIDAK diubah"); assert.equal(rows[1].type, "RETURN"); assert.equal(Number(rows[1].qty), 2);
  assert.ok(rows[1].note.startsWith(`Perubahan pemakaian (${w.unit.unitCode}): Salah catat saat produksi | Ubah jumlah`), rows[1].note); assert.equal(await saldo(w.A.id), 97);
  const ev = await testPrisma.activityEvent.findFirst({ where: { entityId: w.unit.id, eventType: "PRODUCTION_PERUBAHAN_PEMAKAIAN_BAHAN" } }); assert.ok(ev); assert.equal(ev.metadata.mode, "UBAH_JUMLAH"); assert.equal(ev.metadata.langkah.length, 1); assert.equal(ev.metadata.alasan, "Salah catat saat produksi"); assert.equal(ev.actorId, w.admin.user.id);
  const ad = await w.a.get(`/api/production/units/${w.unit.id}/adopsi`); assert.equal(ad.body.pemakaianAktual.total.find((t) => t.materialId === w.A.id).dipakai, 3, "tabel Pemakaian aktual: 5 → 3");
});

test("U2. UBAH JUMLAH naik pada unit berjalan = pengeluaran BARU (stok berkurang); bahan stok kurang ditolak jelas di pratinjau dan penerapan", async () => {
  const w = await dunia({ saldoA: 10 }); await pakai(w, w.A, 5);
  const p = await lihat(w, { materialId: w.A.id, qtyBaru: 8 }); assert.equal(p.langkah[0].jenis, "ISSUE"); assert.equal(p.langkah[0].qty, 3); assert.equal(p.langkah[0].stok.saldoSesudah, 2);
  const ok = await terap(w, { materialId: w.A.id, qtyBaru: 8 }, p); assert.equal(ok.status, 201, JSON.stringify(ok.body)); assert.equal(await saldo(w.A.id), 2);
  const p2 = await lihat(w, { materialId: w.A.id, qtyBaru: 20 }); assert.equal(p2.boleh, false); assert.ok(p2.penghalang.some((h) => h.kode === "SALDO_KURANG"));
  const n0 = await jumlahMov(w); const tolak = await terap(w, { materialId: w.A.id, qtyBaru: 20 }, p2); assert.equal(tolak.status, 409); assert.equal(tolak.body.code, "SALDO_KURANG"); assert.equal(await jumlahMov(w), n0);
});

test("U3. UNIT TERKIRIM: tanggal pemakaian dilaporkan WAJIB; harga HPP mengikuti tanggal itu (naik/turun); catatan baku memuat tanggal; retur mengikuti harga ISSUE asal", async () => {
  const w = await dunia(); await hargaDiTgl(w.A.id, 20000, new Date(Date.now() - 10 * HARI)); await hargaDiTgl(w.A.id, 30000, new Date(Date.now() - 2 * HARI), "hb2");
  const asal = await pakai(w, w.A, 4); assert.equal(Number((await op(asal.id)).unitCost), 30000, "pemakaian awal dicatat hari ini = harga sekarang"); await w.selesaikan();
  assert.equal((await w.a.post(PRA(w), { materialId: w.A.id, qtyBaru: 6 })).body.code, "UNIT_TANGGAL_PEMAKAIAN_WAJIB");
  const T = tgl(5); const body = { materialId: w.A.id, qtyBaru: 6, tanggalPemakaian: T }; const p = await lihat(w, body);
  assert.equal(p.tanggalWajib, true); assert.equal(p.waktu.pemakaianDilaporkan, T); assert.equal(p.langkah[0].jenis, "ISSUE"); assert.equal(p.langkah[0].hppOperasional.harga, 20000, "pemakaian terlambat melewati kenaikan harga: harga lama"); assert.equal(p.langkah[0].hppOperasional.tanggalDasar, T);
  assert.equal((await terap(w, { materialId: w.A.id, qtyBaru: 6 }, p)).body.code, "UNIT_TANGGAL_PEMAKAIAN_WAJIB");
  const ok = await terap(w, body, p); assert.equal(ok.status, 201, JSON.stringify(ok.body));
  const mv = await testPrisma.stockMovement.findUnique({ where: { id: ok.body.langkah[0].movementId } }); assert.ok(mv.note.startsWith(`Pembetulan unit terkirim (${w.unit.unitCode}) [dilaporkan ${T}]: Salah catat saat produksi | Ubah jumlah`), mv.note); assert.equal(wib(mv.createdAt), tgl(0));
  const o = await op(mv.id); assert.equal(Number(o.unitCost), 20000); assert.equal(o.basisDetail.dasarTanggal, T);
  const p2 = await lihat(w, { materialId: w.A.id, qtyBaru: 4, tanggalPemakaian: tgl(1) }); assert.equal(p2.langkah[0].jenis, "RETURN"); assert.equal(p2.langkah[0].qty, 2); assert.equal(p2.langkah[0].hppOperasional.basis, "HARGA_ISSUE_ASAL");
  const ok2 = await terap(w, { materialId: w.A.id, qtyBaru: 4, tanggalPemakaian: tgl(1) }, p2); assert.equal(ok2.status, 201, JSON.stringify(ok2.body)); const o2 = await op(ok2.body.langkah[0].movementId); assert.equal(o2.basisHarga, "HARGA_ISSUE_ASAL");
  const ad = await w.a.get(`/api/production/units/${w.unit.id}/adopsi`); const riw = ad.body.pemakaianAktual.baris.find((b) => b.id === mv.id); assert.equal(riw.dilaporkan, T); assert.equal(riw.hppOperasional.harga, 20000);
});

test("U4. GANTI BAHAN atomik: pengembalian bahan lama + pengeluaran bahan baru dalam SATU transaksi; dampak lengkap sebelum simpan; baris lama utuh", async () => {
  const w = await dunia(); await pakai(w, w.A, 5);
  const body = { materialId: w.A.id, qtyBaru: 0, keMaterialId: w.B.id, qtyKe: 4 }; const p = await lihat(w, body);
  assert.equal(p.mode, "GANTI_BAHAN"); assert.equal(p.jalur, "LANGSUNG"); assert.equal(p.langkah.length, 2); assert.deepEqual(p.langkah.map((l) => l.jenis), ["RETURN", "ISSUE"]); assert.equal(p.langkah[0].bahan.id, w.A.id); assert.equal(p.langkah[0].qty, 5); assert.equal(p.langkah[1].bahan.id, w.B.id); assert.equal(p.langkah[1].qty, 4);
  assert.equal(p.langkah[0].stok.saldoSesudah, 100); assert.equal(p.langkah[1].stok.saldoSebelum, 50); assert.equal(p.langkah[1].stok.saldoSesudah, 46); assert.match(p.ringkas.join(" "), /SEKALIGUS/); assert.equal(p.boleh, true);
  const ok = await terap(w, body, p); assert.equal(ok.status, 201, JSON.stringify(ok.body)); assert.equal(ok.body.langkah.length, 2);
  assert.equal(await saldo(w.A.id), 100); assert.equal(await saldo(w.B.id), 46); assert.equal(await jumlahMov(w), 3);
  const rows = await testPrisma.stockMovement.findMany({ where: { unitId: w.unit.id }, orderBy: { createdAt: "asc" } }); assert.equal(Number(rows[0].qty), -5, "ISSUE lama utuh"); assert.ok(rows.slice(1).every((r) => /Ganti bahan/.test(r.note)));
  const ev = await testPrisma.activityEvent.findFirst({ where: { entityId: w.unit.id, eventType: "PRODUCTION_PERUBAHAN_PEMAKAIAN_BAHAN" } }); assert.equal(ev.metadata.mode, "GANTI_BAHAN"); assert.equal(ev.metadata.langkah.length, 2);
  const tot = (await w.a.get(`/api/production/units/${w.unit.id}/adopsi`)).body.pemakaianAktual.total; assert.equal(tot.find((t) => t.materialId === w.A.id).dipakai, 0); assert.equal(tot.find((t) => t.materialId === w.B.id).dipakai, 4);
});

test("U5. GANTI BAHAN tidak pernah setengah jadi: stok pengganti kurang = ditolak penuh; kegagalan di langkah kedua membatalkan pengembalian langkah pertama (transaksi)", async () => {
  const w = await dunia({ saldoB: 2 }); await pakai(w, w.A, 5); const n0 = await jumlahMov(w); const sA = await saldo(w.A.id);
  const body = { materialId: w.A.id, qtyBaru: 0, keMaterialId: w.B.id, qtyKe: 4 }; const p = await lihat(w, body);
  assert.equal(p.boleh, false); assert.ok(p.penghalang.some((h) => h.kode === "SALDO_KURANG" && h.bahan === w.B.code)); const tolak = await terap(w, body, p); assert.equal(tolak.status, 409); assert.equal(tolak.body.code, "SALDO_KURANG");
  assert.equal(await jumlahMov(w), n0, "tidak ada pengembalian bahan lama yang tersisa"); assert.equal(await saldo(w.A.id), sA);
  // kegagalan SESUDAH langkah pertama (trigger uji menolak pengeluaran bahan pengganti): seluruh transaksi dibatalkan
  await testPrisma.stockMovement.create({ data: { materialId: w.B.id, type: "RECEIPT", qty: 20, note: "tambah stok" } });
  const p2 = await lihat(w, body); assert.equal(p2.boleh, true);
  await testPrisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION uji_tolak_b() RETURNS trigger AS $fn$ BEGIN IF NEW.material_id = '${w.B.id}'::uuid AND NEW.type::text = 'ISSUE' THEN RAISE EXCEPTION 'uji: pengeluaran bahan pengganti ditolak'; END IF; RETURN NEW; END $fn$ LANGUAGE plpgsql`);
  await testPrisma.$executeRawUnsafe("CREATE TRIGGER uji_tolak_b_trg BEFORE INSERT ON stock_movements FOR EACH ROW EXECUTE FUNCTION uji_tolak_b()");
  try {
    const n1 = await jumlahMov(w); const gagal = await terap(w, body, p2); assert.ok(gagal.status >= 400, `status ${gagal.status}`);
    assert.equal(await jumlahMov(w), n1, "pengembalian bahan lama ikut dibatalkan"); assert.equal(await saldo(w.A.id), sA);
    assert.equal(await testPrisma.v2Command.count({ where: { commandType: "UNIT_MATERIAL_EDIT_V1" } }), 0, "perintah idempotensi ikut dibatalkan (bisa dicoba lagi)");
  } finally { await testPrisma.$executeRawUnsafe("DROP TRIGGER IF EXISTS uji_tolak_b_trg ON stock_movements"); await testPrisma.$executeRawUnsafe("DROP FUNCTION IF EXISTS uji_tolak_b()"); }
  const ok = await terap(w, body, p2); assert.equal(ok.status, 201, JSON.stringify(ok.body)); assert.equal(await saldo(w.A.id), 100);
});

test("U6. KLIK GANDA: kunci sama = SATU hasil (replay), paralel pun satu; kunci sama dengan isian berbeda ditolak", async () => {
  const w = await dunia(); await pakai(w, w.A, 5); const body = { materialId: w.A.id, qtyBaru: 2 }; const p = await lihat(w, body); const k = kunci("dbl"); const n0 = await jumlahMov(w);
  const [r1, r2] = await Promise.all([terap(w, body, p, {}, k), terap(w, body, p, {}, k)]);
  assert.ok([r1.status, r2.status].every((x) => [200, 201, 409].includes(x)), `${r1.status}/${r2.status}`); assert.ok([r1.status, r2.status].includes(201)); assert.equal(await jumlahMov(w), n0 + 1, "satu pergerakan baru"); assert.equal(await saldo(w.A.id), 98);
  const ulang = await terap(w, body, p, {}, k); assert.equal(ulang.status, 200); assert.equal(ulang.body.ulang, true); assert.equal(await jumlahMov(w), n0 + 1);
  const beda = await terap(w, { materialId: w.A.id, qtyBaru: 1 }, p, {}, k); assert.equal(beda.status, 409); assert.equal(beda.body.code, "IDEMPOTENCY_KEY_REUSED");
});

test("U7. SALDO BERGESER / PEMAKAIAN BERGESER / DASAR HARGA BERGESER setelah pratinjau: ditolak 409 dan tidak ada yang tersimpan", async () => {
  const w = await dunia(); await pakai(w, w.A, 5);
  const bodyG = { materialId: w.A.id, qtyBaru: 0, keMaterialId: w.B.id, qtyKe: 4 }; const pG = await lihat(w, bodyG);
  await testPrisma.stockMovement.create({ data: { materialId: w.B.id, type: "ISSUE", qty: -3, note: "pengeluaran orang lain setelah pratinjau" } }); const n0 = await jumlahMov(w);
  const g1 = await terap(w, bodyG, pG); assert.equal(g1.status, 409); assert.equal(g1.body.code, "UNIT_SALDO_BERGESER"); assert.equal(g1.body.detail.bahan, w.B.code); assert.equal(await jumlahMov(w), n0);
  const body = { materialId: w.A.id, qtyBaru: 3 }; const p = await lihat(w, body); await pakai(w, w.A, 1); const n1 = await jumlahMov(w);
  const g2 = await terap(w, body, p); assert.equal(g2.status, 409); assert.ok(["UNIT_PEMAKAIAN_BERGESER", "UNIT_SALDO_BERGESER"].includes(g2.body.code), g2.body.code); assert.equal(await jumlahMov(w), n1);
  const w2 = await dunia(); await hargaDiTgl(w2.A.id, 20000, new Date(Date.now() - 10 * HARI)); await pakai(w2, w2.A, 4); await w2.selesaikan();
  const b3 = { materialId: w2.A.id, qtyBaru: 6, tanggalPemakaian: tgl(5) }; const p3 = await lihat(w2, b3); await hargaDiTgl(w2.A.id, 22000, new Date(Date.now() - 6 * HARI), "hb3"); const n2 = await jumlahMov(w2);
  const g3 = await terap(w2, b3, p3); assert.equal(g3.status, 409); assert.equal(g3.body.code, "UNIT_DASAR_HARGA_BERGESER"); assert.equal(await jumlahMov(w2), n2);
  const p4 = await lihat(w2, b3); assert.equal(p4.langkah[0].hppOperasional.harga, 22000); assert.equal((await terap(w2, b3, p4)).status, 201);
});

test("U8. IZIN dan batas: Sales/Finance ditolak; unit dibatalkan ditolak; validasi isian; tanpa perubahan/tanpa pemakaian ditolak jelas", async () => {
  const w = await dunia(); await pakai(w, w.A, 5); const body = { materialId: w.A.id, qtyBaru: 3 }; const p = await lihat(w, body);
  assert.equal((await w.s.post(PRA(w), body)).status, 403); assert.equal((await w.f.post(PRA(w), body)).status, 403); assert.equal((await w.s.post(PASANG(w), { ...body, alasan: "Salah catat", dilihat: p.sidik }, { "Idempotency-Key": kunci() })).status, 403);
  assert.equal((await w.f.post(PASANG(w), { ...body, alasan: "Salah catat", dilihat: p.sidik }, { "Idempotency-Key": kunci() })).status, 403);
  assert.equal((await w.a.post(PRA(w), { materialId: w.A.id, qtyBaru: -1 })).body.code, "QTY_TIDAK_VALID"); assert.equal((await w.a.post(PRA(w), { materialId: w.A.id, qtyBaru: 1.00001 })).body.code, "DESIMAL_BERLEBIH");
  assert.equal((await w.a.post(PRA(w), { materialId: w.A.id, qtyBaru: 5 })).body.penghalang[0].kode, "TIDAK_ADA_PERUBAHAN");
  assert.equal((await w.a.post(PRA(w), { materialId: w.B.id, qtyBaru: 1 })).body.penghalang[0].kode, "TIDAK_ADA_PEMAKAIAN");
  assert.equal((await w.a.post(PRA(w), { materialId: w.A.id, qtyBaru: 0, keMaterialId: w.B.id })).body.code, "QTY_TIDAK_VALID");
  assert.equal((await w.a.post(PRA(w), { materialId: w.A.id, qtyBaru: 0, keMaterialId: w.A.id, qtyKe: 1 })).body.penghalang[0].kode, "BAHAN_SAMA");
  assert.equal((await w.a.post(PRA(w), { materialId: w.A.id, qtyBaru: 5, keMaterialId: w.B.id, qtyKe: 1 })).body.penghalang[0].kode, "GANTI_TANPA_PENGEMBALIAN");
  await testPrisma.unit.update({ where: { id: w.unit.id }, data: { status: "CANCELLED" } }); assert.equal((await w.a.post(PRA(w), body)).body.code, "UNIT_DIBATALKAN");
  assert.equal((await terap(w, body, p)).body.code, "UNIT_DIBATALKAN");
});

test("U9. PERLU PERSETUJUAN: bahan dari dokumen Material Issue pada unit berjalan = jalur AJUKAN (ganti bahan diblokir); pengajuan membawa tanggal dilaporkan, stok baru berubah setelah disetujui orang lain, harga mengikuti tanggal", async () => {
  const w = await dunia(); const mi = await testPrisma.materialIssue.create({ data: { issueNumber: "MI-UJI-1", sourceType: "MANUAL", status: "ISSUED" } });
  await testPrisma.stockMovement.create({ data: { materialId: w.A.id, type: "ISSUE", qty: -5, unitId: w.unit.id, materialIssueId: mi.id, note: "dari Material Issue" } });
  const p = await lihat(w, { materialId: w.A.id, qtyBaru: 3 }); assert.equal(p.jalur, "AJUKAN"); assert.equal(p.dari.dokumenGudang, true); assert.equal(p.boleh, true); assert.match(p.ringkas.join(" "), /PENGAJUAN/);
  const pg = await lihat(w, { materialId: w.A.id, qtyBaru: 0, keMaterialId: w.B.id, qtyKe: 2 }); assert.equal(pg.boleh, false); assert.ok(pg.penghalang.some((h) => h.kode === "GANTI_BAHAN_DOKUMEN_GUDANG"));
  const lgs = await terap(w, { materialId: w.A.id, qtyBaru: 3 }, p); assert.equal(lgs.status, 409); assert.equal(lgs.body.code, "UNIT_PERLU_PERSETUJUAN");
  // unit terkirim: pengajuan membawa tanggal dilaporkan → harga HPP mengikuti tanggal itu saat disetujui
  await hargaDiTgl(w.A.id, 20000, new Date(Date.now() - 10 * HARI)); await hargaDiTgl(w.A.id, 30000, new Date(Date.now() - 2 * HARI), "hb2"); await w.selesaikan();
  const T = tgl(5); const pa = await lihat(w, { materialId: w.A.id, qtyBaru: 7, tanggalPemakaian: T, ajukan: true }); assert.equal(pa.jalur, "AJUKAN"); assert.equal(pa.langkah[0].hppOperasional.harga, 20000);
  const sA = await saldo(w.A.id); const aj = await w.a.post(`/api/production/units/${w.unit.id}/koreksi-pemakaian`, { materialId: w.A.id, qtyBaru: 7, alasan: "Pemakaian sebenarnya 7 kg", tanggalPemakaian: T }, { "Idempotency-Key": kunci("aj") });
  assert.equal(aj.status, 201, JSON.stringify(aj.body)); assert.equal(await saldo(w.A.id), sA, "diajukan = stok belum berubah"); assert.equal((await w.a.post(PRA(w), { materialId: w.A.id, qtyBaru: 9, tanggalPemakaian: T, ajukan: true })).body.penghalang.find((h) => h.kode === "KOREKSI_TERTUNDA") !== undefined, true);
  assert.equal((await w.a.post(`/api/production/koreksi-pemakaian/${aj.body.id}/setujui`, {})).status, 403, "pemohon tidak bisa menyetujui sendiri");
  const setuju = await w.f.post(`/api/production/koreksi-pemakaian/${aj.body.id}/setujui`, {}); assert.equal(setuju.status, 200, JSON.stringify(setuju.body)); assert.equal(await saldo(w.A.id), sA - 2);
  const mv = await testPrisma.stockMovement.findFirst({ where: { unitId: w.unit.id, correctionId: aj.body.id } }); assert.ok(mv.note.includes(`[dilaporkan ${T}]`), mv.note);
  const o = await op(mv.id); assert.equal(Number(o.unitCost), 20000, "harga pada tanggal pemakaian yang dilaporkan, bukan hari persetujuan (30000)"); assert.equal(o.basisDetail.dasarTanggal, T);
  const riw = (await w.a.get(`/api/production/units/${w.unit.id}/adopsi`)).body.pemakaianAktual.baris.find((b) => b.id === mv.id); assert.equal(riw.dilaporkan, T);
});

test("U10. catatan berformat baku (pembetulan / koreksi disetujui) tidak bisa dipalsukan lewat catatan pemakaian pada unit berjalan (dasar harga hanya dari server)", async () => {
  const w = await dunia(); const T = tgl(5);
  for (const note of [`Pembetulan unit terkirim (${w.unit.unitCode}) [dilaporkan ${T}]: palsu`, `Koreksi pemakaian KG-1 [dilaporkan ${T}] atas ${w.unit.unitCode} (1 → 2)`]) {
    const r = await w.a.post(`/api/units/${w.unit.id}/materials`, { materialId: w.A.id, qty: 1, note }, { "Idempotency-Key": kunci("sp") }); assert.equal(r.status, 400); assert.equal(r.body.code, "CATATAN_FORMAT_RESERVED");
  }
  assert.equal(await jumlahMov(w), 0);
});
