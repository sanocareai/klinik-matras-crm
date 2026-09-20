import { useCallback, useRef, useState } from "react";
import { ApiError } from "@/api/errors";
import { bikinKunci, izinBerubah } from "@/api/approvals";
import { buatDokumen, jalankanAksiTx, type FormDokumen, type IsianAksi } from "@/api/transaksi";
import { haptic } from "@/design/haptics";
import { useMuatUlangTx } from "@/hooks/transaksi";
import { klasifikasiKeputusan, type InfoGalatKeputusan } from "@/features/persetujuan/galat";
import type { AksiTx } from "@/api/types";

export type HasilTx = { ok: true; id: string | null } | { ok: false; info: InfoGalatKeputusan };
const BATAL: HasilTx = { ok: false, info: { jenis: "batal", pesan: "", muatUlang: false, segarkanIzin: false, simpanKunci: true } };

/** Pada 409, pakai kalimat server (mis. "sudah diproses oleh …") bila ada. */
function ubahKonflik(e: unknown, dasar: InfoGalatKeputusan): InfoGalatKeputusan {
  return dasar.jenis === "konflik" && e instanceof ApiError && e.status === 409 && e.message ? { ...dasar, pesan: `${e.message} Status terbaru dimuat ulang.` } : dasar;
}

/**
 * Menjalankan SATU perintah dokumen (aksi atau buat baru) dengan aman:
 *   • `kunciSibuk` (sinkron) mengunci ulang-tap dan request paralel dari layar yang sama — double-tap tidak mengirim dua perintah;
 *   • satu Idempotency-Key per NIAT: dipakai ulang bila hasil sebelumnya tidak pasti (putus/timeout/5xx), diganti bila sudah pasti;
 *   • setelah sukses ATAU galat yang mengubah status (409/403/422/tidak pasti) semua data terkait diambil ulang dari server;
 *   • pada 409 pesan server ditampilkan karena memang ditulis untuk pengguna. Tidak ada antrean offline: tanpa koneksi perintah gagal sebelum terkirim.
 */
export function useAksiTx() {
  const [sibuk, setSibuk] = useState(false);
  const kunci = useRef<{ niat: string; nilai: string } | null>(null);
  const kunciSibuk = useRef(false);
  const muatUlang = useMuatUlangTx();

  const jalankanDenganKunci = useCallback(async (niat: string, kerja: (k: string) => Promise<string | null>): Promise<HasilTx> => {
    if (kunciSibuk.current) return BATAL;
    kunciSibuk.current = true;
    setSibuk(true);
    if (!kunci.current || kunci.current.niat !== niat) kunci.current = { niat, nilai: bikinKunci() };
    try {
      const id = await kerja(kunci.current.nilai);
      kunci.current = null;
      haptic.sukses();
      await muatUlang();
      return { ok: true, id };
    } catch (e) {
      const info = ubahKonflik(e, klasifikasiKeputusan(e));
      if (!info.simpanKunci) kunci.current = null;
      if (info.jenis !== "batal") haptic.galat();
      if (info.segarkanIzin) izinBerubah();
      if (info.muatUlang) await muatUlang().catch(() => undefined);
      return { ok: false, info };
    } finally {
      kunciSibuk.current = false;
      setSibuk(false);
    }
  }, [muatUlang]);

  /** Aksi pada dokumen yang sudah ada (ajukan, bayar, batalkan, ubah, lampiran, potong gaji, alokasi). */
  const aksi = useCallback((dokumen: string, kode: string, a: AksiTx, isian: IsianAksi = {}) => (
    jalankanDenganKunci(`${dokumen}:${kode}`, async (k) => { await jalankanAksiTx(kode, a, isian, k); return null; })
  ), [jalankanDenganKunci]);

  /** Membuat dokumen baru. `niat` = pengenal satu sesi formulir (kunci dipakai ulang bila hasil tidak pasti). */
  const buat = useCallback((niat: string, form: FormDokumen) => (
    jalankanDenganKunci(`buat:${niat}`, async (k) => (await buatDokumen(form, k)).id)
  ), [jalankanDenganKunci]);

  return { aksi, buat, sibuk };
}
