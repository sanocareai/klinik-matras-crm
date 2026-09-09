// Sama persis dengan mobile/babel.config.js (Sano Messenger) — Reanimated v4
// (plugin di react-native-worklets/plugin, BUKAN react-native-reanimated/
// plugin lama), WAJIB paling akhir di array plugins. Production strip semua
// console.* lewat babel-plugin-transform-remove-console.
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
