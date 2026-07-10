// Fase M-D: @gorhom/bottom-sheet butuh react-native-reanimated, yang wajib
// plugin babel ini (harus paling akhir di array plugins — lihat dok resmi
// Reanimated). Sebelum ini project TIDAK punya babel.config.js sama sekali
// (Expo CLI resolve babel-preset-expo secara internal) — sekarang wajib
// eksplisit karena kita butuh menambahkan plugin custom.
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    plugins: ["react-native-reanimated/plugin"],
  };
};
