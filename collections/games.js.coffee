game =
  board: () ->
    BoardBox.getBoard(this.boardId)
  playersAsync: ->
    await Players.find({gameId: @_id}).fetchAsync()
  playerCnt: () ->
    Players.find({gameId: this._id}).count()
  playerCntAsync: ->
    await Players.find({gameId: @_id}).countAsync()
  isPlayerOnTileAsync: (x,y) ->
    found = null
    players = await @playersAsync()
    for player in players
      if player.position.x == x && player.position.y == y
        found = player
    return found
  chatAsync: (msg, debug_info) ->
    await Chat.insertAsync
      gameId: @_id,
      message: msg,
      submitted: new Date().getTime()
    if debug_info?
      msg += ' ' + debug_info
    console.log(msg)
  nextPlayPhaseAsync: (phase) ->
    if phase?
      await @setPlayPhaseAsync(phase)
    await GameState.nextPlayPhaseAsync(@_id)
  nextGamePhaseAsync: (phase) ->
    if phase?
      await @setGamePhaseAsync(phase)
    await GameState.nextGamePhaseAsync(@_id)
  nextRespawnPhaseAsync: (phase) ->
    if phase?
      await @setRespawnPhaseAsync(phase)
    await GameState.nextRespawnPhaseAsync(@_id)
  setPlayPhaseAsync: (phase) ->
    await Games.updateAsync @_id,
      $set:
        playPhase: phase
  setGamePhaseAsync: (phase) ->
    await Games.updateAsync @_id,
      $set:
        gamePhase: phase
  setRespawnPhaseAsync: (phase) ->
    await Games.updateAsync @_id,
      $set:
        respawnPhase: phase
  getDeckAsync: ->
    existingDeck = await Deck.findOneAsync({gameId: @_id})
    return existingDeck if existingDeck
    await @newDeckAsync()
  newDeckAsync: ->
    cnt = await @playerCntAsync()
    deckSpec = if cnt <= 8 then CardLogic._8_deck else CardLogic._12_deck
    deckSize = 0
    for cardTypeCnt in deckSpec
      deckSize += cardTypeCnt
    return {
      gameId: @_id,
      cards: [0..deckSize-1]
      optionCards: shuffle([0..CardLogic._option_deck.length-1])
      discardedOptionCards: []
    }
  startAnnounceAsync: ->
    await Games.updateAsync @_id,
      $set:
        announce: true
  stopAnnounceAsync: ->
    await Games.updateAsync @_id,
      $set:
        announce: false
  activePlayersAsync: ->
    await Players.find(
      gameId: @_id,
      needsRespawn: false,
      lives: {$gt: 0},
      powerState: {$ne:GameLogic.OFF}
    ).fetchAsync()
  livingPlayersAsync: ->
    await Players.find(
      gameId: @_id,
      lives: {$gt: 0},
    ).fetchAsync()
  playersOnBoardAsync: ->
    await Players.find(
      gameId: @_id,
      needsRespawn: false,
      lives: {$gt: 0},
    ).fetchAsync()



@Games = new Meteor.Collection('games',
  transform: (doc) ->
    newInstance = Object.create(game)
    return Object.assign(newInstance, doc)
)

Games.allow
  insert: (userId, doc) ->
    return false
  update: (userId, doc) ->
    return false
  remove: (userId, doc) ->
    return ownsDocument(userId, doc)
