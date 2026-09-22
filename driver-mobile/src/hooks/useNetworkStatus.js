// Status koneksi (22 September 2026) — @react-native-community/netinfo
// SUDAH terpasang sebagai dependency sejak awal project tapi TIDAK PERNAH
// benar-benar dipakai di mana pun (dicek: nol referensi `NetInfo` di
// seluruh src/ sebelum file ini). Dibutuhkan supaya JobListScreen bisa
// membedakan "gagal memuat karena offline" (tampilkan badge "Offline —
// menampilkan data tersimpan") dari "gagal memuat karena error server"
// (pesan error biasa) — sebelum ini driver tidak dapat petunjuk apa pun
// kenapa datanya tidak berubah-ubah saat sinyal HP hilang di lapangan.
import { useEffect, useState } from "react";
import NetInfo from "@react-native-community/netinfo";

export function useNetworkStatus() {
  // Default true (bukan null/undefined) — asumsi online sampai NetInfo
  // sempat lapor sebaliknya, supaya tidak ada kedipan badge "Offline" palsu
  // sepersekian detik di setiap cold start normal (koneksi baik-baik saja).
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      // `isInternetReachable` bisa null di beberapa Android (belum sempat
      // dites) — fallback ke `isConnected` supaya tidak salah anggap
      // offline cuma karena NetInfo belum selesai probing.
      const online = state.isInternetReachable ?? state.isConnected ?? true;
      setIsOnline(online);
    });
    return unsubscribe;
  }, []);

  return isOnline;
}
