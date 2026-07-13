// Reanimated v4: babel plugin pindah ke react-native-worklets/plugin
// (react-native-reanimated/plugin adalah nama LAMA untuk v2/v3).
// Plugin ini wajib PALING AKHIR di array plugins.
//
// Production build: strip semua console.* (log/warn/error/dst) lewat
// babel-plugin-transform-remove-console, supaya JS thread tidak numpuk kerja
// serialisasi argumen console di background/production sama sekali.
// SENGAJA dibangun sebagai array biasa (bukan lewat blok `env.production`
// babel) — babel MENGGABUNGKAN plugins env-specific SETELAH plugins
// top-level, yang akan menaruh transform-remove-console SETELAH worklets
// plugin di production dan melanggar aturan "worklets wajib paling akhir".
// Push manual di sini menjamin urutannya benar di SEMUA environment.
module.exports = function (api) {
  api.cache.using(() => process.env.NODE_ENV);
  const isProd = api.env('production');

  const plugins = [];
  if (isProd) plugins.push('transform-remove-console');
  plugins.push('react-native-worklets/plugin'); // WAJIB PALING AKHIR

  return {
    presets: ['babel-preset-expo'],
    plugins,
  };
};