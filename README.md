roborally
=

Browser-based [RoboRally](https://en.wikipedia.org/wiki/RoboRally) board game implementation built with [Meteor 3](https://www.meteor.com). 
It uses Blaze for templating, CoffeeScript for core game models, and plain JavaScript for game logic and server methods.

port
-
This project is a Meteor 3 port of the [blinkingnoise/roborally](https://github.com/blinkingnoise/roborally) Meteor 2 fork of the original 
[marcelpanse/roborally](https://github.com/marcelpanse/roborally) Meteor-based project. The Meteor 3 version has some significant refactoring, 
but the core game logic and models remain mostly unchanged. The main focus of this port is to update the codebase
to be compatible with Meteor 3 and modern dependencies.  A new repository was created for this port to avoid 
confusion with the original Meteor 1 and 2 versions.

Goals of this project:

 - use the latest Meteor release (3.4.0 as of March 2026)
 - modernize the codebase and update dependencies
 - stabilize gameplay
 - run in docker

running
----------------
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
    image: yieldtoben/roborally:3.4.0
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

links
-
- docker hub: [yieldtoben/roborally](https://hub.docker.com/r/yieldtoben/roborally)
- github: [ben-morin/roborally](https://github.com/ben-morin/roborally)


license
-

GNU General Public License (GPL) 2.0
