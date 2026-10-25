// Persetujuan terikat posting historis — uji murni (tanpa database) + pagar statis. Uji dengan database ada di integration/postingPersetujuanTerikat.integration.test.js.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ringkasRencana, wajibPersetujuanTerikat, ENTITAS_PERSETUJUAN } from "../src/services/postingPersetujuanTerikat.js";

const here = path.dirname(fileURLToPath(import.meta.url)); const src = path.join(here, "..", "src");
const trx = (order, unit, kode, qty, tanggal = "2026-10-05") => ({ orderNumber: order, unitId: unit, kodeBahan: kode, qty, satuan: "METER", tanggal, kunci: `PH2610:${order}:${kode}` });
const rencana = (t, hash = "a".repeat(64)) => ({ hash, jumlah: t.length, transaksi: t });
const dua = rencana([trx("RES-01102026-005", "u1", "SPANBON-75GRAM", 2), trx("NEW-02102026-007", "u2", "SUDUT-GOLD", 4)]);
const db = () => { const dicatat = []; return { dicatat, activityEvent: { create: async ({ data }) => { dicatat.push(data); } }, material: { findMany: async () => [{ id: "m1", code: "SPANBON-75GRAM" }] }, stockMovement: { groupBy: async () => [{ materialId: "m1", _sum: { qty: 291 } }] } }; };
const terikatBenar = () => { const r = ringkasRencana(dua); return { hash: r.hash, unitIds: r.unitIds, daftarOrder: r.daftarOrder, jumlahOrder: 2, jumlahTrx: 2, rujukan: "OWNER-QTY-2ORDER" }; };
const persetujuan = (terikat, o = {}) => ({ hashDisetujui: dua.hash, rujukan: "OWNER-QTY-2ORDER", disetujuiOleh: "Owner", terikat, ...o });
const tolak = async (fn) => { try { await fn(); } catch (e) { return e; } assert.fail("seharusnya ditolak"); };

test("ringkasan rencana: kanonik (urutan masukan tidak memengaruhi), unit & order terurut, digest isi berubah bila isi berubah", () => {
  const a = ringkasRencana(dua); const b = ringkasRencana(rencana([...dua.transaksi].reverse())); assert.deepEqual(a, b);
  assert.deepEqual(a.daftarOrder, ["NEW-02102026-007", "RES-01102026-005"]); assert.deepEqual(a.unitIds, ["u1", "u2"]); assert.equal(a.jumlahOrder, 2); assert.equal(a.jumlahTrx, 2); assert.match(a.digestIsi, /^[0-9a-f]{64}$/);
  assert.notEqual(ringkasRencana(rencana([trx("RES-01102026-005", "u1", "SPANBON-75GRAM", 2.5), dua.transaksi[1]])).digestIsi, a.digestIsi, "qty berbeda = digest berbeda");
  assert.notEqual(ringkasRencana(rencana([trx("RES-01102026-005", "u1", "SPANBON-75GRAM", 2, "2026-10-06"), dua.transaksi[1]])).digestIsi, a.digestIsi, "tanggal berbeda = digest berbeda");
});
test("persetujuan cocok: dikembalikan sebagai rekaman lengkap; tanpa penolakan tercatat", async () => {
  const d = db(); const rek = await wajibPersetujuanTerikat(d, { rencana: dua, persetujuan: persetujuan(terikatBenar()), aktor: { id: "o1" } });
  assert.equal(rek.hash, dua.hash); assert.equal(rek.jumlahOrder, 2); assert.equal(rek.jumlahTrx, 2); assert.equal(rek.rujukan, "OWNER-QTY-2ORDER"); assert.deepEqual(rek.saldoSyarat, []); assert.equal(d.dicatat.length, 0);
});
test("persetujuan hilang → PERSETUJUAN_TERIKAT_WAJIB (403), tidak mencatat apa pun", async () => {
  const d = db(); const e = await tolak(() => wajibPersetujuanTerikat(d, { rencana: dua, persetujuan: persetujuan(undefined), aktor: { id: "o1" } })); assert.equal(e.code, "PERSETUJUAN_TERIKAT_WAJIB"); assert.equal(e.statusCode, 403); assert.equal(d.dicatat.length, 0);
});
test("selisih apa pun → 409 PERSETUJUAN_TIDAK_COCOK dengan daftar penghalang, tercatat sebagai peristiwa audit", async () => {
  const kasus = {
    hash: { ...terikatBenar(), hash: "c".repeat(64) }, order: { ...terikatBenar(), daftarOrder: ["RES-01102026-005", "RES-99999999-001"] }, jumlah: { ...terikatBenar(), jumlahTrx: 13 },
    unit: { ...terikatBenar(), unitIds: ["u1"] }, rujukan: { ...terikatBenar(), rujukan: "RUJUKAN-LAIN-1" }, bentuk: { ...terikatBenar(), jumlahOrder: "2" },
  };
  for (const [nama, t] of Object.entries(kasus)) {
    const d = db(); const e = await tolak(() => wajibPersetujuanTerikat(d, { rencana: dua, persetujuan: persetujuan(t), aktor: { id: "o1" } }));
    assert.equal(e.code, "PERSETUJUAN_TIDAK_COCOK", nama); assert.equal(e.statusCode, 409); assert.ok(e.penghalang.length >= 1, nama);
    assert.equal(d.dicatat.length, 1, nama); assert.equal(d.dicatat[0].entityType, ENTITAS_PERSETUJUAN); assert.equal(d.dicatat[0].eventType, "PERSETUJUAN_DITOLAK"); assert.equal(d.dicatat[0].actorId, "o1");
  }
});
test("hash pada permintaan harus sama dengan rencana walau persetujuan terikat benar (layar dan persetujuan tidak boleh berbeda)", async () => {
  const e = await tolak(() => wajibPersetujuanTerikat(db(), { rencana: dua, persetujuan: persetujuan(terikatBenar(), { hashDisetujui: "d".repeat(64) }), aktor: { id: "o1" } })); assert.ok(e.penghalang.some((x) => /hash pada permintaan/.test(x)));
});
test("syarat saldo: cocok diterima dan disimpan; bergeser / bahan tak dikenal / angka rusak ditolak", async () => {
  const t = { ...terikatBenar(), saldoSyarat: [{ kode: "SPANBON-75GRAM", saldo: 291 }] };
  assert.deepEqual((await wajibPersetujuanTerikat(db(), { rencana: dua, persetujuan: persetujuan(t), aktor: { id: "o1" } })).saldoSyarat, [{ kode: "SPANBON-75GRAM", saldo: 291 }]);
  const lama = await tolak(() => wajibPersetujuanTerikat(db(), { rencana: dua, persetujuan: persetujuan({ ...t, saldoSyarat: [{ kode: "SPANBON-75GRAM", saldo: 300 }] }), aktor: { id: "o1" } })); assert.ok(lama.penghalang.some((x) => /saldo SPANBON-75GRAM: syarat 300 ≠ sekarang 291/.test(x)));
  const asing = await tolak(() => wajibPersetujuanTerikat(db(), { rencana: dua, persetujuan: persetujuan({ ...t, saldoSyarat: [{ kode: "TIDAK-ADA", saldo: 1 }] }), aktor: { id: "o1" } })); assert.ok(asing.penghalang.some((x) => /tidak ditemukan/.test(x)));
  const rusak = await tolak(() => wajibPersetujuanTerikat(db(), { rencana: dua, persetujuan: persetujuan({ ...t, saldoSyarat: [{ kode: "SPANBON-75GRAM", saldo: "x" }] }), aktor: { id: "o1" } })); assert.ok(rusak.penghalang.some((x) => /syarat saldo tidak valid/.test(x)));
});
test("kegagalan mencatat peristiwa audit tidak mengubah hasil penolakan", async () => {
  const d = db(); d.activityEvent.create = async () => { throw new Error("db mati"); };
  const e = await tolak(() => wajibPersetujuanTerikat(d, { rencana: dua, persetujuan: persetujuan({ ...terikatBenar(), jumlahTrx: 9 }), aktor: { id: "o1" } })); assert.equal(e.code, "PERSETUJUAN_TIDAK_COCOK");
});

test("pagar statis: kedua rute tulis meneruskan persetujuanTerikat; service memeriksanya SEBELUM tulisan; UI tidak menyimpan rujukan/persetujuan di draf", () => {
  const r = fs.readFileSync(path.join(src, "routes/pemakaianKoreksi.js"), "utf8");
  for (const rute of ["/posting-historis/jalankan", "/posting-historis/batch"]) { const i = r.indexOf(`.post("${rute}"`); assert.ok(i > 0, rute); assert.match(r.slice(i, i + 700), /terikat: bacaTerikat\(req\.body\?\.persetujuanTerikat\)/, `${rute} meneruskan persetujuan terikat`); }
  const b = fs.readFileSync(path.join(src, "services/postingBatchLatar.js"), "utf8");
  assert.ok(b.indexOf("wajibPersetujuanTerikat(prisma, { rencana, persetujuan, aktor })") < b.indexOf("await prisma.$transaction(async (tx) => {\n    await kunciEvaluasiCatatan(tx);\n    if (await tx.activityEvent.findFirst"), "batch: pagar sebelum transaksi pembuat batch");
  const p = fs.readFileSync(path.join(src, "services/postingPemakaianHistoris.js"), "utf8"); const j = p.slice(p.indexOf("export async function jalankanPosting"));
  assert.ok(j.indexOf("wajibPersetujuanTerikat(") < j.indexOf("postingSatuUnit(prisma"), "sinkron: pagar sebelum movement pertama");
  const ui = fs.readFileSync(path.join(here, "..", "..", "frontend", "src", "pages", "warehouse", "WarehousePostingHistoris.jsx"), "utf8");
  assert.match(ui, /simpanDraft\(\{ pilih \}\)/, "draf hanya menyimpan pilihan order"); assert.ok(!/simpanDraft\(\{[^}]*rujukan/.test(ui), "rujukan tidak boleh masuk draf"); assert.ok(!/bacaDraft\(\)\.rujukan/.test(ui));
  assert.match(ui, /persetujuanTerikat: bangunPersetujuanTerikat\(/); assert.match(ui, /data-testid="dialog-daftar-order"/); assert.match(ui, /data-testid="rujukan-dicatat"/);
});
