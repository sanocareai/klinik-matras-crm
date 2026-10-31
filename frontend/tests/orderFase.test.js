// Fase Order (31 Okt 2026): palet workflow Order & pembayaran (terpisah dari palet tahap), layout, KPI jujur soal cakupan, fungsi dipertahankan.
// Tes statis atas sumber + fungsi murni; tampilan & interaksi terukur di browser terpisah.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ORDER_CHIP, PAYMENT_CHIP, orderStatusChip, paymentChip, STAGE_VARIANT, ORDER_STATUS_VARIANT, PAYMENT_STATUS_VARIANT, ORDER_STATUS_LABELS,
} from "../src/utils/format.js";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baca = (p) => fs.readFileSync(path.join(repo, p), "utf8").replace(/\r\n/g, "\n");
const palet = baca("src/styles/order-palette.css");
const css = baca("src/styles/sanss-crm-order.css");
const cssTanpaKomentar = css.replace(/\/\*[\s\S]*?\*\//g, "");
const halaman = baca("src/pages/Orders.jsx");
const badge = baca("src/components/ui/badge.jsx");

test("Palet workflow Order & pembayaran: pemetaan satu sumber, terpisah dari palet tahap", () => {
  for (const s of Object.keys(ORDER_STATUS_LABELS)) assert.ok(ORDER_CHIP[s], `status ${s} punya chip`);
  assert.deepEqual(PAYMENT_CHIP, { BELUM_BAYAR: "pay-belum", DP: "pay-dp", LUNAS: "pay-lunas" });
  assert.equal(orderStatusChip("TIDAK-ADA"), "ord-neutral");
  assert.equal(paymentChip(undefined), "ord-neutral");
  for (const v of [...new Set([...Object.values(ORDER_CHIP), ...Object.values(PAYMENT_CHIP), "ord-neutral", "ord-ok", "ord-perhatian"])]) assert.ok(badge.includes(`"${v}"`), `Badge variant ${v}`);
  for (const v of Object.values(ORDER_CHIP)) assert.ok(!Object.values(STAGE_VARIANT).includes(v), "tidak memakai varian tahap pipeline");
  // pemetaan lama untuk modul lain TIDAK diubah
  assert.equal(ORDER_STATUS_VARIANT.PENDING, "warning");
  assert.equal(PAYMENT_STATUS_VARIANT.LUNAS, "success");
});

test("Menunggu = amber (perlu perhatian), Dibatalkan & Belum Bayar = merah, Terkirim & Lunas = hijau, progres kerja = titik berwarna di latar netral", () => {
  const dot = (n) => palet.match(new RegExp(`--${n}-dot:\\s*(#[0-9A-Fa-f]{6})`))[1];
  const hue = (hex) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255); const mx = Math.max(r, g, b), mn = Math.min(r, g, b); const d = mx - mn; if (!d) return 0; const h = Math.round(60 * (mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4)); return (h + 360) % 360; };
  assert.ok(hue(dot("ord-pending")) >= 30 && hue(dot("ord-pending")) <= 50, "amber");
  assert.ok(hue(dot("ord-cancelled")) <= 10 || hue(dot("ord-cancelled")) >= 350, "merah");
  assert.ok(hue(dot("pay-belum")) <= 10 || hue(dot("pay-belum")) >= 350, "merah");
  assert.ok(hue(dot("ord-delivered")) >= 140 && hue(dot("ord-delivered")) <= 160, "hijau");
  assert.ok(hue(dot("pay-lunas")) >= 140 && hue(dot("pay-lunas")) <= 160, "hijau");
  for (const k of ["PICKUP", "PROCESSING", "READY", "SHIPPING"]) assert.ok(new RegExp(`\\[data-ord="${k}"\\][^}]*--ord-bg: var\\(--ord-neutral-bg\\)`).test(palet) || new RegExp(`\\.ord-${k.toLowerCase()}, \\[data-ord="${k}"[^}]*--ord-bg: var\\(--ord-neutral-bg\\)`).test(palet), `${k} berlatar netral`);
});

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lum = ([r, g, b]) => { const t = [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * t[0] + 0.7152 * t[1] + 0.0722 * t[2]; };
const rasio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const token = (blok, nama) => blok.match(new RegExp(`--${nama}:\\s*([^;]+);`))[1].trim();
test("Kontras teks chip ≥ 4,5:1 (terang solid; gelap rgba di atas panel #17182F dan kanvas #0D0E20) — termasuk 'Menunggu' yang dulu 4,45:1", () => {
  const terang = palet.slice(palet.indexOf(":root {"), palet.indexOf(':root[data-theme="dark"]'));
  const gelap = palet.slice(palet.indexOf(':root[data-theme="dark"]'), palet.indexOf("/* Pemetaan"));
  const pasangan = ["ord-neutral", "ord-pending", "ord-delivered", "ord-cancelled", "pay-belum", "pay-dp", "pay-lunas"];
  for (const t of pasangan) {
    assert.ok(rasio(hex(token(terang, `${t}-fg`)), hex(token(terang, `${t}-bg`))) >= 4.5, `terang ${t}`);
    for (const latar of ["#17182F", "#0D0E20"]) {
      const bg = token(gelap, `${t}-bg`); const dasar = hex(latar);
      const efektif = bg.startsWith("#") ? hex(bg) : (() => { const [r, g, b, a] = bg.match(/[\d.]+/g).map(Number); return [r, g, b].map((v, i) => v * a + dasar[i] * (1 - a)); })();
      assert.ok(rasio(hex(token(gelap, `${t}-fg`)), efektif) >= 4.5, `gelap ${t} di ${latar}`);
    }
  }
  assert.ok(rasio(hex(token(terang, "ord-pending-fg")), hex(token(terang, "ord-pending-bg"))) > 4.45);
});

test("Konsumen Sales CRM memakai palet workflow, bukan warna lokal: Orders, kartu Pipeline, Pelanggan, Inbox", () => {
  assert.ok(!/const (STATUS_TONE|PAYMENT_TONE) = \{/.test(halaman), "peta warna lokal Orders dihapus");
  assert.ok(halaman.includes("badgeVariants({ variant: orderStatusChip(v) })") && halaman.includes("badgeVariants({ variant: paymentChip(v) })"));
  assert.ok(!/ORDER_STATUS_TONE\s*=/.test(baca("src/features/pipeline/components/KanbanCard.jsx")) && baca("src/features/pipeline/components/KanbanCard.jsx").includes("orderStatusChip(card.latestOrderStatus)"));
  assert.ok(baca("src/features/customers/components/CustomersTable.jsx").includes("orderStatusChip(c.latestOrderStatus)"));
  assert.ok(baca("src/features/inbox/components/CustomerPanel/ActiveOrderCard.jsx").includes("paymentChip(order.paymentStatus)"));
  assert.ok(baca("src/features/orders/ReadinessBadge.jsx").includes('"ord-ok" : "ord-perhatian"'));
});

test("KPI: empat prioritas + 'Metrik lainnya' (enam metrik lama); rumus & sumber tetap; cakupan ditulis jujur", () => {
  for (const k of ['l: "Total Order"', 'l: "Nilai Order"', 'l: "Belum Lunas"', "l: `Mandek ≥${MANDEK_HARI} hari`"]) assert.ok(halaman.includes(k), k);
  for (const k of ['l: "Total pelanggan"', 'l: "Repeat order"', 'l: "AOV"', 'l: "Lunas"', 'l: "Rata-rata proses"', 'l: "Komplain"']) assert.ok(halaman.includes(k), k);
  // sumber/rumus tidak berubah
  for (const k of ["data?.summary?.totalOrderAktif ?? itemsAktif.length", "data?.summary?.nilaiOrderAktif ?? itemsAktif.reduce", "data?.summary?.belumLunas ?? itemsAktif.filter", "const lunas = Math.max(totalNilai - belumLunas, 0);", "const totalMandek = items.filter(isMandek).length;", "const MANDEK_HARI = 7;"]) assert.ok(halaman.includes(k), k);
  // cakupan: agregat vs daftar dimuat, tidak menyatakan semuanya agregat penuh
  assert.ok(halaman.includes('const cakupanAgregat = ') && halaman.includes("const cakupanDimuat = data?.truncated"));
  assert.ok(halaman.includes("Mandek dan metrik lainnya dihitung dari order yang dimuat di layar"));
  assert.ok(halaman.includes("belum mengikuti filter Mandek/Diproses"), "agregat server belum mengikuti filter yang hanya diterapkan di browser");
  assert.ok(!/semua (angka|ringkasan) (di atas )?(adalah )?agregat penuh/i.test(halaman));
});

test("Toolbar: pencarian, tanggal, filter utama, Papan/Tabel, Refresh, Export satu kelompok; filter tambahan di 'Filter lainnya'", () => {
  const t = halaman.slice(halaman.indexOf('className="crm-ord-toolbar"'), halaman.indexOf("crm-ord-filter-lain\" className"));
  for (const k of ['aria-label="Cari order"', "<DateRangePicker", 'ariaLabel="Filter status order"', 'ariaLabel="Filter status pembayaran"', 'ariaLabel="Filter sales person"', "Filter lainnya", "Mandek", 'aria-label="Tampilan Papan"', 'aria-label="Tampilan Tabel"', 'aria-label="Refresh daftar order"', 'aria-label="Export order ke Excel"']) assert.ok(t.includes(k) || halaman.includes(k), k);
  const lain = halaman.slice(halaman.indexOf('id="crm-ord-filter-lain"'), halaman.indexOf("fStatus === \"PROCESSING\" && ("));
  for (const k of ['ariaLabel="Filter status unit produksi"', 'ariaLabel="Filter kategori"', 'ariaLabel="Filter penjual', 'ariaLabel="Filter tahap pipeline"', 'ariaLabel="Filter promo"']) assert.ok(lain.includes(k), k);
  assert.ok(css.includes("@media (max-width: 767px)") && css.includes(".crm-ord-cari-wadah { flex: 1 1 100%;") && css.includes(".crm-ord-refresh-teks"), "HP: pencarian penuh, Refresh/Export ikon");
});

test("Kartu: lima makna dipisahkan (Order, Bayar, Pipeline, Milestone, jadwal logistik) dan semua dropdown/tindakan dipertahankan", () => {
  for (const k of ['<BarisLabel label="Order">', '<BarisLabel label="Bayar">', '<BarisLabel label="Pipeline">', '<BarisLabel label="Milestone">', "<StatusSelect", "<PaymentStatusSelect", "<PipelineStageSelect", "<OrderMilestoneBadge", "<ReadinessBadge", "JOB_STATUS_REAL[j.status]", "Dijadwal Ulang", "REVISION_STATUS[order.activeRevision.status]", "bolehDibukaLagiUntukPengiriman(order)", "onOpenTimeline(order)", "onOpenChat(order)", "namaSalesKredit(order)", "<DaftarUnitPkr", "<BadgeBayarPkr", "crm-ord-progres"]) assert.ok(halaman.includes(k), k);
  assert.ok(halaman.includes("if (!e.currentTarget.contains(e.target)) return;"), "klik item menu (portal) tidak membuka rincian");
  // aturan transisi/endpoint tidak berubah
  for (const k of ["api.updateOrder(order.id, { status: newStatus })", "api.updateCustomer(order.customerId, { pipelineStage: newStage })", "api.updateOrder(order.id, { paymentStatus: newPayment })", "api.reopenOrderForDelivery(order.id)", "const KANBAN_BUCKETS = [", "orderStatusesForCategory(order.category)"]) assert.ok(halaman.includes(k), k);
});

test("CSS Order: semua aturan di bawah .crm-skin .crm-ord; tanpa font/@import/url(); papan lebar minimum + gulir", () => {
  const sel = cssTanpaKomentar.split("}").map((b) => b.split("{")[0].trim()).filter(Boolean).join(",").split(",").map((s) => s.trim()).filter((s) => s && !s.startsWith("@"));
  for (const s of sel) assert.ok(s.includes(".crm-skin .crm-ord"), `selektor di luar halaman: ${s}`);
  assert.ok(!/font-family|@font-face|@import|url\(/.test(cssTanpaKomentar));
  assert.ok(halaman.includes("min-w-[280px]") && halaman.includes("overflow-x-auto"));
  assert.ok(baca("src/main.jsx").includes('import "./styles/order-palette.css";') && baca("src/main.jsx").includes('import "./styles/sanss-crm-order.css";'));
});

test("PWA tidak tersentuh", () => {
  const vite = baca("vite.config.js");
  assert.ok(vite.includes('display: "standalone"') && vite.includes("injectManifest") && !/order-palette|sanss-crm-order/.test(vite));
});
