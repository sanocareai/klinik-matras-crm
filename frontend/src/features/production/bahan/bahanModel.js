// Model MURNI Bahan + Ringkasan Ruang Kerja Unit (diuji node --test tanpa React/DOM).
// Dua sumber pemakaian yang TIDAK dicampur dan TIDAK dijumlahkan:
//   (1) Bahan baru dari Gudang   = pergerakan stok resmi (POST /units/:id/materials): mengurangi stok tepat sekali, ada dokumen sumber + dampak saldo.
//   (2) Komponen lama dari unit  = komponen bongkaran milik pelanggan: TIDAK memengaruhi saldo/pergerakan/Material Issue/reservasi/jurnal/biaya bahan baru.
import { parseJumlah, formatJumlah, barisEditor } from "../orderProduksiModel.js";

export const SUMBER = Object.freeze({
  BARU: { key: "BARU", label: "Bahan baru dari Gudang", ringkas: "Mengurangi stok saat dikonfirmasi", dampak: "Mengurangi stok tepat sekali lewat Material Issue/pergerakan stok resmi." },
  LAMA: { key: "LAMA", label: "Komponen lama dari unit ini", ringkas: "Tidak memengaruhi stok", dampak: "Milik pelanggan: tidak membuat Material Issue, penerimaan Gudang, pergerakan stok, reservasi, atau biaya bahan baru." },
});
export const JUDUL_AKTUAL = "Pemakaian aktual (mengurangi stok saat dikonfirmasi)";
export const JUDUL_RENCANA = "Rencana (opsional, belum mengurangi stok)";
export const asalKomponen = (kodeUnit) => `Dari kasur pelanggan — ${kodeUnit || "—"}`;

export const HASIL_KOMPONEN = Object.freeze([
  { key: "REUSED", label: "Dipakai kembali pada unit ini", pemakaian: true, bantu: "Dihitung sebagai pemakaian kembali (bukan stok)." },
  { key: "RETURNED_TO_CUSTOMER", label: "Dikembalikan ke pelanggan", pemakaian: false, bantu: "Dilepas, tidak dipakai. Bukan pemakaian dan tidak masuk stok perusahaan." },
  { key: "KEPT_WITH_UNIT", label: "Disimpan bersama unit", pemakaian: false, bantu: "Dilepas, tidak dipakai. Bukan pemakaian dan tidak masuk stok perusahaan." },
  { key: "DISCARDED", label: "Dibuang", pemakaian: false, bantu: "Dilepas, tidak dipakai. Bukan pemakaian dan tidak masuk stok perusahaan." },
]);
export const SATUAN_KOMPONEN = Object.freeze(["PCS", "METER", "M3", "SHEET", "SPOOL", "KG", "PACK", "ROLL", "BUNDLE", "ROD", "PAIR", "CAN", "BOX", "LITER"]);

/** Keadaan saldo untuk SATU baris bahan baru: cukup / kurang (pasti ditolak Gudang) / tidak diketahui (server yang memutuskan). */
export function keadaanSaldo(b, qtyTeks) {
  const v = parseJumlah(qtyTeks);
  if (b?.saldoDiketahui === false || b?.tersedia === null || b?.tersedia === undefined) return { status: "tidak_diketahui", nada: "orange", teks: "Stok belum diketahui. Pencatatan akan ditolak Gudang bila saldo tidak mencukupi; minta Gudang mencatat stok awal/opname lebih dulu.", blok: false };
  const tersedia = Number(b.tersedia);
  if (v !== null && v > tersedia + 0.00005) return { status: "kurang", nada: "red", teks: `Saldo Gudang ${formatJumlah(tersedia)} ${b.satuan || ""}, kurang ${formatJumlah(v - tersedia)}. Kurangi jumlah, atau minta Gudang menambah stok.`, blok: true, kurang: v - tersedia };
  return { status: "cukup", nada: "green", teks: `Saldo Gudang ${formatJumlah(tersedia)} ${b.satuan || ""}`.trim(), blok: false };
}

/** Baris isian aktual dari baris katalog. */
export const barisAktualDariKatalog = (kat) => ({ ...barisEditor(kat, ""), qty: "" });
export const tambahAktual = (baris, kat) => (baris.some((b) => b.materialId === kat.materialId) ? baris : [...baris, barisAktualDariKatalog(kat)]);

/** "Gunakan rencana sebagai isian awal": sisa rencana (rencana − sudah dipakai) per bahan; pengguna memeriksa & mengubah jumlah sebelum posting. TIDAK memposting. */
export function isianAwalDariRencana(lines = [], aktualTotal = [], sudahAda = []) {
  const dipakai = new Map(aktualTotal.map((t) => [t.materialId, Number(t.dipakai) || 0]));
  const ada = new Set(sudahAda.map((b) => b.materialId)); const hasil = []; const dilewati = [];
  for (const l of lines) {
    const sisa = Math.round((Number(l.qty) - (dipakai.get(l.materialId) ?? 0)) * 10000) / 10000;
    if (ada.has(l.materialId)) continue;
    if (sisa <= 0) { dilewati.push({ materialId: l.materialId, nama: l.nama }); continue; }
    hasil.push({ ...barisEditor(l, sisa), qty: String(sisa), dariRencana: { rencana: Number(l.qty), sudahDipakai: dipakai.get(l.materialId) ?? 0 } });
  }
  return { baris: hasil, dilewati };
}

/** Bisa dikonfirmasi: ada baris, semua jumlah > 0, tidak ada yang pasti ditolak (saldo kurang). Baris tidak-diketahui boleh dicoba (server memutuskan). */
export function bolehKonfirmasiAktual(baris, status = {}) {
  const tunggu = baris.filter((b) => status[b.materialId]?.fase !== "ok");
  if (!tunggu.length) return { ok: false, alasan: null };
  for (const b of tunggu) {
    const v = parseJumlah(b.qty);
    if (v === null || v <= 0) return { ok: false, alasan: "Isi jumlah > 0 untuk setiap bahan." };
    if (keadaanSaldo(b, b.qty).blok) return { ok: false, alasan: `Saldo ${b.nama} tidak cukup.` };
  }
  return { ok: true, alasan: null };
}

/** Koreksi bahan baru yang SUDAH diposting = pengembalian baru; maksimal sebesar pemakaian bersih bahan itu pada unit ini. */
export function batasKoreksi(baris, aktualTotal) {
  const net = Number((aktualTotal || []).find((t) => t.materialId === baris.materialId)?.dipakai ?? 0);
  return Math.max(0, Math.min(Number(baris.qty), net));
}
/** Jalur koreksi resmi menurut dokumen sumber. */
export function jalurKoreksi(baris) {
  if (baris.tipe === "RETURN") return { jenis: "pengembalian", teks: "Ini sudah koreksi/pengembalian." };
  if (baris.tipe === "WASTE") return { jenis: "gudang", teks: "Catatan sisa/rusak dikoreksi lewat Gudang." };
  if (baris.dokumen?.jenis === "Material Issue Gudang") return { jenis: "gudang", teks: `Dicatat lewat dokumen Material Issue ${baris.dokumen.nomor}. Koreksi lewat Gudang (Return Produksi).` };
  return { jenis: "langsung", teks: "Koreksi resmi = pencatatan pengembalian BARU ke stok. Catatan asli tidak diubah atau dihapus." };
}

// ───────────── Ringkasan ─────────────
/** Peringatan Bahan yang benar-benar perlu tindakan (bukan sekadar info): pemakaian melebihi rencana, sisa rencana melebihi saldo Gudang. */
export function peringatanBahan(data) {
  const out = []; const banding = data?.perbandingan || [];
  const lebih = banding.filter((p) => p.rencana !== null && p.aktual > p.rencana);
  if (lebih.length) out.push({ key: "lebih-rencana", teks: `Pemakaian melebihi rencana: ${lebih.slice(0, 2).map((p) => p.nama).join(", ")}${lebih.length > 2 ? ` +${lebih.length - 2}` : ""}.`, bagian: "bahan" });
  const dipakai = new Map((data?.pemakaianAktual?.total || []).map((t) => [t.materialId, t.dipakai]));
  const kurang = (data?.rencanaBahan?.plan?.lines || []).filter((l) => l.saldoDiketahui && l.tersedia !== null && l.tersedia !== undefined && (Number(l.qty) - (dipakai.get(l.materialId) ?? 0)) > Number(l.tersedia) + 0.00005);
  if (kurang.length) out.push({ key: "stok-kurang", teks: `Saldo Gudang kurang untuk sisa rencana: ${kurang.slice(0, 2).map((l) => l.nama).join(", ")}${kurang.length > 2 ? ` +${kurang.length - 2}` : ""}.`, bagian: "bahan" });
  return out;
}

/** Cuplikan Bahan: dua sumber TERPISAH. */
export function ringkasBahan(data) {
  const plan = data?.rencanaBahan?.plan ?? null; const aktual = data?.pemakaianAktual?.baris ?? []; const kl = data?.komponenLama ?? null;
  const terakhir = aktual[0] ?? null;
  return {
    rencana: plan ? { jumlahItem: plan.lines.length, revisi: plan.revision } : null,
    baru: { jumlahCatatan: aktual.length, jumlahBahan: (data?.pemakaianAktual?.total || []).length, terakhir: terakhir ? { nama: terakhir.nama, qty: terakhir.qty, satuan: terakhir.satuan, at: terakhir.tanggal, pelaku: terakhir.pelaku } : null },
    lama: kl ? { pemakaianKembali: kl.total.pemakaianKembali.jumlahItem, dilepas: kl.total.dilepasTidakDipakai.jumlahItem, terakhirAt: kl.total.terakhirAt, dibatalkan: kl.dibatalkan.length } : { pemakaianKembali: 0, dilepas: 0, terakhirAt: null, dibatalkan: 0 },
    peringatan: peringatanBahan(data),
    kosong: !plan && !aktual.length && !(kl?.items?.length),
  };
}

/** Cuplikan Dokumentasi dari matriks server (detail) + ketersediaan (ruang.dokumentasi). Bukti Dokumentasi BUKAN QC lulus. */
export function ringkasDokumentasi(dok, detail) {
  if (!dok?.tersedia) return { tersedia: false, alasan: dok?.alasan || "Dokumentasi belum tersedia untuk unit ini." };
  if (!detail) return { tersedia: true, memuat: true };
  const kat = (detail.categories || []).filter((c) => c.applicable);
  const item = kat.flatMap((c) => (c.items || []).map((it) => ({ ...it, kategori: c.label })));
  const terbaru = item.reduce((a, b) => (!a || new Date(b.createdAt) > new Date(a.createdAt) ? b : a), null);
  const kurang = kat.filter((c) => c.status === "KURANG");
  return {
    tersedia: true, jumlahFoto: kat.reduce((n, c) => n + (c.count || 0), 0), kategoriTerisi: kat.filter((c) => (c.count || 0) > 0).map((c) => c.label),
    terbaru: terbaru ? { kategori: terbaru.kategori, at: terbaru.createdAt, oleh: terbaru.actorName || null, sumber: terbaru.source || null } : null,
    wajib: { perlu: detail.docs?.required ?? 0, terpenuhi: detail.docs?.satisfied ?? 0, kurang: kurang.map((c) => ({ label: c.label, kurang: c.missing })) },
    bolehUnggah: !!dok.bolehUnggah, catatan: "Dokumentasi bukan hasil QC: foto yang diunggah tidak meluluskan QC maupun menyelesaikan tahap.",
  };
}
