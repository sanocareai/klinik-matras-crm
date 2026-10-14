// Normalisasi nomor telepon/WhatsApp masukan manual → angka tanpa tanda ("628…"), SAMA dengan backend/src/lib/domain/pkrPembeli.js#normalisasiNomorTelepon.
// Dua berkas ini dijaga paritasnya oleh tes (frontend/tests/pkrPembeliLogic.test.js memuat vektor uji yang sama). Server tetap yang berwenang; ini hanya untuk umpan balik cepat.
export function normalisasiNomorTelepon(raw) {
  const teks = String(raw ?? "").trim();
  if (!teks) return { ok: false, galat: "Nomor WhatsApp/telepon wajib diisi" };
  if (/@/.test(teks)) return { ok: false, galat: "Isi nomor telepon biasa (bukan ID WhatsApp)" };
  const plus = teks.startsWith("+");
  const digit = teks.replace(/\D/g, "");
  if (!digit) return { ok: false, galat: "Nomor telepon tidak valid" };
  let nomor;
  if (plus) nomor = digit;
  else if (digit.startsWith("00")) nomor = digit.slice(2);
  else if (digit.startsWith("0")) nomor = `62${digit.slice(1)}`;
  else if (digit.startsWith("62")) nomor = digit;
  else if (digit.startsWith("8")) nomor = `62${digit}`;
  else return { ok: false, galat: "Format nomor tidak dikenali — awali dengan 08…, 62…, atau +kode negara" };
  if (nomor.startsWith("620")) nomor = `62${nomor.slice(3)}`;
  if (nomor.startsWith("62")) {
    if (nomor.length < 10 || nomor.length > 15) return { ok: false, galat: "Panjang nomor Indonesia tidak wajar (10–15 digit termasuk 62)" };
    if (!nomor.startsWith("628")) return { ok: false, galat: "Nomor seluler Indonesia diawali 08… / 628…" };
  } else if (nomor.length < 8 || nomor.length > 15) {
    return { ok: false, galat: "Panjang nomor internasional tidak wajar (8–15 digit)" };
  }
  return { ok: true, nomor };
}

/** Tampilan ramah: 6281211112222 → 0812-1111-2222 (hanya tampilan). */
export function tampilNomor(nomor) {
  const n = String(nomor ?? "");
  if (!n.startsWith("62") || n.length < 10) return n || "—";
  const lokal = `0${n.slice(2)}`;
  return `${lokal.slice(0, 4)}-${lokal.slice(4, 8)}-${lokal.slice(8)}`;
}
