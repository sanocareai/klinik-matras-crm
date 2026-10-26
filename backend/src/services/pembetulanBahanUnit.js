// PEMBETULAN BAHAN PER ORDER dari drawer Order Produksi — HANYA unit yang sudah TERKIRIM (DELIVERED) (Okt 2026). Unit dibatalkan TIDAK termasuk: perilaku lamanya tidak diperluas.
// File ini TIDAK menulis apa pun. Ia (1) menjaga aturan pembetulan unit terkirim: alasan wajib, TANGGAL PEMAKAIAN YANG DILAPORKAN wajib (terpisah dari waktu pencatatan), saldo yang dilihat harus masih sama,
// dan konfirmasi eksplisit bila ada pengeluaran yang MUNGKIN SUDAH TERCATAT; (2) menghitung PRATINJAU dampak sebelum konfirmasi lewat layanan resmi yang SUDAH ada:
//   • tambah / kurangi pengeluaran stok  -> POST /api/units/:id/materials (postStockMovement + bukukanNilaiPergerakanBaru; pengurangan = pengembalian BARU, baris asal tetap)
//   • catat pemakaian sementara (TANPA stok) -> POST /api/production/units/:id/provisional-usages
//   • catat komponen lama (TANPA stok)       -> POST /api/production/units/:id/komponen-lama
//   • koreksi jumlah (butuh persetujuan)     -> POST /api/production/units/:id/koreksi-pemakaian (penyetuju ≠ pemohon)
//   • koreksi catatan belum diposting        -> POST /api/production/catatan-historis/:id/koreksi (tanpa stok)
// PRINSIP WAKTU: waktu pencatatan = saat konfirmasi (server). Tanggal pemakaian = yang DILAPORKAN pengguna (disimpan terpisah, tidak menggantikan waktu pencatatan).
// KEPUTUSAN OWNER: dasar Harga Berlaku HPP operasional = TANGGAL PEMAKAIAN YANG DILAPORKAN (aturan batas di finance/hargaBerlaku.js: harga pada awal hari itu); belum ada harga pada tanggal itu = TANPA_HARGA (tidak pernah
// memakai harga hari pencatatan); retur bertaut mengikuti harga ISSUE asal. Tanggal jurnal Finance TETAP mengikuti layanan resmi (hari pencatatan). Pratinjau memakai FUNGSI YANG SAMA dengan pembekuan hasil tersimpan.
// PRINSIP GANDA: sistem hanya MENAMPILKAN pengeluaran yang sudah tertaut ke unit dan yang mungkin relevan; tidak pernah menyamakan atau menautkan otomatis tanpa bukti.
import { computeStockSnapshot, lockMaterialBalance } from "./inventoryLedger.js";
import { dasarHargaRataRata } from "./finance/posting/inventory.js";
import { statusCutoverUntuk } from "./finance/persediaanAwal.js";
import { hargaUntukPergerakan, penyelesaiHargaBerlaku, hargaBerubahPadaHari, batasHargaTanggal, teksDasarHarga } from "./finance/hargaBerlaku.js";
import { hasPermission } from "../middleware/authorize.js";
import { PERMISSIONS as P } from "../constants/permissions.js";

export class PembetulanError extends Error {
  constructor(message, statusCode = 400, code = null, detail = null) { super(message); this.statusCode = statusCode; this.code = code; this.detail = detail; }
}
const wajib = (c, m, code, status = 400, detail = null) => { if (!c) throw new PembetulanError(m, status, code, detail); };
const r4 = (v) => Math.round(Number(v ?? 0) * 10000) / 10000;
const EPS = 1e-6;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const rp = (n) => `Rp${Math.round(Number(n)).toLocaleString("id-ID")}`;
const HARI = 24 * 3600 * 1000;
const wibTgl = (d) => new Date(new Date(d).getTime() + 7 * 3600_000).toISOString().slice(0, 10);

/** Pembetulan hanya untuk unit TERKIRIM. Unit dibatalkan sengaja tidak diperluas. */
export const unitSelesai = (status) => status === "DELIVERED";
export const JENIS_PRATINJAU = Object.freeze(["TAMBAH", "KURANGI", "CATATAN_SEMENTARA", "KOMPONEN_LAMA"]);

/** Alasan pembetulan WAJIB (5–500 karakter) hanya untuk unit TERKIRIM. Unit lain: perilaku lama (alasan opsional, '' bila kosong). */
export function alasanPembetulan(unitStatus, alasan) {
  const t = String(alasan ?? "").trim();
  if (unitSelesai(unitStatus)) wajib(t.length >= 5 && t.length <= 500, "Unit ini sudah terkirim. Pembetulan bahan wajib disertai alasan (5–500 karakter) agar riwayatnya jelas.", "UNIT_ALASAN_PEMBETULAN_WAJIB", 400);
  return unitSelesai(unitStatus) ? t : t.slice(0, 500);
}

/**
 * Tanggal pemakaian yang DILAPORKAN (YYYY-MM-DD, tanggal kalender WIB) — wajib untuk pembetulan unit terkirim. Bukan waktu konfirmasi.
 * Tidak boleh di masa depan dan tidak boleh sebelum unit dibuat. terlambatHari = selisih hari kalender antara tanggal dilaporkan dan hari pencatatan.
 */
export function tanggalDilaporkan(raw, { unitDibuat, sekarang = new Date() } = {}) {
  const t = String(raw ?? "").trim();
  wajib(t !== "", "Tanggal pemakaian yang dilaporkan wajib diisi (kapan bahan itu sebenarnya dipakai). Waktu konfirmasi tidak dianggap sebagai waktu pekerjaan.", "UNIT_TANGGAL_PEMAKAIAN_WAJIB");
  wajib(/^\d{4}-\d{2}-\d{2}$/.test(t) && !Number.isNaN(new Date(`${t}T00:00:00Z`).getTime()) && new Date(`${t}T00:00:00Z`).toISOString().slice(0, 10) === t, "Tanggal pemakaian tidak valid (format YYYY-MM-DD).", "UNIT_TANGGAL_PEMAKAIAN_TIDAK_VALID");
  const hariIni = wibTgl(sekarang);
  wajib(t <= hariIni, "Tanggal pemakaian tidak boleh di masa depan.", "UNIT_TANGGAL_PEMAKAIAN_MASA_DEPAN");
  if (unitDibuat) wajib(t >= wibTgl(unitDibuat), `Tanggal pemakaian tidak boleh sebelum unit dibuat (${wibTgl(unitDibuat)}).`, "UNIT_TANGGAL_PEMAKAIAN_SEBELUM_UNIT");
  const terlambatHari = Math.round((new Date(`${hariIni}T00:00:00Z`) - new Date(`${t}T00:00:00Z`)) / HARI);
  return { tanggal: t, terlambatHari, hariPencatatan: hariIni };
}

/** Blok "waktu" pratinjau: tanggal pemakaian DILAPORKAN (unit terkirim) atau dicatat sekarang (unit berjalan, waktuDilaporkan = null). */
export function bangunWaktu(waktuDilaporkan, sekarang = new Date()) {
  if (!waktuDilaporkan) return { pemakaianDilaporkan: null, dicatatPada: sekarang.toISOString(), terlambatHari: 0, teks: "Unit masih berjalan: perubahan dicatat saat Anda menyimpan; harga HPP operasional dan tanggal jurnal Finance mengikuti waktu pencatatan.", dasarHargaOperasional: "WAKTU_PENCATATAN", dasarJurnalFinance: "WAKTU_PENCATATAN" };
  return {
    pemakaianDilaporkan: waktuDilaporkan.tanggal, dicatatPada: sekarang.toISOString(), terlambatHari: waktuDilaporkan.terlambatHari,
    teks: `Tanggal pemakaian yang Anda laporkan: ${waktuDilaporkan.tanggal}${waktuDilaporkan.terlambatHari > 0 ? ` (${waktuDilaporkan.terlambatHari} hari sebelum hari pencatatan)` : " (hari ini)"}. Waktu pencatatan sistem: saat Anda mengonfirmasi. Keduanya disimpan terpisah; waktu konfirmasi BUKAN waktu pekerjaan. Harga HPP operasional mengikuti tanggal pemakaian yang dilaporkan; tanggal jurnal Finance mengikuti hari pencatatan.`,
    dasarHargaOperasional: "TANGGAL_PEMAKAIAN_DILAPORKAN", dasarJurnalFinance: "WAKTU_PENCATATAN",
  };
}
/** Catatan baku pembetulan (dipakai pergerakan stok, pemakaian sementara, komponen lama): "Pembetulan unit terkirim (kode) [dilaporkan YYYY-MM-DD]: alasan | catatan". */
export function catatanPembetulan(unitCode, alasan, tanggal, catatan = null) {
  return [`Pembetulan unit terkirim (${unitCode}) [dilaporkan ${tanggal}]: ${alasan}`, catatan].filter(Boolean).join(" | ").slice(0, 500);
}
/** Urai catatan baku -> tanggal pemakaian yang dilaporkan (atau null). Dipakai tampilan order agar waktu pencatatan dan tanggal dilaporkan tampil terpisah. */
export function uraiCatatanPembetulan(note) {
  const s = String(note ?? ""); const m = /^Pembetulan unit terkirim \((.+?)\) \[dilaporkan (\d{4}-\d{2}-\d{2})\]: /.exec(s);
  if (m) return { unitCode: m[1], dilaporkan: m[2] };
  const k = /^Koreksi pemakaian \S+ \[dilaporkan (\d{4}-\d{2}-\d{2})\] atas (\S+)/.exec(s); // koreksi berpersetujuan yang disetujui
  return k ? { unitCode: k[2], dilaporkan: k[1] } : null;
}

/**
 * HPP operasional sebuah pembetulan: memakai hargaUntukPergerakan — fungsi yang SAMA yang membekukan hasil tersimpan (catatBiayaOperasional) — pada pergerakan semu dengan catatan baku yang sama,
 * sehingga pratinjau, hasil tersimpan, Riwayat, dan Excel tidak mungkin berbeda dasar. `sidik` mengikat tanggal + harga + dasar; server membandingkannya saat konfirmasi (UNIT_DASAR_HARGA_BERGESER).
 */
export async function hppPembetulan(db, { unit, materialId, bahan, jenis, qty, tanggal = null, sekarang = new Date() }) {
  // tanggal = null: unit masih BERJALAN (perubahan pemakaian biasa) → harga berlaku saat pencatatan, seperti pencatatan pemakaian aktif yang sudah live; tidak ada tanggal dilaporkan.
  const type = jenis === "TAMBAH" ? "ISSUE" : "RETURN";
  const r = await hargaUntukPergerakan(db, { id: null, type, materialId, unitId: unit.id, createdAt: sekarang, correctsMovementId: null, note: tanggal ? catatanPembetulan(unit.unitCode, "pratinjau", tanggal) : null }, penyelesaiHargaBerlaku(db));
  const batas = tanggal ? batasHargaTanggal(tanggal) : null; const berubah = tanggal ? await hargaBerubahPadaHari(db, materialId, tanggal) : [];
  const dasar = tanggal ? { tanggalDasar: tanggal, batasHarga: batas.toISOString(), aturan: "Harga yang berlaku pada AWAL tanggal pemakaian (00:00 WIB). Harga hari pencatatan tidak dipakai.", dicatatPada: sekarang.toISOString() }
    : { tanggalDasar: null, batasHarga: null, aturan: "Unit masih berjalan: harga yang berlaku saat pencatatan.", dicatatPada: sekarang.toISOString() };
  const peringatan = berubah.length ? `PERHATIAN: harga bahan ini berubah pada ${tanggal} (${berubah.map((x) => `${rp(x.harga)} mulai ${new Date(new Date(x.mulai).getTime() + 7 * 3600_000).toISOString().slice(11, 16)} WIB`).join("; ")}). Harga yang dipakai adalah harga pada awal hari itu; perubahan di tengah hari tidak dipakai.` : null;
  const arah = jenis === "TAMBAH" ? "bertambah" : "berkurang";
  const sidik = [tanggal ?? "SEKARANG", r.ada ? r.harga.toString() : "TANPA", r.priceId ?? "-", r.basis].join("|");
  const dasarTeks = teksDasarHarga(r.basis, tanggal);
  if (r.ada) {
    const harga = Number(r.harga);
    return { dibekukan: true, status: "DINILAI", harga, label: r.label, nilai: Math.round(qty * harga), basis: r.basis, dasarTeks, ...dasar, hargaMulaiBerlaku: r.priceEffectiveFrom ?? null, peringatan, sidik,
      teks: `HPP operasional order ini ${arah} ${rp(qty * harga)} (${qty} ${bahan.unit} × ${rp(harga)}). Dasar: ${dasarTeks}.${r.basis === "HARGA_ISSUE_ASAL" ? " Retur mengikuti harga pengeluaran asal, bukan harga tanggal pemakaian atau hari pencatatan." : tanggal ? " Harga hari pencatatan TIDAK dipakai." : ""}${peringatan ? ` ${peringatan}` : ""}` };
  }
  const sebab = r.gap === "ISSUE_ASAL_BELUM_BERHARGA" ? "Pengeluaran asal yang dikembalikan belum punya harga operasional, jadi retur ini juga tanpa harga (tidak memakai harga baru)." : tanggal ? `Belum ada Harga Berlaku untuk bahan ini pada tanggal pemakaian ${tanggal}.` : "Belum ada Harga Berlaku untuk bahan ini saat ini.";
  return { dibekukan: false, status: "TANPA_HARGA", harga: null, label: null, nilai: null, basis: r.basis, dasarTeks, ...dasar, hargaMulaiBerlaku: null, peringatan, sidik,
    teks: `TANPA_HARGA / belum diketahui. ${sebab} Pembetulan dibekukan TANPA harga operasional (bukan Rp0${tanggal ? ", dan bukan harga hari pencatatan" : ""}); HPP operasional order tidak berubah.${peringatan ? ` ${peringatan}` : ""}` };
}

const TANDA_PERHATIAN ="Sistem TIDAK menyamakan atau menautkan otomatis. Periksa daftar ini; hanya Anda yang tahu apakah sebuah catatan itu pemakaian yang sama.";
/**
 * Pengeluaran yang SUDAH tertaut ke unit untuk bahan ini + transaksi lain yang MUNGKIN relevan (belum tertaut ke unit ini). Baca-saja. Tidak ada penautan.
 * Kandidat: (a) pengeluaran bahan sama tanpa unit, ±7 hari dari tanggal dilaporkan; (b) pengeluaran bahan sama jumlah sama pada unit lain ±3 hari (kemungkinan salah unit);
 * (c) Material Issue unit ini yang belum final; (d) catatan pemakaian historis unit/order ini; (e) pemakaian sementara unit ini. Tiap kandidat membawa alasan kemiripan.
 */
export async function sudahTercatatUntuk(db, { unitId, materialId, qty = null, tanggal = null, orderId = null }) {
  const pusat = tanggal ? new Date(`${tanggal}T05:00:00Z`) : null; // 12:00 WIB tanggal dilaporkan
  const dari7 = pusat ? new Date(pusat.getTime() - 7 * HARI) : null; const ke7 = pusat ? new Date(pusat.getTime() + 7 * HARI) : null;
  const dari3 = pusat ? new Date(pusat.getTime() - 3 * HARI) : null; const ke3 = pusat ? new Date(pusat.getTime() + 3 * HARI) : null;
  const tertautRows = await db.stockMovement.findMany({ where: { unitId, materialId, type: { in: ["ISSUE", "RETURN", "WASTE"] } }, orderBy: { createdAt: "desc" }, take: 20,
    select: { id: true, type: true, qty: true, createdAt: true, note: true, reason: true, materialIssue: { select: { issueNumber: true } }, createdBy: { select: { name: true } } } });
  const tertaut = tertautRows.map((m) => ({ kind: "PENGELUARAN_TERTAUT_UNIT", id: m.id, tipe: m.type, qty: Math.abs(Number(m.qty)), dicatatPada: m.createdAt, dilaporkan: uraiCatatanPembetulan(m.note)?.dilaporkan ?? null,
    dokumen: m.materialIssue?.issueNumber ?? null, oleh: m.createdBy?.name ?? null, catatan: m.note ?? m.reason ?? null, alasan: ["Sudah tertaut ke unit ini"] }));
  const kemungkinan = [];
  const dekat = (a, b) => b != null && Math.abs(Number(a) - Number(b)) < 0.0005;
  const lepas = await db.stockMovement.findMany({ where: { materialId, type: { in: ["ISSUE", "WASTE"] }, unitId: null, ...(dari7 ? { createdAt: { gte: dari7, lte: ke7 } } : {}) }, orderBy: { createdAt: "desc" }, take: 10,
    select: { id: true, type: true, qty: true, createdAt: true, note: true, reason: true, createdBy: { select: { name: true } } } });
  for (const m of lepas) kemungkinan.push({ kind: "PENGELUARAN_TANPA_UNIT", id: m.id, tipe: m.type, qty: Math.abs(Number(m.qty)), dicatatPada: m.createdAt, oleh: m.createdBy?.name ?? null, catatan: m.note ?? m.reason ?? null,
    alasan: ["Bahan sama", "Tidak tertaut ke unit mana pun", ...(pusat ? ["Dicatat dalam ±7 hari dari tanggal dilaporkan"] : []), ...(dekat(Math.abs(Number(m.qty)), qty) ? ["Jumlah sama persis"] : [])] });
  if (qty != null && pusat) {
    const lain = await db.stockMovement.findMany({ where: { materialId, type: { in: ["ISSUE", "WASTE"] }, unitId: { not: unitId }, createdAt: { gte: dari3, lte: ke3 } }, orderBy: { createdAt: "desc" }, take: 40,
      select: { id: true, type: true, qty: true, createdAt: true, note: true, unit: { select: { unitCode: true } }, createdBy: { select: { name: true } } } });
    for (const m of lain.filter((x) => x.unit && dekat(Math.abs(Number(x.qty)), qty)).slice(0, 5)) kemungkinan.push({ kind: "PENGELUARAN_UNIT_LAIN", id: m.id, tipe: m.type, qty: Math.abs(Number(m.qty)), dicatatPada: m.createdAt, oleh: m.createdBy?.name ?? null, catatan: m.note ?? null, unit: m.unit.unitCode,
      alasan: ["Bahan dan jumlah sama persis", `Tercatat pada unit lain (${m.unit.unitCode})`, "Dicatat dalam ±3 hari dari tanggal dilaporkan"] });
  }
  const mi = await db.$queryRawUnsafe(`select mi.id::text id, mi.issue_number nomor, mi.status::text status, l.requested_qty::float qty from material_issue_lines l join material_issues mi on mi.id = l.material_issue_id
      where mi.unit_id = $1::uuid and l.material_id = $2::uuid and mi.status::text in ('DRAFT','WAITING_APPROVAL','APPROVED','READY_TO_PICK','PICKED') order by mi.created_at desc limit 5`, unitId, materialId);
  for (const x of mi) kemungkinan.push({ kind: "MATERIAL_ISSUE_BELUM_FINAL", id: x.id, nomor: x.nomor, status: x.status, qty: x.qty, catatan: `Dokumen ${x.nomor} (${x.status}) untuk unit ini belum mengeluarkan stok — akan mengeluarkan stok saat selesai`, alasan: ["Bahan sama", "Dokumen Material Issue unit ini belum final", ...(dekat(x.qty, qty) ? ["Jumlah sama persis"] : [])] });
  const notes = await db.$queryRawUnsafe(`select n.id::text id, n.state, n.qty::float qty, n.uom, n.used_at "usedAt", n.raw_name nama from unit_usage_notes n
      where n.material_id = $2::uuid and (n.unit_id = $1::uuid ${orderId ? "or n.order_id = $3" : ""}) and n.state in ('PERLU_DICEK','SIAP_POSTING','TERCATAT_DI_STOK') order by n.created_at desc limit 5`, ...(orderId ? [unitId, materialId, orderId] : [unitId, materialId]));
  for (const n of notes) kemungkinan.push({ kind: "CATATAN_HISTORIS", id: n.id, status: n.state, qty: n.qty, uom: n.uom, dilaporkan: n.usedAt ? wibTgl(n.usedAt) : null, catatan: `Catatan pemakaian historis (${n.state}) "${n.nama ?? ""}" — bila diposting nanti dapat menjadi pengeluaran stok juga`, alasan: ["Bahan sama", "Catatan historis unit/order ini", ...(dekat(n.qty, qty) ? ["Jumlah sama persis"] : [])] });
  const sem = await db.unitProvisionalUsage.findMany({ where: { unitId, materialId, status: "PERLU_REKONSILIASI" }, orderBy: { usedAt: "desc" }, take: 5, select: { id: true, name: true, qty: true, uom: true, usedAt: true } });
  for (const s of sem) kemungkinan.push({ kind: "PEMAKAIAN_SEMENTARA", id: s.id, qty: Number(s.qty), uom: s.uom, dilaporkan: wibTgl(s.usedAt), catatan: `Pemakaian sementara "${s.name}" menunggu rekonsiliasi Gudang — bisa menjadi pengeluaran stok nanti`, alasan: ["Bahan sama", "Pemakaian sementara unit ini belum direkonsiliasi", ...(dekat(Number(s.qty), qty) ? ["Jumlah sama persis"] : [])] });
  return { tertaut, kemungkinan, ada: tertaut.length + kemungkinan.length > 0, catatan: TANDA_PERHATIAN };
}

const TINDAKAN = Object.freeze({
  TAMBAH: { jenis: "PENGELUARAN_STOK_BARU", menulisStok: true, judul: "Membuat PENGELUARAN STOK BARU", teks: "Bukan sekadar catatan: ini membuat pergerakan stok ISSUE baru yang MENGURANGI stok Gudang dan menambah HPP order." },
  KURANGI: { jenis: "PENGEMBALIAN_STOK_BARU", menulisStok: true, judul: "Membuat PENGEMBALIAN STOK BARU", teks: "Bukan sekadar catatan: ini membuat pergerakan stok RETURN baru yang MENAMBAH stok Gudang dan mengurangi HPP order. Baris asli tidak diubah." },
  CATATAN_SEMENTARA: { jenis: "CATATAN_SAJA", menulisStok: false, judul: "Hanya MENAMBAH CATATAN (pemakaian sementara)", teks: "Stok Gudang, jurnal, dan HPP tidak berubah. Dicatat sebagai fakta pemakaian berstatus 'Perlu rekonsiliasi Gudang' dan tampil di kartu 'Bahan belum ada di katalog', Ringkasan, Riwayat, dan Excel (sheet Pemakaian Sementara)." },
  KOMPONEN_LAMA: { jenis: "CATATAN_SAJA", menulisStok: false, judul: "Hanya MENAMBAH CATATAN (komponen lama)", teks: "Milik pelanggan: bukan stok Gudang, bukan Material Issue, tanpa biaya bahan baru. Tampil di kartu 'Komponen lama dari kasur ini', Ringkasan, dan Riwayat." },
});

/**
 * Pratinjau dampak SATU pembetulan pada unit TERKIRIM. Baca-saja. Menjawab sebelum konfirmasi: jenis tindakan (catatan saja vs pengeluaran/pengembalian stok baru), waktu (tanggal pemakaian dilaporkan vs waktu pencatatan),
 * pengeluaran yang sudah tertaut / mungkin sudah tercatat, stok sebelum/sesudah, pemakaian bersih, nilai & jurnal Finance, HPP operasional, dan penghalang.
 * jenis: TAMBAH (ISSUE baru) | KURANGI (RETURN baru bertaut unit) | CATATAN_SEMENTARA | KOMPONEN_LAMA (dua terakhir: tanpa bahan/stok). qty selalu positif.
 */
export async function pratinjauPembetulan(db, user, { unitId, materialId = null, jenis, qty = null, tanggalPemakaian = null } = {}, { sekarang = new Date() } = {}) {
  wajib(UUID.test(String(unitId ?? "")), "unit tidak valid", "UNIT_TIDAK_VALID");
  wajib(JENIS_PRATINJAU.includes(jenis), `jenis harus salah satu dari ${JENIS_PRATINJAU.join(", ")}`, "JENIS_TIDAK_VALID");
  const unit = await db.unit.findUnique({ where: { id: unitId }, select: { id: true, unitCode: true, status: true, createdAt: true, orderId: true, order: { select: { orderNumber: true, status: true } } } });
  wajib(unit, "Unit tidak ditemukan", "UNIT_TIDAK_ADA", 404);
  wajib(unit.status !== "CANCELLED", "Unit ini dibatalkan. Pembetulan bahan lewat layar ini hanya untuk unit TERKIRIM.", "UNIT_DIBATALKAN", 409);
  wajib(unitSelesai(unit.status), "Pembetulan lewat layar ini hanya untuk unit yang sudah TERKIRIM. Unit yang masih berjalan memakai pencatatan pemakaian biasa.", "UNIT_BELUM_TERKIRIM", 409);
  const waktuDilaporkan = tanggalDilaporkan(tanggalPemakaian, { unitDibuat: unit.createdAt, sekarang });
  const waktu = bangunWaktu(waktuDilaporkan, sekarang);
  const izin = { bolehMencatat: hasPermission(user, P.UNIT_MATERIAL_WRITE), bolehMengajukanKoreksiJumlah: hasPermission(user, P.INVENTORY_WRITE) || hasPermission(user, P.UNIT_MATERIAL_WRITE), penyetujuKoreksi: "Owner atau Finance (orang lain dari pemohon)" };
  const tindakan = TINDAKAN[jenis];
  if (!tindakan.menulisStok) {
    return {
      unit: { id: unit.id, kode: unit.unitCode, status: unit.status, selesai: true, order: unit.order?.orderNumber ?? null }, jenis, tindakan, waktu, alasanWajib: true, izin, boleh: true, penghalang: [],
      stok: null, finance: { hasil: "TIDAK_ADA", teks: "Tidak ada nilai atau jurnal Finance: ini hanya catatan." }, hppOperasional: { dibekukan: false, harga: null, nilai: null, teks: "HPP operasional order tidak berubah." },
      sudahTercatat: { tertaut: [], kemungkinan: [], ada: false, perluKonfirmasi: false, catatan: TANDA_PERHATIAN },
      dampak: [tindakan.teks, "Stok Gudang tidak berubah; tidak ada Material Issue, pergerakan stok, biaya, atau jurnal.", waktu.teks, "Catatan lama tidak diubah; pembetulan menjadi catatan baru dengan alasan di riwayat."],
    };
  }
  wajib(UUID.test(String(materialId ?? "")), "bahan tidak valid", "BAHAN_TIDAK_VALID");
  const q = Number(qty); wajib(Number.isFinite(q) && q > 0 && q <= 1_000_000, "Jumlah harus angka lebih dari 0", "QTY_TIDAK_VALID");
  wajib(Math.abs(r4(q) - q) < 1e-9, "Jumlah maksimum 4 angka di belakang koma", "DESIMAL_BERLEBIH");
  const m = await db.material.findUnique({ where: { id: materialId }, select: { id: true, code: true, name: true, unit: true, active: true } });
  wajib(m, "Bahan tidak ditemukan", "BAHAN_TIDAK_ADA", 404);
  const leg = await legStok(db, { unit, m, jenis, q, tanggal: waktuDilaporkan.tanggal, sekarang, waktu });
  return {
    unit: { id: unit.id, kode: unit.unitCode, status: unit.status, selesai: true, order: unit.order?.orderNumber ?? null },
    bahan: { id: m.id, kode: m.code, nama: m.name, satuan: m.unit }, jenis, qty: r4(q), tindakan, waktu,
    stok: leg.stok, pemakaianBersih: leg.pemakaianBersih,
    finance: leg.finance, hppOperasional: leg.hppOperasional, sudahTercatat: leg.sudahTercatat, dampak: leg.dampak, penghalang: leg.penghalang, boleh: leg.penghalang.length === 0, alasanWajib: true, izin,
  };
}

/**
 * Dampak SATU langkah stok (pengeluaran = TAMBAH, pengembalian = KURANGI) pada satu bahan di satu unit. Baca-saja; dipakai pratinjau pembetulan unit terkirim DAN pratinjau perubahan pemakaian (ubah jumlah / ganti bahan).
 * tanggal = tanggal pemakaian yang DILAPORKAN (unit terkirim) atau null (unit berjalan: dicatat sekarang). ringan = dipakai DI DALAM transaksi penerapan: hanya saldo ledger (tanpa snapshot seluruh gudang). abaikanTertaut: lihat perluKonfirmasi di bawah.
 */
export async function legStok(db, { unit, m, jenis, q, tanggal = null, sekarang = new Date(), waktu = null, ringan = false, abaikanTertaut = false }) {
  const materialId = m.id; const unitId = unit.id; const selesai = unitSelesai(unit.status);
  let saldo; let dipesan = 0;
  if (ringan) { const [{ s }] = await db.$queryRaw`SELECT COALESCE(SUM(qty), 0)::float AS s FROM stock_movements WHERE material_id = ${materialId}::uuid`; saldo = r4(s); }
  else { const snap = (await computeStockSnapshot(db)).find((x) => x.materialId === materialId); saldo = r4(snap?.balance ?? 0); dipesan = r4(snap?.reserved ?? 0); }
  const [{ n }] = await db.$queryRaw`SELECT COUNT(*)::int AS n FROM stock_movements WHERE material_id = ${materialId}::uuid`;
  const net = await db.stockMovement.aggregate({ where: { unitId, materialId, type: { in: ["ISSUE", "RETURN", "WASTE"] } }, _sum: { qty: true } });
  const pemakaianSebelum = r4(-Number(net._sum.qty ?? 0));
  const delta = jenis === "TAMBAH" ? q : -q; // + = pemakaian naik (stok turun)
  const saldoSesudah = r4(saldo - delta); const pemakaianSesudah = r4(pemakaianSebelum + delta);
  const penghalang = [];
  if (!m.active) penghalang.push({ kode: "BAHAN_NONAKTIF", pesan: `Bahan ${m.code} nonaktif.` });
  if (jenis === "KURANGI" && q > pemakaianSebelum + 0.00005) penghalang.push({ kode: "UNIT_KOREKSI_MELEBIHI_PEMAKAIAN", pesan: `Pengembalian ${q} melebihi pemakaian bersih bahan ini pada unit (${Math.max(pemakaianSebelum, 0)} ${m.unit}).` });
  if (jenis === "TAMBAH" && n === 0) penghalang.push({ kode: "STOK_BELUM_DIKETAHUI", pesan: `Bahan ${m.code} belum punya catatan stok sama sekali — pengeluaran ditolak (tidak ada stok yang bisa dikurangi). Gunakan "Catat sementara — stok belum diketahui" (hanya catatan), atau minta Gudang mencatat stok awal/opname.` });
  else if (jenis === "TAMBAH" && saldoSesudah < -EPS) penghalang.push({ kode: "SALDO_KURANG", pesan: `Stok ${m.code} tidak cukup: tersedia ${saldo} ${m.unit}, butuh ${q}.` });
  const cut = await statusCutoverUntuk(db, sekarang);
  const harga = (await dasarHargaRataRata(db, materialId, { asOf: sekarang })).harga; const hargaNum = harga == null ? null : Number(harga);
  const nilai = hargaNum == null ? null : Math.round(q * hargaNum);
  let finance;
  if (cut.status === "tertutup") finance = { hasil: "TIDAK_DIJURNAL", teks: "Tanggal pencatatan sebelum cutover perpetual: nilainya sudah tercakup stok opname, tidak dijurnal lagi." };
  else if (cut.status === "tunggu_pembuka") finance = { hasil: "GAP_PERSEDIAAN_AWAL", teks: "Persediaan awal (stok opname) belum diposting: TIDAK ada jurnal; lahir catatan celah PERSEDIAAN_AWAL_BELUM_DIPOSTING yang tampil di Finance dan dijurnal belakangan oleh Finance." };
  else if (hargaNum == null) finance = { hasil: "GAP_TANPA_HARGA", teks: "Bahan belum punya harga perolehan berbukti: TIDAK ada jurnal (bukan Rp0); lahir catatan celah TANPA_HARGA_PEROLEHAN di Finance." };
  else finance = { hasil: "JURNAL", nilai, hargaDasar: hargaNum, teks: `Jurnal HPP bertanggal HARI PENCATATAN (${wibTgl(sekarang)}${tanggal ? `, bukan tanggal pemakaian ${tanggal}` : ""}) sebesar ${rp(nilai)} (${q} ${m.unit} × ${rp(hargaNum)}): ${jenis === "TAMBAH" ? "beban pokok bahan naik, persediaan turun" : "beban pokok bahan turun, persediaan naik"}.` };
  const hpp = await hppPembetulan(db, { unit, materialId, bahan: m, jenis, qty: q, tanggal, sekarang });
  // Pencegahan pencatatan ganda hanya untuk unit TERKIRIM (pembetulan terlambat); unit berjalan tetap seperti pencatatan pemakaian aktual yang sudah live.
  const sudahTercatat = selesai ? await sudahTercatatUntuk(db, { unitId, materialId, qty: q, tanggal, orderId: unit.orderId }) : { tertaut: [], kemungkinan: [], ada: false, catatan: TANDA_PERHATIAN };
  // abaikanTertaut: perubahan jumlah bahan yang MEMANG sudah tercatat pada unit — pemakaian tertaut itulah yang sedang diubah, jadi hanya transaksi LAIN (tidak tertaut) yang mewajibkan pernyataan pemeriksaan.
  const perluKonfirmasi = selesai && jenis === "TAMBAH" && (abaikanTertaut ? sudahTercatat.kemungkinan.length > 0 : sudahTercatat.ada);
  const dampak = [
    jenis === "TAMBAH" ? TINDAKAN.TAMBAH.teks : TINDAKAN.KURANGI.teks,
    `Stok ${m.code}: ${saldo} → ${saldoSesudah} ${m.unit}${dipesan > 0 ? ` (dipesan ${dipesan}; tersedia ${r4(saldoSesudah - dipesan)})` : ""}.`,
    `Pemakaian bersih bahan pada ${unit.unitCode}: ${pemakaianSebelum} → ${pemakaianSesudah} ${m.unit}.`,
    `Finance: ${finance.teks}`, `HPP operasional: ${hpp.teks}`, ...(waktu ? [waktu.teks] : []),
    "Baris pemakaian yang sudah ada TIDAK diubah atau dihapus; pembetulan menjadi baris BARU di riwayat. Nilai beku pemakaian lama tidak berubah.",
    ...(selesai ? [`Order ${unit.order?.orderNumber ?? ""} sudah terkirim: angka HPP/pemakaian order ini akan berubah sesudah pembetulan.`] : []),
  ];
  if (perluKonfirmasi) dampak.push(`PERHATIAN: ${sudahTercatat.tertaut.length} pengeluaran bahan ini sudah tertaut ke unit dan/atau ${sudahTercatat.kemungkinan.length} transaksi lain mungkin relevan. Periksa dulu agar tidak tercatat dua kali.`);
  return {
    stok: { saldoSebelum: n > 0 ? saldo : null, saldoSesudah, dipesan, belumAdaCatatan: n === 0, saldoDilihat: saldo }, pemakaianBersih: { sebelum: pemakaianSebelum, sesudah: pemakaianSesudah },
    finance, hppOperasional: hpp, sudahTercatat: { ...sudahTercatat, perluKonfirmasi }, dampak, penghalang, saldo,
  };
}

/**
 * Pemeriksaan DI DALAM transaksi POST /units/:id/materials untuk unit TERKIRIM (setelah kunci unit): menegakkan di server apa yang dijanjikan pratinjau.
 *   1. saldo ledger SEKARANG harus sama dengan saldo yang dilihat pengguna di pratinjau (409 UNIT_SALDO_BERGESER) — mencegah menyimpan berdasarkan angka basi,
 *   2. bila ada pengeluaran tertaut / kandidat yang mungkin sudah tercatat, pengeluaran BARU wajib membawa konfirmasiBukanGanda=true (409 UNIT_KEMUNGKINAN_GANDA bila tidak).
 * (alasan + tanggal pemakaian dilaporkan divalidasi pemanggil sebelum transaksi lewat alasanPembetulan / tanggalDilaporkan.)
 */
export async function periksaPembetulanLangsung(tx, { unitId, unitCode, orderId, materialId, rawQty, saldoDilihat, konfirmasiBukanGanda, tanggal, hppSidik }) {
  wajib(saldoDilihat !== undefined && saldoDilihat !== null && Number.isFinite(Number(saldoDilihat)), "Lihat dampak dulu: saldo yang Anda lihat di pratinjau wajib dikirim.", "UNIT_PRATINJAU_WAJIB", 400);
  const saldo = r4(await lockMaterialBalance(tx, materialId));
  wajib(Math.abs(saldo - r4(saldoDilihat)) <= 0.00005, `Saldo bahan sudah bergeser: pratinjau Anda memakai ${r4(saldoDilihat)}, saldo sekarang ${saldo}. Lihat dampak lagi dari saldo terbaru; tidak ada yang tersimpan.`, "UNIT_SALDO_BERGESER", 409, { saldoDilihat: r4(saldoDilihat), saldoSekarang: saldo });
  // Dasar harga HPP operasional yang dilihat di pratinjau harus sama dengan yang akan dibekukan (tanggal dilaporkan + harga + dasar). Tanggal diubah setelah pratinjau, atau harga bergeser → ditolak, tidak ada yang tersimpan.
  wajib(typeof hppSidik === "string" && hppSidik !== "", "Lihat dampak dulu: dasar harga HPP operasional dari pratinjau wajib dikirim.", "UNIT_PRATINJAU_WAJIB", 400);
  const bahan = await tx.material.findUnique({ where: { id: materialId }, select: { unit: true } });
  const hppSekarang = await hppPembetulan(tx, { unit: { id: unitId, unitCode }, materialId, bahan, jenis: rawQty > 0 ? "TAMBAH" : "KURANGI", qty: Math.abs(rawQty), tanggal, sekarang: new Date() });
  wajib(hppSekarang.sidik === hppSidik, `Dasar harga HPP operasional berbeda dari pratinjau Anda (tanggal pemakaian atau harga berubah). Lihat dampak lagi; tidak ada yang tersimpan.`, "UNIT_DASAR_HARGA_BERGESER", 409, { dilihat: hppSidik, sekarang: hppSekarang.sidik });
  if (rawQty > 0) {
    const s = await sudahTercatatUntuk(tx, { unitId, materialId, qty: rawQty, tanggal, orderId });
    wajib(!s.ada || konfirmasiBukanGanda === true, `Ada ${s.tertaut.length} pengeluaran bahan ini yang sudah tertaut ke unit dan ${s.kemungkinan.length} transaksi yang mungkin sudah mencatat pemakaian yang sama. Periksa daftarnya, lalu konfirmasi bahwa ini pengeluaran BARU.`, "UNIT_KEMUNGKINAN_GANDA", 409, { tertaut: s.tertaut.length, kemungkinan: s.kemungkinan.length });
  }
  return { saldo };
}
