// Tinggi keyboard Android real-time via native event Keyboard core RN.
//
// KENAPA BUKAN andalkan KeyboardAvoidingView + windowSoftInputMode=
// adjustResize (app.json) SAJA: mekanisme itu TERBUKTI tidak reliable lagi
// di kombinasi Expo SDK 57 (RN 0.86) — Android sekarang menegakkan
// edge-to-edge secara default (lihat AGENTS.md: "Expo HAS CHANGED"), dan di
// bawah edge-to-edge, resize Activity native yang biasa dipakai adjustResize
// tidak lagi konsisten memicu relayout ke semua screen (khususnya yang
// dirender lewat react-native-screens/native-stack) MAUPUN ke konten di
// dalam <Modal> RN (Modal Android selalu bikin native Dialog/Window
// terpisah dari Activity, TIDAK PERNAH ikut adjustResize Activity-nya sama
// sekali — ini limitasi RN sejak dulu, bukan hal baru, lihat catatan lama di
// OrderFormModal.js). keyboardDidShow/Hide (BUKAN keyboardWillShow/Hide,
// yang cuma ada di iOS) dipakai karena app ini Android-only.
//
// Deteksi show/hide RN Android berbasis diff getWindowVisibleDisplayFrame —
// itu murni ukur perubahan area layar yang benar-benar tertutup IME, TIDAK
// bergantung ke adjustResize/adjustPan/edge-to-edge sama sekali, jadi hook
// ini tetap akurat walau mekanisme resize native di atas gagal/tidak konsisten.
import { useEffect, useState } from "react";
import { Keyboard } from "react-native";

export function useKeyboardHeight() {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const showSub = Keyboard.addListener("keyboardDidShow", (e) => {
      setHeight(e.endCoordinates?.height || 0);
    });
    const hideSub = Keyboard.addListener("keyboardDidHide", () => setHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  return height;
}
