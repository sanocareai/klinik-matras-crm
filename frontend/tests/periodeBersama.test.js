// Periode bersama antar tab/halaman Finance (lib/periodeBersama.js): berbagi, bertahan selama sesi, kembali ke bulan berjalan di hari berikutnya, tahan data rusak.
import test from "node:test";
import assert from "node:assert/strict";
import { buatPenyimpanPeriode, periodeBulanIni, hariWIB } from "../src/lib/periodeBersama.js";

const memori = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), _m: m }; };
const jamTetap = (iso) => { let t = new Date(iso); return { jam: () => t, maju: (iso2) => { t = new Date(iso2); } }; };

test("bawaan = bulan berjalan menurut WIB (termasuk batas bulan/UTC)", () => {
  assert.deepEqual(periodeBulanIni(new Date("2026-11-08T05:00:00Z")), { from: "2026-11-01", to: "2026-11-30" });
  // 31 Okt 20:00 UTC = 1 Nov 03:00 WIB → sudah November
  assert.deepEqual(periodeBulanIni(new Date("2026-10-31T20:00:00Z")), { from: "2026-11-01", to: "2026-11-30" });
  assert.equal(hariWIB(new Date("2026-10-31T20:00:00Z")), "2026-11-01");
  assert.deepEqual(periodeBulanIni(new Date("2026-02-10T00:00:00Z")), { from: "2026-02-01", to: "2026-02-28" });
});

test("dua pembaca melihat periode yang sama dan pendengar diberi tahu saat berganti", () => {
  const j = jamTetap("2026-11-08T05:00:00Z"); const s = buatPenyimpanPeriode({ jam: j.jam, penyimpanan: memori() });
  let dipanggil = 0; const lepas = s.langganan(() => { dipanggil++; });
  s.setel({ from: "2026-10-01", to: "2026-10-31" });
  assert.deepEqual(s.ambil(), { from: "2026-10-01", to: "2026-10-31" }); assert.equal(dipanggil, 1);
  lepas(); s.setel({ from: "2026-09-01", to: "2026-09-30" }); assert.equal(dipanggil, 1, "pendengar yang dilepas tidak dipanggil");
});

test("objek yang sama dikembalikan selama tidak berubah; menyetel nilai yang sama tidak memberi tahu pendengar", () => {
  const j = jamTetap("2026-11-08T05:00:00Z"); const s = buatPenyimpanPeriode({ jam: j.jam });
  const a = s.ambil(); assert.equal(s.ambil(), a);
  let n = 0; s.langganan(() => n++); s.setel({ from: a.from, to: a.to }); assert.equal(n, 0); assert.equal(s.ambil(), a);
});

test("bertahan selama hari yang sama (muat ulang memakai penyimpanan), kembali ke bulan berjalan di hari berikutnya", () => {
  const st = memori(); const j = jamTetap("2026-11-08T05:00:00Z");
  const s1 = buatPenyimpanPeriode({ jam: j.jam, penyimpanan: st }); s1.setel({ from: "2026-10-01", to: "2026-10-15" });
  const s2 = buatPenyimpanPeriode({ jam: j.jam, penyimpanan: st }); // "muat ulang"
  assert.deepEqual(s2.ambil(), { from: "2026-10-01", to: "2026-10-15" });
  j.maju("2026-11-09T05:00:00Z"); // hari berikutnya, tanpa muat ulang
  assert.deepEqual(s2.ambil(), { from: "2026-11-01", to: "2026-11-30" });
  const s3 = buatPenyimpanPeriode({ jam: j.jam, penyimpanan: st }); // muat ulang di hari baru
  assert.deepEqual(s3.ambil(), { from: "2026-11-01", to: "2026-11-30" });
});

test("data tersimpan rusak/tidak masuk akal diabaikan; penyimpanan yang melempar galat tidak menjatuhkan", () => {
  const j = jamTetap("2026-11-08T05:00:00Z"); const bawaan = { from: "2026-11-01", to: "2026-11-30" };
  for (const mentah of ["{bukan json", JSON.stringify({ hari: "2026-11-08", from: "x", to: "y" }), JSON.stringify({ hari: "2026-11-08", from: "2026-11-30", to: "2026-11-01" }), JSON.stringify({ hari: "2026-11-07", from: "2026-10-01", to: "2026-10-31" })]) {
    const st = memori(); st.setItem("periode-finance:v1", mentah);
    assert.deepEqual(buatPenyimpanPeriode({ jam: j.jam, penyimpanan: st }).ambil(), bawaan, mentah);
  }
  const rusak = { getItem() { throw new Error("dilarang"); }, setItem() { throw new Error("penuh"); } };
  const s = buatPenyimpanPeriode({ jam: j.jam, penyimpanan: rusak });
  assert.doesNotThrow(() => s.setel({ from: "2026-10-01", to: "2026-10-31" }));
  assert.deepEqual(s.ambil(), { from: "2026-10-01", to: "2026-10-31" });
});

test("masukan tidak sah (tanpa tanggal, terbalik) tidak menimpa periode", () => {
  const s = buatPenyimpanPeriode({ jam: jamTetap("2026-11-08T05:00:00Z").jam }); const awal = s.ambil();
  for (const x of [null, {}, { from: null, to: null }, { from: "2026-11-30", to: "2026-11-01" }, { from: "2026/11/01", to: "2026/11/30" }]) s.setel(x);
  assert.equal(s.ambil(), awal);
});

test("semua halaman Finance berperiode memakai penyimpan bersama (tidak ada useState(periodeDefault) tersisa)", async () => {
  const fs = await import("node:fs"); const path = await import("node:path"); const { fileURLToPath } = await import("node:url");
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/pages/finance");
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".jsx"))) {
    const src = fs.readFileSync(path.join(dir, f), "utf8");
    assert.ok(!/useState\(periodeDefault/.test(src), `${f} masih menyimpan periode sendiri`);
  }
});
