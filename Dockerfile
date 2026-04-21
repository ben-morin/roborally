########################
### Builder
########################

FROM node:22 AS build

# allows meteor to build in docker VM with 2GB runtime memory
# ENV TOOL_NODE_FLAGS "--max-old-space-size=1920 --optimize_for_size --gc-interval=100"
ENV METEOR_ALLOW_SUPERUSER=1
ENV BROWSERSLIST_IGNORE_OLD_DATA=1
ENV METEOR_DISABLE_OPTIMISTIC_CACHING=1

RUN curl https://install.meteor.com/\?release\=3.4 | sh

WORKDIR /usr/app
COPY . /usr/app

RUN npm install
RUN mkdir /tmp/app && meteor build --allow-superuser --directory /tmp/app
RUN node -p "require('/usr/app/package.json').version" > /tmp/app/bundle/APP_VERSION
RUN npm prune --production
RUN cd /tmp/app/bundle/programs/server && npm install --production

########################
### Runtime container
########################

FROM node:22-alpine AS app

WORKDIR /usr/app
COPY --from=build /tmp/app/bundle /usr/app
COPY ./entrypoint.sh /usr/app/entrypoint.sh
RUN chmod +x /usr/app/entrypoint.sh

ENV PORT=3000
EXPOSE $PORT

ENTRYPOINT ["/usr/app/entrypoint.sh"]
CMD ["node", "main.js"]
