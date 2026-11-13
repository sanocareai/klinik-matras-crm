// Tes perakit konteks Copilot (MVP 2 langkah 2) — murni, tanpa DB / jaringan.
import test from "node:test";
import assert from "node:assert/strict";

import { ringkasPesan, rakitRiwayat, rakitKartuCustomer, pilihContohGaya, rakitKonteksCopilot, MAKS_PESAN } from "../src/services/agentStudio/copilotContext.js";
import { runCopilotDraft } from "../src/services/agentStudio/runtime.js";

const t0 = new Date("2026-11-13T08:00:00Z").getTime();
const msg = (i, direction, content, extra = {}) => ({ direction, content, createdAt: new Date(t0 + i * 60_000), ...extra });

test("ringkasPesan: media jadi label, revoked & kosong dibuang", () => {
  assert.equal(ringkasPesan(msg(0, "INBOUND", "", { mediaType: "image" })), "[foto]");
  assert.equal(ringkasPesan(msg(0, "INBOUND", "ini kasurnya", { mediaType: "image" })), "[foto] ini kasurnya");
  assert.equal(ringkasPesan(msg(0, "INBOUND", "", { mediaType: "audio" })), "[voice note]");
  assert.equal(ringkasPesan(msg(0, "INBOUND", "", { rawType: "location" })), "[lokasi]");
  assert.equal(ringkasPesan(msg(0, "INBOUND", "halo", { isRevoked: true })), null);
  assert.equal(ringkasPesan(msg(0, "INBOUND", "   ")), null);
  assert.ok(ringkasPesan(msg(0, "INBOUND", "x".repeat(2000))).length <= 601);
});

test("rakitRiwayat: urut lama → baru, maks 30 pesan terakhir", () => {
  const banyak = Array.from({ length: 45 }, (_, i) => msg(i, i % 2 ? "OUTBOUND" : "INBOUND", `pesan ${i}`)).reverse();
  const r = rakitRiwayat(banyak);
  assert.equal(r.length, MAKS_PESAN);
  assert.equal(r[0].isi, "pesan 15");
  assert.equal(r.at(-1).isi, "pesan 44");
  assert.equal(r.at(-1).dari, "CUSTOMER");
});

test("rakitKartuCustomer: lead baru, pelanggan lama, komplain terbuka, tanpa nomor HP", () => {
  assert.match(rakitKartuCustomer({}), /lead baru/);
  const kartu = rakitKartuCustomer({
    customer: { name: "Bu Rina", city: "Bekasi", phone: "6281234567890", pipelineStage: "TRANSACTION", tags: ["sakit-pinggang"] },
    orders: [{ createdAt: "2026-08-01", status: "DELIVERED", items: [{ layananName: "Service 160" }] }],
    complaints: [
      { caseNumber: "CMP-01092026-001", category: "KEMPES", status: "INVESTIGASI", description: "Busa ambles di tengah" },
      { caseNumber: "CMP-01062026-002", category: "LAIN", status: "SELESAI", description: "lama" },
    ],
  });
  assert.match(kartu, /Bekasi/);
  assert.match(kartu, /PELANGGAN LAMA/);
  assert.match(kartu, /Service 160/);
  assert.match(kartu, /KOMPLAIN TERBUKA \(1\)/);
  assert.doesNotMatch(kartu, /CMP-01062026-002/);
  assert.doesNotMatch(kartu, /6281234567890/);
});

test("pilihContohGaya: maks 8, bergiliran antar kategori, prioritas didahulukan", () => {
  const ex = [];
  for (const k of ["A", "B", "C"]) for (let i = 0; i < 5; i++) ex.push({ category: k, quote: `${k}${i}` });
  ex.push({ category: "A", quote: "  " });
  const p = pilihContohGaya(ex, { prioritas: ["C"] });
  assert.equal(p.length, 8);
  assert.deepEqual(p.slice(0, 3).map((e) => e.quote), ["C0", "A0", "B0"]);
  assert.equal(pilihContohGaya([]).length, 0);
});

test("rakitKonteksCopilot: blok lengkap, follow-up bila pesan terakhir dari sales", () => {
  const k = rakitKonteksCopilot({
    messages: [msg(0, "INBOUND", "kak brp yg 160?"), msg(1, "OUTBOUND", "Tergantung kondisinya Kak, keluhannya apa?")],
    customer: { name: "Andi", pipelineStage: "NEW", tags: [] },
    examples: [{ category: "OBJECTION_REFRAME_HARGA", quote: "Biar tepat, saya cek dulu kondisinya ya Kak" }, { category: "COMMUNICATION_VALIDATION", quote: "Wah capek ya Kak" }],
  });
  assert.match(k.pesan, /## KONTEKS CUSTOMER/);
  assert.match(k.pesan, /## CONTOH GAYA/);
  assert.match(k.pesan, /Customer: kak brp yg 160\?\nSales: Tergantung/);
  assert.match(k.pesan, /follow-up/);
  assert.match(k.pesan, /menanyakan harga 1x .*PERTAMA/);
  assert.equal(k.terakhirDari, "SALES");
  assert.equal(k.customerTerakhir, "kak brp yg 160?");
  assert.equal(k.contoh[0].category, "OBJECTION_REFRAME_HARGA", "sudah tanya harga → contoh harga didahulukan");

  const k2 = rakitKonteksCopilot({ messages: [msg(0, "INBOUND", "halo kak")] });
  assert.doesNotMatch(k2.pesan, /## CONTOH GAYA/);
  assert.match(k2.pesan, /draft balasan sales berikutnya/);
  assert.doesNotMatch(k2.pesan, /menanyakan harga/);
});

test("runCopilotDraft: mode copilot, konteks dikirim sebagai satu pesan user, cek pakai pesan customer terakhir", async () => {
  let dikirim;
  const konteks = rakitKonteksCopilot({ messages: [msg(0, "INBOUND", "kasurnya kempes, saya kecewa banget")] });
  const r = await runCopilotDraft({
    skillFiles: { "SKILL.md": "x" },
    konteks,
    callModel: async (req) => {
      dikirim = req;
      return { reply: JSON.stringify({ bubbles: [], handover: { perlu: true, alasan: "komplain" }, catatanInternal: "Komplain kempes — telepon customer." }), usage: { inputTokens: 1000, outputTokens: 100 } };
    },
  });
  assert.match(dikirim.systemPrompt, /MODE: COPILOT/);
  assert.equal(dikirim.messages.length, 1);
  assert.equal(dikirim.messages[0].content, konteks.pesan);
  const cek = Object.fromEntries(r.output.checks.map((c) => [c.kode, c.lulus]));
  assert.equal(cek.HANDOVER_TEPAT, true);
  assert.ok("COPILOT_SUARA_SALES" in cek);
  assert.ok(r.costUsd > 0);

  // Belum perlu follow-up: bubble [] tanpa handover tetap sah di mode copilot.
  const r2 = await runCopilotDraft({ skillFiles: { "SKILL.md": "x" }, konteks, callModel: async () => ({ reply: '{"bubbles":[]}', usage: {} }) });
  assert.ok(!r2.output.checks.some((c) => c.kode === "FORMAT_JSON"));

  await assert.rejects(runCopilotDraft({ skillFiles: {}, konteks: rakitKonteksCopilot({}), callModel: async () => ({}) }), /belum punya pesan/);
});
