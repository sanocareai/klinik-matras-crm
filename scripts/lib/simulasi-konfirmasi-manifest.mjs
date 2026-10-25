// SIMULASI TULIS pada DB REHEARSAL (salinan restore backup nyata; DIHAPUS sesudahnya) — BUKAN production. Dijalankan skrip rilis SETELAH sidik jari baca-saja lulus.
// Membuktikan dengan data nyata alur KONFIRMASI MANIFEST: (1) Finance tidak dapat memulai; (2) replay insiden — pilihan berbeda dari yang dikonfirmasi ditolak sebelum batch/movement; (3) saldo bergeser setelah ditinjau ditolak;
// (4) Owner dengan konfirmasi benar: klik ganda ×3 = satu batch, selesai tanpa gagal/duplikat, ulang dengan dampak berbeda ditolak; (5) jalur sinkron ditolak sebelum movement; (6) jurnal/GL tidak berubah; (7) jejak pelaku & peran tercatat.
// Pagar keras: menolak jalan bila bukan DB bernama rehearsal_evl_*.
import { createRequire } from "node:module";
const { PrismaClient } = createRequire(process.cwd() + "/")("@prisma/client");
const prisma = new PrismaClient();
const { periksaKeadaanCatatan, tungguPenyegaran } = await import("/app/src/services/catatanPemakaianHistoris.js");
const { postStockMovement } = await import("/app/src/services/inventoryLedger.js");
const { ajukanBatch, jalankanBatch, statusBatch } = await import("/app/src/services/postingBatchLatar.js");
const { rencanakanPosting, jalankanPosting } = await import("/app/src/services/postingPemakaianHistoris.js");
const { ringkasRencana, saldoBahanRencana, ENTITAS_KONFIRMASI } = await import("/app/src/services/postingKonfirmasiManifest.js");
let gagal = 0; const cek = (n, ok, d = "") => { if (!ok) gagal += 1; console.log((ok ? "PASS " : "FAIL ") + n + (d !== "" ? " — " + String(d).slice(0, 260) : "")); };
const hitung = async (sql) => Number((await prisma.$queryRawUnsafe(sql))[0].n);
const dbNama = (await prisma.$queryRawUnsafe("select current_database() n"))[0].n;
if (!/^rehearsal_evl_\d+_\d+$/.test(dbNama)) { console.log("FAIL pagar: simulasi tulis HANYA di DB rehearsal_evl_* (ini: " + dbNama + ")"); console.log("SIMULASI_KONFIRMASI gagal=1"); process.exit(1); }

const pengguna = await prisma.$queryRawUnsafe(`select u.id, u.name, coalesce((select array_agg(r.role::text order by r.role::text) from user_roles r where r.user_id = u.id), '{}') as peran from "User" u where u.active = true order by u.name`);
const peranDari = (u) => [...new Set([...(u.peran ?? [])])];
const ownerNyata = pengguna.filter((u) => peranDari(u).includes("OWNER")); const financeSaja = pengguna.filter((u) => peranDari(u).includes("FINANCE") && !peranDari(u).includes("OWNER"));
cek("ada akun ber-role OWNER di data restore (pemulai yang sah)", ownerNyata.length >= 1, ownerNyata.map((u) => u.name).join(","));
cek("ada akun Finance TANPA role Owner di data restore (tidak boleh memulai)", financeSaja.length >= 1, financeSaja.map((u) => u.name).join(","));
const OWNER = { id: ownerNyata[0].id, name: ownerNyata[0].name, roles: peranDari(ownerNyata[0]) }; const FINANCE = { id: financeSaja[0].id, name: financeSaja[0].name, roles: peranDari(financeSaja[0]) };
const S = async () => ({
  gerak: await hitung("select count(*)::int n from stock_movements"), jurnal: await hitung("select count(*)::int n from fin_journal_entries"), batch: await hitung("select count(*)::int n from activity_events where entity_type = 'posting_historis_batch' and event_type = 'BATCH_DIAJUKAN'"),
  tolak: await hitung(`select count(*)::int n from activity_events where entity_type = '${ENTITAS_KONFIRMASI}'`), issue: await hitung("select count(*)::int n from stock_movements where note like 'Impor pemakaian historis Sep%'"),
  gl1400: Number((await prisma.$queryRawUnsafe(`select coalesce(sum(l.debit - l.credit),0)::float n from fin_journal_lines l join fin_accounts a on a.id = l.account_id where a.code = '1-1400'`))[0].n),
  negatif: await hitung("select count(*)::int n from (select material_id from stock_movements group by 1 having sum(qty) < -0.0001) x"),
});
const rencana = async (unitIds) => { const p = await rencanakanPosting(prisma, { unitIds }); p.__saldo = await saldoBahanRencana(prisma, p); return p; };
const konfirmasiDari = (p, rujukan = "REHEARSAL-KONFIRMASI-bukan-production") => { const r = ringkasRencana(p); return { hash: r.hash, unitIds: r.unitIds, daftarOrder: r.daftarOrder, jumlahOrder: r.jumlahOrder, jumlahTrx: r.jumlahTrx, rujukan, isiTransaksi: r.isiTransaksi, saldoManifest: p.__saldo }; };
const persetujuan = (hashLayar, k, o = {}) => ({ hashDisetujui: hashLayar, rujukan: k.rujukan, disetujuiOleh: "simulasi rilis", konfirmasi: k, ...o });
const coba = async (fn) => { try { return { ok: true, v: await fn() }; } catch (e) { return { ok: false, kode: e.code, pesan: e.message, penghalang: e.penghalang }; } };

const plan0 = await rencanakanPosting(prisma);
const semuaUnit = [...new Set(plan0.transaksi.map((t) => t.unitId))];
cek("ada minimal 8 unit siap posting untuk disimulasikan", semuaUnit.length >= 8, semuaUnit.length);
const [A, B, C, D, E] = [semuaUnit.slice(0, 2), semuaUnit.slice(2, 4), semuaUnit.slice(4, 5), semuaUnit.slice(5, 7), semuaUnit.slice(7, 8)];
const s0 = await S();

// 1) Finance (tanpa Owner) tidak dapat memulai — batch dan sinkron; dicatat dengan peran
const pA = await rencana(A); const kA = konfirmasiDari(pA);
const f1 = await coba(() => ajukanBatch(prisma, { persetujuan: persetujuan(pA.hash, kA), aktor: FINANCE, unitIds: A })); const f2 = await coba(() => jalankanPosting(prisma, { persetujuan: persetujuan(pA.hash, kA), aktor: FINANCE, unitIds: A }));
const s1 = await S();
cek("Finance tanpa role Owner: mulai batch dan jalankan sinkron ditolak HANYA_OWNER_MEMULAI", !f1.ok && f1.kode === "HANYA_OWNER_MEMULAI" && !f2.ok && f2.kode === "HANYA_OWNER_MEMULAI", `${f1.kode}/${f2.kode}`);
cek("penolakan Finance: nol batch, nol movement, jurnal sama; 2 jejak tercatat dengan peran pelaku", s1.batch === s0.batch && s1.gerak === s0.gerak && s1.jurnal === s0.jurnal && s1.tolak === s0.tolak + 2, `${s0.tolak} → ${s1.tolak}`);
const jejakF = (await prisma.$queryRawUnsafe(`select metadata from activity_events where entity_type = '${ENTITAS_KONFIRMASI}' and actor_id = $1 order by created_at desc limit 1`, FINANCE.id))[0]?.metadata;
cek("jejak memuat jenis BUKAN_OWNER, peran, nama, mode kontrol", jejakF?.jenis === "BUKAN_OWNER" && Array.isArray(jejakF?.aktorRoles) && !jejakF.aktorRoles.includes("OWNER") && jejakF?.aktorNama === FINANCE.name && jejakF?.mode === "OWNER_MENINJAU_SENDIRI", JSON.stringify(jejakF)?.slice(0, 160));

// 2) REPLAY INSIDEN: Owner mengonfirmasi manifest A, tetapi pilihan yang dikirim = B (jumlah order sama)
const pB = await rencana(B); const r2 = await coba(() => ajukanBatch(prisma, { persetujuan: persetujuan(pB.hash, kA), aktor: OWNER, unitIds: B })); const r2b = await coba(() => jalankanPosting(prisma, { persetujuan: persetujuan(pB.hash, kA), aktor: OWNER, unitIds: B }));
const s2 = await S();
cek("replay insiden: pilihan berbeda dari yang dikonfirmasi (batch & sinkron) ditolak KONFIRMASI_MANIFEST_TIDAK_COCOK dengan selisih", !r2.ok && r2.kode === "KONFIRMASI_MANIFEST_TIDAK_COCOK" && !r2b.ok && r2b.kode === "KONFIRMASI_MANIFEST_TIDAK_COCOK" && (r2.penghalang ?? []).length >= 3, `${(r2.penghalang ?? []).length} selisih; ${A.length} vs ${B.length} unit; trx ${pA.jumlah} vs ${pB.jumlah}`);
cek("replay insiden: nol batch, nol movement, jurnal sama; jejak pelaku Owner tercatat", s2.batch === s1.batch && s2.gerak === s1.gerak && s2.jurnal === s1.jurnal && s2.tolak === s1.tolak + 2);

// 3) SALDO BERGESER setelah ditinjau (rencana tetap sama): penerimaan lain masuk pada bahan rencana
const pC = await rencana(C); const kC = konfirmasiDari(pC); const bahanC = pC.transaksi[0].materialId;
await prisma.$transaction((tx) => postStockMovement(tx, { materialId: bahanC, type: "ADJUSTMENT", qty: 1, note: "simulasi: saldo bergeser setelah manifest ditinjau", createdById: OWNER.id }), { timeout: 60_000 });
const pC2 = await rencana(C); const sBaru = await S();
const r3 = await coba(() => ajukanBatch(prisma, { persetujuan: persetujuan(pC2.hash, kC), aktor: OWNER, unitIds: C })); const s3 = await S();
cek("rencana sama tetapi saldo bergeser: konfirmasi lama ditolak ('berubah sejak ditinjau'); nol batch/movement baru", pC2.hash === pC.hash && !r3.ok && r3.kode === "KONFIRMASI_MANIFEST_TIDAK_COCOK" && /berubah sejak ditinjau/.test((r3.penghalang ?? []).join(" ")) && s3.batch === sBaru.batch && s3.gerak === sBaru.gerak, (r3.penghalang ?? [])[0]);

// 4) OWNER, konfirmasi benar: klik ganda ×3 → satu batch; selesai; ulang sama = nol tulisan; ulang dampak berbeda = ditolak
const pD = await rencana(D); const kD = konfirmasiDari(pD); const aD = () => ajukanBatch(prisma, { persetujuan: persetujuan(pD.hash, kD), aktor: OWNER, unitIds: D });
const klik = await Promise.allSettled([aD(), aD(), aD()]); const sD0 = await S();
cek("klik ganda ×3 dengan konfirmasi benar: semua berhasil dan tepat SATU batch baru", klik.every((x) => x.status === "fulfilled") && klik.filter((x) => x.value?.baru).length === 1 && sD0.batch === s3.batch + 1, JSON.stringify(klik.map((x) => x.status === "fulfilled" ? x.value.baru : String(x.reason?.message).slice(0, 60))));
const batchId = klik.find((x) => x.value?.baru).value.batchId; const hasil = await jalankanBatch(prisma, batchId); const stB = await statusBatch(prisma, batchId); const sD1 = await S();
cek("batch selesai tanpa gagal; pergerakan = jumlah transaksi dikonfirmasi; tanpa duplikat", hasil.status === "SELESAI" && stB.unitGagal === 0 && sD1.gerak === sD0.gerak + pD.jumlah && stB.transaksiDiposting === pD.jumlah, `${hasil.status}; +${sD1.gerak - sD0.gerak} vs ${pD.jumlah}`);
const ulang = await coba(() => aD()); const beda = await coba(() => ajukanBatch(prisma, { persetujuan: persetujuan(pD.hash, { ...kD, rujukan: "RUJUKAN-LAIN-BEDA-DAMPAK" }, { rujukan: "RUJUKAN-LAIN-BEDA-DAMPAK" }), aktor: OWNER, unitIds: D }));
const beda2 = await coba(() => ajukanBatch(prisma, { persetujuan: persetujuan(pD.hash, { ...kD, saldoManifest: kD.saldoManifest.map((x) => ({ ...x, saldo: x.saldo + 7 })) }), aktor: OWNER, unitIds: D })); const sD2 = await S();
cek("ulang dengan konfirmasi SAMA = batch yang sama (baru=false), nol tulisan", ulang.ok && ulang.v.baru === false && sD2.gerak === sD1.gerak && sD2.batch === sD1.batch);
cek("ulang dengan DAMPAK BERBEDA (rujukan lain / saldo ditinjau lain) ditolak; nol tulisan; dicatat", !beda.ok && beda.kode === "KONFIRMASI_MANIFEST_TIDAK_COCOK" && !beda2.ok && beda2.kode === "KONFIRMASI_MANIFEST_TIDAK_COCOK" && sD2.gerak === sD1.gerak && sD2.tolak === sD1.tolak + 2, `${beda.kode}/${beda2.kode}`);
const dia = (await prisma.$queryRawUnsafe(`select metadata from activity_events where entity_type = 'posting_historis_batch' and entity_id = $1 and event_type = 'BATCH_DIAJUKAN'`, batchId))[0]?.metadata?.konfirmasiManifest;
cek("rekaman konfirmasi tersimpan: isi transaksi lengkap, saldo ditinjau, peran pelaku, mode kontrol", dia?.isiTransaksi?.length === pD.jumlah && dia?.saldoManifest?.length > 0 && dia?.aktorRoles?.includes("OWNER") && dia?.mode === "OWNER_MENINJAU_SENDIRI" && dia?.hash === pD.hash, JSON.stringify({ n: dia?.isiTransaksi?.length, roles: dia?.aktorRoles }));

// 5) jalur sinkron: konfirmasi salah ditolak SEBELUM movement; benar berjalan
const pE = await rencana(E); const kE = konfirmasiDari(pE); const sE0 = await S();
const e1 = await coba(() => jalankanPosting(prisma, { persetujuan: persetujuan(pE.hash, { ...kE, jumlahTrx: kE.jumlahTrx + 1 }), aktor: OWNER, unitIds: E })); const sE1 = await S();
cek("sinkron: konfirmasi salah ditolak sebelum movement", !e1.ok && e1.kode === "KONFIRMASI_MANIFEST_TIDAK_COCOK" && sE1.gerak === sE0.gerak);
const e2 = await coba(() => jalankanPosting(prisma, { persetujuan: persetujuan(pE.hash, kE), aktor: OWNER, unitIds: E })); const sE2 = await S();
cek("sinkron: konfirmasi benar memposting tepat sebanyak transaksi", e2.ok && e2.v.gagal.length === 0 && sE2.gerak === sE1.gerak + pE.jumlah, e2.ok ? `+${sE2.gerak - sE1.gerak}` : e2.pesan);

// 6) invarian akhir
await tungguPenyegaran();
const akhir = await prisma.$transaction((tx) => periksaKeadaanCatatan(tx), { isolationLevel: "RepeatableRead", timeout: 120_000 }); const sx = await S();
cek("keadaan akhir = titik tetap", akhir.berubah === 0, "berubah=" + akhir.berubah);
cek("jurnal dan GL 1-1400 TIDAK berubah oleh seluruh simulasi (kuantitas dulu, tanpa jurnal HPP)", sx.jurnal === s0.jurnal && sx.gl1400 === s0.gl1400, `jurnal ${s0.jurnal}→${sx.jurnal}; GL ${s0.gl1400}→${sx.gl1400}`);
cek("tidak ada bahan baru yang menjadi negatif", sx.negatif <= s0.negatif, `${s0.negatif} → ${sx.negatif}`);
cek("hanya yang dikonfirmasi terposting: ISSUE bertambah = transaksi D + E", sx.issue === s0.issue + pD.jumlah + pE.jumlah, `+${sx.issue - s0.issue} vs ${pD.jumlah + pE.jumlah}`);
console.log("SIMULASI_KONFIRMASI gagal=" + gagal);
await prisma.$disconnect();
process.exit(gagal ? 1 : 0);
