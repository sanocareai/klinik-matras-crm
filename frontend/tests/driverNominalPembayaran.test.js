// Layar driver: driver TIDAK lagi mencatat pembayaran (keputusan Owner 7 Okt 2026, setelah kasus "Rp1" tunai 6 Okt). Layar hanya menampilkan pembayaran yang sudah tercatat + pengingat
// melapor ke Sales; server menolak 403 PEMBAYARAN_BUKAN_UNTUK_DRIVER (backend/tests/integration/armadaNominalPembayaran.integration.test.js).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const baca = (p) => fs.readFileSync(path.join(dir, p), "utf8");

test("DriverJobs: tombol/formulir 'Catat Pembayaran' dihapus; hanya daftar pembayaran + pengingat lapor ke Sales", () => {
  const s = baca("../src/pages/DriverJobs.jsx");
  const bagian = s.slice(s.indexOf("function PaymentSection"), s.indexOf("const FAIL_REASONS_PICKUP"));
  assert.match(bagian, /data-testid="driver-tanpa-catat-bayar"/);
  assert.match(bagian, /laporkan ke Sales/);
  assert.doesNotMatch(bagian, /submitOrQueue|handleSave|Catat Pembayaran|<input|window\.confirm/, "tidak ada lagi jalur kirim pembayaran dari layar driver");
  assert.match(s, /<PaymentSection job=\{job\}/);
});

test("rute server menolak driver: izin pencatat uang wajib (PAYMENT_WRITE atau ORDER_PRICE_READ)", () => {
  const s = fs.readFileSync(path.join(dir, "../../backend/src/routes/armada.js"), "utf8");
  assert.match(s, /hasAnyPermission\(req\.user, \[P\.PAYMENT_WRITE, P\.ORDER_PRICE_READ\]\)/);
  assert.match(s, /PEMBAYARAN_BUKAN_UNTUK_DRIVER/);
});
