Meteor.methods({
  selectCard: async function(gameId, card, index) {
    var player = await Players.findOneAsync({gameId: gameId, userId: Meteor.userId()});
    if (!player) return;
    if (index < player.notLockedCnt())
      await player.chooseCardAsync(card, index);
    return await player.getChosenCardsAsync();
  },

  deselectCard: async function(gameId, index) {
    var player = await Players.findOneAsync({gameId: gameId, userId: Meteor.userId()});
    if (!player) return;
    if (index < player.notLockedCnt())
      await player.unchooseCardAsync(index);
    return await player.getChosenCardsAsync();
  },

  deselectAllCards: async function(gameId) {
    var player = await Players.findOneAsync({gameId: gameId, userId: Meteor.userId()});
    if (!player) return;
    for (var i = 0; i < player.notLockedCnt(); i++)
      await player.unchooseCardAsync(i);
  }
});
