// POSTING & PEMBALIKAN dokumen stok resmi (TERKUNCI: sakelar stok_resmi_posting_aktif DEFAULT MATI + tanggal mulai wajib). TIDAK dipanggil oleh pintu Gudang manapun — hanya oleh
// endpoint Finance eksplisit (routes/finance.js). Memakai bukukanPergerakan (posting/inventory.js) = mesin yang SAMA dengan Material Issue: satu jurnal per dokumen, nilai dari bukti harga,
// gap TANPA_HARGA (bukan Rp0), cutover (tertutup/tunggu_pembuka), idempoten lewat kunci jurnal.
//
// ATOMIK: seluruhnya di dalam transaksi pemanggil — jurnal, pencatatan/penyelesaian gap, dan aktivitas lahir bersama atau tidak sama sekali (galat jurnal/periode tertutup → rollback).
// PARALEL: advisory lock per dokumen + kunci baris dokumen; permintaan kedua melihat jurnal pertama dan mengembalikan hasil yang sama (dibuat:false).
// PEMBALIKAN: reverseJournal resmi (dimensi dibawa, periode dicek). Pembalikan FINAL: kunci jurnal tetap terpakai sehingga dokumen tidak diposting ulang diam-diam; koreksi = dokumen baru.
import { bukukanPergerakan } from "../posting/inventory.js";
import { findEntryByKey, reverseJournal, resolvePostingGap } from "../journal.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../../../lib/activityLog.js";
import { lockRowForUpdate } from "../../inventoryLedger.js";
import { muatDokumen } from "./dokumen.js";
import { bacaPengaturanPosting, evaluasiAturan, pratinjau } from "./pratinjau.js";
import { JENIS, KODE, PESAN, StokResmiError } from "./matriks.js";
import { SYSTEM_KEYS } from "../accounts.js";

const TABEL = { STOCK_COUNT: "stock_counts", STOCK_ADJUSTMENT: "stock_adjustment_requests", DAMAGED_STOCK: "damaged_stock_records", RETURN_RECORD: "return_records" };
const ENTITAS = { STOCK_COUNT: ENTITY_TYPES.STOCK_COUNT, STOCK_ADJUSTMENT: ENTITY_TYPES.STOCK_ADJUSTMENT, DAMAGED_STOCK: ENTITY_TYPES.DAMAGED_STOCK, RETURN_RECORD: ENTITY_TYPES.RETURN_RECORD };

async function kunciDokumen(tx, jenis, id) {
  await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", `stok_resmi:${jenis}:${id}`);
  await lockRowForUpdate(tx, TABEL[jenis], id);
}

export async function postDokumenStok(tx, { jenis, id, userId, alasan }) {
  if (!String(alasan ?? "").trim() || String(alasan).trim().length < 5) throw new StokResmiError("Alasan posting wajib diisi (minimal 5 karakter).", 400, "ALASAN_WAJIB");
  if (!JENIS[jenis]) throw new StokResmiError(`Jenis dokumen tidak dikenal: ${jenis}`, 400, "JENIS_TIDAK_DIKENAL");
  await kunciDokumen(tx, jenis, id);
  const pengaturan = await bacaPengaturanPosting(tx);
  const d = await muatDokumen(tx, jenis, id);
  if (!d) throw new StokResmiError("Dokumen tidak ditemukan", 404, "DOKUMEN_TIDAK_ADA");

  // idempoten: sudah dijurnal (atau sudah dibalik) → hasil yang sama, tanpa jurnal kedua
  const sudah = await findEntryByKey(tx, d.kunci);
  if (sudah) return { dibuat: false, status: sudah.status === "REVERSED" ? "SUDAH_DIBALIK" : "SUDAH_DIPOSTING", entry: sudah, gap: false };

  const { penolakan } = evaluasiAturan(d, pengaturan, { untukPosting: true });
  if (penolakan.length > 0) {
    const pertama = penolakan[0];
    const status = pertama.kode === KODE.FITUR_BELUM_AKTIF ? 409 : 422;
    throw new StokResmiError(pertama.pesan, status, pertama.kode, penolakan);
  }

  const tanggal = d.tanggal;
  const hasil = await bukukanPergerakan(tx, {
    movementWhere: d.movementWhere, source: "PEMAKAIAN_BAHAN", sourceId: d.id, idempotencyKey: d.kunci,
    description: `${d.jenis === JENIS.STOCK_COUNT ? "Selisih stock opname" : d.jenis === JENIS.STOCK_ADJUSTMENT ? "Penyesuaian stok" : "Susut barang rusak"} ${d.nomor} — ${String(alasan).trim()}`.slice(0, 500),
    date: tanggal, userId, gapLabel: `${d.nomor}`, akunKeyUntuk: () => SYSTEM_KEYS[d.akunKey],
  });
  if (hasil.posted && hasil.entry) await resolvePostingGap(tx, { source: "PEMAKAIAN_BAHAN", sourceId: d.id, entryId: hasil.entry.id });
  const status = hasil.posted ? "DIPOSTING" : hasil.gap ? "GAP_DICATAT" : hasil.reason === "tertutup_stok_opname" ? "TIDAK_PERLU_JURNAL" : "TIDAK_ADA_NILAI";
  await recordActivity(tx, {
    entityType: ENTITAS[jenis], entityId: d.id, eventType: EVENT_TYPES.DOCUMENT_POSTED, actorId: userId,
    metadata: { aksi: "POSTING_NILAI_STOK_RESMI", nomor: d.nomor, status, alasan: String(alasan).trim(), nomorJurnal: hasil.entry?.entryNumber ?? null, gap: !!hasil.gap },
  });
  return { dibuat: !!hasil.posted && hasil.created !== false, status, entry: hasil.entry ?? null, gap: !!hasil.gap };
}

export async function balikDokumenStok(tx, { jenis, id, userId, alasan }) {
  if (!String(alasan ?? "").trim() || String(alasan).trim().length < 5) throw new StokResmiError("Alasan pembalikan wajib diisi (minimal 5 karakter).", 400, "ALASAN_WAJIB");
  if (!JENIS[jenis]) throw new StokResmiError(`Jenis dokumen tidak dikenal: ${jenis}`, 400, "JENIS_TIDAK_DIKENAL");
  await kunciDokumen(tx, jenis, id);
  const pengaturan = await bacaPengaturanPosting(tx);
  if (!pengaturan.aktif) throw new StokResmiError(PESAN[KODE.FITUR_BELUM_AKTIF], 409, KODE.FITUR_BELUM_AKTIF);
  const d = await muatDokumen(tx, jenis, id);
  if (!d) throw new StokResmiError("Dokumen tidak ditemukan", 404, "DOKUMEN_TIDAK_ADA");
  const entry = await findEntryByKey(tx, d.kunci);
  if (!entry) throw new StokResmiError("Dokumen ini belum pernah dijurnal — tidak ada yang dibalik.", 409, "BELUM_DIPOSTING");
  if (entry.status === "REVERSED") return { dibuat: false, status: "SUDAH_DIBALIK", entry };
  const balik = await reverseJournal(tx, { entryId: entry.id, reason: `Pembalikan jurnal stok resmi ${d.nomor} — ${String(alasan).trim()}`, userId });
  await recordActivity(tx, {
    entityType: ENTITAS[jenis], entityId: d.id, eventType: EVENT_TYPES.DOCUMENT_EDITED, actorId: userId,
    metadata: { aksi: "PEMBALIKAN_NILAI_STOK_RESMI", nomor: d.nomor, alasan: String(alasan).trim(), nomorJurnal: entry.entryNumber, nomorJurnalBalik: balik.entryNumber },
  });
  return { dibuat: true, status: "DIBALIK", entry, jurnalBalik: balik };
}

export { pratinjau };
