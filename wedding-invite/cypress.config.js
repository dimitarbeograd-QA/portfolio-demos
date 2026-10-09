const { defineConfig } = require('cypress');

module.exports = defineConfig({
  e2e: {
    baseUrl: 'http://localhost:3000',
    specPattern: 'tests/e2e/**/*.cy.js',
    supportFile: false,
    video: false,
    viewportWidth: 390,
    viewportHeight: 844
  }
});
