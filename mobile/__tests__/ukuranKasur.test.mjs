// Ukuran Kasur Custom di aplikasi mobile: formatter/validasi identik dengan web, build/parse notes, aturan legacy, dan pemasangan di form + kartu order.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseAngkaCm, isUkuranCustom, formatUkuranKasur, validasiUkuranCustom } from "../src/utils/ukuranKasur.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const baca = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8").split("\r\n").join("\n");

// buildNotes/parseNotes dimuat dari SUMBER OrderFormModal.js (modul RN tidak bisa diimpor node).
const form = baca("src/components/OrderFormModal.js");
const potong = form.slice(form.indexOf("function buildNotes("), form.indexOf("// D-026 fix"));
const { buildNotes, parseNotes } = new Function("parseAngkaCm", "isUkuranCustom", potong + "\nreturn { buildNotes, parseNotes };")(parseAngkaCm, isUkuranCustom);

test("Formatter mobile: '145 × 205 cm (Custom)', '160 × 200 cm', legacy 'Ukuran Custom (ukuran belum diisi)'", () => {
  assert.equal(formatUkuranKasur({ ukuranKasur: "Ukuran Custom", ukuranLebarCm: 145, ukuranPanjangCm: 205 }), "145 × 205 cm (Custom)");
  assert.equal(formatUkuranKasur({ ukuranKasur: "160x200 cm (Queen)" }), "160 × 200 cm");
  assert.equal(formatUkuranKasur({ ukuranKasur: "Ukuran Custom" }), "Ukuran Custom (ukuran belum diisi)");
  assert.equal(formatUkuranKasur({ ukuranKasur: "" }), "");
});

test("Validasi mobile = web: 30–400 cm, maksimal satu desimal, pesan Indonesia", () => {
  assert.equal(validasiUkuranCustom({ lebar: "145,5", panjang: "205" }).ok, true);
  assert.equal(validasiUkuranCustom({ lebar: "30", panjang: "400" }).ok, true);
  assert.equal(validasiUkuranCustom({ lebar: "", panjang: "" }).galat.lebar, "Lebar (cm) wajib diisi.");
  assert.match(validasiUkuranCustom({ lebar: "29", panjang: "205" }).galat.lebar, /antara 30 dan 400 cm/);
  assert.match(validasiUkuranCustom({ lebar: "145", panjang: "401" }).galat.panjang, /antara 30 dan 400 cm/);
  assert.match(validasiUkuranCustom({ lebar: "12,34", panjang: "205" }).galat.lebar, /angka positif/);
});

test("buildNotes/parseNotes mobile: custom tersimpan terstruktur; standar membersihkan nilai custom; legacy tetap null; edit ulang mempertahankan angka", () => {
  const custom = buildNotes({ merkKasur: "Sano", ukuranKasur: "Ukuran Custom", ukuranLebarCm: "145,5", ukuranPanjangCm: "205", keluhanCustomer: "x" });
  const p = JSON.parse(custom);
  assert.equal(p.ukuranLebarCm, 145.5); assert.equal(p.ukuranPanjangCm, 205);
  assert.equal(formatUkuranKasur(parseNotes(custom)), "145,5 × 205 cm (Custom)");
  const standar = JSON.parse(buildNotes({ ukuranKasur: "160x200 cm (Queen)", ukuranLebarCm: "145", ukuranPanjangCm: "205" }));
  assert.equal("ukuranLebarCm" in standar, false); assert.equal("ukuranPanjangCm" in standar, false);
  const legacy = parseNotes(JSON.stringify({ ukuranKasur: "Ukuran Custom" }));
  assert.equal(legacy.ukuranLebarCm, null);
  assert.equal(formatUkuranKasur(legacy), "Ukuran Custom (ukuran belum diisi)");
  // custom tanpa angka valid TIDAK menulis kunci angka (server memperlakukannya sebagai legacy)
  assert.equal("ukuranLebarCm" in JSON.parse(buildNotes({ ukuranKasur: "Ukuran Custom", ukuranLebarCm: "", ukuranPanjangCm: "" })), false);
  const ulang = JSON.parse(buildNotes({ ...parseNotes(custom), keluhanCustomer: "baru" }));
  assert.equal(ulang.ukuranLebarCm, 145.5); assert.equal(ulang.keluhanCustomer, "baru");
});

test("Form order mobile: field Lebar/Panjang hanya untuk 'Ukuran Custom', dibersihkan saat pindah ke standar, wajib sebelum simpan, legacy boleh kosong bila ukuran tidak dipilih ulang", () => {
  assert.match(form, /import \{ isUkuranCustom, validasiUkuranCustom, parseAngkaCm \} from "\.\.\/utils\/ukuranKasur";/);
  assert.match(form, /if \(!isUkuranCustom\(u\)\) \{ setUkuranLebar\(""\); setUkuranPanjang\(""\); setUkuranPaksa\(false\); \}/);
  assert.match(form, /onSelect=\{pilihUkuran\}/);
  assert.match(form, /\{usesUkuranDropdown && isUkuranCustom\(ukuran\) \? \(\n\s+<UkuranCustomFields/);
  assert.match(form, /if \(usesUkuranDropdown && isUkuranCustom\(ukuran\)\) \{/);
  assert.match(form, /if \(!v\.ok && !\(ukuranBolehKosong && kosongSemua\)\) \{/);
  assert.match(form, /Alert\.alert\("Ukuran Custom belum lengkap"/);
  assert.equal((form.match(/ukuranLebarCm: ukuranLebar, ukuranPanjangCm: ukuranPanjang/g) || []).length, 2, "create + edit mengirim angka");
  assert.match(form, /return isUkuranCustom\(awal\.ukuranKasur\) && awal\.ukuranLebarCm === null && awal\.ukuranPanjangCm === null;/);
  assert.match(form, /setUkuran\(u\); setUkuranDisentuh\(true\);/);
  // label & pesan Bahasa Indonesia
  assert.match(form, /label: "Lebar \(cm\)"/); assert.match(form, /label: "Panjang \(cm\)"/);
  assert.match(form, /Data lama belum memiliki ukuran\. Boleh dikosongkan bila ukuran tidak diubah/);
  assert.doesNotMatch(form.slice(form.indexOf("function UkuranCustomFields"), form.indexOf("// Bottom-sheet pilih 1 opsi", form.indexOf("function UkuranCustomFields"))), /\b(Width|Length|Required|Invalid)\b/);
});

test("Kartu order mobile: chip ukuran memakai formatter bersama (bukan string mentah)", () => {
  const kartu = baca("src/components/OrderCard.js");
  assert.match(kartu, /import \{ formatUkuranKasur \} from "\.\.\/utils\/ukuranKasur";/);
  assert.match(kartu, /<Text style=\{styles\.chipStatic\}>\{formatUkuranKasur\(info\)\}<\/Text>/);
  assert.doesNotMatch(kartu, /styles\.chipStatic\}>\{info\.ukuranKasur\}/);
  assert.match(kartu, /ukuranLebarCm: p\.ukuranLebarCm \?\? null, ukuranPanjangCm: p\.ukuranPanjangCm \?\? null/);
});

test("Kompatibilitas OTA: tidak ada dependensi/konfigurasi native baru dan versi runtime tidak dinaikkan", () => {
  const app = JSON.parse(baca("app.json")).expo;
  assert.equal(app.version, "3.3.0", "runtimeVersion (policy appVersion) harus tetap 3.3.0 agar OTA menjangkau build terpasang");
  assert.equal(app.runtimeVersion.policy, "appVersion");
  assert.equal(app.android.versionCode, 22);
  const dir = path.join(__dirname, "..", "src", "utils", "ukuranKasur.js");
  const src = fs.readFileSync(dir, "utf8");
  assert.doesNotMatch(src, /^\s*import\s/m, "util murni tanpa impor (tidak menarik modul native)");
});
