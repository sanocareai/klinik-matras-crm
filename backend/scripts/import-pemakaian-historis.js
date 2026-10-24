// Impor CATATAN PEMAKAIAN HISTORIS (CSV Admin Sales) ke Produksi. TIDAK menulis stok/biaya/jurnal — hanya tabel catatan (unit_usage_notes) + peristiwa.
// Idempoten: berkas yang sama = nol perubahan. Nilai asli berkas disimpan apa adanya; angka janggal hanya ditandai "Perlu dicek".
//
// DEFAULT DRY-RUN (hanya membaca DB, mencetak ringkasan):
//   docker compose exec backend node scripts/import-pemakaian-historis.js /path/Pemakaian-Bahan.csv
//   docker compose exec backend node scripts/import-pemakaian-historis.js /path/Pemakaian-Bahan.csv --apply [--aktor-email=admin@klinikmatras.com]
import fs from "fs";
import path from "path";
import { prisma } from "../src/db.js";
import { rencanakanImpor, terapkanImpor, ringkasRencana, evaluasiUlang } from "../src/services/catatanPemakaianHistoris.js";

const args = process.argv.slice(2);
const berkas = args.find((a) => !a.startsWith("--"));
const APPLY = args.includes("--apply");
const emailAktor = (args.find((a) => a.startsWith("--aktor-email=")) ?? "").split("=")[1];

async function main() {
  if (!berkas) { console.log("Pakai: node scripts/import-pemakaian-historis.js <berkas.csv> [--apply] [--aktor-email=...]"); process.exitCode = 1; return; }
  const csvText = fs.readFileSync(berkas, "utf8");
  const rencana = await rencanakanImpor(prisma, { csvText, namaBerkas: path.basename(berkas) });
  const r = ringkasRencana(rencana);
  console.log(`Berkas ${path.basename(berkas)} sha256 ${rencana.sha256.slice(0, 16)}… — ${r.barisCsv} baris (${r.orderUnik} order), ${r.tanpaOrder} baris tanpa order diabaikan.`);
  console.log("Keadaan catatan:", JSON.stringify(r.state));
  console.log("Penanda 'Perlu dicek':", JSON.stringify(r.flag));
  if (!APPLY) { console.log("\nIni DRY-RUN — tidak ada yang ditulis. Jalankan ulang dengan --apply untuk memuat catatan."); return; }
  const aktor = emailAktor ? await prisma.user.findUnique({ where: { email: emailAktor }, select: { id: true } }) : null;
  if (emailAktor && !aktor) throw new Error(`Pengguna ${emailAktor} tidak ditemukan`);
  const hasil = await terapkanImpor(prisma, rencana, { actorId: aktor?.id ?? null });
  console.log(`Selesai: batch ${hasil.batchBaru ? "baru" : "sudah ada"} ${hasil.batchId}; dibuat ${hasil.dibuat}, dilewati ${hasil.dilewati}.`);
  const ev = await evaluasiUlang(prisma, { actorId: aktor?.id ?? null });
  console.log(`Evaluasi ulang: diperiksa ${ev.diperiksa}, berubah ${ev.berubah}.`);
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
