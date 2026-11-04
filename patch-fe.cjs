const fs = require("fs");
// 1) Laporan Gudang: hilangkan KPI angka ketiga dari ringkasan utama
let p = "frontend/src/pages/warehouse/WarehouseReports.jsx"; let s = fs.readFileSync(p, "utf8");
s = s.replace('import { KPI_LAMA } from "@/features/warehouse/nilaiPersediaan/nilaiPersediaanLogic.js";\n', "");
const a = s.indexOf("              <KpiCard\n                label={KPI_LAMA.label}"); const b = s.indexOf("              <KpiCard\n                label=\"Receipt Lead Time\"");
if (a < 0 || b < 0) throw new Error("blok KPI tidak ditemukan"); s = s.slice(0, a) + s.slice(b); fs.writeFileSync(p, s);
// 2) api.js
p = "frontend/src/api.js"; s = fs.readFileSync(p, "utf8");
const tanda = "  getNilaiPersediaan: (waktu) =>"; if (!s.includes(tanda)) throw new Error("api tanda");
s = s.replace(tanda, '  // Hasil SO per bahan (pengamatan satuan lain / nol dikonfirmasi): berizin inventory:write, Idempotency-Key wajib, append-only. TIDAK menulis ledger.\n  catatHasilSO: (body, idempotencyKey) => request("/inventory/nilai-persediaan/hasil-so", { method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: JSON.stringify(body) }),\n  getRiwayatHasilSO: (materialId) => request(`/inventory/nilai-persediaan/hasil-so/${materialId}`),\n' + tanda);
fs.writeFileSync(p, s); console.log("ok");
