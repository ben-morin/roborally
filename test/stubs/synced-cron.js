// Resolves `meteor/quave:synced-cron` for server/cron.ts. Instead of scheduling, this
// records each job by name so a test can invoke its body directly — the three cron jobs
// hold real cleanup logic (abandoned games, inactive users, highscore rebuilds) that is
// otherwise unreachable without waiting out a schedule.
const jobs = new Map();
let started = false;

export const SyncedCron = {
  config() {},
  add(job) {
    jobs.set(job.name, job);
  },
  start() {
    started = true;
  },
  stop() {
    started = false;
  },
  remove(name) {
    jobs.delete(name);
  },
};

export function registeredCronJobs() {
  return [...jobs.keys()];
}

export function cronStarted() {
  return started;
}

/** Run a cron job's body. Names must match server/cron.ts exactly. */
export function runCronJob(name) {
  const job = jobs.get(name);
  if (!job) {
    throw new Error(
      `No cron job named "${name}". Registered: ${[...jobs.keys()].join(', ') || '(none)'}`
    );
  }
  return job.job();
}

/**
 * The human schedule string, e.g. 'every 1 hour'. server/cron.ts expresses schedules as
 * `(parser) => parser.text('...')`, so this replays that callback with a probe.
 */
export function cronSchedule(name) {
  const job = jobs.get(name);
  if (!job) throw new Error(`No cron job named "${name}"`);
  return job.schedule({ text: (s) => s });
}
