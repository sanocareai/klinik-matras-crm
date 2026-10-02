// MUTASI REKENING + REKENING PADA JURNAL MANUAL — kontrak UI (2 Okt 2026). Angka dari server; logika murni dites di sini, pemasangan dites lewat pembacaan berkas.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { urutkanRekening, pilihanAwal, arahBaris } from "../src/features/finance/mutasiRekeningLogic.js";
import { rekeningUntukAkun, butuhRekening, rekeningBarisValid } from "../src/features/finance/jurnalRekeningLogic.js";

const akar = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baca = (p) => fs.readFileSync(path.join(akar, p), "utf8").split("\r\n").join("\n");

const REK = [
  { id: "k", name: "Uang Kas Sano", kind: "KAS", active: true, accountId: "A-KAS" },
  { id: "p", name: "PT Sano", kind: "BANK", active: true, accountId: "A-BANK" },
  { id: "m", name: "KEM - Sano Bank", kind: "BANK", active: true, accountId: "A-BANK" },
  { id: "x", name: "Rekening Lama", kind: "BANK", active: false, accountId: "A-BANK" },
];

test("Pilihan rekening: hanya aktif, bank dulu (urut nama), kas tunai terakhir; awal = PT Sano", () => {
  assert.deepEqual(urutkanRekening(REK).map((r) => r.name), ["KEM - Sano Bank", "PT Sano", "Uang Kas Sano"]);
  assert.equal(pilihanAwal(REK), "p");
  assert.equal(pilihanAwal([{ id: "z", name: "Bank Lain", kind: "BANK", active: true }]), "z");
  assert.equal(pilihanAwal([]), "");
});

test("Arah baris dari server: masuk bila ada nilai masuk, selain itu keluar", () => {
  assert.equal(arahBaris({ masuk: "100.00", keluar: null }), "MASUK");
  assert.equal(arahBaris({ masuk: null, keluar: "5.00" }), "KELUAR");
});

test("Jurnal manual: baris akun kas/bank WAJIB rekening yang cocok dengan akunnya; akun biasa tidak butuh", () => {
  assert.equal(butuhRekening(REK, "A-BANK"), true);
  assert.equal(butuhRekening(REK, "A-MODAL"), false);
  assert.equal(butuhRekening(REK, ""), false);
  assert.deepEqual(rekeningUntukAkun(REK, "A-BANK").map((r) => r.id), ["p", "m", "x"]);
  assert.equal(rekeningBarisValid(REK, { accountId: "A-BANK", cashAccountId: "" }), false, "bank tanpa rekening ditolak");
  assert.equal(rekeningBarisValid(REK, { accountId: "A-BANK", cashAccountId: "k" }), false, "rekening kas pada akun bank ditolak");
  assert.equal(rekeningBarisValid(REK, { accountId: "A-BANK", cashAccountId: "p" }), true);
  assert.equal(rekeningBarisValid(REK, { accountId: "A-MODAL", cashAccountId: "" }), true);
  assert.equal(rekeningBarisValid(REK, { accountId: "", cashAccountId: "" }), true, "baris kosong dilewati");
});

test("Terpasang: tab Mutasi Rekening di Kas & Bank, komponen membaca API server dan export; form Jurnal Manual mengirim cashAccountId", () => {
  const cash = baca("src/pages/finance/FinanceCash.jsx");
  assert.match(cash, /key: "mutasi", label: "Mutasi Rekening"/);
  assert.match(cash, /<MutasiRekening rekening=\{semuaRekening\} periode=\{periode\} \/>/);
  const m = baca("src/features/finance/MutasiRekening.jsx");
  assert.match(m, /api\.getMutasiRekening\(/);
  assert.match(m, /<TombolExportExcel[\s\S]*modul="mutasi-rekening"/);
  assert.doesNotMatch(m, /\.reduce\(/, "tidak menjumlah saldo/total di klien");
  assert.match(m, /peringatan-\$\{p\.kode\}/, "peringatan server ditampilkan");
  assert.match(baca("src/api.js"), /getMutasiRekening: \(id, params = \{\}\) => request\(`\/finance\/buku\/rekening\/\$\{id\}\/mutasi/);
  const j = baca("src/pages/finance/FinanceJournal.jsx");
  assert.match(j, /\.\.\.\(b\.cashAccountId && \{ cashAccountId: b\.cashAccountId \}\)/);
  assert.match(j, /pilih-rekening-baris/);
});
