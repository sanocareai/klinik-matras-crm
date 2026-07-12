// Gabungan FAB + bottom sheet "Tanya Sano" — satu komponen siap-pasang,
// dipasang HANYA di HomeScreen.js (lihat CLAUDE.md §7D revisi 4 — dulu juga
// dipasang di ChatScreen.js, tapi FAB itu menutupi bubble pesan/composer di
// Inbox yang sudah punya mekanisme kirim sendiri, jadi dicopot total dari
// sana). context opsional: { customerName } — dititipkan ke SanoChatSheet
// utk disisipkan ke conversationHistory (lihat catatan di sana).
import React, { useRef } from "react";
import SanoFab from "./SanoFab";
import SanoChatSheet from "./SanoChatSheet";

export default function SanoAssistant({ bottomOffset = 16, context }) {
  const sheetRef = useRef(null);
  return (
    <>
      <SanoFab bottomOffset={bottomOffset} onPress={() => sheetRef.current?.open()} />
      <SanoChatSheet ref={sheetRef} context={context} />
    </>
  );
}
