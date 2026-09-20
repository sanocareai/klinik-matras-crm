import { useCallback, useRef, useState } from "react";
import { bikinKunci, izinBerubah, putuskan } from "@/api/approvals";
import { haptic } from "@/design/haptics";
import { useMuatUlangPersetujuan } from "@/hooks/approvals";
import type { AksiKeputusan } from "@/api/types";
import { klasifikasiKeputusan, type InfoGalatKeputusan } from "./galat";

export type HasilKeputusan = { ok: true } | { ok: false; info: InfoGalatKeputusan };

/**
 * Menjalankan SATU keputusan dengan aman:
 *   • `sibuk` mengunci ulang-tap (double-tap tidak mengirim dua perintah);
 *   • satu Idempotency-Key per NIAT: dipakai ulang bila hasil sebelumnya tidak pasti (timeout/putus/5xx), diganti bila sudah pasti;
 *   • setelah sukses ATAU galat yang mengubah status (409/403/422/tidak pasti) semua data persetujuan diambil ulang dari server.
 */
export function useKeputusan() {
  const [sibuk, setSibuk] = useState(false);
  const kunci = useRef<{ dokumen: string; aksi: string; nilai: string } | null>(null);
  const kunciSibuk = useRef(false); // sinkron — state React terlambat satu render untuk tap yang sangat cepat
  const muatUlang = useMuatUlangPersetujuan();

  const kirim = useCallback(async (dokumenId: string, jenisAksi: "setujui" | "tolak", aksi: AksiKeputusan, alasan?: string): Promise<HasilKeputusan> => {
    if (kunciSibuk.current) return { ok: false, info: { jenis: "batal", pesan: "", muatUlang: false, segarkanIzin: false, simpanKunci: true } };
    kunciSibuk.current = true;
    setSibuk(true);
    if (!kunci.current || kunci.current.dokumen !== dokumenId || kunci.current.aksi !== jenisAksi) {
      kunci.current = { dokumen: dokumenId, aksi: jenisAksi, nilai: bikinKunci() };
    }
    try {
      await putuskan({ aksi, alasan, kunci: kunci.current.nilai });
      kunci.current = null;
      haptic.sukses();
      await muatUlang();
      return { ok: true };
    } catch (e) {
      const info = klasifikasiKeputusan(e);
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
