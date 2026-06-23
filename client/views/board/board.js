const tileSizeDep = new Tracker.Dependency();

function getGame() {
  const id = FlowRouter.getParam('_id');
  if (id) {
    return Games.findOne(id);
  }
}

function getPlayers() {
  return Players.find().fetch();
}

function getTileSize() {
  tileSizeDep.depend();
  const board = document.getElementById('board');
  if (!board) return 50;
  const game = getGame();
  if (!game) return 50;
  return Math.floor(board.offsetWidth / game.board().width);
}

function updateTileSize() {
  const board = document.getElementById('board');
  if (!board) return;
  const game = getGame();
  if (!game) return;
  board.style.width = '100%';
  const tileSize = Math.floor(board.offsetWidth / game.board().width);
  board.style.setProperty('--tile-size', tileSize + 'px');
  board.style.width = tileSize * game.board().width + 'px';
  board.style.height = tileSize * game.board().height + 'px';
  tileSizeDep.changed();
}

Template.board.onRendered(function () {
  const self = this;
  let resizeTimer;
  self._resizeHandler = function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(updateTileSize, 100);
  };
  window.addEventListener('resize', self._resizeHandler);

  const boardEl = document.getElementById('board');
  if (boardEl && typeof ResizeObserver !== 'undefined') {
    self._resizeObserver = new ResizeObserver(self._resizeHandler);
    self._resizeObserver.observe(boardEl);
  }

  self.autorun(function () {
    getGame(); // reactive dependency
    Tracker.afterFlush(function () {
      updateTileSize();
    });
  });
});

Template.board.onDestroyed(function () {
  if (this._resizeObserver) {
    this._resizeObserver.disconnect();
  }
  if (this._resizeHandler) {
    window.removeEventListener('resize', this._resizeHandler);
  }
  lastKnownPositions.clear();
});

Template.board.helpers({
  game: function () {
    return getGame();
  },
  inGame: function () {
    return getPlayers().some(function (player) {
      return player.userId === Meteor.userId();
    });
  },
  player: function () {
    const players = getPlayers();
    for (const i in players) {
      const player = players[i];
      if (player.userId === Meteor.userId()) {
        return player;
      }
    }
  },

  robots: function () {
    const r = [];
    getPlayers().forEach(function (player) {
      const rclass = 'r' + player.robotId;
      r.push({
        path: '/robots/robot_' + player.robotId.toString() + '.png',
        robot_class: rclass,
        direction: animateRotation(rclass, player.direction),
        position: animatePosition(rclass, player.position.x, player.position.y),
        poweredDown: player.isPoweredDown(),
        name: player.userId === Meteor.userId() ? 'You' : player.name,
      });
    });
    return r;
  },
  markers: function () {
    const m = [];
    getPlayers().forEach(function (player) {
      const playerName = player.userId === Meteor.userId() ? 'You' : player.name;
      m.push({
        path: '/robots/marker_' + player.robotId.toString() + '.png',
        marker_class: 'm' + player.robotId.toString(),
        position: cssPosition(player.start.x, player.start.y),
        name: 'respawn location ( ' + playerName + ' )',
      });
    });
    return m;
  },
  shots: function () {
    const tileWidth = getTileSize();
    const laserWidth = Math.trunc(tileWidth / 15);
    const startOffset = 5;
    const s = [];
    const game = getGame();
    if (game && game.playPhase === GameState.PLAY_PHASE.CHECKPOINTS) {
      getPlayers().forEach(function (player, i) {
        if (!player.isPoweredDown() && !player.needsRespawn) {
          let offsetY;
          let offsetX;
          const extend = {};
          const retract = {};
          let style = '';
          const lc = 'l' + i;
          const beamLength = tileWidth * player.shotDistance;
          const tailDistance = beamLength - startOffset;

          switch (player.direction % 2) {
            case 0: // up or down
              extend.height = beamLength + 'px';
              retract.height = '0px';
              style = 'width: ' + laserWidth + 'px;';
              style += 'height: 0px;';
              offsetX = (tileWidth - laserWidth) / 2;
              break;
            case 1: // left or right
              extend.width = beamLength + 'px';
              retract.width = '0px';
              style = 'height: ' + laserWidth + 'px;';
              style += 'width: 0px;';
              offsetY = (tileWidth - laserWidth) / 2;
              break;
          }

          switch (player.direction) {
            case GameLogic.UP:
              offsetY = startOffset;
              break;
            case GameLogic.LEFT:
              offsetX = startOffset;
              break;
            case GameLogic.DOWN:
              offsetY = tileWidth - startOffset;
              break;
            case GameLogic.RIGHT:
              offsetX = tileWidth - startOffset;
              break;
          }

          const initialTop = tileWidth * player.position.y + offsetY;
          const initialLeft = tileWidth * player.position.x + offsetX;

          switch (player.direction) {
            case GameLogic.UP:
              extend.top = initialTop - tailDistance + 'px';
              break;
            case GameLogic.LEFT:
              extend.left = initialLeft - tailDistance + 'px';
              break;
            case GameLogic.DOWN:
              retract.top = initialTop + tailDistance + 'px';
              break;
            case GameLogic.RIGHT:
              retract.left = initialLeft + tailDistance + 'px';
              break;
          }

          style += cssPosition(player.position.x, player.position.y, offsetX, offsetY);
          Tracker.afterFlush(function () {
            const laserDiv = document.querySelector('.' + lc);
            if (!laserDiv) return;
            laserDiv.getAnimations().forEach((a) => a.cancel());
            const duration = player.shotDistance * 26;
            console.log('shot duration', duration);
            laserDiv.animate([{}, extend], { duration, fill: 'forwards' });
            setTimeout(function () {
              const el = document.querySelector('.' + lc);
              if (el) el.animate([{}, retract], { duration, fill: 'forwards' });
            }, duration / 7);
          });
          s.push({ shot: style, laser_class: lc });
        }
      });
    }
    return s;
  },
  getRobotId: function () {
    return Players.findOne({ userId: Meteor.userId() }).robotId.toString();
  },

  tiles: function () {
    const game = getGame();
    return game ? game.board().tiles : [];
  },
  gameEnded: function () {
    const game = getGame();
    return game && game.gamePhase === GameState.PHASE.ENDED;
  },
  boardWidth: function () {
    const game = getGame();
    return game ? game.board().width * getTileSize() : 0;
  },
  boardHeight: function () {
    const game = getGame();
    return game ? game.board().height * getTileSize() : 0;
  },
  selectOptions: function () {
    const s = [];
    const game = getGame();
    if (!game) return s;
    console.log(
      'game.respawnUserId: ' + game.respawnUserId + '; Meteor.userId(): ' + Meteor.userId()
    );
    if (game.respawnUserId === Meteor.userId()) {
      game.selectOptions.forEach(function (opts) {
        opts.position = cssPosition(opts.x, opts.y);
        opts.gameId = game._id;
        if (game.respawnPhase === GameState.RESPAWN_PHASE.CHOOSE_POSITION) {
          opts.select_class = 'position-select pointer';
          opts.title = 'choose a starting position';
        } else if (game.respawnPhase === GameState.RESPAWN_PHASE.CHOOSE_DIRECTION) {
          opts.select_class = 'direction-select pointer';
          opts.title = 'choose the direction you want to face';
        }
        s.push(opts);
      });
    }
    return s;
  },
  registerPhases: function () {
    const phases = [1, 2, 3, 4, 5];
    const pUIData = [];
    const game = getGame();
    if (!game) return pUIData;

    phases.forEach(function (phase) {
      let pclass = false;
      let pstatus = 'fa-circle';
      if (game.playPhaseCount === phase) {
        pclass = 'active';
        pstatus = 'fa-arrow-circle-right';
      } else if (game.playPhaseCount > phase) {
        pclass = 'finished';
        pstatus = 'fa-check-circle';
      }
      pUIData.push({
        phaseClass: pclass,
        phaseName: 'register ' + phase,
        status: pstatus,
        width: (game.board().width * getTileSize()) / phases.length,
      });
    });
    console.log(pUIData);
    return pUIData;
  },
  playPhases: function () {
    const game = getGame();
    if (!game) return [];
    const pUIData = [];
    const phases = [
      GameState.PLAY_PHASE.MOVE_BOTS,
      GameState.PLAY_PHASE.MOVE_BOARD,
      GameState.PLAY_PHASE.LASERS,
      GameState.PLAY_PHASE.CHECKPOINTS,
    ];

    let finished = true;
    phases.forEach(function (phase) {
      const phaseProp = {
        announceCard: false,
        width: (game.board().width * getTileSize()) / phases.length,
      };
      switch (phase) {
        case GameState.PLAY_PHASE.MOVE_BOTS:
          phaseProp.phaseName = 'moving bots';
          break;
        case GameState.PLAY_PHASE.MOVE_BOARD:
          phaseProp.phaseName = 'moving board';
          break;
        case GameState.PLAY_PHASE.LASERS:
          phaseProp.phaseName = 'shooting lasers';
          break;
        case GameState.PLAY_PHASE.CHECKPOINTS:
          phaseProp.phaseName = 'checkpoints';
          break;
        case GameState.PLAY_PHASE.REPAIRS:
          phaseProp.phaseName = 'repairing bots';
          break;
      }
      if (phase === game.playPhase) {
        finished = false;
        phaseProp.status = 'fa-arrow-circle-right';
        phaseProp.phaseClass = 'active';
      } else if (finished) {
        phaseProp.status = 'fa-check-circle';
        phaseProp.phaseClass = 'finished';
      } else {
        phaseProp.status = 'fa-circle';
        phaseProp.phaseClass = false;
      }
      pUIData.push(phaseProp);
    });
    return pUIData;
  },
  announceMove: function () {
    const game = getGame();
    return game && game.playPhase === GameState.PLAY_PHASE.MOVE_BOTS && game.announceCard;
  },
  cardPlaying: function () {
    const game = getGame();
    if (game == null || game.announceCard == null) {
      return;
    }

    const cardId = game.announceCard.cardId;
    const player = Players.findOne(game.announceCard.playerId);
    return {
      class: 'played announce-move',
      priority: CardLogic.priority(cardId),
      type: CardLogic.cardType(cardId, game.playerCnt()).name,
      playerName: player.name,
      // center card on robot tile; card width equals tile size
      tileSize: getTileSize() + 'px',
      position: cssPosition(player.position.x, player.position.y, 0, -getTileSize() / 2),
      robotId: player.robotId.toString(),
    };
  },
});

// Tracks each animated element's last-known logical position so we can detect
// real position changes without reading the DOM (offsetLeft is unreliable when
// an animation is mid-flight or held by fill: forwards).
const lastKnownPositions = new Map();

function animatePosition(element, x, y) {
  const newPosition = calcPosition(x, y);
  const previous = lastKnownPositions.get(element);
  lastKnownPositions.set(element, { x, y });

  // Snapshot the current rendered position BEFORE returning, while the inline
  // style still reflects the previous render. getComputedStyle includes any
  // in-flight animation effect, so a multi-step move (server fires 3 updates
  // within milliseconds for a "move 3") starts the new animation from where
  // the robot is currently *visible*, not from its prior tile origin. This
  // makes 3-tile moves play as one continuous glide instead of three rapid
  // animations that cancel each other before rendering.
  let visualX = null;
  let visualY = null;
  if (previous && (previous.x !== x || previous.y !== y)) {
    const el = document.querySelector('.' + element);
    if (el) {
      const computed = getComputedStyle(el);
      const cl = parseFloat(computed.left);
      const ct = parseFloat(computed.top);
      if (!Number.isNaN(cl)) visualX = cl;
      if (!Number.isNaN(ct)) visualY = ct;
    }
    const oldPosition = calcPosition(previous.x, previous.y);
    const startX = visualX != null ? visualX : oldPosition.x;
    const startY = visualY != null ? visualY : oldPosition.y;

    Tracker.afterFlush(function () {
      const playerElement = document.querySelector('.' + element);
      if (!playerElement) return;
      playerElement.getAnimations().forEach((a) => a.cancel());
      const tileSize = getTileSize();
      const tilesTraveled =
        Math.max(Math.abs(newPosition.x - startX), Math.abs(newPosition.y - startY)) /
        Math.max(tileSize, 1);
      const duration = tilesTraveled * GameLogic.MS_PER_TILE;
      playerElement.animate(
        [
          { left: startX + 'px', top: startY + 'px' },
          { left: newPosition.x + 'px', top: newPosition.y + 'px' },
        ],
        { duration }
      );
    });
  }
  return 'left: ' + newPosition.x + 'px; top: ' + newPosition.y + 'px;';
}

function animateRotation(element, direction) {
  const newRotation = direction * 90;
  const els = document.querySelectorAll('.' + element);
  if (els.length) {
    els.forEach((el) => {
      el.style.transform = 'rotate(' + newRotation + 'deg)';
    });
    return '';
  }
  return 'transform: rotate(' + newRotation + 'deg)';
}

function cssPosition(x, y, offsetX, offsetY) {
  const coord = calcPosition(x, y, offsetX, offsetY);
  return 'top: ' + coord.y + 'px; left:' + coord.x + 'px;';
}

function cssRotate(deg) {
  const rotate = 'rotate(' + deg + 'deg);';
  return 'transform: ' + rotate + ' -webkit-transform: ' + rotate + ' -ms-transform: ' + rotate;
}

function calcPosition(x, y, offsetX, offsetY) {
  if (offsetX == null) {
    offsetX = 0;
  }
  if (offsetY == null) {
    offsetY = 0;
  }

  const tileWidth = getTileSize();
  const tileHeight = getTileSize();

  x = tileWidth * x + offsetX;
  y = tileHeight * y + offsetY;

  return { x: x, y: y };
}

Template.board.events({
  'click .close': function () {
    FlowRouter.go(FlowRouter.path('gamelist.page'));
  },
  'click .cancel': async function () {
    const game = getGame();
    if (game && game.gamePhase !== GameState.PHASE.ENDED) {
      if (
        await modalConfirm(
          'If you leave, you will forfeit the game, are you sure you want to give up?'
        )
      ) {
        Meteor.callAsync('leaveGame', game._id).then(
          function () {
            FlowRouter.go(FlowRouter.path('gamelist.page'));
          },
          function (error) {
            modalAlert(error.reason);
            FlowRouter.go(FlowRouter.path('gamelist.page'));
          }
        );
      }
    } else {
      FlowRouter.go(FlowRouter.path('gamelist.page'));
    }
  },
  'click .position-select': function (e) {
    const game = getGame();
    Meteor.callAsync(
      'selectRespawnPosition',
      game._id,
      e.target.dataset.x,
      e.target.dataset.y
    ).catch(function (error) {
      modalAlert(error.reason);
    });
  },
  'click .direction-select': function (e) {
    const game = getGame();
    Meteor.callAsync('selectRespawnDirection', game._id, e.target.dataset.dir).catch(
      function (error) {
        modalAlert(error.reason);
      }
    );
  },
});
