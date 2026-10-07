// (1) Formulir "baru" Finance dikosongkan setiap dibuka — tanpa ini isian lama (mis. dropdown Supplier) tertinggal dan tersimpan salah (PUR-07102026-009: supplier YULIUS, dibeli dari EKA TUNGGAL).
// (2) Daftar/panel/formulir pembelian tidak lagi menyembunyikan "Dibeli dari" bila supplier terdaftar ada tetapi berbeda.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { namaBerkaitan, pihakPembelian, peringatanSupplierBeda } from "../src/features/finance/pembelianPihak.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const baca = (p) => fs.readFileSync(path.join(dir, p), "utf8");

const PLAN = {
  "FinanceCash.jsx": ["ModalRekening", "ModalTransfer", "ModalPemasukan"],
  "FinanceExpenses.jsx": ["ModalPengeluaran"],
  "FinanceJournal.jsx": ["ModalJurnalManual"],
  "FinanceKasbon.jsx": ["ModalKasbonBaru"],
  "FinancePengecualianLunas.jsx": ["ModalBaru"],
  "FinancePenjualanKaryawan.jsx": ["ModalPenjualanBaru"],
  "FinancePurchases.jsx": ["ModalPembelian"],
  "FinanceReceivables.jsx": ["ModalRefund"],
  "FinanceReconciliation.jsx": ["ModalPeriodeBaru", "ModalBarisBaru"],
  "FinanceSettings.jsx": ["ModalKategori"],
  "FinanceSuppliers.jsx": ["ModalSupplier", "ModalTagihan", "ModalBayarSupplier"],
  "FinanceUangMuka.jsx": ["ModalBerikan"],
};

test("SEMUA formulir 'baru' Finance dibungkus resetSaatBuka (tidak ada yang tertinggal)", () => {
  let n = 0;
  for (const [berkas, daftar] of Object.entries(PLAN)) {
    const s = baca(`../src/pages/finance/${berkas}`);
    assert.match(s, /import \{ resetSaatBuka \} from "@\/features\/finance\/resetSaatBuka\.jsx";/, berkas);
    for (const nama of daftar) {
      assert.match(s, new RegExp(`function ${nama}Isi\\(\\{ open,`), `${berkas}: ${nama} harus bernama ${nama}Isi`);
      assert.match(s, new RegExp(`const ${nama} = resetSaatBuka\\(${nama}Isi\\);`), `${berkas}: ${nama} belum dibungkus`);
      assert.doesNotMatch(s, new RegExp(`function ${nama}\\(\\{ open,`), `${berkas}: ${nama} masih fungsi asli`);
      n++;
    }
  }
  assert.equal(n, 17);
});

test("pencegahan regresi: tidak ada formulir Finance baru ber-prop open yang lolos tanpa pembungkus", () => {
  const dirHalaman = path.join(dir, "../src/pages/finance");
  const sisa = [];
  for (const f of fs.readdirSync(dirHalaman).filter((x) => x.endsWith(".jsx"))) {
    const s = baca(`../src/pages/finance/${f}`);
    for (const m of s.matchAll(/^function (Modal\w+)\(\{ open,/gm)) if (!/Isi$/.test(m[1])) sisa.push(`${f}: ${m[1]}`);
  }
  assert.deepEqual(sisa, [], "formulir ber-prop `open` harus dibungkus resetSaatBuka (atau di-key per pemakaian) — lihat features/finance/resetSaatBuka.jsx");
});

test("resetSaatBuka: me-mount ulang HANYA saat open false→true (kunci baru), tidak saat menutup; animasi tutup aman", () => {
  const s = baca("../src/features/finance/resetSaatBuka.jsx");
  assert.match(s, /sesi = open \? st\.sesi \+ 1 : st\.sesi;/);
  assert.match(s, /if \(open !== st\.open\)/);
  assert.match(s, /<Komponen key=\{sesi\} \{\.\.\.props\} \/>/);
});

test("namaBerkaitan: kosong = tidak bertentangan; saling memuat = berkaitan; beda = tidak", () => {
  assert.equal(namaBerkaitan("YULIUS", ""), true);
  assert.equal(namaBerkaitan("", "X"), true);
  assert.equal(namaBerkaitan("YULIUS", "yulius  - Toko Busa"), true);
  assert.equal(namaBerkaitan("PT ESA BUMINDO", "esa bumindo"), true);
  assert.equal(namaBerkaitan("YULIUS", "NELI SEUBELAN - EKA TUNGGAL"), false);
});

test("pihakPembelian: kasus PUR-07102026-009 menampilkan KEDUANYA; supplier+payee berkaitan hanya supplier; tanpa supplier payee; payee = penalang disembunyikan", () => {
  assert.deepEqual(pihakPembelian({ supplier: { name: "YULIUS" }, payeeName: "NELI SEUBELAN - EKA TUNGGAL" }), { supplier: "YULIUS", dibeliDari: "NELI SEUBELAN - EKA TUNGGAL" });
  assert.deepEqual(pihakPembelian({ supplier: { name: "YULIUS" }, payeeName: "Yulius" }), { supplier: "YULIUS", dibeliDari: null });
  assert.deepEqual(pihakPembelian({ supplier: { name: "YULIUS" }, payeeName: null }), { supplier: "YULIUS", dibeliDari: null });
  assert.deepEqual(pihakPembelian({ supplier: null, payeeName: "TOKO SUMBER MAS" }), { supplier: null, dibeliDari: "TOKO SUMBER MAS" });
  assert.deepEqual(pihakPembelian({ supplier: null, payeeName: "Budi", reimburseTo: { name: "budi" } }), { supplier: null, dibeliDari: null });
  assert.deepEqual(pihakPembelian({}), { supplier: null, dibeliDari: null });
});

test("peringatanSupplierBeda: hanya bila supplier terpilih DAN 'Dibeli dari' berbeda", () => {
  const sup = [{ id: "s1", name: "YULIUS" }, { id: "s2", name: "HERI" }];
  assert.match(peringatanSupplierBeda(sup, { supplierId: "s1", payeeName: "NELI SEUBELAN - EKA TUNGGAL" }), /YULIUS.*NELI SEUBELAN/);
  assert.equal(peringatanSupplierBeda(sup, { supplierId: "s1", payeeName: "yulius" }), null);
  assert.equal(peringatanSupplierBeda(sup, { supplierId: "", payeeName: "NELI" }), null);
  assert.equal(peringatanSupplierBeda(sup, { supplierId: "s1", payeeName: "  " }), null);
  assert.equal(peringatanSupplierBeda(sup, { supplierId: "tak-ada", payeeName: "X" }), null);
});

test("halaman Pembelian, panel rincian & export memakai logika dua-pihak", () => {
  const h = baca("../src/pages/finance/FinancePurchases.jsx");
  assert.match(h, /pihakPembelian\(p\)/);
  assert.match(h, /data-testid="dibeli-dari"/);
  assert.match(h, /data-testid="peringatan-supplier-beda"/);
  // peringatan di FOOTER (selalu terlihat), bukan di badan dialog yang bisa di-scroll
  const mulai = h.indexOf("footer={", h.indexOf("function ModalPembelianIsi"));
  const footer = h.slice(mulai, h.indexOf("Ajukan", mulai));
  assert.match(footer, /peringatan-supplier-beda/);
  const d = baca("../src/features/finance/detailSpecs.js");
  assert.match(d, /\["Dibeli dari", d\.payeeName\.trim\(\)\]/);
});
