import { useCallback, useRef, useState } from "react";
import { ApiError } from "@/api/errors";
import { bikinKunci, izinBerubah } from "@/api/approvals";
import { putuskanBayar } from "@/api/pembayaran";
import { haptic } from "@/design/haptics";
import { useMuatUlangPembayaran } from "@/hooks/pembayaran";
import { klasifikasiKeputusan, type InfoGalatKeputusan } from "@/features/persetujuan/galat";
import type { AksiPembayaran } from "@/api/types";

export type HasilBayar = { ok: true } | { ok: false; info: InfoGalatKeputusan };

/**
 * Menjalankan SATU keputusan pembayaran (verifikasi/tolak) dengan aman:
 *   • `kunciSibuk` (sinkron) mengunci ulang-tap dan request paralel dari layar yang sama — double-tap tidak mengirim dua perintah;
 *   • satu Idempotency-Key per NIAT: dipakai ulang bila hasil sebelumnya tidak pasti (putus/timeout/5xx), diganti bila sudah pasti;
 *   • setelah sukses ATAU galat yang mengubah status (409/403/422/tidak pasti) semua data pembayaran diambil ulang dari server;
 *   • pada 409 pesan server ditampilkan ("sudah diverifikasi oleh …") karena memang ditulis untuk pengguna.
 * Tidak ada antrean offline: tanpa koneksi perintah gagal sebelum terkirim.
 */
export function useKeputusanBayar() {
  const [sibuk, setSibuk] = useState(false);
  const kunci = useRef<{ dokumen: string; aksi: string; nilai: string } | null>(null);
  const kunciSibuk = useRef(false);
  const muatUlang = useMuatUlangPembayaran();

  const kirim = useCallback(async (pembayaranId: string, jenisAksi: "verifikasi" | "tolak", aksi: AksiPembayaran, alasan?: string): Promise<HasilBayar> => {
    if (kunciSibuk.current) return { ok: false, info: { jenis: "batal", pesan: "", muatUlang: false, segarkanIzin: false, simpanKunci: true } };
    kunciSibuk.current = true;
    setSibuk(true);
    if (!kunci.current || kunci.current.dokumen !== pembayaranId || kunci.current.aksi !== jenisAksi) {
      kunci.current = { dokumen: pembayaranId, aksi: jenisAksi, nilai: bikinKunci() };
    }
    try {
      await putuskanBayar({ aksi, alasan, kunci: kunci.current.nilai });
      kunci.current = null;
      haptic.sukses();
      await muatUlang();
      return { ok: true };
    } catch (e) {
      const dasar = klasifikasiKeputusan(e);
      const info = dasar.jenis === "konflik" && e instanceof ApiError && e.status === 409 && e.message
        ? { ...dasar, pesan: `${e.message} Status terbaru dimuat ulang.` }
        : dasar;
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

  return { kirim, sibuk };
}
