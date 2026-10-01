// Membangun docs/FINANCE-KONTRAK-METRIK.md dari kontrak metrik (satu sumber: services/finance/kontrakMetrik.js). Jalankan: node scripts/finance-kontrak-doc.js
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { METRIK, KELOMPOK, BASIS, GLOSARIUM } from "../src/services/finance/kontrakMetrik.js";

const keluar = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../docs/FINANCE-KONTRAK-METRIK.md");
const sel = (t) => String(t).replace(/\|/g, "\|").replace(/\n/g, " ");
const nama = (k) => METRIK.find((m) => m.kunci === k)?.nama ?? k;
let md = `# Finance — Kontrak Metrik Kanonis (Fase 1)\n\n> DIBANGUN OTOMATIS dari \`backend/src/services/finance/kontrakMetrik.js\` — jangan edit di sini. Ubah kontraknya lalu jalankan \`node backend/scripts/finance-kontrak-doc.js\`.\n\nZona waktu semua tanggal: WIB (UTC+7); database & API UTC.\n\n## Basis tanggal\n\n| Kunci | Arti | Sumber teknis |\n|---|---|---|\n`;
for (const b of Object.values(BASIS)) md += `| ${b.kunci} | ${sel(b.label)} | ${sel(b.teknis)} |\n`;
md += `\n## Istilah yang harus dibedakan\n\n| Istilah | Arti singkat | Metrik |\n|---|---|---|\n`;
for (const [i, k, a] of GLOSARIUM) md += `| ${i} | ${sel(a)} | \`${k}\` |\n`;
for (const [kel, label] of Object.entries(KELOMPOK)) {
  const daftar = METRIK.filter((m) => m.kelompok === kel);
  if (!daftar.length) continue;
  md += `\n## ${label}\n`;
  for (const m of daftar) {
    md += `\n### ${m.nama} (\`${m.kunci}\`)\n\n${m.definisi}\n\n| | |\n|---|---|\n| Rumus | ${sel(m.rumus)} |\n| Sumber | ${sel(m.sumber)} |\n| Status dihitung | ${sel(m.status)} |\n| Basis tanggal | ${BASIS[m.basis].label} |\n| Termasuk | ${sel(m.termasuk.join("; ") || "—")} |\n| Tidak termasuk | ${sel(m.tidakTermasuk.join("; ") || "—")} |\n| Pasangan rekonsiliasi | ${sel(m.pasangan.map(nama).join("; ") || "—")} |\n| Tampil di | ${sel(m.halaman.join("; "))} |\n| Export | ${sel(m.ekspor.join(", ") || "—")} |\n`;
  }
}
fs.writeFileSync(keluar, md);
console.log("ditulis", keluar, METRIK.length, "metrik");
