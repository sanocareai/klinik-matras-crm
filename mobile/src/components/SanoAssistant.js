// Gabungan FAB + bottom sheet "Tanya Sano" — satu komponen siap-pasang,
// dipasang HANYA di HomeScreen.js (lihat CLAUDE.md §7D revisi 4 — dulu juga
// dipasang di ChatScreen.js, tapi FAB itu menutupi bubble pesan/composer di
// Inbox yang sudah punya mekanisme kirim sendiri, jadi dicopot total dari
// sana). context opsional: { customerName } — dititipkan ke SanoChatSheet
// utk disisipkan ke conversationHistory (lihat catatan di sana).
import React, { lazy, Suspense, useRef } from "react";
import SanoFab from "./SanoFab";

// Lazy (fix, audit startup): SanoChatSheet import react-native-markdown-
// display (render balasan AI berformat markdown) — HomeScreen (tab pertama
// yang tampil begitu login) memasang SanoAssistant ini SELALU, jadi TANPA
// lazy, cost require() markdown-display ikut dibayar di jalur kritis
// startup app walau sales belum tentu pernah buka "Tanya Sano" sama sekali.
// Suspense fallback={null} aman karena SanoChatSheet sendiri cuma bottom
// sheet TERSEMBUNYI sampai .open() dipanggil (pola sama dengan
// CustomerSheet.js) — tidak ada apa pun yang kelihatan berkedip.
const SanoChatSheet = lazy(() => import("./SanoChatSheet"));

export default function SanoAssistant({ bottomOffset = 16, context }) {
  const sheetRef = useRef(null);
  return (
    <>
      <SanoFab bottomOffset={bottomOffset} onPress={() => sheetRef.current?.open()} />
      <Suspense fallback={null}>
        <SanoChatSheet ref={sheetRef} context={context} />
      </Suspense>
    </>
  );
}
