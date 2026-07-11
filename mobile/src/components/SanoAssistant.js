// Gabungan FAB + bottom sheet "Tanya Sano" — satu komponen siap-pasang,
// dipasang di HomeScreen.js dan ChatScreen.js (spec: muncul di kedua layar
// itu saja). context opsional: { customerName } — dititipkan ke
// SanoChatSheet utk disisipkan ke conversationHistory (lihat catatan di
// sana), HANYA relevan saat dipasang dari ChatScreen.
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
