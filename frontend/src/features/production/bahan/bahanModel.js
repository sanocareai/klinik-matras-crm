// Model MURNI Bahan + Ringkasan Ruang Kerja Unit (diuji node --test tanpa React/DOM).
// Dua sumber pemakaian yang TIDAK dicampur dan TIDAK dijumlahkan:
//   (1) Bahan baru dari Gudang   = pergerakan stok resmi (POST /units/:id/materials): mengurangi stok tepat sekali, ada dokumen sumber + dampak saldo.
//   (2) Komponen lama dari unit  = komponen bongkaran milik pelanggan: TIDAK memengaruhi saldo/pergerakan/Material Issue/reservasi/jurnal/biaya bahan baru.
import { parseJumlah, formatJumlah, barisEditor } from "../orderProduksiModel.js";

export const SUMBER = Object.freeze({
  BARU: { key: "BARU", label: "Bahan baru dari Gudang", ringkas: "Mengurangi stok saat dikonfirmasi", dampak: "Mengurangi stok tepat sekali lewat Material Issue/pergerakan stok resmi." },
  LAMA: { key: "LAMA", label: "Komponen lama dari unit ini", ringkas: "Tidak memengaruhi stok", dampak: "Milik pelanggan: tidak membuat Material Issue, penerimaan Gudang, pergerakan stok, reservasi, atau biaya bahan baru." },
});
// Tiga sumber pemakaian yang SELALU tampil sebagai kartu di area "Pemakaian aktual" (tanpa menggulir daftar). Judul kartu = istilah pengguna; SUMBER.* di atas tetap dipakai riwayat/Excel.
export const KARTU_SUMBER = Object.freeze({
  gudang: { key: "gudang", label: "Bahan dari Gudang", ringkas: "Mengurangi stok saat dikonfirmasi", teks: "Bahan yang ada di katalog Gudang. Stok berkurang tepat sekali lewat Material Issue/pergerakan stok resmi.", badge: "orange" },
  belum: { key: "belum", label: "Bahan belum ada di katalog", ringkas: "Perlu rekonsiliasi Gudang", teks: "Catat faktanya sekarang dan usulkan ke Gudang. Stok, biaya, dan jurnal tidak berubah sampai Gudang menyelesaikannya.", badge: "orange" },
  lama: { key: "lama", label: "Komponen lama dari kasur ini", ringkas: "Tidak memengaruhi stok", teks: "Milik pelanggan (bongkaran kasur ini): bukan stok, bukan Material Issue, tanpa biaya bahan baru.", badge: "accent" },
});
export const STATUS_REKON = "Perlu rekonsiliasi Gudang";
export const JUDUL_AKTUAL = "Pemakaian aktual";
export const JUDUL_RENCANA = "Rencana (opsional, belum mengurangi stok)";
export const KELOMPOK_USULAN = Object.freeze([
  { kode: "BUSA", label: "Busa" }, { kode: "KAIN", label: "Kain" }, { kode: "BENANG", label: "Benang" }, { kode: "PEGAS", label: "Pegas" },
  { kode: "KAYU", label: "Kayu" }, { kode: "LEM_KIMIA", label: "Lem/Kimia" }, { kode: "AKSESORI", label: "Aksesori" }, { kode: "LAINNYA", label: "Lainnya" },
]);
export const ASAL_UMUM = Object.freeze(["Sisa bahan di meja produksi", "Dibeli sendiri / dari luar", "Pinjam dari tempat lain", "Milik pelanggan", "Belum diketahui"]);
export const SUMBER_SEMENTARA = Object.freeze({ key: "SEMENTARA", label: "Pemakaian sementara", ringkas: "Perlu rekonsiliasi Gudang", dampak: "Fakta pemakaian bahan yang belum punya sumber stok resmi. BUKAN Material Issue: saldo, biaya bahan, dan jurnal tidak berubah sampai Gudang menyelesaikannya." });
export const CATATAN_SEMENTARA = "Hanya mencatat fakta. Stok tidak berkurang, tidak ada biaya atau jurnal, dan bukan Material Issue. Gudang menyelesaikan sumber stoknya lewat jalur resmi.";
export const DAMPAK_SEMENTARA = "Tetap dihitung sebagai bukti “Sudah dikerjakan” (sumber: Pemakaian sementara — perlu rekonsiliasi Gudang) dan muncul di Ringkasan, Riwayat, dan Excel (sheet Pemakaian Sementara). Bukan selesai QC.";
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
  // "Belum diketahui" = bahan belum punya catatan stok sama sekali → saldo ledger 0 → pengurangan ditolak server ("Stok ... tidak cukup — tersedia 0"). Tidak ada gunanya mencoba: arahkan ke Gudang atau ke pemakaian sementara.
  if (b?.saldoDiketahui === false || b?.tersedia === null || b?.tersedia === undefined) return { status: "tidak_diketahui", nada: "red", teks: "Stok belum diketahui: bahan ini belum punya catatan stok, jadi server akan MENOLAK pencatatan (tidak ada stok yang bisa dikurangi). Minta Gudang mencatat stok awal/opname lebih dulu, atau catat sebagai pemakaian sementara lewat “Bahan belum ada di katalog”.", blok: true, alternatif: "sementara" };
  const tersedia = Number(b.tersedia);
  if (v !== null && v > tersedia + 0.00005) return { status: "kurang", nada: "red", teks: `Saldo Gudang ${formatJumlah(tersedia)} ${b.satuan || ""}, kurang ${formatJumlah(v - tersedia)}. Kurangi jumlah, atau minta Gudang menambah stok.`, blok: true, kurang: v - tersedia };
  const sisa = v !== null && v > 0 ? Math.round((tersedia - v) * 10000) / 10000 : null;
  return { status: "cukup", nada: "green", teks: `Saldo Gudang ${formatJumlah(tersedia)} ${b.satuan || ""}`.trim(), sisaTeks: sisa !== null ? `Sisa setelah dicatat: ${formatJumlah(sisa)} ${b.satuan || ""}`.trim() : null, blok: false };
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

/** Bisa dikonfirmasi: ada baris, semua jumlah > 0, tidak ada yang pasti ditolak server (saldo kurang atau stok belum diketahui = ledger 0). */
export function bolehKonfirmasiAktual(baris, status = {}) {
  const tunggu = baris.filter((b) => status[b.materialId]?.fase !== "ok");
  if (!tunggu.length) return { ok: false, alasan: null };
  for (const b of tunggu) {
    const v = parseJumlah(b.qty);
    if (v === null || v <= 0) return { ok: false, alasan: "Isi jumlah > 0 untuk setiap bahan." };
    const ks = keadaanSaldo(b, b.qty);
    if (ks.blok) return { ok: false, alasan: ks.status === "tidak_diketahui" ? `Stok ${b.nama} belum diketahui — server pasti menolak. Ganti bahan, atau catat sebagai pemakaian sementara.` : `Saldo ${b.nama} tidak cukup.` };
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
/** Ringkasan pemakaian SEMENTARA (bahan belum di katalog): terpisah dari bahan baru dan komponen lama; tidak pernah dijumlahkan. */
export function ringkasSementara(data) {
  const s = data?.pemakaianSementara ?? null; const items = s?.items ?? [];
  const perlu = items.filter((i) => i.status === "PERLU_REKONSILIASI");
  return { ada: items.length > 0, perlu: perlu.length, direkonsiliasi: items.filter((i) => i.status === "DIREKONSILIASI").length, dibatalkan: items.filter((i) => i.status === "DIBATALKAN").length, terakhir: perlu[0] ?? null };
}

/** Cuplikan Bahan: dua sumber TERPISAH (+ pemakaian sementara bila ada). */
export function ringkasBahan(data) {
  const plan = data?.rencanaBahan?.plan ?? null; const aktual = data?.pemakaianAktual?.baris ?? []; const kl = data?.komponenLama ?? null;
  const terakhir = aktual[0] ?? null;
  return {
    rencana: plan ? { jumlahItem: plan.lines.length, revisi: plan.revision } : null,
    baru: { jumlahCatatan: aktual.length, jumlahBahan: (data?.pemakaianAktual?.total || []).length, terakhir: terakhir ? { nama: terakhir.nama, qty: terakhir.qty, satuan: terakhir.satuan, at: terakhir.tanggal, pelaku: terakhir.pelaku } : null },
    lama: kl ? { pemakaianKembali: kl.total.pemakaianKembali.jumlahItem, dilepas: kl.total.dilepasTidakDipakai.jumlahItem, terakhirAt: kl.total.terakhirAt, dibatalkan: kl.dibatalkan.length } : { pemakaianKembali: 0, dilepas: 0, terakhirAt: null, dibatalkan: 0 },
    sementara: ringkasSementara(data),
    peringatan: peringatanBahan(data),
    kosong: !plan && !aktual.length && !(kl?.items?.length) && !(data?.pemakaianSementara?.items?.length),
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

/** Empat fakta Pekerjaan yang DIPISAH di Ringkasan: status kerja administratif (+ sumber + fakta tanpa jadwal), jadwal, pemakaian bahan (dua sumber), QC. */
export function ringkasPekerjaan(data) {
  const ad = data?.adopsi ?? {}; const k = ad.kerja ?? {}; const p = ad.pemakaianBahan ?? {};
  const jadwal = ad.jadwal ? `${String(ad.jadwal.tanggal).slice(8)}/${String(ad.jadwal.tanggal).slice(5, 7)}${ad.jadwal.meja ? ` · ${String(ad.jadwal.meja).replace("TABLE_", "Meja ")}` : ""} (${ad.jadwal.sumber === "V2" ? "Pelaksanaan Meja" : "Rencana Admin"})` : "Belum dijadwalkan";
  const baru = p.baruCatatan ?? 0; const lama = p.komponenLamaDipakaiKembali ?? 0; const sem = p.sementaraPerluRekonsiliasi ?? 0;
  const pemakaian = baru + lama + sem === 0 ? "Belum ada pemakaian tercatat" : [baru ? `${baru} catatan bahan baru` : null, lama ? `${lama} komponen lama dipakai kembali` : null, sem ? `${sem} pemakaian sementara (perlu rekonsiliasi Gudang)` : null].filter(Boolean).join(" · ");
  const sumber = k.source === "PEMAKAIAN_BAHAN" ? "Otomatis dari pemakaian bahan" : k.source === "PEMAKAIAN_SEMENTARA" ? "Pemakaian sementara — perlu rekonsiliasi Gudang" : k.source === "MANUAL" ? "Dicatat manual" : k.source === "APLIKASI" ? "Dari aplikasi Produksi" : null;
  const qc = k.key === "MENUNGGU_QC" ? "QC: menunggu keputusan" : k.key === "DIKERJAKAN_ULANG" ? "QC: pengerjaan ulang" : "QC: belum ada hasil";
  return { jadwal, pemakaian, sumber, faktaJadwal: k.faktaJadwal ?? null, qc };
}
