// Kutipan (quote/reply) harus sampai ke WhatsApp sebagai balasan sungguhan.
//
// Bug produksi (1 Okt 2026): CRM mengirim field `quotedMessageId` ke WAHA,
// padahal WAHA hanya membaca `reply_to` — kutipan tampil di aplikasi tapi di
// WhatsApp jadi pesan biasa. Tes ini mengunci nama field yang benar.
import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { sendText, downloadMediaMessage } from "../src/services/wahaClient.js";

const fetchAsli = globalThis.fetch;
afterEach(() => { globalThis.fetch = fetchAsli; });

function tangkapFetch(balasan = { id: "true_x@c.us_ABC" }) {
  const panggilan = [];
  globalThis.fetch = async (url, opts) => {
    panggilan.push({ url: String(url), body: opts?.body ? JSON.parse(opts.body) : null });
    return new Response(JSON.stringify(balasan), { status: 200, headers: { "content-type": "application/json" } });
  };
  return panggilan;
}

describe("sendText — kutipan", () => {
  test("pesan yang dikutip dikirim sebagai reply_to", async () => {
    const panggilan = tangkapFetch();
    await sendText("628123456789", "Siap kak", "false_628111@c.us_3EB0AAA", "CS-1");
    assert.equal(panggilan[0].body.reply_to, "false_628111@c.us_3EB0AAA");
  });

  test("nama field lama (quotedMessageId) tidak dipakai lagi", async () => {
    const panggilan = tangkapFetch();
    await sendText("628123456789", "Siap kak", "false_628111@c.us_3EB0AAA", "CS-1");
    assert.equal("quotedMessageId" in panggilan[0].body, false);
  });

  test("tanpa kutipan, reply_to tidak disertakan", async () => {
    const panggilan = tangkapFetch();
    await sendText("628123456789", "Halo", null, "CS-1");
    assert.equal("reply_to" in panggilan[0].body, false);
  });
});

describe("downloadMediaMessage — sesi", () => {
  test("memakai sesi yang diminta, bukan WAHA_SESSION global", async () => {
    const panggilan = tangkapFetch({ data: "AAAA", mimetype: "image/jpeg" });
    await downloadMediaMessage("false_628111@c.us_3EB0AAA", "CS-2");
    assert.match(panggilan[0].url, /\/api\/CS-2\/messages\//);
  });
});
