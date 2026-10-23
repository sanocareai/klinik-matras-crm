// Uji KODE BARU + migrasi "material_id catatan pemakaian sementara terkunci" pada SALINAN RESTORE backup nyata (DB sementara yang DIHAPUS skrip rilis; production tidak tersentuh).
// Dijalankan di image kandidat dengan DATABASE_URL = DB rehearsal SESUDAH migrasi diterapkan dan sidik jari tabel lama terbukti identik. Boleh menulis (pada salinan): mencatat/koreksi/menolak pemakaian sementara bahan katalog
// pada unit dan bahan NYATA dari restore, lalu membuktikan stok/Material Issue/jurnal tidak berubah, trigger menolak ubah material_id lewat SQL, dan jalur resmi tetap menolak bahan bersaldo diketahui.
import { createRequire } from "node:module";
const { PrismaClient } = createRequire(process.cwd() + "/")("@prisma/client");
const prisma = new PrismaClient();
let gagal = 0; let dilewati = 0; const cek = (n, ok, d = "") => { if (!ok) gagal += 1; console.log((ok ? "PASS " : "FAIL ") + n + (d !== "" ? " — " + String(d).slice(0, 240) : "")); };
const lewati = (n, a) => { dilewati += 1; console.log(`SKIP ${n} — DILEWATI: ${a}`); };
const hitung = async (sql) => Number((await prisma.$queryRawUnsafe(sql))[0].n);
const svc = await import("/app/src/services/unitProvisionalUsageService.js");
const inti = async () => ({ sm: await hitung("select count(*)::int n from stock_movements"), mi: await hitung("select count(*)::int n from material_issues"), jur: await hitung("select count(*)::int n from fin_journal_entries"), mat: await hitung("select count(*)::int n from materials"), usul: await hitung("select count(*)::int n from material_proposals") });

// 1. migrasi tercatat + fungsi penjaga memuat aturan baru
const mig = await prisma.$queryRawUnsafe("select migration_name from _prisma_migrations where migration_name like '%pemakaian_sementara_material_id_terkunci' and finished_at is not null and rolled_back_at is null");
cek("migrasi material_id terkunci tercatat selesai pada salinan", mig.length === 1, mig.map((m) => m.migration_name).join());
const def = (await prisma.$queryRawUnsafe("select pg_get_functiondef('unit_provisional_usages_guard'::regproc) d"))[0].d;
cek("fungsi penjaga memuat aturan 'tautan bahan katalog (material_id) ... tidak boleh diubah'", /material_id\) catatan pemakaian sementara tidak boleh diubah/.test(def));
cek("trigger penjaga tetap terpasang sekali pada tabel", await hitung("select count(*)::int n from pg_trigger where tgname='unit_provisional_usages_guard_trg' and not tgisinternal") === 1);

// 2. data nyata: unit aktif + pelaku + bahan katalog TANPA pergerakan (stok belum diketahui) dan bahan BERSALDO diketahui
const unit = await prisma.unit.findFirst({ where: { status: { notIn: ["CANCELLED", "DELIVERED"] } }, select: { id: true, unitCode: true } });
const aktor = await prisma.user.findFirst({ where: { active: true }, select: { id: true } });
const tanpa = (await prisma.$queryRawUnsafe(`select m.id::text id, m.code, m.name, m.unit::text unit from materials m where m.active and (m.kind is null or m.kind <> 'PERLENGKAPAN_STOK') and not exists (select 1 from stock_movements s where s.material_id = m.id) order by m.code limit 1`))[0];
const dengan = (await prisma.$queryRawUnsafe(`select m.id::text id, m.code, m.unit::text unit from materials m where m.active and (m.kind is null or m.kind <> 'PERLENGKAPAN_STOK') and exists (select 1 from stock_movements s where s.material_id = m.id) order by m.code limit 1`))[0];
cek("data restore punya unit aktif dan pelaku aktif", !!unit && !!aktor, unit?.unitCode);
cek("data restore punya bahan katalog TANPA catatan stok (kasus 'stok belum diketahui')", !!tanpa, tanpa ? `${tanpa.code}` : "tidak ada");
if (unit && aktor && tanpa) {
  const e0 = await inti(); const kunci = `rehearsal-katalog-${Date.now()}-aaaa`;
  const isi = { materialId: tanpa.id, qty: 2, uom: tanpa.unit, originNote: "Sisa bahan di meja produksi", alasanPencatatan: "Stok bahan belum tercatat di Gudang; bahan sudah terlanjur dipakai pada unit ini" };
  const a = await svc.catatPemakaianSementara(prisma, { unitId: unit.id, input: isi, actorId: aktor.id, idempotencyKey: kunci });
  cek("catat sementara bahan katalog stok belum diketahui: tertaut ke ID katalog, PERLU_REKONSILIASI, nama dari katalog", a.item.materialId === tanpa.id && a.item.status === "PERLU_REKONSILIASI" && a.item.name === tanpa.name && a.item.tertautKatalog === true && a.item.proposalId === null, `${a.item.name} ${a.item.status}`);
  const ulang = await svc.catatPemakaianSementara(prisma, { unitId: unit.id, input: isi, actorId: aktor.id, idempotencyKey: kunci });
  cek("klik ganda (kunci sama) = replay, satu baris", ulang.replayed === true && ulang.item.id === a.item.id && await hitung(`select count(*)::int n from unit_provisional_usages where material_id = '${tanpa.id}'`) === 1);
  const e1 = await inti(); cek("TANPA Material Issue/pergerakan/jurnal/bahan/usulan baru; stok bahan tetap tanpa catatan", JSON.stringify(e1) === JSON.stringify(e0) && await hitung(`select count(*)::int n from stock_movements where material_id = '${tanpa.id}'`) === 0, JSON.stringify(e1));
  let kode = null; try { await svc.catatPemakaianSementara(prisma, { unitId: unit.id, input: { ...isi, originNote: "" }, actorId: aktor.id, idempotencyKey: kunci + "x" }); } catch (e) { kode = e.code; }
  cek("asal barang kosong ditolak (SEMENTARA_ASAL_WAJIB)", kode === "SEMENTARA_ASAL_WAJIB", kode);
  if (dengan) { let k2 = null; try { await svc.catatPemakaianSementara(prisma, { unitId: unit.id, input: { ...isi, materialId: dengan.id, uom: dengan.unit }, actorId: aktor.id, idempotencyKey: kunci + "y" }); } catch (e) { k2 = e.code; } cek(`bahan bersaldo diketahui (${dengan.code}) ditolak (BAHAN_STOK_DIKETAHUI)`, k2 === "BAHAN_STOK_DIKETAHUI", k2); } else lewati("bahan bersaldo diketahui ditolak", "tidak ada bahan dengan pergerakan pada restore");
  // trigger: ubah material_id lewat SQL langsung harus ditolak
  const lain = (await prisma.$queryRawUnsafe(`select id::text id from materials where id <> '${tanpa.id}' limit 1`))[0];
  let err = null; try { await prisma.$executeRawUnsafe(`UPDATE unit_provisional_usages SET material_id = '${lain.id}' WHERE id = '${a.item.id}'`); } catch (e) { err = e; }
  cek("trigger menolak UPDATE material_id lewat SQL langsung pada catatan tertaut katalog", !!err && /material_id\) catatan pemakaian sementara tidak boleh diubah/.test(String(err.message)), err ? String(err.message).slice(0, 120) : "TIDAK ditolak");
  err = null; try { await prisma.$executeRawUnsafe(`UPDATE unit_provisional_usages SET material_id = NULL WHERE id = '${a.item.id}'`); } catch (e) { err = e; }
  cek("trigger menolak mengosongkan material_id", !!err);
  cek("tautan bahan tidak berubah setelah percobaan", (await prisma.unitProvisionalUsage.findUnique({ where: { id: a.item.id } })).materialId === tanpa.id);
  // koreksi = baris versi baru, bahan terkunci
  const kor = await svc.koreksiPemakaianSementara(prisma, { usageId: a.item.id, input: { qty: 3, originNote: "Sisa bahan di meja produksi (hitung ulang)" }, alasan: "Jumlah salah hitung", actorId: aktor.id, idempotencyKey: kunci + "k" });
  cek("koreksi: baris lama DIBATALKAN, baris baru membawa ID katalog yang sama (versi baru), tanpa mengubah baris lama", kor.item.materialId === tanpa.id && kor.item.correctedFromId === a.item.id && kor.lama.status === "DIBATALKAN" && (await prisma.unitProvisionalUsage.findUnique({ where: { id: a.item.id } })).materialId === tanpa.id);
  const kand = await svc.kandidatPergerakan(prisma, kor.item.id);
  cek("kandidat rekonsiliasi: petunjuk jalur stok resmi + bahan katalog; hanya bahan itu", kand.bahanTujuanId === tanpa.id && kand.bahanKatalog?.kode === tanpa.code && /stok awal\/opname/.test(kand.petunjuk), kand.petunjuk?.slice(0, 80));
  const unitList = await svc.ambilPemakaianSementaraUnit(prisma, unit.id);
  cek("daftar unit menandai tertautKatalog + bahanKatalog; total perlu rekonsiliasi terhitung", unitList.items.some((i) => i.tertautKatalog && i.bahanKatalog?.kode === tanpa.code) && unitList.total.perluRekonsiliasi >= 1);
  const e2 = await inti(); cek("setelah koreksi: stok/Material Issue/jurnal/bahan/usulan tetap tidak berubah", JSON.stringify(e2) === JSON.stringify(e0));
}
await prisma.$disconnect();
console.log("REHEARSAL_KODE_BARU gagal=" + gagal + " skip=" + dilewati);
process.exit(gagal ? 1 : 0);
