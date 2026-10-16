// UJI CRASH atribusi touch (Fase 2): proses backend DIMATIKAN (SIGKILL) pada setiap titik antara simpan Message dan tulis touch, lalu
// "dihidupkan kembali" sebagai proses baru. Membuktikan (di PostgreSQL sekali-pakai, router webhook ASLI, proses terpisah):
//   - tidak pernah ada keadaan "Message tersimpan, touch tidak ada" pada kematian di titik mana pun (atomik);
//   - kematian SEBELUM commit → tidak ada Message maupun touch; webhook yang dikirim ulang menghasilkan TEPAT SATU Message + SATU touch;
//   - kematian SESUDAH commit → keduanya ada; webhook ulang tidak menggandakan;
//   - customer yang sempat dibuat sebelum kematian tetap dihitung "baru saat touch" pada percobaan ulang (bukan akuisisi yang hilang);
//   - customer lama, Ad ID belum terpetakan, dua event bersamaan, dan flag MATI.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

await import("./setup/env.js");
const { default: test } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const { testPrisma, truncateAll } = await import("./setup/testDb.js");
const { gowsPayload, bungkusWebhook, CLID_UJI, TEKS_UJI } = await import("./helpers/ctwaPayload.js");

const ANAK = path.join(path.dirname(fileURLToPath(import.meta.url)), "helpers", "atribusiCrashChild.mjs");
const SALT = "salt-integrasi-crash-0123456789abcdef";
const AD_PETA = "52694481763484", AD_BARU = "52699999999999";
const hidup = new Set();

function mulaiAnak({ crashAt = "", flag = "true" } = {}) {
  const env = { ...process.env, CRASH_AT: crashAt, CTWA_CAPTURE_HASH_SALT: SALT, WAHA_BASE_URL: "http://127.0.0.1:9" };
  delete env.CTWA_ATTRIBUTION_CAPTURE_ENABLED;
  if (flag === "true") env.ATRIBUSI_TOUCH_CAPTURE_ENABLED = "true"; else delete env.ATRIBUSI_TOUCH_CAPTURE_ENABLED;
  const proc = spawn(process.execPath, [ANAK], { env, stdio: ["ignore", "pipe", "pipe"] });
  hidup.add(proc);
  const selesai = new Promise((res) => proc.once("exit", (kode, sinyal) => { hidup.delete(proc); res({ kode, sinyal }); }));
  let log = "";
  let buf = "";
  proc.stderr.on("data", (d) => { log += d; });
  const siap = new Promise((res, rej) => {
    proc.stdout.on("data", (d) => { buf += d; const m = /PORT (\d+)/.exec(buf); if (m) res(Number(m[1])); });
    proc.once("exit", () => rej(new Error("proses anak berhenti sebelum siap: " + log.slice(-300))));
    setTimeout(() => rej(new Error("proses anak tidak siap dalam 60 dtk")), 60_000).unref();
  });
  return { proc, selesai, siap, log: () => log, keluaran: () => buf };
}
const hentikan = async (a) => { if (a.proc.exitCode === null && !a.proc.killed) a.proc.kill(); await a.selesai; };
const kirim = async (port, event, payload) => {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/webhooks/waha`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(bungkusWebhook(event, payload)) });
    return r.status;
  } catch { return "KONEKSI_PUTUS"; }
};
const tunggu = async (cond, ms = 15_000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await cond()) return true; await new Promise((r) => setTimeout(r, 40)); } return false; };
const tenangTouch = async (jendela = 500) => {
  let terakhir = await testPrisma.attributionTouch.count(); let sejak = Date.now();
  while (Date.now() - sejak < jendela) { await new Promise((r) => setTimeout(r, 50)); const n = await testPrisma.attributionTouch.count(); if (n !== terakhir) { terakhir = n; sejak = Date.now(); } }
};
const msgCount = (p) => testPrisma.message.count({ where: { externalId: p.id } });
const touchUntuk = async (phone) => testPrisma.attributionTouch.findMany({ where: { customer: { phone } }, orderBy: { touchAt: "asc" } });
let nomor = 0;
const phoneBaru = () => `62857${String(Date.now() % 1e6).padStart(6, "0")}${String(++nomor).padStart(2, "0")}`;

test.before(async () => { await truncateAll(); await testPrisma.metaAdReference.deleteMany({}); await testPrisma.attributionTouch.deleteMany({}); });
test.after(async () => { for (const p of hidup) p.kill(); await testPrisma.$disconnect(); });

test("referensi: satu Ad ID terpetakan (untuk membedakan MAPPED / UNMAPPED pada pemulihan)", async () => {
  await testPrisma.metaAdReference.create({ data: { adId: AD_PETA, adSetId: "52694481763284", campaignId: "52694481763084", source: "MANUAL", syncedAt: new Date() } });
});

// Urutan statement di dalam transaksi pesan CTWA: 1 kunci customer · 2 hitung pesan · 3 message.create · 4 SAVEPOINT · 5 baca referensi · 6 insert touch · 7 RELEASE SAVEPOINT · (commit)
const TITIK = [
  ["stmt:1", "setelah kunci customer (belum ada Message)"],
  ["stmt:2", "setelah hitung pesan sebelumnya"],
  ["stmt:3", "tepat setelah INSERT Message (sebelum touch)"],
  ["stmt:4", "setelah SAVEPOINT"],
  ["stmt:5", "setelah membaca referensi"],
  ["stmt:6", "setelah INSERT touch (belum RELEASE/commit)"],
  ["stmt:7", "setelah RELEASE SAVEPOINT (belum commit)"],
  ["after-commit", "tepat setelah COMMIT (sebelum respons)"],
];

for (const [titik, ket] of TITIK) {
  test(`crash ${titik} — ${ket}: tidak pernah ada Message tanpa touch; proses baru memulihkan TEPAT satu touch`, async () => {
    const phone = phoneBaru();
    const p = gowsPayload({ phone, msgId: `3EB0CRASH${titik.replace(/\W/g, "")}${nomor}`, ad: AD_PETA });
    const sudahCommit = titik === "after-commit";

    // 1. proses yang akan mati
    const a = mulaiAnak({ crashAt: titik });
    const port = await a.siap;
    const status = await kirim(port, "message", p);
    await a.selesai;
    assert.match(a.keluaran(), new RegExp("CRASH_POINT " + titik), "proses harus mati di titik yang dituju");
    assert.notEqual(a.proc.exitCode, 0, "mati mendadak, bukan keluar bersih");
    assert.equal(status, 200, "webhook di-ack 200 SEBELUM diproses (res.sendStatus di awal handler): WAHA tidak mengirim ulang otomatis");

    // 2. invarian: dilihat dari DB oleh pengamat luar
    const m1 = await msgCount(p);
    const t1 = await touchUntuk(phone);
    assert.equal(t1.length, m1, `Message=${m1} touch=${t1.length}: tidak boleh ada Message tanpa touch`);
    assert.equal(m1, sudahCommit ? 1 : 0, sudahCommit ? "commit sudah terjadi" : "transaksi dibatalkan Postgres ketika koneksi putus");

    // 3. proses BARU + webhook dikirim ulang (WAHA retry)
    const b = mulaiAnak({});
    const port2 = await b.siap;
    assert.equal(await kirim(port2, "message", p), 200);
    assert.ok(await tunggu(async () => (await msgCount(p)) === 1), "Message harus tersimpan sesudah retry");
    assert.ok(await tunggu(async () => (await touchUntuk(phone)).length === 1), "touch harus muncul");
    await tenangTouch();
    const t2 = await touchUntuk(phone);
    assert.equal(await msgCount(p), 1);
    assert.equal(t2.length, 1, "TEPAT satu touch");
    assert.equal(t2[0].adId, AD_PETA);
    assert.equal(t2[0].mappingStatusAtTouch, "MAPPED");
    assert.equal(t2[0].customerStatusAtTouch, "NEW", "customer yang sempat terbentuk sebelum kematian tetap akuisisi baru — dibuktikan clid yang sama (CLID_COCOK) atau pembuatan oleh webhook ini");
    assert.ok(["WEBHOOK_MEMBUAT", "CLID_COCOK"].includes(t2[0].customerBasisAtTouch));

    // 4. event ulang berikutnya dan DUA event bersamaan: tetap satu
    await Promise.all([kirim(port2, "message", p), kirim(port2, "message.any", p), kirim(port2, "message.any", p)]);
    await tenangTouch();
    assert.equal(await msgCount(p), 1);
    assert.equal((await touchUntuk(phone)).length, 1);
    await hentikan(b);
  });
}

test("customer LAMA + crash sebelum commit: setelah proses baru, touch ada dengan status EXISTING (bukan lead baru)", async () => {
  const phone = phoneBaru();
  // customer lama: dibuat 10 hari lalu dengan riwayat pesan
  const cust = await testPrisma.customer.create({ data: { name: "Pelanggan Lama", phone, leadSource: "WHATSAPP_DIRECT", createdAt: new Date(Date.now() - 10 * 86_400_000) } });
  const conv = await testPrisma.conversation.create({ data: { customerId: cust.id, channel: "WHATSAPP" } });
  await testPrisma.message.create({ data: { conversationId: conv.id, direction: "INBOUND", content: "pesan lama", externalId: `false_${phone}@c.us_3EB0OLDMSG${nomor}`, createdAt: new Date(Date.now() - 10 * 86_400_000) } });

  const p = gowsPayload({ phone, msgId: `3EB0CRASHOLD${nomor}`, ad: AD_PETA });
  const a = mulaiAnak({ crashAt: "stmt:5" });
  await kirim(await a.siap, "message", p);
  await a.selesai;
  assert.match(a.keluaran(), /CRASH_POINT/, "proses harus mati di titik yang dituju");
  assert.equal(await msgCount(p), 0);
  assert.equal((await touchUntuk(phone)).length, 0);

  const b = mulaiAnak({});
  assert.equal(await kirim(await b.siap, "message", p), 200);
  assert.ok(await tunggu(async () => (await touchUntuk(phone)).length === 1));
  const [t] = await touchUntuk(phone);
  assert.deepEqual([t.customerStatusAtTouch, t.customerBasisAtTouch], ["EXISTING", "RIWAYAT_PESAN"]);
  assert.equal(await testPrisma.customer.count({ where: { phone } }), 1);
  const sesudah = await testPrisma.customer.findUnique({ where: { id: cust.id }, select: { createdAt: true } });
  assert.equal(sesudah.createdAt.getTime(), cust.createdAt.getTime(), "customer lama tidak berubah");
  await hentikan(b);
});

test("Ad ID BELUM terpetakan + crash: touch UNMAPPED tersimpan sekali dengan ad set/campaign null (tidak ditebak)", async () => {
  const phone = phoneBaru();
  const p = gowsPayload({ phone, msgId: `3EB0CRASHUNM${nomor}`, ad: AD_BARU });
  const a = mulaiAnak({ crashAt: "stmt:6" });
  await kirim(await a.siap, "message", p);
  await a.selesai;
  assert.match(a.keluaran(), /CRASH_POINT/, "proses harus mati di titik yang dituju");
  const b = mulaiAnak({});
  assert.equal(await kirim(await b.siap, "message", p), 200);
  assert.ok(await tunggu(async () => (await touchUntuk(phone)).length === 1));
  await tenangTouch();
  const ts = await touchUntuk(phone);
  assert.equal(ts.length, 1);
  assert.deepEqual([ts[0].adId, ts[0].mappingStatusAtTouch, ts[0].adSetId, ts[0].campaignId], [AD_BARU, "UNMAPPED", null, null]);
  await hentikan(b);
});

test("flag MATI + crash: tidak ada transaksi/touch; pesan tersimpan normal sesudah retry; 0 touch", async () => {
  const phone = phoneBaru();
  const p = gowsPayload({ phone, msgId: `3EB0CRASHOFF${nomor}`, ad: AD_PETA });
  const a = mulaiAnak({ crashAt: "stmt:1", flag: "false" });   // tidak ada transaksi pesan → tidak ada titik mati; proses tetap hidup
  const port = await a.siap;
  assert.equal(await kirim(port, "message", p), 200);
  assert.ok(await tunggu(async () => (await msgCount(p)) === 1));
  await tenangTouch();
  assert.equal((await touchUntuk(phone)).length, 0);
  assert.equal(a.proc.exitCode, null, "tanpa flag, jalur transaksi touch tidak dipakai sehingga titik mati tidak pernah tercapai");
  const c = await testPrisma.customer.findUnique({ where: { phone }, select: { leadSource: true, ctwaClid: true } });
  assert.equal(c.leadSource, "META_ADS");
  assert.equal(c.ctwaClid, CLID_UJI, "atribusi lama (Customer) tidak terpengaruh");
  await hentikan(a);
});

test("privasi sesudah semua crash/pemulihan: tabel touch tanpa nomor, nama, isi chat, clid mentah, JID", async () => {
  const baris = JSON.stringify(await testPrisma.$queryRawUnsafe("select * from attribution_touches"));
  assert.ok(baris.length > 10);
  for (const s of [CLID_UJI, TEKS_UJI, "Budi Canary", "@c.us", "62857", "instagram.com", "DcgquCfg3_4"]) assert.ok(!baris.includes(s), `bocor: ${s}`);
});
