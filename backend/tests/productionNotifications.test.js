// Push SANSS Produksi: siapa dikabari saat kartu berpindah tim, dan sakelar mati = nol efek.
import test from "node:test";
import assert from "node:assert/strict";
import { denganNotifikasiPerpindahan, dispatchProductionNotification, kabariKomplainProduksi, notifikasiPerpindahan, pesanKomplainProduksi, productionPushEnabled, rolesWithPermission } from "../src/services/productionNotifications.js";

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

test("Komplain: penerima = peran pemegang izin penjadwalan (dari ROLE_PERMISSIONS), tanpa Sales", () => {
  const roles = rolesWithPermission("production_assignment:write");
  assert.ok(roles.includes("PRODUCTION_LEAD"));
  assert.ok(roles.includes("ADMIN"));
  assert.ok(!roles.includes("SALES"));
});

test("Komplain: pesan hanya bila ada unit di workshop; satu unit → buka kartunya, banyak → Target; tanpa nama customer", () => {
  assert.equal(pesanKomplainProduksi({ caseNumber: "KMP-1" }, []), null);
  const satu = pesanKomplainProduksi({ caseNumber: "KMP-1" }, [{ unitCode: "RES-12112026-004-U1", runId: "r1" }]);
  assert.equal(satu.data.path, "/unit/r1");
  assert.equal(satu.channelId, "penting");
  assert.match(satu.body, /^KMP-1: 004-U1 sedang di workshop/);
  const dua = pesanKomplainProduksi({ caseNumber: "KMP-2" }, [{ unitCode: "RES-12112026-004-U1", runId: "r1" }, { unitCode: "RES-12112026-004-U2", runId: "r2" }]);
  assert.equal(dua.data.path, "/target");
  assert.match(dua.body, /004-U1, 004-U2/);
});

test("Komplain: sakelar mati → tanpa query database", async () => {
  const lama = process.env.PRODUCTION_PUSH_ENABLED;
  delete process.env.PRODUCTION_PUSH_ENABLED;
  try {
    const dbPerangkap = new Proxy({}, { get() { throw new Error("database tidak boleh disentuh saat push mati"); } });
    assert.equal(await kabariKomplainProduksi({ orderId: "o1", caseNumber: "KMP-1" }, { db: dbPerangkap }), null);
  } finally { if (lama === undefined) delete process.env.PRODUCTION_PUSH_ENABLED; else process.env.PRODUCTION_PUSH_ENABLED = lama; }
});
