// ─── AUTHORITY SELLING STYLE CHECK — Modul 6 SANO Care ──────────────────────
// TERPISAH TOTAL dari validator.js (`violations()`/`hasPromise()`) — file
// itu ada 2 pemakaian: (1) menyaring DRAF AI (scrubSuggestions), (2) audit
// pelanggaran SUNGGUHAN (garansi flat/klaim medis/jaminan mutlak, soal
// AKURASI KLAIM & RISIKO HUKUM). Kategori di file ini BEDA MAKSUD: ini soal
// GAYA BAHASA "penjual" vs "konsultan" (Modul 6) — bukan compliance. Kalau
// digabung ke violations(), kategori ini ikut MEMBLOKIR draf AI juga
// (side-effect yang TIDAK diminta) — makanya dipisah jadi fungsi & file
// sendiri, dipanggil TERPISAH di mcp/toolsChat.js#audit_balasan_sales.
//
// Forbidden words dari Modul 6 (tabel "GUNAKAN vs HINDARI"): "Pasti",
// "Dijamin", "Sudah pasti sembuh", "Kasur ini paling bagus", "Semua orang
// cocok", "Harus beli". Regex SENGAJA lebih LONGGAR dari CERTAINTY_RE di
// validator.js (yang mensyaratkan "pasti/dijamin" DIIKUTI kata sifat
// spesifik seperti "cocok/nyaman/sembuh" supaya tidak overclaim compliance-
// wise) — di sini "pasti"/"dijamin" BENAR SALAH SENDIRIAN sudah melanggar
// gaya Authority Selling (Modul 6: "Hindari kata 'Pasti', 'Sudah pasti',
// 'Jelas' — karena konsultan bukan dokter"), independen dari kata sifat apa
// yang mengikutinya. Toleransi false-positive lebih tinggi diterima di sini
// karena scope-nya "perlu ditinjau gaya bicaranya", bukan "pelanggaran
// hukum otomatis".
// BUG DIPERBAIKI (verifikasi live thd 3000 pesan produksi, 28 Agustus 2026):
// "Pasti"/"Dijamin" TIDAK BOLEH match kalau langsung diikuti titik dua —
// template internal "ORDER BARU" (dikirim ke GRUP, bukan ke pelanggan)
// memakai "Pasti:" sbg LABEL FIELD tanggal terkonfirmasi (mis. "Pick Up: -
// (Pasti: 28 Agustus 2026)"), muncul di HAMPIR SETIAP notifikasi order —
// tanpa exclusion ini kategori baru ini akan tenggelam dlm noise template,
// bukan sinyal gaya bicara ke pelanggan yang sungguhan.
const AUTHORITY_ABSOLUTE_RE =
  /\b(pasti|dijamin)\b(?!\s*:)|\bharus\s*beli\b|\bkasur\s*ini\s*paling\s*bagus\b|\bsemua\s*orang\s*cocok\b/i;

const CHECKS = [["authorityAbsolute", AUTHORITY_ABSOLUTE_RE]];

// Sama bentuk kembalian dgn violations() (array kode kategori) — supaya
// pemanggil (toolsChat.js) bisa menggabungkan hasilnya dgn pola yang sama,
// tanpa perlu tahu detail internal masing-masing.
export function authorityStyleViolations(text = "") {
  return CHECKS.filter(([, re]) => re.test(text)).map(([k]) => k);
}
