// C2.1 — hardening akses Pengajuan Biaya lintas divisi: keanggotaan divisi (terpisah dari peran), kepemilikan konsisten di SEMUA
// workspace (termasuk Delivery yang sebelumnya bocor), akses lintas divisi ditolak, Finance/Admin/Owner sesuai izin, user lama tanpa
// keanggotaan tetap jalan, dan tidak ada bypass lewat request paralel.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { resetRateLimits } from "../../src/lib/rateLimit.js";
import { ensureDefaultChartOfAccounts } from "../../src/services/finance/accounts.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.beforeEach(() => resetRateLimits());
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const PB = "/api/finance/expense-submissions";
let n = 0;
const K = (p = "k") => ({ "Idempotency-Key": `${p}-${Date.now()}-${++n}-abcdefgh` });

async function siapkan() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const peran = {
    mkt: ["SALES"], mkt2: ["SALES"], multi: ["SALES"], salesTanpa: ["SALES"], hr: ["QC_LEAD"], pl: ["PRODUCTION_LEAD"], wh: ["WAREHOUSE"],
    disp: ["DISPATCHER"], disp2: ["DISPATCHER"], drv: ["DRIVER"], drv2: ["DRIVER"], fin: ["FINANCE"], adm: ["ADMIN"], owner: ["OWNER"],
  };
  const u = {};
  for (const [k, roles] of Object.entries(peran)) u[k] = await createTestUser({ roles });
  const anggota = { mkt: ["MARKETING"], mkt2: ["MARKETING"], multi: ["MARKETING", "HR_GA"], hr: ["HR_GA"] };
  for (const [k, ds] of Object.entries(anggota)) for (const division of ds) await testPrisma.userDivision.create({ data: { userId: u[k].user.id, division } });
  const c = Object.fromEntries(Object.entries(u).map(([k, v]) => [k, makeClient(server.baseUrl, v.token)]));
  return { u, c };
}

const meta = { MARKETING: { keperluan: "Kampanye Uji Akses" }, HR_GA: { kegiatan: "Pelatihan Uji Akses" } };
const TIPE = { MARKETING: "IKLAN_PROMOSI", HR_GA: "PELATIHAN", MANAGEMENT: "MEETING_REPRESENTASI" };
const body = (ws, extra = {}) => ({ workspace: ws, expenseType: TIPE[ws], date: "2026-09-26", amount: 150_000, vendorName: "Vendor Uji", description: "Uji akses", metadata: { ...meta[ws] }, sumberDana: "BELUM_DIBAYAR", ...extra });
const bodyDelivery = (extra = {}) => ({ workspace: "DELIVERY", expenseType: "BBM", date: "2026-09-26", amount: 200_000, vendorName: "SPBU Uji", description: "Uji akses Delivery", metadata: { liters: 10 }, ...extra });
async function buat(client, b) { const r = await client.post(PB, b); assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body; }
async function bukti(id, userId) { await testPrisma.expenseSubmissionProof.create({ data: { submissionId: id, url: "https://example.test/nota-uji.jpg", version: 1, uploadedById: userId } }); }
async function unggah(token, id) {
  const fd = new FormData();
  fd.append("bukti", new Blob([Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBD", "base64")], { type: "image/jpeg" }), "nota.jpg");
  const res = await fetch(`${server.baseUrl}${PB}/${id}/bukti`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd });
  return res.status;
}

// ── keanggotaan satu & multi-divisi ─────────────────────────────────────────────────────────────────────────────

test("SALES bukan otomatis Marketing; anggota Marketing bisa; multi-divisi membuka semua divisinya saja", async () => {
  const { c } = await siapkan();
  assert.equal((await c.salesTanpa.get(`${PB}/config?workspace=MARKETING`)).status, 403);
  assert.equal((await c.salesTanpa.post(PB, body("MARKETING"))).status, 403);
  assert.equal((await c.mkt.get(`${PB}/config?workspace=MARKETING`)).status, 200);
  assert.equal((await c.mkt.post(PB, body("MARKETING"))).status, 201);
  // satu divisi: tidak otomatis HR-GA / Management / Produksi / Delivery
  for (const ws of ["HR_GA", "MANAGEMENT", "PRODUKSI", "WAREHOUSE", "DELIVERY"]) assert.equal((await c.mkt.get(`${PB}/config?workspace=${ws}`)).status, 403, ws);
  // multi-divisi: Marketing + HR-GA, tapi bukan Management
  assert.equal((await c.multi.post(PB, body("MARKETING"))).status, 201);
  assert.equal((await c.multi.post(PB, body("HR_GA"))).status, 201);
  assert.equal((await c.multi.post(PB, body("MANAGEMENT"))).status, 403);
  const daftar = await c.multi.get(PB);
  assert.equal(daftar.status, 200);
  assert.deepEqual([...new Set(daftar.body.submissions.map((s) => s.division))].sort(), ["HR_GA", "MARKETING"]);
});

test("Anggota divisi TANPA izin Finance (peran QC_LEAD) tetap bisa membuat & mengajukan pengajuan miliknya di divisinya", async () => {
  const { c, u } = await siapkan();
  const d = await buat(c.hr, body("HR_GA"));
  await bukti(d.id, u.hr.user.id);
  const aj = await c.hr.post(`${PB}/${d.id}/ajukan`, {}, K("hr"));
  assert.equal(aj.status, 200, JSON.stringify(aj.body));
  assert.equal(aj.body.status, "MENUNGGU_PERSETUJUAN");
  // keanggotaan bukan izin Finance: tidak bisa menyetujui / melihat semua
  assert.equal((await c.hr.post(`${PB}/${d.id}/minta-revisi`, { reason: "x" }, K("hr"))).status, 403);
  const daftar = await c.hr.get(PB);
  assert.equal(daftar.body.hanyaMilikSendiri, true);
});

test("Daftar pilihan pengguna (PIC) untuk anggota divisi hanya rekan sedivisi + dirinya (nama tidak bocor lintas divisi)", async () => {
  const { c, u } = await siapkan();
  const r = await c.multi.get(`${PB}/opsi?workspace=MARKETING`);
  assert.equal(r.status, 200);
  const ids = r.body.pengguna.map((p) => p.id).sort();
  assert.deepEqual(ids, [u.mkt.user.id, u.mkt2.user.id, u.multi.user.id].sort());
  const staf = await c.fin.get(`${PB}/opsi?workspace=MARKETING`);
  assert.ok(staf.body.pengguna.length > ids.length, "Finance melihat semua pengguna aktif");
});

// ── own-only ────────────────────────────────────────────────────────────────────────────────────────────────────

test("Own-only: rekan sedivisi TIDAK bisa melihat/mengubah/menarik/membatalkan/mengajukan/mengoreksi/mengunggah bukti pengajuan orang lain", async () => {
  const { c, u } = await siapkan();
  const d = await buat(c.mkt, body("MARKETING", { description: "Rahasia Kampanye Alfa" }));
  const lain = c.mkt2;
  assert.equal((await lain.get(`${PB}/${d.id}`)).status, 403);
  assert.equal((await lain.patch(`${PB}/${d.id}`, { amount: 1 })).status, 403);
  assert.equal((await lain.post(`${PB}/${d.id}/ajukan`, {}, K("x"))).status, 403);
  assert.equal((await lain.post(`${PB}/${d.id}/tarik`, {}, K("x"))).status, 403);
  assert.equal((await lain.post(`${PB}/${d.id}/batalkan`, { reason: "iseng" }, K("x"))).status, 403);
  assert.equal((await lain.post(`${PB}/${d.id}/metadata`, { reason: "iseng", changes: { description: "x" } })).status, 403);
  assert.equal(await unggah(u.mkt2.token, d.id), 404, "bukti: kontrak lama = 404");
  const sesudah = await testPrisma.expenseSubmission.findUnique({ where: { id: d.id } });
  assert.equal(sesudah.status, "DRAFT");
  assert.equal(sesudah.description, "Rahasia Kampanye Alfa");
  // daftar tidak menampilkan milik orang lain — termasuk saat memakai pencarian (?q=), yang dulu menimpa filter kepemilikan
  assert.equal((await lain.get(PB)).body.submissions.length, 0);
  assert.equal((await lain.get(`${PB}?q=Uji`)).body.submissions.length, 0);
  assert.equal((await lain.get(`${PB}?q=${d.submissionNumber}`)).body.submissions.length, 0);
  assert.equal((await c.mkt.get(`${PB}?q=${d.submissionNumber}`)).body.submissions.length, 1);
});

test("Own-only: pemilik boleh melihat, mengedit, menarik, membatalkan draf miliknya", async () => {
  const { c, u } = await siapkan();
  const d = await buat(c.mkt, body("MARKETING"));
  assert.equal((await c.mkt.get(`${PB}/${d.id}`)).status, 200);
  assert.equal((await c.mkt.patch(`${PB}/${d.id}`, { description: "Diubah pemilik" })).status, 200);
  await bukti(d.id, u.mkt.user.id);
  assert.equal((await c.mkt.post(`${PB}/${d.id}/ajukan`, {}, K("m"))).status, 200);
  assert.equal((await c.mkt.post(`${PB}/${d.id}/tarik`, {}, K("m"))).status, 200);
  const b = await c.mkt.post(`${PB}/${d.id}/batalkan`, { reason: "batal" }, K("m"));
  assert.equal(b.status, 200, JSON.stringify(b.body));
  assert.equal(b.body.status, "DIBATALKAN");
});

// ── lintas divisi ───────────────────────────────────────────────────────────────────────────────────────────────

test("Lintas divisi ditolak: workspace lain 403 (config/buat/daftar/duplicate-check), ID langsung 404", async () => {
  const { c } = await siapkan();
  const hr = await buat(c.fin, body("HR_GA"));
  const del = await buat(c.disp, bodyDelivery());
  for (const [nama, cl] of [["mkt", c.mkt], ["pl", c.pl], ["wh", c.wh], ["salesTanpa", c.salesTanpa]]) {
    assert.equal((await cl.get(`${PB}/${hr.id}`)).status, 404, `${nama} → HR-GA by id`);
    assert.equal((await cl.get(`${PB}/${del.id}`)).status, 404, `${nama} → Delivery by id`);
    assert.equal((await cl.patch(`${PB}/${hr.id}`, { amount: 1 })).status, 404, `${nama} patch`);
    assert.equal((await cl.post(`${PB}/${hr.id}/batalkan`, {}, K("z"))).status, 404, `${nama} batalkan`);
    assert.equal((await cl.post(`${PB}/${hr.id}/metadata`, { reason: "z", changes: {} })).status, 404, `${nama} metadata`);
  }
  assert.equal((await c.mkt.get(`${PB}?division=HR_GA`)).status, 403);
  assert.equal((await c.mkt.get(`${PB}/duplicate-check?division=HR_GA&expenseType=PELATIHAN&date=2026-09-26`)).status, 403);
  assert.equal((await c.mkt.get(`${PB}/opsi?workspace=HR_GA`)).status, 403);
  const semua = await c.mkt.get(PB);
  assert.ok(!semua.body.submissions.some((s) => s.division !== "MARKETING"));
  // id bukan UUID / tidak ada → 404 yang aman
  assert.equal((await c.mkt.get(`${PB}/bukan-uuid`)).status, 404);
  assert.equal((await c.mkt.get(`${PB}/00000000-0000-4000-8000-000000000000`)).status, 404);
});

// ── Finance / Admin / Owner ─────────────────────────────────────────────────────────────────────────────────────

test("Finance/Admin/Owner melihat semua workspace; catat atas nama; hanya finance:admin yang mengedit draf orang lain", async () => {
  const { c, u } = await siapkan();
  const a = await buat(c.mkt, body("MARKETING"));
  const b = await buat(c.disp, bodyDelivery());
  const d = await buat(c.hr, body("HR_GA"));
  for (const k of ["fin", "adm", "owner"]) {
    const r = await c[k].get(PB);
    assert.equal(r.status, 200, k);
    assert.deepEqual([...new Set(r.body.submissions.map((s) => s.division))].sort(), ["DELIVERY", "HR_GA", "MARKETING"], k);
    for (const id of [a.id, b.id, d.id]) assert.equal((await c[k].get(`${PB}/${id}`)).status, 200, `${k}/${id}`);
  }
  // Finance biasa (finance:post, bukan admin) tidak boleh mengedit draf orang lain; Admin & Owner boleh
  assert.equal((await c.fin.patch(`${PB}/${a.id}`, { description: "x" })).status, 403);
  assert.equal((await c.adm.patch(`${PB}/${a.id}`, { description: "oleh admin" })).status, 200);
  assert.equal((await c.owner.patch(`${PB}/${d.id}`, { description: "oleh owner" })).status, 200);
  // catat atas nama pengguna lain
  const an = await c.fin.post(PB, body("MARKETING", { requestedById: u.mkt.user.id }));
  assert.equal(an.status, 201, JSON.stringify(an.body));
  assert.equal(an.body.requestedById, u.mkt.user.id);
  // anggota divisi tidak boleh mencatat atas nama orang lain
  assert.equal((await c.mkt.post(PB, body("MARKETING", { requestedById: u.mkt2.user.id }))).status, 403);
});

// ── Delivery: kebocoran ownership yang ditutup ──────────────────────────────────────────────────────────────────

test("Delivery: Dispatcher lain tidak bisa membatalkan / mengoreksi metadata / mengubah / mengajukan / menarik / melihat pengajuan Dispatcher lain (dulu bocor)", async () => {
  const { c, u } = await siapkan();
  const d = await buat(c.disp, bodyDelivery({ description: "Delivery milik dispatcher A" }));
  const lain = c.disp2;
  assert.equal((await lain.get(`${PB}/${d.id}`)).status, 403);
  assert.equal((await lain.post(`${PB}/${d.id}/batalkan`, { reason: "iseng" }, K("d"))).status, 403);
  assert.equal((await lain.post(`${PB}/${d.id}/metadata`, { reason: "iseng", changes: { description: "diubah" } })).status, 403);
  assert.equal((await lain.patch(`${PB}/${d.id}`, { amount: 1 })).status, 403);
  assert.equal((await lain.post(`${PB}/${d.id}/ajukan`, {}, K("d"))).status, 403);
  assert.equal((await lain.post(`${PB}/${d.id}/tarik`, {}, K("d"))).status, 403);
  assert.equal(await unggah(u.disp2.token, d.id), 404, "bukti: kontrak lama = 404");
  assert.equal((await lain.get(`${PB}?q=Delivery`)).body.submissions.length, 0);
  const tetap = await testPrisma.expenseSubmission.findUnique({ where: { id: d.id } });
  assert.equal(tetap.status, "DRAFT");
  assert.equal(tetap.description, "Delivery milik dispatcher A");
  // pemilik tetap bisa; Admin tetap bisa
  assert.equal((await c.disp.post(`${PB}/${d.id}/batalkan`, { reason: "batal sendiri" }, K("d"))).status, 200);
  const e = await buat(c.disp, bodyDelivery());
  assert.equal((await c.adm.post(`${PB}/${e.id}/batalkan`, { reason: "admin" }, K("a"))).status, 200);
});

test("Delivery: Sales/Produksi/Gudang tanpa keanggotaan Delivery ditolak; Driver own-only tidak melihat milik driver lain (404) termasuk lewat pencarian", async () => {
  const { c } = await siapkan();
  const d = await buat(c.disp, bodyDelivery());
  for (const k of ["salesTanpa", "mkt", "pl", "wh"]) assert.equal((await c[k].get(`${PB}/config?workspace=DELIVERY`)).status, 403, k);
  const milikDrv = await c.drv.post(PB, bodyDelivery({ description: "Milik driver satu" }), K("v"));
  assert.equal(milikDrv.status, 201, JSON.stringify(milikDrv.body));
  assert.equal((await c.drv2.get(`${PB}/${milikDrv.body.id}`)).status, 403);
  assert.equal((await c.drv2.get(`${PB}?q=Milik`)).body.submissions.length, 0);
  assert.equal((await c.drv2.get(`${PB}?q=${d.submissionNumber}`)).body.submissions.length, 0);
  assert.equal((await c.drv2.post(`${PB}/${milikDrv.body.id}/batalkan`, {}, K("v"))).status, 404);
});

// ── privasi data turunan ────────────────────────────────────────────────────────────────────────────────────────

test("Peringatan duplikat untuk non-Finance hanya menyangkut pengajuan miliknya; Finance melihat semua", async () => {
  const { c } = await siapkan();
  await buat(c.mkt, body("MARKETING"));
  const q = `${PB}/duplicate-check?division=MARKETING&expenseType=IKLAN_PROMOSI&date=2026-09-26&amount=150000`;
  assert.equal((await c.mkt.get(q)).body.kandidat.length, 1);
  assert.equal((await c.mkt2.get(q)).body.kandidat.length, 0);
  assert.equal((await c.fin.get(q)).body.kandidat.length, 1);
});

// ── user lama tanpa keanggotaan tetap bisa login ────────────────────────────────────────────────────────────────

test("User lama tanpa keanggotaan tetap bisa login; token lama (tanpa roles/divisi) tetap berlaku; divisi efektif dari adapter peran", async () => {
  const { u } = await siapkan();
  const hash = await bcrypt.hash("rahasia123", 4);
  const lama = await testPrisma.user.create({ data: { name: "Dispatcher Lama", email: "lama@example.test", passwordHash: hash, role: "DISPATCHER" } });
  const anon = makeClient(server.baseUrl, null);
  const login = await anon.post("/api/auth/login", { email: "lama@example.test", password: "rahasia123" });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  assert.deepEqual(login.body.user.divisions, ["DELIVERY"]);
  const me = await makeClient(server.baseUrl, login.body.token).get("/api/auth/me");
  assert.equal(me.status, 200);
  assert.deepEqual(me.body.divisions, ["DELIVERY"]);
  // SALES tanpa keanggotaan: login normal, divisi kosong
  const s = await testPrisma.user.create({ data: { name: "Sales Lama", email: "sl@example.test", passwordHash: hash, role: "SALES" } });
  const ls = await anon.post("/api/auth/login", { email: "sl@example.test", password: "rahasia123" });
  assert.equal(ls.status, 200);
  assert.deepEqual(ls.body.user.divisions, []);
  // token format lama: hanya {id, role}, tanpa roles maupun divisi — sesi yang sudah berjalan tidak rusak
  const tokenLama = jwt.sign({ id: lama.id, name: lama.name, role: "DISPATCHER" }, process.env.JWT_SECRET, { expiresIn: "1h" });
  assert.equal((await makeClient(server.baseUrl, tokenLama).get(`${PB}/config?workspace=DELIVERY`)).status, 200);
  assert.equal((await makeClient(server.baseUrl, tokenLama).get(`${PB}/config?workspace=MARKETING`)).status, 403);
  void u; void s;
});

// ── pengaturan keanggotaan (Admin/Owner) & berlaku seketika ─────────────────────────────────────────────────────

test("Atur keanggotaan: hanya Admin/Owner; validasi; idempoten; daftar pengguna menampilkan divisi hanya ke Admin/Owner; berlaku seketika dengan token yang sama", async () => {
  const { c, u } = await siapkan();
  const target = u.salesTanpa.user.id;
  assert.equal((await c.salesTanpa.put(`/api/users/${target}/divisions`, { divisions: ["MARKETING"] })).status, 403);
  assert.equal((await c.fin.put(`/api/users/${target}/divisions`, { divisions: ["MARKETING"] })).status, 403);
  assert.equal((await c.adm.put(`/api/users/${target}/divisions`, { divisions: ["ACAK"] })).status, 400);
  assert.equal((await c.adm.put(`/api/users/${target}/divisions`, { divisions: "MARKETING" })).status, 400);
  assert.equal((await c.adm.put(`/api/users/tidak-ada/divisions`, { divisions: [] })).status, 404);
  // sebelum: ditolak
  assert.equal((await c.salesTanpa.get(`${PB}/config?workspace=MARKETING`)).status, 403);
  const set1 = await c.adm.put(`/api/users/${target}/divisions`, { divisions: ["MARKETING", "MARKETING", "HR_GA"] });
  assert.equal(set1.status, 200, JSON.stringify(set1.body));
  assert.deepEqual(set1.body.divisions.sort(), ["HR_GA", "MARKETING"]);
  // sesudah: token yang SAMA langsung berlaku
  assert.equal((await c.salesTanpa.get(`${PB}/config?workspace=MARKETING`)).status, 200);
  assert.equal((await c.salesTanpa.get(`${PB}/config?workspace=HR_GA`)).status, 200);
  // penggantian set (mencabut HR-GA) juga seketika; peran TIDAK berubah
  const set2 = await c.owner.put(`/api/users/${target}/divisions`, { divisions: ["MARKETING"] });
  assert.deepEqual(set2.body.divisions, ["MARKETING"]);
  assert.equal((await c.salesTanpa.get(`${PB}/config?workspace=HR_GA`)).status, 403);
  const row = await testPrisma.user.findUnique({ where: { id: target } });
  assert.equal(row.role, "SALES");
  assert.equal(await testPrisma.userRole.count({ where: { userId: target } }), 0, "peran tidak disentuh");
  const jejak = await testPrisma.userDivision.findFirst({ where: { userId: target, division: "MARKETING" } });
  assert.equal(jejak.grantedById, u.adm.user.id);
  // pencabutan penuh
  await c.adm.put(`/api/users/${target}/divisions`, { divisions: [] });
  assert.equal((await c.salesTanpa.get(`${PB}/config?workspace=MARKETING`)).status, 403);
  // daftar pengguna: divisi hanya untuk Admin/Owner
  const adminList = await c.adm.get("/api/users?includeInactive=true");
  assert.ok(adminList.body.every((x) => Array.isArray(x.divisions)));
  assert.equal(adminList.body.find((x) => x.id === u.mkt.user.id).divisions[0], "MARKETING");
  const salesList = await c.mkt.get("/api/users");
  assert.ok(salesList.body.every((x) => x.divisions === undefined));
});

test("Keanggotaan tidak pernah diisi otomatis: membuat user / mengubah peran tidak menambah baris divisi", async () => {
  const { c } = await siapkan();
  const dulu = await testPrisma.userDivision.count();
  const baru = await c.adm.post("/api/users", { name: "Karyawan Baru", email: "baru@example.test", password: "rahasia123", role: "SALES" });
  assert.equal(baru.status, 201, JSON.stringify(baru.body));
  await c.adm.post(`/api/users/${baru.body.id}/roles`, { role: "WAREHOUSE" });
  assert.equal(await testPrisma.userDivision.count(), dulu);
});

// ── request paralel ─────────────────────────────────────────────────────────────────────────────────────────────

test("Paralel: klik ganda pemilik = satu FinExpense; banyak request non-pemilik bersamaan semuanya 403 dan data tidak berubah", async () => {
  const { c, u } = await siapkan();
  const d = await buat(c.mkt, body("MARKETING"));
  await bukti(d.id, u.mkt.user.id);
  const penyerang = [];
  for (let i = 0; i < 4; i++) {
    penyerang.push(c.mkt2.post(`${PB}/${d.id}/ajukan`, {}, K("atk")));
    penyerang.push(c.mkt2.post(`${PB}/${d.id}/batalkan`, { reason: "iseng" }, K("atk")));
    penyerang.push(c.mkt2.patch(`${PB}/${d.id}`, { amount: 1 }));
    penyerang.push(c.mkt2.post(`${PB}/${d.id}/metadata`, { reason: "iseng", changes: { description: "x" } }));
  }
  const kunci = K("dbl");
  const pemilik = [c.mkt.post(`${PB}/${d.id}/ajukan`, {}, kunci), c.mkt.post(`${PB}/${d.id}/ajukan`, {}, kunci), c.mkt.post(`${PB}/${d.id}/ajukan`, {}, kunci)];
  const hasil = await Promise.all([...penyerang, ...pemilik]);
  assert.ok(hasil.slice(0, penyerang.length).every((r) => r.status === 403), JSON.stringify(hasil.slice(0, penyerang.length).map((r) => r.status)));
  // klik ganda dengan kunci sama: yang pertama 200; sisanya 200 (hasil yang sama) atau 409 (masih diproses) — tidak pernah membuat yang kedua
  const stPemilik = hasil.slice(penyerang.length).map((r) => r.status);
  assert.ok(stPemilik.includes(200) && stPemilik.every((x) => x === 200 || x === 409), JSON.stringify(stPemilik));
  assert.equal(await testPrisma.finExpense.count(), 1);
  const s = await testPrisma.expenseSubmission.findUnique({ where: { id: d.id } });
  assert.equal(s.status, "MENUNGGU_PERSETUJUAN");
  assert.equal(s.amount.toString(), "150000");
});

test("Paralel: pencabutan keanggotaan bersamaan dengan pembuatan — setelah dicabut tidak ada pengajuan baru yang lolos", async () => {
  const { c, u } = await siapkan();
  await c.adm.put(`/api/users/${u.mkt.user.id}/divisions`, { divisions: [] });
  const hasil = await Promise.all(Array.from({ length: 5 }, () => c.mkt.post(PB, body("MARKETING"))));
  assert.ok(hasil.every((r) => r.status === 403));
  assert.equal(await testPrisma.expenseSubmission.count(), 0);
  // set paralel yang sama tetap idempoten (tanpa duplikat baris / galat)
  const set = await Promise.all(Array.from({ length: 5 }, () => c.adm.put(`/api/users/${u.mkt.user.id}/divisions`, { divisions: ["MARKETING"] })));
  assert.ok(set.every((r) => r.status === 200), JSON.stringify(set.map((r) => r.body)));
  assert.equal(await testPrisma.userDivision.count({ where: { userId: u.mkt.user.id } }), 1);
});

// ── 401 tanpa sesi ──────────────────────────────────────────────────────────────────────────────────────────────

test("Tanpa sesi: seluruh endpoint pengajuan dan atur divisi 401", async () => {
  const anon = makeClient(server.baseUrl, null);
  assert.equal((await anon.get(`${PB}/config?workspace=MARKETING`)).status, 401);
  assert.equal((await anon.get(PB)).status, 401);
  assert.equal((await anon.post(PB, body("MARKETING"))).status, 401);
  assert.equal((await anon.put("/api/users/x/divisions", { divisions: [] })).status, 401);
});
