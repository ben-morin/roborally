class @CardLogic
  @_MAX_NUMBER_OF_CARDS = 9
  @EMPTY   = -1
  @COVERED = -2
  @DAMAGE  = -3
  @RANDOM  = -4

  @_cardTypes =
    0: {direction: 2, position: 0, name: "u-turn"}
    1: {direction: 1, position: 0, name: "turn-right"}
    2: {direction: -1, position: 0, name: "turn-left"}
    3: {direction: 0, position: -1, name: "step-backward"}
    4: {direction: 0, position: 1, name: "step-forward"}
    5: {direction: 0, position: 2, name: "step-forward-2"}
    6: {direction: 0, position: 3, name: "step-forward-3"}

  @_8_deck = [
    6,  # u turn
    18, # right turn
    18, # left turn
    6,  # step back
    18, # step 1
    12, # step 2
    6   # step 3
  ]

  @_12_deck = [
    9,  # u turn
    27, # right turn
    27, # left turn
    9,  # step back
    27, # step 1
    18, # step 2
    9   # step 3
  ]

  @discardCardsAsync: (game, player) ->
    deck = await game.getDeckAsync()

    playerCards = await Cards.findOneAsync({playerId: player._id})
    if playerCards
      for unusedCard in playerCards.handCards
        if unusedCard >= 0
          deck.cards.push unusedCard
      chosenCards = playerCards.chosenCards
      # compute notLockedCards inline using already-fetched chosenCards
      notLockedCards = if player.lockedCnt() == GameLogic.CARD_SLOTS then [] else chosenCards.slice(0, player.notLockedCnt())
      for discardCard, i in notLockedCards
        # Rule note: You don't keep a discard pile. You always use the complete deck
        if discardCard >= 0
          deck.cards.push discardCard
        player.cards[i] = @EMPTY
        chosenCards[i] = @EMPTY

      await Players.updateAsync player._id,
        $set:
          cards: player.cards
          playedCardsCnt: 0,
          chosenCardsCnt: player.lockedCnt()
      await Cards.updateAsync {playerId: player._id},
        $set:
          handCards: [],
          chosenCards: chosenCards

    console.log player.name + ": returned cards, new total: "+deck.cards.length
    await Deck.upsertAsync({gameId: game._id}, deck)

  @dealCardsAsync: (game, player) ->
    deck = await game.getDeckAsync()
    handCards = []

    #for every damage you get a card less
    nrOfNewCards = (@_MAX_NUMBER_OF_CARDS - player.damage)
    if player.hasOptionCard('extra_memory')
      nrOfNewCards++
    #grab card from deck, so it can't be handed out twice
    if nrOfNewCards > 0
      handCards.push deck.cards.pop() for i in [1..nrOfNewCards]
    console.log player.name + ": hand cards " + handCards.length + ", new total: "+deck.cards.length

    await Cards.updateAsync {playerId: player._id},
      $set:
        handCards: handCards
    await Deck.updateAsync(deck._id, deck)

  @submitCardsAsync: (player) ->
    if player.isPoweredDown()
      await Players.updateAsync player._id,
        $set:
          submitted: true
          damage: 0
    else
      approvedCards = await verifySubmittedCardsAsync(player)

      await Players.updateAsync player._id,
        $set:
          submitted: true,
          optionalInstantPowerDown: false,
          cards: approvedCards

    playerCnt = await Players.find({gameId: player.gameId, lives: {$gt: 0}}).countAsync()
    readyPlayerCnt = await Players.find({gameId: player.gameId, submitted: true, lives: {$gt: 0}}).countAsync()
    if readyPlayerCnt == playerCnt
      await Games.updateAsync(player.gameId, {$set: {timer: -1, timerStartedAt: null}})
      await GameState.nextGamePhaseAsync(player.gameId)
    else if readyPlayerCnt == playerCnt-1
      # start timer — capture timerStart so the scheduled callback can verify
      # it is still acting on the same timer instance when it fires
      timerStart = new Date()
      await Games.updateAsync(player.gameId, {$set: {timer: 1, timerStartedAt: timerStart}})
      Meteor.setTimeout Meteor.bindEnvironment(->
        autoSubmitIfTimedOut(player.gameId, timerStart).catch (err) ->
          console.error("autoSubmitIfTimedOut error", err)
      ), GameLogic.TIMER * 1000

  autoSubmitIfTimedOut = (gameId, expectedStart) ->
    game = await Games.findOneAsync(gameId)
    # Bail out if the timer has been reset (manual submit completed the turn) or
    # if a new timer instance was started for a later turn — without this check,
    # a stale setTimeout from a previous turn can auto-submit a player who still
    # has time on their current programming timer.
    return unless game.timer == 1 and game.timerStartedAt? and game.timerStartedAt.getTime() == expectedStart.getTime()
    console.log("time up! setting timer to 0")
    await Games.updateAsync(gameId, {$set: {timer: 0, timerStartedAt: null}})
    await new Promise (resolve) -> Meteor.setTimeout resolve, 2500
    cnt = await Players.find({gameId: gameId, submitted: true}).countAsync()
    playerCnt = await Players.find({gameId: gameId, lives: {$gt: 0}}).countAsync()
    if cnt < playerCnt
      unsubmittedPlayer = await Players.findOneAsync({gameId: gameId, submitted: false})
      if unsubmittedPlayer
        await CardLogic.submitCardsAsync(unsubmittedPlayer)
        console.log("Player " + unsubmittedPlayer.name + " did not respond, submitting random cards")

  verifySubmittedCardsAsync = (player) ->
    # check if all played cards are available from original hand...
    # Except locked cards, those are not in the hand.
    availableCards = await player.getHandCardsAsync()
    submittedCards = await player.getChosenCardsAsync()
    # compute notLockedCards inline to avoid sync DB call inside notLockedCards()
    notLockedCnt = player.notLockedCnt()
    notLockedCardsList = if player.lockedCnt() == GameLogic.CARD_SLOTS then [] else submittedCards.slice(0, notLockedCnt)
    for card, i in notLockedCardsList
      found = false
      if card >= 0
        for j in [0..availableCards.length-1]
          if card == availableCards[j]
            availableCards.splice(j, 1)
            found = true
            break
        if !found
          console.warn("illegal card detected: "+card+"! (removing card)")
      else
        console.warn("Not enough cards submitted")

      if card<0 || !found
        if availableCards.length > 0
          # grab card from hand
          cardIdFromHand = availableCards.splice(Math.floor(Math.random() * availableCards.length), 1)[0]
          console.warn("Handing out random card", cardIdFromHand)
          submittedCards[i] = cardIdFromHand
          player.cards[i] = CardLogic.RANDOM
        else
          console.error("No available cards to fill slot #{i}!")
          submittedCards[i] = CardLogic.EMPTY
          player.cards[i] = CardLogic.EMPTY

    await Cards.updateAsync({playerId: player._id}, $set:
      handCards: availableCards
      chosenCards: submittedCards
    )
    player.cards


  @getOptionName: (index) ->
    @_option_deck[index][0]

  @getOptionTitle: (name) ->
    name.replace('/_/g',' ').replace /\w\S*/g, (txt) ->
      txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()

  @getOptionId: (name) ->
    for option, id in @_option_deck
      if option[0] == name
        return id

  @getOptionDesc: (name) ->
    return @_option_deck[@getOptionId(name)][1]

  @cardType:  (cardId, playerCnt) ->
    deck = if playerCnt <= 8 then @_8_deck else @_12_deck
    cnt  = 0
    for cardTypeCnt, index in deck
      cnt += cardTypeCnt
      if cardId < cnt
        return @_cardTypes[index]

  @priority: (index) ->
    (index+1)*10

  @_option_deck = [
    [ 'superior_archive',  "When reentering play after beeing destroyed, your robot doesn't receive the normal 20% damage" ]
    [ 'circuit_breaker',   "If you have 30% or more damage at the end of your turn, your robot will begin the next turn powered down" ]
    [ 'rear-firing_laser', "Your robot has a rear-firing laser in addition to its main laser. This laser follows all the same rules as the main laser" ]
    [ 'extra_memory', "You receive one extra Program card each turn."]
    [ 'high-power_laser', "Your robot's main laser can shoot through one wall or robot to get to a target robot. If you shoot through a robot, that robot also receives full damage. You may use this Option with Fire Control and/or Double-Barreled Laser."]
    [ 'double-barreled_laser', "Whenever your robot fires its main laser, it fires two shots instead of one. You may use this Option with Fire Control and/or High-Power Laser."]
    [ 'ramming_gear', "Whenever your robot pushes or bumps into another robot, that robot receives 10% damage."]
#    [ 'mechanical_arm', "Your robot can touch a flag or repair site from 1 space away (diagonally or orthogonally),
#    as long as there isn't a wall."]
    [ 'ablative_coat', "Absorbs the next 30% damage your robot receives."]
    ####### choose to use
    # 'recompile'
    #[ 'power-down_shield', ""
    # 'abort_switch'
    ###### additional move options
    # 'fourth_gear'
    # 'reverse_gear'
    # 'crab_legs'
    # 'brakes'
    ######## register options
    # 'dual_processor'
    # 'conditional_program'
    # 'flywheel'
    ######## alternative laser
    # 'mini_howitzer'
    # 'fire_control'
    # 'radio_control'
    # [ 'scrambler',    "Whenever you could fire your main laser at a robot, you may instead fire the Scrambler. This replaces the target's robots's next programmed card with the top Program card from the deck. You can't use this Option on the fifth register phase."]
    # [ 'tractor_beam', "Whenever you could fire your main laser at a robot that isn't in an adjacent space, you may instead fire the Tractor Beam. This moves the target robot 1 space toward your robot."]
    # [ 'pressor_beam', "Whenever you could fire your main laser at a robot, you may instead fire the Pressor Beam. This moves the target robot 1 space away from your robot."]
    ##### activate before submit
    # 'gyroscopic_stabilizer'
  ]
