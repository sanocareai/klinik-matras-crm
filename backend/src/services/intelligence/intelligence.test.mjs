// Regression test engine intelligence (PURE — tanpa DB). Jalankan:
//   node --test src/services/intelligence/intelligence.test.mjs
// Skenario: complaint escalation · hot buying intent · cold customer · unanswered.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCustomerIntelligence } from "./index.js";

const minAgo = (m) => new Date(Date.now() - m * 60_000).toISOString();
const dayAgo = (d) => new Date(Date.now() - d * 86_400_000).toISOString();

// signals memilih pesan terbaru via max(createdAt), jadi urutan array bebas.
function ctx({ stage = "LEAD", orders = [], msgs = [] }) {
  return {
    customer: { id: "c", name: "Test", phone: "628123456789", pipelineStage: stage, assignedSalesId: null, createdAt: dayAgo(120), orders },
    conversations: msgs.length
      ? [{ id: "cv", channel: "WHATSAPP", sessionId: "CS-1", lastMessageAt: msgs[0].createdAt, messages: msgs }]
      : [],
  };
}

test("complaint escalation → resolve complaint, urgent, health down", () => {
  const i = buildCustomerIntelligence(ctx({
    stage: "WON",
    orders: [{ value: 5_000_000, status: "DELIVERED", hasComplaint: true, createdAt: dayAgo(40) }],
    msgs: [{ direction: "OUTBOUND", content: "baik pak", createdAt: dayAgo(2) }], // kontak terakhir 2 hari
  }));
  assert.match(i.nextAction.action, /komplain/i);
  assert.equal(i.nextAction.urgency, "urgent");
  assert.ok(i.priority.reasons.some((r) => /komplain/i.test(r)), "priority reasons harus sebut komplain");
  assert.equal(i.health.trend, "down");
  assert.ok(i.priority.score >= 40, `priority ${i.priority.score} harus tinggi`);
});

test("hot buying intent → opportunity tinggi + intents terdeteksi", () => {
  const i = buildCustomerIntelligence(ctx({
    stage: "QUOTED",
    orders: [{ value: 6_000_000, status: "PROCESSING", hasComplaint: false, createdAt: dayAgo(5) }],
    msgs: [{ direction: "INBOUND", content: "harganya berapa ya? boleh minta katalog & foto?", createdAt: minAgo(30) }],
  }));
  assert.ok(i.opportunity.score >= 40, `opportunity ${i.opportunity.score}`);
  assert.ok(i.signals.detectedIntents.includes("PRICE_INQUIRY"));
  assert.ok(i.signals.detectedIntents.includes("CATALOG_REQUEST"));
  assert.ok(i.opportunity.signals.length > 0);
});

test("cold customer → health Berisiko, reaktivasi, priority low", () => {
  const i = buildCustomerIntelligence(ctx({
    stage: "LEAD", orders: [],
    msgs: [{ direction: "OUTBOUND", content: "halo", createdAt: dayAgo(90) }],
  }));
  assert.equal(i.health.category, "Berisiko");
  assert.ok(i.health.score < 50, `health ${i.health.score}`);
  assert.match(i.nextAction.action, /reaktivasi/i);
  assert.equal(i.priority.urgency, "low");
});

test("unanswered customer → balas follow-up, alasan 'belum dibalas'", () => {
  const i = buildCustomerIntelligence(ctx({
    stage: "QUALIFIED", orders: [],
    msgs: [{ direction: "INBOUND", content: "masih tersedia?", createdAt: minAgo(240) }], // 4 jam, belum dibalas
  }));
  assert.match(i.nextAction.action, /balas follow-up/i);
  assert.equal(i.nextAction.urgency, "high");
  assert.ok(i.priority.reasons.some((r) => /belum dibalas/i.test(r)));
});

test("determinisme → dua panggilan identik", () => {
  const f = () => buildCustomerIntelligence(ctx({ stage: "QUOTED", orders: [{ value: 8_500_000, hasComplaint: true, createdAt: dayAgo(10) }], msgs: [{ direction: "INBOUND", content: "harga berapa", createdAt: minAgo(200) }] }));
  const a = f(), b = f();
  assert.deepEqual({ h: a.health.score, p: a.priority.score, o: a.opportunity.score }, { h: b.health.score, p: b.priority.score, o: b.opportunity.score });
});
