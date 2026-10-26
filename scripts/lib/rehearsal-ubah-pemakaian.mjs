import { createRequire } from "node:module";
import { spawn, spawnSync } from "node:child_process";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const { ROLE_PERMISSIONS, PERMISSIONS: P } = await import("/app/src/constants/permissions.js");
let gagal = 0; let n = 0;
const cek = (nama, ok, d = "") => { n += 1; if (!ok) gagal += 1; console.log(`${ok ? "OK   " : "GAGAL"} ${nama}${d ? " — " + String(d).slice(0, 220) : ""}`); };
const num = async (q, ...a) => Number((await prisma.$queryRawUnsafe(q, ...a))[0].n);
const SMOKE_SRC = "@@SMOKE_SRC@@"; // diganti generator dengan isi smoke-ubah-pemakaian.mjs
const nm = process.env.REH_DB_NAME ?? (await prisma.$queryRawUnsafe("select current_database() as n"))[0].n;
if (!/^rehearsal_/.test(nm)) { cek("uji Edit pemakaian hanya pada DB rehearsal", false, nm); await prisma.$disconnect(); process.exit(1); }
// REHEARSAL "Tambah pemakaian + Edit per bahan": kode BARU dijalankan sebagai SERVER sungguhan (index.js, port 4101, tanpa job latar, variabel eksternal dinetralkan) terhadap SALINAN RESTORE production. Semua tulisan hanya di DB sementara ini.
const { neutralizeExternalEnv } = await import("/app/src/lib/stagingGuard.js"); neutralizeExternalEnv(process.env);
const PORT = 4101; const BASE = `http://127.0.0.1:${PORT}`;
const child = spawn(process.execPath, ["src/index.js"], { cwd: "/app", env: { ...process.env, PORT: String(PORT), DISABLE_BACKGROUND_JOBS: "1" }, stdio: ["ignore", "pipe", "pipe"] });
let log = ""; child.stdout.on("data", (d) => { log += d; }); child.stderr.on("data", (d) => { log += d; });
const berhenti = () => { try { child.kill("SIGTERM"); } catch { /* sudah mati */ } };
let sehat = false; for (let i = 0; i < 60 && !sehat; i++) { try { sehat = (await fetch(BASE + "/api/health")).ok; } catch { await new Promise((r) => setTimeout(r, 1000)); } }
cek("server kode baru hidup pada salinan restore (/api/health)", sehat, sehat ? "" : log.slice(-300)); if (!sehat) { berhenti(); await prisma.$disconnect(); process.exit(1); }
const rolesDari = async (u) => new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);
const bisa = (rs, izin) => [...rs].some((r) => (ROLE_PERMISSIONS[r] ?? []).includes(izin));
const token = async (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: [...(await rolesDari(u))] }, process.env.JWT_SECRET, { expiresIn: "25m" });
const semua = await prisma.user.findMany({ where: { active: true }, orderBy: { id: "asc" } }); const info = []; for (const u of semua) info.push({ u, rs: await rolesDari(u) });
const adm = info.find((x) => bisa(x.rs, P.UNIT_MATERIAL_WRITE) && bisa(x.rs, P.INVENTORY_WRITE) && !bisa(x.rs, P.INVENTORY_ADJUSTMENT_APPROVE))?.u; const own = info.find((x) => x.rs.has("OWNER"))?.u; const sls = info.find((x) => !bisa(x.rs, P.UNIT_MATERIAL_WRITE) && !bisa(x.rs, P.INVENTORY_WRITE))?.u;
cek("akun uji tersedia pada salinan: pemohon (izin tulis, bukan penyetuju), Owner penyetuju, akun tanpa izin", !!adm && !!own && !!sls, `${!!adm}/${!!own}/${!!sls}`); if (!adm || !own || !sls) { berhenti(); process.exit(1); }
const tA = await token(adm); const tO = await token(own); const tS = await token(sls);
const H = async (metode, path, tok, body = null, kunci = null) => { const r = await fetch(BASE + path, { method: metode, headers: { "Content-Type": "application/json", ...(tok ? { Authorization: "Bearer " + tok } : {}), ...(kunci ? { "Idempotency-Key": kunci } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); let j = null; try { j = await r.json(); } catch { /* bukan JSON */ } return { status: r.status, body: j }; };
let seq = 0; const kunci = (p) => `reh-ub-${p}-${Date.now().toString(36)}-${++seq}-xxxxxxxx`;
const wib = (d) => new Date(new Date(d).getTime() + 7 * 3600_000).toISOString().slice(0, 10);
const saldo = async (m) => Number((await prisma.$queryRaw`SELECT COALESCE(SUM(qty),0)::float AS s FROM stock_movements WHERE material_id = ${m}::uuid`)[0].s);
const HARI = 86400_000;
// jejak seluruh tulisan yang mungkin ikut tercipta: pergerakan, HPP beku, valuasi/jurnal/celah Finance, perintah idempotensi, aktivitas, koreksi + saldo kedua bahan
const jejak = async (a, b) => ({ mov: await prisma.stockMovement.count(), hpp: await prisma.stockMovementBiayaOperasional.count(), val: await prisma.finStockMovementValuation.count(), jur: await prisma.finJournalEntry.count(), baris: await prisma.finJournalLine.count(), gap: await prisma.finPostingGap.count(), cmd: await prisma.v2Command.count(), akt: await prisma.activityEvent.count(), kor: await prisma.warehouseCorrection.count(), sa: await saldo(a), sb: await saldo(b) });
const sama = (x, y) => JSON.stringify(x) === JSON.stringify(y);

// data uji dari salinan restore
const unit = (await prisma.$queryRawUnsafe(`select u.id::text id, u.unit_code kode, u.created_at dibuat from units u where u.status::text = 'DELIVERED' and not exists (select 1 from stock_movements s where s.unit_id = u.id) and not exists (select 1 from unit_usage_notes x where x.unit_id = u.id) and not exists (select 1 from unit_provisional_usages y where y.unit_id = u.id) and not exists (select 1 from unit_component_reuse_entries z where z.unit_id = u.id) and not exists (select 1 from warehouse_corrections c where c.doc_id = u.id) order by u.created_at desc limit 1`))[0];
const pilihMat = (kecuali, min) => prisma.$queryRawUnsafe(`select m.id::text id, m.code kode, m.unit satuan from materials m where m.active and coalesce(m.kind::text,'') <> 'PERLENGKAPAN_STOK' and m.id::text <> all($1::text[]) and (select coalesce(sum(qty),0) from stock_movements s where s.material_id = m.id) >= $2 and not exists (select 1 from stock_movements s where s.material_id = m.id and s.unit_id is null and s.type::text in ('ISSUE','WASTE') and s.created_at > now() - interval '60 days') and not exists (select 1 from material_harga_berlaku h where h.material_id = m.id) and not exists (select 1 from stock_movements s where s.material_id = m.id and s.material_issue_id is not null and s.unit_id = $3::uuid) order by m.code limit 1`, kecuali, min, unit?.id ?? "00000000-0000-0000-0000-000000000000").then((r) => r[0]);
const matA = await pilihMat(["x"], 20); const matB = matA ? await pilihMat([matA.id], 10) : null;
cek(`data uji tersedia: unit terkirim bersih ${unit?.kode}, bahan A ${matA?.kode} (saldo ≥ 20) dan bahan B ${matB?.kode} (saldo ≥ 10), keduanya tanpa Harga Berlaku`, !!unit && !!matA && !!matB); if (!unit || !matA || !matB) { berhenti(); process.exit(1); }
const T = wib(unit.dibuat); const hariIni = wib(new Date()); const awalT = new Date(`${T}T00:00:00+07:00`);
const PRA = (u) => `/api/production/units/${u}/perubahan-pemakaian/pratinjau`; const PASANG = (u) => `/api/production/units/${u}/perubahan-pemakaian`; const PRAB = (u) => `/api/production/units/${u}/pembetulan-bahan/pratinjau`; const POSTM = (u) => `/api/units/${u}/materials`;
const hb = (mat, harga, mulai, k) => prisma.materialHargaBerlaku.create({ data: { materialId: mat.id, jenis: "HARGA", unitPrice: String(harga), satuan: mat.satuan, effectiveFrom: mulai, createdAt: mulai, reason: "REH: harga uji", idempotencyKey: kunci(k) } });
const tetap = ["fin_inventory_openings", "goods_receipts", "fin_purchase_orders", "fin_supplier_bills", "fin_stock_movement_valuation_corrections", "unit_usage_notes", "koreksi_saldo_bahan", "stock_adjustment_requests", "unit_provisional_usages", "unit_component_reuse_entries"];
const hitungTetap = async () => { const o = {}; for (const t of tetap) o[t] = await num(`select count(*)::int n from "${t}"`); return o; }; const tetap0 = await hitungTetap();

// ── A. KOREKSI SALDO yang sudah live tetap utuh (dibaca SEBELUM uji tulis)
const ms = await num("select count(*)::int n from _prisma_migrations where migration_name like '%koreksi_saldo%' and finished_at is not null");
const KS = "/api/inventory/adjustments/koreksi-saldo"; const ks0 = await H("GET", `${KS}/bahan/${matA.id}`, tO); const rh0 = await H("GET", "/api/finance/biaya-bahan/harga-berlaku/ringkasan-daftar", tO);
cek("Koreksi Saldo live utuh sebelum uji: migrasi terpasang, tabel konteks ada, keadaan bahan 200 dengan keadaan saldo valid, ringkasan harga daftar 200", ms >= 1 && ks0.status === 200 && ["BELUM_ADA_CATATAN", "NOL_MENURUT_PERGERAKAN", "NOL_TERVERIFIKASI", "POSITIF", "MINUS"].includes(ks0.body?.keadaanSaldo) && rh0.status === 200, `${ms}/${ks0.status}/${ks0.body?.keadaanSaldo}/${rh0.status}`);

// ── B. persiapan: harga uji + pemakaian awal bahan A (3) lewat jalur resmi Tambah (pembetulan terkirim) agar HPP beku ada
await hb(matA, 20000, new Date(awalT.getTime() - 10 * HARI), "hbA1"); await hb(matB, 12000, new Date(awalT.getTime() - 10 * HARI), "hbB1");
const pAwal = await H("POST", PRAB(unit.id), tA, { materialId: matA.id, jenis: "TAMBAH", qty: 3, tanggalPemakaian: T });
const awal = await H("POST", POSTM(unit.id), tA, { materialId: matA.id, qty: 3, alasanPembetulan: "REH: pemakaian awal untuk uji Edit", tanggalPemakaian: T, saldoDilihat: pAwal.body?.stok?.saldoDilihat, hppSidik: pAwal.body?.hppOperasional?.sidik, konfirmasiBukanGanda: true }, kunci("awal"));
const opAwal = awal.body?.id ? (await prisma.$queryRawUnsafe(`select unit_cost::float uc from stock_movement_biaya_operasional where movement_id = $1::uuid`, awal.body.id))[0] : null;
cek("pemakaian awal bahan A (3) lewat jalur resmi: tersimpan, HPP beku pada harga tanggal dilaporkan (20000)", awal.status === 201 && opAwal?.uc === 20000, `${awal.status}/${opAwal?.uc}`);
await hb(matA, 30000, new Date(awalT.getTime() + 1000), "hbA2"); await hb(matB, 18000, new Date(awalT.getTime() + 1000), "hbB2"); // harga naik 1 detik sesudah awal tanggal dilaporkan: hari pencatatan memakai harga baru

// ── C. izin dan alasan wajib (ditolak SEBELUM menulis)
const bodyU = { materialId: matA.id, qtyBaru: 5, tanggalPemakaian: T }; const pU = await H("POST", PRA(unit.id), tA, bodyU);
cek("pratinjau ubah jumlah 3 → 5 (unit terkirim): jalur LANGSUNG, 1 langkah pengeluaran, harga pada tanggal dilaporkan (20000, bukan 30000 hari ini), baca-saja", pU.status === 200 && pU.body?.jalur === "LANGSUNG" && pU.body?.langkah?.length === 1 && pU.body.langkah[0].jenis === "ISSUE" && pU.body.langkah[0].hppOperasional?.harga === 20000 && pU.body.langkah[0].hppOperasional?.tanggalDasar === T && pU.body?.boleh === true, JSON.stringify(pU.body?.langkah?.[0]?.hppOperasional)?.slice(0, 120));
const J0 = await jejak(matA.id, matB.id);
const pTT = await H("POST", PRA(unit.id), null, bodyU); const pSS = await H("POST", PRA(unit.id), tS, bodyU); const cSS = await H("POST", PASANG(unit.id), tS, { ...bodyU, alasan: "REH: uji izin", dilihat: pU.body.sidik }, kunci("s"));
cek("izin: tanpa token 401; akun tanpa izin 403 untuk pratinjau dan penerapan", pTT.status === 401 && pSS.status === 403 && cSS.status === 403);
const aW = []; for (const alasan of [undefined, "", "abcd"]) aW.push(await H("POST", PASANG(unit.id), tA, { ...bodyU, alasan, dilihat: pU.body.sidik }, kunci("alasan")));
const ajW = await H("POST", `/api/production/units/${unit.id}/koreksi-pemakaian`, tA, { materialId: matA.id, qtyBaru: 5, alasan: "abcd", tanggalPemakaian: T }, kunci("ajw"));
const tkKey = await H("POST", PASANG(unit.id), tA, { ...bodyU, alasan: "REH: tanpa kunci", dilihat: pU.body.sidik });
cek("ALASAN WAJIB di server: tanpa/kosong/<5 karakter = 400 UNIT_ALASAN_PEMBETULAN_WAJIB (ubah) dan ALASAN_WAJIB (pengajuan); tanpa Idempotency-Key = 400; tidak ada yang tersimpan", aW.every((r) => r.status === 400 && r.body?.code === "UNIT_ALASAN_PEMBETULAN_WAJIB") && ajW.status === 400 && ajW.body?.code === "ALASAN_WAJIB" && tkKey.status === 400 && sama(await jejak(matA.id, matB.id), J0), aW.map((r) => r.body?.code).join(","));

// ── D. ubah jumlah berhasil + idempoten (klik ganda)
const kU = kunci("ubah"); const [u1, u2] = await Promise.all([H("POST", PASANG(unit.id), tA, { ...bodyU, alasan: "REH: pemakaian sebenarnya 5", dilihat: pU.body.sidik, konfirmasiBukanGanda: true }, kU), H("POST", PASANG(unit.id), tA, { ...bodyU, alasan: "REH: pemakaian sebenarnya 5", dilihat: pU.body.sidik, konfirmasiBukanGanda: true }, kU)]);
const movA = (await prisma.$queryRawUnsafe(`select type::text t, qty::float q, note from stock_movements where unit_id = $1::uuid and material_id = $2::uuid order by created_at`, unit.id, matA.id));
cek("ubah jumlah: klik ganda (kunci sama, paralel) = SATU pergerakan ISSUE baru; baris lama utuh; catatan baku memuat tanggal dilaporkan; stok turun 2", [u1.status, u2.status].every((s) => [200, 201].includes(s)) && [u1.status, u2.status].includes(201) && movA.length === 2 && movA[0].q === -3 && movA[1].t === "ISSUE" && movA[1].q === -2 && movA[1].note.startsWith(`Pembetulan unit terkirim (${unit.kode}) [dilaporkan ${T}]: REH: pemakaian sebenarnya 5`), `${u1.status}/${u2.status}/${movA.length}`);
const opU = (await prisma.$queryRawUnsafe(`select b.unit_cost::float uc, b.basis_detail->>'dasarTanggal' dt from stock_movement_biaya_operasional b join stock_movements s on s.id = b.movement_id where s.unit_id = $1::uuid and s.material_id = $2::uuid and s.qty = -2`, unit.id, matA.id))[0];
cek("HPP pemakaian baru (ISSUE +2) dibekukan pada harga TANGGAL dilaporkan 20000 (bukan 30000 hari pencatatan) dan tanggal dasar tersimpan", opU?.uc === 20000 && opU.dt === T, JSON.stringify(opU));
const ulang = await H("POST", PASANG(unit.id), tA, { ...bodyU, alasan: "REH: pemakaian sebenarnya 5", dilihat: pU.body.sidik, konfirmasiBukanGanda: true }, kU); const bedaIsi = await H("POST", PASANG(unit.id), tA, { ...bodyU, qtyBaru: 4, alasan: "REH: pemakaian sebenarnya 5", dilihat: pU.body.sidik, konfirmasiBukanGanda: true }, kU);
cek("kunci yang sama: ulang = respons tersimpan (200, ulang=true); kunci sama dengan isian berbeda ditolak (IDEMPOTENCY_KEY_REUSED)", ulang.status === 200 && ulang.body?.ulang === true && bedaIsi.status === 409 && bedaIsi.body?.code === "IDEMPOTENCY_KEY_REUSED");

// ── E. saldo / pemakaian / dasar harga bergeser setelah pratinjau
const pS = await H("POST", PRA(unit.id), tA, { materialId: matA.id, qtyBaru: 4, tanggalPemakaian: T });
await prisma.$executeRawUnsafe(`insert into stock_movements (id, material_id, type, qty, note) values (gen_random_uuid(), $1::uuid, 'ISSUE', -1, 'REH: pengeluaran orang lain setelah pratinjau')`, matA.id);
const J1 = await jejak(matA.id, matB.id); const gS = await H("POST", PASANG(unit.id), tA, { materialId: matA.id, qtyBaru: 4, tanggalPemakaian: T, alasan: "REH: uji saldo bergeser", dilihat: pS.body.sidik }, kunci("geser"));
cek("saldo bergeser setelah pratinjau → 409 UNIT_SALDO_BERGESER, tidak ada yang tersimpan", gS.status === 409 && gS.body?.code === "UNIT_SALDO_BERGESER" && sama(await jejak(matA.id, matB.id), J1), `${gS.status} ${gS.body?.code}`);
const pH = await H("POST", PRA(unit.id), tA, { materialId: matA.id, qtyBaru: 6, tanggalPemakaian: T }); await hb(matA, 31000, new Date(awalT.getTime() - 5 * HARI), "hbA3"); const J2 = await jejak(matA.id, matB.id);
const gH = await H("POST", PASANG(unit.id), tA, { materialId: matA.id, qtyBaru: 6, tanggalPemakaian: T, alasan: "REH: uji dasar harga bergeser", dilihat: pH.body.sidik }, kunci("harga"));
cek("dasar harga bergeser setelah pratinjau (harga berlaku pada tanggal itu berubah) → 409 UNIT_DASAR_HARGA_BERGESER, tidak ada yang tersimpan", gH.status === 409 && gH.body?.code === "UNIT_DASAR_HARGA_BERGESER" && sama(await jejak(matA.id, matB.id), J2), `${gH.status} ${gH.body?.code}`);

// ── F. GANTI BAHAN: kegagalan di langkah KEDUA tidak meninggalkan apa pun; lalu berhasil utuh
const bodyG = { materialId: matA.id, qtyBaru: 0, keMaterialId: matB.id, qtyKe: 4, tanggalPemakaian: T }; const pG = await H("POST", PRA(unit.id), tA, bodyG); const bersihA = pG.body?.dari?.bersihSebelum;
cek("pratinjau ganti bahan: dua langkah (pengembalian A sebesar pemakaian bersih, pengeluaran B 4); pengembalian = harga ISSUE ASAL (20000, bukan harga sekarang 30000); pengeluaran B = harga tanggal dilaporkan (12000, bukan 18000); penjelasan SEKALIGUS", pG.status === 200 && pG.body?.boleh === true && pG.body.langkah?.length === 2 && pG.body.langkah[0].jenis === "RETURN" && pG.body.langkah[0].hppOperasional?.basis === "HARGA_ISSUE_ASAL" && pG.body.langkah[0].hppOperasional?.harga === 20000 && pG.body.langkah[1].jenis === "ISSUE" && pG.body.langkah[1].hppOperasional?.harga === 12000 && /SEKALIGUS/.test((pG.body.ringkas ?? []).join(" ")), `${pG.status} ${bersihA}`);
const kG = kunci("ganti"); const S0 = await jejak(matA.id, matB.id);
await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION reh_tolak_b() RETURNS trigger AS $fn$ BEGIN IF NEW.material_id = '${matB.id}'::uuid AND NEW.type::text = 'ISSUE' THEN RAISE EXCEPTION 'reh: pengeluaran bahan pengganti ditolak (uji kegagalan langkah kedua)'; END IF; RETURN NEW; END $fn$ LANGUAGE plpgsql`);
await prisma.$executeRawUnsafe("CREATE TRIGGER reh_tolak_b_trg BEFORE INSERT ON stock_movements FOR EACH ROW EXECUTE FUNCTION reh_tolak_b()");
let gagalG; try { gagalG = await H("POST", PASANG(unit.id), tA, { ...bodyG, alasan: "REH: ganti bahan (uji gagal langkah kedua)", dilihat: pG.body.sidik, konfirmasiBukanGanda: true }, kG); } finally { await prisma.$executeRawUnsafe("DROP TRIGGER IF EXISTS reh_tolak_b_trg ON stock_movements"); await prisma.$executeRawUnsafe("DROP FUNCTION IF EXISTS reh_tolak_b()"); }
const S1 = await jejak(matA.id, matB.id);
cek("KEGAGALAN LANGKAH KEDUA (pengeluaran bahan pengganti ditolak setelah pengembalian bahan lama berhasil dicoba): respons galat; pergerakan stok, HPP beku, valuasi, jurnal + baris jurnal, celah Finance, perintah idempotensi, aktivitas, koreksi, dan saldo kedua bahan IDENTIK dengan sebelum", gagalG.status >= 400 && sama(S0, S1), `${gagalG.status} ${JSON.stringify(S0) === JSON.stringify(S1) ? "identik" : "BEDA " + JSON.stringify(S1)}`);
const okG = await H("POST", PASANG(unit.id), tA, { ...bodyG, alasan: "REH: ganti bahan A ke B", dilihat: pG.body.sidik, konfirmasiBukanGanda: true }, kG);
const mvG = (okG.body?.langkah ?? []); const opG = []; for (const l of mvG) opG.push((await prisma.$queryRawUnsafe(`select b.status, b.unit_cost::float uc, b.value::float v, b.basis_harga::text bh, b.basis_detail->>'dasarTanggal' dt from stock_movement_biaya_operasional b where b.movement_id = $1::uuid`, l.movementId))[0]);
cek("GANTI BAHAN berhasil UTUH setelah percobaan gagal (kunci yang sama dapat dipakai lagi): dua pergerakan (RETURN A, ISSUE B); stok A naik sebesar pemakaian bersih, stok B turun 4; HPP RETURN = harga ISSUE asal 20000 (basis HARGA_ISSUE_ASAL), HPP ISSUE B = 12000 pada tanggal dilaporkan", okG.status === 201 && mvG.length === 2 && opG[0]?.bh === "HARGA_ISSUE_ASAL" && opG[0].uc === 20000 && opG[1]?.uc === 12000 && opG[1].dt === T && Math.abs((await saldo(matB.id)) - (S1.sb - 4)) < 1e-6 && Math.abs((await saldo(matA.id)) - (S1.sa + bersihA)) < 1e-6, `${okG.status} ${JSON.stringify(opG)}`);
const J3 = await jejak(matA.id, matB.id); const rG = await H("POST", PASANG(unit.id), tA, { ...bodyG, alasan: "REH: ganti bahan A ke B", dilihat: pG.body.sidik, konfirmasiBukanGanda: true }, kG);
cek("ganti bahan diulang dengan kunci yang sama = respons tersimpan, tanpa pergerakan tambahan", rG.status === 200 && rG.body?.ulang === true && sama(await jejak(matA.id, matB.id), J3));
const hasilFin = (pG.body?.langkah ?? []).map((l) => l.finance?.hasil); const dJur = J3.jur - S1.jur; const dGap = J3.gap - S1.gap;
const sesuaiFin = hasilFin.every((h) => ["JURNAL", "TIDAK_DIJURNAL", "GAP_PERSEDIAAN_AWAL", "GAP_TANPA_HARGA"].includes(h)) && (hasilFin.includes("JURNAL") ? dJur >= 1 : dJur === 0) && dGap === hasilFin.filter((h) => String(h).startsWith("GAP")).length;
cek(`hasil Finance nyata = prediksi pratinjau per langkah (${hasilFin.join(" + ")}): jurnal baru ${dJur}, celah baru ${dGap}; HPP beku tepat 2 baris baru`, sesuaiFin && J3.hpp - S1.hpp === 2, `${dJur}/${dGap}/${J3.hpp - S1.hpp}`);

// ── G. BAHAN ASAL MATERIAL ISSUE: tetap persetujuan / Return Produksi (data produksi nyata pada salinan restore)
let mi = (await prisma.$queryRawUnsafe(`select s.unit_id::text uid, s.material_id::text mid, u.status::text st, u.created_at dibuat, u.unit_code kode, (select -coalesce(sum(w.qty),0)::float from stock_movements w where w.unit_id = s.unit_id and w.material_id = s.material_id and w.type::text in ('ISSUE','RETURN','WASTE')) bersih
    from stock_movements s join units u on u.id = s.unit_id where s.type::text = 'ISSUE' and s.material_issue_id is not null and u.status::text = 'DELIVERED'
      and not exists (select 1 from stock_movements w where w.unit_id = s.unit_id and w.material_id = s.material_id and w.type::text = 'WASTE') and not exists (select 1 from warehouse_corrections c where c.doc_id = u.id and c.status::text = 'PENDING_APPROVAL')
    group by s.unit_id, s.material_id, u.status, u.created_at, u.unit_code order by u.created_at desc limit 1`))[0];
let sintetis = false;
if (!mi || !(mi.bersih > 1)) {
  // Salinan restore tidak memuat unit terkirim dengan pengeluaran Material Issue: skenario dibangun PADA DB SEMENTARA ini (bahan C pada unit uji; dokumen Material Issue + pergerakan ISSUE bertaut) — bukan di production.
  const matC = await pilihMat([matA.id, matB.id], 5); cek(`bahan C tersedia untuk skenario Material Issue sintetis: ${matC?.kode}`, !!matC);
  if (matC) { const doc = await prisma.materialIssue.create({ data: { issueNumber: "MI-REH-" + Date.now().toString(36).toUpperCase(), sourceType: "MANUAL", status: "ISSUED", unitId: unit.id } }); await prisma.stockMovement.create({ data: { materialId: matC.id, type: "ISSUE", qty: -3, unitId: unit.id, materialIssueId: doc.id, note: "REH: pengeluaran dari dokumen Material Issue (sintetis pada DB rehearsal)" } }); mi = { uid: unit.id, mid: matC.id, st: "DELIVERED", dibuat: unit.dibuat, kode: unit.kode, bersih: 3 }; sintetis = true; }
}
cek(`bahan asal Material Issue tersedia untuk uji (${sintetis ? "dibangun pada DB rehearsal" : "data nyata salinan"}): unit ${mi?.kode}, status ${mi?.st}`, !!mi && mi.bersih > 1); if (mi && mi.bersih > 1) {
  const tM = mi.st === "DELIVERED" ? { tanggalPemakaian: wib(mi.dibuat) } : {}; const bU = { materialId: mi.mid, qtyBaru: Math.round((mi.bersih - 1) * 10000) / 10000, ...tM }; const JM = await jejak(mi.mid, matB.id);
  const pM = await H("POST", PRA(mi.uid), tA, bU); const lM = await H("POST", PASANG(mi.uid), tA, { ...bU, alasan: "REH: uji bahan asal Material Issue", dilihat: pM.body?.sidik }, kunci("mi"));
  const pgM = await H("POST", PRA(mi.uid), tA, { materialId: mi.mid, qtyBaru: 0, keMaterialId: matB.id, qtyKe: 1, ...tM });
  cek(`bahan asal Material Issue (${mi.st}): Edit ubah jumlah = jalur AJUKAN; penerapan langsung 409 UNIT_PERLU_PERSETUJUAN; ganti bahan diblokir (GANTI_BAHAN_DOKUMEN_GUDANG); tidak ada yang tersimpan`, pM.status === 200 && pM.body?.jalur === "AJUKAN" && lM.status === 409 && lM.body?.code === "UNIT_PERLU_PERSETUJUAN" && pgM.body?.boleh === false && (pgM.body?.penghalang ?? []).some((h) => h.kode === "GANTI_BAHAN_DOKUMEN_GUDANG") && sama(await jejak(mi.mid, matB.id), JM), `${pM.body?.jalur}/${lM.body?.code}`);
  if (mi.st === "DELIVERED") {
    const pk = await H("POST", PRAB(mi.uid), tA, { materialId: mi.mid, jenis: "KURANGI", qty: 1, tanggalPemakaian: wib(mi.dibuat) });
    const rk = await H("POST", POSTM(mi.uid), tA, { materialId: mi.mid, qty: -1, alasanPembetulan: "REH: uji pengembalian langsung", tanggalPemakaian: wib(mi.dibuat), saldoDilihat: pk.body?.stok?.saldoDilihat ?? 0, hppSidik: pk.body?.hppOperasional?.sidik ?? "x" }, kunci("rk"));
    cek("jalur pembetulan lama: pengembalian bahan asal Material Issue pada unit TERKIRIM ditolak (penghalang pratinjau + 409 UNIT_ASAL_MATERIAL_ISSUE); tidak melewati persetujuan", pk.body?.boleh === false && (pk.body?.penghalang ?? []).some((h) => h.kode === "UNIT_ASAL_MATERIAL_ISSUE") && rk.status === 409 && rk.body?.code === "UNIT_ASAL_MATERIAL_ISSUE" && sama(await jejak(mi.mid, matB.id), JM), `${rk.status} ${rk.body?.code}`);
  }
}

// ── H. Koreksi Saldo tetap utuh SESUDAH uji tulis + tabel yang tidak boleh berubah
const ks1 = await H("GET", `${KS}/bahan/${matA.id}`, tO); const rh1 = await H("GET", "/api/finance/biaya-bahan/harga-berlaku/ringkasan-daftar", tO); const tetap1 = await hitungTetap(); const bedaTetap = tetap.filter((t) => tetap0[t] !== tetap1[t]);
cek("Koreksi Saldo live tetap utuh sesudah uji tulis: keadaan bahan 200, ringkasan harga daftar 200, tabel koreksi saldo + permintaan penyesuaian stok tidak berubah; Persediaan Awal, penerimaan, PO, tagihan supplier, koreksi valuasi, Material Issue, catatan historis, pemakaian sementara, komponen lama: IDENTIK", ks1.status === 200 && rh1.status === 200 && bedaTetap.length === 0, bedaTetap.join(",") || "identik");
// ── I. kode SMOKE pasca-switch yang sama dijalankan terhadap server rehearsal (restore nyata + kode baru): salah harapan terdeteksi SEBELUM deploy
const tidakSeimbang = await num("select count(*)::int n from (select e.id from fin_journal_entries e join fin_journal_lines l on l.entry_id = e.id group by e.id having sum(l.debit) <> sum(l.credit)) x");
const sp = spawnSync(process.execPath, ["--input-type=module", "-"], { input: SMOKE_SRC, cwd: "/app", encoding: "utf8", timeout: 240000, env: { ...process.env, SMOKE_BASE: BASE, BASE_TIDAK_SEIMBANG: String(tidakSeimbang), BASE_GANDA: "0", ORDER_N: String(await num('select count(*)::int n from "Order"')), JOB_N: String(await num("select count(*)::int n from jobs")) } });
const smokeLine = (String(sp.stdout).match(/^SMOKE_HASIL .*$/m) ?? [""])[0]; const smokeGagal = String(sp.stdout).split("\n").filter((l) => /^\s+FAIL/.test(l)).join(" | ");
cek("SMOKE pasca-switch (kode yang sama dengan fase 8b) lulus terhadap server rehearsal: 0 gagal", sp.status === 0 && /^SMOKE_HASIL fail=0 /.test(smokeLine), smokeLine + " " + smokeGagal + " " + String(sp.stderr).slice(-150));
berhenti(); await prisma.$disconnect();
console.log("PEMERIKSAAN=" + n + " gagal=" + gagal);
process.exit(gagal === 0 ? 0 : 1);
