// Sumber layar Pesanan Pembelian (PO) = halaman + berkas di features/finance/po (setelah redesain dipecah per bagian). Tes pemasangan membaca gabungannya.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const akar = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
export function sumberPO() {
  const dir = path.join(akar, "features", "finance", "po");
  const bagian = fs.readdirSync(dir).filter((f) => /\.(jsx|js)$/.test(f)).sort().map((f) => fs.readFileSync(path.join(dir, f), "utf8"));
  return [fs.readFileSync(path.join(akar, "pages", "finance", "FinancePurchaseOrders.jsx"), "utf8"), ...bagian].join("\n").replace(/\r\n/g, "\n");
}
