// UX GUDANG TAHAP 2 — Pengeluaran Material dan Transfer Stok, DB terisolasi. Menguji: tampilan/aksi per status (satu sumber), izin hanya-lihat, ketersediaan stok per baris,
// stok TIDAK tersentuh sebelum posting (hanya issue/dispatch/receive yang menulis movement, satu kali), retry/klik ganda idempoten, dokumen dibatalkan → "Buat ulang" tertaut (aman diulang),
// ISSUED/COMPLETED tanpa aksi (koreksi lewat jalur resmi), dokumen milik Produksi V2 tanpa aksi, dan tidak ada dampak ke dokumen lain.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser, createTestMaterial, createTestUnit, seedBalance } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { ensureDefaultChartOfAccounts } from "../../src/services/finance/accounts.js";

let server; let seq = 0;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const MI = "/api/inventory/material-issues";
const ST = "/api/inventory/transfers";

async function dunia() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const [gudang, lead] = await Promise.all(["WAREHOUSE", "PRODUCTION_LEAD"].map((r) => createTestUser({ roles: [r] })));
  const c = (u) => makeClient(server.baseUrl, u.token);
  const wh = await testPrisma.warehouse.create({ data: { code: `WH-T2-${++seq}`, name: "Gudang T2" } });
  const loc = (zone, locationType) => testPrisma.storageLocation.create({ data: { warehouseId: wh.id, zone, locationType, code: `${zone}-T2-${++seq}` } });
  const [asal, tujuan] = [await loc("RM", "RAW_MATERIAL_AREA").catch(() => loc("RCV", "RECEIVING_AREA")), await loc("FG", "FINISHED_GOODS_AREA")];
  const busa = await createTestMaterial({ name: "Busa T2" });
  const kain = await createTestMaterial({ name: "Kain T2" });
  await seedBalance(busa.id, 50); await seedBalance(kain.id, 20);
  return { g: c(gudang), p: c(lead), gudang, asal, tujuan, busa, kain };
}
const stok = async (materialId) => (await testPrisma.stockMovement.aggregate({ where: { materialId }, _sum: { qty: true } }))._sum.qty?.toNumber?.() ?? Number(_sum.qty ?? 0);
const jumlahMov = () => testPrisma.stockMovement.count();
const buatMI = async (w, extra = {}) => {
  const r = await w.g.post(MI, { sourceType: "MANUAL", department: "Produksi", lines: [{ materialId: w.busa.id, requestedQty: 10 }, { materialId: w.kain.id, requestedQty: 5 }], ...extra });
  assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body;
};
const buatST = async (w, extra = {}) => {
  const r = await w.g.post(ST, { transferType: "ZONE_TO_ZONE", sourceLocationId: w.asal.id, destinationLocationId: w.tujuan.id, lines: [{ materialId: w.busa.id, qtySent: 8 }], ...extra });
  assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body;
};
const maju = async (w, base, id, status) => { const r = await w.g.patch(`${base}/${id}`, { status }); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body; };
const kode = (aksi) => aksi.map((a) => a.kode);

test("MI: tampilan & aksi per status — satu sumber; stok tidak berubah sebelum Konfirmasi keluar; Konfirmasi keluar menulis movement SEKALI", async () => {
  const w = await dunia(); const awal = await jumlahMov();
  const mi = await buatMI(w);
  let d = (await w.g.get(`${MI}/${mi.id}`)).body;
  assert.equal(d.tampilan.kode, "DRAF"); assert.equal(d.tampilan.pengaruhStok, "BELUM"); assert.equal(d.izin.tulis, true);
  assert.deepEqual(d.tampilan.tahap.map((t) => t.kode), ["DRAF", "MENUNGGU", "DISETUJUI", "SIAP", "DIAMBIL", "KELUAR"]); assert.equal(d.tampilan.tahapIndeks, 0);
  assert.ok(kode(d.tampilan.aksi).includes("AJUKAN")); assert.ok(kode(d.tampilan.aksi).includes("BATALKAN"));
  assert.ok(d.ketersediaan.every((k) => k.cukup && k.tersedia >= 0), "stok cukup");
  const langkah = [["WAITING_APPROVAL", "MENUNGGU", "BELUM", "SETUJUI"], ["APPROVED", "DISETUJUI", "DICADANG", "SIAPKAN"], ["READY_TO_PICK", "SIAP", "DICADANG", "TANDAI_DIAMBIL"], ["PICKED", "DIAMBIL", "DICADANG", "KONFIRMASI_KELUAR"]];
  for (const [status, tahap, pengaruh, aksiUtama] of langkah) {
    await maju(w, MI, mi.id, status);
    d = (await w.g.get(`${MI}/${mi.id}`)).body;
    assert.equal(d.tampilan.pengaruhStok, pengaruh, status); assert.equal(d.tampilan.kode, tahap); assert.ok(kode(d.tampilan.aksi).includes(aksiUtama), `${status} → ${aksiUtama}`);
    assert.equal(await jumlahMov(), awal, "belum ada pengeluaran");
  }
  assert.equal(await stok(w.busa.id), 50);
  const keluar0 = await w.g.post(`${MI}/${mi.id}/issue`, {}); assert.equal(keluar0.status, 200, JSON.stringify(keluar0.body));
  const keluar = { body: (await w.g.get(`${MI}/${mi.id}`)).body };
  assert.equal(keluar.body.tampilan.kode, "DIKELUARKAN"); assert.equal(keluar.body.tampilan.pengaruhStok, "SUDAH"); assert.deepEqual(keluar.body.tampilan.aksi, [], "ISSUED tanpa aksi — koreksi lewat jalur resmi");
  assert.equal(await stok(w.busa.id), 40); assert.equal(await stok(w.kain.id), 15);
  // klik ganda / retry: tidak ada movement kedua
  const ulang = await w.g.post(`${MI}/${mi.id}/issue`, {}); assert.equal(ulang.status, 200); assert.equal(ulang.body.ulang, true);
  assert.equal(await stok(w.busa.id), 40); assert.equal(await jumlahMov(), awal + 2, "tepat dua movement ISSUE (satu per baris)");
  // jejak: disetujui + dikeluarkan
  d = (await w.g.get(`${MI}/${mi.id}`)).body; assert.ok(Array.isArray(d.jejak) && d.jejak.length >= 2);
  // PATCH status yang sama setelah final ditolak; pembatalan dokumen ISSUED ditolak
  assert.equal((await w.g.patch(`${MI}/${mi.id}/cancel`, { reason: "salah" })).status, 400);
});

test("MI: retry PATCH status & approve ganda idempoten (satu catatan persetujuan, bukan galat)", async () => {
  const w = await dunia(); const mi = await buatMI(w);
  await maju(w, MI, mi.id, "WAITING_APPROVAL"); const a = await maju(w, MI, mi.id, "APPROVED"); assert.equal(a.ulang, false);
  const b = await w.g.patch(`${MI}/${mi.id}`, { status: "APPROVED" }); assert.equal(b.status, 200); assert.equal(b.body.ulang, true);
  const ev = await testPrisma.activityEvent.count({ where: { entityType: "material_issue", entityId: mi.id, eventType: "DOCUMENT_APPROVED" } }); assert.equal(ev, 1);
  // melompat tetap ditolak
  assert.equal((await w.g.patch(`${MI}/${mi.id}`, { status: "PICKED" })).status, 400);
});

test("MI: ketersediaan — stok kurang ditandai per baris dan cadangan dokumen lain dikurangkan", async () => {
  const w = await dunia();
  const besar = await buatMI(w, { lines: [{ materialId: w.busa.id, requestedQty: 45 }] });
  await maju(w, MI, besar.id, "WAITING_APPROVAL"); await maju(w, MI, besar.id, "APPROVED");
  const lain = await buatMI(w, { lines: [{ materialId: w.busa.id, requestedQty: 10 }] });
  const d = (await w.g.get(`${MI}/${lain.id}`)).body; const k = d.ketersediaan[0];
  assert.equal(k.saldo, 50); assert.equal(k.dicadangLain, 45); assert.equal(k.tersedia, 5); assert.equal(k.cukup, false);
  const dm = (await w.g.get(`${MI}/${besar.id}`)).body.ketersediaan[0]; assert.equal(dm.cukup, true, "cadangan dokumen sendiri tidak dihitung sebagai kurang");
});

test("MI: batalkan → buat ulang tertaut (dokumen lama tidak berubah), aman diulang; status lain/V2/komplain ditolak", async () => {
  const w = await dunia(); const mi = await buatMI(w); const awal = await jumlahMov();
  assert.equal((await w.g.post(`${MI}/${mi.id}/buat-ulang`, { alasan: "tes" })).status, 409, "bukan Dibatalkan");
  const c1 = await w.g.patch(`${MI}/${mi.id}/cancel`, { reason: "salah jumlah" }); assert.equal(c1.status, 200);
  assert.equal(c1.body.tampilan?.kode ?? (await w.g.get(`${MI}/${mi.id}`)).body.tampilan.kode, "DIBATALKAN");
  const c2 = await w.g.patch(`${MI}/${mi.id}/cancel`, { reason: "salah jumlah" }); assert.equal(c2.status, 200); assert.equal(c2.body.ulang, true);
  assert.ok(kode((await w.g.get(`${MI}/${mi.id}`)).body.tampilan.aksi).includes("BUAT_ULANG"));
  assert.equal((await w.g.post(`${MI}/${mi.id}/buat-ulang`, { alasan: "" })).status, 400, "alasan wajib");
  const b1 = await w.g.post(`${MI}/${mi.id}/buat-ulang`, { alasan: "jumlah diperbaiki" }); assert.equal(b1.status, 201, JSON.stringify(b1.body));
  assert.equal(b1.body.tampilan.kode, "DRAF"); assert.equal(b1.body.dariNomor, mi.issueNumber); assert.equal(b1.body.ulang, false); assert.equal(b1.body.lines.length, 2);
  const b2 = await w.g.post(`${MI}/${mi.id}/buat-ulang`, { alasan: "jumlah diperbaiki" }); assert.equal(b2.status, 200); assert.equal(b2.body.ulang, true); assert.equal(b2.body.id, b1.body.id, "satu dokumen baru saja");
  assert.equal(await testPrisma.materialIssue.count(), 2);
  const baru = (await w.g.get(`${MI}/${b1.body.id}`)).body; assert.ok(baru.jejak.some((j) => j.aksi === "DIBUAT_ULANG_DARI"), JSON.stringify(baru.jejak));
  const lama = await testPrisma.materialIssue.findUnique({ where: { id: mi.id } }); assert.equal(lama.status, "CANCELLED");
  assert.equal(await jumlahMov(), awal, "tidak ada movement dari pembatalan / buat ulang");
});

test("MI: izin hanya-lihat (tanpa aksi, server menolak tulis); dokumen milik Produksi V2 tanpa aksi", async () => {
  const w = await dunia(); const mi = await buatMI(w);
  const baca = await w.p.get(`${MI}/${mi.id}`);
  if (baca.status === 200) { assert.equal(baca.body.izin.tulis, false); assert.deepEqual(baca.body.tampilan.aksi, []); assert.equal(baca.body.tampilan.kode, "DRAF"); } else assert.equal(baca.status, 403);
  assert.equal((await w.p.patch(`${MI}/${mi.id}`, { status: "WAITING_APPROVAL" })).status, 403);
  assert.equal((await testPrisma.materialIssue.findUnique({ where: { id: mi.id } })).status, "DRAFT");
  const { tampilanMaterialIssue } = await import("../../src/services/dokumenGudang.js");
  const v2 = tampilanMaterialIssue({ status: "APPROVED", productionPlanId: "x" }); assert.equal(v2.kode, "V2"); assert.deepEqual(v2.aksi, []);
});

test("ST: tampilan & aksi per status; Kirim barang menulis SATU movement negatif, Terima SATU positif; selisih terlihat; klik ganda idempoten", async () => {
  const w = await dunia(); const st = await buatST(w); const awal = await jumlahMov();
  let d = (await w.g.get(`${ST}/${st.id}`)).body;
  assert.equal(d.tampilan.kode, "DRAF"); assert.deepEqual(d.tampilan.tahap.map((t) => t.kode), ["DRAF", "MENUNGGU", "DISETUJUI", "DIAMBIL", "JALAN", "SELESAI"]);
  assert.ok(kode(d.tampilan.aksi).includes("AJUKAN"));
  for (const [status, tahap, aksiUtama] of [["WAITING_APPROVAL", "MENUNGGU", "SETUJUI"], ["APPROVED", "DISETUJUI", "TANDAI_DIAMBIL"], ["PICKED", "DIAMBIL", "KIRIM"]]) {
    await maju(w, ST, st.id, status); d = (await w.g.get(`${ST}/${st.id}`)).body;
    assert.equal(d.tampilan.kode, tahap); assert.equal(d.tampilan.pengaruhStok, "BELUM"); assert.ok(kode(d.tampilan.aksi).includes(aksiUtama));
    assert.equal(await jumlahMov(), awal, "belum ada movement");
  }
  const kirim0 = await w.g.post(`${ST}/${st.id}/dispatch`, {}); assert.equal(kirim0.status, 200, JSON.stringify(kirim0.body));
  const kirim = { ...kirim0, body: (await w.g.get(`${ST}/${st.id}`)).body };
  assert.equal(kirim.body.tampilan.kode, "DALAM_PERJALANAN"); assert.equal(kirim.body.tampilan.pengaruhStok, "BERKURANG"); assert.deepEqual(kode(kirim.body.tampilan.aksi), ["TERIMA"]);
  assert.equal(await stok(w.busa.id), 42); assert.equal(await jumlahMov(), awal + 1);
  const kirim2 = await w.g.post(`${ST}/${st.id}/dispatch`, {}); assert.equal(kirim2.status, 200); assert.equal(kirim2.body.ulang, true);
  assert.equal(await stok(w.busa.id), 42, "dispatch kedua tidak menulis lagi");
  const baris = kirim.body.lines[0];
  const terima0 = await w.g.post(`${ST}/${st.id}/receive`, { lines: [{ lineId: baris.id, qtyReceived: 7 }] }); assert.equal(terima0.status, 200, JSON.stringify(terima0.body));
  const terima = { ...terima0, body: (await w.g.get(`${ST}/${st.id}`)).body };
  assert.equal(terima.body.tampilan.kode, "SELESAI"); assert.deepEqual(terima.body.tampilan.aksi, []);
  assert.equal(await stok(w.busa.id), 49, "42 + 7: selisih 1 hilang dari saldo"); assert.equal(await jumlahMov(), awal + 2);
  const terima2 = await w.g.post(`${ST}/${st.id}/receive`, { lines: [{ lineId: baris.id, qtyReceived: 7 }] }); assert.equal(terima2.status, 200); assert.equal(terima2.body.ulang, true);
  assert.equal(await stok(w.busa.id), 49); assert.equal(await jumlahMov(), awal + 2);
  d = (await w.g.get(`${ST}/${st.id}`)).body; assert.ok(d.jejak.length >= 2); assert.equal(d.lines[0].qtyReceived, 7);
});

test("ST: batalkan sebelum kirim → buat ulang tertaut & idempoten; setelah dikirim tak bisa dibatalkan; hanya-lihat tanpa aksi", async () => {
  const w = await dunia(); const st = await buatST(w); const awal = await jumlahMov();
  assert.equal((await w.g.post(`${ST}/${st.id}/buat-ulang`, { alasan: "tes" })).status, 409);
  assert.equal((await w.g.patch(`${ST}/${st.id}/cancel`, { reason: "lokasi salah" })).status, 200);
  const c2 = await w.g.patch(`${ST}/${st.id}/cancel`, { reason: "lokasi salah" }); assert.equal(c2.status, 200); assert.equal(c2.body.ulang, true);
  assert.ok(kode((await w.g.get(`${ST}/${st.id}`)).body.tampilan.aksi).includes("BUAT_ULANG_TRANSFER"));
  const b1 = await w.g.post(`${ST}/${st.id}/buat-ulang`, { alasan: "lokasi diperbaiki" }); assert.equal(b1.status, 201, JSON.stringify(b1.body)); assert.equal(b1.body.tampilan.kode, "DRAF"); assert.equal(b1.body.dariNomor, st.transferNumber);
  const b2 = await w.g.post(`${ST}/${st.id}/buat-ulang`, { alasan: "lokasi diperbaiki" }); assert.equal(b2.status, 200); assert.equal(b2.body.id, b1.body.id); assert.equal(await testPrisma.stockTransfer.count(), 2);
  assert.equal(await jumlahMov(), awal);
  // setelah dikirim: tidak bisa dibatalkan
  const st2 = await buatST(w); for (const s of ["WAITING_APPROVAL", "APPROVED", "PICKED"]) await maju(w, ST, st2.id, s);
  assert.equal((await w.g.post(`${ST}/${st2.id}/dispatch`, {})).status, 200);
  assert.equal((await w.g.patch(`${ST}/${st2.id}/cancel`, { reason: "terlambat" })).status, 400);
  assert.equal((await testPrisma.stockTransfer.findUnique({ where: { id: st2.id } })).status, "IN_TRANSIT");
  // hanya-lihat
  const baca = await w.p.get(`${ST}/${st.id}`);
  if (baca.status === 200) { assert.equal(baca.body.izin.tulis, false); assert.deepEqual(baca.body.tampilan.aksi, []); } else assert.equal(baca.status, 403);
  assert.equal((await w.p.post(`${ST}/${st2.id}/receive`, {})).status, 403);
});

test("Daftar MI/ST memuat tampilan per baris (label, tahap) tanpa menyentuh stok", async () => {
  const w = await dunia(); await buatMI(w); await buatST(w); const awal = await jumlahMov();
  const lm = (await w.g.get(MI)).body; const ls = (await w.g.get(ST)).body;
  const arr = (x) => (Array.isArray(x) ? x : x.issues ?? x.transfers ?? x.items ?? x.data);
  assert.ok(arr(lm).every((r) => r.tampilan?.label && r.tampilan.tahap.length === 6)); assert.ok(arr(ls).every((r) => r.tampilan?.label));
  assert.equal(await jumlahMov(), awal);
});

test("Pemakai lain createMaterialIssue (Kasus Komplain) tetap bekerja: tanda tangan lama tanpa argumen db", async () => {
  const { createMaterialIssue } = await import("../../src/routes/materialIssue.js");
  const w = await dunia(); const { unit } = await createTestUnit();
  const r = await createMaterialIssue({ sourceType: "MANUAL", lines: [{ materialId: w.busa.id, requestedQty: 1 }], unitId: unit.id }, w.gudang.user.id);
  assert.equal(r.status, "DRAFT");
});
