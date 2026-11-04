// Redesain visual Pembelian & Supplier (spu3): keluarga ikon Apple, tombol "Terapkan uang muka" menyala, kartu KPI berwarna, daftar `fin-dl` yang selaras.
// Hanya presentasi — tidak ada perubahan data, endpoint, atau perilaku transaksi.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(__dirname, "..", "src");
const baca = (rel) => fs.readFileSync(path.join(src, rel), "utf8");

const BERKAS_MODUL = [
  "pages/finance/FinanceSuppliers.jsx", "pages/finance/FinancePurchases.jsx", "pages/finance/FinancePurchaseOrders.jsx",
  "features/finance/JadwalAgingUtang.jsx", "features/finance/UangMukaPO.jsx", "features/finance/UangMukaSupplierTabel.jsx",
  "features/finance/DaftarGaya.jsx", "features/finance/RowActions.jsx", "features/finance/RincianTagihan.jsx",
  "features/finance/tagihan/DaftarTagihan.jsx", "features/finance/tagihan/CatatTagihan.jsx", "features/finance/tagihan/UbahTagihan.jsx",
  "features/finance/tagihan/RincianTagihan.jsx",
  "features/finance/po/DaftarPO.jsx", "features/finance/po/EditorPO.jsx", "features/finance/po/FakturSupplierPO.jsx",
  "features/finance/po/KontrolPO.jsx", "features/finance/po/RincianPO.jsx",
  "features/finance/uangMukaFaktur/PenerapanUangMuka.jsx",
].filter((f) => fs.existsSync(path.join(src, f)));

test("modul Pembelian & Supplier tidak lagi mengimpor ikon dari lucide-react (semua lewat keluarga ikApple)", () => {
  assert.ok(BERKAS_MODUL.length >= 15, "daftar berkas modul harus terbaca");
  for (const f of BERKAS_MODUL) {
    // Pengecualian yang diketahui: RowActions (tombol titik-tiga + spinner bersama seluruh Finance) tetap memakai dua ikon fungsional lucide.
    if (f === "features/finance/RowActions.jsx") { assert.match(baca(f), /import \{ MoreHorizontal, Loader2 \} from "lucide-react"/); continue; }
    assert.doesNotMatch(baca(f), /from "lucide-react"/, `${f}: masih memakai lucide-react`);
  }
});

test("setiap nama yang diimpor dari ikApple benar-benar diekspor (tidak ada ikon undefined saat render)", () => {
  const ik = baca("components/ikApple.jsx");
  const ekspor = new Set();
  for (const m of ik.matchAll(/export (?:const|function) (\w+)/g)) ekspor.add(m[1]);
  for (const m of ik.matchAll(/export \{([^}]+)\}/g)) m[1].split(",").forEach((n) => ekspor.add(n.trim().split(/\s+as\s+/).pop()));
  assert.ok(ekspor.size > 30, "ikApple harus mengekspor keluarga ikon");
  for (const f of BERKAS_MODUL) {
    for (const m of baca(f).matchAll(/import \{([^}]+)\} from "@\/components\/ikApple\.jsx"/g)) {
      for (const n of m[1].split(",").map((x) => x.trim().split(/\s+as\s+/)[0]).filter(Boolean)) {
        assert.ok(ekspor.has(n), `${f}: '${n}' diimpor dari ikApple tetapi tidak diekspor`);
      }
    }
  }
});

test("tombol 'Terapkan uang muka' memakai gaya menyala + ikon koin Apple di banner, tawaran PO, dan footer dialog", () => {
  const p = baca("features/finance/uangMukaFaktur/PenerapanUangMuka.jsx");
  assert.match(p, /data-testid="terapkan-uang-muka-peringatan" className="tb-menyala berdenyut"/);
  assert.match(p, /<GlifKaca nama="koin"/);
  assert.match(p, /<TombolAksi className="tb-menyala"[^>]*data-testid="simpan-penerapan"/);
  assert.match(p, /<UbinApple nama="koin"/);
  const css = baca("styles/ik-apple.css");
  assert.match(css, /\.tb-menyala\.tb-menyala/);
  assert.match(css, /@keyframes tb-denyut/);
  assert.match(css, /prefers-reduced-motion/, "denyut harus mati bila pengguna meminta gerak minimal");
});

test("kit daftar: kartu KPI berwarna bergradasi (bukan datar), mode gelap, dan CSS panel dimuat oleh kit sendiri", () => {
  const kit = baca("features/finance/DaftarGaya.jsx");
  // Halaman yang dibuka langsung (mis. /finance/purchases) tidak boleh bergantung pada impor CSS halaman lain.
  assert.ok(kit.includes('import "@/styles/sanss-finance-tagihan.css"') && kit.includes('import "@/styles/sanss-finance-daftar.css"'));
  assert.ok(baca("features/finance/po/KontrolPO.jsx").includes('import "@/styles/sanss-finance-po.css"'));
  const css = baca("styles/sanss-finance-daftar.css");
  assert.match(css, /linear-gradient\(/);
  assert.ok(css.includes("--kw1: #EEF3FF"), "warna dasar kartu (biru) harus ada");
  for (const w of ["hijau", "jingga", "merah", "ungu", "tosca", "grafit"]) assert.ok(css.includes(`data-warna="${w}"`), `warna kartu ${w} belum didefinisikan`);
  assert.match(css, /:root\[data-theme="dark"\] \.app-shell\.crm-skin \.fin-kw\[data-warna="hijau"\]/);
  assert.match(css, /prefers-reduced-motion/);
});

test("Pembelian, Jadwal pembayaran, Pembayaran, Daftar supplier, dan Uang muka per supplier memakai kit yang sama", () => {
  for (const f of ["pages/finance/FinancePurchases.jsx", "features/finance/JadwalAgingUtang.jsx", "pages/finance/FinanceSuppliers.jsx", "features/finance/UangMukaSupplierTabel.jsx", "features/finance/tagihan/DaftarTagihan.jsx"]) {
    const s = baca(f);
    assert.ok(s.includes("KartuKpiApple"), `${f}: kartu KPI berwarna belum dipakai`);
    assert.doesNotMatch(s, /<KartuAngka\b/, `${f}: kartu angka datar lama masih dipakai`);
  }
  for (const f of ["pages/finance/FinancePurchases.jsx", "features/finance/JadwalAgingUtang.jsx", "pages/finance/FinanceSuppliers.jsx"]) {
    const s = baca(f);
    assert.ok(s.includes('className="fin-dl-tabel"'), `${f}: daftar fin-dl belum dipakai`);
    assert.doesNotMatch(s, /<Table\b|<TableWrap\b|<CardList\b/, `${f}: tabel/kartu gaya lama masih ada`);
  }
});

test("Jadwal pembayaran: strip info dan kartu KPI diberi jarak (flex gap), bukan menempel", () => {
  assert.ok(baca("features/finance/JadwalAgingUtang.jsx").includes('className="flex flex-col gap-4" data-testid="jadwal-aging"'));
});
