// Dijalankan di dalam IMAGE LAMA (yang sedang melayani produksi) terhadap salinan restore yang SUDAH bermigrasi dan berisi entri biaya uji: bukti rollback kode aman.
// Kode lama tidak mengenal tabel baru; ia harus tetap menghitung /sumber, laporan iklan, dan D7 persis seperti sebelum migrasi. Hanya BACA. Mencetak AGREGAT_LAMA=<json> (sama bentuk dengan AGREGAT_BARU).
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const DARI = process.env.PER_DARI, SAMPAI = process.env.PER_SAMPAI;
const hariIni = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
const { hitungSumberPerforma } = await import("/app/src/services/attribution/sumber.js");
let gagal = 0; let n = 0;
const cek = (nama, ok, d = "") => { n += 1; if (!ok) gagal += 1; console.log(`${ok ? "OK   " : "GAGAL"} ${nama}${d ? " — " + d : ""}`); };
const tabelBaru = Number((await prisma.$queryRawUnsafe("select count(*)::int n from pg_tables where schemaname='public' and tablename in ('ad_source_spend_entries','ad_source_spend_revisions')"))[0].n);
const entri = Number((await prisma.$queryRawUnsafe("select count(*)::int n from ad_source_spend_entries"))[0].n);
cek("image LAMA berjalan terhadap DB bermigrasi (2 tabel baru ada, berisi entri uji)", tabelBaru === 2 && entri > 0, `tabel=${tabelBaru} entri=${entri}`);
const j = await hitungSumberPerforma(prisma, { dari: DARI, sampai: SAMPAI, hariIni, bawaan: false });
cek("kode LAMA menghitung /sumber tanpa galat: 6 sumber", j.sumber.length === 6);
const A = Object.fromEntries(j.sumber.map((x) => [x.id, [x.lead, x.spam, x.leadSah, x.berOrder, x.membayar, x.lunas, x.pernahDp, x.dpSaatIni, x.uang.nilaiOrderSaatIni, x.uang.uangLedger, x.uang.refund, x.uang.uangBersih]]));
cek("kode LAMA tidak melihat biaya manual (biaya per sumber non-Meta = 'tanpa sumber spend'; tidak ada angka biaya dari tabel baru)", j.sumber.filter((x) => x.id !== "META").every((x) => x.biaya.spend === null && x.biaya.cpa === null));
console.log("AGREGAT_LAMA=" + JSON.stringify(A));
await prisma.$disconnect();
console.log("PEMERIKSAAN=" + n + " gagal=" + gagal);
process.exit(gagal === 0 ? 0 : 1);
