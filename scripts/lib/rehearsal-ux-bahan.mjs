import { createRequire } from "node:module";
const { PrismaClient } = createRequire(process.cwd() + "/")("@prisma/client");
const prisma = new PrismaClient();
const P = await import("/app/src/services/materialProposalService.js");
const U = await import("/app/src/services/unitProvisionalUsageService.js");
const D = await import("/app/src/lib/domain/productionWorkStatus.js");
const { kunciNama } = await import("/app/src/lib/domain/bahanUsulan.js");
const { listWorkList } = await import("/app/src/services/productionWorkListService.js");
let gagal = 0; let n = 0;
const cek = (nama, ok, d = "") => { n += 1; if (!ok) gagal += 1; console.log(`${ok ? "OK   " : "GAGAL"} ${nama}${d ? " — " + d : ""}`); };
const num = async (q) => Number((await prisma.$queryRawUnsafe(q))[0].n);
const TABEL = ["stock_movements", "material_issues", "goods_receipts", "fin_journal_entries", "fin_journal_lines", "units", "production_runs_v2", "production_run_plans_v2", "qc_fit_tests", "production_unit_schedules", "production_unit_work_progress", "unit_component_reuse_entries"];
const fp = async () => { const o = {}; for (const t of TABEL) o[t] = (await prisma.$queryRawUnsafe(`select count(*)::int n, coalesce(md5(string_agg(x::text, '|' order by x::text)),'') h from "${t}" x`))[0]; return o; };
const bedaTabel = (a, b) => TABEL.filter((t) => a[t].n !== b[t].n || a[t].h !== b[t].h);
const ditolak = async (f) => { try { await f(); return null; } catch (e) { return e; } };
const ts = Date.now().toString(36);

// A. struktur baru terpasang dan KOSONG
cek("tabel rilis kosong setelah migrasi (tanpa backfill)", (await num("select (select count(*) from material_proposals) + (select count(*) from unit_provisional_usages) as n")) === 0);

// B. kontrak murni: sumber status kerja baru
const dasar = { unitStatus: "RECEIVED", pemakaian: { pertamaAt: "2026-10-22T03:00:00Z", terakhirAt: "2026-10-22T03:00:00Z", hanyaSementara: true } };
const ks = D.effectiveWorkStatus(dasar);
cek("kode baru: hanya pemakaian sementara → 'Sudah dikerjakan' bersumber PEMAKAIAN_SEMENTARA", ks.key === "DIKERJAKAN" && ks.source === "PEMAKAIAN_SEMENTARA" && /perlu rekonsiliasi Gudang/.test(ks.sourceLabel));
cek("kode baru: bukti resmi tetap sumber PEMAKAIAN_BAHAN (sementara tidak menimpa)", D.effectiveWorkStatus({ ...dasar, pemakaian: { ...dasar.pemakaian, hanyaSementara: false } }).source === "PEMAKAIAN_BAHAN");

// C. membaca = baca-saja pada data produksi (salinan)
const fp0 = await fp();
const daftarU = await P.daftarUsulan(prisma); const daftarS = await U.daftarPemakaianSementara(prisma, { status: null });
cek("antrean usulan & pemakaian sementara terbaca (kosong) tanpa menulis", daftarU.rows.length === 0 && daftarS.rows.length === 0 && bedaTabel(fp0, await fp()).length === 0);
const daftar = await listWorkList(prisma, { scope: "aktif", pageSize: 100 });
const unitDaftar = daftar.orders.flatMap((o) => o.units.map((u) => ({ ...u, order: o })));
console.log(`INFO daftar kerja aktif pada salinan: ${daftar.orders.length} order, ${unitDaftar.length} unit`);
cek("daftar kerja dibaca dengan kode baru tanpa mengubah tabel kunci", bedaTabel(fp0, await fp()).length === 0);

// D. tulis pada SALINAN (DB sementara; dihapus): usulan, keputusan, pemakaian sementara, koreksi, batal, rekonsiliasi
const admin = await prisma.user.findFirst({ where: { role: { in: ["ADMIN", "OWNER"] } }, select: { id: true, name: true } }) ?? await prisma.user.findFirst({ select: { id: true, name: true } });
const matAwal = await num("select count(*) as n from materials");
const fpA = await fp();
const kunci = (t) => `reh-${t}-${ts}-aaaaaaaa`;
const kandidat = [];
for (const u of unitDaftar) {
  if (!["BELUM_DIJADWALKAN", "DIJADWALKAN"].includes(u.kerja?.key) || u.kerja?.source === "APLIKASI") continue;
  const ada = await num(`select (select count(*) from stock_movements where unit_id = '${u.id}' and type::text = 'ISSUE') + (select count(*) from unit_component_reuse_entries where unit_id = '${u.id}') + (select count(*) from production_unit_work_progress where unit_id = '${u.id}') as n`);
  if (ada === 0) { kandidat.push(u); break; }
}
const unit = kandidat[0] ?? null;

// D1. usulan: klik ganda serentak = satu baris; tanpa efek stok/katalog
const NAMA_USULAN = "Pelat Seng Gelombang Alfa"; const NAMA_SEMENTARA = "Pita Nilon Hitam Beta"; const NAMA_LEPAS = "Lem Aerosol Kuning Gamma";
const usulan = { name: NAMA_USULAN, unit: "PCS", kelompok: "LAINNYA", description: "rehearsal" };
const hasilU = await Promise.allSettled([1, 2, 3].map(() => P.ajukanBahanBaru(prisma, { input: usulan, actorId: admin.id })));
cek("usulan bahan (serentak ×3): tepat SATU baris usulan", hasilU.every((h) => h.status === "fulfilled") && await num(`select count(*) as n from material_proposals where name_key = '${kunciNama(NAMA_USULAN)}'`) === 1);
cek("usulan TIDAK membuat Material, saldo, penerimaan, pergerakan, biaya, atau jurnal", (await num("select count(*) as n from materials")) === matAwal && bedaTabel(fpA, await fp()).length === 0);
const material = await prisma.material.findFirst({ where: { active: true }, select: { name: true } });
if (material) { const e = await ditolak(() => P.ajukanBahanBaru(prisma, { input: { name: material.name, unit: "PCS", kelompok: "LAINNYA" }, actorId: admin.id })); cek("nama yang SAMA dengan bahan katalog ditolak (BAHAN_SUDAH_ADA)", e?.code === "BAHAN_SUDAH_ADA", e?.code); }
else console.log("SKIP tidak ada bahan aktif pada salinan untuk uji duplikasi");

// D2. keputusan Gudang/Admin: bahan dibuat TANPA saldo
const p1 = (await P.daftarUsulan(prisma, { status: "MENUNGGU_GUDANG" })).rows.find((r) => r.name === usulan.name);
const kodeUji = `REH-UJI-${ts}`.toUpperCase();
const setuju = await P.putuskanUsulan(prisma, { proposalId: p1.id, input: { keputusan: "SETUJUI", kode: kodeUji, itemGroup: "PE" }, actorId: admin.id });
const mBaru = await prisma.material.findFirst({ where: { code: kodeUji } });
cek("keputusan SETUJUI: Material dibuat di katalog, status DISETUJUI", setuju.usulan.status === "DISETUJUI" && !!mBaru && (await num("select count(*) as n from materials")) === matAwal + 1);
cek("membuat katalog TIDAK menambah saldo/penerimaan/pergerakan/biaya/jurnal", (await num(`select count(*) as n from stock_movements where material_id = '${mBaru.id}'`)) === 0 && bedaTabel(fpA, await fp()).length === 0);

// D3. pemakaian sementara
if (!unit) console.log("SKIP tidak ada unit tanpa bukti kerja pada salinan: uji pemakaian sementara pada unit nyata dilewati");
else {
  const p2 = await P.ajukanBahanBaru(prisma, { input: { name: NAMA_SEMENTARA, unit: "METER", kelompok: "AKSESORI" }, actorId: admin.id });
  const input = { name: NAMA_SEMENTARA, qty: 2, uom: "METER", originNote: "Dibeli sendiri / dari luar", proposalId: p2.usulan.id };
  const k1 = kunci("sem");
  const hasilS = await Promise.allSettled([1, 2, 3].map(() => U.catatPemakaianSementara(prisma, { unitId: unit.id, input, actorId: admin.id, idempotencyKey: k1 })));
  const baris = await prisma.unitProvisionalUsage.findMany({ where: { unitId: unit.id } });
  cek(`pemakaian sementara pada ${unit.unitCode} (serentak ×3, kunci sama): tepat SATU catatan`, hasilS.every((h) => h.status === "fulfilled") && baris.length === 1 && baris[0].status === "PERLU_REKONSILIASI");
  const fpB = await fp(); cek("pemakaian sementara TIDAK menyentuh stok/Material Issue/penerimaan/jurnal/Run/QC/jadwal/komponen lama", bedaTabel(fpA, fpB).length === 0, bedaTabel(fpA, fpB).join(","));
  const lihat = async () => (await listWorkList(prisma, { scope: "aktif", pageSize: 100, q: unit.unitCode })).orders.flatMap((o) => o.units).find((x) => x.id === unit.id);
  const u1 = await lihat(); cek("daftar kerja: 'Sudah dikerjakan' dengan sumber 'Pemakaian sementara — perlu rekonsiliasi Gudang'", u1?.kerja?.key === "DIKERJAKAN" && u1.kerja.source === "PEMAKAIAN_SEMENTARA", JSON.stringify([u1?.kerja?.key, u1?.kerja?.source]));
  // koreksi beralasan
  const kor = await U.koreksiPemakaianSementara(prisma, { usageId: baris[0].id, input: { qty: 3, uom: "METER", originNote: "Pinjam dari tempat lain" }, alasan: "Jumlah di meja ternyata 3 meter", actorId: admin.id, idempotencyKey: kunci("kor") });
  const lama = await prisma.unitProvisionalUsage.findUnique({ where: { id: baris[0].id } });
  cek("koreksi beralasan: catatan lama DIBATALKAN ('Dikoreksi: …'), catatan baru PERLU_REKONSILIASI menunjuk ke yang lama", lama.status === "DIBATALKAN" && lama.cancelReason.startsWith("Dikoreksi: ") && kor.item.hasilKoreksi === true && kor.item.status === "PERLU_REKONSILIASI");
  cek("setelah koreksi: bukti kerja pindah ke catatan baru (masih Pemakaian sementara)", (await lihat())?.kerja?.source === "PEMAKAIAN_SEMENTARA");
  // batal salah input -> bukan bukti kerja lagi
  await U.batalkanPemakaianSementara(prisma, { usageId: kor.item.id, alasan: "Salah unit (rehearsal)", actorId: admin.id, bolehSemua: true });
  const u3 = await lihat(); cek("setelah pembatalan salah input: status kerja KEMBALI seperti semula dan bukan lagi sumber sementara", u3?.kerja?.key === unit.kerja.key && u3.kerja.source !== "PEMAKAIAN_SEMENTARA", JSON.stringify([u3?.kerja?.key, u3?.kerja?.source]));
  const ev = await num(`select count(*) as n from activity_events where entity_id = '${unit.id}' and event_type in ('PRODUCTION_PEMAKAIAN_SEMENTARA_DICATAT','PRODUCTION_PEMAKAIAN_SEMENTARA_DISELESAIKAN')`);
  cek("audit tercatat untuk catat, koreksi, dan pembatalan (≥ 4 peristiwa)", ev >= 4, String(ev));
  // rekonsiliasi 'bukan stok Gudang' lalu pembatalan oleh Gudang
  const s3 = await U.catatPemakaianSementara(prisma, { unitId: unit.id, input: { name: NAMA_LEPAS, qty: 1, uom: "PCS" }, actorId: admin.id, idempotencyKey: kunci("lepas") });
  const rk = await U.rekonsiliasiPemakaianSementara(prisma, { usageId: s3.item.id, input: { resolusi: "TANPA_STOK", catatan: "Dibeli operator di toko luar (rehearsal)" }, actorId: admin.id });
  cek("rekonsiliasi 'bukan stok Gudang': DIREKONSILIASI tanpa pergerakan/jurnal", rk.item.status === "DIREKONSILIASI" && bedaTabel(fpA, await fp()).length === 0);
  const bt = await U.batalkanPemakaianSementara(prisma, { usageId: s3.item.id, alasan: "Salah input (rehearsal)", actorId: admin.id, bolehSemua: true });
  cek("pembatalan catatan 'bukan stok Gudang' oleh pemegang hak Gudang: DIBATALKAN, riwayat penyelesaian tetap", bt.item.status === "DIBATALKAN" && bt.item.resolusi === "TANPA_STOK");
  // trigger DB: baris final tidak bisa diubah/dihapus
  const e1 = await ditolak(() => prisma.$executeRawUnsafe(`update unit_provisional_usages set qty = 99 where id = '${s3.item.id}'`));
  const e2 = await ditolak(() => prisma.$executeRawUnsafe(`delete from unit_provisional_usages where id = '${s3.item.id}'`));
  const e3 = await ditolak(() => prisma.$executeRawUnsafe(`delete from material_proposals where id = '${p1.id}'`));
  cek("trigger DB: baris final tidak bisa diubah/dihapus (pemakaian sementara & usulan)", !!e1 && !!e2 && !!e3);
  const fpC = await fp(); cek("seluruh rangkaian tulis: stok, Material Issue, penerimaan, jurnal, Run, QC, jadwal, catatan kerja, komponen lama TIDAK berubah", bedaTabel(fpA, fpC).length === 0, bedaTabel(fpA, fpC).join(","));
}
await prisma.$disconnect();
console.log("PEMERIKSAAN=" + n + " gagal=" + gagal);
process.exit(gagal === 0 ? 0 : 1);
