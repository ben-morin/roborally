const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

const UNITS = [
  ['year', 31536000],
  ['month', 2592000],
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60],
  ['second', 1],
];

Template.registerHelper('formatDate', function (timestamp) {
  const seconds = (timestamp - Date.now()) / 1000;
  for (const [unit, secondsPerUnit] of UNITS) {
    if (Math.abs(seconds) >= secondsPerUnit || unit === 'second') {
      return rtf.format(Math.round(seconds / secondsPerUnit), unit);
    }
  }
});
