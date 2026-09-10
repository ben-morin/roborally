const { defineConfig } = require('@meteorjs/rspack');

/**
 * Rspack configuration for Meteor projects.
 *
 * Provides typed flags on the `Meteor` object, such as:
 * - `Meteor.isClient` / `Meteor.isServer`
 * - `Meteor.isDevelopment` / `Meteor.isProduction`
 * - …and other flags available
 *
 * Use these flags to adjust your build settings based on environment.
 */
module.exports = defineConfig(() => {
  return {
    module: {
      rules: [
        {
          // The plugin turns on Rspack's native CSS and installs no PostCSS loader, so
          // Tailwind needs this rule to see the stylesheets at all (see postcss.config.js).
          // Every stylesheet is plain CSS: the game rules use native nesting and the
          // @theme custom properties, so there is no preprocessor.
          test: /\.css$/i,
          use: ['postcss-loader'],
          type: 'css',
        },
      ],
    },
  };
});
