import { pbkdf2 } from "@noble/hashes/pbkdf2";
import { sha256 } from "@noble/hashes/sha256";
import { getRandomBytes } from "expo-crypto";

// PIN 6 digit — dicek LOKAL, tidak pernah dikirim ke server (PRD §11.4).
// Verifier = PBKDF2-HMAC-SHA256 + salt acak. Iterasi disetel agar ≈ 300–500 ms di perangkat
// acuan (ukur di S2); tidak boleh kurang dari 100.000. Verifier disimpan di SecureStore.

export const PIN_LENGTH = 6;
export const PIN_ITERATIONS = 100_000;

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const bytes = (h: string) => Uint8Array.from(h.match(/.{2}/g) ?? [], (x) => parseInt(x, 16));

export function pinValid(pin: string): boolean {
  return new RegExp(`^\\d{${PIN_LENGTH}}$`).test(pin);
}

export type PinVerifier = { salt: string; hash: string; iterations: number };

export function buatVerifier(pin: string, opsi: { iterations?: number; salt?: Uint8Array } = {}): PinVerifier {
  if (!pinValid(pin)) throw new Error(`PIN harus ${PIN_LENGTH} digit angka`);
  const iterations = opsi.iterations ?? PIN_ITERATIONS;
  const salt = opsi.salt ?? getRandomBytes(16);
  const hash = pbkdf2(sha256, new TextEncoder().encode(pin), salt, { c: iterations, dkLen: 32 });
  return { salt: hex(salt), hash: hex(hash), iterations };
}

/** Bandingkan dalam waktu konstan. */
export function cekPin(pin: string, v: PinVerifier): boolean {
  if (!pinValid(pin)) return false;
  const hitung = pbkdf2(sha256, new TextEncoder().encode(pin), bytes(v.salt), { c: v.iterations, dkLen: 32 });
  const target = bytes(v.hash);
  if (hitung.length !== target.length) return false;
  let beda = 0;
  for (let i = 0; i < hitung.length; i++) beda |= (hitung[i] ?? 0) ^ (target[i] ?? 0);
  return beda === 0;
}

/**
 * Jeda setelah N kali salah berturut-turut: 5 → 30 dtk; 8 → 5 mnt; ≥10 → hapus sesi & data lokal.
 * Mengembalikan detik jeda, atau "hapus".
 */
export function jedaSetelahSalah(percobaanSalah: number): number | "hapus" {
  if (percobaanSalah >= 10) return "hapus";
  if (percobaanSalah >= 8) return 300;
  if (percobaanSalah >= 5) return 30;
  return 0;
}
