// Fase 2 milestone — pemakaian status global tingkat order/unit di workspace (text-scan; tanpa jsdom).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
