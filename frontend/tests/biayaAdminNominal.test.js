// BIAYA ADMIN IKUT NOMINAL (2 Okt 2026): daftar menampilkan TOTAL keluar rekening (nominal + biaya admin), rincian hanya di panel detail.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nominalTampil } from "../src/features/finance/biayaAdminLogic.js";

const akar = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baca = (p) => fs.readFileSync(path.join(akar, p), "utf8").split("\r\n").join("\n");

test("Tanpa biaya admin: nominal apa adanya; dengan biaya admin: total dari server, fallback jumlah nominal + biaya", () => {
  assert.deepEqual(nominalTampil({ amount: 100000 }), { nilai: 100000, adaBiaya: false, biaya: 0, amount: 100000 });
  assert.deepEqual(nominalTampil({ amount: 100000, transferFeeAmount: 0, totalKeluarRekening: 100000 }), { nilai: 100000, adaBiaya: false, biaya: 0, amount: 100000 });
  assert.equal(nominalTampil({ amount: 100000, biayaAdmin: 2500, totalKeluarRekening: 102500 }).nilai, 102500, "pakai total dari server");
  assert.equal(nominalTampil({ amount: 100000, transferFeeAmount: 2500 }).nilai, 102500, "fallback: nominal + biaya");
  assert.equal(nominalTampil({ amount: 5000000, feeAmount: 2500 }).nilai, 5002500, "transfer antar rekening memakai feeAmount");
  assert.equal(nominalTampil({ amount: 5000000, feeAmount: 2500 }).adaBiaya, true);
  assert.equal(nominalTampil(null).nilai, 0);
});

test("Terpasang di tujuh daftar (tabel dan kartu) dan rincian di panel detail; transfer tidak lagi punya kolom Biaya Admin sendiri", () => {
  for (const f of ["FinanceExpenses", "FinancePurchases", "FinanceKasbon", "FinanceUangMuka", "FinanceSuppliers", "FinanceReceivables", "FinanceCash"]) {
    const s = baca(`src/pages/finance/${f}.jsx`);
    assert.match(s, /import \{ NominalDenganBiaya, nominalTeks \} from "@\/features\/finance\/biayaAdminTampil\.jsx"/, f);
    assert.match(s, /<NominalDenganBiaya d=\{/, `${f}: sel nominal tabel`);
  }
  for (const f of ["FinanceExpenses", "FinancePurchases", "FinanceKasbon", "FinanceUangMuka", "FinanceReceivables"]) assert.match(baca(`src/pages/finance/${f}.jsx`), /nominalTeks\(/, `${f}: bidang kartu`);
  assert.doesNotMatch(baca("src/pages/finance/FinanceCash.jsx"), /<TH numeric width=\{112\} hideBelow="wide">Biaya Admin<\/TH>/);
  const spec = baca("src/features/finance/detailSpecs.js");
  assert.match(spec, /export function barisBiayaAdminPanel/);
  assert.match(spec, /\["Total keluar rekening", formatUang\(d\?\.totalKeluarRekening \?\? nominal \+ admin\)\]/);
  assert.match(spec, /rincianBiaya = barisBiayaAdminPanel\(r\)/, "panel otomatis juga memakai rincian");
  assert.doesNotMatch(baca("src/features/finance/biayaAdminTampil.jsx"), /\.reduce\(/, "tidak menjumlah di klien selain fallback dua angka server");
});
