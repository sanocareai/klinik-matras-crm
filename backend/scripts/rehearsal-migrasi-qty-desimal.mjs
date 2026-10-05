// REHEARSAL migrasi 20261016090000_penjualan_karyawan_qty_desimal — dua jalur, pada DB SEMENTARA (nama km_rh_*; tidak pernah menyentuh DB lain):
//   FRESH   : semua migrasi dari nol → kolom Decimal(12,3) + CHECK ada.
//   UPGRADE : semua migrasi KECUALI yang baru → isi data lama (jumlah bulat, termasuk batas 1 dan 1000, harga 2 desimal) → sidik jari → terapkan migrasi baru → sidik jari harus IDENTIK
//             (nilai jumlah sama, Σ(qty×harga) per dokumen sama, jumlah baris sama), tipe kolom berubah, CHECK menolak 0/negatif, pecahan 3 desimal diterima.
// Jalankan:  node scripts/rehearsal-migrasi-qty-desimal.mjs     (butuh Postgres lokal seperti tes integrasi; DATABASE tidak diubah selain DB sementara)
import { TEST_DATABASE_URL } from "../tests/integration/setup/env.js";
import { PrismaClient } from "@prisma/client";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const MIG = "20261016090000_penjualan_karyawan_qty_desimal";
const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const POLA = /^km_rh_[a-z0-9]+_\d+$/;
const dasar = new URL(TEST_DATABASE_URL);
const urlDb = (nama) => { const u = new URL(dasar); u.pathname = `/${nama}`; return u.toString(); };
const ident = (n) => { if (!POLA.test(n)) throw new Error("nama DB tidak aman: " + n); return `"${n}"`; };
let gagal = 0;
const cek = (nama, ok, d = "") => { if (!ok) gagal++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${nama}${d ? " — " + d : ""}`); };

const admin = new PrismaClient({ datasources: { db: { url: urlDb("postgres") } } });
const sementara = [];
async function buatDb(tag) {
  const nama = `km_rh_${tag}_${process.pid}`;
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${ident(nama)} WITH (FORCE)`);
  await admin.$executeRawUnsafe(`CREATE DATABASE ${ident(nama)}`);
  sementara.push(nama);
  return nama;
}
const deploy = (nama, schema) => execFileSync("npx", ["prisma", "migrate", "deploy", "--schema", schema], { cwd: backendRoot, env: { ...process.env, DATABASE_URL: urlDb(nama) }, stdio: "pipe", shell: true }).toString();

// Salinan prisma/ TANPA migrasi baru (untuk menyiapkan skema "lama")
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rehearsal-"));
fs.mkdirSync(path.join(tmp, "prisma"));
fs.copyFileSync(path.join(backendRoot, "prisma/schema.prisma"), path.join(tmp, "prisma/schema.prisma"));
fs.cpSync(path.join(backendRoot, "prisma/migrations"), path.join(tmp, "prisma/migrations"), { recursive: true, filter: (src) => !src.includes(MIG) });
const sqlMig = fs.readFileSync(path.join(backendRoot, "prisma/migrations", MIG, "migration.sql"), "utf8");

try {
  console.log("== FRESH: semua migrasi dari nol");
  const fresh = await buatDb("fresh");
  deploy(fresh, path.join(backendRoot, "prisma/schema.prisma"));
  const pf = new PrismaClient({ datasources: { db: { url: urlDb(fresh) } } });
  const tipeF = await pf.$queryRawUnsafe(`select data_type, numeric_precision, numeric_scale from information_schema.columns where table_name='fin_penjualan_karyawan_items' and column_name='quantity'`);
  cek("fresh: quantity = numeric(12,3)", tipeF[0]?.data_type === "numeric" && Number(tipeF[0].numeric_precision) === 12 && Number(tipeF[0].numeric_scale) === 3, JSON.stringify(tipeF[0]));
  const chkF = await pf.$queryRawUnsafe(`select conname from pg_constraint where conname='fin_penjualan_karyawan_items_qty_chk'`);
  cek("fresh: CHECK jumlah > 0 ada", chkF.length === 1);
  const st = deploy(fresh, path.join(backendRoot, "prisma/schema.prisma"));
  cek("fresh: migrate deploy ulang = tidak ada yang tertunda (idempoten)", /No pending migrations/i.test(st));
  await pf.$disconnect();

  console.log("== UPGRADE: skema lama + data lama → migrasi baru");
  const up = await buatDb("upgrade");
  deploy(up, path.join(tmp, "prisma/schema.prisma"));
  const pu = new PrismaClient({ datasources: { db: { url: urlDb(up) } } });
  const tipeLama = await pu.$queryRawUnsafe(`select data_type from information_schema.columns where table_name='fin_penjualan_karyawan_items' and column_name='quantity'`);
  cek("upgrade (sebelum): quantity masih integer", tipeLama[0]?.data_type === "integer");
  const user = await pu.user.create({ data: { name: "Emon", email: `emon-${Date.now()}@example.test`, passwordHash: "x", role: "PRODUCTION_WORKER" } });
  const dokumen = [
    { items: [[1, "1300000.00"], [2, "150000.00"]] },
    { items: [[1000, "1.00"], [1, "99999999.99"], [7, "0.01"]] },
    { items: [[13, "86000.00"], [6, "49950.50"], [2, "20000.00"]] },
  ];
  let n = 0;
  for (const [di, d] of dokumen.entries()) {
    const id = randomUUID();
    const total = d.items.reduce((s, [q, h]) => s + q * Number(h), 0).toFixed(2);
    await pu.$executeRawUnsafe(`INSERT INTO fin_penjualan_karyawan (id, nomor, date, seller_id, buyer_name, total, status, created_by, created_at, updated_at) VALUES ('${id}', 'PKR-RH-${di}', '2026-10-02', '${user.id}', 'Pembeli', ${total}, 'AKTIF', '${user.id}', now(), now())`);
    for (const [i, [q, h]] of d.items.entries()) { await pu.$executeRawUnsafe(`INSERT INTO fin_penjualan_karyawan_items (id, penjualan_id, name, quantity, unit_price, sort_order) VALUES (gen_random_uuid(), '${id}', 'item ${n++}', ${q}, ${h}, ${i})`); }
  }
  const sidik = () => pu.$queryRawUnsafe(`select count(*)::int n, md5(coalesce(string_agg(id::text||'|'||trunc(quantity)::text||'|'||unit_price::text||'|'||sort_order::text||'|'||name, ';' order by id),'')) h, sum(quantity*unit_price)::text jumlah, min(quantity)::text mn, max(quantity)::text mx, count(*) filter (where quantity <> trunc(quantity))::int pecahan from fin_penjualan_karyawan_items`);
  const perDok = () => pu.$queryRawUnsafe(`select p.nomor, p.total::text, coalesce(sum(i.quantity*i.unit_price),0)::text hitung from fin_penjualan_karyawan p left join fin_penjualan_karyawan_items i on i.penjualan_id=p.id group by p.id, p.nomor, p.total order by p.nomor`);
  const sebelum = (await sidik())[0], dokSebelum = await perDok();
  cek("upgrade (sebelum): data lama terisi", sebelum.n === 8, JSON.stringify(sebelum));

  // terapkan migrasi baru lewat jalur resmi (schema penuh)
  const out = deploy(up, path.join(backendRoot, "prisma/schema.prisma"));
  cek("upgrade: migrate deploy menerapkan migrasi baru", out.includes(MIG), "");
  const sesudah = (await sidik())[0], dokSesudah = await perDok();
  cek("upgrade: jumlah baris identik", sesudah.n === sebelum.n);
  cek("upgrade: sidik jari seluruh baris (id, jumlah, harga, urutan, nama) IDENTIK", sesudah.h === sebelum.h, `${sebelum.h} -> ${sesudah.h}`);
  cek("upgrade: Σ(jumlah × harga) identik", Number(sesudah.jumlah) === Number(sebelum.jumlah), `${sebelum.jumlah} -> ${sesudah.jumlah}`);
  cek("upgrade: min/max jumlah sama dan tidak ada pecahan hasil migrasi", Number(sesudah.mn) === Number(sebelum.mn) && Number(sesudah.mx) === Number(sebelum.mx) && sesudah.pecahan === 0, `${sesudah.mn}..${sesudah.mx}`);
  cek("upgrade: total tiap dokumen tetap = Σ item (tidak ada selisih)", dokSebelum.length === dokSesudah.length && dokSebelum.every((d, i) => d.nomor === dokSesudah[i].nomor && Number(d.total) === Number(dokSesudah[i].total) && Number(d.hitung) === Number(dokSesudah[i].hitung)) && dokSesudah.every((d) => Number(d.total) === Number(d.hitung)), JSON.stringify(dokSesudah.map((d) => [d.nomor, d.total])));
  const tipeBaru = await pu.$queryRawUnsafe(`select data_type, numeric_precision, numeric_scale from information_schema.columns where table_name='fin_penjualan_karyawan_items' and column_name='quantity'`);
  cek("upgrade: quantity = numeric(12,3)", tipeBaru[0]?.data_type === "numeric" && Number(tipeBaru[0].numeric_scale) === 3);
  const cobaTulis = async (q) => { try { await pu.$executeRawUnsafe(`INSERT INTO fin_penjualan_karyawan_items (id, penjualan_id, name, quantity, unit_price, sort_order) SELECT gen_random_uuid(), id, 'uji', ${q}, 1000, 99 FROM fin_penjualan_karyawan LIMIT 1`); return true; } catch { return false; } };
  cek("upgrade: jumlah 0 ditolak CHECK", (await cobaTulis("0")) === false);
  cek("upgrade: jumlah negatif ditolak CHECK", (await cobaTulis("-1")) === false);
  cek("upgrade: jumlah pecahan 1.600 diterima dan tersimpan persis", (await cobaTulis("1.600")) === true && (await pu.$queryRawUnsafe(`select quantity::text q from fin_penjualan_karyawan_items where name='uji'`))[0].q === "1.600");
  cek("upgrade: isi migrasi hanya 2 pernyataan (ALTER TYPE + ADD CONSTRAINT CHECK)", sqlMig.split("\n").filter((l) => l.trim() && !l.trim().startsWith("--")).length === 2);
  await pu.$disconnect();
} finally {
  for (const n of sementara) { try { await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${ident(n)} WITH (FORCE)`); console.log(`  (DB sementara ${n} dihapus)`); } catch (e) { console.error("gagal hapus", n, e.message); } }
  await admin.$disconnect();
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`\nRINGKASAN rehearsal: ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
