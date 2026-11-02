// Redesain Gudang Fase 2 — Stok & Lokasi (Nov 2026): pagar statis. Perilaku nyata diuji di qa-harness/gudang-stok-skenarioA/B.cjs (backend asli + DB sandbox).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const akar = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
const baca = (...p) => fs.readFileSync(path.join(akar, ...p), "utf8").replace(/\r\n/g, "\n");
const tanpaKomentar = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const FORM = ["features/warehouse/stok/KoreksiSaldoModal.jsx", "features/warehouse/stok/UbahHargaModal.jsx", "features/warehouse/stok/PenerapanLamaModal.jsx", "features/warehouse/components/ItemFormModal.jsx", "features/warehouse/components/ItemDetailDrawer.jsx"];

test("form Stok memakai komponen aplikasi: tanpa window.prompt/confirm/alert, select, datetime-local atau date bawaan peramban", () => {
  for (const f of FORM) {
    const s = tanpaKomentar(baca(f));
    assert.ok(!/window\.(prompt|confirm|alert)\(|\b(?:prompt|confirm|alert)\(/.test(s), `${f}: dialog bawaan peramban`);
    assert.ok(!/<select[\s>]/.test(s), `${f}: <select> bawaan`);
    assert.ok(!/type="(datetime-local|date)"/.test(s), `${f}: input tanggal bawaan`);
  }
});

test("form tulis mencegah klik ganda dengan kunci sinkron (ref) dan memakai noValidate + galat di kolom", () => {
  for (const f of ["features/warehouse/stok/KoreksiSaldoModal.jsx", "features/warehouse/stok/UbahHargaModal.jsx", "features/warehouse/components/ItemFormModal.jsx"]) {
    const s = baca(f);
    assert.match(s, /useRef\(/, `${f}: kunci ref`);
    assert.match(s, /noValidate/, `${f}: noValidate`);
    assert.match(s, /GudField/, `${f}: galat dekat kolom`);
  }
  assert.match(baca("features/warehouse/stok/KoreksiSaldoModal.jsx"), /Idempotency|kunciUntuk\(/);
  assert.match(baca("features/warehouse/stok/UbahHargaModal.jsx"), /hashPratinjau: pra\.hash/);
});

test("kode & satuan bahan tidak ikut payload ubah (terkunci); aktif/nonaktif lewat konfirmasi di dalam aplikasi", () => {
  const f = baca("features/warehouse/components/ItemFormModal.jsx");
  assert.match(f, /id="wh-code"[^>]*disabled=\{ubah\}/);
  const d = baca("features/warehouse/components/ItemDetailDrawer.jsx");
  for (const k of ['data-testid="konfirmasi-aktif"', 'data-testid="ya-ubah-aktif"', 'data-testid="edit-bahan"', 'data-testid="ubah-aktif"']) assert.ok(d.includes(k), k);
});

test("panel bahan: empat tab, docked di desktop; Koreksi saldo bukan tombol utama; Harga Berlaku dipisah dari nilai persediaan Finance", () => {
  const d = baca("features/warehouse/components/ItemDetailDrawer.jsx");
  for (const k of ["tab-saldo", "tab-harga", "tab-pergerakan", "tab-info", "tempel", "batas-pergerakan"]) assert.ok(d.includes(k), k);
  assert.match(baca("features/warehouse/stok/HargaBerlakuPanel.jsx"), /pemisah-angka/);
  assert.ok(!/stok\s*\*\s*(harga|unitPrice)|saldo\s*\*\s*(harga|unitPrice)/i.test(tanpaKomentar(d + baca("features/warehouse/stok/HargaBerlakuPanel.jsx"))), "tidak mengalikan stok × Harga Berlaku");
});

test("daftar: baris tombol sungguhan, kolom utama, tata letak container query, tidak menjumlah satuan berbeda", () => {
  const s = baca("features/warehouse/stok/DaftarBahan.jsx"); const css = baca("styles/sanss-gudang-stok.css"); const dasar = baca("styles/sanss-gudang.css");
  for (const k of ["gud-stok-baris", 'data-testid="sel-saldo"', 'data-testid="tersedia-angka"', 'data-testid="sel-satuan"', 'data-testid="status-baris"']) assert.ok(s.includes(k), k);
  assert.match(dasar, /.gud-daftar {[^}]*container-name: ?gud-daftar/); assert.match(css, /@container gud-daftar \(max-width: ?640px\)/);
  assert.match(css, /min-height: ?44px/);
});

test("halaman: saringan jujur terhadap cakupan data; tanpa filter lokasi/urutan/ekspor yang tidak didukung backend", () => {
  const p = baca("pages/warehouse/WarehouseInventory.jsx");
  assert.match(p, /ringkasHasil/); assert.match(p, /atur-ulang-saringan/); assert.match(p, /kembali-semua/);
  assert.match(p, /const KUNCI = \["kelompok", "jenis", "q", "keadaan", "nonaktif", "semua", "harga", "lain", "satuan"\]/);
  assert.ok(!/saring-lokasi|urutkan|ekspor|export(?!s+default)/i.test(tanpaKomentar(p)), "tidak ada kontrol yang tidak punya dukungan data");
  assert.match(p, /Reset saringan/);
});

test("ikon bahan dan ikon aksi berasal dari satu keluarga (gudangIcons), tanpa lucide di berkas Stok", () => {
  for (const f of ["features/warehouse/stok/IkonBahan.jsx", "features/warehouse/stok/HargaBerlakuPanel.jsx", "features/warehouse/stok/KoreksiSaldoPanel.jsx", "features/warehouse/stok/KoreksiSaldoModal.jsx", "features/warehouse/stok/UbahHargaModal.jsx", "features/warehouse/components/ItemDetailDrawer.jsx", "pages/warehouse/WarehouseInventory.jsx"]) assert.ok(!/from "lucide-react"/.test(baca(f)), `${f}: lucide`);
  assert.match(baca("features/warehouse/stok/IkonBahan.jsx"), /IKON_KELOMPOK/);
});

test("GudKontrol: WaktuGud (tanggal & jam aplikasi) dan PilihGud kosongNormal tersedia", () => {
  const g = baca("features/warehouse/form/GudKontrol.jsx");
  assert.match(g, /export function WaktuGud/); assert.match(g, /kosongNormal/);
});
