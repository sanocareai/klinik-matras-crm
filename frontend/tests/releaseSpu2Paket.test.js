// Paket rilis spu2 (banner Install/Versi baru menyingkir saat dialog, footer HP aman safe-area/keyboard, cakupan pemeriksaan uang muka jujur): FRONTEND-SAJA dengan ALLOWLIST EKSPLISIT.
// Dikunci: himpunan berkas persis, berkas lain (backend, package, main.jsx, Layout.jsx, berkas Produksi) ditolak generator, skrip identik dengan hasil bangkitan.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const akar = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const baca = (p) => fs.readFileSync(path.join(akar, p), "utf8").replace(/\r\n/g, "\n");
const skrip = baca("scripts/release-finance-uang-muka-hp.sh");
const { bangkitkan } = createRequire(import.meta.url)(path.join(akar, "scripts", "gen-release-finance-uang-muka-hp.cjs"));

const APLIKASI = [
  "frontend/src/components/InstallPrompt.jsx", "frontend/src/components/UpdateBanner.jsx",
  "frontend/src/components/ui/command-palette.jsx", "frontend/src/components/ui/fokus-overlay.jsx", "frontend/src/components/ui/modal.jsx", "frontend/src/components/ui/overlay-status.jsx", "frontend/src/components/ui/panel-samping.jsx",
  "frontend/src/features/armada/components/IssueRescheduleDrawer.jsx", "frontend/src/features/armada/components/JobDetailDrawer.jsx", "frontend/src/features/armada/components/PodReviewDrawer.jsx",
  "frontend/src/features/armada/components/RevisionDetailDrawer.jsx", "frontend/src/features/armada/components/RevisionRequestDrawer.jsx", "frontend/src/features/armada/components/RouteControlDrawer.jsx",
  "frontend/src/features/complaints/ComplaintCaseDrawer.jsx",
  "frontend/src/features/finance/InvoicePanels.jsx", "frontend/src/features/finance/PanelDetail.jsx", "frontend/src/features/finance/kasbank/KasBankPanels.jsx",
  "frontend/src/features/finance/tagihan/DaftarTagihan.jsx", "frontend/src/features/finance/tagihan/RincianTagihan.jsx", "frontend/src/features/finance/uangMukaFaktur/kelayakanLogika.js",
  "frontend/src/features/finance/verifikasi/PanelPemeriksaan.jsx", "frontend/src/features/notifications/NotificationDrawer.jsx", "frontend/src/features/warehouse/components/GoodsReceiptDetailDrawer.jsx",
  "frontend/src/pages/b2b/B2BOrders.jsx", "frontend/src/pages/finance/FinanceReceivables.jsx", "frontend/src/pages/finance/FinanceSuppliers.jsx",
  "frontend/tests/bannerOverlayHp.test.js", "frontend/tests/releaseSpu2Paket.test.js",
];
const TPL = ["bandingkan-kode", "build-only", "container-baru", "fitur-dist", "header", "verifikasi-hotfix"].map((n) => `scripts/templates/release-finance-uang-muka-hp/${n}.txt`);
const TPL_P = ["gerbang-kode-live", "hitung-pasca", "hitung-pra"].map((n) => `scripts/templates/release-penjadwalan-langsung/${n}.txt`);
const TETAP = ["scripts/gen-release-finance-uang-muka-hp.cjs", "scripts/release-finance-uang-muka-hp.sh", ...TPL, ...TPL_P];
const blok = () => Object.fromEntries([...TPL, ...TPL_P].map((f) => [path.basename(f, ".txt"), baca(f)]));
const bangun = (daftar) => bangkitkan({ baseScript: baca("scripts/release-gudang-pintu-masuk.sh"), blok: blok(), berkasList: daftar });

test("allowlist skrip = dua puluh delapan berkas aplikasi/tes yang disetujui + berkas rilis sendiri, tidak ada yang lain", () => {
  const baris = skrip.split("\n").find((l) => l.startsWith("ALLOWED_RE="));
  const isi = baris.slice("ALLOWED_RE='^(".length, -")$'".length).split("|").map((x) => x.replace(/\\\./g, "."));
  assert.deepEqual([...isi].sort(), [...APLIKASI, ...TETAP].sort());
  assert.doesNotMatch(baris, /backend\/|package|docker|\.env|main\.jsx|Layout\.jsx/);
  const fe = skrip.split("\n").find((l) => l.startsWith("FRONTEND_SRC_EXPECT=")).slice('FRONTEND_SRC_EXPECT="'.length, -1).split(" ");
  assert.deepEqual(fe, APLIKASI.filter((f) => f.startsWith("frontend/src/")));
});

test("generator MENOLAK berkas di luar allowlist dan berkas yang kurang", () => {
  assert.doesNotThrow(() => bangun(APLIKASI));
  for (const ekstra of ["frontend/src/main.jsx", "frontend/src/components/Layout.jsx", "frontend/src/pages/finance/FinanceCash.jsx", "frontend/src/features/finance/UangMukaPO.jsx", "frontend/src/styles/index.css",
    "frontend/src/index.css", "backend/src/routes/purchaseOrders.js", "frontend/package.json", "frontend/tests/lain.test.js"]) {
    assert.throws(() => bangun([...APLIKASI, ekstra]), /allowlist|FRONTEND-SAJA|dependensi/, ekstra);
  }
  assert.throws(() => bangun(APLIKASI.slice(1)), /allowlist eksplisit/, "berkas yang disetujui hilang dari diff");
});

test("skrip: kode spu2, bandingkan_kode dua berkas persis, backend/ di diff dilarang, tanpa penghapusan di luar release dir sementara, tanpa sisa nama rilis lain", () => {
  assert.match(skrip, /\/tmp\/spu2\.sh/);
  assert.match(skrip, /bandingkan_kode "\$BK_DIR\/container-sha\.txt" "\$BK_DIR\/dir-sha\.txt" \|\|/);
  const pola = skrip.match(/tests\/\(financeKontrakMetrik[^)]*\)/g) || [];
  assert.ok(pola.length >= 3);
  for (const p of pola) assert.equal(p.replace(/\\\./g, "."), "tests/(financeKontrakMetrik.test.js|helpers/pemeriksaMetrikUi.js)");
  assert.match(skrip, /\^\(backend\//);
  assert.doesNotMatch(skrip.replace('rm -rf -- "$NEW_DIR"', ""), /rm -rf[^\n]*(RELEASES\b|PREV_DIR|backups|volume)/);
  assert.doesNotMatch(skrip.split("\n").filter((l) => !l.startsWith("#")).join("\n"), /spo1|spo2|spo3|spt1|spt2|spu1|skb1|spr1|sgs\d|gpm\b|pjl\\\|/, "tidak ada sisa nama rilis lain di luar komentar");
});

test("penanda dist: teks baru ada di dist baru & TIDAK di dist aktif; lapisan sebelumnya (uang muka spu1, Ubah tagihan, redesain Tagihan, UX PO, Kas & Bank) harus tetap ada", () => {
  const fd = baca("scripts/templates/release-finance-uang-muka-hp/fitur-dist.txt");
  const baru = fd.split("for s0 in")[1].split("; do")[0];
  for (const t of ["Penanda uang muka hanya diperiksa untuk", "BELUM tentu bebas uang muka", "Pembayaran BELUM disimpan", "data-kb"]) assert.ok(baru.includes(`"${t}"`), t);
  const lama = fd.split("for s2 in")[1].split("; do")[0];
  for (const t of ["Gunakan uang muka untuk mengurangi sisa tagihan?", "Tetap catat pembayaran", "Total dibayar dari kas", "Penyelesaian faktur", "Tidak bisa diubah di sini", "Tentang angka dan pencatatan", "Sudah menerima faktur supplier?"]) assert.ok(lama.includes(`"${t}"`), t);
  const css = fd.split("for c0 in")[1].split("; do")[0];
  for (const c of [".fin-tg-um-chip", ".fin-tg-ubah-kartu", ".fin-tg-baris", ".fin-tgl-pop", ".fin-pof-tabel", ".fin-ks-kartu", ".fin-po-baris"]) assert.ok(css.includes(`"${c}"`), c);
});

test("skrip tersimpan identik dengan hasil bangkitan ulang (tak diedit tangan)", () => {
  assert.equal(bangun(APLIKASI).script, skrip);
});
