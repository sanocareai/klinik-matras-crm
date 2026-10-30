// Angka acuan dari DATABASE SALINAN backup produksi (SQL langsung, bukan lewat layanan yang diuji) untuk satu periode lead WIB. Hanya agregat; tidak mencetak data customer.
//   DB=km_prodcopy_20261030_test DARI=2026-10-01 SAMPAI=2026-10-29 OUT=C:/tmp/km-mkt-prodcopy node marketing-rekon-salinan-db.cjs
const { execFileSync } = require("child_process"); const fs = require("fs"); const path = require("path");
const DB = process.env.DB || "km_prodcopy_20261030_test"; const OUT = process.env.OUT || "C:/tmp/km-mkt-prodcopy";
const DARI = process.env.DARI || "2026-10-01", SAMPAI = process.env.SAMPAI || "2026-10-29";
if (!/test/i.test(DB)) throw new Error("DB harus mengandung 'test'");
const sql = (q) => execFileSync("docker", ["exec", "km_sanss-postgres-1", "psql", "-U", "klinik", "-d", DB, "-Atc", q], { encoding: "utf8" }).trim();
const n = (q) => Number(sql(q));
// batas WIB → UTC: [dari 00:00 WIB, sampai+1 00:00 WIB)
const lo = `(timestamp '${DARI} 00:00:00' - interval '7 hours')`, hi = `(timestamp '${SAMPAI} 00:00:00' + interval '1 day' - interval '7 hours')`;
const dalam = `"createdAt" >= ${lo} and "createdAt" < ${hi}`;
const rekon = {
  periode: { dari: DARI, sampai: SAMPAI }, salinanProduksi: true, snapshotMaxCustomer: sql(`select max("createdAt") from "Customer"`),
  customerDibuat: n(`select count(*) from "Customer" where ${dalam}`),
  spam: n(`select count(*) from "Customer" where ${dalam} and "pipelineStage" = 'SPAM' and "leadSource" not in ('B2B_DIRECT','PENJUALAN_KARYAWAN')`),
  b2bKaryawan: n(`select count(*) from "Customer" where ${dalam} and "leadSource" in ('B2B_DIRECT','PENJUALAN_KARYAWAN')`),
  // informatif (BUKAN kontrak eligible): customer dibuat di periode dengan ≥ 1 order non-batal — pembanding kasar untuk ber-order
  berOrderKasar: n(`select count(distinct c.id) from "Customer" c join "Order" o on o."customerId" = c.id where c."createdAt" >= ${lo} and c."createdAt" < ${hi} and o.status <> 'CANCELLED' and c."leadSource" not in ('B2B_DIRECT','PENJUALAN_KARYAWAN')`),
  tabel: { customer: n(`select count(*) from "Customer"`), order: n(`select count(*) from "Order"`), pembayaran: n(`select count(*) from payments`), touch: n(`select count(*) from attribution_touches`), spendEntri: n(`select count(*) from ad_source_spend_entries`) },
  fixture: false,
};
fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, "rekon.json"), JSON.stringify(rekon, null, 2));
console.log(JSON.stringify(rekon));
