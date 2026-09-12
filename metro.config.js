const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

/**
 * Keep Metro away from native build output and the Cloud Functions workspace — watching them
 * makes the file crawler (and therefore bundle serving) extremely slow on Windows.
 */
const escape = (p) => path.join(__dirname, p).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
config.resolver.blockList = [
  new RegExp(`^${escape('android')}\\\\.*`),
  new RegExp(`^${escape('ios')}\\\\.*`),
  new RegExp(`^${escape('functions')}\\\\.*`),
  new RegExp(`^${escape('artifacts')}\\\\.*`),
  new RegExp(`^${escape('references')}\\\\.*`),
  new RegExp(`^${escape('.firebase')}\\\\.*`),
];

module.exports = config;
