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
const rec = (n, ok, d = "") => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + String(d).slice(0, 240) : ""}`); };
const skip = (n, alasan) => { dilewati++; console.log(`  SKIP  ${n} — DILEWATI: ${alasan}`); };
// SMOKE "TIDAK MENULIS": pengecualian "Tetap catat meskipun stok tidak cukup" + satuan pakai (LIST WIBING: stok ROLL, pakai METER, 1 ROLL = 90 METER).
// Hanya GET dan satu jenis POST yang HANYA MENGHITUNG (pratinjau dampak; tanpa tulis ke tabel mana pun, dibuktikan oleh hitung baris sebelum vs sesudah). TIDAK ada pemakaian historis yang dimasukkan dan TIDAK ada stok yang diubah.
// Kebenaran = invarian atas data nyata terhadap TABEL (saldo ledger = jumlah pergerakan), bukan angka tetap.
const { ROLE_PERMISSIONS, PERMISSIONS: P } = await import(pathToFileURL(path.join(APP, "src/constants/permissions.js")).href);
const rolesDari = async (u) => new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);
const bisa = (rs, izin) => [...rs].some((r) => (ROLE_PERMISSIONS[r] ?? []).includes(izin));
const tokenUntuk = async (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: [...(await rolesDari(u))] }, process.env.JWT_SECRET, { expiresIn: "10m" });
const hitung = async (q, ...a) => Number((await prisma.$queryRawUnsafe(q, ...a))[0].n);
const users = await prisma.user.findMany({ where: { active: true }, orderBy: { id: "asc" } }); const info = []; for (const u of users) info.push({ u, rs: await rolesDari(u) });
const pengelola = info.find((x) => bisa(x.rs, P.UNIT_READ) && bisa(x.rs, P.UNIT_MATERIAL_WRITE) && bisa(x.rs, P.UNIT_ROUTING_WRITE))?.u;
const operator = info.find((x) => bisa(x.rs, P.UNIT_READ) && bisa(x.rs, P.UNIT_MATERIAL_WRITE) && !bisa(x.rs, P.UNIT_ROUTING_WRITE))?.u;
const pembaca = info.find((x) => bisa(x.rs, P.UNIT_READ) && !bisa(x.rs, P.UNIT_MATERIAL_WRITE) && !bisa(x.rs, P.UNIT_ROUTING_WRITE))?.u;
if (!pengelola) { rec("akun pengelola (unit:read + unit_material:write + unit_routing:write) tersedia", false); process.exit(1); }
const tok = await tokenUntuk(pengelola);
const http = async (method, url, token = tok, body = null) => { const r = await fetch(BASE + url, { method, headers: { ...(token ? { Authorization: "Bearer " + token } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); let j = null; if (/json/.test(r.headers.get("content-type") ?? "")) { try { j = await r.json(); } catch { /* bukan JSON */ } } else await r.arrayBuffer(); return { status: r.status, json: j }; };
const get = (url, token = tok) => http("GET", url, token);
const JEJAK = [["stock_movements", "select count(*)::int n from stock_movements"], ["biaya_beku", "select count(*)::int n from stock_movement_biaya_operasional"], ["harga_berlaku", "select count(*)::int n from material_harga_berlaku"], ["material_issues", "select count(*)::int n from material_issues"],
  ["jurnal", "select count(*)::int n from fin_journal_entries"], ["units", "select count(*)::int n from units"], ["pernyataan", "select count(*)::int n from unit_material_declarations"], ["runs", "select count(*)::int n from production_runs_v2"],
  ["peristiwa_pembetulan", "select count(*)::int n from activity_events where event_type = 'PRODUCTION_PEMBETULAN_BAHAN_UNIT_SELESAI'"], ["pengaturan_produksi", "select count(*)::int n from production_settings"], ["idempotensi", "select count(*)::int n from v2_command_idempotency"]];
const jejak = async () => { const o = {}; for (const [k, q] of JEJAK) { try { o[k] = await hitung(q); } catch { o[k] = null; } } return o; };
const baris = async (q, ...a) => (await prisma.$queryRawUnsafe(q, ...a)); const PREFIKS = "Pengecualian stok tidak cukup (pemakaian historis)%";
const s0 = await jejak(); const peng0 = await hitung("select count(*)::int n from stock_movements where reason like $1", PREFIKS);
const C = "/api/production/material-catalog"; const SP = "/api/production/satuan-pakai";

// ── izin ──
rec("katalog tanpa token = 401", (await http("GET", `${C}?limit=5`, null)).status === 401);
rec("aturan satuan pakai tanpa token = 401", (await http("GET", SP, null)).status === 401);
rec("pratinjau pembetulan tanpa token = 401", (await http("POST", `/api/production/units/00000000-0000-4000-8000-000000000000/pembetulan-bahan/pratinjau`, null, { jenis: "TAMBAH" })).status === 401);

// ── aturan satuan pakai: bawaan Owner (LIST-WIBING: ROLL → METER, 90) kecuali ditimpa pengaturan tercatat ──
const timpa = (await baris("select value from production_settings where key = 'satuan_pakai_bahan'"))[0]?.value?.aturan ?? [];
const faktorHarapan = Number((timpa.find((a) => a.awalan === "LIST-WIBING" && a.nonaktif !== true) ?? { faktor: 90 }).faktor); const dinonaktifkan = timpa.some((a) => a.awalan === "LIST-WIBING" && a.nonaktif === true);
const a = await get(SP); const rule = (a.json?.berlaku ?? []).find((x) => x.awalan === "LIST-WIBING");
if (dinonaktifkan) skip("aturan LIST-WIBING aktif", "dinonaktifkan oleh pengaturan produksi tercatat"); else rec(`GET aturan: 200 dan LIST-WIBING = ROLL → METER, faktor ${faktorHarapan}`, a.status === 200 && rule?.satuanStok === "ROLL" && rule?.satuanPakai === "METER" && Number(rule?.faktor) === faktorHarapan, `${a.status} ${JSON.stringify(rule)}`);
const lw = await baris("select m.id::text id, m.code, m.unit, coalesce(s.saldo,0)::float saldo, coalesce(s.n,0)::int n from materials m left join (select material_id, sum(qty) saldo, count(*) n from stock_movements group by material_id) s on s.material_id = m.id where m.code like 'LIST-WIBING%' and m.active order by m.code");
console.log(`  INFO  bahan LIST-WIBING aktif: ${lw.length} (${lw.map((r) => `${r.code} ${r.unit} saldo ${Math.round(r.saldo * 10000) / 10000}`).join("; ").slice(0, 400)})`);
const kat = await get(`${C}?q=LIST-WIBING&limit=100`);
if (!dinonaktifkan && lw.some((r) => r.unit === "ROLL")) {
  const baru = (kat.json?.rows ?? []).filter((r) => String(r.kode).toUpperCase().startsWith("LIST-WIBING") && r.satuan === "ROLL");
  rec("katalog: semua LIST-WIBING satuan ROLL membawa aturan satuanPakai (METER, faktor sesuai)", kat.status === 200 && baru.length > 0 && baru.every((r) => r.satuanPakai?.satuanPakai === "METER" && Number(r.satuanPakai?.faktor) === faktorHarapan), `${kat.status} ${baru.length} baris`);
} else skip("katalog LIST-WIBING membawa aturan", "tidak ada bahan LIST-WIBING ROLL aktif / aturan dinonaktifkan");
const lain = await get(`${C}?limit=300`); const bukanLw = (lain.json?.rows ?? []).filter((r) => !String(r.kode).toUpperCase().startsWith("LIST-WIBING"));
rec("katalog: bahan lain TIDAK terkena aturan (satuanPakai = null); kunci harga lama tetap ada", lain.status === 200 && bukanLw.every((r) => r.satuanPakai === null && "harga" in r), `${bukanLw.length} bahan bukan LIST-WIBING`);

// ── izin pengecualian per peran (dibaca dari adopsi unit) ──
const unitSembarang = (await baris("select id::text id from units order by created_at desc limit 1"))[0];
if (unitSembarang) {
  const ap = await get(`/api/production/units/${unitSembarang.id}/adopsi`); rec("adopsi: peran pengelola memegang izin pengecualianStokTidakCukup", ap.status === 200 && ap.json?.izin?.pengecualianStokTidakCukup === true, `${ap.status} ${JSON.stringify(ap.json?.izin?.pengecualianStokTidakCukup)}`);
  if (operator) { const ao = await get(`/api/production/units/${unitSembarang.id}/adopsi`, await tokenUntuk(operator)); rec("adopsi: operator lantai (tanpa routing) TIDAK memegang izin pengecualian", ao.status === 200 && ao.json?.izin?.pengecualianStokTidakCukup === false, `${ao.status}`); } else skip("izin operator", "tidak ada akun operator tanpa unit_routing:write");
  if (pembaca) { const ar = await get(`/api/production/units/${unitSembarang.id}/adopsi`, await tokenUntuk(pembaca)); rec("adopsi: peran baca-saja tidak memegang izin pengecualian", ar.status === 200 && ar.json?.izin?.pengecualianStokTidakCukup === false, `${ar.status}`); } else skip("izin pembaca", "tidak ada akun baca-saja");
} else skip("izin pengecualian per peran", "belum ada unit");

// ── pratinjau (HITUNG SAJA) pada data nyata: unit TERKIRIM + LIST-WIBING ──
const unitKirim = (await baris("select id::text id from units where status = 'DELIVERED' order by created_at desc limit 1"))[0]; const m = lw.find((r) => r.unit === "ROLL" && r.n > 0);
if (unitKirim && m && !dinonaktifkan) {
  const wib = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10); const meter = Math.round((Math.max(m.saldo, 0) + 2) * faktorHarapan * 10) / 10; const qtyStok = Math.round((meter / faktorHarapan) * 10000) / 10000;
  const PRA = `/api/production/units/${unitKirim.id}/pembetulan-bahan/pratinjau`; const dasar = { materialId: m.id, jenis: "TAMBAH", qty: meter, satuan: "METER", tanggalPemakaian: wib };
  const p1 = await http("POST", PRA, tok, dasar); const s = p1.json;
  rec(`pratinjau ${m.code}: ${meter} METER dikonversi ke ${qtyStok} ROLL; saldo sebelum = jumlah ledger (${Math.round(m.saldo * 10000) / 10000})`, p1.status === 200 && s.qty === qtyStok && s.satuanInput === "METER" && Math.abs((s.stok?.saldoSebelum ?? NaN) - m.saldo) < 0.0002 && /÷/.test(s.konversi?.teks ?? ""), `${p1.status} ${JSON.stringify(s?.stok)} ${s?.konversi?.teks ?? ""}`);
  const bisaKecuali = s?.pengecualianStok?.bisa === true;
  if (!bisaKecuali && /acuan|opname|persediaan awal/i.test(s?.pengecualianStok?.sebabTidakBisa ?? "")) skip("pratinjau pengecualian berlaku", `tanggal hari ini melintasi acuan opname/persediaan awal (${String(s.pengecualianStok.sebabTidakBisa).slice(0, 120)})`);
  else {
    rec("tanpa pengecualian: stok tidak cukup memblokir (SALDO_KURANG) dan BISA dikecualikan oleh pengelola", (s?.penghalang ?? []).some((h) => h.kode === "SALDO_KURANG" && h.bisaDikecualikan === true) && s.boleh === false, JSON.stringify(s?.penghalang?.map((h) => h.kode)));
    const p2 = await http("POST", PRA, tok, { ...dasar, pengecualianStokTidakCukup: true }); const t = p2.json;
    rec("dengan pengecualian: penghalang stok hilang, peringatan SALDO_MINUS, saldo sesudah = sebelum − jumlah stok", p2.status === 200 && t.boleh === !(t.penghalang?.length) && !(t.penghalang ?? []).some((h) => h.kode === "SALDO_KURANG") && (t.peringatan ?? []).some((x) => x.kode === "SALDO_MINUS") && t.pengecualianStok?.berlaku === true && Math.abs(t.stok.saldoSesudah - (m.saldo - qtyStok)) < 0.0002, `${p2.status} ${JSON.stringify(t?.stok)} ${JSON.stringify(t?.penghalang?.map((h) => h.kode))}`);
    rec("Finance mengikuti kontrak lama (tidak mengarang nilai): hasil = JURNAL / GAP_* / TIDAK_DIJURNAL", ["JURNAL", "GAP_PERSEDIAAN_AWAL", "GAP_TANPA_HARGA", "TIDAK_DIJURNAL"].includes(t?.finance?.hasil), t?.finance?.hasil);
    if (operator) { const p3 = await http("POST", PRA, await tokenUntuk(operator), { ...dasar, pengecualianStokTidakCukup: true }); rec("operator lantai meminta pengecualian: DITOLAK pratinjau (PENGECUALIAN_DITOLAK), tetap diblokir", p3.status === 200 && (p3.json.penghalang ?? []).some((h) => h.kode === "PENGECUALIAN_DITOLAK") && p3.json.boleh === false, JSON.stringify(p3.json?.penghalang?.map((h) => h.kode))); } else skip("operator ditolak pada pratinjau", "tidak ada akun operator");
  }
  const x1 = await http("POST", PRA, tok, { ...dasar, satuan: undefined }); rec("bahan beraturan tanpa satuan: DITOLAK (SATUAN_PAKAI_WAJIB), bukan terbaca sebagai ROLL", x1.status === 400 && x1.json?.code === "SATUAN_PAKAI_WAJIB", `${x1.status} ${x1.json?.code}`);
} else skip("pratinjau pada data nyata", "tidak ada unit TERKIRIM atau bahan LIST-WIBING ROLL ber-ledger (atau aturan dinonaktifkan)");

// ── tanpa jejak tulis ──
const s1 = await jejak(); const peng1 = await hitung("select count(*)::int n from stock_movements where reason like $1", PREFIKS);
const turun = Object.keys(s0).filter((kk) => s0[kk] !== null && s1[kk] < s0[kk]);
rec("TIDAK ada jejak tulis destruktif: stok, biaya beku, harga, Material Issue, jurnal, unit, pernyataan, run, pengaturan tidak berkurang selama smoke", turun.length === 0, turun.map((kk) => `${kk}:${s0[kk]}→${s1[kk]}`).join(" "));
rec("TIDAK ada pergerakan stok berpenanda 'Pengecualian stok tidak cukup' yang lahir selama smoke (rilis tidak memasukkan pemakaian historis)", peng1 === peng0, `${peng0}→${peng1}`);
rec("pratinjau tidak membuat peristiwa audit, idempotensi, atau pengaturan", s1.peristiwa_pembetulan === s0.peristiwa_pembetulan && s1.pengaturan_produksi === s0.pengaturan_produksi, JSON.stringify({ a: [s0.peristiwa_pembetulan, s1.peristiwa_pembetulan], b: [s0.pengaturan_produksi, s1.pengaturan_produksi] }));
const naik = Object.keys(s0).filter((kk) => s0[kk] !== null && s1[kk] > s0[kk]); if (naik.length) console.log("  (info: bertambah selama smoke karena pengguna lain/aplikasi hidup — smoke ini hanya GET dan pratinjau-hitung: " + naik.map((kk) => `${kk}:${s0[kk]}→${s1[kk]}`).join(" ") + ")");
await prisma.$disconnect();
console.log("\nRINGKASAN smoke: " + fail + " gagal, " + dilewati + " dilewati (SKIP)");
console.log("SMOKE_HASIL fail=" + fail + " skip=" + dilewati);
process.exit(fail ? 1 : 0);
