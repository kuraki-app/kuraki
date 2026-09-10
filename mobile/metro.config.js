const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const config = getDefaultConfig(__dirname);
// Pure presentation rules are shared with the Svelte client.
config.watchFolders = [path.resolve(__dirname, '../shared')];
module.exports = config;
