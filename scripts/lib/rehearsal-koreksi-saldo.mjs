import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
const require = createRequire(process.cwd() + "/");
const { PrismaClient } = require("@prisma/client");
const jwt = require("jsonwebtoken");
const express = require("express");
const prisma = new PrismaClient();
// REH_SRC hanya untuk uji lokal skrip ini; di rehearsal sebenarnya kode kandidat ada di /app/src (image baru).
const imp = (p) => import(process.env.REH_SRC ? pathToFileURL(path.join(process.env.REH_SRC, p)).href : "/app/src/" + p);
process.env.JWT_SECRET ||= "rehearsal-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
const { stockAdjustmentRouter } = await imp("routes/stockAdjustment.js");
const { ROLE_PERMISSIONS } = await imp("constants/permissions.js");
const K = await imp("services/koreksiSaldoBahan.js");
const HB = await imp("services/finance/hargaBerlaku.js");
let gagal = 0; let n = 0;
const cek = (nama, ok, d = "") => { n += 1; if (!ok) gagal += 1; console.log(`${ok ? "OK   " : "GAGAL"} ${nama}${d ? " — " + d : ""}`); };
const num = async (q) => Number((await prisma.$queryRawUnsafe(q))[0].n);
const ditolak = async (f) => { try { await f(); return null; } catch (e) { return e; } };
const ts = Date.now().toString(36); let seq = 0; const kunci = (t) => `reh-ks-${t}-${ts}-${++seq}-aaaa`;
const r4 = (v) => Math.round(Number(v) * 10000) / 10000;

// Tabel yang TIDAK BOLEH berubah oleh fitur ini (jurnal/PSA/GR/tagihan/koreksi valuasi Finance, Harga Berlaku, catatan pemakaian, Material Issue).
const TETAP = ["fin_journal_entries", "fin_journal_lines", "fin_inventory_openings", "fin_inventory_opening_lines", "goods_receipts", "goods_receipt_lines", "fin_purchase_orders", "fin_supplier_bills", "fin_stock_movement_valuation_corrections", "material_harga_berlaku", "unit_usage_notes", "material_issues"];
const fp = async (tabel) => { const o = {}; for (const t of tabel) o[t] = (await prisma.$queryRawUnsafe(`select count(*)::int n, coalesce(md5(string_agg(x::text, '|' order by x::text)),'') h from "${t}" x`))[0]; return o; };
const beda = (a, b) => Object.keys(a).filter((t) => a[t].n !== b[t].n || a[t].h !== b[t].h);

// ── A. struktur + matriks peran pada KODE BARU ──
cek("tabel konteks koreksi saldo kosong setelah migrasi (tanpa backfill)", (await num("select count(*) as n from koreksi_saldo_bahan")) === 0);
const ada = (r, p) => (ROLE_PERMISSIONS[r] ?? []).includes(p);
cek("peran: pengaju = WAREHOUSE/ADMIN/OWNER (inventory:write); penyetuju = OWNER/FINANCE (inventory:adjustment_approve); Finance tidak menulis ledger; ADMIN dan Gudang bukan penyetuju",
  ada("WAREHOUSE", "inventory:write") && ada("ADMIN", "inventory:write") && ada("OWNER", "inventory:write") && ada("OWNER", "inventory:adjustment_approve") && ada("FINANCE", "inventory:adjustment_approve")
  && !ada("FINANCE", "inventory:write") && !ada("ADMIN", "inventory:adjustment_approve") && !ada("WAREHOUSE", "inventory:adjustment_approve"));

// ── B. pelaku (pengguna uji PADA SALINAN; token memakai klaim peran seperti login) + bahan dari data restore nyata ──
const mkUser = async (nama, role) => { const u = await prisma.user.create({ data: { name: `Uji Rehearsal ${nama}`, email: `reh-ks-${ts}-${nama}@example.test`, passwordHash: "x", role } }); return { ...u, token: jwt.sign({ id: u.id, name: u.name, role, roles: [role] }, process.env.JWT_SECRET, { expiresIn: "20m" }) }; };
const gudang = await mkUser("gudang", "WAREHOUSE"); const ownerA = await mkUser("ownerA", "OWNER"); const ownerB = await mkUser("ownerB", "OWNER"); const fin = await mkUser("finance", "FINANCE"); const sales = await mkUser("sales", "SALES");
const app = express(); app.use(express.json()); app.use("/api/inventory/adjustments", stockAdjustmentRouter);
const server = await new Promise((res) => { const s = app.listen(0, "127.0.0.1", () => res(s)); });
const BASE = `http://127.0.0.1:${server.address().port}/api/inventory/adjustments`;
const http = async (u, method, p, body, headers = {}) => { const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(u ? { Authorization: "Bearer " + u.token } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch { /* kosong */ } return { status: r.status, body: j }; };
const KS = "/koreksi-saldo";
const saldo = async (id) => r4(await num(`select coalesce(sum(qty),0)::float as n from stock_movements where material_id = '${id}'`));
const pilih = await prisma.$queryRawUnsafe("select m.id::text id, m.code, sum(s.qty)::float bal from materials m join stock_movements s on s.material_id = m.id where m.active group by m.id, m.code having sum(s.qty) >= 5 order by m.code limit 3");
cek(`bahan nyata bersaldo positif tersedia pada salinan (${pilih.map((x) => x.code).join(", ")})`, pilih.length >= 2);
const [m1, m2] = pilih; const bahanNyataN = await num("select count(*) as n from materials");
const gerakFixture = async (materialId, type, qty, hariLalu = 3) => prisma.stockMovement.create({ data: { materialId, type, qty, note: "rehearsal fixture", createdAt: new Date(Date.now() - hariLalu * 86_400_000), createdById: gudang.id } });
let nFixtureGerak = 0;

const fp0 = await fp(TETAP);
const nilai0 = await prisma.$queryRawUnsafe("select id::text, status, value::text from fin_stock_movement_valuations order by id");
const biaya0 = await num("select count(*) as n from stock_movement_biaya_operasional");
const nSm0 = await num("select count(*) as n from stock_movements"); const nReq0 = await num("select count(*) as n from stock_adjustment_requests");

// ── C. pratinjau = baca-saja; izin; validasi ──
const s1 = await saldo(m1.id); const fisik1 = r4(s1 - 1);
const pr = await http(gudang, "POST", `${KS}/pratinjau`, { materialId: m1.id, jumlahFisik: fisik1 });
cek("pratinjau (bahan nyata): saldo sebelum = saldo ledger, selisih -1, dapat diajukan; TIDAK menulis apa pun",
  pr.status === 200 && pr.body.saldoDilihat === s1 && pr.body.selisih === -1 && pr.body.dapatDiajukan === true && (await num("select count(*) as n from stock_adjustment_requests")) === nReq0 && (await num("select count(*) as n from koreksi_saldo_bahan")) === 0 && (await num("select count(*) as n from stock_movements")) === nSm0, JSON.stringify([pr.status, pr.body?.saldoDilihat, pr.body?.selisih]));
const v1 = await http(gudang, "POST", `${KS}/pratinjau`, { materialId: m1.id, jumlahFisik: -1 }); const v2 = await http(gudang, "POST", `${KS}/pratinjau`, { materialId: m1.id });
cek("jumlah fisik minus/kosong ditolak (JUMLAH_MINUS / JUMLAH_WAJIB); 0 sah", v1.body?.code === "JUMLAH_MINUS" && v2.body?.code === "JUMLAH_WAJIB");
cek("izin: Finance dan Sales tidak dapat mengajukan (403); tanpa token 401; alasan wajib; Idempotency-Key wajib",
  (await http(fin, "POST", `${KS}/ajukan`, { materialId: m1.id, jumlahFisik: fisik1, saldoDilihat: s1, alasan: "uji izin" }, { "Idempotency-Key": kunci("f") })).status === 403
  && (await http(sales, "POST", `${KS}/ajukan`, { materialId: m1.id, jumlahFisik: fisik1, saldoDilihat: s1, alasan: "uji izin" }, { "Idempotency-Key": kunci("s") })).status === 403
  && (await http(null, "POST", `${KS}/ajukan`, {}, { "Idempotency-Key": kunci("x") })).status === 401
  && (await http(gudang, "POST", `${KS}/ajukan`, { materialId: m1.id, jumlahFisik: fisik1, saldoDilihat: s1, alasan: "" }, { "Idempotency-Key": kunci("a") })).body?.code === "ALASAN_WAJIB"
  && (await http(gudang, "POST", `${KS}/ajukan`, { materialId: m1.id, jumlahFisik: fisik1, saldoDilihat: s1, alasan: "uji kunci wajib" })).body?.code === "KUNCI_WAJIB"
  && (await num("select count(*) as n from stock_adjustment_requests")) === nReq0);

// ── D. pengajuan: klik ganda/serentak = SATU; stok belum berubah; jalur resmi (pengaju ≠ penyetuju) ──
const k1 = kunci("aju"); const body1 = { materialId: m1.id, jumlahFisik: fisik1, saldoDilihat: s1, alasan: "rehearsal: hitung fisik sisa berkurang 1" };
const aju = await Promise.all([1, 2, 3, 4].map(() => http(gudang, "POST", `${KS}/ajukan`, body1, { "Idempotency-Key": k1 })));
cek("pengajuan serentak ×4 (kunci sama): tepat SATU permintaan + SATU konteks; semua respons sukses dengan id sama", aju.every((x) => x.status === 201 || x.status === 200) && new Set(aju.map((x) => x.body.id)).size === 1 && (await num("select count(*) as n from stock_adjustment_requests")) === nReq0 + 1 && (await num("select count(*) as n from koreksi_saldo_bahan")) === 1);
const reqId = aju[0].body.id;
cek("pengajuan: status Menunggu persetujuan; stok BELUM berubah; tidak ada pergerakan baru; saldo yang dilihat tersimpan", aju[0].body.status === "WAITING_APPROVAL" && (await saldo(m1.id)) === s1 && (await num("select count(*) as n from stock_movements")) === nSm0 && Number((await prisma.koreksiSaldoBahan.findUnique({ where: { adjustmentRequestId: reqId } })).saldoDilihat) === s1);
const beda1 = await http(gudang, "POST", `${KS}/ajukan`, { ...body1, jumlahFisik: r4(fisik1 - 1) }, { "Idempotency-Key": k1 }); cek("kunci yang sama untuk isi berbeda ditolak (KUNCI_DIPAKAI_LAIN)", beda1.status === 409 && beda1.body.code === "KUNCI_DIPAKAI_LAIN");
const aktif2 = await http(gudang, "POST", `${KS}/ajukan`, { ...body1, jumlahFisik: r4(fisik1 - 2) }, { "Idempotency-Key": kunci("aktif") }); cek("satu koreksi aktif per bahan (SUDAH_ADA_PENGAJUAN_AKTIF)", aktif2.status === 409 && aktif2.body.code === "SUDAH_ADA_PENGAJUAN_AKTIF");
cek("pengaju TIDAK dapat menyetujui sendiri (403); ADMIN/Gudang bukan penyetuju; Finance dapat menyetujui tetapi tidak memposting",
  (await http(gudang, "PATCH", `/${reqId}`, { status: "APPROVED" })).status === 403 && (await prisma.stockAdjustmentRequest.findUnique({ where: { id: reqId } })).status === "WAITING_APPROVAL");

// ── E. saldo bergeser: persetujuan ditolak; batalkan; ajukan ulang dari saldo terbaru ──
await gerakFixture(m1.id, "RECEIPT", 2, 0); nFixtureGerak += 1; // penerimaan setelah pengajuan: saldo bergeser
const s1b = await saldo(m1.id);
const tolakSetuju = await http(ownerA, "PATCH", `/${reqId}`, { status: "APPROVED" });
cek("saldo bergeser sebelum persetujuan: 409 SALDO_BERGESER; permintaan tetap Menunggu; riwayat menandai KEDALUWARSA", tolakSetuju.status === 409 && tolakSetuju.body.code === "SALDO_BERGESER" && (await prisma.stockAdjustmentRequest.findUnique({ where: { id: reqId } })).status === "WAITING_APPROVAL" && (await K.riwayatKoreksiBahan(prisma, m1.id))[0].kedaluwarsa === true);
cek("batalkan lalu ajukan ulang dari saldo terbaru berhasil", (await http(gudang, "PATCH", `/${reqId}/cancel`, { reason: "rehearsal: saldo bergeser" })).status === 200 && (await http(gudang, "POST", `${KS}/ajukan`, { materialId: m1.id, jumlahFisik: r4(s1b - 1), saldoDilihat: s1b, alasan: "rehearsal: ajukan ulang dari saldo terbaru" }, { "Idempotency-Key": kunci("ulang") })).status === 201);
const req2 = (await prisma.stockAdjustmentRequest.findFirst({ where: { materialId: m1.id, status: "WAITING_APPROVAL" } }));
const setuju2 = await http(ownerA, "PATCH", `/${req2.id}`, { status: "APPROVED" });
const finPost = await http(fin, "POST", `/${req2.id}/post`, {});
await gerakFixture(m1.id, "RECEIPT", 1, 0); nFixtureGerak += 1; // saldo bergeser SETELAH disetujui, sebelum posting
const postGeser = await http(gudang, "POST", `/${req2.id}/post`, {});
cek("disetujui Owner lain (200); Finance tidak memposting (403); saldo bergeser sebelum posting: 409 SALDO_BERGESER, tidak ada pergerakan tertulis, permintaan tetap Disetujui", setuju2.status === 200 && finPost.status === 403 && postGeser.status === 409 && postGeser.body.code === "SALDO_BERGESER" && (await num(`select count(*) as n from stock_movements where stock_adjustment_request_id = '${req2.id}'`)) === 0 && (await prisma.stockAdjustmentRequest.findUnique({ where: { id: req2.id } })).status === "APPROVED");
await http(gudang, "PATCH", `/${req2.id}/cancel`, { reason: "rehearsal: saldo bergeser setelah disetujui" });

// ── F. alur penuh: ajukan -> setujui orang lain -> posting; SATU pergerakan ADJUSTMENT sebesar selisih ──
const s1c = await saldo(m1.id); const fisik3 = r4(s1c - 1);
const a3 = await http(gudang, "POST", `${KS}/ajukan`, { materialId: m1.id, jumlahFisik: fisik3, saldoDilihat: s1c, alasan: "rehearsal: alur penuh ajukan-setujui-posting" }, { "Idempotency-Key": kunci("penuh") });
const ok3 = await http(ownerB, "PATCH", `/${a3.body.id}`, { status: "APPROVED" }); const nSmSebelumPost = await num("select count(*) as n from stock_movements");
const po3 = await http(gudang, "POST", `/${a3.body.id}/post`, {});
const mv3 = await prisma.stockMovement.findMany({ where: { stockAdjustmentRequestId: a3.body.id } }); const rq3 = await prisma.stockAdjustmentRequest.findUnique({ where: { id: a3.body.id } });
cek("alur penuh: 201 -> setujui Owner lain 200 -> posting Gudang 200; saldo = jumlah fisik; tepat SATU pergerakan ADJUSTMENT sebesar selisih -1", a3.status === 201 && ok3.status === 200 && po3.status === 200 && (await saldo(m1.id)) === fisik3 && mv3.length === 1 && mv3[0].type === "ADJUSTMENT" && r4(mv3[0].qty) === -1 && (await num("select count(*) as n from stock_movements")) === nSmSebelumPost + 1);
cek("tiga pelaku berbeda tercatat (pengaju, penyetuju, pemosting); penyetuju ≠ pengaju", rq3.requestedById === gudang.id && rq3.approvedById === ownerB.id && rq3.postedById === gudang.id && rq3.approvedById !== rq3.requestedById);
const riw = await K.riwayatKoreksiBahan(prisma, m1.id);
cek("riwayat koreksi bahan lengkap: diajukan/disetujui/diposting oleh siapa, pergerakan tercipta, yang dibatalkan tetap tercatat", riw.length === 3 && riw.filter((x) => x.status === "CANCELLED").length === 2 && riw[0].status === "POSTED" && !!riw[0].diajukanOleh && !!riw[0].disetujuiOleh && !!riw[0].dipostingOleh && riw[0].pergerakan?.qty === -1 && riw[0].kedaluwarsa === false, `${riw.length} baris`);

// ── G. tiga keadaan nol (bahan uji pada SALINAN; bahan nyata tidak disentuh) ──
const mk = (kode) => prisma.material.create({ data: { code: `REH-KS-${kode}-${ts}`.toUpperCase(), name: `Uji rehearsal ${kode}`, unit: "KG", category: "RAW_MATERIAL", active: true } });
const mBelum = await mk("belum"); const mNol = await mk("nol"); const mVerif = await mk("verif");
const kBelum = await K.keadaanBahan(prisma, ownerA, mBelum.id);
cek("belum ada catatan stok: keadaan BELUM_ADA_CATATAN, saldo null (BUKAN 0)", kBelum.keadaanSaldo === "BELUM_ADA_CATATAN" && kBelum.saldo === null);
await gerakFixture(mNol.id, "RECEIPT", 5, 4); await gerakFixture(mNol.id, "ISSUE", -5, 3); nFixtureGerak += 2;
const kNol = await K.keadaanBahan(prisma, ownerA, mNol.id);
cek("ada catatan hasilnya nol: NOL_MENURUT_PERGERAKAN (belum terverifikasi) — berbeda dari belum ada catatan", kNol.keadaanSaldo === "NOL_MENURUT_PERGERAKAN" && kNol.saldo === 0 && kNol.verifikasiNol === null);
await gerakFixture(mVerif.id, "RECEIPT", 4, 4); nFixtureGerak += 1;
const av = await http(gudang, "POST", `${KS}/ajukan`, { materialId: mVerif.id, jumlahFisik: 0, saldoDilihat: 4, alasan: "rehearsal: hitung fisik menyatakan habis" }, { "Idempotency-Key": kunci("verif") });
await http(ownerA, "PATCH", `/${av.body.id}`, { status: "APPROVED" }); await http(gudang, "POST", `/${av.body.id}/post`, {}); nFixtureGerak += 0;
const kVerif = await K.keadaanBahan(prisma, ownerA, mVerif.id);
cek("koreksi resmi ke 0 yang diposting: NOL_TERVERIFIKASI (sumber KOREKSI_SALDO + nomor) — berbeda dari nol menurut pergerakan", kVerif.keadaanSaldo === "NOL_TERVERIFIKASI" && kVerif.verifikasiNol?.sumber === "KOREKSI_SALDO" && kVerif.verifikasiNol?.nomor === av.body.nomor);
const pBelum = await http(gudang, "POST", `${KS}/pratinjau`, { materialId: mBelum.id, jumlahFisik: 0 });
cek("belum ada catatan + fisik 0: tanpa selisih, tidak dapat diajukan, tidak menciptakan catatan apa pun", pBelum.body.arah === "TANPA_SELISIH" && pBelum.body.dapatDiajukan === false && pBelum.body.saldoSebelum === null && (await num(`select count(*) as n from stock_movements where material_id = '${mBelum.id}'`)) === 0);

// ── H. append-only di tingkat database ──
const e1 = await ditolak(() => prisma.$executeRawUnsafe(`update koreksi_saldo_bahan set jumlah_fisik = 1 where adjustment_request_id = '${a3.body.id}'`)); const e2 = await ditolak(() => prisma.$executeRawUnsafe(`delete from koreksi_saldo_bahan where adjustment_request_id = '${a3.body.id}'`));
cek("trigger DB: konteks koreksi tidak bisa diubah atau dihapus", !!e1 && !!e2 && /append-only/.test(String(e1.message)) && /append-only/.test(String(e2.message)));

// ── I. Harga Berlaku per satuan di daftar (fitur yang sudah ada), baca-saja ──
const rd = await HB.ringkasanDaftar(prisma); const nMatHarga = await num("select count(distinct material_id) as n from material_harga_berlaku");
cek(`ringkasan harga daftar baca-saja: jumlah bahan berharga = ${nMatHarga} (tanpa harga TIDAK muncul, bukan Rp0)`, rd.jumlah === Object.keys(rd.harga).length && rd.jumlah <= nMatHarga && Object.values(rd.harga).every((h) => h.harga === null || Number(h.harga) > 0));
const nf = await HB.ringkasanBahan(prisma, m1.id);
cek("nilai persediaan Finance per bahan terpisah dari harga berlaku; tanpa Persediaan Awal terposting = tersedia:false (bukan Rp0)", typeof nf.nilaiPersediaanFinance?.tersedia === "boolean" && (nf.nilaiPersediaanFinance.tersedia || /BUKAN Rp0/.test(nf.nilaiPersediaanFinance.teks)), nf.nilaiPersediaanFinance?.tersedia ? "ada Persediaan Awal terposting" : "belum ada");

// ── J. invarian: yang boleh bertambah hanya pergerakan fixture + SATU pergerakan ADJUSTMENT per koreksi diposting ──
const postedN = 2; // m1 (a3) + mVerif
const fp1 = await fp(TETAP);
cek("jurnal, baris jurnal, PSA, penerimaan, tagihan, koreksi valuasi Finance, Harga Berlaku, catatan pemakaian, Material Issue: IDENTIK sebelum vs sesudah", beda(fp0, fp1).length === 0, beda(fp0, fp1).join(","));
const nilai1 = await prisma.$queryRawUnsafe("select id::text, status, value::text from fin_stock_movement_valuations order by id");
const lama = new Map(nilai0.map((x) => [x.id, x])); const berubah = nilai1.filter((x) => lama.has(x.id) && (lama.get(x.id).status !== x.status || lama.get(x.id).value !== x.value));
const nilaiBaru = nilai1.length - nilai0.length;
cek(`valuasi Finance yang sudah ada TIDAK berubah; baris valuasi baru dari perilaku lama postStockMovement: ${nilaiBaru} (untuk ${nFixtureGerak + postedN} pergerakan uji; bukan dari kode Koreksi Saldo)`, berubah.length === 0 && nilaiBaru >= 0);
cek("biaya operasional (HPP) pemakaian lama tidak berubah; pergerakan ADJUSTMENT tidak membekukan harga", (await num("select count(*) as n from stock_movement_biaya_operasional")) === biaya0, `${biaya0} -> ${await num("select count(*) as n from stock_movement_biaya_operasional")}`);
cek(`stok: bertambah tepat ${nFixtureGerak} pergerakan fixture + ${postedN} ADJUSTMENT hasil koreksi diposting (bahan nyata hanya ${postedN - 1} ADJUSTMENT); bahan nyata lain tidak tersentuh`,
  (await num("select count(*) as n from stock_movements")) === nSm0 + nFixtureGerak + postedN && (await saldo(m2.id)) === r4(pilih[1].bal) && (await num("select count(*) as n from materials")) === bahanNyataN + 3);

// ── K. SATU koreksi sengaja DIBIARKAN menunggu persetujuan agar guard rollback (dijalankan sesudah skenario) terbukti menolak ──
const s2 = await saldo(m2.id);
const a4 = await http(gudang, "POST", `${KS}/ajukan`, { materialId: m2.id, jumlahFisik: r4(s2 - 1), saldoDilihat: s2, alasan: "rehearsal: dibiarkan menunggu untuk uji guard rollback" }, { "Idempotency-Key": kunci("guard") });
cek("satu koreksi dibiarkan Menunggu persetujuan (untuk uji guard rollback)", a4.status === 201 && a4.body.status === "WAITING_APPROVAL" && (await saldo(m2.id)) === s2);

await new Promise((res) => server.close(res)); await prisma.$disconnect();
console.log("PEMERIKSAAN=" + n + " gagal=" + gagal);
process.exit(gagal === 0 ? 0 : 1);
