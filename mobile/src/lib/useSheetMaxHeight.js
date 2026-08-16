// Bottom-sheet yang benar-benar naik DI ATAS keyboard.
//
// MASALAH YANG DIPECAHKAN. Semua bottom-sheet di app ini memakai overlay
// `justifyContent: "flex-end"` — artinya sheet MENEMPEL di dasar layar.
// Keyboard juga muncul dari dasar layar, jadi bagian bawah sheet (kolom
// isian & tombol aksi) tertutup keyboard.
//
// ⚠️ MENGECILKAN TINGGI SAJA TIDAK CUKUP — ini kesalahan pada percobaan
// pertama (16 Agt 2026) yang membuat bug ini dilaporkan lagi. Sheet jadi
// lebih pendek, TAPI dasarnya tetap menempel di dasar layar, jadi tetap
// berada di belakang keyboard. Yang wajib ada adalah `paddingBottom`
// sebesar tinggi keyboard pada OVERLAY-nya — itu yang benar-benar
// MENDORONG sheet naik ke atas keyboard.
//
// Keduanya dipakai bersama:
//   overlay  -> paddingBottom: keyboardHeight   (mendorong naik)
//   sheet    -> maxHeight                        (membatasi tinggi)
//
// KENAPA BUKAN KeyboardAvoidingView: <Modal> Android SELALU membuat
// Dialog/Window terpisah dari Activity, jadi TIDAK PERNAH ikut
// windowSoftInputMode=adjustResize — dan di Expo SDK 57 (edge-to-edge
// default) mekanisme itu makin tidak konsisten. Lihat lib/useKeyboardHeight.js.
import { useWindowDimensions } from "react-native";
import { useKeyboardHeight } from "./useKeyboardHeight";

/**
 * @param {number} fraksi bagian tinggi layar yang boleh dipakai sheet saat
 *   keyboard TIDAK muncul (mis. 0.8 untuk "80%").
 * @returns {{maxHeight: number, keyboardHeight: number, overlayStyle: object}}
 *   `overlayStyle` siap di-spread ke style overlay — pakai itu supaya tidak
 *   ada pemanggil yang lupa bagian paddingBottom (penyebab bug pertama).
 */
export function useSheetMaxHeight(fraksi = 0.85) {
  // useWindowDimensions (bukan Dimensions.get sekali di module scope) —
  // supaya ikut benar saat layar diputar atau ukuran window berubah.
  const { height } = useWindowDimensions();
  const keyboardHeight = useKeyboardHeight();

  // Lantai 240px: pada layar pendek + keyboard tinggi, hasil pengurangan
  // bisa jadi sangat kecil atau negatif — sheet setinggi nol lebih buruk
  // daripada sheet yang sedikit tertutup, karena tidak ada apa pun yang
  // bisa dilihat atau ditekan.
  const maxHeight = Math.max(240, height * fraksi - keyboardHeight);

  return {
    maxHeight,
    keyboardHeight,
    overlayStyle: { paddingBottom: keyboardHeight },
  };
}
