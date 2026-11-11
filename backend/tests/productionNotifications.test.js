// Push SANSS Produksi: siapa dikabari saat kartu berpindah tim, dan sakelar mati = nol efek.
import test from "node:test";
import assert from "node:assert/strict";
import { denganNotifikasiPerpindahan, dispatchProductionNotification, notifikasiPerpindahan, productionPushEnabled } from "../src/services/productionNotifications.js";

const kartu = (o) => ({ runId: "r1", unitCode: "RES-12112026-004-U1", actor: "TABLE", wait: null, stepNo: 7, tableUserId: "meja", cornerUserId: "corner", ...o });

test("Meja → QC: semua QC_LEAD dikabari, membuka layar putusan QC, tanpa nama customer", () => {
  const [n, ...lain] = notifikasiPerpindahan(kartu({ actor: "TABLE" }), kartu({ actor: "QC", wait: "AWAITING_QC" }));
  assert.equal(lain.length, 0);
  assert.equal(n.ke, "QC_LEAD");
  assert.equal(n.title, "Siap QC");
  assert.equal(n.body, "004-U1 siap Uji Berat Badan.");
  assert.equal(n.data.path, "/qc/r1");
});

test("QC lulus → Corner: PIC Corner rencana; QC gagal → Meja: PIC Meja (rework)", () => {
  const [c] = notifikasiPerpindahan(kartu({ actor: "QC" }), kartu({ actor: "CORNER" }));
  assert.equal(c.ke, "corner");
  assert.equal(c.data.path, "/unit/r1");
  const [m] = notifikasiPerpindahan(kartu({ actor: "QC" }), kartu({ actor: "TABLE" }));
  assert.equal(m.ke, "meja");
  assert.equal(m.title, "QC gagal — rework");
});

test("Tanpa perpindahan tim / tanpa PIC / ringkasan hilang → tidak ada notifikasi", () => {
  assert.deepEqual(notifikasiPerpindahan(kartu({ stepNo: 3 }), kartu({ stepNo: 4 })), []);
  assert.deepEqual(notifikasiPerpindahan(kartu({ actor: "QC" }), kartu({ actor: "CORNER", cornerUserId: null })), []);
  assert.deepEqual(notifikasiPerpindahan(null, kartu({ actor: "QC" })), []);
  assert.deepEqual(notifikasiPerpindahan(kartu({ actor: "QC" }), null), []);
  // Meja → Meja lewat Corner? Hanya kembali-dari-QC yang dikabarkan ke Meja (bukan setiap kali giliran Meja).
  assert.deepEqual(notifikasiPerpindahan(kartu({ actor: "WAREHOUSE" }), kartu({ actor: "TABLE" })), []);
});

test("Sakelar mati (bawaan): perintah dijalankan apa adanya TANPA menyentuh database; dispatch dilewati", async () => {
  const lama = process.env.PRODUCTION_PUSH_ENABLED;
  delete process.env.PRODUCTION_PUSH_ENABLED;
  try {
    assert.equal(productionPushEnabled(), false);
    const dbPerangkap = new Proxy({}, { get() { throw new Error("database tidak boleh disentuh saat push mati"); } });
    const hasil = await denganNotifikasiPerpindahan("r1", "u", async () => ({ ok: true }), dbPerangkap);
    assert.deepEqual(hasil, { ok: true });
    const d = await dispatchProductionNotification({ userIds: ["a"], title: "x", body: "y", db: dbPerangkap });
    assert.equal(d.dilewati, "push_nonaktif");
  } finally {
    if (lama === undefined) delete process.env.PRODUCTION_PUSH_ENABLED; else process.env.PRODUCTION_PUSH_ENABLED = lama;
  }
});

test("Perintah yang gagal tetap melempar galatnya (push tidak menelan galat perintah)", async () => {
  await assert.rejects(denganNotifikasiPerpindahan("r1", "u", async () => { throw new Error("STEP_REVISION_CONFLICT"); }), /STEP_REVISION_CONFLICT/);
});
