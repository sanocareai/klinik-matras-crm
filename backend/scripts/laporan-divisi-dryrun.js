// DRY-RUN & VERIFIKASI LAPORAN DIVISI — BACA-SAJA (hanya SELECT; tidak ada create/update/delete, tidak menyentuh sakelar, jurnal, saldo, payment, order, atau transaksi produksi).
//   docker compose exec -T backend node scripts/laporan-divisi-dryrun.js --from 2026-09-01 --to 2026-10-31
// Keluaran JSON: (1) dryRun atribusi — jumlah + nilai yang teratribusi pasti / biaya bersama / tidak terklasifikasi / konflik (tanpa menebak divisi);
// (2) laporan per divisi per bulan memakai objek akses sintetik (semua divisi) — angka yang SAMA dengan yang akan tampil di layar Finance setelah sakelar dinyalakan.
import { prisma } from "../src/db.js";
import { dryRunAtribusi } from "../src/services/finance/laporanDivisi/dryRun.js";
import { bangunLaporan } from "../src/services/finance/laporanDivisi/laporan.js";
import { SEMUA_KELOMPOK } from "../src/services/finance/laporanDivisi/divisi.js";
import { LEVEL } from "../src/services/finance/laporanDivisi/akses.js";

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const TGL = /^\d{4}-\d{2}-\d{2}$/;
const from = arg("from", "2026-09-01"); const to = arg("to", "2026-10-31");
if (!TGL.test(from) || !TGL.test(to) || from > to) { console.error("Gunakan --from YYYY-MM-DD --to YYYY-MM-DD"); process.exit(1); }

// Akses sintetik setara Finance (semua divisi, termasuk Biaya Bersama & Tidak Terklasifikasi). Tidak ada hubungannya dengan sakelar produksi.
const akses = { sakelar: { aktif: true, workspace: [] }, level: LEVEL.SEMUA, scopes: new Map(SEMUA_KELOMPOK.map((s) => [s, "LEADER"])), semua: true };

function bulanBulan(a, b) {
  const out = []; let [y, m] = a.slice(0, 7).split("-").map(Number); const [y2, m2] = b.slice(0, 7).split("-").map(Number);
  while (y < y2 || (y === y2 && m <= m2)) { out.push(`${y}-${String(m).padStart(2, "0")}`); m += 1; if (m > 12) { m = 1; y += 1; } }
  return out;
}
const akhirBulan = (ym) => { const [y, m] = ym.split("-").map(Number); return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`; };

try {
  const dry = await dryRunAtribusi(prisma, { from, to });
  const perBulan = [];
  for (const ym of bulanBulan(from, to)) {
    const f = ym === from.slice(0, 7) ? from : `${ym}-01`; const t = ym === to.slice(0, 7) ? to : akhirBulan(ym);
    const lap = await bangunLaporan(prisma, { from: f, to: t, scopeDiminta: [], filter: {}, akses });
    perBulan.push({
      bulan: ym, from: f, to: t, ringkasan: lap.ringkasan, jembatan: lap.jembatan,
      divisi: lap.divisi.map((d) => ({ scope: d.scope, label: d.label, aktual: d.aktual, kasKeluar: d.kasKeluar, komitmen: d.komitmen, nDokumen: d.nDokumen, anggaran: d.anggaran, kelompok: d.kelompok, komponenLain: d.komponenLain, tahap: d.tahap, konflik: d.konflik })),
    });
  }
  console.log(JSON.stringify({ periode: { from, to }, bacaSaja: true, dryRun: dry, perBulan }, null, 2));
} finally {
  await prisma.$disconnect();
}
