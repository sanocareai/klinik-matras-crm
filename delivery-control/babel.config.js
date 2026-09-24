// Production strip semua console.* lewat babel-plugin-transform-remove-console.
//
// react-native-worklets/plugin DIHAPUS (13 Sep 2026, audit performa) — plugin
// itu cuma perlu kalau react-native-reanimated/react-native-worklets dipakai;
// keduanya sudah di-uninstall dari package.json karena NOL pemakaian di
// seluruh src/ (dikonfirmasi lewat grep, bukan asumsi — app ini sama sekali
// tidak punya animasi lewat Animated/Reanimated). Reanimated menginisialisasi
// runtime JSI/worklet native-nya sendiri saat app start TERLEPAS dari dipakai
// atau tidak — menyimpannya "siapa tahu nanti dipakai" berarti membayar biaya
// startup native untuk fitur yang tidak pernah dipanggil sama sekali.
module.exports = function (api) {
  api.cache.using(() => process.env.NODE_ENV);
  const isProd = api.env('production');

  const plugins = [];
  if (isProd) plugins.push('transform-remove-console');

  return {
    presets: ['babel-preset-expo'],
    plugins,
  };
};
