import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
const require = createRequire(process.cwd() + "/");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const BASE = process.env.SMOKE_BASE ?? "http://127.0.0.1:4000"; // rehearsal menjalankan kode smoke YANG SAMA terhadap salinan restore
const APP = process.env.APP_DIR ?? "/app";
let fail = 0;
const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + String(d).slice(0, 240) : ""}`); };
// SMOKE "TIDAK MENULIS" perbaikan batas cutover: hanya membaca. Rilis ini TIDAK mengubah cutover, PSA, sakelar stok resmi, atau data bisnis.
const imp = (p) => import(pathToFileURL(path.join(APP, p)).href);
const nilai = async () => ({
  pengaturan: JSON.stringify(await prisma.$queryRawUnsafe("select key, value from fin_settings where key like 'inventory_%' or key like 'stok_resmi_%' order by key")),
  pembuka: JSON.stringify(await prisma.$queryRawUnsafe("select number, status::text status from fin_inventory_openings order by number")),
  baris_pembuka: Number((await prisma.$queryRawUnsafe("select count(*)::int n from fin_inventory_opening_lines"))[0].n),
});
const s0 = await nilai();
rec("health 200", (await fetch(BASE + "/api/health").then((r) => r.status, () => 0)) === 200);
const inv = await imp("src/services/finance/posting/inventory.js").catch(() => null);
rec("hari bisnis WIB terpasang", typeof inv?.hariBisnisWIB === "function" && inv.hariBisnisWIB(new Date("2026-11-08T21:30:00.000Z")).toISOString().slice(0, 10) === "2026-11-09");
const psa = await imp("src/services/finance/persediaanAwal.js").catch(() => null);
rec("penjaga penerimaan terlambat terpasang", typeof psa?.penerimaanTercakupPembuka === "function");
rec("sakelar stok resmi tidak dihidupkan oleh rilis", !/"value":"true"/.test(s0.pengaturan));
const s1 = await nilai();
rec("SMOKE tidak menulis: pengaturan persediaan, sakelar stok resmi, dan PSA sama", JSON.stringify(s0) === JSON.stringify(s1));
console.log(`SMOKE_HASIL fail=${fail} skip=0`);
await prisma.$disconnect();
process.exit(fail === 0 ? 0 : 1);
