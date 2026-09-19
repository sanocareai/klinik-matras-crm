import { pbkdf2Async } from "@noble/hashes/pbkdf2";
import { sha256 } from "@noble/hashes/sha256";
import { getRandomBytes } from "expo-crypto";

// PIN 6 digit — dicek LOKAL, tidak pernah dikirim ke server dan TIDAK PERNAH disimpan mentah (PRD §11.4).
// Yang disimpan hanya verifier: PBKDF2-HMAC-SHA256 + salt acak, di expo-secure-store (Android Keystore).
//
// Iterasi: PBKDF2 murni-JS di Hermes (tanpa JIT) jauh lebih lambat daripada Node (Node: ±160 ms per
// 100.000 iterasi). Karena itu default 25.000 dan versi ASYNC (menyerahkan giliran ke UI) — supaya
// membuka kunci terasa cepat. Perlindungan utamanya bukan jumlah iterasi, melainkan: (1) verifier di
// Keystore, (2) jeda setelah percobaan salah, (3) data dihapus setelah 10 kali salah. Iterasi disimpan
// bersama verifier sehingga bisa dinaikkan kelak (setelah diukur di perangkat acuan) tanpa memutus PIN lama.

export const PIN_LENGTH = 6;
export const PIN_ITERATIONS = 25_000;

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const bytes = (h: string) => Uint8Array.from(h.match(/.{2}/g) ?? [], (x) => parseInt(x, 16));

export function pinValid(pin: string): boolean {
  return new RegExp(`^\\d{${PIN_LENGTH}}$`).test(pin);
}

/** PIN yang terlalu mudah ditebak (semua digit sama / berurutan). Ditolak saat membuat PIN. */
export function pinLemah(pin: string): boolean {
  if (!pinValid(pin)) return true;
  if (/^(\d)\1+$/.test(pin)) return true;
  const naik = "0123456789";
  const turun = "9876543210";
  return naik.includes(pin) || turun.includes(pin);
}

export type PinVerifier = { salt: string; hash: string; iterations: number };

async function turunkan(pin: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  return pbkdf2Async(sha256, new TextEncoder().encode(pin), salt, { c: iterations, dkLen: 32, asyncTick: 8 });
}

export async function buatVerifier(pin: string, opsi: { iterations?: number; salt?: Uint8Array } = {}): Promise<PinVerifier> {
  if (!pinValid(pin)) throw new Error(`PIN harus ${PIN_LENGTH} digit angka`);
  const iterations = opsi.iterations ?? PIN_ITERATIONS;
  const salt = opsi.salt ?? getRandomBytes(16);
  const hash = await turunkan(pin, salt, iterations);
  return { salt: hex(salt), hash: hex(hash), iterations };
}

/** Bandingkan dalam waktu konstan. */
export async function cekPin(pin: string, v: PinVerifier): Promise<boolean> {
  if (!pinValid(pin)) return false;
  const hitung = await turunkan(pin, bytes(v.salt), v.iterations);
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
