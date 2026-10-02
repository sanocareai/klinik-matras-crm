// Klaim Lunas dari chat — logika sambungan (pesan chat → berkas → draf + bukti). Tanpa DB: dependensi disuntik.
// Aturan klaim sendiri (gerbang, status, nominal) dites di tests/integration/klaimLunas.integration.test.js.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { namaBerkasUpload, bisaJadiBukti, lampirkanDariPesan, kandidatOrderDariPesan } from "../src/services/finance/klaimDariChat.js";

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
const HEIC_PALSU = Buffer.concat([Buffer.from("....ftypheic"), Buffer.alloc(64, 2)]);

describe("namaBerkasUpload", () => {
  test("menerima /uploads/<nama> yang wajar", () => {
    assert.equal(namaBerkasUpload("/uploads/1790858132239-8ioos9kha2o.jpg"), "1790858132239-8ioos9kha2o.jpg");
  });
  test("menolak path traversal, bertingkat, URL luar, dan kosong", () => {
    for (const bad of ["/uploads/../.env", "/uploads/a/b.jpg", "/uploads/..%2f.env", "http://x/uploads/a.jpg", "uploads/a.jpg", "", null, undefined, "/uploads/", "/media/products/a.jpg", "/uploads/a.jpg?x=1"]) {
      assert.equal(namaBerkasUpload(bad), null, String(bad));
    }
  });
});

describe("bisaJadiBukti", () => {
  test("foto & dokumen yang berkasnya ada = boleh; stiker/video/kontak/lokasi/teks = tidak", () => {
    assert.equal(bisaJadiBukti({ mediaType: "image", mediaUrl: "/uploads/a.jpg" }), true);
    assert.equal(bisaJadiBukti({ mediaType: "document", mediaUrl: "/uploads/a.pdf" }), true);
    for (const t of ["sticker", "video", "audio", "contact", "location", "poll", null]) {
      assert.equal(bisaJadiBukti({ mediaType: t, mediaUrl: "/uploads/a.jpg" }), false, String(t));
    }
    assert.equal(bisaJadiBukti({ mediaType: "image", mediaUrl: null }), false);
    assert.equal(bisaJadiBukti(null), false);
  });
});

// ── lampirkanDariPesan ──────────────────────────────────────────────────────────────────────────────────────────────
function buatDb({ pesan, order } = {}) {
  return {
    message: { findUnique: async () => (pesan === undefined ? PESAN : pesan) },
    order: { findUnique: async () => (order === undefined ? { id: "ord1", customerId: "cust1" } : order) },
  };
}
const PESAN = {
  id: "msg-123456", mediaType: "image", mediaUrl: "/uploads/foto.jpg", direction: "INBOUND",
  createdAt: new Date("2026-10-02T03:30:00Z"), conversation: { customerId: "cust1", type: "INDIVIDUAL" },
};
function buatDeps(ekstra = {}) {
  const log = { draft: [], simpan: [], lampir: [], hapus: [] };
  return {
    log,
    deps: {
      uploadsDir: "/data/uploads",
      bacaBerkas: (p) => { log.baca = p; return JPEG; },
      buatDraft: async (db, a) => { log.draft.push(a); return { klaim: { id: "klaim-1" }, dibuatBaru: true }; },
      simpanBerkas: (b) => { log.simpan.push(b); return { storedName: "abc.jpg", originalName: b.originalname, mimeType: "image/jpeg", sizeBytes: b.buffer.length, sha256: "h" }; },
      lampirkanBukti: async (db, a) => { log.lampir.push(a); return { bukti: { id: "e1", nama: "foto.jpg" }, duplikat: false }; },
      hapusBerkasDisk: (n) => log.hapus.push(n),
      ...ekstra,
    },
  };
}
const USER = { id: "u1", name: "Sales" };

describe("lampirkanDariPesan", () => {
  test("alur normal: draf (saran Transfer + tanggal WIB pesan) lalu bukti dilampirkan", async () => {
    const { log, deps } = buatDeps();
    const r = await lampirkanDariPesan(buatDb(), { orderId: "ord1", messageId: "msg-123456", user: USER }, deps);
    assert.equal(r.klaimId, "klaim-1");
    assert.equal(r.dibuatBaru, true);
    assert.equal(r.duplikat, false);
    assert.equal(log.baca.replace(/\\/g, "/"), "/data/uploads/foto.jpg");
    assert.deepEqual(log.draft[0].data, { method: "TRANSFER", paymentDate: "2026-10-02" });
    assert.equal(log.lampir[0].claimId, "klaim-1");
    assert.deepEqual(log.hapus, []);
  });

  test("tanggal pesan dibaca dalam WIB (22.30 UTC = hari berikutnya di WIB)", async () => {
    const { log, deps } = buatDeps();
    const pesan = { ...PESAN, createdAt: new Date("2026-10-01T22:30:00Z") };
    await lampirkanDariPesan(buatDb({ pesan }), { orderId: "ord1", messageId: "msg-123456", user: USER }, deps);
    assert.equal(log.draft[0].data.paymentDate, "2026-10-02");
  });

  test("foto dari chat pelanggan LAIN ditolak 403, tidak ada draf/berkas dibuat", async () => {
    const { log, deps } = buatDeps();
    const db = buatDb({ order: { id: "ord1", customerId: "cust-lain" } });
    await assert.rejects(lampirkanDariPesan(db, { orderId: "ord1", messageId: "msg-123456", user: USER }, deps), (e) => e.statusCode === 403 && e.code === "PESAN_BUKAN_MILIK_ORDER");
    assert.equal(log.draft.length, 0);
    assert.equal(log.simpan.length, 0);
  });

  test("pesan grup (tanpa customer) ditolak", async () => {
    const { deps } = buatDeps();
    const pesan = { ...PESAN, conversation: { customerId: null, type: "GROUP" } };
    await assert.rejects(lampirkanDariPesan(buatDb({ pesan }), { orderId: "ord1", messageId: "msg-123456", user: USER }, deps), (e) => e.code === "PESAN_BUKAN_CHAT_PELANGGAN");
  });

  test("pesan yang bukan foto/PDF ditolak", async () => {
    const { deps } = buatDeps();
    const pesan = { ...PESAN, mediaType: "video" };
    await assert.rejects(lampirkanDariPesan(buatDb({ pesan }), { orderId: "ord1", messageId: "msg-123456", user: USER }, deps), (e) => e.code === "PESAN_BUKAN_BUKTI");
  });

  test("pesan / order tidak ada → 404", async () => {
    const { deps } = buatDeps();
    await assert.rejects(lampirkanDariPesan(buatDb({ pesan: null }), { orderId: "ord1", messageId: "msg-123456", user: USER }, deps), (e) => e.statusCode === 404);
    await assert.rejects(lampirkanDariPesan(buatDb({ order: null }), { orderId: "ord1", messageId: "msg-123456", user: USER }, deps), (e) => e.code === "ORDER_TIDAK_ADA");
  });

  test("id pesan aneh ditolak sebelum menyentuh DB", async () => {
    const { deps } = buatDeps();
    await assert.rejects(lampirkanDariPesan(buatDb(), { orderId: "ord1", messageId: "../../etc", user: USER }, deps), (e) => e.code === "PESAN_TIDAK_VALID");
  });

  test("berkas tidak ada di disk → 404 jelas, tidak membuat draf", async () => {
    const { log, deps } = buatDeps({ bacaBerkas: () => { const e = new Error("x"); e.code = "ENOENT"; throw e; } });
    await assert.rejects(lampirkanDariPesan(buatDb(), { orderId: "ord1", messageId: "msg-123456", user: USER }, deps), (e) => e.statusCode === 404 && e.code === "BERKAS_PESAN_TIDAK_ADA");
    assert.equal(log.draft.length, 0);
  });

  test("tipe tidak diizinkan (mis. HEIC) ditolak SEBELUM draf dibuat", async () => {
    const { log, deps } = buatDeps({ bacaBerkas: () => HEIC_PALSU });
    await assert.rejects(lampirkanDariPesan(buatDb(), { orderId: "ord1", messageId: "msg-123456", user: USER }, deps), (e) => e.statusCode === 415);
    assert.equal(log.draft.length, 0);
  });

  test("berkas > 8 MB ditolak SEBELUM draf dibuat", async () => {
    const besar = Buffer.concat([JPEG, Buffer.alloc(8 * 1024 * 1024)]);
    const { log, deps } = buatDeps({ bacaBerkas: () => besar });
    await assert.rejects(lampirkanDariPesan(buatDb(), { orderId: "ord1", messageId: "msg-123456", user: USER }, deps), (e) => e.statusCode === 413);
    assert.equal(log.draft.length, 0);
  });

  test("bukti duplikat: salinan baru dihapus dari disk, hasil duplikat=true", async () => {
    const { log, deps } = buatDeps({ lampirkanBukti: async () => ({ bukti: { id: "e0" }, duplikat: true }) });
    const r = await lampirkanDariPesan(buatDb(), { orderId: "ord1", messageId: "msg-123456", user: USER }, deps);
    assert.equal(r.duplikat, true);
    assert.deepEqual(log.hapus, ["abc.jpg"]);
  });

  test("gagal mencatat bukti: berkas yang sudah ditulis dibersihkan, galat diteruskan", async () => {
    const { log, deps } = buatDeps({ lampirkanBukti: async () => { const e = new Error("klaim sudah diajukan"); e.statusCode = 409; throw e; } });
    await assert.rejects(lampirkanDariPesan(buatDb(), { orderId: "ord1", messageId: "msg-123456", user: USER }, deps), (e) => e.statusCode === 409);
    assert.deepEqual(log.hapus, ["abc.jpg"]);
  });

  test("gagal membuat draf (mis. gerbang MATI / order lunas): tidak ada berkas ditulis", async () => {
    const { log, deps } = buatDeps({ buatDraft: async () => { const e = new Error("belum aktif"); e.statusCode = 403; throw e; } });
    await assert.rejects(lampirkanDariPesan(buatDb(), { orderId: "ord1", messageId: "msg-123456", user: USER }, deps), (e) => e.statusCode === 403);
    assert.equal(log.simpan.length, 0);
  });
});

// ── kandidatOrderDariPesan ──────────────────────────────────────────────────────────────────────────────────────────
describe("kandidatOrderDariPesan", () => {
  test("mengembalikan order pelanggan dengan status klaim dari aturan klaim (bukan tebakan sendiri)", async () => {
    let where;
    const db = {
      message: { findUnique: async () => PESAN },
      order: { findMany: async (q) => { where = q.where; return [
        { id: "o1", orderNumber: "RES-1", category: "LAYANAN", status: "PICKUP", paymentStatus: "BELUM", value: 1000000, createdAt: new Date() },
        { id: "o2", orderNumber: "NEW-2", category: "BARU", status: "DELIVERED", paymentStatus: "LUNAS", value: 2000000, createdAt: new Date() },
      ]; } },
    };
    const klaimUntukOrder = async (_db, { orderId }) => (orderId === "o1"
      ? { tagihan: 1000000, dibayar: 0, sisa: 1000000, bolehDiklaim: true, alasanTidakBisa: null, klaimAktifId: null }
      : { tagihan: 2000000, dibayar: 2000000, sisa: 0, bolehDiklaim: false, alasanTidakBisa: "Order ini sudah tercatat lunas oleh pembayaran terverifikasi", klaimAktifId: null });
    const r = await kandidatOrderDariPesan(db, { messageId: "msg-123456", user: USER }, { klaimUntukOrder });
    assert.equal(where.customerId, "cust1");
    assert.deepEqual(where.status, { not: "CANCELLED" });
    assert.equal(r.order.length, 2);
    assert.equal(r.order[0].bolehDiklaim, true);
    assert.equal(r.order[0].sisa, 1000000);
    assert.equal(r.order[1].bolehDiklaim, false);
    assert.match(r.order[1].alasanTidakBisa, /lunas/);
  });

  test("pesan non-bukti ditolak", async () => {
    const db = { message: { findUnique: async () => ({ ...PESAN, mediaType: "sticker" }) }, order: { findMany: async () => [] } };
    await assert.rejects(kandidatOrderDariPesan(db, { messageId: "msg-123456", user: USER }, {}), (e) => e.code === "PESAN_BUKAN_BUKTI");
  });
});
