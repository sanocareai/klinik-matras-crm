// Audit & pratinjau pemetaan kelompok bahan (BACA-SAJA, tanpa database). Masukan: TSV hasil `select code,name,item_group,category,active,kind,unit from materials` (tanpa header).
//   node backend/scripts/audit-kelompok-bahan.mjs materials.tsv [--json]
// Keluaran: sebaran jenis persediaan × kelompok, grup yang dipetakan, grup yang butuh keputusan manual, nilai itemGroup beda huruf besar/kecil, dan bahan yang NAMANYA bertentangan dengan kelompoknya (hanya ditandai, tidak diubah).
import fs from "node:fs";
import { kelompokDariItemGroup, normalkanGrup, KELOMPOK, KELOMPOK_BELUM, GRUP_PERLU_KEPUTUSAN, grupTerpetakan } from "../src/constants/kelompokBahan.js";

const berkas = process.argv[2]; if (!berkas) { console.error("pemakaian: node audit-kelompok-bahan.mjs materials.tsv [--json]"); process.exit(2); }
const baris = fs.readFileSync(berkas, "utf8").split(/\r?\n/).filter(Boolean).map((l) => { const [code, name, itemGroup, category, active, kind, unit] = l.split("\t"); return { code, name, itemGroup, category, aktif: active === "t", kind, unit }; });
// Kata kunci NAMA → kelompok, HANYA untuk mendeteksi pertentangan (peringatan peninjauan), tidak pernah dipakai menetapkan kelompok.
const KATA = [[/\b(BUSA|FOAM|LATEX)\b/i, "BUSA"], [/\bKAIN\b/i, "KAIN"], [/\bBENANG\b/i, "BENANG"], [/\b(BONNEL|POCKET SPRING|PER)\b/i, "PEGAS"], [/\b(KAYU|TRIPLEK)\b/i, "KAYU"], [/\b(LEM|THINER)\b/i, "LEM_KIMIA"]];
const hasil = baris.map((b) => ({ ...b, k: kelompokDariItemGroup(b.itemGroup) }));
const per = (arr, f) => arr.reduce((m, x) => ((m[f(x)] = (m[f(x)] ?? 0) + 1), m), {});
const grupMentah = {}; for (const b of baris) { const k = b.itemGroup || "<kosong>"; (grupMentah[normalkanGrup(k) || "<KOSONG>"] ??= new Set()).add(k); }
const huruf = Object.entries(grupMentah).filter(([, s]) => s.size > 1).map(([n, s]) => `${n}: ${[...s].join(" | ")}`);
const konflik = hasil.filter((h) => h.k.kode !== KELOMPOK_BELUM && h.k.kode !== "LAINNYA").map((h) => ({ h, kata: KATA.filter(([re]) => re.test(h.name)).map(([, k]) => k) })).filter((x) => x.kata.length && !x.kata.includes(x.h.k.kode)).map((x) => ({ kode: x.h.code, nama: x.h.name, itemGroup: x.h.itemGroup, kelompok: x.h.k.kode, namaMenyiratkan: x.kata.join("/") }));
const belum = hasil.filter((h) => h.k.kode === KELOMPOK_BELUM);
const grupBelum = {}; for (const h of belum) (grupBelum[normalkanGrup(h.itemGroup) || "<KOSONG>"] ??= []).push(h);
const nilaiTakDikenal = [...new Set(baris.map((b) => normalkanGrup(b.itemGroup)).filter(Boolean))].filter((g) => !grupTerpetakan().includes(g) && !GRUP_PERLU_KEPUTUSAN.includes(g));
const laporan = {
  totalBahan: baris.length, aktif: baris.filter((b) => b.aktif).length,
  jenisPersediaan: per(baris, (b) => b.category || "TANPA_KATEGORI"),
  kelompok: Object.fromEntries(Object.keys({ ...KELOMPOK, [KELOMPOK_BELUM]: 1 }).map((k) => [k, { semua: hasil.filter((h) => h.k.kode === k).length, aktif: hasil.filter((h) => h.k.kode === k && h.aktif).length }])),
  nilaiItemGroupBedaHuruf: huruf, nilaiItemGroupTakDikenal: nilaiTakDikenal,
  perluKeputusan: Object.entries(grupBelum).map(([g, l]) => ({ itemGroup: g, jumlah: l.length, aktif: l.filter((x) => x.aktif).length, alasan: l[0].k.alasan, bahan: l.map((x) => `${x.code} — ${x.name}${x.aktif ? "" : " (nonaktif)"}`) })),
  namaBertentanganDenganKelompok: konflik,
};
if (process.argv.includes("--json")) { console.log(JSON.stringify(laporan, null, 2)); process.exit(0); }
console.log(`Bahan: ${laporan.totalBahan} (aktif ${laporan.aktif})`); console.log("Jenis persediaan:", JSON.stringify(laporan.jenisPersediaan));
console.log("Kelompok turunan (semua/aktif):"); for (const [k, v] of Object.entries(laporan.kelompok)) console.log(`  ${k.padEnd(10)} ${String(v.semua).padStart(4)} / ${String(v.aktif).padStart(4)}`);
console.log("itemGroup beda huruf besar/kecil:", huruf.length ? "\n  " + huruf.join("\n  ") : "tidak ada"); console.log("itemGroup belum ada di tabel:", nilaiTakDikenal.join(", ") || "tidak ada");
console.log(`Perlu keputusan manual: ${belum.length} bahan`); for (const g of laporan.perluKeputusan) console.log(`  [${g.itemGroup}] ${g.jumlah} bahan (${g.aktif} aktif) — ${g.alasan}`);
console.log(`Nama bertentangan dengan kelompok (hanya ditandai): ${konflik.length}`); for (const k of konflik) console.log(`  ${k.kode} "${k.nama}" grup ${k.itemGroup} → ${k.kelompok}, nama menyiratkan ${k.namaMenyiratkan}`);
