const { defineConfig } = require('@playwright/test');
const path = require('path');

// CHROMIUM_PATH is optional: set it to use an already installed Chromium.
const exe = process.env.CHROMIUM_PATH || undefined;

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30000,
  reporter: [['list']],
  use: {
    baseURL: 'file://' + path.resolve(__dirname, 'index.html'),
    viewport: { width: 360, height: 780 },
    hasTouch: true,
    launchOptions: exe ? { executablePath: exe } : {},
  },
});
