import { createRequire } from "node:module";
const { PrismaClient } = createRequire(process.cwd() + "/")("@prisma/client");
const prisma = new PrismaClient();
const H = await import("/app/src/services/finance/hargaBerlaku.js");
const { postStockMovement } = await import("/app/src/services/inventoryLedger.js");
const { ROLE_PERMISSIONS } = await import("/app/src/constants/permissions.js");
let gagal = 0; let n = 0;
const cek = (nama, ok, d = "") => { n += 1; if (!ok) gagal += 1; console.log(`${ok ? "OK   " : "GAGAL"} ${nama}${d ? " — " + d : ""}`); };
const num = async (q) => Number((await prisma.$queryRawUnsafe(q))[0].n);
const ditolak = async (f) => { try { await f(); return null; } catch (e) { return e; } };
const ts = Date.now().toString(36); let seq = 0; const kunci = (t) => `reh-hb-${t}-${ts}-${++seq}-aaaa`;
// Tabel yang TIDAK BOLEH berubah oleh fitur ini (valuasi/jurnal Finance, PSA/GR, penerimaan). stock_movements & fin_stock_movement_valuations bertambah HANYA oleh pergerakan uji (perilaku lama postStockMovement) — diperiksa terpisah.
const TETAP = ["fin_journal_entries", "fin_journal_lines", "fin_inventory_openings", "fin_inventory_opening_lines", "goods_receipts", "goods_receipt_lines", "fin_purchase_orders", "fin_supplier_bills", "fin_stock_movement_valuation_corrections", "unit_usage_notes", "material_issues"];
const fp = async (tabel) => { const o = {}; for (const t of tabel) o[t] = (await prisma.$queryRawUnsafe(`select count(*)::int n, coalesce(md5(string_agg(x::text, '|' order by x::text)),'') h from "${t}" x`))[0]; return o; };
const beda = (a, b) => Object.keys(a).filter((t) => a[t].n !== b[t].n || a[t].h !== b[t].h);

// A. struktur baru terpasang dan KOSONG; izin eksplisit di kode baru
cek("3 tabel rilis kosong setelah migrasi (tanpa backfill)", (await num("select (select count(*) from material_harga_berlaku) + (select count(*) from stock_movement_biaya_operasional) + (select count(*) from biaya_operasional_penerapan) as n")) === 0);
const ada = (r, p) => (ROLE_PERMISSIONS[r] ?? []).includes(p);
cek("izin eksplisit: FINANCE dan OWNER memegang finance:harga_berlaku:edit + :approve", ada("FINANCE", "finance:harga_berlaku:edit") && ada("FINANCE", "finance:harga_berlaku:approve") && ada("OWNER", "finance:harga_berlaku:edit") && ada("OWNER", "finance:harga_berlaku:approve"));
cek("izin eksplisit: ADMIN murni TIDAK memegang izin ubah/setujui harga berlaku (menunggu keputusan Owner)", !ada("ADMIN", "finance:harga_berlaku:edit") && !ada("ADMIN", "finance:harga_berlaku:approve") && !ada("WAREHOUSE", "finance:harga_berlaku:edit") && !ada("SALES", "finance:harga_berlaku:edit"));

// B. pelaku dan bahan uji (data restore nyata)
const finUsers = await prisma.user.findMany({ where: { OR: [{ role: { in: ["FINANCE", "OWNER"] } }, { roles: { some: { role: { in: ["FINANCE", "OWNER"] } } } }] }, select: { id: true, name: true }, orderBy: { id: "asc" }, take: 2 });
if (finUsers.length < 2) { cek("dua pengguna Finance/Owner tersedia pada salinan", false); await prisma.$disconnect(); process.exit(1); }
const [pengaju, penyetuju] = finUsers;
const mat = (await prisma.material.findFirst({ where: { code: "SPANBON-75GRAM" }, select: { id: true, code: true, unit: true } })) ?? (await prisma.material.findFirst({ where: { active: true }, select: { id: true, code: true, unit: true } }));
const unit = await prisma.unit.findFirst({ select: { id: true, unitCode: true } });
cek(`bahan uji ${mat?.code} dan unit uji ${unit?.unitCode} tersedia`, !!mat && !!unit);
const saldoMat = await num(`select coalesce(sum(qty),0)::float as n from stock_movements where material_id = '${mat.id}'`);
const fp0 = await fp(TETAP); const nilaiFin0 = await prisma.$queryRawUnsafe("select id::text, status, value::text from fin_stock_movement_valuations order by id");
const nSm0 = await num("select count(*) as n from stock_movements"); const nFv0 = await num("select count(*) as n from fin_stock_movement_valuations");
const gerak = (type, qty, extra = {}) => prisma.$transaction((tx) => postStockMovement(tx, { materialId: mat.id, type, qty, unitId: unit.id, reason: "rehearsal", note: `rehearsal ${type}`, createdById: pengaju.id, ...extra }));

// C. membaca = baca-saja
const ring0 = await H.ringkasanBahan(prisma, mat.id); const riw0 = await H.riwayatHarga(prisma, mat.id);
cek("ringkasan + riwayat terbaca (kosong) tanpa menulis; teks izin eksplisit tersedia", ring0.hargaBerlaku === null && riw0.length === 0 && /Finance dan Owner/.test(ring0.izinTeks.ubah) && /keputusan Owner/.test(ring0.izinTeks.admin) && beda(fp0, await fp(TETAP)).length === 0);

// D. tulis pada SALINAN: harga berlaku TANPA tanggal mundur
const dasar = { materialId: mat.id, hargaBaru: "100", satuan: mat.unit, alasan: "rehearsal harga awal" };
const eMundur = await ditolak(() => H.pratinjauUbahHarga(prisma, { ...dasar, berlakuMulai: "2026-10-01T00:00:00Z" }));
cek("perubahan harga biasa dengan tanggal mundur DITOLAK (WAKTU_MUNDUR, 422)", eMundur?.code === "WAKTU_MUNDUR" && eMundur?.statusCode === 422, eMundur?.code);
const eSatuan = await ditolak(() => H.pratinjauUbahHarga(prisma, { ...dasar, satuan: "PAK-UJI" })); cek("satuan selain satuan stok ditolak (SATUAN_BEDA)", eSatuan?.code === "SATUAN_BEDA", eSatuan?.code);
const p1 = await H.pratinjauUbahHarga(prisma, dasar); const k1 = kunci("simpan");
const hasil = await Promise.allSettled([1, 2, 3].map(() => H.simpanHarga(prisma, { ...dasar, hashPratinjau: p1.hash }, { aktor: pengaju, kunci: k1 })));
cek("simpan harga (serentak ×3, kunci sama): tepat SATU baris; berlaku mulai = waktu simpan", hasil.every((h) => h.status === "fulfilled") && await num("select count(*) as n from material_harga_berlaku") === 1 && await num("select count(*) as n from material_harga_berlaku where effective_from = created_at") === 1);
const baris1 = await prisma.materialHargaBerlaku.findFirst({ where: { materialId: mat.id } });
const pakai = await gerak("ISSUE", -1); const opP = await prisma.stockMovementBiayaOperasional.findMany({ where: { movementId: pakai.id } });
cek("pemakaian baru dibekukan pada harga berlaku saat itu (Rp100, dasar WAKTU_PEMAKAIAN)", opP.length === 1 && Number(opP[0].unitCost) === 100 && opP[0].basisHarga === "WAKTU_PEMAKAIAN" && opP[0].sumber === "BEKU_SAAT_POSTING");

// E. retur memakai harga ISSUE asal (harga berubah di antara ISSUE dan retur); waste memakai harga saat waste
const p2 = await H.pratinjauUbahHarga(prisma, { ...dasar, hargaBaru: "150", alasan: "rehearsal kenaikan harga" }); await H.simpanHarga(prisma, { ...dasar, hargaBaru: "150", alasan: "rehearsal kenaikan harga", hashPratinjau: p2.hash }, { aktor: pengaju, kunci: kunci("naik") });
const retur = await gerak("RETURN", 1); const opR = (await prisma.stockMovementBiayaOperasional.findMany({ where: { movementId: retur.id } }))[0];
cek("RETUR memakai harga operasional ISSUE ASAL Rp100 (bukan Rp150 yang berlaku saat retur)", Number(opR.unitCost) === 100 && opR.basisHarga === "HARGA_ISSUE_ASAL" && Number(opR.value) === -100, `${opR?.unitCost} ${opR?.basisHarga}`);
const wst = await gerak("WASTE", -1, { reason: "rehearsal waste" }); const opW = (await prisma.stockMovementBiayaOperasional.findMany({ where: { movementId: wst.id } }))[0];
cek("WASTE memakai harga saat waste dicatat Rp150; sumber WAKTU_WASTE", Number(opW.unitCost) === 150 && opW.basisHarga === "WAKTU_WASTE");
const hpp = await H.hppOperasionalUnit(prisma, unit.id); cek("HPP operasional unit menampilkan dasar harga + pemisahan dari nilai Finance", hpp.baris.some((b) => /ISSUE asal/.test(b.basisTeks ?? "")) && /BUKAN nilai persediaan\/jurnal Finance/.test(hpp.peringatan));

// F. koreksi = tindakan khusus berdampak (nilai beku TIDAK ditimpa); penerapan dua orang
const kor = { ...dasar, hargaBaru: "120", berlakuMulai: baris1.effectiveFrom.toISOString(), alasan: "rehearsal koreksi salah input historis", koreksiId: baris1.id };
const eAlasan = await ditolak(() => H.pratinjauUbahHarga(prisma, { ...kor, alasan: "pendek" })); cek("koreksi dengan alasan < 10 karakter ditolak", eAlasan?.code === "ALASAN_WAJIB", eAlasan?.code);
const pk = await H.pratinjauUbahHarga(prisma, kor);
cek("pratinjau koreksi menampilkan SELURUH pemakaian terdampak (ISSUE + retur yang mengikuti)", pk.dampakKoreksi.jumlah >= 2 && pk.dampakKoreksi.dibekukanDenganHargaLama >= 2 && pk.dampakKoreksi.baris.some((x) => x.tipe === "RETURN" && x.ikutIssueAsal));
const eKonf = await ditolak(() => H.simpanHarga(prisma, { ...kor, hashPratinjau: pk.hash }, { aktor: pengaju, kunci: kunci("kor") })); cek("koreksi tanpa konfirmasi dampak ditolak", eKonf?.code === "KONFIRMASI_DAMPAK_WAJIB", eKonf?.code);
const koreksi = await H.simpanHarga(prisma, { ...kor, hashPratinjau: pk.hash, konfirmasiDampak: true }, { aktor: pengaju, kunci: kunci("kor2") });
const opPakaiSetelah = await prisma.stockMovementBiayaOperasional.findMany({ where: { movementId: pakai.id } });
cek("koreksi tersimpan (riwayat bertambah, baris lama tetap); NILAI BEKU LAMA TIDAK BERUBAH", koreksi.jenis === "KOREKSI" && await num("select count(*) as n from material_harga_berlaku") === 3 && opPakaiSetelah.length === 1 && Number(opPakaiSetelah[0].unitCost) === 100);
const pp = await H.pratinjauPenerapan(prisma, { materialId: mat.id, groups: ["SELARAS_ULANG"] });
cek("pratinjau penerapan: ISSUE yang dibekukan dengan harga lama muncul sebagai SELARAS_ULANG (retur menunggu ISSUE asal)", pp.penerapan.jumlah >= 1 && pp.penerapan.baris.every((x) => x.tipe !== "RETURN"));
const aj = await H.ajukanPenerapan(prisma, { materialId: mat.id, groups: ["SELARAS_ULANG"], hashPratinjau: pp.hash, alasan: "rehearsal penerapan koreksi" }, { aktor: pengaju, kunci: kunci("aj") });
const eSendiri = await ditolak(() => H.setujuiPenerapan(prisma, { id: aj.id, hashPratinjau: pp.hash, aktor: pengaju })); cek("pengaju TIDAK boleh menyetujui sendiri (PEMOHON_SAMA)", eSendiri?.code === "PEMOHON_SAMA", eSendiri?.code);
const setuju = await Promise.allSettled([1, 2, 3].map(() => H.setujuiPenerapan(prisma, { id: aj.id, hashPratinjau: pp.hash, aktor: penyetuju })));
cek("penerapan disetujui orang lain (serentak ×3): satu penerapan; baris beku asli tetap + baris penerapan baru", setuju.every((x) => x.status === "fulfilled") && await num(`select count(*) as n from stock_movement_biaya_operasional where movement_id = '${pakai.id}'`) === 2 && await num("select count(*) as n from stock_movement_biaya_operasional where sumber = 'PENERAPAN_DISETUJUI'") === pp.penerapan.jumlah);

// G. append-only di tingkat database
const e1 = await ditolak(() => prisma.$executeRawUnsafe(`update material_harga_berlaku set unit_price = 1 where id = '${baris1.id}'`)); const e2 = await ditolak(() => prisma.$executeRawUnsafe(`delete from stock_movement_biaya_operasional where movement_id = '${pakai.id}'`));
const e3 = await ditolak(() => prisma.$executeRawUnsafe(`insert into material_harga_berlaku (id, material_id, jenis, unit_price, satuan, effective_from, created_at, reason, idempotency_key) values (gen_random_uuid(), '${mat.id}', 'HARGA', 5, '${mat.unit}', now() - interval '1 day', now(), 'mundur lewat SQL', 'reh-mundur-${ts}')`));
cek("trigger DB: baris harga/biaya tidak bisa diubah/dihapus; CHECK DB menolak harga biasa berlaku mundur", !!e1 && !!e2 && !!e3);

// H. invarian: Finance/PSA/GR/jurnal tidak berubah; hanya pergerakan uji (perilaku lama) yang bertambah
const fp1 = await fp(TETAP); cek("jurnal, baris jurnal, PSA, penerimaan, tagihan, koreksi valuasi Finance, catatan pemakaian, Material Issue: IDENTIK sebelum vs sesudah", beda(fp0, fp1).length === 0, beda(fp0, fp1).join(","));
const nilaiFin1 = await prisma.$queryRawUnsafe("select id::text, status, value::text from fin_stock_movement_valuations order by id");
const lama = new Map(nilaiFin0.map((x) => [x.id, x])); const berubah = nilaiFin1.filter((x) => lama.has(x.id) && (lama.get(x.id).status !== x.status || lama.get(x.id).value !== x.value));
cek("valuasi Finance yang sudah ada TIDAK berubah (hanya +3 baris dari 3 pergerakan uji)", berubah.length === 0 && (await num("select count(*) as n from fin_stock_movement_valuations")) === nFv0 + 3);
cek("stok: hanya 3 pergerakan uji (ISSUE, RETURN, WASTE) yang bertambah; saldo bahan = saldo awal − 1 + 1 − 1", (await num("select count(*) as n from stock_movements")) === nSm0 + 3 && Math.abs((await num(`select coalesce(sum(qty),0)::float as n from stock_movements where material_id = '${mat.id}'`)) - (saldoMat - 1)) < 1e-6);
await prisma.$disconnect();
console.log("PEMERIKSAAN=" + n + " gagal=" + gagal);
process.exit(gagal === 0 ? 0 : 1);
