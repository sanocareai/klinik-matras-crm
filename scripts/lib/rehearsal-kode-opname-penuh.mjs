// Pemeriksaan KODE BARU terhadap data restore yang SUDAH dimigrasi (rehearsal mode image; BACA-SAJA — tidak ada tulisan). Dijalankan di container backend baru dengan DATABASE_URL = DB rehearsal dan EXPECT_AKTIF = jumlah bahan aktif di produksi.
// Membuktikan: (1) semua sesi hitung lama tetap model 1 dan terbaca (termasuk sesi 106 bahan) oleh kode baru; (2) bahan aktif seluruhnya terklasifikasi: masuk Opname penuh (saldo dilacak fisik) atau tampil sebagai tidak dilacak
// dengan alasan — tidak ada yang hilang diam-diam; (3) aturan waktu murni bekerja; (4) tidak ada tulisan (sesi, baris, pergerakan stok).
import { createRequire } from "node:module";
const { PrismaClient } = createRequire(process.cwd() + "/")("@prisma/client");
const prisma = new PrismaClient();
const { muatBahan, bangunCakupan, klasifikasiPergerakan, hitungPembanding, KELAS } = await import("/app/src/services/opnameSesi.js");
const { muatJejakStok } = await import("/app/src/services/stokFisik.js");
const { muatPergerakanSesi } = await import("/app/src/services/pergerakanSesiHitung.js");
let gagal = 0; const cek = (n, ok, d = "") => { if (!ok) gagal += 1; console.log((ok ? "PASS " : "FAIL ") + n + (d ? " — " + d : "")); };
const hitung = async (sql) => Number((await prisma.$queryRawUnsafe(sql))[0].n);
const awal = { sesi: await hitung("select count(*)::int n from stock_counts"), baris: await hitung("select count(*)::int n from stock_count_lines"), mov: await hitung("select count(*)::int n from stock_movements") };

// 1) sesi lama
const sesi = await prisma.stockCount.findMany({ include: { lines: { select: { id: true, materialId: true, countedQty: true, systemQty: true, savedAt: true, observedAt: true } } }, orderBy: { createdAt: "asc" } });
cek("data restore memuat sesi hitung lama", sesi.length > 0, "n=" + sesi.length);
cek("semua sesi lama tetap model 1 tanpa cakupan tersimpan", sesi.every((s) => s.modelVersion === 1 && s.scopeMode === null && s.scopeInfo === null));
cek("semua baris sesi lama tanpa waktu pengamatan/simpan baru (tidak ada backfill)", sesi.every((s) => s.lines.every((l) => l.savedAt === null && l.observedAt === null)));
const terbesar = sesi.reduce((m, s) => (s.lines.length > m.lines.length ? s : m), sesi[0]);
cek("sesi terbesar terbaca penuh oleh kode baru", terbesar.lines.length > 0, `${terbesar.countNumber}: ${terbesar.lines.length} baris`);
for (const s of sesi) {
  const full = await prisma.stockCount.findUnique({ where: { id: s.id }, include: { lines: { include: { material: { select: { id: true, code: true, name: true, unit: true, itemGroup: true, active: true } } } } } });
  const { pergerakan } = await muatPergerakanSesi(prisma, full);
  cek(`sesi ${s.countNumber} (${s.status}, ${s.lines.length} baris): dibaca dan pergerakan sesi dimuat dengan aturan lama`, full.lines.length === s.lines.length && Array.isArray(pergerakan));
}

// 2) cakupan Opname penuh di atas data nyata
const bahan = await muatBahan(prisma); const aktif = bahan.filter((m) => m.active);
const harapAktif = Number(process.env.EXPECT_AKTIF);
cek("jumlah bahan aktif di data restore = produksi", Number.isInteger(harapAktif) && aktif.length === harapAktif, `restore=${aktif.length} produksi=${process.env.EXPECT_AKTIF}`);
const { ringkasan, materialIds } = bangunCakupan(bahan, { mode: "FULL" });
cek("setiap bahan aktif terklasifikasi: masuk sesi penuh ATAU tampil sebagai tidak dilacak (tidak ada yang hilang diam-diam)", ringkasan.masuk + ringkasan.tidakDilacak.jumlah === aktif.length, `masuk=${ringkasan.masuk} tidak dilacak=${ringkasan.tidakDilacak.jumlah} aktif=${aktif.length}`);
cek("daftar Material ID cakupan unik dan semuanya bahan aktif", new Set(materialIds).size === materialIds.length && materialIds.every((id) => aktif.some((m) => m.id === id)));
cek("setiap bahan tidak dilacak membawa alasan", ringkasan.tidakDilacak.daftar.every((x) => /Tidak ada jejak stok/.test(x.alasan)));
const jejak = await muatJejakStok(prisma);
cek("keputusan dilacak berasal dari bukti (jejak stok), bukan nama kategori: Habis Pakai berjejak ikut, tanpa jejak tidak", aktif.filter((m) => m.category === "CONSUMABLE").every((m) => (materialIds.includes(m.id)) === !!jejak.get(m.id)?.dilacak), `Habis Pakai aktif=${aktif.filter((m) => m.category === "CONSUMABLE").length}`);
cek("bahan nonaktif tidak pernah masuk cakupan", bahan.filter((m) => !m.active).every((m) => !materialIds.includes(m.id)));
console.log(`INFO cakupan penuh = ${ringkasan.masuk} bahan dilacak; ${ringkasan.tidakDilacak.jumlah} tidak dilacak; belum dikelompokkan ${ringkasan.belumDikelompokkan.masuk}; nonaktif ${ringkasan.nonaktif.jumlah}`);

// 3) aturan waktu murni
const O = new Date("2026-11-01T03:00:00Z");
cek("aturan waktu: sebelum pengamatan otomatis; sesudah ditandai (tanpa jendela menit)", klasifikasiPergerakan({ createdAt: new Date(O.getTime() - 20 * 60000), observedAt: O }) === KELAS.SEBELUM && klasifikasiPergerakan({ createdAt: new Date(O.getTime() + 5 * 60000), observedAt: O, savedAt: new Date(O.getTime() + 40 * 60000) }) === KELAS.SAAT_HITUNG);
const h = hitungPembanding({ saldoSebelum: 100, countedQty: 100, pergerakan: [{ id: "x", qty: 20, kelas: KELAS.SAAT_HITUNG, tanda: null }] });
cek("pergerakan sejak pengamatan tidak masuk pembanding diam-diam dan menahan penyelesaian", h.pembanding === 100 && h.belumDiputuskan.length === 1);

// 4) tidak ada tulisan
cek("tidak ada sesi/baris/pergerakan stok yang ditulis oleh pemeriksaan ini", (await hitung("select count(*)::int n from stock_counts")) === awal.sesi && (await hitung("select count(*)::int n from stock_count_lines")) === awal.baris && (await hitung("select count(*)::int n from stock_movements")) === awal.mov);
await prisma.$disconnect();
console.log("REHEARSAL_KODE_BARU gagal=" + gagal);
process.exit(gagal ? 1 : 0);
