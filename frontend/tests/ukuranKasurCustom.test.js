// Ukuran Kasur Custom (frontend): parse/build notes, formatter di setiap tampilan, form Buat/Edit Order, item Buat Resi, dan export Excel.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseAngkaCm, isUkuranCustom, formatUkuranKasur, formatUkuranLabel, validasiUkuranCustom } from "../src/utils/ukuranKasur.js";
import { galatForm, payloadResi, formKosong, itemKosong } from "../src/features/resi/logika.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const baca = (rel) => fs.readFileSync(path.join(__dirname, "..", "src", rel), "utf8").split("\r\n").join("\n");

// parseOrderNotes/buildOrderNotes dimuat dari SUMBER format.js (modul itu memakai alias '@/' sehingga tidak bisa diimpor langsung oleh node).
const fmt = baca("utils/format.js");
const potong = fmt.slice(fmt.indexOf("export function parseOrderNotes"), fmt.indexOf("// D-026 fix (20 Agustus 2026)")).replace(/export /g, "");
const { parseOrderNotes, buildOrderNotes } = new Function("parseAngkaCm", "isUkuranCustom", potong + "\nreturn { parseOrderNotes, buildOrderNotes };")(parseAngkaCm, isUkuranCustom);

test("Buat/parse notes: custom menyimpan Lebar/Panjang terstruktur; berpindah ke standar membersihkan nilai custom; legacy tanpa angka tetap null (tidak ditebak)", () => {
  const custom = buildOrderNotes({ merkKasur: "Sano", ukuranKasur: "Ukuran Custom", ukuranLebarCm: "145", ukuranPanjangCm: "205,5", keluhanCustomer: "x" });
  const p = JSON.parse(custom);
  assert.equal(p.ukuranLebarCm, 145); assert.equal(p.ukuranPanjangCm, 205.5);
  const balik = parseOrderNotes(custom);
  assert.equal(formatUkuranKasur(balik), "145 × 205,5 cm (Custom)");

  const standar = JSON.parse(buildOrderNotes({ ukuranKasur: "160x200 cm (Queen)", ukuranLebarCm: "145", ukuranPanjangCm: "205" }));
  assert.equal("ukuranLebarCm" in standar, false, "nilai custom tidak ikut tersimpan");
  assert.equal("ukuranPanjangCm" in standar, false);

  const legacy = parseOrderNotes(JSON.stringify({ ukuranKasur: "Ukuran Custom" }));
  assert.equal(legacy.ukuranLebarCm, null);
  assert.equal(formatUkuranKasur(legacy), "Ukuran Custom (ukuran belum diisi)");
  // custom tanpa angka valid TIDAK menuliskan kunci angka (server memperlakukan sebagai legacy, bukan galat)
  assert.equal("ukuranLebarCm" in JSON.parse(buildOrderNotes({ ukuranKasur: "Ukuran Custom", ukuranLebarCm: "", ukuranPanjangCm: "" })), false);
  // edit ulang mempertahankan angka (parse → build)
  const ulang = JSON.parse(buildOrderNotes({ ...parseOrderNotes(custom), keluhanCustomer: "baru" }));
  assert.equal(ulang.ukuranLebarCm, 145); assert.equal(ulang.keluhanCustomer, "baru");
});

test("Validasi form: pesan Bahasa Indonesia untuk kosong, non-angka, di luar batas", () => {
  assert.equal(validasiUkuranCustom({ lebar: "", panjang: "" }).galat.lebar, "Lebar (cm) wajib diisi.");
  assert.match(validasiUkuranCustom({ lebar: "x", panjang: "200" }).galat.lebar, /angka positif/);
  assert.match(validasiUkuranCustom({ lebar: "145", panjang: "1000" }).galat.panjang, /antara 30 dan 400 cm/);
  assert.equal(validasiUkuranCustom({ lebar: "145", panjang: "205" }).ok, true);
});

test("Buat Order & Edit Order: field Lebar/Panjang muncul HANYA untuk 'Ukuran Custom', dibersihkan saat pindah ke standar, wajib sebelum lanjut/simpan", () => {
  const s = baca("components/customer/OrderSection.jsx");
  assert.match(s, /import UkuranCustomFields from "\.\/UkuranCustomFields\.jsx"/);
  // dua form (edit + baru): dropdown memakai pilihUkuran yang membersihkan angka
  assert.equal((s.match(/function pilihUkuran\(u\)/g) || []).length, 2);
  assert.equal((s.match(/if \(!isUkuranCustom\(u\)\) \{ setUkuranLebar\(""\); setUkuranPanjang\(""\); setUkuranPaksa\(false\); \}/g) || []).length, 2);
  assert.equal((s.match(/value=\{ukuran\} onChange=\{pilihUkuran\}/g) || []).length, 2);
  assert.equal((s.match(/<UkuranCustomFields /g) || []).length, 2);
  assert.match(s, /\{isUkuranCustom\(ukuran\) && \(/, "form edit: tampil hanya bila custom");
  assert.match(s, /\{usesUkuranDropdown && isUkuranCustom\(ukuran\) && \(/, "form baru: tampil hanya bila custom");
  // validasi sebelum simpan (edit) dan sebelum lanjut/simpan (baru)
  assert.match(s, /async function handleSave\(\) \{\n\s+const ukuranKosongSemua = [^\n]+\n\s+if \(isUkuranCustom\(ukuran\) && !\(ukuranBolehKosong && ukuranKosongSemua\) && !validasiUkuranCustom\(\{ lebar: ukuranLebar, panjang: ukuranPanjang \}\)\.ok\) \{ setUkuranPaksa\(true\); return; \}/);
  // legacy (custom tanpa angka) yang ukurannya tidak dipilih ulang boleh disimpan tanpa angka; memilih ulang → angka wajib
  assert.match(s, /const ukuranBolehKosong = ukuranLegacyTanpaAngka && !ukuranDisentuh;/);
  assert.match(s, /setUkuran\(u\); setUkuranDisentuh\(true\);/);
  assert.match(s, /bolehKosong=\{ukuranBolehKosong\}/);
  assert.match(s, /if \(ukuranCustomTidakValid\) \{ setUkuranPaksa\(true\); return; \} setStep\(4\)/);
  assert.match(s, /if \(ukuranCustomTidakValid\) \{ setUkuranPaksa\(true\); setStep\(3\); return; \}/);
  // angka ikut ke notes di kedua jalur
  assert.equal((s.match(/ukuranLebarCm: ukuranLebar, ukuranPanjangCm: ukuranPanjang/g) || []).length, 2);
  // tampilan chip & pesan WA memakai formatter bersama
  assert.match(s, /`Ukuran: \$\{formatUkuranKasur\(info\) \|\| "-"\}`/);
  assert.match(s, /formatUkuranKasur\(info\) \|\| ukuran/);
});

test("Komponen UkuranCustomFields: label 'Lebar (cm)'/'Panjang (cm)', wajib, galat role=alert, tanpa teks Inggris", () => {
  const s = baca("components/customer/UkuranCustomFields.jsx");
  assert.match(s, /Lebar \(cm\)/); assert.match(s, /Panjang \(cm\)/);
  assert.match(s, /aria-required=\{bolehKosong \? undefined : "true"\}/); assert.match(s, /role="alert"/);
  assert.match(s, /bolehKosong/, "mode edit legacy: boleh kosong bila ukuran tidak diubah");
  assert.match(s, /validasiUkuranCustom/);
  assert.doesNotMatch(s, /\b(Width|Length|Required|Invalid|Submit)\b/);
});

test("Setiap item Buat Resi: pilih ukuran resmi, custom wajib Lebar/Panjang; galat per item; payload hanya membawa angka bila custom", () => {
  assert.equal(itemKosong().ukuran, ""); assert.equal(itemKosong().ukuranLebar, "");
  const form = (item) => ({ ...formKosong(), items: [{ ...itemKosong(), nominal: "1000000", ...item }] });
  assert.equal(galatForm(form({ ukuran: "Ukuran Custom", ukuranLebar: "", ukuranPanjang: "205" })), "Item 1: Lebar (cm) wajib diisi.");
  assert.match(galatForm(form({ ukuran: "Ukuran Custom", ukuranLebar: "145", ukuranPanjang: "9999" })), /^Item 1: Panjang harus antara 30 dan 400 cm\.$/);
  assert.equal(galatForm(form({ ukuran: "Ukuran Custom", ukuranLebar: "145", ukuranPanjang: "205" })), null);
  assert.equal(galatForm(form({ ukuran: "160x200 cm (Queen)" })), null);
  const pc = payloadResi("c1", form({ ukuran: "Ukuran Custom", ukuranLebar: "145", ukuranPanjang: "205" })).items[0];
  assert.equal(pc.ukuranLebar, "145"); assert.equal(pc.ukuranPanjang, "205");
  const ps = payloadResi("c1", form({ ukuran: "160x200 cm (Queen)", ukuranLebar: "145", ukuranPanjang: "205" })).items[0];
  assert.equal("ukuranLebar" in ps, false, "ukuran standar: angka custom tidak dikirim");
  const m = baca("features/resi/BuatResiModal.jsx");
  assert.match(m, /UkuranCustomFields/); assert.match(m, /pilihUkuran\(i, u\)/); assert.match(m, /Object\.keys\(UKURAN_VARIANT_KEY\)/);
});

test("Export Excel Order: kolom Ukuran/Konfigurasi berisi ukuran AKTUAL, bukan hanya 'Ukuran Custom'", () => {
  const s = baca("pages/Orders.jsx");
  assert.match(s, /"Ukuran\/Konfigurasi":\s+formatUkuranKasur\(info\),/);
  assert.doesNotMatch(s, /"Ukuran\/Konfigurasi":\s+info\.ukuranKasur/);
  // perilaku: baris yang dihasilkan untuk tiga jenis data
  const baris = (notes) => formatUkuranKasur(parseOrderNotes(notes));
  assert.equal(baris(JSON.stringify({ ukuranKasur: "Ukuran Custom", ukuranLebarCm: 145, ukuranPanjangCm: 205 })), "145 × 205 cm (Custom)");
  assert.equal(baris(JSON.stringify({ ukuranKasur: "Ukuran Custom" })), "Ukuran Custom (ukuran belum diisi)");
  assert.equal(baris(JSON.stringify({ ukuranKasur: "160x200 cm (Queen)" })), "160 × 200 cm");
  assert.equal(baris(JSON.stringify({ ukuranKasur: "" })), "");
  assert.notEqual(baris(JSON.stringify({ ukuranKasur: "Ukuran Custom", ukuranLebarCm: 145, ukuranPanjangCm: 205 })), "Ukuran Custom");
});

test("Formatter bersama dipakai di detail/daftar order, Produksi, Delivery, unit, dan revisi", () => {
  const perluKasur = ["features/orders/OrderTimelineDrawer.jsx", "pages/b2b/B2BOrders.jsx", "pages/Orders.jsx", "features/inbox/components/CustomerPanel/orderSummary.js", "features/armada/jobStatus.js"];
  for (const f of perluKasur) { const s = baca(f); assert.match(s, /formatUkuranKasur/, f); assert.doesNotMatch(s, /\{info\.ukuranKasur \|\| <span/, f); }
  const perluLabel = ["pages/bengkel/ProductionWorkOrders.jsx", "pages/bengkel/ProductionUnitDetail.jsx", "features/armada/components/JobDetailDrawer.jsx", "features/armada/components/RevisionDetailDrawer.jsx"];
  for (const f of perluLabel) { const s = baca(f); assert.match(s, /formatUkuranLabel\(/, f); assert.doesNotMatch(s, /\bu\.ukuran\b(?!\))|unit\.ukuran\b(?!\))/, f + ": tidak boleh menampilkan Unit.ukuran mentah"); }
  // ringkasan produk (Delivery/Inbox) memakai info penuh, bukan string ukuran mentah
  const os = baca("features/inbox/components/CustomerPanel/orderSummary.js");
  assert.match(os, /const ukuranKasur = formatUkuranKasur\(notesInfo\)/);
  assert.equal(formatUkuranLabel("Ukuran Custom"), "Ukuran Custom (ukuran belum diisi)");
});

test("Kesiapan order: Ukuran Custom tanpa angka hanya menahan order BARU setelah penegakan aktif (legacy TIDAK PERNAH ditahan)", () => {
  const src = baca("utils/orderReadiness.js");
  const potong = src.slice(src.indexOf("function ukuranCustomDitahan"), src.indexOf("export const READINESS"));
  const ditahan = new Function("parseOrderNotes", "isUkuranCustom", potong + "\nreturn ukuranCustomDitahan;")(parseOrderNotes, isUkuranCustom);
  const order = (dibuat, notes) => ({ createdAt: dibuat, notes: JSON.stringify(notes) });
  const legacyCustom = { ukuranKasur: "Ukuran Custom" };
  const sejak = "2026-10-01T00:00:00.000Z";
  assert.equal(ditahan(order("2026-10-02T00:00:00Z", legacyCustom), sejak), true, "order baru custom tanpa angka setelah penegakan → ditahan");
  assert.equal(ditahan(order("2026-09-20T00:00:00Z", legacyCustom), sejak), false, "order legacy (dibuat sebelum penegakan) → TIDAK ditahan");
  assert.equal(ditahan(order("2026-10-02T00:00:00Z", legacyCustom), null), false, "penegakan MATI → tidak ada yang ditahan");
  assert.equal(ditahan(order("2026-10-02T00:00:00Z", { ukuranKasur: "Ukuran Custom", ukuranLebarCm: 145, ukuranPanjangCm: 205 }), sejak), false, "custom berangka → tidak ditahan");
  assert.equal(ditahan(order("2026-10-02T00:00:00Z", { ukuranKasur: "160x200 cm (Queen)" }), sejak), false, "ukuran standar → tidak ditahan");
  assert.equal(ditahan({ notes: JSON.stringify(legacyCustom) }, sejak), false, "tanpa createdAt → tidak ditahan (gagal-aman)");
  assert.equal(ditahan(order("2026-10-02T00:00:00Z", legacyCustom), "bukan-tanggal"), false);
  // aturan terpasang: relevan hanya untuk kasur, memakai opsi penegakan; aturan lama 'Ukuran kasur belum diisi' tidak berubah
  assert.match(src, /key: "ukuranCustomAngka", label: "Lebar dan Panjang ukuran custom belum diisi"/);
  assert.match(src, /export function evaluateReadiness\(order, opsi = \{\}\)/);
  assert.match(src, /key: "ukuranKasur", label: "Ukuran kasur belum diisi"/);
  assert.match(baca("features/orders/ReadinessBadge.jsx"), /useUkuranCustomWajibSejak\(\)/);
  assert.match(baca("features/orders/ReadinessPanel.jsx"), /useUkuranCustomWajibSejak\(\)/);
  assert.match(baca("features/orders/useUkuranCustomWajib.js"), /ukuranCustomWajibSejak \?\? null/);
});
