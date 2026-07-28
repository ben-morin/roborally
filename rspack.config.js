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
          // Replaces the `fourseven:scss` build plugin, which used to compile
          // every .scss file in the app eagerly. Under Rspack the stylesheets
          // are ordinary modules, so they are imported explicitly from
          // client/main.js — see the cascade-order comment there.
          //
          // Meteor auto-detects a configured SCSS loader after the first
          // compilation and stops processing .scss itself, so the stylesheets
          // need no .meteorignore entry.
          test: /\.scss$/i,
          use: [
            {
              loader: 'sass-loader',
              options: {
                api: 'modern-compiler',
                implementation: require.resolve('sass-embedded'),
                sassOptions: {
                  // Bootstrap 5.3 still calls the deprecated red()/green()/blue()
                  // functions, which Dart Sass reports on every build and
                  // webpack-dev-server then relays into the browser console.
                  // `quietDeps` mutes warnings from node_modules only, so
                  // warnings in client/stylesheets/** are still shown.
                  quietDeps: true,
                },
              },
            },
          ],
          type: 'css/auto',
        },
      ],
    },
  };
});
