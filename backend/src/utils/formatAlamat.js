// Perapi tulisan alamat customer — SENGAJA "best effort", bukan parser
// alamat penuh. Alamat yang diketik sales/customer sering berantakan (huruf
// kecil semua, singkatan nempel angka seperti "rt003", dll) dan itu kelihatan
// tidak profesional kalau langsung ditempel apa adanya di invoice PDF.
//
// PENTING: fungsi ini CUMA dipakai untuk TAMPILAN (PDF/preview) — TIDAK
// PERNAH menulis balik ke Order.deliveryAddress/Customer di database. Kalau
// hasilnya aneh untuk satu alamat tertentu, datanya sendiri di CRM tetap
// utuh apa adanya, cuma tampilan PDF-nya yang kurang rapi — bukan korupsi
// data. Daftar singkatan SENGAJA kecil & eksplisit, bukan coba menebak
// segala kemungkinan — tambah manual kalau ketemu pola baru yang sering.
const SINGKATAN_ALAMAT = {
  jl: "Jl.",
  jln: "Jl.",
  gg: "Gg.",
  no: "No.",
  kel: "Kel.",
  kec: "Kec.",
  kab: "Kab.",
  kelurahan: "Kelurahan",
  kecamatan: "Kecamatan",
  komp: "Komp.",
  kompl: "Komp.",
  blk: "Blok",
  rt: "RT",
  rw: "RW",
};

export function formatAlamat(input) {
  if (!input) return input;
  let s = input.trim().replace(/\s+/g, " ");

  // "rt003" / "RW008" (nempel tanpa spasi) → "rt 003" / "RW 008" — pola yang
  // paling sering ditemukan dari input customer/sales manual.
  s = s.replace(/\b(rt|rw)(\d)/gi, "$1 $2");

  return s
    .split(" ")
    .map((token) => {
      // Pisahkan tanda baca di depan/belakang kata inti (kurung, koma, titik)
      // supaya tidak ikut ke-lowercase/uppercase — "(dibelakang" tetap
      // "(Dibelakang", "kuning)," tetap "Kuning),".
      const m = token.match(/^(\W*)([A-Za-z0-9]+)(\W*)$/);
      if (!m) return token;
      const [, depan, inti, belakang] = m;

      if (/^\d+$/.test(inti)) return token; // murni angka — biarkan (no. rumah, kode pos, dst)

      const lower = inti.toLowerCase();
      if (SINGKATAN_ALAMAT[lower]) {
        // Kalau tanda baca belakang cuma titik (mis. "no." → inti="no",
        // belakang="."), jangan dobel titik — singkatan sudah bawa titiknya
        // sendiri di SINGKATAN_ALAMAT.
        const sisaBelakang = belakang.replace(/^\.+/, "");
        return depan + SINGKATAN_ALAMAT[lower] + sisaBelakang;
      }

      // Token semua huruf besar & lebih dari 1 huruf (mis. "III" angka romawi,
      // atau kode blok "RT5") — anggap sengaja, jangan disentuh.
      if (inti === inti.toUpperCase() && inti.length > 1) return token;

      return depan + inti.charAt(0).toUpperCase() + inti.slice(1).toLowerCase() + belakang;
    })
    .join(" ");
}
