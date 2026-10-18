// Fase 2 milestone — pemakaian status global tingkat order/unit di workspace (text-scan; tanpa jsdom).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { milestoneRedundan, STATUS_ORDER_LABEL } from "../src/features/orders/milestoneLogic.js";
const here = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => fs.readFileSync(path.join(here, "..", "src", ...p), "utf8");

test("komponen bersama: tidak menampilkan apa pun untuk order legacy/tanpa unit; mixed menampilkan rincian unit lebih maju; hanya memformat nilai server", () => {
  const c = read("components", "OrderMilestoneBadge.jsx");
  assert.match(c, /if \(!m \|\| m\.legacy \|\| !m\.label\) return null;/);
  assert.match(c, /milestone\.mixed && milestone\.aheadText/); assert.match(c, /Lainnya: \{milestone\.aheadText\}/);
  assert.match(c, /statusTone\(milestone\.key\)/);
  assert.doesNotMatch(c, /paymentStatus|BELUM_BAYAR|LUNAS/, "pembayaran bukan sumbu status global");
});

test("workspace memakai badge yang sama: Sales Orders (tabel+kartu), detail order + riwayat, Pipeline, Delivery (job+order), Warehouse, mobile; field status lama tetap", () => {
  assert.equal((read("pages", "Orders.jsx").match(/<OrderMilestoneBadge milestone=\{(o|order)\.milestone\}/g) || []).length, 2);
  assert.match(read("pages", "Orders.jsx"), /<StatusSelect order=\{o\} onChange=\{handleStatusChange\} \/>/, "StatusSelect lama tetap");
  assert.equal((read("components", "customer", "OrderSection.jsx").match(/<OrderMilestoneBadge milestone=/g) || []).length, 2);
  assert.match(read("features", "pipeline", "components", "KanbanCard.jsx"), /card\.latestOrderMilestone/);
  assert.match(read("pages", "armada", "ArmadaOrders.jsx"), /<OrderMilestoneBadge milestone=\{o\.milestone\}/);
  assert.match(read("features", "armada", "components", "JobBadges.jsx"), /job\?\.orderMilestone/);
  assert.match(read("pages", "warehouse", "WarehouseUnitCustody.jsx"), /<UnitGlobalStatusBadge globalStatus=\{item\.globalStatus\}/);
  const mobile = fs.readFileSync(path.join(here, "..", "..", "mobile", "src", "screens", "OrdersScreen.js"), "utf8");
  assert.match(mobile, /order\.milestone && !order\.milestone\.legacy/);
});

test("Unit 360: bagian Waktu alur menampilkan enam durasi dan 'Data waktu belum tersedia' dari server", () => {
  const d = read("features", "production", "UnitOverviewDrawer.jsx");
  assert.match(d, /function WaktuAlur\(\{ timeline \}\)/); assert.match(d, /<WaktuAlur timeline=\{d\.timeline\} \/>/);
  assert.match(d, /timeline\.durations\.map/); assert.match(d, /x\.text/);
});

test("badge milestone yang hanya mengulang status order disembunyikan; yang menambah info tetap tampil (satu status, bukan dua)", () => {
  assert.equal(milestoneRedundan({ status: "DELIVERED" }, { key: "TERKIRIM", label: "Terkirim", summary: "Terkirim · 3 unit" }), true, "kasus order Indra: Terkirim + Terkirim · 3 unit");
  assert.equal(milestoneRedundan({ status: "READY" }, { key: "SIAP_KIRIM", label: "Siap Kirim" }), true);
  assert.equal(milestoneRedundan({ status: "SHIPPING" }, { key: "DALAM_PENGIRIMAN", label: "Dalam Pengiriman" }), true);
  assert.equal(milestoneRedundan({ status: "PROCESSING" }, { key: "DITERIMA_WORKSHOP", label: "Diterima di Workshop" }), false, "label beda = tambahan info");
  assert.equal(milestoneRedundan({ status: "DELIVERED" }, { key: "TERKIRIM", label: "Terkirim", mixed: true }), false, "unit berbeda posisi tetap ditampilkan");
  assert.equal(milestoneRedundan(null, { label: "Terkirim" }), false);
  assert.equal(milestoneRedundan({ status: "DELIVERED" }, null), false);
  assert.ok(read("components", "OrderMilestoneBadge.jsx").includes("milestoneRedundan(order, milestone)"));
  const hitung = (isi, kunci) => isi.split(kunci).length - 1;
  assert.equal(hitung(read("pages", "Orders.jsx"), "order={o} className") + hitung(read("pages", "Orders.jsx"), "milestone={order.milestone} order={order}"), 2);
  assert.equal(hitung(read("components", "customer", "OrderSection.jsx"), "order={order} />") >= 1 && hitung(read("components", "customer", "OrderSection.jsx"), "order={o} showAhead"), 1);
  assert.equal(hitung(read("pages", "armada", "ArmadaOrders.jsx"), "milestone={o.milestone} order={o}"), 1);
});

test("Delivery › Semua Order: order Penjualan Karyawan membaca pembayaran dari PKR (bukan Order.paymentStatus 'Belum Bayar'); nominal 'di Finance'", () => {
  const a = read("pages", "armada", "ArmadaOrders.jsx");
  assert.ok(a.includes("o.penjualanKaryawan.pembayaran ? <BadgeBayarPkr pkr={o.penjualanKaryawan} />"));
  assert.ok(a.includes(">Di Finance</Badge>"));
  assert.ok(a.includes(">di Finance</span> : formatRupiah"));
});

test("peta label status di milestoneLogic = ORDER_STATUS_LABELS di utils/format.js (paritas)", () => {
  const fmt = fs.readFileSync(path.join(here, "..", "src", "utils", "format.js"), "utf8");
  const blok = fmt.slice(fmt.indexOf("export const ORDER_STATUS_LABELS"), fmt.indexOf("};", fmt.indexOf("export const ORDER_STATUS_LABELS")));
  for (const [k, v] of Object.entries(STATUS_ORDER_LABEL)) assert.ok(blok.includes(k + ': "' + v + '"'), k + " harus " + v);
});
