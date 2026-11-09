import test from "node:test";
import assert from "node:assert/strict";
import { ambilRingkasan, susunPesanGagal } from "../src/services/attribution/composioMetaNotif.js";

test("ringkasan mengambil baris JSON terakhir", () => {
  const r = ambilRingkasan('log awal\n{"status":"GAGAL","failureCode":"RATE_LIMIT","checkpoint":"2026-11-07"}\n');
  assert.deepEqual(r, { status: "GAGAL", kode: "RATE_LIMIT", checkpoint: "2026-11-07" });
});
test("keluaran rusak atau kosong tetap menghasilkan pesan", () => {
  assert.deepEqual(ambilRingkasan("Error: docker mati"), { status: null, kode: null, checkpoint: null });
  const p = susunPesanGagal({ tahap: "commit", rc: 2, keluaran: "", waktu: "t" });
  assert.match(p.subject, /TANPA_STATUS/);
});
test("teks mentah dan rahasia tidak ikut ke email", () => {
  const rahasia = "ak_rahasia123";
  const keluaran = JSON.stringify({ status: "GAGAL", failureCode: `token ${rahasia}`, kode: "x y", checkpoint: rahasia, pesan: rahasia });
  const p = susunPesanGagal({ tahap: "commit", rc: 2, keluaran, waktu: "t" });
  assert.ok(!p.subject.includes(rahasia));
  assert.ok(!p.text.includes(rahasia));
  assert.match(p.subject, /Sync Meta gagal: GAGAL$/);
});
test("kode status dan galat tampil di subjek", () => {
  const p = susunPesanGagal({ tahap: "verify", rc: 3, keluaran: '{"status":"BELUM_TERVERIFIKASI"}', waktu: "t" });
  assert.equal(p.subject, "[SANSS] Sync Meta gagal: BELUM_TERVERIFIKASI");
  assert.match(p.text, /Tahap: verify/);
});
