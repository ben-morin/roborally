// The Rspack plugin watches this exact path for its persistent-cache key and does not
// look for .mjs/.cjs, so the config stays CommonJS even though it is one object.
module.exports = { plugins: { '@tailwindcss/postcss': {} } };
