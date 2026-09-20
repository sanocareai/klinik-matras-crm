import { ENV } from "@/lib/env";

// MODE BACA-SAJA (build preview yang mengarah ke API produksi). Semua perintah uang dinonaktifkan di UI dan ditolak di jalur perintah klien.
// INI BUKAN KEAMANAN: penjaga sebenarnya tetap izin & aturan di backend. Tujuannya mencegah salah ketuk saat uji di data produksi.
export const PESAN_BACA_SAJA = "Build preview hanya untuk pengujian baca";
export const bacaSaja = (): boolean => ENV.readOnly;

export class ModeBacaSaja extends Error {
  constructor() {
    super(PESAN_BACA_SAJA);
    this.name = "ModeBacaSaja";
  }
}
