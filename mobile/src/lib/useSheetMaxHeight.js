// Tinggi maksimum bottom-sheet yang IKUT MENGECIL saat keyboard muncul.
//
// MASALAH YANG DIPECAHKAN. Bottom-sheet di app ini memakai maxHeight
// persentase ("80%", "88%"). Persentase itu dihitung dari tinggi LAYAR
// PENUH — yang tidak pernah berubah walau keyboard sedang menutupi
// separuh layar. Akibatnya isi sheet (kolom isian, tombol aksi di bawah)
// tertutup keyboard dan tidak bisa dijangkau sama sekali.
//
// KENAPA BUKAN KeyboardAvoidingView: <Modal> Android SELALU membuat
// Dialog/Window terpisah dari Activity, jadi TIDAK PERNAH ikut
// windowSoftInputMode=adjustResize — dan di Expo SDK 57 (edge-to-edge
// default) mekanisme itu makin tidak konsisten. Penjelasan lengkapnya ada
// di lib/useKeyboardHeight.js.
//
// Pendekatan di sini deterministik: ukur tinggi keyboard langsung dari
// event Keyboard, lalu KURANGKAN dari tinggi sheet. Sheet mengecil, header
// tetap terlihat, dan ScrollView di dalamnya otomatis jadi lebih pendek.
import { useWindowDimensions } from "react-native";
import { useKeyboardHeight } from "./useKeyboardHeight";

/**
 * @param {number} fraksi bagian tinggi layar yang boleh dipakai sheet saat
 *   keyboard TIDAK muncul (mis. 0.8 untuk "80%").
 * @returns {number} maxHeight dalam piksel, siap dipakai di style.
 */
export function useSheetMaxHeight(fraksi = 0.85) {
  // useWindowDimensions (bukan Dimensions.get sekali di module scope) —
  // supaya ikut benar saat layar diputar atau ukuran window berubah.
  const { height } = useWindowDimensions();
  const keyboardHeight = useKeyboardHeight();

  // Lantai 240px: pada layar pendek + keyboard tinggi, hasil pengurangan
  // bisa jadi sangat kecil atau negatif — sheet yang tingginya nyaris nol
  // lebih buruk daripada sheet yang sedikit tertutup, karena tidak ada
  // apa pun yang bisa dilihat atau ditekan.
  return Math.max(240, height * fraksi - keyboardHeight);
}
