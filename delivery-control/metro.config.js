// Paket bersama ada di ../packages/delivery-shared (di luar folder aplikasi), jadi
// Metro perlu diberi tahu untuk memantau & meresolusi folder itu. Tidak memakai
// npm workspaces karena repo ini memakai pola "folder aplikasi bersaudara"
// (finance-mobile, driver-mobile) dengan node_modules masing-masing.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const sharedRoot = path.resolve(projectRoot, "../packages/delivery-shared");

const config = getDefaultConfig(projectRoot);
config.watchFolders = [...(config.watchFolders || []), sharedRoot];
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, "node_modules")];
config.resolver.unstable_enableSymlinks = true;

module.exports = config;
