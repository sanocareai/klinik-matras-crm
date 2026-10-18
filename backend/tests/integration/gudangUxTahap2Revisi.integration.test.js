// UX GUDANG TAHAP 2 (lanjutan) — keputusan produk: ubah isi Draf, tarik kembali/kembalikan untuk revisi, retry yang ketat (ulang:true hanya untuk pengulangan yang SAMA), konkurensi satu-kali-efek,
// dan selisih transfer (saldo sebelum/dalam perjalanan/sesudah, penyebab wajib, jalur penyelesaian, bukan pemakaian produksi). DB terisolasi.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser, createTestMaterial, seedBalance } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { ensureDefaultChartOfAccounts } from "../../src/services/finance/accounts.js";

let server; let seq = 0;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const MI = "/api/inventory/material-issues"; const ST = "/api/inventory/transfers";
async function dunia() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const [gudang, gudang2, lead] = await Promise.all(["WAREHOUSE", "WAREHOUSE", "PRODUCTION_LEAD"].map((r) => createTestUser({ roles: [r] })));
  const c = (u) => makeClient(server.baseUrl, u.token);
  const wh = await testPrisma.warehouse.create({ data: { code: `WH-RV-${++seq}`, name: "Gudang RV" } });
  const loc = (zone, locationType) => testPrisma.storageLocation.create({ data: { warehouseId: wh.id, zone, locationType, code: `${zone}-RV-${++seq}` } });
  const asal = await loc("RM", "RAW_MATERIAL_AREA"); const tujuan = await loc("WIP", "WIP_AREA"); const lain = await loc("FG", "FINISHED_GOODS_AREA");
  const busa = await createTestMaterial({ name: "Busa RV" }); const kain = await createTestMaterial({ name: "Kain RV" }); const lem = await createTestMaterial({ name: "Lem RV" });
  await seedBalance(busa.id, 50); await seedBalance(kain.id, 20); await seedBalance(lem.id, 30);
  return { g: c(gudang), g2: c(gudang2), p: c(lead), gudang, asal, tujuan, lain, busa, kain, lem };
}
const stok = async (id) => Number((await testPrisma.stockMovement.aggregate({ where: { materialId: id }, _sum: { qty: true } }))._sum.qty ?? 0);
const mov = () => testPrisma.stockMovement.count();
const jurnal = () => testPrisma.finJournalEntry.count();
const buatMI = async (w, extra = {}) => { const r = await w.g.post(MI, { sourceType: "MANUAL", department: "Produksi", lines: [{ materialId: w.busa.id, requestedQty: 10 }, { materialId: w.kain.id, requestedQty: 5 }], ...extra }); assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body; };
const buatST = async (w, extra = {}) => { const r = await w.g.post(ST, { transferType: "ZONE_TO_ZONE", sourceLocationId: w.asal.id, destinationLocationId: w.tujuan.id, lines: [{ materialId: w.busa.id, qtySent: 8 }, { materialId: w.lem.id, qtySent: 5 }], ...extra }); assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body; };
const ambil = async (w, base, id) => (await w.g.get(`${base}/${id}`)).body;
const maju = async (w, base, id, ...ss) => { for (const s of ss) { const rev = (await ambil(w, base, id)).revisi; const r = await w.g.patch(`${base}/${id}`, { status: s, revisi: rev }); assert.equal(r.status, 200, JSON.stringify(r.body)); } };
const kode = (a) => a.map((x) => x.kode);

test("MI: ubah isi Draf — bahan, jumlah, catatan; validasi ulang; jejak; ketersediaan baru; stok tidak tersentuh", async () => {
  const w = await dunia(); const mi = await buatMI(w); const awal = await mov(); const d0 = await ambil(w, MI, mi.id);
  assert.ok(kode(d0.tampilan.aksi).includes("UBAH_ISI")); assert.ok(d0.revisi);
  const r = await w.g.put(`${MI}/${mi.id}/isi`, { revisi: d0.revisi, notes: "perbaikan jumlah", lines: [{ materialId: w.busa.id, requestedQty: 12 }, { materialId: w.lem.id, requestedQty: 4 }] });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.tanpaPerubahan, false);
  assert.deepEqual(r.body.lines.map((l) => [l.materialId, l.requestedQty]).sort(), [[w.busa.id, 12], [w.lem.id, 4]].sort());
  assert.notEqual(r.body.revisi, d0.revisi); assert.equal(r.body.notes, "perbaikan jumlah"); assert.equal(r.body.ketersediaan.length, 2); assert.deepEqual(r.body.peringatan, []);
  const jejak = (await ambil(w, MI, mi.id)).jejak; const tulis = jejak.find((j) => j.aksi === "DIUBAH" && /Isi diubah/.test(j.teks)); assert.ok(tulis, JSON.stringify(jejak));
  assert.match(tulis.teks, /Jumlah .*: 10 → 12/); assert.match(tulis.teks, /Ditambah: .* 4/); assert.match(tulis.teks, /Dihapus: /);
  assert.equal(await mov(), awal, "Draf tidak memengaruhi stok");
  // tanpa perubahan + revisi masih segar → tanpaPerubahan; revisi basi + isi sama = pengulangan (ulang:true)
  const fresh = (await ambil(w, MI, mi.id)).revisi;
  const t1 = await w.g.put(`${MI}/${mi.id}/isi`, { revisi: fresh, lines: [{ materialId: w.busa.id, requestedQty: 12 }, { materialId: w.lem.id, requestedQty: 4 }] }); assert.equal(t1.status, 200); assert.equal(t1.body.tanpaPerubahan, true); assert.equal(t1.body.ulang, false);
  const t2 = await w.g.put(`${MI}/${mi.id}/isi`, { revisi: d0.revisi, notes: "perbaikan jumlah", lines: [{ materialId: w.busa.id, requestedQty: 12 }, { materialId: w.lem.id, requestedQty: 4 }] }); assert.equal(t2.status, 200); assert.equal(t2.body.ulang, true);
  assert.equal(await testPrisma.activityEvent.count({ where: { entityType: "material_issue", entityId: mi.id, eventType: "DOCUMENT_EDITED" } }), 2 /* header notes + item */, "retry tidak menambah jejak");
});

test("MI: ubah isi Draf ditolak untuk: revisi basi/tanpa revisi, bukan Draf, bahan ganda/nol/nonaktif/tak ada, hanya-lihat; stok kurang hanya diperingatkan", async () => {
  const w = await dunia(); const mi = await buatMI(w); const d0 = await ambil(w, MI, mi.id); const L = (x) => ({ revisi: d0.revisi, lines: x });
  assert.equal((await w.g.put(`${MI}/${mi.id}/isi`, { lines: [{ materialId: w.busa.id, requestedQty: 1 }] })).body.kode, "REVISI_WAJIB");
  assert.equal((await w.g.put(`${MI}/${mi.id}/isi`, L([{ materialId: w.busa.id, requestedQty: 0 }]))).status, 400);
  assert.equal((await w.g.put(`${MI}/${mi.id}/isi`, L([{ materialId: w.busa.id, requestedQty: 1 }, { materialId: w.busa.id, requestedQty: 2 }]))).body.kode, "BAHAN_GANDA");
  assert.equal((await w.g.put(`${MI}/${mi.id}/isi`, L([]))).status, 400);
  assert.equal((await w.g.put(`${MI}/${mi.id}/isi`, L([{ materialId: randomUUID(), requestedQty: 1 }]))).status, 404);
  const mati = await createTestMaterial({ name: "Mati", active: false }); assert.equal((await w.g.put(`${MI}/${mi.id}/isi`, L([{ materialId: mati.id, requestedQty: 1 }]))).status, 422);
  assert.equal((await w.p.put(`${MI}/${mi.id}/isi`, L([{ materialId: w.busa.id, requestedQty: 1 }]))).status, 403);
  // stok kurang: Draf tetap tersimpan, hanya diperingatkan
  const k = await w.g.put(`${MI}/${mi.id}/isi`, L([{ materialId: w.busa.id, requestedQty: 999 }])); assert.equal(k.status, 200); assert.equal(k.body.peringatan.length, 1); assert.equal(k.body.ketersediaan[0].cukup, false);
  // revisi basi + isi berbeda → 409; sesudah Ajukan (bukan Draf) → 409
  const basi = await w.g.put(`${MI}/${mi.id}/isi`, { revisi: d0.revisi, lines: [{ materialId: w.busa.id, requestedQty: 3 }] }); assert.equal(basi.status, 409); assert.equal(basi.body.kode, "REVISI_BASI");
  await maju(w, MI, mi.id, "WAITING_APPROVAL"); const rev = (await ambil(w, MI, mi.id)).revisi;
  const nd = await w.g.put(`${MI}/${mi.id}/isi`, { revisi: rev, lines: [{ materialId: w.busa.id, requestedQty: 3 }] }); assert.equal(nd.status, 409); assert.equal(nd.body.kode, "STATUS_TIDAK_SESUAI");
});

test("MI: tarik kembali & kembalikan untuk revisi — persetujuan lama gugur, pencadangan dilepas; Dikeluarkan/Dibatalkan tidak bisa; retry aman", async () => {
  const w = await dunia(); const a = await buatMI(w, { lines: [{ materialId: w.busa.id, requestedQty: 45 }] });
  await maju(w, MI, a.id, "WAITING_APPROVAL");
  // Menunggu → Draf (tarik kembali)
  let d = await ambil(w, MI, a.id); assert.ok(kode(d.tampilan.aksi).includes("KEMBALIKAN")); assert.equal(d.tampilan.aksi.find((x) => x.kode === "KEMBALIKAN").label, "Tarik kembali ke Draf");
  assert.equal((await w.g.post(`${MI}/${a.id}/kembalikan`, { alasan: "x" })).status, 400, "alasan 3–300");
  const t = await w.g.post(`${MI}/${a.id}/kembalikan`, { alasan: "Jumlah salah", revisi: d.revisi }); assert.equal(t.status, 200, JSON.stringify(t.body)); assert.equal(t.body.status, "DRAFT"); assert.equal(t.body.ulang, false);
  // retry persis sama → ulang:true; alasan lain → 409
  assert.equal((await w.g.post(`${MI}/${a.id}/kembalikan`, { alasan: "Jumlah salah" })).body.ulang, true);
  assert.equal((await w.g.post(`${MI}/${a.id}/kembalikan`, { alasan: "Alasan lain" })).status, 409);
  // Disetujui (cadangan 45): dokumen kedua melihat tersisa 5; setelah dikembalikan, cadangan dilepas (tersisa 50)
  await maju(w, MI, a.id, "WAITING_APPROVAL", "APPROVED"); const b = await buatMI(w, { lines: [{ materialId: w.busa.id, requestedQty: 10 }] });
  assert.equal((await ambil(w, MI, b.id)).ketersediaan[0].tersedia, 5);
  d = await ambil(w, MI, a.id); assert.ok(d.approvedBy); assert.equal(d.tampilan.aksi.find((x) => x.kode === "KEMBALIKAN").label, "Kembalikan untuk revisi");
  const k = await w.g.post(`${MI}/${a.id}/kembalikan`, { alasan: "Revisi jumlah", revisi: d.revisi }); assert.equal(k.status, 200); assert.equal(k.body.status, "DRAFT"); assert.equal(k.body.approvedById, null); assert.equal(k.body.approvedAt, null);
  assert.equal((await ambil(w, MI, b.id)).ketersediaan[0].tersedia, 50, "pencadangan dilepas");
  const jej = (await ambil(w, MI, a.id)).jejak.find((j) => j.aksi === "DIKEMBALIKAN" && /persetujuan lama gugur/.test(j.teks) && /pencadangan stok dilepas/.test(j.teks)); assert.ok(jej, "jejak mencatat persetujuan gugur & cadangan dilepas"); assert.equal(jej.alasan, "Revisi jumlah");
  // edit lalu ajukan & setujui ulang: persetujuan baru; cadangan dihitung dari isi baru
  const rv = (await ambil(w, MI, a.id)).revisi; assert.equal((await w.g.put(`${MI}/${a.id}/isi`, { revisi: rv, lines: [{ materialId: w.busa.id, requestedQty: 20 }] })).status, 200);
  await maju(w, MI, a.id, "WAITING_APPROVAL", "APPROVED"); assert.equal((await ambil(w, MI, b.id)).ketersediaan[0].tersedia, 30);
  assert.equal(await testPrisma.activityEvent.count({ where: { entityType: "material_issue", entityId: a.id, eventType: "DOCUMENT_APPROVED" } }), 2, "dua persetujuan: yang lama gugur, yang baru berlaku");
  // PICKED masih boleh dikembalikan (belum keluar); ISSUED dan CANCELLED tidak
  await maju(w, MI, a.id, "READY_TO_PICK", "PICKED"); d = await ambil(w, MI, a.id);
  const awal = await mov(); assert.equal((await w.g.post(`${MI}/${a.id}/kembalikan`, { alasan: "Salah ambil barang", revisi: d.revisi })).status, 200); assert.equal(await mov(), awal, "tanpa pergerakan stok");
  await maju(w, MI, a.id, "WAITING_APPROVAL", "APPROVED", "READY_TO_PICK", "PICKED"); assert.equal((await w.g.post(`${MI}/${a.id}/issue`, { revisi: (await ambil(w, MI, a.id)).revisi })).status, 200);
  const x = await w.g.post(`${MI}/${a.id}/kembalikan`, { alasan: "Sudah keluar" }); assert.equal(x.status, 409); assert.match(x.body.error, /memengaruhi stok/);
  const c = await buatMI(w); await w.g.patch(`${MI}/${c.id}/cancel`, { reason: "batal" }); assert.equal((await w.g.post(`${MI}/${c.id}/kembalikan`, { alasan: "tarik" })).status, 409);
  // izin
  assert.equal((await w.p.post(`${MI}/${b.id}/kembalikan`, { alasan: "tidak berhak" })).status, 403);
});

test("MI: retry ketat — issue 8 lalu 10 = konflik (bukan sukses sama); cancel alasan lain = konflik; revisi basi ditolak; persetujuan dengan revisi basi ditolak", async () => {
  const w = await dunia(); const mi = await buatMI(w); await maju(w, MI, mi.id, "WAITING_APPROVAL", "APPROVED", "READY_TO_PICK", "PICKED");
  const d = await ambil(w, MI, mi.id); const line = d.lines.find((l) => l.materialId === w.busa.id); const other = d.lines.find((l) => l.materialId === w.kain.id);
  const body = (q) => ({ revisi: d.revisi, lines: [{ lineId: line.id, issuedQty: q }, { lineId: other.id, issuedQty: 5 }] });
  const awal = await mov(); assert.equal((await w.g.post(`${MI}/${mi.id}/issue`, body(8))).status, 200); const setelah = await mov(); assert.equal(setelah, awal + 2); const s8 = await stok(w.busa.id);
  const r8 = await w.g.post(`${MI}/${mi.id}/issue`, body(8)); assert.equal(r8.status, 200); assert.equal(r8.body.ulang, true);
  const r10 = await w.g.post(`${MI}/${mi.id}/issue`, body(10)); assert.equal(r10.status, 409); assert.equal(r10.body.kode, "KONFLIK_PAYLOAD");
  assert.equal(await mov(), setelah, "tidak ada pergerakan baru"); assert.equal(await stok(w.busa.id), s8);
  // izin hanya-lihat tetap 403 untuk retry
  assert.equal((await w.p.post(`${MI}/${mi.id}/issue`, body(8))).status, 403);
  // cancel: alasan beda
  const c = await buatMI(w); assert.equal((await w.g.patch(`${MI}/${c.id}/cancel`, { reason: "Alasan A" })).status, 200);
  assert.equal((await w.g.patch(`${MI}/${c.id}/cancel`, { reason: "Alasan A" })).body.ulang, true);
  const cb = await w.g.patch(`${MI}/${c.id}/cancel`, { reason: "Alasan B" }); assert.equal(cb.status, 409); assert.equal(cb.body.kode, "KONFLIK_PAYLOAD");
  // revisi basi pada langkah maju & cancel (dokumen diubah pihak lain)
  const e = await buatMI(w); const rev0 = (await ambil(w, MI, e.id)).revisi;
  assert.equal((await w.g.put(`${MI}/${e.id}/isi`, { revisi: rev0, notes: "ubah", lines: [{ materialId: w.busa.id, requestedQty: 11 }] })).status, 200);
  const stale = await w.g.patch(`${MI}/${e.id}`, { status: "WAITING_APPROVAL", revisi: rev0 }); assert.equal(stale.status, 409); assert.equal(stale.body.kode, "REVISI_BASI");
  assert.equal((await w.g.patch(`${MI}/${e.id}/cancel`, { reason: "x batal", revisi: rev0 })).status, 409);
  assert.equal((await ambil(w, MI, e.id)).status, "DRAFT", "status tidak berubah oleh permintaan basi");
});

test("Konkurensi: dua receive berbeda (9 vs 10) serentak → tepat satu menang, satunya 409; receive sama ×2 → satu efek; issue sama ×2 → satu efek; edit vs setujui serentak konsisten", async () => {
  const w = await dunia();
  // receive berbeda serentak
  const st = await buatST(w); await maju(w, ST, st.id, "WAITING_APPROVAL", "APPROVED", "PICKED"); assert.equal((await w.g.post(`${ST}/${st.id}/dispatch`, {})).status, 200);
  const d = await ambil(w, ST, st.id); const lb = d.lines.find((l) => l.materialId === w.busa.id); const ll = d.lines.find((l) => l.materialId === w.lem.id);
  const mk = (q) => ({ lines: [{ lineId: lb.id, qtyReceived: q }, { lineId: ll.id, qtyReceived: 5 }], alasanSelisih: "Susut di perjalanan" });
  const [r9, r7] = await Promise.all([w.g.post(`${ST}/${st.id}/receive`, mk(7)), w.g2.post(`${ST}/${st.id}/receive`, mk(6))]);
  const stt = [r9.status, r7.status].sort(); assert.deepEqual(stt, [200, 409], JSON.stringify([r9.body, r7.body]));
  const menang = r9.status === 200 ? 7 : 6; assert.equal(await stok(w.busa.id), 50 - 8 + menang, "hanya satu jumlah yang dibukukan");
  assert.equal(await testPrisma.stockMovement.count({ where: { stockTransferId: st.id, qty: { gt: 0 }, materialId: w.busa.id } }), 1);
  // receive sama serentak
  const st2 = await buatST(w, { lines: [{ materialId: w.kain.id, qtySent: 4 }] }); await maju(w, ST, st2.id, "WAITING_APPROVAL", "APPROVED", "PICKED"); await w.g.post(`${ST}/${st2.id}/dispatch`, {});
  const rr = await Promise.all([1, 2].map((i) => (i === 1 ? w.g : w.g2).post(`${ST}/${st2.id}/receive`, {}))); assert.deepEqual(rr.map((x) => x.status), [200, 200]); assert.equal(rr.filter((x) => x.body.ulang === true).length, 1);
  assert.equal(await stok(w.kain.id), 20, "kain: -4 +4"); assert.equal(await testPrisma.stockMovement.count({ where: { stockTransferId: st2.id } }), 2);
  // issue sama serentak
  const mi = await buatMI(w, { lines: [{ materialId: w.busa.id, requestedQty: 3 }] }); await maju(w, MI, mi.id, "WAITING_APPROVAL", "APPROVED", "READY_TO_PICK", "PICKED");
  const before = await stok(w.busa.id); const ii = await Promise.all([w.g.post(`${MI}/${mi.id}/issue`, {}), w.g2.post(`${MI}/${mi.id}/issue`, {})]); assert.deepEqual(ii.map((x) => x.status), [200, 200]);
  assert.equal(await stok(w.busa.id), before - 3, "stok berkurang sekali"); assert.equal(await testPrisma.stockMovement.count({ where: { materialIssueId: mi.id } }), 1);
  // edit vs setujui serentak: siapa pun menang, hasil konsisten (tidak ada persetujuan atas isi yang tidak dilihat)
  const e = await buatMI(w); await maju(w, MI, e.id, "WAITING_APPROVAL"); const rv = (await ambil(w, MI, e.id)).revisi;
  const [kb, st3] = await Promise.all([w.g.post(`${MI}/${e.id}/kembalikan`, { alasan: "Perlu direvisi", revisi: rv }), w.g2.patch(`${MI}/${e.id}`, { status: "APPROVED", revisi: rv })]);
  const akhir = await ambil(w, MI, e.id);
  if (kb.status === 200) { assert.equal(st3.status === 409 || st3.status === 400, true, JSON.stringify(st3.body)); assert.equal(akhir.status, "DRAFT"); assert.equal(akhir.approvedBy, null); }
  else { assert.equal(st3.status, 200); assert.equal(kb.status, 409); assert.equal(akhir.status, "APPROVED"); }
});

test("ST: ubah isi Draf (bahan/jumlah/lokasi/catatan), kembalikan untuk revisi (Disetujui, Diambil), Dalam perjalanan/Selesai tidak bisa; lokasi sama ditolak", async () => {
  const w = await dunia(); const st = await buatST(w); let d = await ambil(w, ST, st.id); assert.ok(kode(d.tampilan.aksi).includes("UBAH_ISI"));
  const ok = await w.g.put(`${ST}/${st.id}/isi`, { revisi: d.revisi, destinationLocationId: w.lain.id, notes: "pindah ke FG", lines: [{ materialId: w.kain.id, qtySent: 6 }] });
  assert.equal(ok.status, 200, JSON.stringify(ok.body)); assert.equal(ok.body.destinationLocationId, w.lain.id); assert.equal(ok.body.lines.length, 1); assert.equal(ok.body.lines[0].qtySent, 6);
  assert.ok((await ambil(w, ST, st.id)).jejak.some((j) => j.aksi === "DIUBAH" && /Isi diubah/.test(j.teks)));
  d = await ambil(w, ST, st.id);
  assert.equal((await w.g.put(`${ST}/${st.id}/isi`, { revisi: d.revisi, destinationLocationId: w.asal.id, lines: [{ materialId: w.kain.id, qtySent: 6 }] })).status, 400, "asal = tujuan");
  assert.equal((await w.g.put(`${ST}/${st.id}/isi`, { revisi: d.revisi, lines: [{ materialId: w.kain.id, qtySent: -1 }] })).status, 400);
  assert.equal((await w.p.put(`${ST}/${st.id}/isi`, { revisi: d.revisi, lines: [{ materialId: w.kain.id, qtySent: 1 }] })).status, 403);
  // kembalikan dari Disetujui & Diambil
  await maju(w, ST, st.id, "WAITING_APPROVAL", "APPROVED"); d = await ambil(w, ST, st.id); assert.ok(d.approvedBy);
  const k = await w.g.post(`${ST}/${st.id}/kembalikan`, { alasan: "Lokasi tujuan salah", revisi: d.revisi }); assert.equal(k.status, 200); assert.equal(k.body.status, "DRAFT"); assert.equal(k.body.approvedById, null);
  await maju(w, ST, st.id, "WAITING_APPROVAL", "APPROVED", "PICKED"); d = await ambil(w, ST, st.id); assert.equal((await w.g.post(`${ST}/${st.id}/kembalikan`, { alasan: "Salah ambil", revisi: d.revisi })).status, 200);
  // setelah dikirim: tidak bisa
  await maju(w, ST, st.id, "WAITING_APPROVAL", "APPROVED", "PICKED"); assert.equal((await w.g.post(`${ST}/${st.id}/dispatch`, {})).status, 200);
  const x = await w.g.post(`${ST}/${st.id}/kembalikan`, { alasan: "Sudah dikirim" }); assert.equal(x.status, 409); assert.match(x.body.error, /memengaruhi stok/);
  assert.equal((await w.g.put(`${ST}/${st.id}/isi`, { revisi: (await ambil(w, ST, st.id)).revisi, lines: [{ materialId: w.kain.id, qtySent: 1 }] })).status, 409);
});

test("Selisih transfer: saldo sebelum/dikirim/diterima; penyebab wajib; tercatat di jejak; jalur penyelesaian (ditemukan / susut) tanpa pemakaian produksi; retry & konflik", async () => {
  const w = await dunia(); const st = await buatST(w); await maju(w, ST, st.id, "WAITING_APPROVAL", "APPROVED", "PICKED");
  const sebelumBusa = await stok(w.busa.id); const j0 = await jurnal();
  assert.equal((await w.g.post(`${ST}/${st.id}/dispatch`, {})).status, 200);
  let d = await ambil(w, ST, st.id);
  // dalam perjalanan: saldo perjalanan menunjukkan sebelum & dikirim, belum ada diterima
  const sp = d.saldoPerjalanan.find((x) => x.materialId === w.busa.id); assert.equal(sp.sebelumKirim, sebelumBusa); assert.equal(sp.dikirim, 8); assert.equal(sp.diterima, null); assert.equal(sp.sekarang, sebelumBusa - 8);
  assert.equal(d.tampilan.pengaruhStok, "BERKURANG"); assert.deepEqual(kode(d.tampilan.aksi), ["TERIMA"]);
  const lb = d.lines.find((l) => l.materialId === w.busa.id); const ll = d.lines.find((l) => l.materialId === w.lem.id);
  // receive 6 dari 8 tanpa penyebab → ditolak, tidak ada pergerakan
  const m0 = await mov(); const tanpa = await w.g.post(`${ST}/${st.id}/receive`, { lines: [{ lineId: lb.id, qtyReceived: 6 }, { lineId: ll.id, qtyReceived: 5 }] }); assert.equal(tanpa.status, 400); assert.equal(tanpa.body.kode, "ALASAN_TIDAK_VALID"); assert.equal(await mov(), m0);
  const terima = await w.g.post(`${ST}/${st.id}/receive`, { lines: [{ lineId: lb.id, qtyReceived: 6 }, { lineId: ll.id, qtyReceived: 5 }], alasanSelisih: "Dua lembar basah, dibuang di jalan" }); assert.equal(terima.status, 200, JSON.stringify(terima.body));
  d = await ambil(w, ST, st.id);
  assert.equal(await stok(w.busa.id), sebelumBusa - 2, "kekurangan 2 sudah hilang dari saldo — tidak lenyap tanpa jejak, lihat selisih"); assert.equal(await stok(w.lem.id), 30);
  const sp2 = d.saldoPerjalanan.find((x) => x.materialId === w.busa.id); assert.equal(sp2.diterima, 6); assert.equal(sp2.dikirim, 8); assert.equal(sp2.ditemukan, 0); assert.equal(sp2.sekarang, sebelumBusa - 2);
  assert.equal(d.selisih.length, 1); const sel = d.selisih[0]; assert.equal(sel.kode, w.busa.code); assert.equal(sel.kurang, 2); assert.equal(sel.sisa, 2); assert.deepEqual(sel.penyelesaian, []);
  assert.match(d.tampilan.label, /ada selisih belum diselesaikan/); assert.equal(d.tampilan.selisihTerbuka, 2); assert.deepEqual(kode(d.tampilan.aksi), ["SELESAIKAN_SELISIH"]);
  const jr = d.jejak.find((j) => j.aksi === "DITERIMA"); assert.match(jr.teks, /selisih: .*dikirim 8, diterima 6/); assert.equal(jr.alasan, "Dua lembar basah, dibuang di jalan");
  const daftar = (await w.g.get(ST)).body.transfers.find((t) => t.id === st.id); assert.equal(daftar.selisihTerbuka, 2); assert.match(daftar.tampilan.label, /selisih/);
  // penyelesaian: validasi
  const K = () => `kunci-${randomUUID()}`; const sel1 = (extra) => ({ lineId: lb.id, jenis: "DITEMUKAN", qty: 1, alasan: "Ditemukan di mobil", kunci: K(), ...extra });
  assert.equal((await w.p.post(`${ST}/${st.id}/selisih`, sel1())).status, 403);
  assert.equal((await w.g.post(`${ST}/${st.id}/selisih`, sel1({ kunci: "pendek" }))).body.kode, "KUNCI_WAJIB");
  assert.equal((await w.g.post(`${ST}/${st.id}/selisih`, sel1({ jenis: "HILANG" }))).body.kode, "JENIS_TIDAK_VALID");
  assert.equal((await w.g.post(`${ST}/${st.id}/selisih`, sel1({ qty: 3 }))).body.kode, "MELEBIHI_SISA");
  assert.equal((await w.g.post(`${ST}/${st.id}/selisih`, sel1({ lineId: ll.id }))).body.kode, "TIDAK_ADA_SELISIH");
  // DITEMUKAN 1: saldo +1 di tujuan, satu pergerakan TRANSFER positif bertaut, sisa 1
  const kunci = K(); const m1 = await mov(); const f1 = await w.g.post(`${ST}/${st.id}/selisih`, sel1({ kunci })); assert.equal(f1.status, 200, JSON.stringify(f1.body)); assert.equal(f1.body.ulang, false);
  assert.equal(await mov(), m1 + 1); assert.equal(await stok(w.busa.id), sebelumBusa - 1); const pm = await testPrisma.stockMovement.findFirst({ where: { stockTransferId: st.id, note: { startsWith: "Selisih ditemukan" } } });
  assert.equal(pm.type, "TRANSFER"); assert.equal(Number(pm.qty), 1); assert.equal(pm.location, w.tujuan.code); assert.equal(pm.unitId, null);
  assert.equal(f1.body.selisih[0].sisa, 1);
  // retry persis sama → ulang:true tanpa efek; kunci sama isi beda → konflik
  const f1b = await w.g.post(`${ST}/${st.id}/selisih`, sel1({ kunci })); assert.equal(f1b.status, 200); assert.equal(f1b.body.ulang, true); assert.equal(await mov(), m1 + 1);
  assert.equal((await w.g.post(`${ST}/${st.id}/selisih`, sel1({ kunci, qty: 0.5 }))).body.kode, "KONFLIK_PAYLOAD");
  // dua penyelesaian serentak untuk sisa 1: tepat satu menang
  const [a, b] = await Promise.all([w.g.post(`${ST}/${st.id}/selisih`, sel1({ qty: 1, jenis: "SUSUT", alasan: "Basah, dibuang" })), w.g2.post(`${ST}/${st.id}/selisih`, sel1({ qty: 1 }))]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409], JSON.stringify([a.body, b.body]));
  d = await ambil(w, ST, st.id); assert.equal(d.selisih[0].sisa, 0); assert.equal(d.tampilan.selisihTerbuka, 0); assert.equal(d.tampilan.label, "Selesai diterima"); assert.deepEqual(kode(d.tampilan.aksi), []);
  // SUSUT tidak membuat pergerakan stok; bukan pemakaian produksi: tidak ada ISSUE/unit/HPP; jurnal tidak berubah
  const susut = a.status === 200; if (susut) assert.equal(await testPrisma.stockMovement.count({ where: { stockTransferId: st.id, note: { startsWith: "Selisih ditemukan" } } }), 1, "hanya DITEMUKAN pertama yang menulis stok");
  assert.equal(await testPrisma.stockMovement.count({ where: { type: "ISSUE" } }), 0); assert.equal(await testPrisma.stockMovement.count({ where: { stockTransferId: st.id, unitId: { not: null } } }), 0); assert.equal(await jurnal(), j0, "tidak ada jurnal baru");
  assert.ok(d.jejak.filter((j) => j.aksi === "SELISIH_DISELESAIKAN").length >= 2);
});

test("Selisih: kelebihan dari yang dikirim juga wajib bersebab; receive penuh tanpa selisih tidak butuh alasan dan tidak membuka aksi selisih", async () => {
  const w = await dunia(); const st = await buatST(w, { lines: [{ materialId: w.busa.id, qtySent: 4 }] }); await maju(w, ST, st.id, "WAITING_APPROVAL", "APPROVED", "PICKED"); await w.g.post(`${ST}/${st.id}/dispatch`, {});
  const d = await ambil(w, ST, st.id); const l = d.lines[0];
  assert.equal((await w.g.post(`${ST}/${st.id}/receive`, { lines: [{ lineId: l.id, qtyReceived: 5 }] })).status, 400);
  const ok = await w.g.post(`${ST}/${st.id}/receive`, { lines: [{ lineId: l.id, qtyReceived: 5 }], alasanSelisih: "Hitung ulang di tujuan: 5" }); assert.equal(ok.status, 200);
  const e = await ambil(w, ST, st.id); assert.equal(e.selisih[0].lebih, 1); assert.equal(e.selisih[0].kurang, 0); assert.equal(e.selisih[0].sisa, 0); assert.equal(e.tampilan.label, "Selesai diterima", "kelebihan tidak membuka aksi penyelesaian (koreksi lewat jalur resmi)");
  const st2 = await buatST(w, { lines: [{ materialId: w.kain.id, qtySent: 2 }] }); await maju(w, ST, st2.id, "WAITING_APPROVAL", "APPROVED", "PICKED"); await w.g.post(`${ST}/${st2.id}/dispatch`, {});
  assert.equal((await w.g.post(`${ST}/${st2.id}/receive`, {})).status, 200); const f = await ambil(w, ST, st2.id); assert.deepEqual(f.selisih, []); assert.deepEqual(kode(f.tampilan.aksi), []);
});

test("Persetujuan rutin: izin.pemohonSama menandai pembuat = penyetuju (tidak ada penyetuju kedua untuk transaksi rutin)", async () => {
  const w = await dunia(); const mi = await buatMI(w);
  assert.equal((await ambil(w, MI, mi.id)).izin.pemohonSama, true); assert.equal((await w.g2.get(`${MI}/${mi.id}`)).body.izin.pemohonSama, false);
  await maju(w, MI, mi.id, "WAITING_APPROVAL"); const rev = (await ambil(w, MI, mi.id)).revisi;
  assert.equal((await w.g.patch(`${MI}/${mi.id}`, { status: "APPROVED", revisi: rev })).status, 200, "aturan izin lama dipertahankan: pembuat boleh menyetujui");
});
