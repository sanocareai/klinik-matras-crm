// Order Produksi (adopsi Admin) — model MURNI untuk daftar, panel fokus, dan editor rencana bahan (diuji node --test, tanpa React/DOM).
//
// TIGA SUMBU STATUS yang dikirim server di `row.adopsi` (backend/src/lib/domain/productionWorkStatus.js) — klien TIDAK menurunkannya sendiri:
//   Status order  → apa yang dilihat Sales/Delivery (Pengambilan · Diproses · Siap Kirim · Terkirim · Dibatalkan)
//   Posisi unit   → fakta fisik dari dokumen (menunggu dijemput · sudah dijemput tetapi belum diterima workshop · di workshop · …)
//   Status kerja  → pekerjaan Produksi (Belum dijadwalkan · Dijadwalkan · Dikerjakan · Tertunda · Menunggu QC · Dikerjakan ulang · Selesai)
// Rencana bahan = RENCANA (tidak mengurangi stok). Pemakaian aktual = transaksi resmi Gudang/Produksi (mengurangi stok tepat sekali).

export const KERJA_FILTER = Object.freeze([
  { key: "BELUM_DIJADWALKAN", label: "Belum dijadwalkan" }, { key: "DIJADWALKAN", label: "Dijadwalkan" }, { key: "DIKERJAKAN", label: "Sudah dikerjakan" },
  { key: "TERTUNDA", label: "Tertunda" }, { key: "MENUNGGU_QC", label: "Menunggu QC" }, { key: "DIKERJAKAN_ULANG", label: "Dikerjakan ulang" }, { key: "SELESAI", label: "Selesai" },
]);
export const KERJA_FILTER_KEYS = Object.freeze(KERJA_FILTER.map((k) => k.key));

/** Badge variant dari nada server (neutral|accent|orange|green|red). Nada tak dikenal → neutral. */
export const nadaBadge = (tone) => (["neutral", "accent", "orange", "green", "red"].includes(tone) ? tone : "neutral");

/** Ringkasan satu baris untuk daftar + panel. `ada` = server sudah mengirim kontrak tiga sumbu (payload lama → false, tampil jujur "—"). */
export function ringkasAdopsi(row) {
  const a = row?.adopsi;
  if (!a?.kerja) return { ada: false, statusOrder: null, posisi: null, kerja: null, tindakan: null, target: null, pic: null, meja: null };
  return { ada: true, statusOrder: a.statusOrder ?? null, posisi: a.posisi ?? null, kerja: a.kerja, tindakan: a.tindakan ?? null, target: a.targetSelesai ?? null, pic: a.pic ?? null, meja: a.meja ?? null };
}

// ───────────────────────────── penerimaan workshop & status order ─────────────────────────────
/** Dampak tindakan "Catat unit diterima" — dicetak di formulir SEBELUM tombol ditekan (apa yang dicatat, apa yang TIDAK terjadi). */
export const DAMPAK_PENERIMAAN = Object.freeze({
  dicatat: ["Nama Anda, waktu sekarang, dan lokasi penerimaan sebagai catatan resmi unit ini.", "Status unit menjadi terlihat Diterima di Workshop di Produksi, Sales, dan Delivery."],
  tidak: ["Tidak memasukkan unit ke Rencana Produksi dan tidak membuka pekerjaan produksinya.", "Tidak memetakan layanan, tidak membuat tahap, QC, atau foto, dan tidak mengurangi stok.", "Tidak mengubah status order Sales."],
});
/** Dampak aktivasi Produksi V2 saat Jadwalkan — beda teks bila unit SUDAH dicatat diterima (kedatangan memakai catatan itu, tidak dicatat dua kali). */
export function teksDampakAktivasi({ diterimaWorkshop = null } = {}) {
  const awal = "Menyimpan jadwal akan menambahkan unit ini ke daftar unit Rencana Produksi (unit lain tidak berubah) dan membuka pekerjaan produksinya";
  return diterimaWorkshop
    ? `${awal}. Unit sudah dicatat diterima di workshop (${diterimaWorkshop.label || "penerimaan tercatat"}), jadi kedatangannya memakai catatan itu — tidak dicatat dua kali dan Run langsung berjalan. Tercatat atas nama Anda.`
    : `${awal} (belum tiba di workshop — kedatangan tetap dicatat petugas lewat Terima Unit), lalu menjadwalkannya — satu langkah. Tercatat atas nama Anda.`;
}
/** Lokasi awal formulir penerimaan: lokasi workshop bawaan Admin bila ada, selain itu kosong (petugas memilih; tidak menebak). */
export const lokasiAwalPenerimaan = (pilihan) => pilihan?.bawaan?.id || "";
/** Formulir penerimaan boleh dikirim: pernyataan fisik dicentang dan lokasi dipilih. */
export const bolehKirimPenerimaan = ({ fisik, locationId, sibuk = false } = {}) => !sibuk && fisik === true && !!locationId;

/** Jenis koreksi penerimaan — dua hal yang berbeda dan TIDAK boleh tertukar di layar. */
export const JENIS_KOREKSI = Object.freeze([
  { key: "LOCATION", label: "Lokasi salah", bantu: "Unit memang sudah diterima di workshop, tetapi lokasi yang dicatat keliru." },
  { key: "NOT_RECEIVED", label: "Ternyata belum diterima fisik", bantu: "Unit sebenarnya belum sampai di workshop. Catatan penerimaan dinyatakan tidak berlaku dan unit kembali ke daftar menunggu diterima." },
]);
/** Koreksi boleh dikirim: jenis dipilih; lokasi dipilih bila jenisnya lokasi; alasan minimal 3 huruf; tidak sedang mengirim. */
export const bolehKirimKoreksi = ({ jenis, locationId, alasan, sibuk = false } = {}) => !sibuk && (jenis === "LOCATION" ? !!locationId : jenis === "NOT_RECEIVED") && String(alasan ?? "").trim().length >= 3;
/** Satu baris riwayat koreksi untuk petugas: "Lokasi salah: A → B · oleh X · 21 Okt 2026, 10.30 WIB — alasan". */
export function teksKoreksi(k) {
  if (!k) return "";
  const isi = k.jenis === "LOCATION" ? `${k.lama?.code ?? "—"} → ${k.baru?.code ?? "—"}` : `catatan penerimaan (${k.lama?.code ?? "—"}) dinyatakan tidak berlaku`;
  return `${k.jenisLabel || k.jenis}: ${isi} · oleh ${k.oleh?.name || "—"} · ${waktuWib(k.at)} — “${k.alasan}”`;
}

/** Teks sumber status kerja untuk label kecil di bawah badge: hanya bila BUKAN jadwal biasa (manual/aplikasi/ikut status order). */
export function sumberKerjaText(kerja) {
  if (!kerja) return null;
  if (kerja.source === "MANUAL") return kerja.detail || "Dicatat manual";
  if (kerja.source === "APLIKASI") return "Dari aplikasi Produksi";
  if (kerja.source === "PEMAKAIAN_BAHAN") return "Otomatis dari pemakaian bahan";
  if (kerja.source === "STATUS_ORDER" && kerja.key !== "DIBATALKAN") return "Mengikuti status order";
  return null;
}

/** Status kerja manual yang MENYATAKAN pekerjaan sudah dilakukan: wajib konfirmasi singkat sebelum disimpan. Status lain (Belum dijadwalkan, Dijadwalkan, Tertunda) bukan pernyataan itu. */
export const KERJA_PERLU_KONFIRMASI = Object.freeze(["DIKERJAKAN", "SELESAI"]);
/** Teks konfirmasi (judul, isi, tombol ya) atau null bila status itu tidak perlu konfirmasi. Tidak membuat status baru; hanya memastikan Admin tidak salah mencatat. */
export function konfirmasiKerja(status, unitCode = "") {
  const unit = unitCode ? ` ${unitCode}` : "";
  if (status === "DIKERJAKAN") return { judul: `Pekerjaan unit${unit} memang sudah dilakukan?`, isi: "Ini hanya catatan administratif atas nama Anda. Tidak membuat stok keluar, bahan, Production Run, QC, foto, atau jurnal. Bila ada bahan yang dipakai, catat di bagian Bahan — status otomatis menjadi Sudah dikerjakan.", ya: "Ya, sudah dikerjakan", sukses: "Dicatat manual: Sudah dikerjakan." };
  if (status === "SELESAI") return { judul: `Pekerjaan unit${unit} memang sudah selesai?`, isi: "Ini hanya catatan administratif atas nama Anda; bukan hasil QC, bukan serah ke Gudang, dan bukan Siap Kirim. Tidak membuat stok, Production Run, QC, foto, atau jurnal.", ya: "Ya, sudah selesai", sukses: "Dicatat manual: Selesai." };
  return null;
}
/** Label tombol manual di bagian Pekerjaan menurut status yang dipilih (menyebut pernyataannya secara eksplisit). */
export const labelCatatKerja = (status) => (status === "DIKERJAKAN" ? "Tandai sudah dikerjakan" : status === "SELESAI" ? "Tandai selesai" : "Catat status kerja");
/** Sumber status kerja untuk label kecil: SATU kosakata dengan Excel (sourceLabel server). Jadwal biasa tidak ditampilkan sebagai sumber. */
export function sumberKerjaPendek(kerja) {
  if (!kerja || kerja.source === "JADWAL" || (kerja.source === "STATUS_ORDER" && kerja.key === "DIBATALKAN")) return null;
  return kerja.sourceLabel || null;
}

/** Parameter ekspor/daftar dari state layar — SATU fungsi dipakai daftar dan ekspor supaya berkas persis sama dengan daftar yang difilter. */
export function parameterDaftar({ globalStatus, q, kerja, scope } = {}) {
  const out = {};
  if (globalStatus) out.globalStatus = globalStatus;
  if (q) out.q = q;
  if (Array.isArray(kerja) && kerja.length) out.statusKerja = kerja.join(",");
  if (scope) out.scope = scope;
  return out;
}

/** Tanggal+jam WIB ringkas ("20 Okt 2026, 10.30") — tanpa bergantung zona perangkat. */
export function waktuWib(iso) {
  if (!iso) return "—";
  const d = new Date(new Date(iso).getTime() + 7 * 3600 * 1000);
  if (Number.isNaN(d.getTime())) return "—";
  const bln = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"][d.getUTCMonth()];
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCDate()} ${bln} ${d.getUTCFullYear()}, ${p(d.getUTCHours())}.${p(d.getUTCMinutes())} WIB`;
}

// ───────────────────────────── rencana bahan (editor) ─────────────────────────────
export const MAX_BARIS = 200;

/** Format angka jumlah bahan: maks 4 desimal, tanpa nol di ujung, koma desimal Indonesia. */
export function formatJumlah(n) {
  if (n === null || n === undefined || n === "") return "—";
  const v = Math.round(Number(n) * 10000) / 10000;
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString("id-ID", { maximumFractionDigits: 4 });
}
/** Parse isian pengguna ("2,5" atau "2.5") → angka; kosong/tak valid → null. */
export function parseJumlah(text) {
  const t = String(text ?? "").trim().replace(/\s/g, "");
  if (!t) return null;
  const norm = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t;
  const v = Number(norm);
  return Number.isFinite(v) ? v : null;
}

/** Ketersediaan bahan: saldo tidak diketahui TIDAK pernah tampil sebagai nol. */
export function ketersediaanText(b) {
  if (!b) return "Stok belum diketahui";
  if (b.saldoDiketahui === false || b.tersedia === null || b.tersedia === undefined) return "Stok belum diketahui";
  if (b.keadaan === "MINUS") return "Catatan stok minus — perlu dihitung fisik";
  if (b.keadaan === "NOL_TERHITUNG") return "Habis menurut catatan";
  if (b.keadaan === "TERPESAN_PENUH") return "Seluruhnya sudah dipesan";
  return `Tersedia ${formatJumlah(b.tersedia)} ${b.satuan || ""}`.trim();
}
export const ketersediaanNada = (b) => (!b || b.saldoDiketahui === false || b.tersedia === null || b.tersedia === undefined ? "neutral" : Number(b.tersedia) <= 0 || b.keadaan === "MINUS" ? "red" : b.keadaan === "MENIPIS" || b.keadaan === "TERPESAN_PENUH" ? "orange" : "green");

/** Baris editor dari baris rencana server atau dari baris katalog. */
export function barisEditor(b, qty = "") {
  return { materialId: b.materialId, kode: b.kode ?? null, nama: b.nama ?? "", satuan: b.satuan ?? "", kelompok: b.kelompok ?? { kode: "BELUM", label: "Belum dikelompokkan" }, qty: qty === "" ? "" : String(qty), tersedia: b.tersedia ?? null, saldoDiketahui: b.saldoDiketahui !== false && b.tersedia !== null && b.tersedia !== undefined, keadaan: b.keadaan ?? null };
}
export const dariRencana = (lines = []) => lines.map((l) => barisEditor(l, l.qty));

export function tambahBaris(baris, bahan) {
  if (baris.some((b) => b.materialId === bahan.materialId)) return baris; // tanpa duplikat
  if (baris.length >= MAX_BARIS) return baris;
  return [...baris, barisEditor(bahan, "")];
}
export const ubahJumlah = (baris, materialId, text) => baris.map((b) => (b.materialId === materialId ? { ...b, qty: text } : b));
export const hapusBaris = (baris, materialId) => baris.filter((b) => b.materialId !== materialId);

/** Validasi sisi klien (server tetap penentu): jumlah > 0, tidak duplikat, tidak kosong. Mengembalikan { ok, galat: {materialId: pesan}, umum } */
export function validasiBaris(baris) {
  const galat = {};
  for (const b of baris) {
    const v = parseJumlah(b.qty);
    if (v === null) galat[b.materialId] = "Isi jumlah";
    else if (v <= 0) galat[b.materialId] = "Jumlah harus lebih dari 0";
  }
  const umum = baris.length > MAX_BARIS ? `Maksimal ${MAX_BARIS} bahan per unit` : null;
  return { ok: Object.keys(galat).length === 0 && !umum, galat, umum };
}
/** Badan PUT rencana (urutan baris tidak berarti). */
export const badanRencana = (baris) => baris.map((b) => ({ materialId: b.materialId, qty: Math.round(parseJumlah(b.qty) * 10000) / 10000 }));

/** Apakah isian berbeda dari rencana tersimpan (urutan tidak berarti). */
export function adaPerubahan(baris, tersimpan = []) {
  const peta = new Map(tersimpan.map((l) => [l.materialId, Number(l.qty)]));
  if (baris.length !== peta.size) return true;
  return baris.some((b) => !peta.has(b.materialId) || Math.round((parseJumlah(b.qty) ?? NaN) * 10000) !== Math.round(peta.get(b.materialId) * 10000));
}

/** Ringkasan pilihan yang menetap di layar: jumlah bahan, rincian per kelompok, dan peringatan satuan campur/stok kurang. */
export function ringkasPilihan(baris) {
  const per = new Map();
  for (const b of baris) { const k = b.kelompok?.kode ?? "BELUM"; const o = per.get(k) ?? { kode: k, label: b.kelompok?.label ?? "Belum dikelompokkan", jumlah: 0 }; o.jumlah += 1; per.set(k, o); }
  const kurang = baris.filter((b) => { const v = parseJumlah(b.qty); return b.saldoDiketahui && v !== null && b.tersedia !== null && v > Number(b.tersedia); });
  const tidakDiketahui = baris.filter((b) => !b.saldoDiketahui).length;
  return { jumlahBahan: baris.length, perKelompok: [...per.values()], melebihiStok: kurang.map((b) => b.materialId), jumlahStokTidakDiketahui: tidakDiketahui };
}

/** Kelompokkan baris untuk tampilan (urutan kelompok mengikuti kemunculan di katalog server bila diberikan). */
export function kelompokkan(baris, urutan = []) {
  const idx = new Map(urutan.map((k, i) => [k.kode, i]));
  const peta = new Map();
  for (const b of baris) { const k = b.kelompok?.kode ?? "BELUM"; if (!peta.has(k)) peta.set(k, { kode: k, label: b.kelompok?.label ?? "Belum dikelompokkan", baris: [] }); peta.get(k).baris.push(b); }
  return [...peta.values()].sort((a, b) => (idx.get(a.kode) ?? 99) - (idx.get(b.kode) ?? 99));
}

// ───────────────────────────── pesan galat ─────────────────────────────
/** Pesan tindakan berikutnya untuk galat adopsi. Server sudah berbahasa Indonesia; di sini hanya ditambah petunjuk apa yang harus dilakukan. */
export function pesanGalatAdopsi(e) {
  if (!e) return { teks: "", jenis: "galat", muatUlang: false };
  const code = e.code || "";
  if (code === "RIWAYAT_BERUBAH") return { teks: e.message || "Data sudah diubah orang lain.", jenis: "konflik", muatUlang: true, petunjuk: "Muat ulang untuk melihat versi terbaru, lalu terapkan perubahan Anda lagi bila masih perlu." };
  if (code === "KERJA_DIPEGANG_APLIKASI") return { teks: e.message, jenis: "info", muatUlang: true, petunjuk: "Unit ini sudah dikerjakan lewat aplikasi Produksi, jadi status kerja mengikuti aplikasi." };
  if (code === "KOREKSI_REVISI_BASI") return { teks: e.message, jenis: "konflik", muatUlang: true, petunjuk: "Muat ulang untuk melihat koreksi terbaru, lalu putuskan lagi." };
  if (code === "KOREKSI_PERLU_JALUR_RESMI") return { teks: e.message, jenis: "info", muatUlang: false, petunjuk: "Tidak ada yang diubah. Hubungi Kepala Produksi atau tim sistem." };
  if (code === "PENERIMAAN_TIDAK_ADA") return { teks: e.message, jenis: "konflik", muatUlang: true };
  if (code === "UNIT_TIDAK_AKTIF") return { teks: e.message, jenis: "info", muatUlang: false };
  if (code === "CATATAN_WAJIB") return { teks: e.message, jenis: "validasi", muatUlang: false, petunjuk: "Tulis alasan singkat (mis. menunggu kain dari supplier)." };
  if (code === "IDEMPOTENCY_IN_PROGRESS") return { teks: "Permintaan yang sama sedang diproses.", jenis: "info", muatUlang: true, petunjuk: "Tunggu sebentar lalu muat ulang — jangan kirim ulang." };
  if (e.status === 403) return { teks: "Akun Anda hanya bisa melihat bagian ini.", jenis: "izin", muatUlang: false };
  if (e.status === 0 || /timeout|Failed to fetch|terputus/i.test(e.message || "")) return { teks: "Koneksi terputus. Isian Anda masih di layar.", jenis: "jaringan", muatUlang: false, petunjuk: "Coba lagi saat sinyal kembali — pencatatan yang sama tidak akan tersimpan dua kali." };
  return { teks: e.message || "Terjadi kesalahan.", jenis: "galat", muatUlang: false };
}

/** Kunci idempotensi baru untuk SATU niat pengguna (dipakai ulang saat retry isian yang sama, diganti saat isian berubah). */
export function kunciIdempoten(prefix = "op") {
  const rnd = globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `${prefix}-${rnd}`;
}
