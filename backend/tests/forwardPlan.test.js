// Rencana forward pesan — kontak/lokasi tidak boleh lagi diperlakukan sebagai
// "media berupa file" (bug produksi 30 Sep 2026: forward kontak 502 berulang).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { rencanaForward, mimeDariNamaFile, captionForward } from "../src/utils/forwardPlan.js";

describe("rencanaForward — kontak", () => {
  test("kontak tanpa mediaUrl TIDAK diminta unduh ulang, dikirim sebagai vCard", () => {
    const content = JSON.stringify({ contacts: [{ name: "Teknisi Sano", phone: "+62 812-3456-789" }] });
    const r = rencanaForward({ mediaType: "contact", mediaUrl: null, content });
    assert.equal(r.kind, "contact");
    assert.deepEqual(r.contacts, [{ fullName: "Teknisi Sano", phoneNumber: "+628123456789", whatsappId: "628123456789" }]);
  });

  test("nomor berawalan 0 dibakukan ke 62, nomor luar negeri dibiarkan", () => {
    const content = JSON.stringify({ contacts: [
      { name: "A", phone: "0812 3456 789" },
      { name: "B", phone: "+966 50 123 4567" },
    ] });
    const r = rencanaForward({ mediaType: "contact", content });
    assert.equal(r.contacts[0].whatsappId, "628123456789");
    assert.equal(r.contacts[1].whatsappId, "966501234567");
  });

  test("kontak tanpa nomor menghasilkan error yang jelas, bukan JSON mentah", () => {
    const content = JSON.stringify({ contacts: [{ name: "Tanpa Nomor", phone: null }] });
    const r = rencanaForward({ mediaType: "contact", content });
    assert.equal(r.kind, "error");
  });

  test("content kontak rusak tidak membuat crash", () => {
    assert.equal(rencanaForward({ mediaType: "contact", content: "bukan json" }).kind, "error");
  });
});

describe("rencanaForward — lokasi & poll", () => {
  test("lokasi dikirim sebagai lokasi, bukan teks JSON", () => {
    const content = JSON.stringify({ lat: -6.4018, lng: 106.8, name: "Showroom", address: null });
    const r = rencanaForward({ mediaType: "location", content });
    assert.deepEqual(r, { kind: "location", lat: -6.4018, lng: 106.8, title: "Showroom" });
  });

  test("koordinat 0,0 itu sah (bukan falsy)", () => {
    const r = rencanaForward({ mediaType: "location", content: JSON.stringify({ lat: 0, lng: 0 }) });
    assert.equal(r.kind, "location");
  });

  test("lokasi tanpa koordinat → error", () => {
    assert.equal(rencanaForward({ mediaType: "location", content: JSON.stringify({ lat: null, lng: null }) }).kind, "error");
  });

  test("poll → error jelas", () => {
    assert.equal(rencanaForward({ mediaType: "poll", content: "{}" }).kind, "error");
  });
});

describe("rencanaForward — media berupa file", () => {
  test("media tanpa mediaUrl → perlu diunduh dulu", () => {
    assert.equal(rencanaForward({ mediaType: "video", mediaUrl: null, content: "[Video]" }).kind, "needsDownload");
  });

  test("MIME mengikuti ekstensi file, bukan dipatok per jenis", () => {
    const png = rencanaForward({ mediaType: "image", mediaUrl: "/uploads/1-a.png", content: "" });
    assert.equal(png.mimetype, "image/png");
    const pdf = rencanaForward({ mediaType: "document", mediaUrl: "/uploads/1-a.pdf", content: "" });
    assert.equal(pdf.mimetype, "application/pdf");
    assert.equal(pdf.sendAs, "document");
    const stiker = rencanaForward({ mediaType: "sticker", mediaUrl: "/uploads/1-a.webp", content: "[Stiker]" });
    assert.equal(stiker.mimetype, "image/webp");
  });

  test("placeholder [Video] tidak ikut terkirim sebagai caption, caption asli tetap", () => {
    assert.equal(captionForward("[Video]"), "");
    assert.equal(captionForward("  Ini katalog  "), "Ini katalog");
    const r = rencanaForward({ mediaType: "video", mediaUrl: "/uploads/x.mp4", content: "[Video]" });
    assert.equal(r.caption, "");
  });

  test("ekstensi tak dikenal jatuh ke tebakan per jenis", () => {
    assert.equal(mimeDariNamaFile("x.bin", "video"), "video/mp4");
    assert.equal(mimeDariNamaFile("x.bin", "document"), "application/octet-stream");
  });
});

describe("rencanaForward — teks", () => {
  test("teks biasa diteruskan apa adanya", () => {
    assert.deepEqual(rencanaForward({ content: "Halo kak" }), { kind: "text", text: "Halo kak" });
  });

  test("pesan kosong / tidak didukung → error", () => {
    assert.equal(rencanaForward({ content: "" }).kind, "error");
    assert.equal(rencanaForward({ content: "[Pesan tidak didukung]" }).kind, "error");
  });
});
