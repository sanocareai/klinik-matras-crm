#!/usr/bin/env node
// Koreksi "pengiriman manual masuk rute yang sudah selesai" (kasus Rika RES-03102026-018-U1 → RTE-161026-02). Logika ada di services/koreksiPengirimanRute.js (diuji di
// tests/integration/adminOverrideSiapKirim.integration.test.js Q9–Q20); skrip ini hanya pembungkus CLI.
//
//   PRATINJAU (bawaan, BACA-SAJA — aman di production, tidak membuka transaksi tulis):
//     node scripts/koreksi-pengiriman-rute.js --unit=RES-03102026-018-U1 --rute=RTE-161026-02 --tanggal=2026-10-16 --foto=/app/uploads/<berkas>.jpg [--foto-sha256=<hash>]
//     (jam serah-terima terbukti? pakai --waktu=<ISO> sebagai ganti --tanggal; jam TIDAK diketahui? pakai --tanggal saja)
//   PENERAPAN (menulis; hanya atas persetujuan Owner):
//     node scripts/koreksi-pengiriman-rute.js --terapkan --unit=... --rute=... (--tanggal=... | --waktu=...) --foto=... --foto-sha256=... --aktor=<userId ADMIN/OWNER> --alasan="..." --catatan-bukti="..." --konfirmasi=KOREKSI-RES-03102026-018-U1
//
// Tanpa --terapkan skrip TIDAK PERNAH menulis. Dengan --terapkan: --aktor, --alasan (>=10 karakter), waktu (--waktu ATAU --tanggal), --foto, dan --konfirmasi harus sama persis "KOREKSI-<kode unit>".
// --rehearsal: terapkan di dalam transaksi yang SELALU dibatalkan (untuk salinan DB); berkas foto yang disalin dihapus lagi.
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { pratinjauKoreksiPengirimanRute, terapkanKoreksiPengirimanRute, terapkanKoreksiPengirimanRuteInTx, periksaBerkasFoto, KoreksiRuteError, JOB_PHOTOS_DIR_DEFAULT } from "../src/services/koreksiPengirimanRute.js";

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
  const tanggal = typeof args.tanggal === "string" ? args.tanggal : null;
  const foto = typeof args.foto === "string" ? { path: args.foto, sha256: typeof args["foto-sha256"] === "string" ? args["foto-sha256"] : null, keterangan: typeof args["sumber-foto"] === "string" ? args["sumber-foto"] : args.foto } : null;
  const jobPhotosDir = typeof args["dir-bukti"] === "string" ? args["dir-bukti"] : JOB_PHOTOS_DIR_DEFAULT;
  const catatanBukti = typeof args["catatan-bukti"] === "string" ? args["catatan-bukti"] : null;

  if (!args.terapkan && !args.rehearsal) {
    const p = await pratinjauKoreksiPengirimanRute(prisma, { unitCode, routeCode, waktuTerkirim: waktu, tanggalKejadian: tanggal, foto, jobPhotosDir, catatanBukti });
    console.log(JSON.stringify({ mode: "PRATINJAU_BACA_SAJA", ...p }, null, 2));
    process.exitCode = p.layak || p.sudahDiterapkan ? 0 : 2;
  } else {
    if (!waktu && !tanggal) throw new KoreksiRuteError("--waktu atau --tanggal wajib untuk penerapan", "ARGUMEN", 400);
    if (!args.rehearsal && args.konfirmasi !== `KOREKSI-${unitCode}`) throw new KoreksiRuteError(`--konfirmasi harus persis KOREKSI-${unitCode}`, "KONFIRMASI_SALAH", 400);
    const masukan = { unitCode, routeCode, aktorId: args.aktor, waktuTerkirim: waktu, tanggalKejadian: tanggal, alasan: args.alasan, namaPenerima: typeof args.penerima === "string" ? args.penerima : null, catatanBukti };
    if (args.rehearsal) {
      // Rehearsal: berkas disalin ke direktori bukti SEMENTARA lalu dihapus; transaksi selalu dibatalkan.
      const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || "/tmp", "koreksi-reh-"));
      let hasil = null;
      try {
        const bukti = foto ? (() => { const f = periksaBerkasFoto(foto.path, { sha256Diharapkan: foto.sha256 }); return { urls: ["/media/job-photos/rehearsal-tidak-ditulis" + f.ext], sha256: f.sha256, ukuranByte: f.ukuranByte, mime: f.mime, sumber: foto.keterangan }; })() : null;
        await prisma.$transaction(async (tx) => { hasil = await terapkanKoreksiPengirimanRuteInTx(tx, { ...masukan, bukti }); throw new Batal(); }).catch((e) => { if (!(e instanceof Batal)) throw e; });
      } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
      console.log(JSON.stringify({ mode: "REHEARSAL_DIBATALKAN", hasil }, null, 2));
    } else {
      const hasil = await terapkanKoreksiPengirimanRute(prisma, { ...masukan, foto, jobPhotosDir });
      console.log(JSON.stringify({ mode: "DITERAPKAN", hasil }, null, 2));
    }
  }
} catch (e) {
  console.error(JSON.stringify({ galat: e.message, kode: e.code ?? null, extra: e.extra ?? null }));
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
