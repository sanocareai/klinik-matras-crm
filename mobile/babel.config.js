// Reanimated v4: babel plugin pindah ke react-native-worklets/plugin
// (react-native-reanimated/plugin adalah nama LAMA untuk v2/v3).
// Plugin ini wajib PALING AKHIR di array plugins.
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: ['react-native-worklets/plugin'],
  };
};