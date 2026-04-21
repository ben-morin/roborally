Package.describe({
  name: 'ben-morin:flow-router-global',
  summary: 'Exports FlowRouter (ostrio:flow-router-extra) as a global',
  version: '1.0.0'
});

Package.onUse(function (api) {
  api.use('ecmascript');
  api.use('ostrio:flow-router-extra');
  api.addFiles('export.js', 'client');
  api.export('FlowRouter', 'client');
});
