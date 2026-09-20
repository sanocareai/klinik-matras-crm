import { useEffect, useState } from "react";
import { Keyboard, Platform } from "react-native";

/** Tinggi papan ketik (0 bila tertutup). Android edge-to-edge tidak mengecilkan jendela sendiri, jadi layar harus memberi ruang. */
export function useTinggiKeyboard(): number {
  const [tinggi, setTinggi] = useState(0);
  useEffect(() => {
    const a = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow", (e) => setTinggi(e.endCoordinates.height));
    const b = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide", () => setTinggi(0));
    return () => { a.remove(); b.remove(); };
  }, []);
  return tinggi;
}
