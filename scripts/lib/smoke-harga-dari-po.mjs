import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const BASE = process.env.SMOKE_BASE ?? "http://127.0.0.1:4000"; // rehearsal menjalankan kode smoke YANG SAMA terhadap server rehearsal (SMOKE_BASE)
const APP = process.env.APP_DIR ?? "/app";
let fail = 0; let dilewati = 0;
const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + d : ""}`); };
const skip = (n, alasan) => { dilewati++; console.log(`  SKIP  ${n} — DILEWATI: ${alasan}`); };
// SMOKE BACA-SAJA terhadap production hidup. Tidak ada tulisan: yang dipakai hanya pratinjau harga formulir PO (baca-saja, tidak menulis) dan PENOLAKAN sebelum menyentuh data (tanpa token, tanpa izin, masukan kosong).
// TIDAK ada PO dan TIDAK ada Harga Berlaku percobaan yang dibuat. Jejak tulis (PO, baris PO, Harga Berlaku, stok, valuasi, jurnal, biaya beku, catatan pemakaian) harus identik sebelum vs sesudah.
// PO historis TIDAK diproses oleh rilis ini: jumlah Harga Berlaku bersumber PO (impact.sumber = 'PO') tidak boleh bertambah akibat smoke.
const { ROLE_PERMISSIONS, PERMISSIONS: P } = await import(pathToFileURL(path.join(APP, "src/constants/permissions.js")).href);
const rolesDari = async (u) => new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);
const bisa = (rs, izin) => [...rs].some((r) => (ROLE_PERMISSIONS[r] ?? []).includes(izin));
const tokenUntuk = async (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: [...(await rolesDari(u))] }, process.env.JWT_SECRET, { expiresIn: "10m" });
const hitung = async (q, ...a) => Number((await prisma.$queryRawUnsafe(q, ...a))[0].n);
const B = (k) => Number(process.env[k]);
const post = async (p, token, body = {}, hdr = {}) => { const r = await fetch(BASE + p, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}), ...hdr }, body: JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch { /* bukan JSON */ } return { status: r.status, json: j }; };
const users = await prisma.user.findMany({ where: { active: true }, orderBy: { id: "asc" } }); const info = []; for (const u of users) info.push({ u, rs: await rolesDari(u) });
const pembaca = info.find((x) => bisa(x.rs, P.FINANCE_READ))?.u; const penyimpan = info.find((x) => bisa(x.rs, P.FINANCE_POST))?.u; const tanpaIzin = info.find((x) => !bisa(x.rs, P.FINANCE_READ))?.u;
if (!pembaca) { rec("akun dengan finance:read tersedia", false); process.exit(1); }
const tR = await tokenUntuk(pembaca); const tP = penyimpan ? await tokenUntuk(penyimpan) : null; const tN = tanpaIzin ? await tokenUntuk(tanpaIzin) : null;
const jejak = async () => ({
  po: await hitung("select count(*)::int n from fin_purchase_orders"), poBaris: await hitung("select count(*)::int n from fin_purchase_order_lines"), poStatus: await hitung("select coalesce(sum(length(status::text)),0)::int n from fin_purchase_orders"),
  harga: await hitung("select count(*)::int n from material_harga_berlaku"), hargaPO: await hitung("select count(*)::int n from material_harga_berlaku where impact->>'sumber' = 'PO' or idempotency_key like 'po-harga:%'"),
  stok: await hitung("select count(*)::int n from stock_movements"), valuasi: await hitung("select count(*)::int n from fin_stock_movement_valuations"), jurnal: await hitung("select count(*)::int n from fin_journal_entries"), jurnalBaris: await hitung("select count(*)::int n from fin_journal_lines"),
  biayaBeku: await hitung("select count(*)::int n from stock_movement_biaya_operasional"), catatan: await hitung("select count(*)::int n from unit_usage_notes"), material: await hitung("select count(*)::int n from materials"),
});
// sidik isi Harga Berlaku (append-only): tidak satu baris pun berubah
const sidikHarga = async () => String((await prisma.$queryRawUnsafe("select coalesce(md5(string_agg(h::text, '|' order by h.id::text)), '-') as n from material_harga_berlaku h"))[0].n);
const s0 = await jejak(); const h0 = await sidikHarga();
const PO = "/api/finance/purchase-orders"; const PV = `${PO}/pratinjau-harga`;

// ── pratinjau baca-saja pada bahan NYATA yang punya Harga Berlaku sekarang (harga stok + satuan dari tabel)
const nyata = await prisma.$queryRawUnsafe("select distinct on (h.material_id) h.material_id::text id, m.code, m.name, m.unit, h.unit_price::float8 harga, h.satuan from material_harga_berlaku h join materials m on m.id = h.material_id where h.jenis = 'HARGA' and h.effective_from <= now() and m.active = true and h.satuan = m.unit::text and h.unit_price > 0 and not exists (select 1 from material_harga_berlaku k where k.corrects_id = h.id) order by h.material_id, h.effective_from desc, h.created_at desc limit 40");
const tanpaHarga = await prisma.$queryRawUnsafe("select m.id::text id, m.code, m.unit from materials m where m.active = true and not exists (select 1 from material_harga_berlaku h where h.material_id = m.id) order by m.code limit 1");
if (nyata.length >= 1) {
  const m = nyata[0]; const asing = m.unit === "BOX" ? "CAN" : "BOX"; // satuan beli sah yang berbeda dari satuan stok
  const same = await post(PV, tR, { lines: [{ materialId: m.id, unitPrice: m.harga }] });
  rec(`pratinjau ${m.code}: harga yang SAMA dengan Harga Berlaku sekarang (${m.harga}/${m.satuan}) = SAMA, tidak ada yang akan ditulis`, same.status === 200 && same.json?.baris?.[0]?.status === "SAMA" && same.json?.ringkas?.akanMenulis === 0, `${same.status} ${same.json?.baris?.[0]?.status}`);
  const naik = await post(PV, tR, { lines: [{ materialId: m.id, unitPrice: Math.round(m.harga * 1.1 * 10000) / 10000 }] });
  rec(`pratinjau ${m.code}: harga naik 10% = NAIK dengan harga lama ${m.harga} dan sumber/satuan terbaca; hanya pratinjau (nol penulisan)`, naik.status === 200 && naik.json?.baris?.[0]?.status === "NAIK" && Number(naik.json.baris[0].hargaLama) === Number(m.harga) && naik.json.ringkas.akanMenulis === 1, `${naik.status} ${naik.json?.baris?.[0]?.status} lama=${naik.json?.baris?.[0]?.hargaLama}`);
  const tak = await post(PV, tR, { lines: [{ materialId: m.id, unitPrice: m.harga, satuanBeli: asing }] });
  rec(`pratinjau ${m.code}: satuan beli berbeda tanpa faktor konversi = masalah KONVERSI_TIDAK_ADA (tidak ditebak; PO akan ditolak di baris itu)`, tak.status === 200 && tak.json?.baris?.[0]?.status === "KONVERSI_TIDAK_ADA" && tak.json.ringkas.masalah === 1, `${tak.status} ${tak.json?.baris?.[0]?.status}`);
  const tidakSah = await post(PV, tR, { lines: [{ materialId: m.id, unitPrice: m.harga, satuanBeli: asing, faktorKonversi: "0" }] });
  rec(`pratinjau ${m.code}: faktor konversi 0 = KONVERSI_TIDAK_SAH`, tidakSah.status === 200 && tidakSah.json?.baris?.[0]?.status === "KONVERSI_TIDAK_SAH", `${tidakSah.status} ${tidakSah.json?.baris?.[0]?.status}`);
  const konflik = await post(PV, tR, { lines: [{ materialId: m.id, unitPrice: m.harga }, { materialId: m.id, unitPrice: Math.round(m.harga * 1.5 * 10000) / 10000 }] });
  rec(`pratinjau ${m.code}: dua baris bahan sama dengan harga stok berbeda = KONFLIK_HARGA_BEDA (tidak memilih salah satu)`, konflik.status === 200 && konflik.json?.baris?.length === 1 && konflik.json.baris[0].status === "KONFLIK_HARGA_BEDA", `${konflik.status} ${konflik.json?.baris?.[0]?.status}`);
} else skip("pratinjau pada bahan nyata ber-Harga Berlaku", "tidak ada bahan aktif dengan Harga Berlaku berlaku sekarang (satuan = satuan stok)");
if (tanpaHarga.length >= 1) {
  const t = tanpaHarga[0]; const baru = await post(PV, tR, { lines: [{ materialId: t.id, unitPrice: 1234 }] });
  rec(`pratinjau ${t.code} (belum punya Harga Berlaku): BARU, harga lama kosong; nol penulisan`, baru.status === 200 && baru.json?.baris?.[0]?.status === "BARU" && baru.json.baris[0].hargaLama == null, `${baru.status} ${baru.json?.baris?.[0]?.status}`);
} else skip("pratinjau bahan tanpa Harga Berlaku", "semua bahan aktif sudah punya Harga Berlaku");

// ── penolakan SEBELUM menulis
rec("pratinjau-harga tanpa token = 401", (await post(PV, null, { lines: [] })).status === 401);
rec("simpan PO tanpa token = 401 (tidak menulis)", (await post(PO, null, { lines: [] }, { "Idempotency-Key": "smoke-hpo-tidak-menulis-0001" })).status === 401);
if (tN) {
  rec("pratinjau-harga akun tanpa finance:read = 403", (await post(PV, tN, { lines: [] })).status === 403);
  rec("simpan PO oleh akun tanpa izin finance:post = 403 (tidak menulis)", (await post(PO, tN, { supplierId: "00000000-0000-4000-8000-000000000000", orderDate: "2026-10-30", lines: [{ materialId: "00000000-0000-4000-8000-000000000000", qty: 1, unitPrice: 1 }] }, { "Idempotency-Key": "smoke-hpo-tanpa-izin-0002" })).status === 403);
} else skip("penolakan 403 akun tanpa izin", "semua akun aktif punya finance:read");
if (tP) rec("simpan PO tanpa baris (lines kosong) oleh pemegang finance:post = 4xx (ditolak sebelum menulis apa pun)", (await post(PO, tP, { supplierId: "00000000-0000-4000-8000-000000000000", orderDate: "2026-10-30", lines: [] }, { "Idempotency-Key": "smoke-hpo-kosong-0003" })).status >= 400);
else skip("penolakan PO tanpa baris", "tidak ada akun aktif dengan finance:post");

// ── PO historis tidak diproses; tidak ada jejak tulis
const s1 = await jejak(); const beda = Object.keys(s0).filter((k) => s0[k] !== s1[k]); const h1 = await sidikHarga();
rec("TIDAK ada jejak tulis: PO, baris PO, Harga Berlaku, stok, valuasi Finance, jurnal, baris jurnal, biaya beku, catatan pemakaian, material sama persis sebelum vs sesudah smoke", beda.length === 0, beda.map((k) => `${k}:${s0[k]}→${s1[k]}`).join(",") || "identik");
rec("isi LENGKAP semua baris Harga Berlaku identik sebelum vs sesudah smoke (append-only; tidak ada yang ditulis ulang)", h0 === h1, h0 === h1 ? "identik" : `${h0} → ${h1}`);
rec(`PO historis TIDAK diproses oleh rilis: Harga Berlaku bersumber PO = ${s1.hargaPO} (sebelum rilis: ${B("BASE_HARGA_PO")}; tidak bertambah)`, s1.hargaPO <= B("BASE_HARGA_PO"));
rec("jurnal tidak seimbang (sebelum rilis: " + B("BASE_TIDAK_SEIMBANG") + ", tidak bertambah)", (await hitung("select count(*)::int n from (select e.id from fin_journal_entries e join fin_journal_lines l on l.entry_id = e.id group by e.id having sum(l.debit) <> sum(l.credit)) x")) <= B("BASE_TIDAK_SEIMBANG"));
rec("jumlah Order & Job tidak berkurang (sebelum: " + B("ORDER_N") + " / " + B("JOB_N") + ")", (await hitung('select count(*)::int n from "Order"')) >= B("ORDER_N") && (await hitung("select count(*)::int n from jobs")) >= B("JOB_N"));
console.log(`  INFO  saklar HARGA_DARI_PO pada proses smoke: ${process.env.HARGA_DARI_PO === undefined ? "tidak diset (aktif)" : JSON.stringify(process.env.HARGA_DARI_PO)}`);
await prisma.$disconnect();
console.log("\nRINGKASAN smoke: " + fail + " gagal, " + dilewati + " dilewati (SKIP)");
console.log("SMOKE_HASIL fail=" + fail + " skip=" + dilewati);
process.exit(fail ? 1 : 0);
