// navigationRef terpisah dari App.js supaya modul lain (push.js,
// InAppBanner.js) bisa navigate tanpa import App.js balik (circular import).
import { createNavigationContainerRef } from "@react-navigation/native";

export const navigationRef = createNavigationContainerRef();

// Buka ChatScreen dari mana saja (tap notifikasi OS, tap in-app banner, dst)
// — dipakai bersama supaya logconnya SATU tempat, bukan diduplikasi di
// App.js/push.js/InAppBanner.js secara terpisah.
export function navigateToChat({ conversationId, name, isGroup = false, customerId }) {
  if (!conversationId || !navigationRef.isReady()) return;
  navigationRef.navigate("ChatRoom", { conversationId, name, isGroup, customerId });
}
