// Memasang SATU akun bawaan untuk modul Penjualan Karyawan: 4-1250 "Pendapatan Penjualan Karyawan" (systemKey PENDAPATAN_PENJUALAN_KARYAWAN).
// Sengaja TIDAK memakai "Pasang Akun Bawaan" (ensureDefaultChartOfAccounts): itu memasang SEMUA akun & kategori bawaan yang belum ada, bukan hanya akun ini.
// DEFAULT = DRY-RUN (hanya membaca). Idempoten: akun yang sudah ada tidak diubah (nama/deskripsi bisa sudah disesuaikan admin).
//   docker compose exec -T backend node scripts/pasang-akun-penjualan-karyawan.js [--apply]
import { prisma } from "../src/db.js";
import { DEFAULT_COA, SYSTEM_KEYS } from "../src/services/finance/accounts.js";

const apply = process.argv.includes("--apply");
const KODE = "4-1250";

try {
  const def = DEFAULT_COA.find((a) => a.code === KODE);
  if (!def || def.systemKey !== SYSTEM_KEYS.PENDAPATAN_PENJUALAN_KARYAWAN) throw new Error(`Definisi ${KODE} tidak ada di DEFAULT_COA`);
  const ada = await prisma.finAccount.findUnique({ where: { code: KODE }, select: { id: true, name: true, systemKey: true } });
  const induk = await prisma.finAccount.findUnique({ where: { code: def.parent }, select: { id: true, name: true } });
  const dipakai = await prisma.finAccount.findFirst({ where: { systemKey: def.systemKey, NOT: { code: KODE } }, select: { code: true } });
  if (!induk) throw new Error(`Akun induk ${def.parent} tidak ditemukan — bagan akun belum terpasang?`);
  if (dipakai) throw new Error(`systemKey ${def.systemKey} sudah dipakai akun ${dipakai.code}`);

  if (ada) {
    console.log(`${KODE} sudah ada (${ada.name}, systemKey=${ada.systemKey ?? "kosong"}).`);
    if (ada.systemKey == null) {
      console.log(apply ? "Mengisi systemKey…" : "DRY-RUN: systemKey kosong akan diisi (tambahkan --apply).");
      if (apply) await prisma.finAccount.update({ where: { id: ada.id }, data: { systemKey: def.systemKey } });
    } else console.log("Tidak ada yang perlu dilakukan.");
  } else {
    console.log(`${apply ? "MEMASANG" : "DRY-RUN: akan memasang"} ${KODE} ${def.name} (${def.type}, saldo normal ${def.normalBalance}) di bawah ${def.parent} ${induk.name}.`);
    if (apply) {
      await prisma.finAccount.create({
        data: { code: def.code, name: def.name, type: def.type, normalBalance: def.normalBalance, parentId: induk.id, isPostable: def.isPostable !== false, systemKey: def.systemKey, cashFlowCategory: def.cashFlowCategory || null, description: def.description || null },
      });
      console.log("SELESAI");
    } else console.log("Tidak ada yang ditulis (tambahkan --apply).");
  }
} catch (e) { console.error("GAGAL:", e.message); process.exitCode = 1; } finally { await prisma.$disconnect(); }
