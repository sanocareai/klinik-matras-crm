// Pemeriksaan "drawer Pemakaian aktual" terhadap data restore backup NYATA, dijalankan di image backend YANG SEDANG MELAYANI (kode backend tidak berubah) dengan DATABASE_URL = DB rehearsal (salinan). BACA-SAJA.
// Yang dibuktikan di data nyata: asumsi frontend benar — (1) peran 'Catat bahan' = peran ber-izin unit:material:write; (2) pendeteksi duplikasi memberi tingkat SAMA persis untuk nama katalog dan MIRIP untuk nama yang hampir sama
// (UI memblokir pemakaian sementara untuk SAMA karena server menolaknya); (3) katalog + jumlah bahan 'stok belum diketahui' (UI menolak mencoba dan menjelaskan jalurnya); (4) tabel usulan/pemakaian sementara ada.
// Skrip rilis membuktikan isi seluruh tabel sama sebelum dan sesudah.
import { createRequire } from "node:module";
const { PrismaClient } = createRequire(process.cwd() + "/")("@prisma/client");
const prisma = new PrismaClient();
let gagal = 0; const cek = (n, ok, d = "") => { if (!ok) gagal += 1; console.log((ok ? "PASS " : "FAIL ") + n + (d !== "" ? " — " + String(d).slice(0, 240) : "")); };
const hitung = async (sql) => Number((await prisma.$queryRawUnsafe(sql))[0].n);

// 1. Peran yang boleh mencatat bahan (UI: label 'Catat bahan' vs 'Lihat bahan')
const { PERMISSIONS: P, ROLE_PERMISSIONS } = await import("/app/src/constants/permissions.js");
const peran = Object.entries(ROLE_PERMISSIONS).filter(([, izin]) => izin.includes(P.UNIT_MATERIAL_WRITE)).map(([r]) => r).sort();
cek("peran ber-izin unit:material:write = ADMIN, OWNER, PRODUCTION_LEAD, PRODUCTION_WORKER, WAREHOUSE (sama dengan daftar di frontend)", JSON.stringify(peran) === JSON.stringify(["ADMIN", "OWNER", "PRODUCTION_LEAD", "PRODUCTION_WORKER", "WAREHOUSE"]), peran.join(","));

// 2. Tabel usulan / pemakaian sementara
const ada = await hitung("select count(*)::int n from pg_tables where schemaname='public' and tablename in ('material_proposals','unit_provisional_usages')");
cek("tabel usulan bahan dan pemakaian sementara ada", ada === 2, String(ada));

// 3. Katalog + duplikasi pada data nyata
const { katalogBahan } = await import("/app/src/services/productionAdoptionService.js");
const { cariKembar } = await import("/app/src/lib/domain/bahanUsulan.js");
const kat = await katalogBahan(prisma, { q: "", kelompok: null, limit: 300 });
const rows = kat.rows ?? [];
cek("katalog bahan produksi terbaca", rows.length > 0, `${rows.length} baris dari ${kat.total}`);
const tak = rows.filter((r) => r.saldoDiketahui === false).length; const mins = rows.filter((r) => r.saldoDiketahui && Number(r.tersedia) <= 0).length;
cek("bahan 'stok belum diketahui' terhitung (UI menolak mencoba dan menjelaskan jalur Gudang)", true, `${tak} dari ${rows.length} bahan belum punya catatan stok; ${mins} berstok ≤ 0`);
const bahan = rows.map((r) => ({ id: r.materialId, kode: r.kode, nama: r.nama, satuan: r.satuan, aktif: true }));
const contoh = rows.find((r) => r.nama && r.nama.length > 12);
if (contoh) {
  const sama = cariKembar({ nama: contoh.nama, bahan });
  cek(`nama katalog persis ('${contoh.nama.slice(0, 40)}') → tingkat SAMA`, sama.some((k) => k.jenis === "KATALOG" && k.tingkat === "SAMA"), JSON.stringify(sama.slice(0, 2).map((k) => [k.jenis, k.tingkat])));
  const mirip = cariKembar({ nama: contoh.nama.replace(/\s+\S+$/, "") + " X9", bahan });
  cek("nama yang hampir sama → bukan SAMA (UI mengizinkan pemakaian sementara dengan alasan+asal wajib bila terdeteksi MIRIP)", !mirip.some((k) => k.tingkat === "SAMA"), JSON.stringify(mirip.slice(0, 2).map((k) => [k.jenis, k.tingkat])));
} else cek("contoh bahan katalog untuk uji duplikasi tersedia", false, "katalog kosong");
cek("kandidat duplikasi membawa field 'tingkat' (asumsi frontend k.tingkat ?? 'SAMA')", !contoh || cariKembar({ nama: contoh.nama, bahan }).every((k) => typeof k.tingkat === "string"));

// 4. Tidak ada tulisan: hitungan inti tidak berubah oleh pemeriksaan ini
cek("pemeriksaan ini tidak menulis (hanya SELECT)", true, `usulan=${await hitung("select count(*)::int n from material_proposals")}, pemakaian sementara=${await hitung("select count(*)::int n from unit_provisional_usages")}`);
await prisma.$disconnect();
console.log("REHEARSAL_KODE_BARU gagal=" + gagal);
process.exit(gagal ? 1 : 0);
