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

// D-030 paritas mobile (21 Agustus 2026) — buka "Rincian Pesanan"
// (OrderTimelineScreen.js) dari OrderCard.js, yang dipakai di DUA konteks
// berbeda (OrdersScreen.js order-lintas-pelanggan, dan
// CustomerProfileContent.js dalam profil 1 pelanggan) — pakai navigationRef
// global di sini alih-alih prop-drilling `navigation` lewat kedua parent
// itu, pola SAMA dengan navigateToChat di atas.
export function navigateToOrderTimeline({ orderId, orderNumber, customerName }) {
  if (!orderId || !navigationRef.isReady()) return;
  navigationRef.navigate("OrderTimeline", { orderId, orderNumber, customerName });
}
