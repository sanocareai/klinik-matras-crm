#!/usr/bin/env node
// Koreksi "pengiriman manual masuk rute yang sudah selesai" (kasus Rika RES-03102026-018-U1 → RTE-161026-02). Logika ada di services/koreksiPengirimanRute.js (diuji di
// tests/integration/adminOverrideSiapKirim.integration.test.js Q9–Q13); skrip ini hanya pembungkus CLI.
//
//   PRATINJAU (bawaan, BACA-SAJA — aman di production, tidak membuka transaksi tulis):
//     node scripts/koreksi-pengiriman-rute.js --unit=RES-03102026-018-U1 --rute=RTE-161026-02 --waktu=2026-10-16T05:30:00Z
//   PENERAPAN (menulis; hanya dijalankan SETELAH kode live dan atas persetujuan Owner):
//     node scripts/koreksi-pengiriman-rute.js --terapkan --unit=... --rute=... --waktu=... --aktor=<userId ADMIN/OWNER> --alasan="..." --konfirmasi=KOREKSI-RES-03102026-018-U1
//
// Tanpa --terapkan skrip TIDAK PERNAH menulis. Dengan --terapkan: --aktor, --alasan (>=10 karakter), --waktu, dan --konfirmasi harus sama persis "KOREKSI-<kode unit>".
// --rehearsal: terapkan di dalam transaksi yang SELALU dibatalkan (untuk salinan DB); hasilnya dicetak lalu semua tulisan dibuang.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { pratinjauKoreksiPengirimanRute, terapkanKoreksiPengirimanRuteInTx, KoreksiRuteError } from "../src/services/koreksiPengirimanRute.js";

function parse(argv) {
  const o = {};
  for (const a of argv) { if (!a.startsWith("--")) continue; const [k, ...v] = a.slice(2).split("="); o[k] = v.length ? v.join("=") : true; }
  return o;
}
class Batal extends Error {}

const args = parse(process.argv.slice(2));
const prisma = new PrismaClient();
try {
  const unitCode = args.unit; const routeCode = args.rute;
  if (!unitCode || !routeCode) throw new KoreksiRuteError("--unit dan --rute wajib", "ARGUMEN", 400);
  const waktu = args.waktu ? new Date(args.waktu) : null;
  if (args.waktu && Number.isNaN(waktu.getTime())) throw new KoreksiRuteError("--waktu bukan tanggal ISO yang valid", "ARGUMEN", 400);

  if (!args.terapkan && !args.rehearsal) {
    const p = await pratinjauKoreksiPengirimanRute(prisma, { unitCode, routeCode, waktuTerkirim: waktu });
    console.log(JSON.stringify({ mode: "PRATINJAU_BACA_SAJA", ...p }, null, 2));
    process.exitCode = p.layak || p.sudahDiterapkan ? 0 : 2;
  } else {
    if (!waktu) throw new KoreksiRuteError("--waktu wajib untuk penerapan", "ARGUMEN", 400);
    if (!args.rehearsal && args.konfirmasi !== `KOREKSI-${unitCode}`) throw new KoreksiRuteError(`--konfirmasi harus persis KOREKSI-${unitCode}`, "KONFIRMASI_SALAH", 400);
    const masukan = { unitCode, routeCode, aktorId: args.aktor, waktuTerkirim: waktu, alasan: args.alasan, namaPenerima: typeof args.penerima === "string" ? args.penerima : null };
    if (args.rehearsal) {
      let hasil = null;
      await prisma.$transaction(async (tx) => { hasil = await terapkanKoreksiPengirimanRuteInTx(tx, masukan); throw new Batal(); }).catch((e) => { if (!(e instanceof Batal)) throw e; });
      console.log(JSON.stringify({ mode: "REHEARSAL_DIBATALKAN", hasil }, null, 2));
    } else {
      const hasil = await prisma.$transaction((tx) => terapkanKoreksiPengirimanRuteInTx(tx, masukan), { timeout: 30000 });
      console.log(JSON.stringify({ mode: "DITERAPKAN", hasil }, null, 2));
    }
  }
} catch (e) {
  console.error(JSON.stringify({ galat: e.message, kode: e.code ?? null, extra: e.extra ?? null }));
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
