########################
### Builder
########################

FROM node:24 AS build

# allows meteor to build in docker VM with 2GB runtime memory
# ENV TOOL_NODE_FLAGS "--max-old-space-size=1920 --optimize_for_size --gc-interval=100"

ENV METEOR_ALLOW_SUPERUSER=1
ENV BROWSERSLIST_IGNORE_OLD_DATA=1
ENV METEOR_DISABLE_OPTIMISTIC_CACHING=1
ENV METEOR_WATCH_FORCE_POLLING=true

ENV CXXFLAGS=-std=gnu++17
RUN curl https://install.meteor.com/\?release\=3.5.1 | sh

WORKDIR /usr/app

COPY . /usr/app

# Warm up the Meteor tool before any `meteor npm` call. The first meteor
# invocation in a cold image runs its own first-time setup, during which
# `meteor npm ci` silently installs only the production tree (and still exits
# 0, so a `|| meteor npm install` fallback never fires). That leaves
# node_modules without @meteorjs/rspack, and the build below then dies with
# "Could not find rspack.config.js" — the config ships inside that package.
RUN meteor --version
RUN meteor npm ci || meteor npm install

RUN mkdir /tmp/app && meteor build --allow-superuser --directory /tmp/app
RUN meteor node -p "require('/usr/app/package.json').version" > /tmp/app/bundle/APP_VERSION
RUN cd /tmp/app/bundle/programs/server && meteor npm install --production

########################
### Runtime container
########################

FROM node:24-alpine AS app

WORKDIR /usr/app

COPY --from=build /tmp/app/bundle /usr/app
COPY ./entrypoint.sh /usr/app/entrypoint.sh
RUN chmod +x /usr/app/entrypoint.sh

ENV PORT=3000
EXPOSE $PORT

ENTRYPOINT ["/usr/app/entrypoint.sh"]
CMD ["node", "main.js"]
