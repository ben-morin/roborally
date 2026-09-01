import { checkArgs, schemas } from './schemas/methods.js';
import { Players } from '../collections/players.js';

Meteor.methods({
  async selectCard(gameId, card, index) {
    checkArgs({ gameId, card, index }, schemas.selectCard);
    const player = await Players.findOneAsync({ gameId, userId: Meteor.userId() });
    if (!player) return;
    if (index < player.notLockedCnt()) await player.chooseCardAsync(card, index);
    return await player.getChosenCardsAsync();
  },

  async deselectCard(gameId, index) {
    checkArgs({ gameId, index }, schemas.deselectCard);
    const player = await Players.findOneAsync({ gameId, userId: Meteor.userId() });
    if (!player) return;
    if (index < player.notLockedCnt()) await player.unchooseCardAsync(index);
    return await player.getChosenCardsAsync();
  },

  async deselectAllCards(gameId) {
    checkArgs({ gameId }, schemas.deselectAllCards);
    const player = await Players.findOneAsync({ gameId, userId: Meteor.userId() });
    if (!player) return;
    for (let i = 0; i < player.notLockedCnt(); i++) await player.unchooseCardAsync(i);
  },
});
