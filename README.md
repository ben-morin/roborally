# roborally

Browser-based [RoboRally](https://en.wikipedia.org/wiki/RoboRally) board game implementation built with [Meteor 3](https://www.meteor.com).
It uses Blaze for templating and plain JavaScript for the game models, game logic and server methods. The app is written as
ES modules throughout and compiled with Meteor's modern build stack — Rspack for bundling, SWC for transpilation and minification.

## port

This project is a Meteor 3 port of the [blinkingnoise/roborally](https://github.com/blinkingnoise/roborally) Meteor 2 fork of the original
[marcelpanse/roborally](https://github.com/marcelpanse/roborally) Meteor-based project. The Meteor 3 version has some significant refactoring,
but the core game logic and models remain mostly unchanged. The main focus of this port is to update the codebase
to be compatible with Meteor 3 and modern dependencies. A new repository was created for this port to avoid
confusion with the original Meteor 1 and 2 versions.

Goals of this project:

- use the latest Meteor release (3.4.1 as of May 2026)
- modernize the codebase and update dependencies (done, except the Blaze/Bootstrap UI layer)
- stabilize gameplay
- run in docker

## running

With `docker compose`

```
services:
  mongo:
    restart: unless-stopped
    image: mongo:7.0
    container_name: mongo
    ports:
      - 27017:27017
    volumes:
      - mongo-data:/data/db
    networks:
      - rrnet

  roborally:
    restart: unless-stopped
    image: yieldtoben/roborally:latest
    container_name: roborally
    ports:
      - 3000:3000
    depends_on:
      - mongo
    environment:
      - MONGO_URL=mongodb://mongo:27017/roborally
      - ROOT_URL=http://localhost:3000
#      - MAIL_URL='smtp://user:password@mailhost:port/'
      - >
        METEOR_SETTINGS={
          "ALLOWED_EMAILS": [],
          "ALLOWED_DOMAINS": [],
          "VERIFY_EMAILS": false,
          "MAIL_FROM": ""
        }
    networks:
      - rrnet
volumes:
  mongo-data:

networks:
  rrnet:
    driver: bridge
```

## development

Requires Meteor 3.4. `meteor npm` and `meteor node` run npm and node from Meteor's own toolchain,
which is what the scripts below expect.

```
meteor npm install
meteor run
```

The dev server listens on `http://localhost:3000` and starts its own MongoDB. Rspack runs a second
HMR server on `:8080` alongside it. Blaze templates do not hot-patch under Rspack — every edit
triggers a full page reload instead, normally visible in well under a second.

To develop against the Docker image instead, which mounts the source for live reload:

```
docker compose -f docker-compose-dev.yml up
```

Wipe the build artifacts with `rm -rf _build .meteor/local`, or add `node_modules package-lock.json`
for a full clean.

### tests

```
meteor npm test
meteor npm run test:watch
```

A [vitest](https://vitest.dev) suite covering the game model: board composition and wall/movement
queries, deck composition and dealing, movement/conveyor/gear/pusher/laser resolution, and the phase
machine. The tests import the ES modules directly and need no Meteor, no MongoDB and no network, so
the suite runs in a fraction of a second and is CI-ready as-is.

Two things it does not do. It never builds a bundle, evaluates a stylesheet or loads a Blaze
template, so it stays green through a broken build-config change and is no evidence about one — a
browser is the only oracle there. And `client/` and `server/` have no automated coverage at all.

### lint and format

```
meteor npm run lint
meteor npm run format
```

ESLint treats `no-undef` as an error. Every app symbol is an ES module export, so a reintroduced
implicit global fails the lint rather than waiting to surface as a runtime `ReferenceError`. Both
commands should stay at zero errors and zero warnings.

## links

- docker hub: [yieldtoben/roborally](https://hub.docker.com/r/yieldtoben/roborally)
- github: [ben-morin/roborally](https://github.com/ben-morin/roborally)

## license

GNU General Public License (GPL) 2.0
