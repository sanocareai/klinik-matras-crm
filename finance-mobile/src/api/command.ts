import { randomUUID } from "expo-crypto";
import { assertCan, type Need, type NeedMode } from "@/auth/capabilities";
import { useLock } from "@/auth/lock";
import { useSession } from "@/auth/session";
import { ModeBacaSaja, bacaSaja } from "@/lib/bacaSaja";

// PENJALAN PERINTAH KEUANGAN — satu-satunya jalur yang dipakai layar untuk mengubah data.
//   1. Capability guard: pengguna harus punya izin yang dibutuhkan (server tetap memeriksa ulang).
//   2. Step-up: aksi sensitif meminta biometrik/PIN bila unlock terakhir > 2 menit.
//   3. Idempotency-Key: satu UUID per niat pengguna. Untuk mencoba lagi setelah hasil "tidak pasti"
//      kirim ulang dengan `kunci` yang SAMA — server mengembalikan hasil pertama, bukan membuat ganda.
// Tidak ada antrean offline dan tidak ada optimistic update: setelah sukses, layar mengambil ulang dari server.

export class StepUpDibatalkan extends Error {
  constructor() {
    super("Konfirmasi dibatalkan. Perintah tidak dikirim.");
    this.name = "StepUpDibatalkan";
  }
}

export type OpsiPerintah<T> = {
  need: Need | Need[];
  mode?: NeedMode;
  /** true untuk aksi sensitif (setuju, verifikasi, bayar, transfer, kasbon, refund, batal/koreksi). */
  stepUp?: boolean;
  /** Pakai ulang kunci yang sama saat mengulang perintah yang hasilnya tidak pasti. */
  kunci?: string;
  run: (idempotencyKey: string) => Promise<T>;
};

export async function jalankanPerintah<T>(opsi: OpsiPerintah<T>): Promise<T> {
  // Build preview baca-saja: tidak ada perintah yang keluar dari aplikasi (lapisan kedua di atas tombol yang sudah dinonaktifkan).
  if (bacaSaja()) throw new ModeBacaSaja();
  assertCan(useSession.getState().capabilities, opsi.need, opsi.mode);
  if (opsi.stepUp) {
    const ok = await useLock.getState().requireStepUp();
    if (!ok) throw new StepUpDibatalkan();
  }
  return opsi.run(opsi.kunci ?? randomUUID());
}
