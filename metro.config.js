const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

config.resolver.alias = {
  '@': path.resolve(__dirname, 'src'),
};

// Register .html as an asset extension so epub-bridge.html can be loaded via Asset.fromModule
config.resolver.assetExts = [...(config.resolver.assetExts || []), 'html'];

module.exports = config;
