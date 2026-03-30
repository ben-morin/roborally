Package.describe({
  name: 'ben-morin:synced-cron-global',
  summary: 'Exports SyncedCron (quave:synced-cron) as a global',
  version: '2.3.0'
});

Package.onUse(function (api) {
  api.use('ecmascript');
  api.use('quave:synced-cron');
  api.addFiles('export.js', 'server');
  api.export('SyncedCron', 'server');
});
