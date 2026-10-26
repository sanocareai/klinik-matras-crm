import { createRequire } from "node:module";
import { spawn } from "node:child_process";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const { ROLE_PERMISSIONS, PERMISSIONS: P } = await import("/app/src/constants/permissions.js");
let gagal = 0; let n = 0;
const cek = (nama, ok, d = "") => { n += 1; if (!ok) gagal += 1; console.log(`${ok ? "OK   " : "GAGAL"} ${nama}${d ? " — " + String(d).slice(0, 220) : ""}`); };
const num = async (q, ...a) => Number((await prisma.$queryRawUnsafe(q, ...a))[0].n);
const nm = process.env.REH_DB_NAME ?? (await prisma.$queryRawUnsafe("select current_database() as n"))[0].n;
if (!/^rehearsal_/.test(nm)) { cek("uji pembetulan hanya pada DB rehearsal", false, nm); await prisma.$disconnect(); process.exit(1); }
// REHEARSAL pembetulan bahan unit TERKIRIM: kode BARU dijalankan sebagai SERVER sungguhan (index.js, port 4101, tanpa job latar, variabel eksternal dinetralkan) terhadap SALINAN RESTORE production. Semua tulisan hanya di DB sementara ini.
const { neutralizeExternalEnv } = await import("/app/src/lib/stagingGuard.js"); neutralizeExternalEnv(process.env);
const PORT = 4101; const BASE = `http://127.0.0.1:${PORT}`;
const child = spawn(process.execPath, ["src/index.js"], { cwd: "/app", env: { ...process.env, PORT: String(PORT), DISABLE_BACKGROUND_JOBS: "1" }, stdio: ["ignore", "pipe", "pipe"] });
let log = ""; child.stdout.on("data", (d) => { log += d; }); child.stderr.on("data", (d) => { log += d; });
const berhenti = () => { try { child.kill("SIGTERM"); } catch { /* sudah mati */ } };
let sehat = false; for (let i = 0; i < 60 && !sehat; i++) { try { sehat = (await fetch(BASE + "/api/health")).ok; } catch { await new Promise((r) => setTimeout(r, 1000)); } }
cek("server kode baru hidup pada salinan restore (/api/health)", sehat, sehat ? "" : log.slice(-300)); if (!sehat) { berhenti(); await prisma.$disconnect(); process.exit(1); }
const rolesDari = async (u) => new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);
const bisa = (rs, izin) => [...rs].some((r) => (ROLE_PERMISSIONS[r] ?? []).includes(izin));
const token = async (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: [...(await rolesDari(u))] }, process.env.JWT_SECRET, { expiresIn: "20m" });
const semua = await prisma.user.findMany({ where: { active: true }, orderBy: { id: "asc" } }); const info = []; for (const u of semua) info.push({ u, rs: await rolesDari(u) });
const adm = info.find((x) => bisa(x.rs, P.UNIT_MATERIAL_WRITE) && bisa(x.rs, P.INVENTORY_WRITE) && !bisa(x.rs, P.INVENTORY_ADJUSTMENT_APPROVE))?.u; const own = info.find((x) => x.rs.has("OWNER"))?.u; const sls = info.find((x) => !bisa(x.rs, P.UNIT_MATERIAL_WRITE) && !bisa(x.rs, P.INVENTORY_WRITE))?.u;
cek("akun uji tersedia pada salinan: pemohon (izin tulis, bukan penyetuju), Owner penyetuju, akun tanpa izin", !!adm && !!own && !!sls, `${!!adm}/${!!own}/${!!sls}`); if (!adm || !own || !sls) { berhenti(); process.exit(1); }
const tA = await token(adm); const tO = await token(own); const tS = await token(sls);
const H = async (metode, path, tok, body = null, kunci = null) => { const r = await fetch(BASE + path, { method: metode, headers: { "Content-Type": "application/json", ...(tok ? { Authorization: "Bearer " + tok } : {}), ...(kunci ? { "Idempotency-Key": kunci } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); let j = null; try { j = await r.json(); } catch { /* bukan JSON */ } return { status: r.status, body: j }; };
let seq = 0; const kunci = (p) => `reh-pb-${p}-${Date.now().toString(36)}-${++seq}-xxxxxxxx`;
const bulat4 = (v) => Math.round(Number(v) * 10000) / 10000;
const wib = (d) => new Date(new Date(d).getTime() + 7 * 3600_000).toISOString().slice(0, 10);
const saldo = async (m) => Number((await prisma.$queryRaw`SELECT COALESCE(SUM(qty),0)::float AS s FROM stock_movements WHERE material_id = ${m}::uuid`)[0].s);
// data uji dari salinan restore
const unit = (await prisma.$queryRawUnsafe(`select u.id::text id, u.unit_code kode, u.order_id oid, u.created_at dibuat from units u where u.status::text = 'DELIVERED' and not exists (select 1 from stock_movements s where s.unit_id = u.id) and not exists (select 1 from unit_usage_notes x where x.unit_id = u.id) and not exists (select 1 from unit_provisional_usages y where y.unit_id = u.id) and not exists (select 1 from unit_component_reuse_entries z where z.unit_id = u.id) order by u.created_at desc limit 1`))[0];
const mat = (await prisma.$queryRawUnsafe(`select m.id::text id, m.code kode, m.unit satuan from materials m where m.active and coalesce(m.kind::text,'') <> 'PERLENGKAPAN_STOK' and (select coalesce(sum(qty),0) from stock_movements s where s.material_id = m.id) >= 20 and not exists (select 1 from stock_movements s where s.material_id = m.id and s.unit_id is null and s.type::text in ('ISSUE','WASTE') and s.created_at > now() - interval '60 days') order by m.code limit 1`))[0];
const kosong = (await prisma.$queryRawUnsafe(`select m.id::text id, m.code kode from materials m where m.active and coalesce(m.kind::text,'') <> 'PERLENGKAPAN_STOK' and not exists (select 1 from stock_movements s where s.material_id = m.id) order by m.code limit 1`))[0];
const batal = (await prisma.$queryRawUnsafe(`select id::text id from units where status::text = 'CANCELLED' limit 1`))[0]; const aktif = (await prisma.$queryRawUnsafe(`select id::text id from units where status::text = 'IN_PRODUCTION' limit 1`))[0];
cek(`data uji tersedia: unit terkirim bersih ${unit?.kode}, bahan ${mat?.kode} (saldo ≥ 20), bahan tanpa catatan stok ${kosong?.kode}, unit dibatalkan, unit aktif`, !!unit && !!mat && !!kosong && !!batal && !!aktif); if (!unit || !mat || !kosong || !batal || !aktif) { berhenti(); process.exit(1); }
const TGL = wib(unit.dibuat); const hariIni = wib(new Date());
const PRA = (u) => `/api/production/units/${u}/pembetulan-bahan/pratinjau`; const POSTM = (u) => `/api/units/${u}/materials`;
const snapUnit = async () => ({ mov: await num("select count(*)::int n from stock_movements where unit_id = $1::uuid", unit.id), sem: await num("select count(*)::int n from unit_provisional_usages where unit_id = $1::uuid", unit.id), komp: await num("select count(*)::int n from unit_component_reuse_entries where unit_id = $1::uuid", unit.id), kor: await num("select count(*)::int n from warehouse_corrections where doc_id = $1::uuid", unit.id) });
const tetap = ["fin_inventory_openings", "goods_receipts", "fin_purchase_orders", "fin_supplier_bills", "material_harga_berlaku", "fin_stock_movement_valuation_corrections", "unit_usage_notes"];
const hitungTetap = async () => { const o = {}; for (const t of tetap) o[t] = await num(`select count(*)::int n from "${t}"`); return o; }; const tetap0 = await hitungTetap();

// A. izin dan pratinjau baca-saja
cek("tanpa token = 401; akun tanpa izin = 403 (pratinjau dan pengeluaran)", (await H("POST", PRA(unit.id), null, { jenis: "TAMBAH" })).status === 401 && (await H("POST", PRA(unit.id), tS, { materialId: mat.id, jenis: "TAMBAH", qty: 1, tanggalPemakaian: TGL })).status === 403 && (await H("POST", POSTM(unit.id), tS, { materialId: mat.id, qty: 1 })).status === 403);
const s0 = await snapUnit(); const saldo0 = await saldo(mat.id);
const p = await H("POST", PRA(unit.id), tA, { materialId: mat.id, jenis: "TAMBAH", qty: 1, tanggalPemakaian: TGL });
cek("pratinjau 200: tegas 'PENGELUARAN STOK BARU', waktu terpisah (dasar harga/jurnal = waktu pencatatan), stok sebelum/sesudah = ledger, baca-saja", p.status === 200 && p.body.tindakan?.jenis === "PENGELUARAN_STOK_BARU" && p.body.waktu?.pemakaianDilaporkan === TGL && p.body.waktu?.dasarHargaDanJurnal === "WAKTU_PENCATATAN" && Math.abs(p.body.stok?.saldoSebelum - saldo0) < 1e-6 && Math.abs(p.body.stok?.saldoSesudah - bulat4(saldo0 - 1)) < 1e-6 && JSON.stringify(await snapUnit()) === JSON.stringify(s0), JSON.stringify(p.body)?.slice(0, 120));
const tgl0 = await H("POST", PRA(unit.id), tA, { materialId: mat.id, jenis: "TAMBAH", qty: 1 }); cek("pratinjau tanpa tanggal dilaporkan ditolak (UNIT_TANGGAL_PEMAKAIAN_WAJIB)", tgl0.status === 400 && tgl0.body.code === "UNIT_TANGGAL_PEMAKAIAN_WAJIB");
const batalP = await H("POST", PRA(batal.id), tA, { materialId: mat.id, jenis: "TAMBAH", qty: 1, tanggalPemakaian: hariIni }); const aktifP = await H("POST", PRA(aktif.id), tA, { materialId: mat.id, jenis: "TAMBAH", qty: 1, tanggalPemakaian: hariIni });
cek("unit DIBATALKAN dan unit AKTIF ditolak pratinjau pembetulan (409) — perluasan hanya unit terkirim", batalP.status === 409 && batalP.body.code === "UNIT_DIBATALKAN" && aktifP.status === 409 && aktifP.body.code === "UNIT_BELUM_TERKIRIM");
const stokK = await H("POST", PRA(unit.id), tA, { materialId: kosong.id, jenis: "TAMBAH", qty: 1, tanggalPemakaian: TGL }); cek("bahan tanpa catatan stok: penghalang jujur STOK_BELUM_DIKETAHUI (saldo 'belum diketahui', bukan 0)", stokK.body.boleh === false && stokK.body.penghalang?.[0]?.kode === "STOK_BELUM_DIKETAHUI" && stokK.body.stok?.saldoSebelum === null);

// B. aturan server pada POST (ditolak = tidak ada tulisan)
const dasar = { materialId: mat.id, qty: 1, alasanPembetulan: "Rehearsal: bahan terlewat dicatat", tanggalPemakaian: TGL, saldoDilihat: saldo0 };
const r1 = await H("POST", POSTM(unit.id), tA, { ...dasar, alasanPembetulan: undefined }); const r2 = await H("POST", POSTM(unit.id), tA, { ...dasar, tanggalPemakaian: undefined }); const r3 = await H("POST", POSTM(unit.id), tA, { ...dasar, saldoDilihat: undefined }); const r4 = await H("POST", POSTM(unit.id), tA, { ...dasar, tanggalPemakaian: "2099-01-01" });
cek("POST tanpa alasan / tanpa tanggal dilaporkan / tanpa saldo yang dilihat / tanggal masa depan = 400 dan TIDAK ada yang tersimpan", [r1, r2, r3, r4].every((r) => r.status === 400) && r1.body.code === "UNIT_ALASAN_PEMBETULAN_WAJIB" && r2.body.code === "UNIT_TANGGAL_PEMAKAIAN_WAJIB" && r3.body.code === "UNIT_PRATINJAU_WAJIB" && JSON.stringify(await snapUnit()) === JSON.stringify(s0));

// C. pencatatan ganda: kandidat ditampilkan, pengeluaran baru wajib konfirmasi, tidak ditautkan otomatis
const kand = (await prisma.$queryRawUnsafe(`insert into stock_movements (id, material_id, type, qty, note, created_at) values (gen_random_uuid(), $1::uuid, 'ISSUE', -1, 'REH: pengeluaran lama tanpa unit', now() - interval '1 day') returning id::text id`, mat.id))[0];
const saldo1 = await saldo(mat.id); const pg = await H("POST", PRA(unit.id), tA, { materialId: mat.id, jenis: "TAMBAH", qty: 1, tanggalPemakaian: hariIni });
cek("pratinjau menampilkan kandidat 'pengeluaran tanpa unit' (jumlah sama) dan meminta pernyataan pemeriksaan; tidak menyamakan otomatis", pg.body.sudahTercatat?.perluKonfirmasi === true && pg.body.sudahTercatat.kemungkinan.some((x) => x.id === kand.id && x.alasan.includes("Jumlah sama persis")) && /TIDAK menyamakan/.test(pg.body.sudahTercatat.catatan));
const d0 = { ...dasar, tanggalPemakaian: hariIni, saldoDilihat: saldo1 };
const tolak = await H("POST", POSTM(unit.id), tA, d0, kunci("tolak")); cek("pengeluaran baru TANPA konfirmasi saat ada kandidat = 409 UNIT_KEMUNGKINAN_GANDA, tidak ada yang tersimpan", tolak.status === 409 && tolak.body.code === "UNIT_KEMUNGKINAN_GANDA" && JSON.stringify(await snapUnit()) === JSON.stringify(s0));
const jur0 = await num("select count(*)::int n from fin_journal_entries"); const gap0 = await num("select count(*)::int n from fin_posting_gaps");
const kk = kunci("ok"); const ok = await H("POST", POSTM(unit.id), tA, { ...d0, konfirmasiBukanGanda: true }, kk); const ok2 = await H("POST", POSTM(unit.id), tA, { ...d0, konfirmasiBukanGanda: true }, kk);
const mv = ok.body?.id ? (await prisma.stockMovement.findUnique({ where: { id: ok.body.id } })) : null;
cek("dengan konfirmasi: tercatat SATU pergerakan ISSUE bertaut unit (klik ganda = replay); catatan memuat alasan + tanggal dilaporkan; waktu pencatatan = hari ini", ok.status === 201 && [200, 409].includes(ok2.status) && (await snapUnit()).mov === s0.mov + 1 && mv?.type === "ISSUE" && Number(mv.qty) === -1 && mv.note.startsWith(`Pembetulan unit terkirim (${unit.kode}) [dilaporkan ${hariIni}]: Rehearsal`) && wib(mv.createdAt) === hariIni, `${ok.status}/${ok2.status}`);
cek("kandidat lama TIDAK ditautkan otomatis (unit_id tetap kosong)", (await prisma.$queryRawUnsafe(`select unit_id from stock_movements where id = $1::uuid`, kand.id))[0].unit_id === null);
cek("stok ledger sesudah = prediksi pratinjau", Math.abs((await saldo(mat.id)) - Math.round((saldo1 - 1) * 10000) / 10000) < 1e-6);
const hasil = pg.body.finance?.hasil; const jurBaru = (await num("select count(*)::int n from fin_journal_entries")) - jur0; const gapBaru = await num("select count(*)::int n from fin_posting_gaps where source_id = $1", mv?.id ?? "x");
const sesuai = hasil === "JURNAL" ? jurBaru >= 1 : hasil === "TIDAK_DIJURNAL" ? jurBaru === 0 && gapBaru === 0 : jurBaru === 0 && gapBaru === 1;
cek(`hasil Finance nyata = prediksi pratinjau (${hasil}): jurnal baru ${jurBaru}, celah ${gapBaru}`, sesuai);
const op = (await prisma.$queryRawUnsafe(`select status, unit_cost::float uc from stock_movement_biaya_operasional where movement_id = $1::uuid`, mv?.id ?? "00000000-0000-0000-0000-000000000000"))[0];
cek(`HPP operasional dibekukan sesuai prediksi (${pg.body.hppOperasional?.dibekukan ? "ada harga berlaku" : "tanpa harga → TANPA_HARGA, bukan Rp0"})`, pg.body.hppOperasional?.dibekukan ? op?.status === "DINILAI" && Number(op.uc) === pg.body.hppOperasional.harga : op?.status === "TANPA_HARGA");

// D. saldo berubah setelah pratinjau
const sd = await saldo(mat.id); const pra2 = await H("POST", PRA(unit.id), tA, { materialId: mat.id, jenis: "TAMBAH", qty: 1, tanggalPemakaian: hariIni });
await prisma.$executeRawUnsafe(`insert into stock_movements (id, material_id, type, qty, note) values (gen_random_uuid(), $1::uuid, 'ISSUE', -2, 'REH: pengeluaran orang lain setelah pratinjau')`, mat.id);
const sBefore = await snapUnit(); const gser = await H("POST", POSTM(unit.id), tA, { ...dasar, tanggalPemakaian: hariIni, saldoDilihat: pra2.body.stok.saldoDilihat, konfirmasiBukanGanda: true }, kunci("geser"));
cek("saldo bergeser setelah pratinjau → 409 UNIT_SALDO_BERGESER, tidak ada yang tersimpan", gser.status === 409 && gser.body.code === "UNIT_SALDO_BERGESER" && JSON.stringify(await snapUnit()) === JSON.stringify(sBefore) && Math.abs(gser.body.detail.saldoSekarang - (sd - 2)) < 1e-6);

// E. pengembalian (baris asli utuh) dan koreksi berpersetujuan
const sdK = await saldo(mat.id); const ret = await H("POST", POSTM(unit.id), tA, { materialId: mat.id, qty: -1, alasanPembetulan: "Rehearsal: kelebihan catat", tanggalPemakaian: hariIni, saldoDilihat: sdK }, kunci("ret"));
const barisUnit = await prisma.$queryRawUnsafe(`select type::text, qty::float from stock_movements where unit_id = $1::uuid order by created_at`, unit.id);
cek("pengembalian = RETURN BARU bertaut unit; ISSUE asli utuh; stok naik 1", ret.status === 201 && barisUnit.length === 2 && barisUnit[0].type === "ISSUE" && barisUnit[0].qty === -1 && barisUnit[1].type === "RETURN" && Math.abs((await saldo(mat.id)) - (sdK + 1)) < 1e-6);
const i2 = await H("POST", POSTM(unit.id), tA, { materialId: mat.id, qty: 3, alasanPembetulan: "Rehearsal: tambah 3 untuk uji koreksi", tanggalPemakaian: hariIni, saldoDilihat: await saldo(mat.id), konfirmasiBukanGanda: true }, kunci("i2"));
const aj = await H("POST", `/api/production/units/${unit.id}/koreksi-pemakaian`, tA, { materialId: mat.id, qtyBaru: 1, alasan: "Rehearsal: pemakaian sebenarnya 1" }, kunci("kor")); const sendiri = await H("POST", `/api/production/koreksi-pemakaian/${aj.body?.id}/setujui`, tA, {}); const sA = await saldo(mat.id);
const stj = await H("POST", `/api/production/koreksi-pemakaian/${aj.body?.id}/setujui`, tO, {});
cek("koreksi berpersetujuan pada unit terkirim: diajukan (stok belum berubah), pemohon tidak bisa menyetujui sendiri (403), Owner menyetujui → POSTED dan stok berubah", i2.status === 201 && aj.status === 201 && sendiri.status === 403 && stj.status === 200 && (await saldo(mat.id)) !== sA, `${i2.status}/${aj.status}/${sendiri.status}/${stj.status}`);

// F. catatan TANPA stok: pemakaian sementara dan komponen lama
const sPre = await snapUnit(); const jurPre = await num("select count(*)::int n from fin_journal_entries"); const stokPre = await num("select count(*)::int n from stock_movements");
const sem0 = await H("POST", `/api/production/units/${unit.id}/provisional-usages`, tA, { name: "Busa sisa rehearsal XQZ", qty: 2, uom: "KG", originNote: "sisa meja" }, kunci("sem0")); const sem1 = await H("POST", `/api/production/units/${unit.id}/provisional-usages`, tA, { name: "Busa sisa rehearsal XQZ", qty: 2, uom: "KG", originNote: "sisa meja", alasanPembetulan: "Rehearsal: catatan terlewat", tanggalPemakaian: TGL }, kunci("sem1"));
const komp0 = await H("POST", `/api/production/units/${unit.id}/komponen-lama`, tA, { name: "Pegas rehearsal", qty: 1, uom: "PCS", condition: "bagus", outcome: "RETURNED_TO_CUSTOMER" }, kunci("komp0abc")); const komp1 = await H("POST", `/api/production/units/${unit.id}/komponen-lama`, tA, { name: "Pegas rehearsal", qty: 1, uom: "PCS", condition: "bagus", outcome: "RETURNED_TO_CUSTOMER", alasanPembetulan: "Rehearsal: komponen terlewat", tanggalPemakaian: TGL }, kunci("komp1abc"));
const semRow = (await prisma.$queryRawUnsafe(`select used_at "u", note from unit_provisional_usages where unit_id = $1::uuid`, unit.id))[0];
cek("catatan sementara + komponen lama pada unit terkirim: TANPA alasan/tanggal ditolak (409/400); lengkap tersimpan dengan tanggal dilaporkan; stok & jurnal TIDAK berubah", sem0.status === 409 && komp0.status === 409 && sem1.status === 201 && komp1.status === 201 && wib(semRow.u) === TGL && semRow.note.includes(`[dilaporkan ${TGL}]`) && (await num("select count(*)::int n from stock_movements")) === stokPre && (await num("select count(*)::int n from fin_journal_entries")) === jurPre && (await snapUnit()).sem === sPre.sem + 1 && (await snapUnit()).komp === sPre.komp + 1, `${sem0.status}/${komp0.status}/${sem1.status}/${komp1.status}`);
const bs = await H("POST", `/api/production/units/${batal.id}/provisional-usages`, tA, { name: "Busa sisa batal XQZ", qty: 1, uom: "KG", alasanPembetulan: "uji unit dibatalkan", tanggalPemakaian: hariIni }, kunci("bs")); const bk = await H("POST", `/api/production/units/${batal.id}/komponen-lama`, tA, { name: "Pegas batal", qty: 1, uom: "PCS", condition: "bagus", outcome: "REUSED", workPart: "xx", alasanPembetulan: "uji unit dibatalkan", tanggalPemakaian: hariIni }, kunci("bk1abc"));
cek("unit DIBATALKAN tetap menolak pemakaian sementara dan komponen lama (409)", bs.status === 409 && bk.status === 409, `${bs.status} ${bs.body?.code} ${bs.body?.error} | ${bk.status} ${bk.body?.code} ${bk.body?.error}`);
const ad = await H("GET", `/api/production/units/${unit.id}/adopsi`, tA); const baris = ad.body?.pemakaianAktual?.baris ?? [];
cek("data order: riwayat pemakaian membawa tanggal dilaporkan terpisah dari waktu pencatatan", ad.status === 200 && baris.some((b) => b.dilaporkan === hariIni && wib(b.tanggal) === hariIni) && baris.every((b) => Object.hasOwn(b, "dilaporkan")));
const tetap1 = await hitungTetap(); const bedaTetap = tetap.filter((t) => tetap0[t] !== tetap1[t]);
cek("persediaan awal, penerimaan, PO, tagihan supplier, Harga Berlaku, koreksi valuasi, catatan historis: TIDAK berubah oleh pembetulan", bedaTetap.length === 0, bedaTetap.join(",") || "identik");
berhenti(); await prisma.$disconnect();
console.log("PEMERIKSAAN=" + n + " gagal=" + gagal);
process.exit(gagal === 0 ? 0 : 1);
