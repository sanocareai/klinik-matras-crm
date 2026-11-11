// Produksi menghapus semua console.* (sama seperti mobile/ dan driver-mobile/):
// tidak ada nominal/nama/token yang bisa bocor lewat log di build rilis.
module.exports = function (api) {
  api.cache.using(() => process.env.NODE_ENV);
  const isProd = api.env("production");
  return {
    presets: ["babel-preset-expo"],
    plugins: isProd ? ["transform-remove-console"] : [],
  };
};
