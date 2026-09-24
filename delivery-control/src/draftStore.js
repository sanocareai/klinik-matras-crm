import { useMemo } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createOfflineDraftStore } from "@sano/delivery-shared";
import { useSession } from "./SessionContext";

// Draf LOKAL biaya armada (belum dikirim) — antrean per pengguna di perangkat ini,
// memakai store bersama yang sama dengan rencana draf offline Driver (kunci penyimpanan
// terpisah dari antrean aksi job Driver).
export function useDraftStore() {
  const { user } = useSession();
  return useMemo(() => (user?.id ? createOfflineDraftStore({ storage: AsyncStorage, userId: user.id }) : null), [user?.id]);
}
