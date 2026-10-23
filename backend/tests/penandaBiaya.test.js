import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PEMBALIK_BEBAN_BERSIH, PEMBALIK_RETUR_BERSIH, PENANDA_PENYAJIAN, sifatBeban, sifatBarisBeban, RUMUS_LABA } from "../src/services/finance/penandaBiaya.js";

// Audit tanda laporan Finance (23 Okt 2026): satu sumber teks penanda pembalik beban bersih. Murni penyajian — tidak mengubah nilai/tanda ledger.
const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src");
const baca = (p) => readFileSync(path.join(SRC, p), "utf8").replace(/\r\n/g, "\n");

test("sifatBeban: negatif = pembalik beban bersih; nol dan positif = Beban", () => {
  assert.equal(sifatBeban(-1), PEMBALIK_BEBAN_BERSIH.label);
  assert.equal(sifatBeban(-11_372_248.5), PEMBALIK_BEBAN_BERSIH.label);
  assert.equal(sifatBeban(0), "Beban");
  assert.equal(sifatBeban(2_600_000), "Beban");
  assert.equal(sifatBeban("-3"), PEMBALIK_BEBAN_BERSIH.label, "nilai string desimal dari Prisma tetap dibaca");
});

test("sifatBarisBeban: baris kredit di akun biaya = pembalik; baris debit = beban", () => {
  assert.match(sifatBarisBeban(-5), /Pembalik beban/); assert.match(sifatBarisBeban(5), /Beban \(baris debit\)/);
});

test("teks penanda: menyebut 'mengurangi' biaya & 'menaikkan' laba, kurung, dan rumus laba tidak berubah", () => {
  assert.match(PEMBALIK_BEBAN_BERSIH.penjelasan, /mengurangi total biaya dan menaikkan laba/);
  assert.match(PEMBALIK_BEBAN_BERSIH.penjelasan, /dalam kurung/);
  assert.equal(RUMUS_LABA.startsWith("Laba Bersih = Pendapatan Bersih − Beban Pokok − Beban Operasional."), true);
  assert.match(PEMBALIK_RETUR_BERSIH.label, /retur/i);
  assert.equal(Object.isFrozen(PENANDA_PENYAJIAN) && Object.isFrozen(PEMBALIK_BEBAN_BERSIH), true, "sumber tunggal tidak boleh dimutasi");
});

test("jaga rumus: labaRugi tetap menghitung laba dari beban NETO bertanda (tanpa -abs / penyajian yang membalik tanda)", () => {
  const r = baca("services/finance/reports.js");
  assert.match(r, /const labaKotor = pendapatanBersih\.minus\(bebanPokok\)/);
  assert.match(r, /const labaBersih = labaKotor\.minus\(bebanOperasional\)/);
  assert.match(r, /if \(a\.type !== "PENDAPATAN" && nilai\.isNegative\(\)\) baris\.pembalikBebanBersih = true/);
});

test("laporan terinci: dibaca READ ONLY di database (SET TRANSACTION READ ONLY pernyataan pertama) dan tidak ada tulisan di folder laporanTerinci", () => {
  const idx = baca("services/finance/laporanTerinci/index.js");
  assert.match(idx, /SET TRANSACTION READ ONLY/);
  assert.match(idx, /const jalankan = jalankanBacaSaja/);
  for (const f of ["baris.js", "jembatan.js", "hpp.js", "bebanDivisi.js", "pkr.js", "gap.js"]) {
    const src = baca(`services/finance/laporanTerinci/${f}`);
    assert.doesNotMatch(src, /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(|\$executeRaw/, `${f} tidak boleh menulis`);
  }
});
