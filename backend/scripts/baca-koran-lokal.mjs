// BACA-SAJA, tanpa database: telaah satu berkas rekening koran dengan parser sistem (bankRekon/parse.js) lalu tulis hasil ke berkas JSON LOKAL (di luar repo).
//   node scripts/baca-koran-lokal.mjs "<berkas.xlsx>" "<keluar.json>"
import fs from "node:fs";
import { telaahBerkas } from "../src/services/finance/bankRekon/parse.js";

const [, , masuk, keluar] = process.argv;
const buf = fs.readFileSync(masuk);
const t = await telaahBerkas(buf, masuk);
console.log("format", t.format, "| baris judul", t.barisJudul, "| urutan", t.urutan);
console.log("pemetaan", JSON.stringify(t.pemetaan));
console.log("header", JSON.stringify(t.headers));
console.log("baris terbaca", t.baris.length, "| galat", t.galat.length, "| dilewati", t.dilewati.length, "| rantai saldo", JSON.stringify({ ...t.rantaiSaldo, putus: undefined }));
for (const g of t.galat.slice(0, 10)) console.log("  GALAT", JSON.stringify(g));
for (const d of t.dilewati.slice(0, 10)) console.log("  LEWAT", JSON.stringify(d));
fs.writeFileSync(keluar, JSON.stringify({ baris: t.baris, rantaiSaldo: t.rantaiSaldo, dilewati: t.dilewati, galat: t.galat, headers: t.headers }, null, 1));
