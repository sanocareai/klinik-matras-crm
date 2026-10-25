// Konfirmasi manifest posting historis — uji murni (tanpa database) + pagar statis. Uji dengan database: integration/postingKonfirmasiManifest.integration.test.js.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ringkasRencana, wajibKonfirmasiManifest, wajibOwnerMemulai, periksaPercobaanUlang, digestBaris, ENTITAS_KONFIRMASI, MODE_KONTROL } from "../src/services/postingKonfirmasiManifest.js";

const here = path.dirname(fileURLToPath(import.meta.url)); const src = path.join(here, "..", "src");
const trx = (order, unit, mat, kode, qty, tanggal = "2026-10-05") => ({ orderNumber: order, unitId: unit, materialId: mat, kodeBahan: kode, qty, satuan: "METER", tanggal, kunci: `PH2610:${order}:${kode}` });
const rencana = (t, hash = "a".repeat(64)) => ({ hash, jumlah: t.length, transaksi: t });
const dua = rencana([trx("RES-01102026-005", "u1", "m1", "SPANBON-75GRAM", 2), trx("NEW-02102026-007", "u2", "m2", "SUDUT-GOLD", 4)]);
const OWNER = { id: "o1", name: "Gilang", roles: ["OWNER"] }; const FINANCE = { id: "f1", name: "Juri", roles: ["FINANCE"] }; const ADMIN = { id: "a1", name: "Gulam", role: "ADMIN" };
const db = (saldo = { m1: 291, m2: 86 }) => { const dicatat = []; return { dicatat, activityEvent: { create: async ({ data }) => { dicatat.push(data); } }, material: { findMany: async () => [{ id: "m1", code: "SPANBON-75GRAM" }] }, stockMovement: { groupBy: async ({ where }) => where.materialId.in.map((id) => ({ materialId: id, _sum: { qty: saldo[id] ?? 0 } })) } }; };
const konfirmasiBenar = () => { const r = ringkasRencana(dua); return { hash: r.hash, unitIds: r.unitIds, daftarOrder: r.daftarOrder, jumlahOrder: 2, jumlahTrx: 2, rujukan: "OWNER-QTY-2ORDER", isiTransaksi: r.isiTransaksi, saldoManifest: [{ kode: "SPANBON-75GRAM", saldo: 291 }, { kode: "SUDUT-GOLD", saldo: 86 }] }; };
const persetujuan = (konfirmasi, o = {}) => ({ hashDisetujui: dua.hash, rujukan: "OWNER-QTY-2ORDER", disetujuiOleh: "Owner", konfirmasi, ...o });
const tolak = async (fn) => { try { await fn(); } catch (e) { return e; } assert.fail("seharusnya ditolak"); };

test("ringkasan rencana: kanonik; ID unit ikut dalam isi; digest berubah bila qty/tanggal/unit/satuan/bahan berubah", () => {
  const a = ringkasRencana(dua); const b = ringkasRencana(rencana([...dua.transaksi].reverse())); assert.deepEqual(a, b);
  assert.deepEqual(a.daftarOrder, ["NEW-02102026-007", "RES-01102026-005"]); assert.deepEqual(a.unitIds, ["u1", "u2"]); assert.equal(a.isiTransaksi.length, 2); assert.match(a.digestIsi, /^[0-9a-f]{64}$/);
  const ubah = (i, o) => ringkasRencana(rencana(dua.transaksi.map((t, j) => (j === i ? { ...t, ...o } : t)))).digestIsi;
  for (const o of [{ qty: 2.5 }, { tanggal: "2026-10-06" }, { unitId: "u9" }, { satuan: "KG" }, { kodeBahan: "LAIN" }]) assert.notEqual(ubah(0, o), a.digestIsi, JSON.stringify(o));
  assert.equal(digestBaris(a.isiTransaksi), a.digestIsi);
});
test("pagar peran: hanya OWNER memulai; Finance/Admin/tanpa peran ditolak 403 HANYA_OWNER_MEMULAI dan dicatat dengan peran pelaku", async () => {
  for (const pelaku of [FINANCE, ADMIN, { id: "x" }]) { const d = db(); const e = await tolak(() => wajibOwnerMemulai(d, pelaku)); assert.equal(e.code, "HANYA_OWNER_MEMULAI"); assert.equal(e.statusCode, 403); assert.equal(d.dicatat.length, 1); assert.equal(d.dicatat[0].metadata.jenis, "BUKAN_OWNER"); assert.equal(d.dicatat[0].actorId, pelaku.id); }
  const d = db(); await wajibOwnerMemulai(d, OWNER); await wajibOwnerMemulai(d, { id: "k", roles: ["ADMIN", "FINANCE", "OWNER"] }); assert.equal(d.dicatat.length, 0);
  assert.equal((await tolak(() => wajibOwnerMemulai(db(), FINANCE))).message.includes("Owner meninjau dan mengonfirmasi manifest sendiri"), true, "pesan menyatakan batas kontrol");
});
test("konfirmasi cocok: rekaman lengkap (isi transaksi, saldo ditinjau, peran, mode) dan tanpa penolakan tercatat", async () => {
  const d = db(); const rek = await wajibKonfirmasiManifest(d, { rencana: dua, persetujuan: persetujuan(konfirmasiBenar()), aktor: OWNER });
  assert.equal(rek.mode, MODE_KONTROL); assert.equal(rek.hash, dua.hash); assert.equal(rek.jumlahTrx, 2); assert.equal(rek.isiTransaksi.length, 2); assert.deepEqual(rek.saldoManifest, [{ kode: "SPANBON-75GRAM", saldo: 291 }, { kode: "SUDUT-GOLD", saldo: 86 }]); assert.deepEqual(rek.aktorRoles, ["OWNER"]); assert.equal(rek.rujukan, "OWNER-QTY-2ORDER"); assert.equal(d.dicatat.length, 0);
});
test("tanpa konfirmasi → 403 KONFIRMASI_MANIFEST_WAJIB (dicatat); Finance ditolak lebih dulu walau konfirmasi benar", async () => {
  const d = db(); const e = await tolak(() => wajibKonfirmasiManifest(d, { rencana: dua, persetujuan: persetujuan(undefined), aktor: OWNER })); assert.equal(e.code, "KONFIRMASI_MANIFEST_WAJIB"); assert.equal(d.dicatat[0].metadata.jenis, "TANPA_KONFIRMASI");
  const f = db(); const e2 = await tolak(() => wajibKonfirmasiManifest(f, { rencana: dua, persetujuan: persetujuan(konfirmasiBenar()), aktor: FINANCE })); assert.equal(e2.code, "HANYA_OWNER_MEMULAI");
});
test("selisih apa pun → 409 KONFIRMASI_MANIFEST_TIDAK_COCOK dengan penghalang, tercatat dengan pelaku & peran", async () => {
  const b = konfirmasiBenar(); const baris = (i, o) => b.isiTransaksi.map((l, j) => (j === i ? { ...l, ...o } : l));
  const kasus = {
    hash: { ...b, hash: "c".repeat(64) }, order: { ...b, daftarOrder: ["RES-01102026-005", "RES-99999999-001"] }, jumlah: { ...b, jumlahTrx: 13 }, unit: { ...b, unitIds: ["u1"] }, rujukan: { ...b, rujukan: "RUJUKAN-LAIN-1" }, bentuk: { ...b, jumlahOrder: "2" },
    qty: { ...b, isiTransaksi: baris(0, { qty: 9 }) }, tanggal: { ...b, isiTransaksi: baris(0, { tanggal: "2026-10-09" }) }, satuan: { ...b, isiTransaksi: baris(1, { satuan: "KG" }) }, bahan: { ...b, isiTransaksi: baris(0, { kodeBahan: "X" }) }, unitLine: { ...b, isiTransaksi: baris(0, { unitId: "u9" }) },
    saldo: { ...b, saldoManifest: [{ kode: "SPANBON-75GRAM", saldo: 300 }, { kode: "SUDUT-GOLD", saldo: 86 }] }, saldoHilang: { ...b, saldoManifest: [{ kode: "SPANBON-75GRAM", saldo: 291 }] },
  };
  for (const [nama, k] of Object.entries(kasus)) {
    const d = db(); const e = await tolak(() => wajibKonfirmasiManifest(d, { rencana: dua, persetujuan: persetujuan(k), aktor: OWNER }));
    assert.equal(e.code, "KONFIRMASI_MANIFEST_TIDAK_COCOK", nama); assert.equal(e.statusCode, 409); assert.ok(e.penghalang.length >= 1, nama);
    assert.equal(d.dicatat.length, 1, nama); assert.equal(d.dicatat[0].entityType, ENTITAS_KONFIRMASI); assert.equal(d.dicatat[0].eventType, "KONFIRMASI_DITOLAK"); assert.equal(d.dicatat[0].actorId, "o1"); assert.deepEqual(d.dicatat[0].metadata.aktorRoles, ["OWNER"]); assert.equal(d.dicatat[0].metadata.jenis, "TIDAK_COCOK");
  }
  const sal = await tolak(() => wajibKonfirmasiManifest(db({ m1: 280, m2: 86 }), { rencana: dua, persetujuan: persetujuan(b), aktor: OWNER })); assert.ok(sal.penghalang.some((x) => /saldo SPANBON-75GRAM berubah sejak ditinjau: 291 → 280/.test(x)), "saldo ledger bergeser sesudah ditinjau");
  const h = await tolak(() => wajibKonfirmasiManifest(db(), { rencana: dua, persetujuan: persetujuan(b, { hashDisetujui: "d".repeat(64) }), aktor: OWNER })); assert.ok(h.penghalang.some((x) => /hash pada permintaan/.test(x)));
});
test("percobaan ulang: konfirmasi SAMA diterima; dampak berbeda (isi, saldo, rujukan, unit, hash) ditolak & dicatat; tanpa rekaman (batch lama) tidak ada pembanding", async () => {
  const b = konfirmasiBenar(); const tersimpan = { hash: dua.hash, unitIds: ringkasRencana(dua).unitIds, digestIsi: ringkasRencana(dua).digestIsi, rujukan: "OWNER-QTY-2ORDER", saldoManifest: b.saldoManifest };
  const d = db(); await periksaPercobaanUlang(d, { aktor: OWNER, tersimpan, persetujuan: persetujuan(b) }); assert.equal(d.dicatat.length, 0);
  await periksaPercobaanUlang(d, { aktor: OWNER, tersimpan: null, persetujuan: persetujuan({ ...b, jumlahTrx: 99 }) }); assert.equal(d.dicatat.length, 0, "batch lama tanpa rekaman");
  const ubah = { isi: { ...b, isiTransaksi: b.isiTransaksi.map((l, j) => (j === 0 ? { ...l, qty: 7 } : l)) }, saldo: { ...b, saldoManifest: [{ kode: "SPANBON-75GRAM", saldo: 1 }, { kode: "SUDUT-GOLD", saldo: 86 }] }, rujukan: { ...b, rujukan: "RUJUKAN-LAIN-1" }, unit: { ...b, unitIds: ["u1"] }, hash: { ...b, hash: "e".repeat(64) } };
  for (const [nama, k] of Object.entries(ubah)) { const e = await tolak(() => periksaPercobaanUlang(d, { aktor: OWNER, tersimpan, persetujuan: persetujuan(k, nama === "rujukan" ? { rujukan: "RUJUKAN-LAIN-1" } : {}) })); assert.equal(e.code, "KONFIRMASI_MANIFEST_TIDAK_COCOK", nama); }
  assert.equal(d.dicatat.length, 5); assert.ok(d.dicatat.every((x) => x.metadata.jenis === "ULANG_DAMPAK_BERBEDA"));
});
test("kegagalan mencatat peristiwa audit tidak mengubah hasil penolakan", async () => {
  const d = db(); d.activityEvent.create = async () => { throw new Error("db mati"); };
  assert.equal((await tolak(() => wajibKonfirmasiManifest(d, { rencana: dua, persetujuan: persetujuan({ ...konfirmasiBenar(), jumlahTrx: 9 }), aktor: OWNER }))).code, "KONFIRMASI_MANIFEST_TIDAK_COCOK");
  assert.equal((await tolak(() => wajibOwnerMemulai(d, FINANCE))).code, "HANYA_OWNER_MEMULAI");
});

test("pagar statis: kedua rute tulis meneruskan konfirmasiManifest; pagar Owner & konfirmasi di service SEBELUM tulisan; UI hanya Owner memulai dan tidak menyimpan rujukan di draf", () => {
  const r = fs.readFileSync(path.join(src, "routes/pemakaianKoreksi.js"), "utf8");
  for (const rute of ["/posting-historis/jalankan", "/posting-historis/batch"]) { const i = r.indexOf(`.post("${rute}"`); assert.ok(i > 0, rute); assert.match(r.slice(i, i + 800), /konfirmasi: bacaKonfirmasi\(req\.body\?\.konfirmasiManifest\)/, `${rute} meneruskan konfirmasi manifest`); }
  assert.match(r, /isiTransaksi: raw\.isiTransaksi, saldoManifest: raw\.saldoManifest/);
  const b = fs.readFileSync(path.join(src, "services/postingBatchLatar.js"), "utf8");
  assert.ok(b.indexOf("await wajibOwnerMemulai(prisma, aktor)") < b.indexOf("await rencanakanPosting(prisma, { unitIds })"), "batch: pagar Owner sebelum menghitung rencana");
  assert.ok(b.indexOf("wajibKonfirmasiManifest(prisma, { rencana, persetujuan, aktor })") < b.indexOf("await prisma.$transaction(async (tx) => {\n    await kunciEvaluasiCatatan(tx);\n    if (await tx.activityEvent.findFirst"), "batch: konfirmasi sebelum transaksi pembuat batch");
  const p = fs.readFileSync(path.join(src, "services/postingPemakaianHistoris.js"), "utf8"); const j = p.slice(p.indexOf("export async function jalankanPosting"));
  assert.ok(j.indexOf("wajibOwnerMemulai(") < j.indexOf("rencanakanPosting(prisma") && j.indexOf("wajibKonfirmasiManifest(") < j.indexOf("postingSatuUnit(prisma"), "sinkron: Owner sebelum rencana; konfirmasi sebelum movement pertama");
  const ui = fs.readFileSync(path.join(here, "..", "..", "frontend", "src", "pages", "warehouse", "WarehousePostingHistoris.jsx"), "utf8");
  assert.match(ui, /simpanDraft\(\{ pilih \}\)/); assert.ok(!/simpanDraft\(\{[^}]*rujukan/.test(ui)); assert.match(ui, /konfirmasiManifest: bangunKonfirmasiManifest\(/); assert.match(ui, /data-testid="dialog-daftar-order"/); assert.match(ui, /data-testid="dialog-saldo-bahan"/); assert.match(ui, /data-testid="batas-kontrol"/); assert.match(ui, /data-testid="rujukan-dicatat"/);
  const m = fs.readFileSync(path.join(here, "..", "..", "frontend", "src", "features", "warehouse", "postingHistoris", "postingHistorisModel.js"), "utf8");
  assert.match(m, /ROLE_PEMULAI_POSTING = Object\.freeze\(\["OWNER"\]\)/, "UI: hanya Owner memulai"); assert.match(m, /bukan persetujuan Owner yang tercatat terpisah/, "UI menyatakan batas kontrol");
});
