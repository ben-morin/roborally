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
  $(window).on('resize', self._resizeHandler);

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
    $(window).off('resize', this._resizeHandler);
  }
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
    const laserWidth = 4;
    const tileWidth = getTileSize();
    const startOffset = 5;
    const s = [];
    const game = getGame();
    if (game && game.playPhase === GameState.PLAY_PHASE.CHECKPOINTS) {
      getPlayers().forEach(function (player, i) {
        if (!player.isPoweredDown() && !player.needsRespawn) {
          let offsetY;
          let offsetX;
          const animate = {};
          const animateRev = {};
          let style = '';
          const lc = 'l' + i;
          switch (player.direction % 2) {
            case 0: // up or down
              animate.height = tileWidth * player.shotDistance + 'px';
              animateRev.height = '0px';
              style = 'width: ' + laserWidth + 'px;';
              style += 'height: 0px;';
              offsetX = (tileWidth - laserWidth) / 2;
              break;
            case 1: // left or right
              animate.width = tileWidth * player.shotDistance + 'px';
              animateRev.width = '0px';
              style = 'height: ' + laserWidth + 'px;';
              style += 'width: 0px;';
              offsetY = (tileWidth - laserWidth) / 2;
              break;
          }

          switch (player.direction) {
            case GameLogic.UP:
              offsetY = startOffset;
              animate.top = '-=' + (tileWidth * player.shotDistance - startOffset) + 'px';
              break;
            case GameLogic.LEFT:
              offsetX = startOffset;
              animate.left = '-=' + (tileWidth * player.shotDistance - startOffset) + 'px';
              break;
            case GameLogic.DOWN:
              animateRev.top = '+=' + (tileWidth * player.shotDistance - startOffset) + 'px';
              offsetY = tileWidth - startOffset;
              break;
            case GameLogic.RIGHT:
              animateRev.left = '+=' + (tileWidth * player.shotDistance - startOffset) + 'px';
              offsetX = tileWidth - startOffset;
              break;
          }
          style += cssPosition(player.position.x, player.position.y, offsetX, offsetY);
          Tracker.afterFlush(function () {
            let once = false;
            const laserDiv = $('.' + lc);
            laserDiv.stop();
            const duration = player.shotDistance * 26;
            console.log('shot duration', duration);
            laserDiv.animate(animate, {
              duration: duration,
              queue: false,
              progress: function (anim, progress, remainingMs) {
                if (remainingMs <= duration - duration / 7 && !once) {
                  laserDiv.animate(animateRev, { duration: duration, queue: false });
                  once = true;
                }
              },
            });
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

function animatePosition(element, x, y) {
  const newPosition = calcPosition(x, y);
  let oldX = newPosition.x;
  let oldY = newPosition.y;

  const position = $('.' + element).position();
  if (position) {
    oldX = position.left;
    oldY = position.top;

    if (oldX !== newPosition.x || oldY !== newPosition.y) {
      Tracker.afterFlush(function () {
        const deltaX = newPosition.x - oldX;
        const deltaY = newPosition.y - oldY;
        const playerElement = $('.' + element);
        playerElement.stop();

        playerElement.animate(
          {
            left: '+=' + deltaX + 'px',
            top: '+=' + deltaY + 'px',
          },
          Math.max(Math.abs(deltaX), Math.abs(deltaY)) * 4
        );
      });
    }
  }
  return 'left: ' + oldX + 'px; top: ' + oldY + 'px;';
}

function animateRotation(element, direction) {
  const newRotation = direction * 90;
  const el = $('.' + element);
  if (el.length) {
    el.css({ transform: 'rotate(' + newRotation + 'deg)' });
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
      $(e.target).attr('data-x'),
      $(e.target).attr('data-y')
    ).catch(function (error) {
      modalAlert(error.reason);
    });
  },
  'click .direction-select': function (e) {
    const game = getGame();
    Meteor.callAsync('selectRespawnDirection', game._id, $(e.target).attr('data-dir')).catch(
      function (error) {
        modalAlert(error.reason);
      }
    );
  },
});
