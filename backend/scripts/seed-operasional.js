// SEED OPERASIONAL — menyalakan modul Bengkel/Armada/Gudang untuk pertama kali.
//
// LATAR BELAKANG (audit 19 Agustus 2026). Seluruh kode & master data ketiga
// modul itu SUDAH LENGKAP dan ter-seed (12 routing_stages, 6 service_catalog,
// 11 pemetaan modul), tapi NOL data operasional: 0 unit_stage_logs, 0 jobs,
// 0 vehicles, 0 materials. Penyebab paling mendasar: dari 10 user produksi,
// SEMUANYA cuma SALES atau ADMIN — tidak ada satu pun yang punya
// PRODUCTION_LEAD / QC_LEAD / WAREHOUSE / DISPATCHER / DRIVER, jadi setiap
// tombol aksi di modul itu dijawab 403 dan tidak ada yang bisa dites.
//
// ⚠️ ADMIN SENGAJA TIDAK BISA menggantikan peran-peran itu. permissions.js
// menahan UNIT_STAGE_WRITE / QC_WRITE / INVENTORY_WRITE dari ADMIN dengan
// alasan eksplisit: kalau admin bisa memajukan tahap produksi, kolom "siapa
// yang mengerjakan" di unit_stage_logs berhenti bisa dipercaya. Jadi jalan
// keluarnya memang menambah AKUN BER-ROLE, bukan melebarkan ADMIN.
//
// PEMAKAIAN (dry-run dulu, JANGAN langsung --apply):
//   docker compose exec backend node scripts/seed-operasional.js
//   docker compose exec backend node scripts/seed-operasional.js --apply
//
// IDEMPOTEN. Semua penulisan pakai upsert/skipDuplicates berdasarkan kunci
// unik (User.email, Material.code, Vehicle.plateNumber, UserRole[userId,role])
// — aman dijalankan berkali-kali, tidak akan menggandakan apa pun.
//
// TIDAK MENGHAPUS apa pun, dan TIDAK menyentuh data yang sudah ada (order,
// customer, percakapan). Murni menambah baris baru yang belum ada.

import bcrypt from "bcryptjs";
import { prisma } from "../src/db.js";

const APPLY = process.argv.includes("--apply");

// Password seragam supaya gampang dibagikan saat sesi tes bersama. Ini AKUN
// UJI, bukan akun produksi jangka panjang — begitu orang aslinya masuk,
// rename akunnya (nama + email + password) lewat halaman Pengguna & Peran;
// seluruh jejak audit yang sudah tercatat tetap menempel ke baris User yang
// sama, jadi riwayat tes tidak hilang.
const PASSWORD_UJI = "sanotest1";

// Satu akun per PERAN, bukan satu akun serba-bisa. Tujuannya supaya hasil tes
// bisa menjawab pertanyaan "apakah pembagian perannya masuk akal?" — bukan
// cuma "apakah tombolnya jalan?". Kalau satu orang memegang semua peran,
// batas antar peran tidak pernah benar-benar teruji.
const AKUN_UJI = [
  { email: "bengkel@klinikmatras.com",    name: "Uji — Bengkel (Produksi)",  roles: ["PRODUCTION_LEAD", "PRODUCTION_WORKER"] },
  { email: "qc@klinikmatras.com",         name: "Uji — QC",                  roles: ["QC_LEAD"] },
  { email: "gudang@klinikmatras.com",     name: "Uji — Gudang",              roles: ["WAREHOUSE"] },
  { email: "dispatcher@klinikmatras.com", name: "Uji — Dispatcher (Armada)", roles: ["DISPATCHER"] },
  { email: "driver@klinikmatras.com",     name: "Uji — Driver",              roles: ["DRIVER"] },
  { email: "finance@klinikmatras.com",    name: "Uji — Finance",             roles: ["FINANCE"] },
];

// Katalog material awal — disusun dari struktur kasur di CLAUDE.md §16.4
// (fondasi → lapisan penahan → comfort layer → kain), BUKAN daftar karangan.
// Angka density mengikuti standar yang tertulis di sana: busa standar min 26,
// Rebonded min 50, Latex min 80.
//
// `reorderPoint`/`reorderQty` SENGAJA dikosongkan (null = alert mati). Sesuai
// catatan di schema.prisma: angka itu diisi MANUAL oleh gudang dari pengalaman
// nyata, bukan ditebak di awal — menebak berarti memasang alert yang salah
// sejak hari pertama.
const MATERIAL_AWAL = [
  // ── Fondasi / support system ──
  { code: "SPR-POCKET-STD",   name: "Pocket Spring (per dibungkus satuan)", unit: "PCS",   category: "RAW_MATERIAL", serviceLine: null },
  { code: "SPR-BONNEL-STD",   name: "Bonnel Spring (per sambung)",          unit: "PCS",   category: "RAW_MATERIAL", serviceLine: null },
  { code: "FOAM-HD-D26",      name: "Busa HD Density 26",                   unit: "M3",    category: "RAW_MATERIAL", serviceLine: null },
  { code: "FOAM-REBOND-D50",  name: "Busa Rebonded Density 50",             unit: "M3",    category: "RAW_MATERIAL", serviceLine: null },
  { code: "FOAM-LATEX-D80",   name: "Latex Density 80",                     unit: "M3",    category: "RAW_MATERIAL", serviceLine: null },
  { code: "PE-ENCASEMENT",    name: "PE Encasement (penguat pinggiran)",    unit: "SHEET", category: "RAW_MATERIAL", serviceLine: null },

  // ── Lapisan penahan (pelindung busa dari per) ──
  { code: "PAD-HARDPAD",      name: "Hard Pad",                             unit: "SHEET", category: "RAW_MATERIAL", serviceLine: null },
  { code: "PAD-COTTONSHEET",  name: "Cotton Sheet",                         unit: "METER", category: "RAW_MATERIAL", serviceLine: null },
  { code: "PAD-COCONUT",      name: "Serabut Kelapa",                       unit: "SHEET", category: "RAW_MATERIAL", serviceLine: null },

  // ── Kain / fabric system ──
  { code: "FAB-KNIT-QUILT",   name: "Kain Knitting Quilting",               unit: "METER", category: "RAW_MATERIAL", serviceLine: null },
  { code: "FAB-BORDER",       name: "Kain Border (samping kasur)",          unit: "METER", category: "RAW_MATERIAL", serviceLine: null },

  // ── Pendukung produksi ──
  { code: "ADH-GLUE",         name: "Lem Busa",                             unit: "KG",    category: "RAW_MATERIAL", serviceLine: null },
  { code: "THR-SPOOL",        name: "Benang Jahit",                         unit: "SPOOL", category: "RAW_MATERIAL", serviceLine: null },
  { code: "ZIP-HEAVY",        name: "Resleting Kasur",                      unit: "METER", category: "RAW_MATERIAL", serviceLine: null },
  { code: "PKG-PLASTIC",      name: "Plastik Packaging Kasur",              unit: "METER", category: "CONSUMABLE",   serviceLine: null },
];

// Kendaraan awal. capacitySlots = SLOT, bukan jumlah kasur — king & single
// makan ruang beda di bak yang sama (lihat catatan di model Vehicle).
// Plat ini PLACEHOLDER yang jelas-jelas menandai dirinya sebagai data uji,
// supaya tidak pernah tertukar dengan armada sungguhan. Ganti lewat
// Armada > Sumber Daya begitu kendaraan aslinya didaftarkan.
const KENDARAAN_AWAL = [
  { plateNumber: "B 0000 UJI", type: "Mobil Box", capacitySlots: 6, notes: "Kendaraan UJI COBA — ganti dengan armada asli sebelum operasional nyata" },
];

async function main() {
  console.log(`\n=== seed-operasional.js — mode: ${APPLY ? "APPLY (menulis data)" : "DRY-RUN (tidak menulis apa pun)"} ===\n`);

  // ── 1. Akun uji per peran ────────────────────────────────────────────────
  console.log("── AKUN UJI PER PERAN ──");
  const rencanaAkun = [];
  for (const akun of AKUN_UJI) {
    const ada = await prisma.user.findUnique({
      where: { email: akun.email },
      select: { id: true, name: true, active: true },
    });
    const roleAda = ada
      ? (await prisma.userRole.findMany({ where: { userId: ada.id }, select: { role: true } })).map((r) => r.role)
      : [];
    const roleKurang = akun.roles.filter((r) => !roleAda.includes(r));
    rencanaAkun.push({ ...akun, sudahAda: !!ada, id: ada?.id, roleKurang });
    const status = !ada ? "BUAT BARU" : roleKurang.length ? `sudah ada, tambah role: ${roleKurang.join(", ")}` : "sudah lengkap";
    console.log(`  ${akun.email.padEnd(30)} ${akun.roles.join("+").padEnd(36)} → ${status}`);
  }

  // ── 2. Material ──────────────────────────────────────────────────────────
  const kodeAda = new Set((await prisma.material.findMany({ select: { code: true } })).map((m) => m.code));
  const materialBaru = MATERIAL_AWAL.filter((m) => !kodeAda.has(m.code));
  console.log(`\n── MATERIAL ──`);
  console.log(`  Sudah ada di katalog : ${kodeAda.size}`);
  console.log(`  Akan ditambahkan     : ${materialBaru.length}`);
  materialBaru.forEach((m) => console.log(`    + ${m.code.padEnd(20)} ${m.name} (${m.unit})`));

  // ── 3. Kendaraan ─────────────────────────────────────────────────────────
  const platAda = new Set((await prisma.vehicle.findMany({ select: { plateNumber: true } })).map((v) => v.plateNumber));
  const kendaraanBaru = KENDARAAN_AWAL.filter((v) => !platAda.has(v.plateNumber));
  console.log(`\n── KENDARAAN ──`);
  console.log(`  Sudah ada        : ${platAda.size}`);
  console.log(`  Akan ditambahkan : ${kendaraanBaru.length}`);
  kendaraanBaru.forEach((v) => console.log(`    + ${v.plateNumber} — ${v.type}, ${v.capacitySlots} slot`));

  // ── 4. Gudang (sudah ada dari migrasi, cuma dilaporkan) ──────────────────
  const gudang = await prisma.warehouse.findMany({ select: { code: true, name: true } });
  console.log(`\n── GUDANG ──`);
  gudang.forEach((w) => console.log(`  ✓ ${w.code} — ${w.name}`));
  if (gudang.length === 0) console.log("  ⚠️  BELUM ADA gudang — modul Gudang tidak bisa jalan tanpa ini.");

  if (!APPLY) {
    console.log(`\n(DRY-RUN — tidak ada yang ditulis. Jalankan ulang dengan --apply untuk menerapkan.)\n`);
    await prisma.$disconnect();
    return;
  }

  // ── APPLY ────────────────────────────────────────────────────────────────
  console.log(`\n=== MENERAPKAN ===`);
  const passwordHash = await bcrypt.hash(PASSWORD_UJI, 10);
  let akunDibuat = 0, roleDiberi = 0;

  for (const akun of rencanaAkun) {
    let userId = akun.id;
    if (!akun.sudahAda) {
      // `role` legacy diisi dengan role PERTAMA — kolom itu masih dipakai
      // sebagai fallback oleh rolesOf() untuk token lama (lihat authorize.js).
      // Sumber kebenaran sebenarnya tetap tabel user_roles di bawah.
      const dibuat = await prisma.user.create({
        data: { name: akun.name, email: akun.email, passwordHash, role: akun.roles[0], active: true },
        select: { id: true },
      });
      userId = dibuat.id;
      akunDibuat += 1;
    }
    for (const role of akun.roleKurang.length ? akun.roleKurang : akun.roles) {
      await prisma.userRole.upsert({
        where: { userId_role: { userId, role } },
        create: { userId, role },
        update: {},
      });
      roleDiberi += 1;
    }
  }

  const hasilMaterial = materialBaru.length
    ? await prisma.material.createMany({ data: materialBaru, skipDuplicates: true })
    : { count: 0 };

  const hasilKendaraan = kendaraanBaru.length
    ? await prisma.vehicle.createMany({ data: kendaraanBaru, skipDuplicates: true })
    : { count: 0 };

  console.log(`  Akun dibuat       : ${akunDibuat}`);
  console.log(`  Role diberikan    : ${roleDiberi}`);
  console.log(`  Material dibuat   : ${hasilMaterial.count}`);
  console.log(`  Kendaraan dibuat  : ${hasilKendaraan.count}`);
  console.log(`\n  Password semua akun uji: ${PASSWORD_UJI}`);
  console.log(`  ⚠️  GANTI password (atau nonaktifkan akunnya) sebelum sistem dipakai operasional nyata.\n`);

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
