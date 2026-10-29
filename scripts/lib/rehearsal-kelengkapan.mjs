import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
const require = createRequire(process.cwd() + "/");
const { PrismaClient } = require("@prisma/client");
const jwt = require("jsonwebtoken");
const express = require("express");
const ExcelJS = require("exceljs");
const prisma = new PrismaClient();
// REH_SRC hanya untuk uji lokal skrip ini; di rehearsal sebenarnya kode kandidat ada di /app/src (image baru).
const imp = (p) => import(process.env.REH_SRC ? pathToFileURL(path.join(process.env.REH_SRC, p)).href : "/app/src/" + p);
process.env.JWT_SECRET ||= "rehearsal-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
const { productionRouter } = await imp("routes/production.js");
const { productionAdopsiRouter } = await imp("routes/productionAdopsi.js");
const { prisma: appPrisma } = await imp("db.js");
let operasi = 0; appPrisma.$use(async (params, next) => { operasi += 1; return next(params); }); // hitung operasi Prisma yang dipicu aplikasi (deteksi permintaan per unit)
let gagal = 0; let n = 0;
const cek = (nama, ok, d = "") => { n += 1; if (!ok) gagal += 1; console.log(`${ok ? "OK   " : "GAGAL"} ${nama}${d ? " — " + d : ""}`); };
const num = async (q) => Number((await prisma.$queryRawUnsafe(q))[0].n);
const ts = Date.now().toString(36); let seq = 0; const kunci = (t) => `reh-kl-${t}-${ts}-${++seq}-aaaa`;
const ms = (t0) => Math.round(Number(process.hrtime.bigint() - t0) / 1e6);

// Tabel yang TIDAK BOLEH berubah oleh fitur ini (stok, Material Issue, jurnal/valuasi Finance, harga operasional, jadwal/Run).
const TETAP = ["stock_movements", "material_issues", "material_issue_lines", "fin_journal_entries", "fin_journal_lines", "fin_stock_movement_valuations", "material_harga_berlaku", "stock_movement_biaya_operasional", "production_unit_schedules", "production_unit_schedule_events", "production_runs_v2", "production_run_plans_v2", "units", "Order"];
const fp = async (tabel) => { const o = {}; for (const t of tabel) o[t] = (await prisma.$queryRawUnsafe(`select count(*)::int n, coalesce(md5(string_agg(x::text, '|' order by x::text)),'') h from "${t}" x`))[0]; return o; };
const beda = (a, b) => Object.keys(a).filter((t) => a[t].n !== b[t].n || a[t].h !== b[t].h);

// ── A. struktur (kode baru terhadap hasil restore nyata + migrasi) ──
cek("tabel pernyataan ada dan KOSONG setelah migrasi (tanpa backfill/pernyataan massal)", (await num("select count(*) as n from unit_material_declarations")) === 0);
const nUnit = await num('select count(*) as n from units'); const nUnitNonBatal = await num("select count(*) as n from units where status <> 'CANCELLED'");
console.log(`INFO  salinan restore: ${nUnit} unit (${nUnitNonBatal} non-batal), ${await num("select count(*) as n from unit_usage_notes")} catatan historis, ${await num("select count(*) as n from stock_movements where type = 'ISSUE' and unit_id is not null")} ISSUE bertaut unit, ${await num("select count(*) as n from unit_provisional_usages")} pemakaian sementara`);

// ── B. pelaku (pengguna uji PADA SALINAN) + aplikasi ──
const mkUser = async (nama, role) => { const u = await prisma.user.create({ data: { name: `Uji Rehearsal ${nama}`, email: `reh-kl-${ts}-${nama}@example.test`, passwordHash: "x", role } }); await prisma.userRole.create({ data: { userId: u.id, role } }).catch(() => {}); return { ...u, token: jwt.sign({ id: u.id, name: u.name, role: u.role, roles: [u.role] }, process.env.JWT_SECRET, { expiresIn: "2h" }) }; };
const admin = await mkUser("admin", "ADMIN"); const sales = await mkUser("sales", "SALES");
const app = express(); app.use(express.json()); app.use("/api/production", productionRouter); app.use("/api/production", productionAdopsiRouter);
const server = await new Promise((res) => { const s = app.listen(0, "127.0.0.1", () => res(s)); });
const BASE = `http://127.0.0.1:${server.address().port}/api/production`;
const http = async (u, method, p, body, headers = {}) => { const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(u ? { Authorization: "Bearer " + u.token } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch { /* bukan JSON */ } return { status: r.status, body: j }; };
const AKTIF = "displayStatus=PENGAMBILAN,DIPROSES,SIAP_KIRIM";

const fp0 = await fp(TETAP);
const evt0 = await num("select count(*) as n from activity_events"); const decl0 = await num("select count(*) as n from unit_material_declarations");

// ── C. jumlah per kategori pada salinan restore (BACA-SAJA) ──
const hitAktif = (await http(admin, "GET", `/work-orders/kelengkapan-hitung?${AKTIF}`)).body;
const hitSemua = (await http(admin, "GET", "/work-orders/kelengkapan-hitung")).body;
const hitRiwayat = (await http(admin, "GET", "/work-orders/kelengkapan-hitung?displayStatus=TERKIRIM")).body;
cek("hitungan server tersedia (lingkup Aktif, Semua, Terkirim)", !!hitAktif?.counts && !!hitSemua?.counts && !!hitRiwayat?.counts);
const tampil = (nama, h) => console.log(`HITUNG ${nama}: unit=${h.totalUnit} unik_berkekurangan=${h.unik} | bahan_belum_dicatat=${h.counts.BAHAN_BELUM_DICATAT} bahan_perlu_dicek=${h.counts.BAHAN_PERLU_DICEK} hpp_belum_lengkap=${h.counts.HPP_BELUM_LENGKAP} data_order_kurang=${h.counts.DATA_ORDER_KURANG} | data_order lengkap=${h.dataOrder.lengkap} kurang=${h.dataOrder.kurang} belum_dinilai=${h.dataOrder.belumDinilai}`);
tampil("AKTIF", hitAktif); tampil("TERKIRIM(riwayat)", hitRiwayat); tampil("SEMUA", hitSemua);
cek("konsistensi: total filter di daftar = hitungan server untuk SETIAP kategori (lingkup Aktif) dan gabungan = unit unik", await (async () => {
  for (const k of ["BAHAN_BELUM_DICATAT", "BAHAN_PERLU_DICEK", "HPP_BELUM_LENGKAP", "DATA_ORDER_KURANG"]) { const t = (await http(admin, "GET", `/work-orders?${AKTIF}&kelengkapan=${k}&pageSize=1`)).body.total; if (t !== hitAktif.counts[k]) { console.log(`      ${k}: daftar=${t} hitung=${hitAktif.counts[k]}`); return false; } }
  return (await http(admin, "GET", `/work-orders?${AKTIF}&kelengkapan=BAHAN_BELUM_DICATAT,BAHAN_PERLU_DICEK,HPP_BELUM_LENGKAP,DATA_ORDER_KURANG&pageSize=1`)).body.total === hitAktif.unik;
})());
cek("jumlah unit Terkirim berkekurangan (riwayat) dapat ditemukan lewat lingkup Riwayat dan sama dengan hitungan", (await http(admin, "GET", "/work-orders?displayStatus=TERKIRIM&kelengkapan=BAHAN_BELUM_DICATAT,BAHAN_PERLU_DICEK,HPP_BELUM_LENGKAP,DATA_ORDER_KURANG&pageSize=1")).body.total === hitRiwayat.unik);

// aturan 1 pada data nyata: unit yang lolos HANYA karena status resmi order
{
  const lolos = []; let page = 1; let hasMore = true;
  while (hasMore && page <= 30) { const r = (await http(admin, "GET", `/work-orders?kelengkapan=BAHAN_BELUM_DICATAT&pageSize=200&page=${page}`)).body; for (const u of r.units) lolos.push(u); hasMore = r.hasMore; page += 1; }
  const resmiOrder = lolos.filter((u) => u.adopsi.kelengkapan.dasarBahan === "STATUS_RESMI_ORDER");
  console.log(`INFO  Bahan belum dicatat (semua lingkup): ${lolos.length} unit; dasar STATUS_RESMI_UNIT=${lolos.filter((u) => u.adopsi.kelengkapan.dasarBahan === "STATUS_RESMI_UNIT").length}, STATUS_RESMI_ORDER=${resmiOrder.length} (status kerja tertinggal: ${resmiOrder.map((u) => `${u.unitCode}[unit ${u.status}/order ${u.order?.status}/kerja ${u.adopsi.kerja.key}]`).join(", ") || "-"}), STATUS_KERJA=${lolos.filter((u) => u.adopsi.kelengkapan.dasarBahan === "STATUS_KERJA").length}`);
  cek("aturan 1: unit pada order Siap Kirim/Dikirim/Terkirim tetapi unitnya tertinggal TIDAK lolos dari filter", (await prisma.$queryRawUnsafe(`select count(*)::int n from units u join "Order" o on o.id = u.order_id where u.status in ('RECEIVED','IN_PRODUCTION') and o.status::text in ('READY','SHIPPING','DELIVERED')`))[0].n === resmiOrder.length + (await prisma.$queryRawUnsafe(`select count(*)::int n from units u join "Order" o on o.id = u.order_id where u.status in ('RECEIVED','IN_PRODUCTION') and o.status::text in ('READY','SHIPPING','DELIVERED') and (exists (select 1 from stock_movements s where s.unit_id = u.id and s.type = 'ISSUE') or exists (select 1 from unit_provisional_usages p where p.unit_id = u.id and p.status <> 'DIBATALKAN') or exists (select 1 from unit_usage_notes c where c.unit_id = u.id and c.state <> 'TIDAK_DIHITUNG'))`))[0].n);
  cek("aturan 2: seluruh data order non-PKR berstatus BELUM_DINILAI (tidak ada yang 'lengkap' tanpa aturan)", hitSemua.dataOrder.belumDinilai > 0 && hitSemua.dataOrder.lengkap + hitSemua.dataOrder.kurang === (await num(`select count(*) as n from units u join "Order" o on o.id = u.order_id where u.status <> 'CANCELLED' and o.penjualan_karyawan_id is not null`)));
}

// ── D. WAKTU RESPONS + deteksi permintaan per unit ──
const ukur = async (nama, fn, { ulang = 5, batas = 10000 } = {}) => {
  const waktu = []; let ops0 = 0; let ukuran = 0;
  for (let i = 0; i < ulang + 1; i++) { operasi = 0; const t0 = process.hrtime.bigint(); const r = await fn(); waktu.push(ms(t0)); if (i === 0) ops0 = operasi; ukuran = r?.ukuran ?? ukuran; if (r && r.ok === false) { cek(`respons ${nama} berhasil`, false, JSON.stringify(r).slice(0, 200)); return null; } }
  const dingin = waktu[0]; const hangat = waktu.slice(1).sort((a, b) => a - b); const p50 = hangat[Math.floor(hangat.length / 2)]; const maks = Math.max(...waktu);
  console.log(`WAKTU ${nama.padEnd(70)} dingin=${String(dingin).padStart(5)} ms | hangat p50=${String(p50).padStart(5)} ms maks=${String(Math.max(...hangat)).padStart(5)} ms | operasi DB=${ops0}${ukuran ? ` | ${ukuran} byte` : ""}`);
  cek(`waktu ${nama} di bawah batas ${batas} ms (maks ${maks} ms)`, maks < batas);
  return { dingin, p50, maks, ops: ops0 };
};
const get = async (p) => { const r = await http(admin, "GET", p); return { ok: r.status === 200, total: r.body?.total, n: r.body?.units?.length }; };
const ekspor = async (q) => { const r = await fetch(BASE + `/work-orders/export.xlsx${q}`, { headers: { Authorization: "Bearer " + admin.token } }); const b = Buffer.from(await r.arrayBuffer()); return { ok: r.status === 200 && b.length > 1000, ukuran: b.length, buf: b }; };
const gab = "kelengkapan=BAHAN_BELUM_DICATAT,BAHAN_PERLU_DICEK,HPP_BELUM_LENGKAP,DATA_ORDER_KURANG";
const dari90 = new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10); const hariIni = new Date().toISOString().slice(0, 10);
const t1 = await ukur("daftar Aktif halaman 1 (50 baris, tanpa filter kelengkapan)", () => get(`/work-orders?${AKTIF}&pageSize=50`));
const t10 = await ukur("daftar Aktif halaman 1 (10 baris)", () => get(`/work-orders?${AKTIF}&pageSize=10`));
cek(`TANPA permintaan per unit: operasi DB daftar 50 baris (${t1?.ops}) ≈ 10 baris (${t10?.ops}) — selisih ≤ 4`, !!t1 && !!t10 && Math.abs(t1.ops - t10.ops) <= 4 && t1.ops < 120);
const t200 = await ukur("daftar Aktif 200 baris (batas halaman)", () => get(`/work-orders?${AKTIF}&pageSize=200`));
cek(`TANPA permintaan per unit: operasi DB 200 baris (${t200?.ops}) ≈ 10 baris (${t10?.ops}) — selisih ≤ 4`, !!t200 && !!t10 && Math.abs(t200.ops - t10.ops) <= 4);
await ukur("hitungan kelengkapan lingkup Aktif", async () => ({ ok: (await http(admin, "GET", `/work-orders/kelengkapan-hitung?${AKTIF}`)).status === 200 }));
await ukur("hitungan kelengkapan lingkup Semua (seluruh unit)", async () => ({ ok: (await http(admin, "GET", "/work-orders/kelengkapan-hitung")).status === 200 }));
await ukur("filter tunggal Bahan belum dicatat — halaman 1 (50)", () => get(`/work-orders?${AKTIF}&kelengkapan=BAHAN_BELUM_DICATAT&pageSize=50&page=1`));
await ukur("filter tunggal Bahan belum dicatat — halaman 2 (pagination)", () => get(`/work-orders?${AKTIF}&kelengkapan=BAHAN_BELUM_DICATAT&pageSize=50&page=2`));
await ukur("filter tunggal Bahan belum dicatat — lingkup Semua halaman 3", () => get(`/work-orders?kelengkapan=BAHAN_BELUM_DICATAT&pageSize=50&page=3`));
await ukur("filter GABUNGAN 4 kategori × lingkup Semua × urut terlama — halaman 1", () => get(`/work-orders?${gab}&urut=terlama&pageSize=50&page=1`));
await ukur("filter GABUNGAN × status kerja Selesai × periode 90 hari × terlama — halaman 2", () => get(`/work-orders?${gab}&statusKerja=SELESAI&dari=${dari90}&sampai=${hariIni}&urut=terlama&pageSize=50&page=2`));
await ukur("filter GABUNGAN × pencarian teks × periode", () => get(`/work-orders?${gab}&q=RES-&dari=${dari90}&sampai=${hariIni}&pageSize=50`));
await ukur("ekspor Excel dengan filter gabungan (periode 90 hari, terlama)", () => ekspor(`?${gab}&dari=${dari90}&sampai=${hariIni}&urut=terlama`), { ulang: 2, batas: 30000 });
const eksporSemua = await ukur("ekspor Excel SEMUA unit (tanpa filter)", () => ekspor(""), { ulang: 2, batas: 30000 });
{ const x = await ekspor(`?${gab}`); const wb = new ExcelJS.Workbook(); await wb.xlsx.load(x.buf); const ws = wb.getWorksheet("Ringkasan Unit");
  const semuaTotal = (await http(admin, "GET", `/work-orders?${gab}&pageSize=1`)).body.total;
  cek(`ekspor = daftar yang sama: baris ekspor (${ws.rowCount - 1}) = total daftar (${semuaTotal}) untuk filter gabungan`, ws.rowCount - 1 === semuaTotal); }
{ const contoh = (await http(admin, "GET", `/work-orders?${gab}&pageSize=3`)).body.units;
  let i = 0; await ukur("drawer unit (adopsi + kelengkapan + pernyataan) — satu unit", async () => ({ ok: (await http(admin, "GET", `/units/${contoh[i++ % contoh.length].id}/adopsi`)).status === 200 }), { ulang: 3 }); }

// ── E. BACA-SAJA: seluruh pengukuran di atas tidak menulis apa pun ──
const fp1 = await fp(TETAP);
cek("daftar/hitungan/filter/ekspor/drawer BACA-SAJA: tabel stok, Material Issue, jurnal, harga, jadwal/Run, unit, order IDENTIK; tidak ada peristiwa audit baru", beda(fp0, fp1).length === 0 && (await num("select count(*) as n from activity_events")) === evt0 && (await num("select count(*) as n from unit_material_declarations")) === decl0, beda(fp0, fp1).join(","));

// ── F. pernyataan + pertentangan + bersamaan, PADA SALINAN ──
// utamakan unit BELUM terkirim (pencatatan sementara pada unit terkirim butuh alasan pembetulan); cadangan: unit terkirim dengan alasan pembetulan + tanggal hari ini (WIB)
const semuaKand = (await http(admin, "GET", `/work-orders?kelengkapan=BAHAN_BELUM_DICATAT&pageSize=200`)).body.units.filter((u) => u.status !== "CANCELLED");
const urutKand = process.env.REH_URUT === "terkirim" ? (a, b) => (b.status === "DELIVERED") - (a.status === "DELIVERED") : (a, b) => (a.status === "DELIVERED") - (b.status === "DELIVERED");
const kandidat = [...semuaKand].sort(urutKand).slice(0, 12);
const tglWib = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10); const pembetulan = { alasanPembetulan: "Uji rehearsal pada salinan restore", tanggalPemakaian: tglWib };
cek(`tersedia unit nyata 'Bahan belum dicatat' pada salinan untuk skenario tulis (${kandidat.length}; belum terkirim: ${kandidat.filter((u) => u.status !== "DELIVERED").length})`, kandidat.length >= 6);
const [uA, uB, ...sisa] = kandidat; const hitung0 = (await http(admin, "GET", "/work-orders/kelengkapan-hitung")).body;
const url = (u) => `/units/${u.id}/pernyataan-tanpa-bahan`;
const bukti = async (u) => (await http(admin, "GET", `/work-orders?q=${encodeURIComponent(u.unitCode)}&pageSize=5`)).body.units.find((x) => x.id === u.id);
const f1 = await http(admin, "POST", url(uA), { alasan: "ok" }, { "Idempotency-Key": kunci("a") }); cek("alasan terlalu pendek ditolak (400)", f1.status === 400);
const f2 = await http(admin, "POST", url(uA), { alasan: "Rehearsal: hanya servis, tanpa bahan" }, { "Idempotency-Key": kunci("a") }); cek("pernyataan disimpan (201) atas nama pengguna uji", f2.status === 201 && f2.body.pernyataan.status === "ACTIVE");
const sudah = await bukti(uA); cek("unit yang dinyatakan hilang dari 'Bahan belum dicatat'; dasar bahan & HPP-karena-bahan ikut hilang", !sudah.adopsi.kelengkapan.keys.includes("BAHAN_BELUM_DICATAT") && !sudah.adopsi.kelengkapan.keys.includes("HPP_BELUM_LENGKAP"));
const hitung1 = (await http(admin, "GET", "/work-orders/kelengkapan-hitung")).body; cek("hitungan 'Bahan belum dicatat' turun tepat 1 setelah pernyataan", hitung1.counts.BAHAN_BELUM_DICATAT === hitung0.counts.BAHAN_BELUM_DICATAT - 1);
cek("Sales ditolak (403) menyatakan", (await http(sales, "POST", url(uB), { alasan: "Sales mencoba menyatakan" }, { "Idempotency-Key": kunci("s") })).status === 403);
// pertentangan: pernyataan lalu catatan sementara ditambahkan kemudian
const p1 = await http(admin, "POST", url(uB), { alasan: "Rehearsal: pernyataan lalu bahan dicatat" }, { "Idempotency-Key": kunci("b") }); cek("pernyataan unit B disimpan", p1.status === 201);
const s1 = await http(admin, "POST", `/units/${uB.id}/provisional-usages`, { name: "BAHAN REHEARSAL BELUM DI KATALOG", qty: 1, uom: "KG", originNote: "Beli sendiri", alasanPencatatan: "Uji rehearsal pada salinan", ...pembetulan }, { "Idempotency-Key": kunci("sem") }); cek("catatan bahan sementara ditambahkan SESUDAH pernyataan (201)", s1.status === 201, JSON.stringify(s1.body).slice(0, 120));
const kb = await bukti(uB); cek("pernyataan BERTENTANGAN terdeteksi: Bahan perlu dicek (PERNYATAAN_BERTENTANGAN); tidak tersembunyi", kb.adopsi.kelengkapan.pernyataanBertentangan === true && kb.adopsi.kelengkapan.keys.includes("BAHAN_PERLU_DICEK") && kb.adopsi.kelengkapan.items.BAHAN_PERLU_DICEK.alasan[0].kode === "PERNYATAAN_BERTENTANGAN");
// bersamaan: pernyataan vs pencatatan sementara, beberapa unit
const hasilBersamaan = [];
for (const u of sisa.slice(0, 4)) {
  const [p, c] = await Promise.all([http(admin, "POST", url(u), { alasan: "Rehearsal bersamaan: tanpa bahan" }, { "Idempotency-Key": kunci("p") }), http(admin, "POST", `/units/${u.id}/provisional-usages`, { name: `BAHAN BERSAMAAN ${u.unitCode}`, qty: 1, uom: "KG", originNote: "Beli sendiri", alasanPencatatan: "Uji bersamaan rehearsal", ...pembetulan }, { "Idempotency-Key": kunci("c") })]);
  const k = (await bukti(u)).adopsi.kelengkapan; const aktif = await num(`select count(*) as n from unit_material_declarations where unit_id = '${u.id}' and status = 'ACTIVE'`);
  const konsisten = c.status === 201 && !k.keys.includes("BAHAN_BELUM_DICATAT") && (aktif === 1 ? p.status === 201 && k.pernyataanBertentangan === true && k.keys.includes("BAHAN_PERLU_DICEK") : p.status === 409 && !k.pernyataanBertentangan);
  hasilBersamaan.push(`${p.status}/${c.status}${konsisten ? "" : "!"}`); if (!konsisten) cek(`bersamaan ${u.unitCode} konsisten`, false, JSON.stringify({ p: p.status, c: c.status, aktif, keys: k.keys }));
}
cek(`pernyataan & pencatatan BERSAMAAN (4 unit nyata): hasil akhir selalu konsisten (${hasilBersamaan.join(" ")})`, hasilBersamaan.every((x) => !x.endsWith("!")));
// pencabutan: baris tidak dihapus
const cb = await http(admin, "POST", `${url(uA)}/cabut`, { alasan: "Rehearsal: pencabutan" }); cek("pencabutan dengan alasan berhasil; baris tidak dihapus", cb.status === 200 && (await num(`select count(*) as n from unit_material_declarations where unit_id = '${uA.id}'`)) === 1 && (await bukti(uA)).adopsi.kelengkapan.keys.includes("BAHAN_BELUM_DICATAT"));
// Sesudah skenario DIBIARKAN: pernyataan aktif pada unit B (bertentangan) + unit-unit bersamaan, supaya guard rollback diuji pada keadaan NYATA.
console.log(`INFO  sisa keadaan untuk guard: pernyataan AKTIF=${await num("select count(*) as n from unit_material_declarations where status = 'ACTIVE'")}, total baris=${await num("select count(*) as n from unit_material_declarations")}`);

// ── G. invarian: skenario tulis TIDAK menyentuh stok/Material Issue/jurnal/harga/jadwal/Run/status unit-order ──
const fp2 = await fp(TETAP);
cek("sesudah skenario tulis: stok, Material Issue, jurnal, valuasi, harga, biaya operasional, jadwal/Run, unit, order IDENTIK dengan sebelum", beda(fp0, fp2).length === 0, beda(fp0, fp2).join(","));
cek("skenario tulis hanya menambah: pernyataan, pemakaian sementara, dan peristiwa audit", (await num("select count(*) as n from unit_provisional_usages where recorded_by = '" + admin.id + "'")) >= 1 && (await num("select count(*) as n from activity_events")) > evt0);
console.log(`\nPEMERIKSAAN=${n} gagal=${gagal}`);
server.close(); await prisma.$disconnect(); await appPrisma.$disconnect();
process.exit(gagal ? 1 : 0);
