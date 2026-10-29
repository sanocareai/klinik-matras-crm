// AOV TIM SALES — dua metrik terpisah (Okt 2026): "AOV Order Masuk Tim" (basis tanggal DIBUAT) dan "AOV Order Lunas Tim" (basis tanggal MENJADI LUNAS / paidAt).
// Dijalankan pada DB terisolasi dengan periode TETAP (Oktober 2026 WIB) dan tanggal eksplisit, supaya tidak bergantung pada jam tes. Yang dikunci:
//   • himpunan & angka kedua metrik (Team Lead, atribusi percakapan lama, order Rp0, nota kredit, koreksi nilai, batal/menunggu/spam/PKR dikecualikan, order tanpa atribusi & milik akun di luar Tim dilaporkan terpisah)
//   • batas periode WIB inklusif awal / eksklusif akhir untuk createdAt maupun paidAt (order dibuat bulan lalu tetapi lunas bulan ini masuk AOV Lunas, bukan AOV Masuk)
//   • PARITY daftar–kartu: halaman daftar disusun ulang = himpunan, jumlah, dan total yang sama dengan kartu; AOV = total ÷ jumlah dari baris yang sama
//   • selisih terhadap Laporan Sales (order dengan dua pemegang percakapan Tim terhitung ganda di sana, satu kali di sini) dan terhadap Dashboard/Ringkasan (seluruh perusahaan) terjelaskan persis
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createLoginUser, makeRaw } from "./setup/authFixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { resetRateLimits } from "../../src/lib/rateLimit.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";

let server; let raw;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); raw = makeRaw(server.baseUrl); });
test.beforeEach(() => resetRateLimits());
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const FROM = "2026-10-01"; const TO = "2026-10-31";
const PERIODE = `from=${FROM}&to=${TO}`;
let nonce = 0; // cacheSingkat(30 dtk) menyimpan per URL: parameter tak dikenal membuat URL unik tanpa mengubah hasil
const u = (path, extra = "") => `${path}${path.includes("?") ? "&" : "?"}${PERIODE}${extra}&_=${++nonce}`;
let seq = 0;
const D = (iso) => new Date(iso);

async function login(roles, nama, tambahan = {}) {
  const a = await createLoginUser({ roles, active: tambahan.active ?? true });
  await testPrisma.user.update({ where: { id: a.user.id }, data: { name: nama, ...(tambahan.isSalesTeamLead && { isSalesTeamLead: true }) } });
  if (tambahan.active === false) return { ...a, token: null };
  const r = await raw("POST", "/api/auth/login", { body: { email: a.email, password: a.password } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return { ...a, token: r.body.token };
}

/** Dunia uji: dua Sales aktif, Team Lead (berperan ADMIN), Sales nonaktif, Admin non-Tim, akun kas untuk refund. */
async function dunia() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const bank = await testPrisma.finCashAccount.create({ data: { name: "BCA Uji", kind: "BANK", accountId: akunBank.id } });
  bankUji = bank.id;
  const admin = await login(["ADMIN"], "Admin Uji");
  const alya = await login(["SALES"], "Alya Uji");
  const buland = await login(["SALES"], "Buland Uji");
  const novi = await login(["ADMIN"], "Novi Uji", { isSalesTeamLead: true });
  const pensiun = await login(["SALES"], "Pensiun Uji", { active: false });
  return { bank, admin, alya, buland, novi, pensiun };
}

/** Pelanggan + percakapan INDIVIDUAL yang dipegang `pemegang` (daftar user id). */
async function pelanggan(nama, { pemegang = [], stage = "TRANSACTION" } = {}) {
  seq += 1;
  const c = await testPrisma.customer.create({ data: { phone: `6281377${String(seq).padStart(6, "0")}`, name: nama, pipelineStage: stage } });
  // unik per (pelanggan, kanal): pemegang ke-2 memakai kanal lain (pelanggan yang sama menghubungi lewat WhatsApp dan Instagram)
  const KANAL = ["WHATSAPP", "INSTAGRAM"];
  for (const [i, id] of pemegang.entries()) await testPrisma.conversation.create({ data: { customerId: c.id, channel: KANAL[i], assignedToId: id, type: "INDIVIDUAL" } });
  return c;
}
async function order(c, { nilai, dibuat, lunas = null, status = "DELIVERED", pemilik = null, pkr = null, kategori = "LAYANAN" }) {
  seq += 1;
  return testPrisma.order.create({
    data: {
      customerId: c.id, value: nilai, status, category: kategori, orderNumber: `RES-AOV-${String(seq).padStart(4, "0")}`, salesOwnerId: pemilik, penjualanKaryawanId: pkr,
      createdAt: D(dibuat), paymentStatus: lunas ? "LUNAS" : "BELUM_BAYAR", paidAt: lunas ? D(lunas) : null,
    },
  });
}
/** Nota Kredit tertaut-refund (seperti kasus Sofyan): refund DISETUJUI (atau DIBATALKAN bila nota dibatalkan) + nota berstatus AKTIF/DIBATALKAN. Constraint DB: refund_id atau journal_id wajib ada. */
let bankUji = null;
async function nota(orderId, jumlah, status = "AKTIF") {
  const refund = await testPrisma.finRefund.create({ data: { refundNumber: `RFD-NK-${++seq}`, orderId, date: D("2026-10-10T00:00:00Z"), amount: jumlah, reason: "uji nota", cashAccountId: bankUji, status: status === "AKTIF" ? "DISETUJUI" : "DIBATALKAN" } });
  return testPrisma.finOrderCredit.create({ data: { creditNumber: `NK-AOV-${++seq}`, orderId, amount: jumlah, reason: "Potongan uji", creditDate: D("2026-10-10T00:00:00Z"), status, refundId: refund.id, idempotencyKey: `aov-${randomUUID()}`,
    ...(status === "DIBATALKAN" && { cancelledAt: D("2026-10-11T00:00:00Z"), cancelReason: "salah input" }) } });
}
const batalkanNota = async (n) => { await testPrisma.finOrderCredit.update({ where: { id: n.id }, data: { status: "DIBATALKAN", cancelledAt: D("2026-10-16T00:00:00Z"), cancelReason: "salah input" } }); await testPrisma.finRefund.update({ where: { id: n.refundId }, data: { status: "DIBATALKAN" } }); };

/** Skenario Oktober 2026. Mengembalikan peta kode → order, dengan nilai yang diharapkan pada komentar. */
async function skenario(w) {
  const o = {};
  const cA = await pelanggan("Cust A", { pemegang: [w.alya.user.id] });
  const cB = await pelanggan("Cust B", { pemegang: [w.buland.user.id] });
  const cN = await pelanggan("Cust Novi", { pemegang: [w.novi.user.id] });
  // MASUK + LUNAS di periode
  o.m1 = await order(cA, { nilai: 2_000_000, dibuat: "2026-10-05T03:00:00Z", pemilik: w.alya.user.id }); // masuk saja (belum lunas)
  o.m2 = await order(cA, { nilai: 4_000_000, dibuat: "2026-10-10T03:00:00Z", lunas: "2026-10-12T03:00:00Z", pemilik: w.alya.user.id }); // masuk + lunas
  o.l1 = await order(cB, { nilai: 3_000_000, dibuat: "2026-09-20T03:00:00Z", lunas: "2026-10-03T03:00:00Z", pemilik: w.buland.user.id }); // dibuat bulan lalu → HANYA lunas
  o.n1 = await order(cN, { nilai: 1_000_000, dibuat: "2026-10-07T03:00:00Z", lunas: "2026-10-08T03:00:00Z", pemilik: w.novi.user.id }); // closing pribadi Team Lead: masuk + lunas
  o.z0 = await order(cA, { nilai: 0, dibuat: "2026-10-09T03:00:00Z", pemilik: w.alya.user.id }); // Rp0: tetap order, masuk saja
  o.k1 = await order(cB, { nilai: 2_500_000, dibuat: "2026-10-11T03:00:00Z", lunas: "2026-10-13T03:00:00Z", pemilik: w.buland.user.id }); // nota kredit 500.000 → bersih 2.000.000
  await nota(o.k1.id, 500_000);
  await nota(o.k1.id, 700_000, "DIBATALKAN"); // nota dibatalkan TIDAK mengurangi
  // Dikecualikan
  o.x1 = await order(cA, { nilai: 9_000_000, dibuat: "2026-10-06T03:00:00Z", lunas: "2026-10-07T03:00:00Z", status: "CANCELLED", pemilik: w.alya.user.id });
  o.x2 = await order(cA, { nilai: 8_000_000, dibuat: "2026-10-06T04:00:00Z", status: "PENDING", pemilik: w.alya.user.id });
  const cSpam = await pelanggan("Giling Spam", { pemegang: [w.alya.user.id], stage: "SPAM" });
  o.x3 = await order(cSpam, { nilai: 7_000_000, dibuat: "2026-10-06T05:00:00Z", lunas: "2026-10-08T05:00:00Z", pemilik: w.alya.user.id });
  const pkr = await testPrisma.finPenjualanKaryawan.create({ data: { id: randomUUID(), nomor: `PKR-AOV-${++seq}`, date: D("2026-10-06T00:00:00Z"), sellerId: w.alya.user.id, buyerName: "Karyawan Uji", total: 6_000_000, status: "AKTIF" } });
  o.x4 = await order(cA, { nilai: 6_000_000, dibuat: "2026-10-06T06:00:00Z", lunas: "2026-10-09T06:00:00Z", pemilik: w.alya.user.id, pkr: pkr.id });
  // Tanpa atribusi & milik akun di luar Tim → bukan Tim, tetapi dilaporkan
  const cAdmin = await pelanggan("Cust Admin", { pemegang: [w.admin.user.id] });
  o.u1 = await order(cAdmin, { nilai: 1_500_000, dibuat: "2026-10-12T03:00:00Z" });
  o.u2 = await order(cA, { nilai: 1_200_000, dibuat: "2026-10-13T03:00:00Z", pemilik: w.pensiun.user.id });
  // Atribusi percakapan lama (tanpa pemilik eksplisit) + satu order dengan DUA pemegang Tim
  o.p1 = await order(cA, { nilai: 1_800_000, dibuat: "2026-10-14T03:00:00Z" });
  const cGanda = await pelanggan("Cust Ganda", { pemegang: [w.alya.user.id, w.buland.user.id] });
  o.d1 = await order(cGanda, { nilai: 1_600_000, dibuat: "2026-10-15T03:00:00Z" });
  // Batas periode WIB — createdAt: 30 Sep 23:59:59.999 WIB (keluar), 1 Okt 00:00 WIB (masuk), 31 Okt 23:59:59.999 WIB (masuk), 1 Nov 00:00 WIB (keluar)
  o.ba = await order(cA, { nilai: 1_000_000, dibuat: "2026-09-30T16:59:59.999Z", pemilik: w.alya.user.id });
  o.bb = await order(cA, { nilai: 1_100_000, dibuat: "2026-09-30T17:00:00.000Z", pemilik: w.alya.user.id });
  o.bc = await order(cA, { nilai: 1_200_000, dibuat: "2026-10-31T16:59:59.999Z", pemilik: w.alya.user.id });
  o.bd = await order(cA, { nilai: 1_300_000, dibuat: "2026-10-31T17:00:00.000Z", pemilik: w.alya.user.id });
  // Batas periode WIB — paidAt (dibuat Agustus): lunas 31 Okt 23:59:59.999 (masuk) / 1 Nov 00:00 (keluar) / 1 Okt 00:00 (masuk) / 30 Sep 23:59:59.999 (keluar)
  o.lb1 = await order(cB, { nilai: 500_000, dibuat: "2026-08-01T03:00:00Z", lunas: "2026-10-31T16:59:59.999Z", pemilik: w.buland.user.id });
  o.lb2 = await order(cB, { nilai: 510_000, dibuat: "2026-08-01T03:00:00Z", lunas: "2026-10-31T17:00:00.000Z", pemilik: w.buland.user.id });
  o.lb3 = await order(cB, { nilai: 600_000, dibuat: "2026-08-01T03:00:00Z", lunas: "2026-09-30T17:00:00.000Z", pemilik: w.buland.user.id });
  o.lb4 = await order(cB, { nilai: 610_000, dibuat: "2026-08-01T03:00:00Z", lunas: "2026-09-30T16:59:59.999Z", pemilik: w.buland.user.id });
  return o;
}

// Himpunan yang diharapkan
const MASUK_KODE = ["m1", "m2", "n1", "z0", "k1", "p1", "d1", "bb", "bc"]; // 9 order
const MASUK_NILAI = 2_000_000 + 4_000_000 + 1_000_000 + 0 + 2_000_000 + 1_800_000 + 1_600_000 + 1_100_000 + 1_200_000; // 14.700.000 (k1 bersih)
const LUNAS_KODE = ["m2", "l1", "n1", "k1", "lb1", "lb3"]; // 6 order
const LUNAS_NILAI = 4_000_000 + 3_000_000 + 1_000_000 + 2_000_000 + 500_000 + 600_000; // 11.100.000

async function ambil(w, path) { const r = await raw("GET", path, { token: w.admin.token }); assert.equal(r.status, 200, `${path}: ${JSON.stringify(r.body)}`); return r.body; }
async function semuaHalaman(w, metrik, ukuran, extra = "") {
  const baris = []; let off = 0; let hm = true; let total = null;
  for (let i = 0; i < 100 && hm; i++) {
    const r = await ambil(w, u("/api/analytics/sales-aov/orders", `&metrik=${metrik}&limit=${ukuran}&offset=${off}${extra}`));
    baris.push(...r.orders); off += r.orders.length; hm = r.hasMore; total = r.total;
  }
  return { baris, total };
}

test("dua metrik: himpunan, jumlah order, total NILAI BERSIH, dan AOV dihitung dari baris yang sama; pengecualian dilaporkan", async () => {
  const w = await dunia(); const o = await skenario(w);
  const k = await ambil(w, u("/api/analytics/sales-aov"));

  // periode & definisi
  assert.equal(k.periode.zona, "WIB (UTC+7)"); assert.equal(k.periode.label, "2026-10-01 s.d. 2026-10-31");
  assert.equal(k.periode.mulaiUtc, "2026-09-30T17:00:00.000Z"); assert.equal(k.periode.selesaiUtcEksklusif, "2026-10-31T17:00:00.000Z");
  assert.equal(k.masuk.label, "AOV Order Masuk Tim"); assert.equal(k.lunas.label, "AOV Order Lunas Tim");
  assert.match(k.masuk.rumus, /dibuat/); assert.match(k.lunas.rumus, /menjadi lunas/);
  assert.equal(k.tim.jumlahAnggota, 3, "Alya + Buland + Novi (Team Lead); Sales nonaktif dan Admin non-Tim tidak ikut");
  assert.ok(k.tim.anggota.find((a) => a.nama === "Novi Uji")?.teamLead);

  // AOV Order Masuk Tim
  assert.equal(k.masuk.jumlahOrder, MASUK_KODE.length);
  assert.equal(k.masuk.totalNilaiBersih, MASUK_NILAI, "k1 dihitung bersih 2.000.000 (nota 500.000 aktif; nota dibatalkan tidak mengurangi)");
  assert.equal(k.masuk.totalNilaiKotor, MASUK_NILAI + 500_000);
  assert.equal(k.masuk.totalNotaKredit, 500_000);
  assert.equal(k.masuk.aov, Math.round(MASUK_NILAI / MASUK_KODE.length));
  assert.equal(k.masuk.orderRp0, 1, "order Rp0 tetap dihitung sebagai order");
  assert.equal(k.masuk.orderBernota, 1); assert.equal(k.masuk.orderBerefund, 1, "k1: refund tertaut nota aktif (refund nota yang dibatalkan tidak dihitung)");

  // AOV Order Lunas Tim: order dibuat bulan lalu tetapi lunas bulan ini (l1, lb1, lb3) ikut; basis paidAt, bukan createdAt
  assert.equal(k.lunas.jumlahOrder, LUNAS_KODE.length);
  assert.equal(k.lunas.totalNilaiBersih, LUNAS_NILAI);
  assert.equal(k.lunas.aov, Math.round(LUNAS_NILAI / LUNAS_KODE.length));
  assert.equal(k.lunas.orderLintasPeriode, 3, "l1 (Sep), lb1 & lb3 (Agt) dibuat sebelum periode");
  assert.equal(k.lunas.nilaiLintasPeriode, 3_000_000 + 500_000 + 600_000);
  assert.equal(k.lunas.orderBernota, 1);
  assert.notEqual(k.masuk.aov, k.lunas.aov, "dua metrik memang berbeda populasi");

  // Pengecualian dilaporkan (bukan dibuang diam-diam)
  assert.deepEqual(k.masuk.diagnosa.tanpaAtribusi, { jumlahOrder: 1, totalNilaiBersih: 1_500_000 }, "u1: pelanggan dipegang Admin non-Tim, tanpa pemilik");
  assert.deepEqual(k.masuk.diagnosa.pemilikLuarTim, { jumlahOrder: 1, totalNilaiBersih: 1_200_000 }, "u2: pemilik Sales nonaktif");
  assert.equal(k.masuk.diagnosa.dibatalkanDikecualikan, 1); assert.equal(k.masuk.diagnosa.menungguDikecualikan, 1);
  assert.equal(k.masuk.diagnosa.pkrDikecualikan, 1); assert.equal(k.masuk.diagnosa.spamDikecualikan, 1);
  assert.equal(k.lunas.diagnosa.dibatalkanDikecualikan, 1, "x1 dibatalkan walau paidAt terisi"); assert.equal(k.lunas.diagnosa.pkrDikecualikan, 1); assert.equal(k.lunas.diagnosa.spamDikecualikan, 1);

  // Pembanding perusahaan (= Dashboard/Ringkasan untuk AOV Masuk): Tim + tanpa atribusi + pemilik luar Tim
  assert.equal(k.masuk.pembandingPerusahaan.jumlahOrder, 9 + 2);
  assert.equal(k.masuk.pembandingPerusahaan.totalNilaiBersih, MASUK_NILAI + 1_500_000 + 1_200_000);
  assert.equal(k.masuk.pembandingPerusahaan.selisihJumlahOrder, 2); assert.equal(k.masuk.pembandingPerusahaan.selisihNilaiBersih, 2_700_000);
});

test("PARITY daftar–kartu: halaman disusun ulang = himpunan, jumlah, total, dan AOV kartu; baris memuat nilai kotor/nota/bersih yang bisa diaudit", async () => {
  const w = await dunia(); const o = await skenario(w);
  const k = await ambil(w, u("/api/analytics/sales-aov"));
  const idDari = (kode) => kode.map((c) => o[c].id).sort();
  for (const [metrik, kode, ukuran] of [["masuk", MASUK_KODE, 4], ["lunas", LUNAS_KODE, 2]]) {
    const { baris, total } = await semuaHalaman(w, metrik, ukuran);
    assert.equal(total, kode.length); assert.equal(baris.length, kode.length);
    assert.deepEqual(baris.map((b) => b.id).sort(), idDari(kode), `${metrik}: himpunan daftar = himpunan yang diharapkan`);
    assert.equal(new Set(baris.map((b) => b.id)).size, baris.length, "tanpa baris ganda lintas halaman");
    const jumlahBersih = baris.reduce((s, b) => s + b.nilaiBersih, 0);
    assert.equal(jumlahBersih, k[metrik].totalNilaiBersih, `${metrik}: Σ nilai bersih daftar = kartu`);
    assert.equal(baris.length, k[metrik].jumlahOrder, `${metrik}: jumlah baris = jumlah order kartu`);
    assert.equal(Math.round(jumlahBersih / baris.length), k[metrik].aov, `${metrik}: AOV = total ÷ jumlah dari baris yang sama`);
    for (const b of baris) assert.equal(b.nilaiKotor - b.notaKredit, b.nilaiBersih, "identitas kotor − nota = bersih per baris");
    // ringkasan di respons daftar = kartu
    const h = await ambil(w, u("/api/analytics/sales-aov/orders", `&metrik=${metrik}&limit=1`));
    assert.equal(h.ringkasan.totalNilaiBersih, k[metrik].totalNilaiBersih); assert.equal(h.ringkasan.jumlahOrder, k[metrik].jumlahOrder);
  }
  const rp0 = (await semuaHalaman(w, "masuk", 50)).baris.find((b) => b.id === o.z0.id);
  assert.ok(rp0.rp0 && rp0.nilaiBersih === 0, "Rp0 tertandai di daftar");
  const k1 = (await semuaHalaman(w, "masuk", 50)).baris.find((b) => b.id === o.k1.id);
  assert.equal(k1.nilaiKotor, 2_500_000); assert.equal(k1.notaKredit, 500_000); assert.equal(k1.nilaiBersih, 2_000_000);
  const p1 = (await semuaHalaman(w, "masuk", 50)).baris.find((b) => b.id === o.p1.id);
  assert.equal(p1.atribusi, "PERCAKAPAN"); assert.equal(p1.sales, "Alya Uji");
  const l1 = (await semuaHalaman(w, "lunas", 50)).baris.find((b) => b.id === o.l1.id);
  assert.ok(l1.lintasPeriode && l1.tanggalLunas && new Date(l1.tanggalDibuat) < new Date("2026-09-30T17:00:00Z"), "lunas bulan ini, dibuat bulan lalu");
  // pencarian: daftar tersaring + ringkasan tersaring dari baris yang sama
  const q = await ambil(w, u("/api/analytics/sales-aov/orders", "&metrik=masuk&q=buland&limit=50"));
  assert.deepEqual((await ambil(w, u("/api/analytics/sales-aov/orders", "&metrik=masuk&q=buland&limit=50"))).orders.map((b) => b.id).sort(), [o.k1.id, o.d1.id].sort(), "pencarian nama Sales: k1 (pemilik Buland) + d1 (dipegang Alya & Buland)");
  assert.equal(q.ringkasanTersaring.jumlahOrder, 2); assert.equal(q.ringkasanTersaring.totalNilaiBersih, 2_000_000 + 1_600_000);
  assert.equal(q.ringkasan.totalNilaiBersih, k.masuk.totalNilaiBersih, "ringkasan penuh tetap = kartu walau daftar disaring");
  const d1 = (await semuaHalaman(w, "masuk", 50)).baris.find((b) => b.id === o.d1.id); assert.equal(d1.sales, "Alya Uji, Buland Uji");
});

test("batas periode WIB: createdAt dan paidAt inklusif di awal hari, eksklusif di awal hari berikutnya", async () => {
  const w = await dunia(); const o = await skenario(w);
  const masuk = (await semuaHalaman(w, "masuk", 100)).baris.map((b) => b.id);
  assert.ok(masuk.includes(o.bb.id) && masuk.includes(o.bc.id), "1 Okt 00:00 WIB dan 31 Okt 23:59:59.999 WIB masuk");
  assert.ok(!masuk.includes(o.ba.id) && !masuk.includes(o.bd.id), "30 Sep 23:59:59.999 WIB dan 1 Nov 00:00 WIB keluar");
  const lunas = (await semuaHalaman(w, "lunas", 100)).baris.map((b) => b.id);
  assert.ok(lunas.includes(o.lb1.id) && lunas.includes(o.lb3.id) && !lunas.includes(o.lb2.id) && !lunas.includes(o.lb4.id));
  assert.ok(!masuk.includes(o.l1.id) && lunas.includes(o.l1.id), "dibuat bulan lalu & lunas bulan ini: HANYA di AOV Lunas");
  assert.ok(masuk.includes(o.m1.id) && !lunas.includes(o.m1.id), "dibuat bulan ini & belum lunas: HANYA di AOV Masuk");
});

test("koreksi nilai, nota kredit baru, pembatalan nota, refund, dan order yang keluar dari Lunas — kartu dan daftar mengikuti, tetap sepadan", async () => {
  const w = await dunia(); const o = await skenario(w);
  // koreksi nilai m1 2.000.000 → 2.300.000; nota kredit baru 200.000 pada p1 (1.800.000 → 1.600.000)
  await testPrisma.order.update({ where: { id: o.m1.id }, data: { value: 2_300_000 } });
  const notaP1 = await nota(o.p1.id, 200_000);
  let k = await ambil(w, u("/api/analytics/sales-aov"));
  assert.equal(k.masuk.totalNilaiBersih, MASUK_NILAI + 300_000 - 200_000);
  assert.equal(k.masuk.orderBernota, 2); assert.equal(k.masuk.orderBerefund, 2, "k1 dan p1 punya refund aktif tertaut nota");
  // nota p1 dibatalkan → kembali
  await batalkanNota(notaP1);
  k = await ambil(w, u("/api/analytics/sales-aov"));
  assert.equal(k.masuk.totalNilaiBersih, MASUK_NILAI + 300_000); assert.equal(k.masuk.orderBernota, 1); assert.equal(k.masuk.orderBerefund, 1, "refund p1 ikut dibatalkan");
  // nota melebihi nilai order: bersih ditahan Rp0, identitas kotor − nota = bersih tetap berlaku di baris
  await nota(o.z0.id, 100_000); // z0 (Rp0) kini juga berrefund aktif
  const { baris } = await semuaHalaman(w, "masuk", 50);
  const z0 = baris.find((b) => b.id === o.z0.id); assert.equal(z0.nilaiBersih, 0); assert.equal(z0.nilaiKotor - z0.notaKredit, z0.nilaiBersih);
  // refund aktif pada m2 (tetap Lunas): nilai tidak berubah, hanya ditandai
  await testPrisma.finRefund.create({ data: { refundNumber: `RFD-AOV-${++seq}`, orderId: o.m2.id, date: D("2026-10-14T00:00:00Z"), amount: 400_000, reason: "uji", cashAccountId: w.bank.id, status: "DISETUJUI" } }).catch(async () => {
    const st = await testPrisma.$queryRaw`SELECT unnest(enum_range(NULL::"FinRefundStatus"))::text AS s`; throw new Error("status refund uji tidak valid; nilai enum: " + st.map((x) => x.s).join(","));
  });
  await testPrisma.finRefund.create({ data: { refundNumber: `RFD-AOV-${++seq}`, orderId: o.m1.id, date: D("2026-10-14T00:00:00Z"), amount: 100_000, reason: "ditolak", cashAccountId: w.bank.id, status: "DITOLAK" } });
  k = await ambil(w, u("/api/analytics/sales-aov"));
  assert.equal(k.masuk.orderBerefund, 3, "k1, z0, m2 berrefund aktif; refund DITOLAK (m1) dan DIBATALKAN tidak dihitung"); assert.equal(k.lunas.orderBerefund, 2, "k1 dan m2");
  assert.equal(k.lunas.totalNilaiBersih, LUNAS_NILAI, "refund pada order yang tetap Lunas tidak mengubah nilai");
  // refund yang membuat order tidak lagi Lunas → sistem mengosongkan paidAt (routes/orders.js): keluar dari AOV Lunas, tetap di AOV Masuk
  await testPrisma.order.update({ where: { id: o.m2.id }, data: { paymentStatus: "DP", paidAt: null } });
  k = await ambil(w, u("/api/analytics/sales-aov"));
  assert.equal(k.lunas.jumlahOrder, LUNAS_KODE.length - 1); assert.equal(k.lunas.totalNilaiBersih, LUNAS_NILAI - 4_000_000);
  assert.equal(k.masuk.jumlahOrder, MASUK_KODE.length, "AOV Masuk tidak berubah oleh pelunasan/refund");
  // parity tetap setelah semua perubahan
  for (const metrik of ["masuk", "lunas"]) {
    const { baris: b2 } = await semuaHalaman(w, metrik, 3);
    assert.equal(b2.reduce((s, b) => s + b.nilaiBersih, 0), k[metrik].totalNilaiBersih); assert.equal(b2.length, k[metrik].jumlahOrder);
  }
});

test("selisih terhadap Laporan Sales dan Dashboard/Ringkasan terjelaskan persis (definisi berbeda, bukan salah hitung)", async () => {
  const w = await dunia(); const o = await skenario(w);
  const k = await ambil(w, u("/api/analytics/sales-aov"));
  // — Laporan Sales: dihitung PER Sales lalu dijumlah; order dengan dua pemegang percakapan Tim (d1) terhitung di KEDUANYA. Di sini satu kali.
  const sr = await ambil(w, u("/api/analytics/sales-report"));
  const lead = sr.rows.filter((r) => r.isTeamLead);
  const orderSr = sr.total.orders + lead.reduce((s, r) => s + r.orders, 0);
  const nilaiSr = sr.total.grossValue + lead.reduce((s, r) => s + r.grossValue, 0);
  assert.equal(orderSr, k.masuk.jumlahOrder + 1, "Laporan Sales menghitung d1 dua kali (Alya & Buland)");
  assert.equal(nilaiSr, k.masuk.totalNilaiBersih + 1_600_000, "selisih nilai = nilai d1");
  const lunasSr = sr.total.collectedValue + lead.reduce((s, r) => s + (r.collectedValue || 0), 0);
  assert.equal(lunasSr, k.lunas.totalNilaiBersih, "Nilai Order yang Menjadi Lunas (Laporan Sales) = pembilang AOV Lunas Tim (tidak ada order lunas ganda di skenario ini)");
  // — Dashboard (revenue-series) & Ringkasan Laporan (business-summary): seluruh perusahaan, order dibuat di periode; pembilang & penyebut sama-sama tanpa PKR
  const rev = await ambil(w, u("/api/analytics/revenue-series"));
  assert.equal(rev.total, k.masuk.pembandingPerusahaan.totalNilaiBersih, "Dashboard: nilai perusahaan; PKR (x4 Rp6 jt) tidak ikut menggelembungkan");
  assert.equal(rev.totalOrders, k.masuk.pembandingPerusahaan.jumlahOrder);
  assert.equal(rev.aov, k.masuk.pembandingPerusahaan.aov);
  const bs = await ambil(w, u("/api/analytics/business-summary"));
  assert.equal(bs.uang.totalOrders, k.masuk.pembandingPerusahaan.jumlahOrder); assert.equal(bs.uang.aov, k.masuk.pembandingPerusahaan.aov);
  assert.ok(rev.aov < k.masuk.aov, "AOV perusahaan lebih rendah dari AOV Tim karena 2 order di luar Tim bernilai lebih kecil");
});

test("validasi masukan: metrik/tanggal/limit/offset tidak valid = 400 (bukan 500), tanpa token 401", async () => {
  const w = await dunia();
  const g = (p) => raw("GET", p, { token: w.admin.token });
  for (const [nama, p] of [
    ["metrik kosong", u("/api/analytics/sales-aov/orders")], ["metrik tidak dikenal", u("/api/analytics/sales-aov/orders", "&metrik=semua")],
    ["limit 0", u("/api/analytics/sales-aov/orders", "&metrik=masuk&limit=0")], ["limit 201", u("/api/analytics/sales-aov/orders", "&metrik=masuk&limit=201")],
    ["offset negatif", u("/api/analytics/sales-aov/orders", "&metrik=masuk&offset=-1")], ["limit bukan angka", u("/api/analytics/sales-aov/orders", "&metrik=masuk&limit=abc")],
    ["tanggal mustahil", `/api/analytics/sales-aov?from=2026-02-31&to=2026-03-01&_=${++nonce}`], ["format salah", `/api/analytics/sales-aov?from=kemarin&to=hari-ini&_=${++nonce}`],
    ["from tanpa to", `/api/analytics/sales-aov?from=2026-10-01&_=${++nonce}`], ["from setelah to", `/api/analytics/sales-aov?from=2026-10-31&to=2026-10-01&_=${++nonce}`],
  ]) { const r = await g(p); assert.equal(r.status, 400, `${nama}: ${r.status}`); }
  assert.equal((await raw("GET", u("/api/analytics/sales-aov"))).status, 401);
  assert.equal((await raw("GET", u("/api/analytics/sales-aov/orders", "&metrik=masuk"))).status, 401);
  // tanpa from/to = semua waktu, 200
  const semua = await raw("GET", `/api/analytics/sales-aov?_=${++nonce}`, { token: w.admin.token });
  assert.equal(semua.status, 200); assert.equal(semua.body.periode.semuaWaktu, true);
  // data kosong: AOV 0 (bukan NaN)
  assert.equal(semua.body.masuk.jumlahOrder, 0); assert.equal(semua.body.masuk.aov, 0);
});
