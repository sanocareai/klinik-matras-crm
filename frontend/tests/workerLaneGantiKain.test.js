// P12B — aplikasi Meja/Corner (WorkerLane) harus menampilkan Layanan Sales dan peringatan Ganti Kain sampai PIC produksi.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
// P12C: kartu & detail ada di src/features/production/workerApp/* (sumber gabungan dengan WorkerLane.jsx).
const WA = path.join(here, "..", "src", "features", "production", "workerApp");
const SRC = [path.join(here, "..", "src", "pages", "produksi", "WorkerLane.jsx"), ...fs.readdirSync(WA).filter((n) => /\.(jsx?|css)$/.test(n)).map((n) => path.join(WA, n))].map((p) => fs.readFileSync(p, "utf8")).join("\n");

test("WorkerLane: Layanan Sales selalu tampil; Ganti Kain = kotak peringatan oranye (dikenali dari layanan Sales), catatan kosong → konfirmasi ke Sales", () => {
  assert.match(SRC, /data-testid="layanan-sales"/);
  assert.match(SRC, /Layanan Sales: /);
  assert.match(SRC, /belum dicatat Sales/);
  assert.ok(SRC.includes("isGantiKain(view)"), "dikenali dari layanan Sales (model), bukan teks bebas");
  assert.match(SRC, /data-testid="ganti-kain-note"/);
  assert.ok(SRC.includes("Ganti Kain — pastikan sesuai permintaan customer"));
  assert.ok(SRC.includes("Catatan kain belum tersedia — konfirmasi ke Sales"));
  assert.ok(!/orderValue|formatRupiah/.test(SRC), "tanpa harga");
});
