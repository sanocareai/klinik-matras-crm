// Gelombang 2 redesain Apple (B2B, Komplain, halaman Delivery lain) + perbaikan service worker: kontrak struktur. Data, izin, tujuan klik, dan arti angka tidak berubah; hanya tampilan.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const baca = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const src = (f) => baca(`src/${f}`);

test("konteks gaya Apple: diisi Layout (kerangka Apple + papan Komplain), default false di luar Layout", () => {
  const a = src("components/apple/Apple.jsx"); const l = src("components/Layout.jsx");
  assert.match(a, /export const ApSkinContext = createContext\(false\)/); assert.match(a, /export const useApSkin = \(\) => useContext\(ApSkinContext\)/);
  assert.match(l, /<ApSkinContext\.Provider value=\{gayaApple\}>/); assert.match(l, /<\/ApSkinContext\.Provider>/);
  assert.match(l, /const gayaApple = apSkin \|\| \(!driverOnly && !IS_DRIVER_APP && !CRM_SKIN_OFF && location\.pathname\.startsWith\("\/komplain"\)\);/);
  // komentar JSX tidak boleh terjebak sebagai anak Provider (akan tampil sebagai teks)
  assert.doesNotMatch(l, /<ApSkinContext\.Provider value=\{gayaApple\}>\s*\/\/ data-division/);
});

test("PageHeader: cabang Apple memakai kepala ringkas + ikon info untuk penjelasan panjang; cabang lama tetap utuh", () => {
  const p = src("components/ui/page.jsx");
  assert.match(p, /const apple = useApSkin\(\);/); assert.match(p, /<header className=\{cn\("ap-kepala", className\)\}>/);
  assert.match(p, /adaPenjelasanPanjang\(subtitle\)/); assert.match(p, /<h1 className="page-title">\{title\}<\/h1>/);
  assert.match(p, /page-title text-\[22px\] font-bold leading-tight/, "kepala lama tidak berubah");
  const a = src("components/apple/Apple.jsx");
  assert.match(a, /adaPenjelasanPanjang\(teks\) \{ return typeof teks === "string" && teks\.trim\(\)\.length > 70; \}/);
});

test("WorkspaceHero: cabang Apple = judul + pil kesehatan + widget berwarna; angka/label/hint dari stats apa adanya", () => {
  const h = src("components/ui/workspace-hero.jsx");
  assert.match(h, /const apple = useApSkin\(\);/); assert.match(h, /<KartuWidget key=\{s\.label\} nada=\{NADA_APPLE\[i % NADA_APPLE\.length\]\} judul=\{s\.label\}/);
  assert.match(h, /<div className="ap-w-angka">\{s\.value\}<\/div>/); assert.match(h, /\{s\.hint && <p className="ap-w-label">\{s\.hint\}<\/p>\}/);
  assert.match(h, /stats\.length === 5 \? "lg:grid-cols-5" : stats\.length === 3 \? "lg:grid-cols-3" : "lg:grid-cols-4"/, "tidak ada kartu yatim saat 5/3 kotak");
  assert.match(h, /health\.tone === "critical" \? "ap-titik-merah" : health\.tone === "warn" \? "ap-titik-kuning" : "ap-titik-hijau"/);
  assert.match(h, /from-\[#0A2463\]/, "tampilan lama (biru gelap) tetap untuk workspace lain");
});

test("KpiCard/Tile/Kendali Rute/Komplain: varian Apple tanpa mengubah angka, filter, atau testid", () => {
  const k = src("features/laporan/components/KpiCard.jsx");
  assert.match(k, /const apple = useApSkin\(\);\s*if \(apple\) \{/); assert.match(k, /<div className="ap-w-angka">\{displayValue\}<\/div>/);
  const r = src("pages/armada/ArmadaRingkasan.jsx"); assert.match(r, /<div className="ap-w-angka">\{value\}<\/div>/); assert.match(r, /\{hint && <p className="ap-w-label">\{hint\}<\/p>\}/);
  const t = src("pages/armada/ArmadaKendaliRute.jsx");
  assert.match(t, /aria-pressed=\{aktif\}/); assert.match(t, /setOnlyProblem\(\(v\) => !v\)/); assert.match(t, /setStatus\(\(s\) => \(s === t\.key \? "" : t\.key\)\)/, "filter cepat tetap");
  assert.match(t, /<div className="ap-w-angka">\{ringkasan\[t\.key\] \?\? 0\}<\/div>/);
  const c = src("pages/ComplaintCases.jsx");
  for (const id of ["filter-tahap-", "kartu-komplain", "daftar-komplain", "ringkasan-tahap", "peringatan", "muat-lagi", "bersihkan-filter", "jumlah-hasil", "tab-aktif", "tab-riwayat"]) assert.ok(c.includes(id), `testid ${id} tetap`);
  assert.match(c, /onClick=\{\(\) => setTahap\(tahap === t\.no \? null : t\.no\)\} aria-pressed=\{tahap === t\.no\}/);
  assert.match(c, /<span className="sr-only">\{t\.tanya\}<\/span>/, "pertanyaan tahap tetap ada untuk pembaca layar");
  assert.match(c, /statusUntukTahap\(tahap\)\.join\(","\)/, "filter tahap tetap memakai status backend");
});

test("hanya Komplain, B2B, dan kerangka Apple yang ikut gaya baru; CSS penyesuaian dibatasi .ap-skin", () => {
  const css = src("styles/sanss-apple.css");
  const bagian = css.slice(css.indexOf("penyesuaian komponen UI bersama"));
  for (const aturan of bagian.split("\n").filter((x) => /^:root /.test(x))) assert.match(aturan, /^:root \.app-shell\.crm-skin\.ap-skin /, `aturan global harus dibatasi .ap-skin: ${aturan.slice(0, 60)}`);
  const l = src("components/Layout.jsx");
  assert.doesNotMatch(l, /divisionKey === "(growth|finance|bengkel|warehouse)"[^;\n]*apSkin =/);
});

test("service worker: index.html tidak di-precache, navigasi menunggu 10 detik, offline tetap jatuh ke salinan", () => {
  const sw = src("sw.js"); const v = baca("vite.config.js");
  assert.match(sw, /const NAVIGASI_TUNGGU_DETIK = 10;/); assert.match(sw, /new NetworkFirst\(\{ cacheName: "html-shell", networkTimeoutSeconds: NAVIGASI_TUNGGU_DETIK \}\)/);
  assert.match(sw, /registerRoute\(\/\\\/api\\\/\/, new NetworkOnly\(\)\)/, "API tetap NetworkOnly");
  assert.match(sw, /new CacheFirst\(\{\s*cacheName: "static-assets"/, "aset statis tetap CacheFirst");
  assert.match(sw, /self\.skipWaiting\(\)/); assert.match(sw, /self\.addEventListener\("push"/); assert.match(sw, /self\.addEventListener\("notificationclick"/);
  assert.match(v, /globPatterns: \["\*\*\/\*\.\{js,css\}"\]/, "html tidak ikut daftar precache");
  assert.match(v, /strategies: "injectManifest"/);
  assert.ok(fs.existsSync(new URL("../qa-harness/sw-navigasi-basi.cjs", import.meta.url)), "harness bukti SW tersedia");
});

test("kerapian: kolom isian terisi (mengalahkan tema kaca Delivery), HP setinggi sentuh, catatan driver di ikon info, strip kosong Pengajuan tidak tampil", () => {
  const css = src("styles/sanss-apple.css");
  assert.match(css, /background: var\(--ap-isi\) !important; border: 0 !important; border-radius: 12px;/);
  assert.match(css, /:root\[data-workspace="apple"\] \[role="dialog"\] :is\(input:not/, "dialog yang di-portal ke body ikut");
  assert.match(css, /@media \(max-width: 767px\) \{\s*:root \.app-shell\.crm-skin\.ap-skin :is\(input:not[^}]*min-height: 44px;/);
  assert.match(css, /:is\(ul, ol\)\[class\*="divide-"\] \{ list-style: none;/);
  const glass = src("styles/delivery-light.css"); assert.match(glass, /\.glass-division input\[type="text"\][\s\S]*background: rgba\(255, 255, 255, 0\.72\) !important/, "alasan !important masih berlaku");
  const p = src("pages/armada/ArmadaPengaturan.jsx"); assert.match(p, /data-testid="catatan-data-driver"/); assert.doesNotMatch(p, /<p className="border-t border-line px-4 py-2\.5 text-\[11px\] leading-relaxed text-ink3">\s*Nomor telepon/);
  const pb = src("pages/armada/ArmadaPengajuanBiaya.jsx"); assert.match(pb, /templates\.length > 0 \|\| \(recent && \(recent\.kendaraan\?\.length > 0 \|\| recent\.pic\?\.length > 0\)\)/);
});
