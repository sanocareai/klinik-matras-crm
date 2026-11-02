// Tipografi Produksi (stack Apple/Inter), keluarga ikon, popover filter berdraf, hierarki kelengkapan di panel unit (3 Nov 2026). Pengawatan statis (tanpa DOM); perilaku nyata diuji di mock QA + build produksi.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (...p) => fs.readFileSync(path.join(here, "..", "src", ...p), "utf8").replace(/\r\n/g, "\n");
const tipo = src("styles", "produksi-tipografi.css"); const css = src("styles", "sanss-produksi.css"); const cssApp = src("styles", "sanss-produksi-app.css");

test("token tipografi: stack lintas perangkat + Apple, skala yang diminta, tanpa !important", () => {
  assert.ok(tipo.includes('--prod-font-ui: "Inter Variable", Inter, -apple-system, BlinkMacSystemFont, system-ui, "Segoe UI", sans-serif;'), "non-Apple: Inter lebih dulu (Chrome memetakan -apple-system ke font sistem di semua OS)");
  assert.ok(tipo.includes(':root[data-plat="apple"] { --prod-font-ui: -apple-system, BlinkMacSystemFont, "Inter Variable", Inter, system-ui, "Segoe UI", sans-serif; }'), "Apple: SF Pro lebih dulu");
  for (const t of ["--prod-fs-halaman: 30px", "--prod-fs-panel: 19px", "--prod-fs-butir: 15px", "--prod-fs-isi: 14px", "--prod-fs-ket: 13px", "--prod-fs-kpi: 34px", "--prod-fw-isi: 400", "--prod-fw-sedang: 500", "--prod-fw-judul: 600"]) assert.ok(tipo.includes(t), t);
  assert.ok(!/!important/.test(tipo.replace(/\/\*[\s\S]*?\*\//g, "")), "tidak menumpuk !important (di luar komentar)");
  assert.ok(!/font-weight:\s*(700|800|900|bold)/.test(tipo + css + cssApp), "tanpa bobot 700/800");
  assert.ok(!/letter-spacing:\s*-/.test(tipo + css + cssApp), "tanpa letter-spacing negatif");
  assert.ok(/font-variant-numeric: tabular-nums/.test(tipo), "angka tabular");
});

test("cakupan: kerangka Produksi, atribut <html> untuk portal di <body>, aplikasi lantai dan Andon; tidak menyentuh workspace lain", () => {
  assert.ok(tipo.includes(':root[data-workspace="produksi"]') && tipo.includes(":root .app-shell.crm-skin.prod-skin") && tipo.includes(".prod-app, .prod-tv"));
  const h = src("hooks", "useWorkspaceFont.js");
  assert.ok(h.includes("el.dataset.workspace = nama") && h.includes("delete el.dataset.workspace") && h.includes("dataset.plat"), "atribut dipasang, DILEPAS saat pindah workspace, dan platform dideteksi");
  const layout = src("components", "Layout.jsx");
  assert.ok(layout.includes('useWorkspaceFont(crmShell && divisionKey === "bengkel")'), "hanya saat workspace Produksi aktif");
  assert.ok(src("features", "production", "workerApp", "WorkerAppShell.jsx").includes("useWorkspaceFont(true)") && src("pages", "bengkel", "ProductionAndon.jsx").includes("useWorkspaceFont(true)"), "halaman mandiri Produksi");
  const main = src("main.jsx"); assert.ok(main.indexOf("sanss-produksi.css") < main.indexOf("produksi-tipografi.css"), "token dimuat sesudah lapisan Produksi");
  for (const lain of ["sanss-gudang.css", "sanss-finance.css", "sanss-crm.css", "tokens.css"]) assert.ok(!/--prod-font-ui|data-workspace/.test(src("styles", lain)), `${lain} tidak diubah`);
  assert.ok(src("styles", "tokens.css").includes('--font-ui: "Manrope Variable"'), "--font-ui global tetap Manrope (Sales/Finance/Gudang/login)");
  assert.ok(/Inter Variable/.test(src("main.jsx").replace(/\n/g, " ")) || src("main.jsx").includes('@fontsource-variable/inter'), "Inter dibundel lokal (Fontsource, OFL)");
  const pk = JSON.parse(fs.readFileSync(path.join(here, "..", "package.json"), "utf8")); assert.ok(pk.dependencies["@fontsource-variable/inter"], "Inter sudah dependensi (tanpa tambahan)");
  assert.ok(!/@font-face/.test(tipo) && !/SF[- ]?Pro.*\.(woff2?|ttf|otf)/i.test(tipo), "tidak membundel SF Pro");
});

test("ikon Produksi: satu keluarga garis rounded (lucide), nama ekspor lama utuh, peta sidebar lengkap", () => {
  const i = src("components", "produksiIcons.jsx");
  assert.ok(i.includes('from "lucide-react"') && !/<svg|<path|<rect|<circle/.test(i), "tanpa SVG duotone kustom");
  assert.ok(i.includes("const BOBOT = 1.75"), "bobot garis seragam");
  for (const n of ["IkRingkasanProduksi", "IkOrderProduksi", "IkStatusProduksi", "IkRencanaProduksi", "IkBahanProduksi", "IkMeja", "IkCorner", "IkDokumentasi", "IkQc", "IkAndon", "IkLaporanProduksi", "IkBiayaProduksi", "IkKomplainProduksi", "IkPengaturanProduksi", "IkTarget", "IkSelesai", "IkProses", "IkJam", "IkAwas", "IkKotak", "IkDokumen", "IkTruk", "IkBaki", "IkPeriksa", "IkJadwal", "IkOrang", "IkMuatUlang", "IkPanahKanan", "IkGrip"]) assert.ok(new RegExp(`export const ${n} =`).test(i), n);
  assert.equal((i.match(/^\s+"\/(bengkel|produksi)\/[a-z0-9-]+": Ik/gm) || []).length, 14, "14 rute sidebar");
  assert.ok(/svg\.lucide[^}]*stroke-width: 1\.75/.test(tipo), "ikon kontrol lucide memakai bobot yang sama");
  assert.ok(!/[\u{1F300}-\u{1FAFF}]/u.test(i), "tanpa emoji");
});

test("filter: popover berkelompok dengan DRAF — Terapkan, Batal, Esc, klik di luar; Reset = definisi yang sama dengan Reset chip", () => {
  const f = src("features", "production", "FilterLainnya.jsx"); const p = src("pages", "bengkel", "ProductionWorkOrders.jsx");
  assert.ok(f.includes("useState(() => ({ tab: nilai.tab") && f.includes("onClick={() => onTerapkan(draf)}") && f.includes("onClick={onBatal}") && f.includes("onClick={onResetSemua}"), "draf lokal + tiga aksi");
  assert.ok(f.includes('disabled={!adaPerubahan}'), "Terapkan nonaktif tanpa perubahan");
  assert.ok(f.includes('type={tipe}') && f.includes('tipe = "checkbox"') && f.includes('tipe="radio"') && f.includes("<select"), "checkbox/radio/select yang jelas");
  assert.ok(!f.includes("api.") && !f.includes("fetch("), "tidak menulis/memuat sendiri");
  assert.ok(p.includes('role="dialog" aria-label="Filter order produksi" data-testid="filter-popover"'), "popover berrole dialog");
  assert.ok(p.includes('document.addEventListener("pointerdown", luar, true)') && p.includes('e.key === "Escape"'), "klik di luar dan Esc menutup (membuang draf)");
  assert.ok(p.includes("const resetDariFilter = () => { hapusFilter(); tutupFilter(); };") && p.includes("onResetSemua={resetDariFilter}"), "Reset di popover = hapusFilter yang sama dengan chip");
  assert.ok(p.includes("const terapkanFilter = (d) => { setPosisi(d.posisi); setPic(d.pic); setTarget(d.target); setKelengkapan(d.kelengkapan); if (sempit) { setTab(d.tab); setKerja(d.kerja); } tutupFilter(); };"), "Terapkan menerapkan semua sekaligus");
  assert.ok(p.includes("lebarKontainer < 900") && p.includes("new ResizeObserver") && p.includes("{!sempit && tabsShown.length > 0 && <FilterDropdown"), "kontrol pendukung pindah ke Filter menurut lebar KONTAINER");
  assert.ok(p.includes("const sempit = hp ||"), "HP juga sempit");
  assert.ok(p.includes("hp && (") && p.includes("<PanelSamping open={lainnyaBuka}") && p.includes("isiFilter(true)"), "HP: lembar dengan isi yang sama");
  assert.ok(p.includes("--prod-pop-maks"), "tinggi popover mengikuti sisa layar");
  const c = css.slice(css.indexOf("Filter Order Produksi: popover berkelompok"));
  assert.ok(/\.prod-ol-popover \{[^}]*position: absolute[^}]*max-height:[^}]*overflow: hidden/.test(c) && /\.prod-fl-gulir \{[^}]*overflow-y: auto/.test(c) && /\.prod-fl-kaki \{[^}]*position: static/.test(c), "tinggi terbatas, isi menggulir, footer tetap");
  assert.ok(/\.prod-fl-cek \{[^}]*min-height: 44px/.test(c), "area sentuh 44px");
  assert.ok(!p.includes('className="prod-ol-lainnya-isi"'), "tidak ada blok panjang di dalam daftar lagi");
  assert.ok(p.includes("<ChipFilterAktif chip={chip} onHapus={hapusChip} onReset={hapusFilter}"), "chip + Reset saat popover ditutup");
});

test("panel unit: 'Data order belum dinilai' berdiri sendiri; HPP tetap terpisah dari kelengkapan data order", () => {
  const k = src("features", "production", "KelengkapanBagian.jsx");
  assert.ok(k.includes('data-testid="data-order-belum-dinilai-baris"') && k.includes("Data order belum dinilai</p>"), "baris sendiri");
  assert.ok(k.includes('className={it.key === "HPP_BELUM_LENGKAP" ? "hpp" : undefined}') && !k.includes('items.map((it) => it.label).join(" · ")'), "tiap kekurangan (termasuk HPP) chip sendiri, tidak digabung");
  assert.ok(k.includes("DATA_ORDER_BELUM_DINILAI_TEKS") && !/belum dinilai[^"]*lengkap/i.test(k.split("DATA_ORDER_BELUM_DINILAI_TEKS")[0].slice(-0)), "tidak menyiratkan lengkap");
});
