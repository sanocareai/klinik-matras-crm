// JENDELA OPNAME — pembatasan operasional jalur cepat stok selama hitung fisik (Okt 2026).
//
// Jalur cepat (POST /inventory/movements/receipt|issue|return|waste) menulis ledger TANPA dokumen dan TANPA orang kedua. Selama jendela hitung fisik jalur ini
// ditutup supaya pergerakan hanya terjadi lewat dokumen resmi (GR, Material Issue, Transfer, Retur, Stock Adjustment/Count) yang punya nomor dan pelaku.
//
// Aktivasi = satu baris fin_settings (key "inventory_opname_window", value JSON) yang ditulis Tech atas persetujuan Owner. TANPA baris itu — atau di luar
// [mulai, selesai] — fungsi ini TIDAK berbuat apa pun: transaksi harian tidak berubah. Dokumen resmi tidak pernah diblokir oleh jendela ini.
//   value: {"mulai":"2026-10-31T01:00:00Z","selesai":"2026-10-31T16:59:00Z","catatan":"Opname fisik 31 Okt"}
export const KUNCI_JENDELA_OPNAME = "inventory_opname_window";

export class JendelaOpnameError extends Error {
  constructor(message, jendela) { super(message); this.statusCode = 409; this.code = "JENDELA_OPNAME_AKTIF"; this.jendela = jendela; }
}

/** Parse nilai pengaturan; null bila kosong/tidak valid (gagal-buka: pengaturan rusak tidak boleh menghentikan Gudang). */
export function parseJendela(raw) {
  if (!raw) return null;
  try {
    const j = typeof raw === "string" ? JSON.parse(raw) : raw;
    const mulai = new Date(j.mulai), selesai = new Date(j.selesai);
    if (Number.isNaN(+mulai) || Number.isNaN(+selesai) || selesai <= mulai) return null;
    return { mulai, selesai, catatan: typeof j.catatan === "string" ? j.catatan : "" };
  } catch { return null; }
}

export async function ambilJendelaOpname(db) {
  const row = await db.finSetting.findUnique({ where: { key: KUNCI_JENDELA_OPNAME }, select: { value: true } });
  return parseJendela(row?.value);
}

/** Lempar JendelaOpnameError bila `sekarang` berada di dalam jendela yang diatur. */
export async function tolakBilaJendelaOpname(db, aksi, sekarang = new Date()) {
  const j = await ambilJendelaOpname(db);
  if (!j || sekarang < j.mulai || sekarang > j.selesai) return null;
  throw new JendelaOpnameError(
    `Jendela opname fisik sedang berjalan (${j.mulai.toISOString()} s.d. ${j.selesai.toISOString()}): ${aksi} langsung ditutup. Gunakan dokumen resmi (Penerimaan Barang, Pengeluaran Material, Transfer, Retur) agar pergerakan tercatat dan tidak mengganggu hitungan.${j.catatan ? " " + j.catatan : ""}`,
    j,
  );
}
