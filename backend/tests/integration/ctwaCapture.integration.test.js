// Test integrasi capture atribusi CTWA FASE 0 — router webhook ASLI
// (routes/webhooks.js) + PostgreSQL sungguhan, lewat HTTP seperti WAHA
// memanggilnya. Yang dibuktikan di sini adalah KONTRAK terhadap pemrosesan
// pesan, bukan format observasi (itu tests/ctwaCapture.test.js):
//   - hasil Message/Customer IDENTIK dengan flag mati vs nyala
//   - customer baru DAN lama teramati
//   - event `message` + `message.any` untuk pesan yang sama = 1 Message, 1 observasi
//   - payload non-CTWA tidak melahirkan atribusi palsu
//   - kegagalan capture tidak menggagalkan Message.create
//   - isi chat / nomor / nama tidak ada di berkas capture
import fs from "fs";
import os from "os";
import path from "path";

// WAJIB sebelum modul app dimuat: WAHA dibuat tak terjangkau (connection
// refused seketika) supaya lookup nama/foto profil gagal cepat & aman.
process.env.WAHA_BASE_URL = "http://127.0.0.1:9";
const SALT = "salt-integrasi-0123456789abcdef";
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "ctwa-int-"));
const CAP_DIR = path.join(TMP, "cap");
process.env.CTWA_CAPTURE_DIR = CAP_DIR;
process.env.CTWA_CAPTURE_HASH_SALT = SALT;
delete process.env.CTWA_ATTRIBUTION_CAPTURE_ENABLED;

await import("./setup/env.js");
const { default: test } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const { default: express } = await import("express");
const { testPrisma, truncateAll } = await import("./setup/testDb.js");
const { startTestServer } = await import("./setup/testApp.js");
const { webhookRouter } = await import("../../src/routes/webhooks.js");
const { _getStats, _resetForTests, flushCapture } = await import("../../src/services/ctwaCapture.js");

const CLID = "AfhKBK8ZBWyKw3p49jW-KFh_rNlyzXmCKW0eSdHULJZtXqZk";
const TEXT_CANARY = "rahasia keluhan pinggang canary";
const NAME_CANARY = "Budi Canary Santoso";

let server;
test.before(async () => {
  await truncateAll();
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use("/api/webhooks", webhookRouter);
  server = await startTestServer(app);
});
test.after(async () => {
  await server?.close?.();
  await testPrisma.$disconnect();
  fs.rmSync(TMP, { recursive: true, force: true });
});

function gows({ phone, msgId, ctwa = false, text = TEXT_CANARY, withSourceId = false }) {
  const ctx = ctwa
    ? {
        conversionSource: "FB_Ads", entryPointConversionSource: "ctwa_ad", entryPointConversionApp: "facebook",
        entryPointConversionDelaySeconds: 24,
        externalAdReply: {
          sourceURL: "https://www.instagram.com/p/DXWbO-EAOeT/", ctwaClid: CLID, containsCtwaFlowsAutoReply: false,
          ...(withSourceId ? { sourceID: "120210000000001", sourceType: "ad" } : {}),
        },
      }
    : undefined;
  return {
    id: `false_${phone}@c.us_${msgId}`,
    from: `${phone}@c.us`,
    fromMe: false,
    body: text,
    hasMedia: false,
    timestamp: Math.floor(Date.now() / 1000),
    _data: {
      Info: { Chat: `${phone}@c.us`, Sender: `${phone}@c.us`, PushName: NAME_CANARY, Type: "text" },
      Message: { extendedTextMessage: { text, ...(ctx ? { contextInfo: ctx } : {}) } },
    },
  };
}

async function post(event, payload) {
  const res = await fetch(`${server.baseUrl}/api/webhooks/waha`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event, session: "default", engine: "GOWS", payload }),
  });
  assert.equal(res.status, 200);
}

const settle = async (cond, ms = 8000) => {
  const t = Date.now();
  while (Date.now() - t < ms) { if (await cond()) return true; await new Promise((r) => setTimeout(r, 25)); }
  return false;
};
const msgCount = (externalId) => testPrisma.message.count({ where: { externalId } });
const customerOf = (phone) => testPrisma.customer.findUnique({
  where: { phone },
  select: { leadSource: true, leadSourceDetail: true, ctwaClid: true, ctwaSourceUrl: true, pipelineStage: true, leadSourceConfirmed: true },
});
const captureLines = () => (fs.existsSync(CAP_DIR)
  ? fs.readdirSync(CAP_DIR).filter((f) => f.endsWith(".jsonl")).flatMap((f) => fs.readFileSync(path.join(CAP_DIR, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)))
  : []);

const PH_OFF = "6285100000001", PH_ON = "6285100000002", PH_NON = "6285100000003", PH_RACE = "6285100000004", PH_FAIL = "6285100000005";

test("flag MATI (default): pesan & customer diproses normal, tidak ada berkas capture", async () => {
  const p = gows({ phone: PH_OFF, msgId: "3EB0INT00001", ctwa: true });
  await post("message", p);
  assert.ok(await settle(async () => (await msgCount(p.id)) === 1));
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(fs.existsSync(CAP_DIR), false);
  assert.equal(_getStats().observed, 0);
  const c = await customerOf(PH_OFF);
  assert.equal(c.leadSource, "META_ADS");
  assert.equal(c.ctwaClid, CLID);
});

test("flag NYALA: hasil Customer/Message IDENTIK dengan flag mati; customer baru teramati", async () => {
  process.env.CTWA_ATTRIBUTION_CAPTURE_ENABLED = "true";
  _resetForTests();
  const p = gows({ phone: PH_ON, msgId: "3EB0INT00002", ctwa: true, withSourceId: true });
  await post("message", p);
  assert.ok(await settle(async () => (await msgCount(p.id)) === 1));
  assert.ok(await settle(() => captureLines().length === 1));

  const off = await customerOf(PH_OFF), on = await customerOf(PH_ON);
  assert.deepEqual(on, off, "atribusi/pipeline customer harus sama dengan baseline flag-mati");

  const o = captureLines()[0];
  assert.equal(o.customer, "NEW");
  assert.equal(o.verdict, "CTWA_AD");
  assert.equal(o.event, "message");
  assert.equal(o.values.sourceId, "120210000000001");
  assert.equal(o.fields.sourceType, "present");
});

test("customer LAMA yang membawa konteks iklan juga teramati; hasil Customer tidak berubah", async () => {
  const before = await customerOf(PH_ON);
  const p = gows({ phone: PH_ON, msgId: "3EB0INT00003", ctwa: true });
  await post("message", p);
  assert.ok(await settle(async () => (await msgCount(p.id)) === 1));
  assert.ok(await settle(() => captureLines().some((l) => l.customer === "EXISTING")));
  assert.deepEqual(await customerOf(PH_ON), before, "capture tidak boleh mengubah atribusi customer lama");
  const o = captureLines().find((l) => l.customer === "EXISTING");
  assert.equal(o.verdict, "CTWA_AD");
  assert.equal(o.fields.sourceId, "absent");
});

test("pesan biasa (TANPA CTWA): tidak ada baris JSONL, tidak ada atribusi palsu; hanya dihitung agregat", async () => {
  const barisSebelum = captureLines().length;
  const diamatiSebelum = _getStats().observed;
  const p = gows({ phone: PH_NON, msgId: "3EB0INT00004", ctwa: false });
  await post("message", p);
  assert.ok(await settle(async () => (await msgCount(p.id)) === 1));
  assert.ok(await settle(() => _getStats().observed === diamatiSebelum + 1));
  const c = await customerOf(PH_NON);
  assert.notEqual(c.leadSource, "META_ADS");
  assert.equal(c.ctwaClid, null);
  assert.equal(captureLines().length, barisSebelum, "pesan biasa tidak boleh menambah satu baris pun");
  await flushCapture();
  const hari = fs.readdirSync(CAP_DIR).find((f) => f.startsWith("ctwa-capture-counts-"));
  const agregat = JSON.parse(fs.readFileSync(path.join(CAP_DIR, hari), "utf8"));
  assert.ok(agregat.verdicts.NO_CONTEXT_INFO >= 1);
  assert.ok(agregat.total > agregat.signal, "penyebut lebih besar dari jumlah bersinyal");
});

test("event `message` + `message.any` bersamaan untuk pesan yang sama = 1 Message & 1 observasi", async () => {
  const sebelum = captureLines().length;
  const p = gows({ phone: PH_RACE, msgId: "3EB0INT00005", ctwa: true });
  await Promise.all([post("message", p), post("message.any", p)]);
  assert.ok(await settle(async () => (await msgCount(p.id)) === 1));
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(await msgCount(p.id), 1);
  assert.equal(await testPrisma.message.count({ where: { conversation: { customer: { phone: PH_RACE } } } }), 1);
  assert.equal(captureLines().length - sebelum, 1);
  // Ulang kirim sesudah tersimpan (retry WAHA): tetap tidak menggandakan.
  await post("message.any", p);
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(captureLines().length - sebelum, 1);
});

test("kegagalan capture TIDAK menggagalkan Message.create / pembuatan Customer", async () => {
  const berkas = path.join(TMP, "bukan-direktori");
  fs.writeFileSync(berkas, "x");
  process.env.CTWA_CAPTURE_DIR = berkas; // menulis ke sini pasti gagal
  const gagalSebelum = _getStats().failed;
  const p = gows({ phone: PH_FAIL, msgId: "3EB0INT00006", ctwa: true });
  await post("message", p);
  assert.ok(await settle(async () => (await msgCount(p.id)) === 1), "Message harus tetap tersimpan");
  assert.ok(await settle(() => _getStats().failed > gagalSebelum), "kegagalan harus tercatat terpisah");
  const c = await customerOf(PH_FAIL);
  assert.equal(c.leadSource, "META_ADS", "atribusi lama tetap jalan");
  assert.deepEqual(c, await customerOf(PH_OFF));
  assert.equal(await testPrisma.conversation.count({ where: { customer: { phone: PH_FAIL } } }), 1);
  process.env.CTWA_CAPTURE_DIR = CAP_DIR;
});

test("berkas capture: tanpa isi chat, nama, nomor, JID, ctwa_clid utuh", async () => {
  const semua = fs.readdirSync(CAP_DIR).map((f) => fs.readFileSync(path.join(CAP_DIR, f), "utf8")).join("\n");
  assert.ok(semua.length > 0);
  for (const s of [TEXT_CANARY, NAME_CANARY, CLID, "tXqZk", PH_OFF, PH_ON, PH_NON, PH_RACE, PH_FAIL, "6285100000", "@c.us", "@lid"]) {
    assert.ok(!semua.includes(s), `bocor di berkas capture: ${s}`);
  }
});

test("prosedur audit volume (docs/CTWA-CAPTURE-PHASE0.md): SQL agregat valid, hanya angka per hari WIB", async () => {
  const rows = await testPrisma.$queryRawUnsafe(`
    SELECT to_char((m."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD') AS hari_wib,
           count(*)::int AS inbound
    FROM "Message" m
    JOIN "Conversation" c ON c.id = m."conversationId"
    WHERE m.direction = 'INBOUND' AND c.type = 'INDIVIDUAL' AND m."createdAt" >= now() - interval '14 days'
    GROUP BY 1 ORDER BY 1`);
  assert.deepEqual(Object.keys(rows[0]).sort(), ["hari_wib", "inbound"], "tidak boleh ada kolom selain hari dan jumlah");
  const total = rows.reduce((a, r) => a + r.inbound, 0);
  assert.equal(total, await testPrisma.message.count({ where: { direction: "INBOUND", conversation: { type: "INDIVIDUAL" } } }));
  assert.ok(total >= 5);
});
