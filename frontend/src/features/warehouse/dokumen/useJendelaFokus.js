import { useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";

/**
 * Buka/tutup jendela fokus berbasis rute untuk halaman daftar Gudang (UX Gudang Tahap 4, pola sama dengan Penerimaan Barang).
 *  • `buka(id)` mendorong satu entri riwayat (URL detail berubah dan bisa dibagikan; daftar tetap terpasang di belakangnya).
 *  • `tutup()` mundur tepat ke daftar bila jendela dibuka dari daftar; bila halaman dibuka langsung dari URL detail, mengganti URL ke daftar (tanpa keluar dari aplikasi).
 * @param pathDaftar  path daftar tanpa /:id, mis. "/warehouse/transfers"
 * @param detail      (id) → path detail; default `${pathDaftar}/${id}`
 * @param saringan    string query saringan saat ini ("?tahap=…") yang dilampirkan ke URL jendela
 */
export function useJendelaFokus(pathDaftar, { detail, saringan = "" } = {}) {
  const navigate = useNavigate(); const jarak = useRef(0);
  const buka = useCallback((id, ekstra = "") => { jarak.current = 1; navigate(`${detail ? detail(id) : `${pathDaftar}/${id}`}${saringan}${ekstra}`); }, [navigate, pathDaftar, detail, saringan]);
  /** Buka URL jendela yang sudah jadi (mis. dari Beranda: /warehouse/dashboard/transfer/<id>?aksi=KIRIM). */
  const bukaUrl = useCallback((url) => { jarak.current = 1; navigate(url); }, [navigate]);
  const tutup = useCallback(() => {
    if (jarak.current > 0) { const n = jarak.current; jarak.current = 0; navigate(-n); } else navigate(`${pathDaftar}${saringan}`, { replace: true });
  }, [navigate, pathDaftar, saringan]);
  return { buka, bukaUrl, tutup };
}
