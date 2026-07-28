import { Highscores } from '../../../collections/highscores.js';
import './ranking.html';

Template.ranking.helpers({
  mostPlayed() {
    return Highscores.find({ type: 'mostPlayed' });
  },
  mostWon() {
    return Highscores.find({ type: 'mostWon' });
  },
});
