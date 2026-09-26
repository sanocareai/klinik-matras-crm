// Logika murni Pengaturan (tanpa React Native) — dapat diuji di Node.
export const MODE_TEMA = ["system", "light", "dark"];
export const LABEL_TEMA = { system: "Ikuti sistem", light: "Terang", dark: "Gelap" };
export const PILIHAN_AUTO_LOCK = [1, 2, 5, 15]; // menit
export const AUTO_LOCK_BAWAAN = 5;

export const normalisasiTema = (v) => (MODE_TEMA.includes(v) ? v : "system");
export const normalisasiAutoLock = (v) => (PILIHAN_AUTO_LOCK.includes(Number(v)) ? Number(v) : AUTO_LOCK_BAWAAN);
export const labelAutoLock = (m) => `${m} menit`;

/** Tema efektif: "light" | "dark". `sistem` = skema warna sistem HP (bisa null). */
export function temaEfektif(mode, sistem) {
  const m = normalisasiTema(mode);
  if (m === "light" || m === "dark") return m;
  return sistem === "dark" ? "dark" : "light";
}
