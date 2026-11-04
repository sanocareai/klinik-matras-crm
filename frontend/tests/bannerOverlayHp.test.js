// Banner global (Install/Versi baru) menyingkir selama dialog/panel layar penuh terbuka; footer dialog aman terhadap safe area & keyboard HP;
// cakupan pemeriksaan uang muka (batas 60 faktur) dinyatakan jujur; pengaman Simpan memeriksa faktur terpilih langsung ke server.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { teksCakupanPeriksa, BATAS_PERIKSA_UANG_MUKA } from "../src/features/finance/uangMukaFaktur/kelayakanLogika.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(dir, "..", "src");
const baca = (p) => fs.readFileSync(path.join(src, p), "utf8").replace(/\r\n/g, "\n");
function semuaBerkas(d, hasil = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) semuaBerkas(p, hasil); else if (/\.jsx$/.test(e.name)) hasil.push(p);
  }
  return hasil;
}

test("status overlay: hitungan (bukan boolean) lewat useSyncExternalStore; DaftarOverlay mendaftar saat terpasang dan melepas saat dibongkar", () => {
  const s = baca("components/ui/overlay-status.jsx");
  assert.match(s, /useSyncExternalStore\(langgan, \(\) => jumlah > 0, \(\) => false\)/);
  assert.match(s, /useEffect\(\(\) => \{ ubah\(1\); return \(\) => ubah\(-1\); \}, \[\]\)/);
  assert.match(s, /Math\.max\(0, jumlah \+ d\)/, "tidak pernah negatif");
  const kode = s.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  assert.doesNotMatch(kode, /document\.(querySelector|body|getElement)|z-?index/i, "tanpa pemeriksaan DOM dan tanpa akal-akalan z-index");
});

test("SETIAP Dialog.Content di aplikasi memasang <DaftarOverlay /> (dialog transaksi dan panel layar penuh)", () => {
  const berkas = semuaBerkas(src).filter((f) => !/overlay-status\.jsx$/.test(f) && /<Dialog\.Content/.test(fs.readFileSync(f, "utf8")));
  assert.ok(berkas.length >= 20, `ditemukan ${berkas.length}`);
  for (const f of berkas) {
    const t = fs.readFileSync(f, "utf8").replace(/\r\n/g, "\n");
    assert.match(t, /<DaftarOverlay \/>\n\s*<\/Dialog\.Content>/, path.relative(src, f));
    assert.match(t, /import \{ DaftarOverlay[^}]*\} from "(@\/components\/ui|\.)\/overlay-status\.jsx"/, path.relative(src, f));
  }
});

test("InstallPrompt & UpdateBanner: hook dipanggil SEBELUM return awal; banner menyingkir saat overlay aktif; status 'ditutup manual'/needRefresh tidak diubah; CSS banner tidak disentuh", () => {
  for (const [f, jaga] of [["components/InstallPrompt.jsx", /if \(!visible \|\| overlayAktif\) return null;/], ["components/UpdateBanner.jsx", /if \(!needRefresh \|\| overlayAktif\) return null;/]]) {
    const t = baca(f);
    assert.match(t, /useOverlayAktif\(\)/); assert.match(t, jaga, f);
    assert.ok(t.indexOf("useOverlayAktif()") < t.search(/if \(!(visible|needRefresh) \|\| overlayAktif\)/), `${f}: hook harus sebelum return awal (aturan hook)`);
  }
  const ip = baca("components/InstallPrompt.jsx");
  assert.doesNotMatch(ip, /setVisible\(false\)[^;]*overlay|overlayAktif[^;]*setVisible/, "overlay tidak mengubah state 'visible'");
  assert.match(ip, /localStorage\.setItem\("pwa-install-dismissed", "1"\)/, "aturan tutup manual tetap");
});

test("Modal: footer aman safe-area (desktop tetap 1.5rem), boleh membungkus, rapat saat keyboard; dialog dibatasi ke area di atas keyboard dan fokus digulirkan", () => {
  const m = baca("components/ui/modal.jsx");
  assert.match(m, /pb-\[max\(1\.5rem,calc\(env\(safe-area-inset-bottom\)\+0\.75rem\)\)\]/);
  assert.match(m, /flex shrink-0 flex-wrap justify-end gap-2 border-t border-line/);
  assert.match(m, /group-data-\[kb=1\]\/modal:pb-3/);
  assert.match(m, /"--kb-inset": `\$\{kb\}px`, top: 0, "--tw-translate-y": "0px", maxHeight: `calc\(100dvh - \$\{kb\}px\)`/, "gaya INLINE (menang atas CSS tak berlapis seperti .gud-dlg-penuh)");
  assert.doesNotMatch(m, /max-sm:data-\[kb=1\]/, "bukan utilitas Tailwind yang bisa dikalahkan CSS halaman");
  assert.match(m, /useInsetKeyboard\(open\)/);
  assert.match(m, /document\.activeElement\?\.scrollIntoView\?\.\(\{ block: "nearest" \}\)/);
  assert.ok(m.indexOf("useInsetKeyboard(open)") < m.indexOf("if (lapisan?.slot"), "hook sebelum return awal");
  const o = baca("components/ui/overlay-status.jsx");
  assert.match(o, /window\.visualViewport/); assert.match(o, /window\.innerWidth < 640 && d > 80 \? d : 0/, "ambang 80px mengabaikan bilah alamat; hanya layar HP");
});

test("cakupan pemeriksaan uang muka: batas 60 dinyatakan, kegagalan dinyatakan, tidak ada klaim 'semua diperiksa'", () => {
  assert.equal(BATAS_PERIKSA_UANG_MUKA, 60);
  assert.equal(teksCakupanPeriksa({ total: 12, diperiksa: 12, terpotong: false, gagal: 0 }), null, "semua diperiksa & tidak ada kegagalan: tidak ada pernyataan");
  const t = teksCakupanPeriksa({ total: 161, diperiksa: 60, terpotong: true, gagal: 0 });
  assert.match(t, /hanya diperiksa untuk 60 dari 161 faktur/); assert.match(t, /BELUM tentu bebas uang muka/); assert.doesNotMatch(t, /semua faktur (sudah|telah) diperiksa/i);
  assert.match(teksCakupanPeriksa({ total: 5, diperiksa: 5, terpotong: false, gagal: 2 }), /gagal untuk 2 faktur; baris tanpa penanda belum diperiksa/);
  assert.match(teksCakupanPeriksa({ total: 90, diperiksa: 60, terpotong: true, gagal: 1 }), /60 dari 90[\s\S]*gagal untuk 1 faktur/);
  const sup = baca("pages/finance/FinanceSuppliers.jsx"); const d = baca("features/finance/tagihan/DaftarTagihan.jsx");
  assert.match(sup, /slice\(0, BATAS_PERIKSA_UANG_MUKA\)/); assert.match(sup, /statusPeriksaUm=\{statusPeriksaUm\}/);
  assert.match(d, /data-testid="batas-periksa-uang-muka"/); assert.match(d, /teksCakupanPeriksa\(statusPeriksaUm\)/);
  assert.doesNotMatch(sup + d, /semua faktur (sudah|telah) diperiksa/i);
});

test("form pembayaran: faktur terisi didahulukan dalam pemeriksaan baris; Simpan memeriksa ulang SETIAP faktur terpilih langsung ke server dan tidak menyimpan diam-diam bila gagal", () => {
  const sup = baca("pages/finance/FinanceSuppliers.jsx");
  const f = sup.split("function ModalBayarSupplierIsi(")[1].split("// Edit tagihan yang BELUM disetujui")[0];
  assert.match(f, /kandidatBayar\.filter\(\(b\) => alokasiAktif\[b\.id\] !== undefined\)/);
  assert.match(f, /BATAS_PERIKSA_UANG_MUKA - terpilih\.length/);
  assert.match(f, /async function simpan\(\)/);
  assert.match(f, /for \(const b of dipilih\) peta\.set\(b\.id, ringkasKelayakan\(await api\.getKandidatUangMukaFaktur\(b\.id\)\)\)/);
  assert.match(f, /Pembayaran BELUM disimpan; tekan Simpan lagi untuk memeriksa ulang/);
  assert.match(f, /fakturBerisikoBayarKedua\(tagihanTerbuka, alokasiAktif, peta\)/, "keputusan risiko memakai hasil pemeriksaan segar, bukan cache");
  assert.match(f, /data-testid="batas-periksa-bayar"/);
});

test("dialog Gudang layar penuh di HP: translate Tailwind v4 juga direset (bukan hanya transform) — kalau tidak dialog bergeser -50% dan setengahnya keluar layar", () => {
  const css = baca("styles/sanss-gudang-dok.css");
  const aturan = css.match(/@media \(max-width: 639px\) \{\s*\.gud-dlg-penuh \{[^}]*\}/)?.[0] || "";
  assert.match(aturan, /transform: none !important; translate: none !important;/);
  assert.match(aturan, /left: 0 !important; top: 0 !important;/);
});
