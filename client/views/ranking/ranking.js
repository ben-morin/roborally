Template.ranking.helpers({
  mostPlayed: function () {
    return Highscores.find({ type: 'mostPlayed' });
  },
  mostWon: function () {
    return Highscores.find({ type: 'mostWon' });
  },
});
