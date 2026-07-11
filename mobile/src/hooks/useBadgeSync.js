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
    function sync() {
      updateBadgeCount(computeTotalUnread(useConversationStore.getState().conversationsById));
    }

    sync();
    const unsubscribeStore = useConversationStore.subscribe(sync);
    const appStateSub = AppState.addEventListener("change", (state) => {
      if (state === "active") sync();
    });

    return () => {
      unsubscribeStore();
      appStateSub.remove();
    };
  }, []);
}
