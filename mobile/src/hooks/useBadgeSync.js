// Sinkron badge angka di ikon app (Notifications.setBadgeCountAsync) dengan
// total unread lintas percakapan. Dipasang SEKALI di App.js (pola sama
// dengan useSocketEvents.js), aktif selama user login.
//
// 2 pemicu update (sesuai spec):
// - "saat data berubah": subscribe langsung ke conversationStore, badge
//   ikut update tiap kali unreadCount berubah (pesan baru masuk / dibaca).
// - "saat app resume": AppState listener — perlu eksplisit karena OS bisa
//   saja sudah ubah data di background (push notification masuk) tanpa JS
//   listener sempat jalan, jadi begitu app aktif lagi kita paksa recompute.
import { useEffect } from "react";
import { AppState } from "react-native";
import { useConversationStore } from "../store/conversationStore";
import { updateBadgeCount } from "../push";

function computeTotalUnread(conversationsById) {
  return Object.values(conversationsById).reduce(
    (sum, c) => sum + (c.unreadCount ?? (c.unread ? 1 : 0)), 0
  );
}

export function useBadgeSync() {
  useEffect(() => {
    // PERF (19 Sep 2026): dulu tiap perubahan store (tiap pesan, tiap ack, tiap tandai-dibaca)
    // langsung menjumlahkan unread SELURUH percakapan (±1.400 entri) lalu memanggil API native
    // badge. Sekarang penjumlahan itu ditunda 400 ms — ledakan event beruntun (mis. sinkron ulang
    // daftar) cukup dihitung SEKALI — dan panggilan native dilewati kalau angkanya tidak berubah.
    let timer = null;
    let terakhir = -1;

    function hitung() {
      timer = null;
      const total = computeTotalUnread(useConversationStore.getState().conversationsById);
      if (total === terakhir) return;
      terakhir = total;
      updateBadgeCount(total);
    }
    function sync() {
      if (timer) return;
      timer = setTimeout(hitung, 400);
    }

    hitung();
    const unsubscribeStore = useConversationStore.subscribe(sync);
    const appStateSub = AppState.addEventListener("change", (state) => {
      if (state === "active") sync();
    });

    return () => {
      if (timer) clearTimeout(timer);
      unsubscribeStore();
      appStateSub.remove();
    };
  }, []);
}
