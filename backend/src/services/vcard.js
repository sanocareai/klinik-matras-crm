// Menyusun file .vcf (vCard) dari data pelanggan CRM.
//
// KENAPA INI ADA. Nama kontak di WhatsApp tersimpan di BUKU ALAMAT HP
// masing-masing, bukan di server WhatsApp — makanya nomor yang sama bisa
// tampil beda nama di HP orang berbeda. WAHA terhubung sebagai perangkat
// tertaut (linked device), jadi dia tidak punya buku alamat sendiri untuk
// ditulisi: SEMUA endpoint tulis kontak dijawab 404 (diverifikasi langsung
// ke WAHA production 16 Agt 2026 — PUT/POST/PATCH /api/contacts,
// /contacts/name, /contacts/rename, /contacts/update, /contacts/set-name,
// /addressbook). Ini BUKAN keterbatasan tier WAHA yang bisa diakali dengan
// upgrade; memang tidak ada jalannya.
//
// Jadi satu-satunya cara membuat nama CRM muncul di WhatsApp sales adalah
// memasukkannya ke buku alamat HP mereka. File .vcf ini jembatannya:
// diunduh dari CRM, diimpor sekali di HP, selesai.
//
// ⚠️ SIFATNYA SATU ARAH & MANUAL — dan itu harus dikatakan apa adanya di
// UI. Nama baru/berubah di CRM TIDAK otomatis menyusul ke HP; sales harus
// mengimpor ulang. Menjanjikan "sinkron" akan membuat orang percaya
// nomornya sudah update padahal belum.

/**
 * Escape nilai vCard sesuai RFC 6350 §3.4.
 * Backslash HARUS diproses paling awal, kalau tidak escape yang kita
 * tambahkan sendiri ikut ter-escape lagi (jadi ganda).
 */
function escapeNilai(teks) {
  return String(teks ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

/**
 * Lipat baris panjang jadi maksimal 75 oktet (RFC 6350 §3.2).
 *
 * Kebanyakan aplikasi kontak sebenarnya toleran terhadap baris panjang,
 * TAPI sebagian importir Android lama memotong diam-diam — dan nama yang
 * terpotong separuh lebih buruk daripada nama yang tidak masuk sama
 * sekali, karena kelihatan "berhasil".
 *
 * Dipotong per KARAKTER, bukan per byte: memotong di tengah karakter
 * multi-byte (nama ber-emoji atau aksara non-Latin) menghasilkan byte
 * rusak yang tampil jadi "�".
 */
function lipatBaris(baris) {
  if (baris.length <= 75) return baris;
  const potongan = [baris.slice(0, 75)];
  let sisa = baris.slice(75);
  while (sisa.length > 74) {
    potongan.push(" " + sisa.slice(0, 74));
    sisa = sisa.slice(74);
  }
  if (sisa.length) potongan.push(" " + sisa);
  return potongan.join("\r\n");
}

/** Nomor 628xxx -> +628xxx, bentuk internasional yang dikenali semua HP. */
function nomorInternasional(phone) {
  const angka = String(phone || "").replace(/\D/g, "");
  return angka ? `+${angka}` : null;
}

/**
 * Susun SATU kartu vCard.
 * @returns {string|null} null kalau pelanggan tidak layak diekspor.
 */
export function buatSatuVCard(customer, opsi = {}) {
  const { organisasi = "Klinik Matras" } = opsi;

  const tel = nomorInternasional(customer?.phone);
  if (!tel) return null;

  // Pelanggan TANPA nama sengaja dilewati. Kontak bernama "6281234567890"
  // tidak memberi informasi apa pun (nomornya toh sudah tampil sendiri di
  // WhatsApp) — cuma menambah ribuan baris sampah di HP sales.
  const nama = String(customer?.name || "").trim();
  if (!nama) return null;

  const baris = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    lipatBaris(`FN:${escapeNilai(nama)}`),
    // N (nama terstruktur) wajib ada di vCard 3.0. Nama pelanggan di CRM
    // adalah satu string bebas ("Bu Novi Bekasi"), TIDAK dipecah jadi
    // depan/belakang — menebak mana nama depan dari nama Indonesia sering
    // salah, dan hasilnya terbalik-balik di HP.
    lipatBaris(`N:;${escapeNilai(nama)};;;`),
    lipatBaris(`TEL;TYPE=CELL:${tel}`),
  ];

  // ORG dipakai supaya kontak hasil impor bisa dikenali & dihapus massal
  // dari HP kalau sales tidak mau lagi — tanpa penanda, mereka tercampur
  // permanen dengan kontak pribadi.
  if (organisasi) baris.push(lipatBaris(`ORG:${escapeNilai(organisasi)}`));

  baris.push("END:VCARD");
  return baris.join("\r\n");
}

/**
 * Susun seluruh isi file .vcf.
 * @returns {{isi: string, jumlah: number, dilewati: number}}
 */
export function buatFileVCard(customers, opsi = {}) {
  const kartu = [];
  let dilewati = 0;

  for (const c of customers || []) {
    const v = buatSatuVCard(c, opsi);
    if (v) kartu.push(v);
    else dilewati++;
  }

  return {
    // CRLF sesuai spesifikasi — sebagian importir iOS menolak file
    // ber-LF saja.
    isi: kartu.length ? kartu.join("\r\n") + "\r\n" : "",
    jumlah: kartu.length,
    dilewati,
  };
}
