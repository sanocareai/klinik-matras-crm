// NILAI BERSIH ORDER di UI (Okt 2026) — helper + pengaman statis "jangan ada kasus Sofyan lagi".
// Nota Kredit/Keringanan adalah potongan resmi; nilai penjualan yang TAMPIL/DIJUMLAHKAN di UI = Order.value − Σ nota aktif. Tes ini memastikan helper benar dan memindai src agar
// tidak ada pembacaan order.value mentah baru untuk makna "nilai penjualan" di luar daftar pengecualian bertanda alasan.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nilaiBersihOrder, notaKreditOrder } from "../src/utils/nilaiBersih.js";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src");

test("nilaiBersihOrder: value − Σ orderCredits; angka 'notaKredit' dari server menang; tak pernah negatif; tanpa relasi = value", () => {
  assert.equal(nilaiBersihOrder({ value: 4_300_000, orderCredits: [{ amount: 200000 }] }), 4_100_000);
  assert.equal(nilaiBersihOrder({ value: 4_300_000, orderCredits: [{ amount: "100000.00" }, { amount: 100000 }] }), 4_100_000);
  assert.equal(nilaiBersihOrder({ value: 4_300_000, notaKredit: 200000 }), 4_100_000);
  assert.equal(nilaiBersihOrder({ value: 4_300_000 }), 4_300_000);
  assert.equal(nilaiBersihOrder({ value: 100, orderCredits: [{ amount: 500 }] }), 0);
  assert.equal(nilaiBersihOrder(null), 0);
  assert.equal(notaKreditOrder({ orderCredits: [] }), 0);
  assert.equal(notaKreditOrder({ notaKredit: 0, orderCredits: [{ amount: 5 }] }), 0, "field server menang");
});

/** file (relatif src) → alasan nilai KOTOR / angka dari API (sudah bersih) memang benar. */
const PENGECUALIAN = {
  "utils/format.js": "re-export helper",
  "utils/nilaiBersih.js": "definisi helper",
  "components/customer/OrderSection.jsx": "menampilkan Total item (kotor) lalu baris Potongan + Nilai bersih; nilai ringkas memakai nilaiBersihOrder",
  "features/orders/OrderTimelineDrawer.jsx": "blok Total item kotor + potongan + nilai bersih",
  "features/dashboard/components/RecentOrdersTable.jsx": "API /analytics/recent-orders mengirim value BERSIH",
  "features/inbox/components/ConversationList/TransferPickerPopover.jsx": "API orderTerdampak mengirim value BERSIH",
  "features/pipeline/components/OrderPipelineBoard.jsx": "API /pipeline/order-board mengirim value BERSIH (+ nilaiKotor)",
  "features/laporan/components/SalesReportTab.jsx": "API lunas-detail mengirim value BERSIH (+ nilaiKotor, notaKredit)",
  "features/finance/OrderPicker.jsx": "hasil pencarian API (value BERSIH dari server / saran dari komponen pemanggil yang sudah bersih)",
  "features/finance/KoreksiPembayaran.jsx": "saran order dari data pembayaran (atribut konteks)",
  "utils/orderReadiness.js": "guard 'harga sudah diisi' (value > 0), bukan nilai penjualan",
  "components/ui/badge-dropdown.jsx": "opsi dropdown (bukan order)",
  "features/production/components/StepForm.jsx": "opsi form (bukan order)",
};

function semuaFile(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...semuaFile(p));
    else if (/\.(jsx?|mjs)$/.test(e.name)) out.push(p);
  }
  return out;
}

test("pemindai: tidak ada penjumlahan/tampilan order.value mentah di luar pengecualian bertanda alasan", () => {
  const pelanggaran = [];
  for (const f of semuaFile(SRC)) {
    const rel = path.relative(SRC, f).replace(/\\/g, "/");
    if (rel in PENGECUALIAN) continue;
    fs.readFileSync(f, "utf8").replace(/\r\n/g, "\n").split("\n").forEach((baris, i) => {
      if (/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(baris)) return;
      if (/nilaiBersihOrder\(|notaKreditOrder\(/.test(baris)) return;
      // pola: order/o/ord .value yang dijumlah atau diformat sebagai rupiah
      const kena = /(reduce\([^)]*\b(?:o|ord|order)\.value\b)|(\+=?\s*\(?\s*(?:o|ord|order)\.value\b)|(formatRupiah(?:Short)?\(\s*(?:o|ord|order)\.value\b)|(formatUang\(\s*(?:o|ord|order)\.value\b)|(Nilai:\s*(?:o|ord|order)\.value\b)/;
      if (kena.test(baris)) pelanggaran.push(`${rel}:${i + 1}: ${baris.trim().slice(0, 130)}`);
    });
  }
  assert.deepEqual(pelanggaran, [],
    `Pakai nilaiBersihOrder(o) dari utils/format.js, atau daftarkan file di PENGECUALIAN dengan alasan:\n${pelanggaran.join("\n")}`);
});

test("pengecualian tidak basi (file masih ada)", () => {
  const ada = new Set(semuaFile(SRC).map((f) => path.relative(SRC, f).replace(/\\/g, "/")));
  assert.deepEqual(Object.keys(PENGECUALIAN).filter((f) => !ada.has(f)), []);
});
