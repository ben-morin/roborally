########################
### Builder
########################

FROM node:12 AS build

# allows meteor to build in docker VM with 2GB runtime memory
ENV TOOL_NODE_FLAGS "--max-old-space-size=1536 --optimize_for_size --gc-interval=100"

RUN curl https://install.meteor.com/ | sh

WORKDIR /usr/app
COPY . /usr/app
RUN npx browserslist@latest --update-db
RUN mkdir /tmp/app && meteor build --allow-superuser --directory /tmp/app
RUN cd /tmp/app/bundle/programs/server && npm install --production

########################
### Runtime container
########################

FROM mhart/alpine-node:12 AS app

WORKDIR /usr/app
COPY --from=build /tmp/app/bundle /usr/app

ENV PORT=3000
EXPOSE $PORT
CMD [ "node", "main.js" ]
