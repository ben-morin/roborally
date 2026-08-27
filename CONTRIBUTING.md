# contributing

Thanks for taking an interest in [roborally](README.md). This is a small, single-maintainer
project — a Meteor 3 port of an older Meteor 1/2 game — so the process is deliberately light.

Bug reports and fixes are the most useful contributions. Before starting anything large, please
open an issue first so we can agree on the shape of it; a rewrite nobody asked for is no fun to
receive or to decline.

## how to contribute

1. **Fork** the repo and clone your fork.
2. **Branch** off `main`. Any name is fine.
3. **Make the change.** Keep it focused — one concern per pull request. A small PR gets reviewed;
   a large mixed one stalls.
4. **Check it locally** before pushing:

   ```
   meteor npm run lint
   meteor npm run format
   meteor npm test
   ```

   All three must be clean. `format` rewrites files, so re-check `git status` afterwards. The
   browser smoke test (`meteor npm run test:e2e`, see [tests](#tests)) is optional locally — CI
   runs it on every PR — but worth a run if you touched the build config, a stylesheet or a
   template.

5. **Open a pull request against `main`.** Say what changed and why. If it fixes an issue, link it.
6. **CI runs automatically** — lint, format, the vitest suite, the browser smoke test, and a full
   production Docker build. All of it must pass. See [ci](#ci) below for what each job does.

Some things worth knowing:

- **`Rules.pdf` is the reference, not the whole story.** RoboRally is an existing board game and
  the rulebook in the repo is what the game aims at. The port does already differ from it in
  places — some deliberate, some forced by the limits of the implementation — and those are meant
  to be revisited over time. So a mismatch is not automatically a bug: please open an issue and
  ask before "correcting" one, since the existing behaviour may be load-bearing.
- **Match the surrounding style.** No implicit globals — every shared symbol is an ES module
  export, and ESLint treats `no-undef` as an error.
- **Tests are welcome** anywhere, and expected for game-logic changes. The suite needs no Meteor
  and no MongoDB, so adding a case is cheap.
- **Releases are cut by the maintainer.** You do not need to bump a version or tag anything.
- **Licence.** This project is GPL-2.0. By contributing you agree your work ships under it.

## development setup

Requires Meteor 3.5. `meteor npm` and `meteor node` run npm and node from Meteor's own toolchain,
which is what the scripts below expect.

```
meteor npm install
meteor run
```

The dev server listens on `http://localhost:3000` and starts its own MongoDB, as a single-node
replica set on `:3001`. Rspack runs a second HMR server on `:8080` alongside it. Blaze templates do
not hot-patch under Rspack — every edit triggers a full page reload instead, normally visible in
well under a second.

For settings, copy `settings-dev.json.example` to `settings-dev.json` (gitignored) and run
`meteor npm run dev`, which is `meteor run --settings settings-dev.json`.

To develop against the Docker image instead, which mounts the source for live reload:

```
docker compose -f docker-compose-dev.yml up --build
```

That image is `node:24` with Meteor installed from `.meteor/release`, so the project pin is the
single source of truth and a version bump touches one file. It listens on 3000 and 8080. Its
entrypoint passes
`--settings $SETTINGS_FILE` (default `settings-dev.json`) to `meteor run` when the file exists, so
settings stay reactive there too; an inline `METEOR_SETTINGS` still wins if you set one.

`node_modules` and `.meteor/local` live in named volumes rather than in the bind mount, because
their native bindings and toolchain symlinks are platform-specific and the host's macOS copies do
not work inside the container. Docker only seeds a volume from the image while the volume is empty,
so after changing `package.json` the volumes have to be dropped:

```
docker compose -f docker-compose-dev.yml down -v
docker compose -f docker-compose-dev.yml up --build
```

`down -v` takes the dev mongo volumes with it. To keep the database, drop just the two:
`docker volume rm roborally_dev-node-modules roborally_dev-meteor-local`.

Wipe the build artifacts with `rm -rf _build .meteor/local`, or add `node_modules package-lock.json`
for a full clean.

## mongo reactivity

`server/mongoReactivity.js` pins the observe-driver order to `oplog > polling`, overriding the
Change Streams default that Meteor 3.5 introduced. The Change Streams driver does not retire the DDP
write fence when a write targets a collection carrying a filtered observe the written document does
not match, which hangs account signup on the login spinner forever. Only absent values are filled
in, so `--settings`, `METEOR_SETTINGS` and `METEOR_REACTIVITY_ORDER` still win. The startup log
reports the configured order and the driver behind each live observe. Delete the file once the
upstream bug is fixed.

## tests

Two suites, both under `test/`.

### unit and integration — vitest

```
meteor npm test
meteor npm run test:watch
```

A [vitest](https://vitest.dev) suite (`test/both`, `test/server`, `test/client`) covering the game
model — board composition and wall/movement queries, deck composition and dealing,
movement/conveyor/gear/pusher/laser resolution, the phase machine — plus the server methods,
publications, cron jobs and account rules through a small Meteor shim (`test/setup.js`), and the
Blaze helpers and event handlers through a `Template` capture (`test/clientSetup.js`). The tests
import the ES modules directly and need no Meteor, no MongoDB and no network, so the whole suite
runs in about a second. Its config is `test/vitest.config.mjs`.

What it cannot see: it never builds a bundle, evaluates a stylesheet or renders a Blaze template,
so it stays green through a broken build-config change. That is what the next suite is for.

### browser smoke test — Playwright

```
meteor npm run e2e:install   # once per machine: downloads Chromium
meteor npm run test:e2e
```

One [Playwright](https://playwright.dev) journey, `test/e2e/smoke.spec.js`: a fresh account signs
up, creates a game, changes the board, starts a solo game, programs five cards and watches the first
register resolve, with one computed-style assertion per stylesheet layer and a check that the
browser logged no errors. It is the only test that sees the build.

`test:e2e` starts `meteor run --settings test/e2e/settings.json` itself, waits for port 3000, runs
the journey and shuts the server down again — about 15 seconds when the build cache is warm. Port
3000 must be free, so stop a running dev server first. For a faster loop, start that exact command
in another terminal and re-run `test:e2e` as often as you like; Playwright reuses a server it finds
on 3000. Do not point it at `meteor npm run dev`, though: if your `settings-dev.json` has an email
allowlist, the sign-up step fails with a 403.

On a failure the HTML report opens with a trace of the run. Reports and traces land in
`test/e2e/playwright-report/` and `test/e2e/test-results/`, both gitignored.
`meteor npm run test:e2e:ui` opens Playwright's UI mode. After a `@playwright/test` version bump,
run `e2e:install` again so the browser matches.

## lint and format

```
meteor npm run lint
meteor npm run format
```

ESLint treats `no-undef` as an error. Every app symbol is an ES module export, so a reintroduced
implicit global fails the lint rather than waiting to surface as a runtime `ReferenceError`. Both
commands should stay at zero errors and zero warnings.

## ci

Three GitHub Actions workflows gate a change, in `.github/workflows/` (a fourth,
`dockerhub-description.yml`, only syncs the Docker Hub description from `README.md` on pushes to
`main`):

- `ci.yml` — on every push to `main` and every PR. Runs `npm ci`, `npm run lint`,
  `npm run format:check` and `npm test` on Node 24. No Meteor, no Docker, no MongoDB: the vitest
  suite shims Meteor, so plain `npm` is enough and the job takes well under a minute.
- `image.yml` — on every PR, builds the production `Dockerfile` for `linux/amd64` and throws the
  result away. This is the only check that catches a broken `meteor build`; the vitest suite
  cannot. On a `v*` tag it builds both architectures and publishes the image to Docker Hub;
  releases are cut by the maintainer.
- `e2e.yml` — on every push to `main` and every PR. Installs Meteor from `.meteor/release` and
  Chromium, then runs the Playwright smoke test against `meteor run` on the runner — a little under
  two minutes end to end, most of it downloads. The HTML report is uploaded as a workflow artifact;
  after a failure it carries the trace.

Dependabot runs weekly against npm and the actions, grouped into one PR per group. `@rspack/cli`
and `@rspack/core` majors are ignored — Rspack 2 breaks `meteor build`, because `@meteorjs/rspack`
still emits `meteor/<package>` externals as bare identifiers under it. The reason and the removal
condition are in `.github/dependabot.yml`.
