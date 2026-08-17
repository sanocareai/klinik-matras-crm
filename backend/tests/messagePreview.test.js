// Pratinjau pesan terakhir di daftar percakapan.
//
// Fokus tes: lokasi/kontak/poll menyimpan JSON MENTAH di `content`, jadi
// pratinjau TIDAK BOLEH memakai isi content apa adanya — itu membuat daftar
// percakapan menampilkan `{"lat":...}` sebagai "pesan terakhir".
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildMessagePreview } from "../src/utils/messagePreview.js";

describe("buildMessagePreview", () => {
  test("lokasi tidak pernah membocorkan JSON mentah", () => {
    const content = JSON.stringify({ lat: -6.4018, lng: 106.8, name: "Showroom", address: null });
    assert.equal(buildMessagePreview(content, "location"), "[Lokasi]");
  });

  test("kontak tidak pernah membocorkan JSON mentah", () => {
    const content = JSON.stringify({ contacts: [{ name: "Teknisi Sano", phone: "628518728390" }] });
    assert.equal(buildMessagePreview(content, "contact"), "[Kontak]");
  });

  test("poll tidak pernah membocorkan JSON mentah", () => {
    assert.equal(buildMessagePreview('{"name":"Pilih ukuran"}', "poll"), "[Polling]");
  });

  test("teks biasa tetap ditampilkan apa adanya", () => {
    assert.equal(buildMessagePreview("Selamat sore ibu", null), "Selamat sore ibu");
  });

  test("caption foto menang atas label [Foto]", () => {
    assert.equal(buildMessagePreview("kasur king koil", "image"), "kasur king koil");
  });

  test("media tanpa caption jatuh ke label tipe", () => {
    assert.equal(buildMessagePreview("", "image"), "[Foto]");
    assert.equal(buildMessagePreview(null, "audio"), "[VN]");
    assert.equal(buildMessagePreview("", "document"), "[Dokumen]");
  });

  test("teks panjang dipotong dengan elipsis", () => {
    const hasil = buildMessagePreview("a".repeat(200), null);
    assert.equal(hasil.length, 81); // 80 + "…"
    assert.ok(hasil.endsWith("…"));
  });
});
