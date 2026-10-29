import { createRequire } from "node:module";
import { spawn, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import path from "node:path";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const APP = process.env.APP_DIR ?? "/app"; // lokal (uji skrip ini): APP_DIR menunjuk ke folder backend; di kontainer rilis = /app
const imp = (p) => import(pathToFileURL(path.join(APP, p)).href);
const { ROLE_PERMISSIONS, PERMISSIONS: P } = await imp("src/constants/permissions.js");
let gagal = 0; let n = 0;
const cek = (nama, ok, d = "") => { n += 1; if (!ok) gagal += 1; console.log(`${ok ? "OK   " : "GAGAL"} ${nama}${d ? " — " + String(d).slice(0, 240) : ""}`); };
const num = async (q, ...a) => Number((await prisma.$queryRawUnsafe(q, ...a))[0].n);
const SMOKE_SRC = "@@SMOKE_SRC@@"; // diganti generator dengan isi smoke-po-barang-mirip.mjs
const nm = process.env.REH_DB_NAME ?? (await prisma.$queryRawUnsafe("select current_database() as n"))[0].n;
if (!/^rehearsal_/.test(nm)) { cek("uji PO barang mirip hanya pada DB rehearsal", false, nm); await prisma.$disconnect(); process.exit(1); }
// REHEARSAL "PO barang mirip": kode BARU dijalankan sebagai SERVER sungguhan (index.js, port 4101, tanpa job latar, variabel eksternal dinetralkan) terhadap SALINAN RESTORE production.
// Semua tulisan hanya di DB sementara ini. Di salinan inilah delapan material nyata (BUS-008..015 bila ada) diperiksa: pratinjau, penolakan, dan SIDIK ISI LENGKAP barisnya harus tidak berubah apa pun yang dilakukan uji.
const { neutralizeExternalEnv } = await imp("src/lib/stagingGuard.js"); neutralizeExternalEnv(process.env);
const PORT = Number(process.env.REH_PORT ?? 4101); const BASE = `http://127.0.0.1:${PORT}`;
const child = spawn(process.execPath, ["src/index.js"], { cwd: APP, env: { ...process.env, PORT: String(PORT), DISABLE_BACKGROUND_JOBS: "1" }, stdio: ["ignore", "pipe", "pipe"] });
let log = ""; child.stdout.on("data", (d) => { log += d; }); child.stderr.on("data", (d) => { log += d; });
const berhenti = () => { try { child.kill("SIGTERM"); } catch { /* sudah mati */ } };
let sehat = false; for (let i = 0; i < 60 && !sehat; i++) { try { sehat = (await fetch(BASE + "/api/health")).ok; } catch { await new Promise((r) => setTimeout(r, 1000)); } }
cek("server kode baru hidup pada salinan restore (/api/health)", sehat, sehat ? "" : log.slice(-300)); if (!sehat) { berhenti(); await prisma.$disconnect(); process.exit(1); }

const rolesDari = async (u) => new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);
const bisa = (rs, izin) => [...rs].some((r) => (ROLE_PERMISSIONS[r] ?? []).includes(izin));
const token = async (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: [...(await rolesDari(u))] }, process.env.JWT_SECRET, { expiresIn: "25m" });
const semua = await prisma.user.findMany({ where: { active: true }, orderBy: { id: "asc" } }); const info = []; for (const u of semua) info.push({ u, rs: await rolesDari(u) });
const admins = info.filter((x) => bisa(x.rs, P.FINANCE_ADMIN)).map((x) => x.u); const nonAdmin = info.find((x) => !bisa(x.rs, P.FINANCE_ADMIN))?.u;
const stamp = Date.now().toString(36);
const adm1 = admins[0] ?? await prisma.user.create({ data: { name: "REH Admin 1", email: `reh-adm1-${stamp}@example.test`, passwordHash: "x", role: "ADMIN" } });
const adm2 = admins[1] ?? await prisma.user.create({ data: { name: "REH Admin 2", email: `reh-adm2-${stamp}@example.test`, passwordHash: "x", role: "ADMIN" } });
const biasa = nonAdmin ?? await prisma.user.create({ data: { name: "REH Sales", email: `reh-sls-${stamp}@example.test`, passwordHash: "x", role: "SALES" } });
cek("akun uji tersedia: dua Admin Finance (finance:admin) dan satu akun non-Admin", !!adm1 && !!adm2 && adm1.id !== adm2.id && !!biasa);
const t1 = await token(adm1); const t2 = await token(adm2); const tN = await token(biasa);
const H = async (metode, p, tok, body = null, kunci = null) => { const r = await fetch(BASE + p, { method: metode, headers: { "Content-Type": "application/json", ...(tok ? { Authorization: "Bearer " + tok } : {}), ...(kunci ? { "Idempotency-Key": kunci } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); let j = null; try { j = await r.json(); } catch { /* bukan JSON */ } return { status: r.status, body: j }; };
let seq = 0; const kunci = (p) => `reh-pbm-${p}-${Date.now().toString(36)}-${++seq}-xxxxxxxx`;
const PO = "/api/finance/purchase-orders"; const CEK_PO = `${PO}/sku/cek-duplikat-po`;
const hariIni = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
const mb = (nama, o = {}) => ({ nama, kategori: "Busa", jenis: "BAHAN_PRODUKSI", spesifikasi: null, satuanBeli: "SHEET", satuanStok: "SHEET", ...o });
const baris = (nama, q = 10, harga = 150_000, o = {}) => ({ materialBaru: mb(nama, o), qty: q, unitPrice: harga });
const sup = await prisma.finSupplier.findFirst({ where: { active: true }, orderBy: { createdAt: "asc" } }) ?? await prisma.finSupplier.create({ data: { code: `SUP-REH-${stamp}`, name: "PEMASOK REH" } });
const po = (lines, supplierId = sup.id) => ({ supplierId, orderDate: hariIni, lines });
const jejak = async () => ({
  material: await prisma.material.count(), katalog: await prisma.finSupplierMaterial.count(), asal: await prisma.finMaterialSkuOrigin.count(), po: await prisma.finPurchaseOrder.count(), poBaris: await prisma.finPurchaseOrderLine.count(),
  harga: await prisma.materialHargaBerlaku.count(), stok: await prisma.stockMovement.count(), jurnal: await prisma.finJournalEntry.count(), jurnalBaris: await prisma.finJournalLine.count(),
});
const sama = (x, y) => JSON.stringify(x) === JSON.stringify(y);
const sidik = async (ids) => String((await prisma.$queryRawUnsafe("select coalesce(md5(string_agg(m::text, '|' order by m.id::text)), '-') as n from materials m where m.id::text = any($1::text[])", ids))[0].n);

// ── A. material NYATA di salinan (BUS-008..015 bila ada): pratinjau menunjuk kode sendiri; PO yang mengulang namanya ditolak; isi barisnya tidak berubah sama sekali
const nyata = await prisma.$queryRawUnsafe("select id::text id, code, name, unit from materials where active = true and code like 'BUS-%' and name ~ '[0-9]+ ?[xX×] ?[0-9]+' order by code limit 8");
if (nyata.length >= 1) {
  const ids = nyata.map((m) => m.id); const s0 = await sidik(ids); const j0 = await jejak();
  const tulisUlang = nyata.map((m, i) => (i % 2 ? m.name.toLowerCase().replace(/\s*x\s*/g, " × ") : m.name.replace(/\s+/g, "  ")));
  const pv = await H("POST", CEK_PO, t1, { supplierId: sup.id, barisBaru: nyata.map((m, i) => ({ baris: i + 1, materialBaru: mb(tulisUlang[i], { satuanStok: m.unit, satuanBeli: m.unit }) })) });
  cek(`material NYATA (${nyata.map((m) => m.code).join(", ")}): pratinjau menunjuk KODE MATERIALNYA SENDIRI (juga setelah ejaan/spasi/× diubah) dan memblokir tiap baris`, pv.status === 200 && pv.body?.bolehSimpan === false && pv.body.baris.every((r, i) => r.diblokir && r.pasti.some((c) => c.materialId === nyata[i].id)), `${pv.status} ${JSON.stringify((pv.body?.baris ?? []).map((r) => r.pasti?.[0]?.kode))}`);
  const tolak = await H("POST", PO, t1, po(nyata.map((m, i) => baris(tulisUlang[i], 5, 150_000, { satuanStok: m.unit, satuanBeli: m.unit }))), kunci("nyata"));
  cek("PO yang mengulang nama material nyata ditolak 409 SKU_DUPLIKAT_PASTI, menunjuk baris dan kode; tidak ada yang dibuat ulang", tolak.status === 409 && tolak.body?.code === "SKU_DUPLIKAT_PASTI" && tolak.body?.baris === 1 && sama(await jejak(), j0), `${tolak.status} ${tolak.body?.code}`);
  cek("isi LENGKAP baris material nyata identik (kode tidak diganti, tidak digabung, tidak dihapus, tidak diubah)", (await sidik(ids)) === s0 && (await num("select count(*)::int n from materials where id::text = any($1::text[])", ids)) === nyata.length);
} else cek("material nyata BUS-* beraturan ukuran di salinan (dilewati: tidak ada)", true, "dilewati");

// ── B. delapan varian BARU berbeda ukuran/ketebalan dalam satu PO: tanpa konfirmasi/alasan; stok/jurnal/Harga Berlaku tidak tersentuh
const dasarNama = `BUSA REH UJI ${stamp.toUpperCase()}`;
const DELAPAN = ["2CM", "4CM"].flatMap((t) => ["120X200", "160X200", "180X200", "200X200"].map((u) => `${dasarNama} ${u}X${t} R58`));
const jB0 = await jejak();
const pvB = await H("POST", CEK_PO, t1, { supplierId: sup.id, barisBaru: DELAPAN.map((nama, i) => ({ baris: i + 1, materialBaru: mb(nama) })) });
cek("pratinjau 8 varian (2/4 cm × 4 ukuran): boleh simpan, tanpa blokir dan tanpa konfirmasi; saran varian serupa hanya informasi; baca-saja", pvB.status === 200 && pvB.body?.bolehSimpan === true && pvB.body.baris.every((r) => !r.diblokir && !r.perluKonfirmasi) && sama(await jejak(), jB0), `${pvB.status}`);
const kB = kunci("lapan"); const rB = await H("POST", PO, t1, po(DELAPAN.map((nama, i) => baris(nama, 10 + i, 150_000, { kodeSupplier: `REH-${stamp}-${i + 1}` }))), kB);
const jB1 = await jejak(); const asalB = await prisma.finMaterialSkuOrigin.findMany({ where: { material: { name: { startsWith: dasarNama } } } });
cek("simpan 8 varian: 201, 1 PO, 8 material, 8 katalog supplier, 8 asal SKU; TANPA alasan override; stok/jurnal/baris jurnal/Harga Berlaku TIDAK berubah", rB.status === 201 && jB1.po === jB0.po + 1 && jB1.material === jB0.material + 8 && jB1.katalog === jB0.katalog + 8 && jB1.asal === jB0.asal + 8 && jB1.stok === jB0.stok && jB1.jurnal === jB0.jurnal && jB1.jurnalBaris === jB0.jurnalBaris && jB1.harga === jB0.harga && asalB.length === 8 && asalB.every((o) => o.duplicateOverrideReason === null), `${rB.status} ${JSON.stringify(rB.body?.error ?? "")}`);

// ── C. klik ganda (kunci sama, isi sama): SATU hasil
const nGanda = `${dasarNama} 150X200X3CM R58`; const kG = kunci("ganda"); const bodyG = po([baris(nGanda, 4, 120_000, { kodeSupplier: `REH-${stamp}-G` })]); const jC0 = await jejak();
const dobel = await Promise.all([H("POST", PO, t1, bodyG, kG), H("POST", PO, t1, bodyG, kG)]); const susulan = await H("POST", PO, t1, bodyG, kG); const jC1 = await jejak();
cek("klik ganda (paralel + susulan) dengan kunci sama: tepat SATU PO dan SATU material baru; respons susulan = PO yang sama", dobel.some((x) => x.status === 201) && dobel.every((x) => [200, 201, 409].includes(x.status)) && [200, 201].includes(susulan.status) && jC1.po === jC0.po + 1 && jC1.material === jC0.material + 1, `${dobel.map((x) => x.status)} ${susulan.status}`);

// ── D. ambigu butuh keputusan; duplikat antar-baris ditunjuk; gagal simpan tidak meninggalkan setengah jadi
const ambigu = `${dasarNama} R58`; const jD0 = await jejak();
const pvD = await H("POST", CEK_PO, t1, { supplierId: sup.id, barisBaru: [{ baris: 1, materialBaru: mb(ambigu) }] });
cek("nama tanpa ukuran terhadap varian ber-ukuran = AMBIGU: perlu konfirmasi (bukan sama, bukan berbeda)", pvD.status === 200 && pvD.body?.baris?.[0]?.perluKonfirmasi === true && pvD.body.baris[0].diblokir === false, `${pvD.status}`);
const tolakD = await H("POST", PO, t1, po([baris(`${dasarNama} 175X200X3CM R58`), baris(ambigu)]), kunci("amb"));
cek("simpan tanpa keputusan ditolak 409 SKU_MIRIP_BUTUH_KONFIRMASI menunjuk baris 2; baris 1 (varian sah) ikut dibatalkan: tidak ada setengah jadi", tolakD.status === 409 && tolakD.body?.code === "SKU_MIRIP_BUTUH_KONFIRMASI" && tolakD.body?.baris === 2 && sama(await jejak(), jD0), `${tolakD.status} ${tolakD.body?.code}`);
const kembar = [baris(`${dasarNama} 190X200X3CM R58`), baris(`busa  reh uji ${stamp} 190 x 200 x 3 cm r58`)]; const tolakK = await H("POST", PO, t1, po(kembar), kunci("kembar"));
cek("duplikat antar-baris (ejaan lain, baris sama): 409 SKU_DUPLIKAT_DALAM_PO menunjuk baris 2 = baris 1; tidak ada yang tertulis", tolakK.status === 409 && tolakK.body?.code === "SKU_DUPLIKAT_DALAM_PO" && tolakK.body?.baris === 2 && tolakK.body?.barisSama === 1 && sama(await jejak(), jD0), `${tolakK.status} ${tolakK.body?.code}`);
const tolakQ = await H("POST", PO, t1, po([baris(`${dasarNama} 195X200X3CM R58`), baris(`${dasarNama} 195X200X5CM R58`, 0)]), kunci("qty0"));
cek("baris tak sah (jumlah 0) setelah baris varian sah: ditolak 4xx; material baris 1 TIDAK tertinggal", tolakQ.status >= 400 && tolakQ.status < 500 && sama(await jejak(), jD0), `${tolakQ.status}`);
const kBetul = kunci("betul"); const gagalDulu = await H("POST", PO, t1, po([baris(`${dasarNama} 185X200X3CM R58`), baris(`${dasarNama} 120 X 200 X 2 cm R58`)]), kBetul);
const okLagi = await H("POST", PO, t1, po([baris(`${dasarNama} 185X200X3CM R58`), baris(`${dasarNama} 185X200X6CM R58`)]), kBetul);
cek("kunci yang gagal tidak terkunci: baris dibetulkan lalu simpan ulang berhasil utuh (201, 2 material baru, 1 PO)", gagalDulu.status === 409 && okLagi.status === 201 && (await jejak()).material === jD0.material + 2 && (await jejak()).po === jD0.po + 1, `${gagalDulu.status}/${okLagi.status}`);
const dgn = await H("POST", PO, t1, po([baris(`${dasarNama} 170X200X3CM R58`), baris(ambigu, 10, 150_000, { konfirmasiMirip: true, alasanMirip: "Barang berbeda: nama tanpa ukuran, ini varian lain (uji rehearsal)" })]), kunci("kons"));
cek("dengan konfirmasi + alasan: ambigu tersimpan; alasan tercatat pada asal SKU; varian sah di baris lain tanpa alasan paksaan", dgn.status === 201 && (await prisma.finMaterialSkuOrigin.count({ where: { duplicateOverrideReason: { contains: "uji rehearsal" } } })) === 1, `${dgn.status}`);

// ── E. dua pengguna menyimpan barang yang sama BERSAMAAN, urutan baris berlawanan
/* keluarga nama lain dari skenario D (yang sengaja membuat nama tanpa ukuran) */ const X = "PITA REH PARALEL 5 CM"; const Y = "PITA REH PARALEL 7 CM"; const jE0 = await jejak();
const [ra, rb] = await Promise.all([H("POST", PO, t1, po([baris(X, 10, 5_000, { kategori: "Aksesori" }), baris(Y, 10, 5_000, { kategori: "Aksesori" })]), kunci("e1")), H("POST", PO, t2, po([baris("pita  reh paralel 7cm", 10, 5_000, { kategori: "Aksesori" }), baris("Pita Reh Paralel 5 cm", 10, 5_000, { kategori: "Aksesori" })]), kunci("e2"))]); const jE1 = await jejak();
cek("dua pengguna bersamaan (urutan berlawanan): tepat satu 201 dan satu 409 SKU_DUPLIKAT_PASTI (tanpa deadlock/500); tepat 2 material baru dan 1 PO", [ra.status, rb.status].sort().join() === "201,409" && [ra, rb].some((x) => x.body?.code === "SKU_DUPLIKAT_PASTI") && jE1.material === jE0.material + 2 && jE1.po === jE0.po + 1, `${ra.status}/${rb.status} ${ra.body?.code ?? ""}/${rb.body?.code ?? ""}`);

// ── F. izin dan penegakan sebelum menulis
const jF0 = await jejak();
const f401 = await H("POST", PO, null, po([baris(`${dasarNama} 230X200X3CM R58`)]), kunci("f1")); const f403 = await H("POST", PO, tN, po([baris(`${dasarNama} 230X200X3CM R58`)]), kunci("f2")); const c403 = await H("POST", CEK_PO, tN, { supplierId: sup.id, barisBaru: [] }); const c401 = await H("POST", CEK_PO, null, { supplierId: sup.id, barisBaru: [] });
cek("izin: tanpa token 401; akun non-Admin 403 (simpan dan cek-duplikat-po); tidak ada tulisan", f401.status === 401 && f403.status === 403 && c403.status === 403 && c401.status === 401 && sama(await jejak(), jF0), `${f401.status}/${f403.status}/${c403.status}/${c401.status}`);

// ── G. kode SMOKE pasca-switch yang sama dijalankan terhadap server rehearsal: salah harapan terdeteksi SEBELUM deploy
const tidakSeimbang = await num("select count(*)::int n from (select e.id from fin_journal_entries e join fin_journal_lines l on l.entry_id = e.id group by e.id having sum(l.debit) <> sum(l.credit)) x");
const sm = spawnSync(process.execPath, ["--input-type=module", "-"], { input: SMOKE_SRC, cwd: APP, encoding: "utf8", timeout: 240000, env: { ...process.env, SMOKE_BASE: BASE, APP_DIR: APP, BASE_TIDAK_SEIMBANG: String(tidakSeimbang), BASE_GANDA: "0", ORDER_N: String(await num('select count(*)::int n from "Order"')), JOB_N: String(await num("select count(*)::int n from jobs")) } });
const smokeLine = (String(sm.stdout).match(/^SMOKE_HASIL .*$/m) ?? [""])[0]; const smokeGagal = String(sm.stdout).split("\n").filter((l) => /^\s+FAIL/.test(l)).join(" | ");
cek("SMOKE pasca-switch (kode yang sama dengan fase 8b) lulus terhadap server rehearsal: 0 gagal", sm.status === 0 && /^SMOKE_HASIL fail=0 /.test(smokeLine), smokeLine + " " + smokeGagal + " " + String(sm.stderr).slice(-150));
berhenti(); await prisma.$disconnect();
console.log("PEMERIKSAAN=" + n + " gagal=" + gagal);
process.exit(gagal === 0 ? 0 : 1);
