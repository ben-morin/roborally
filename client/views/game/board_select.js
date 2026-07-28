import { FlowRouter } from 'meteor/ostrio:flow-router-extra';
import { BoardBox } from '../../../both/board_box.js';
import { Games } from '../../../collections/games.js';
import { modalAlert } from '../../helper/modalDialogs.js';
// board_select.html includes {{> thumbnail}}.
import '../board/thumbnail.js';
import './board_select.html';

function getGame() {
  const id = FlowRouter.getParam('_id');
  if (id) {
    return Games.findOne(id);
  }
}

function buildBoards(from, to) {
  const game = getGame();
  if (!game) return [];
  const b = [];
  for (let i = from; i < to; i++) {
    const board = BoardBox.getBoard(i);
    let css_class = '';
    if (Number(game.boardId) === Number(i)) {
      css_class = 'selected';
    }
    b.push({
      gameId: game._id,
      width: board.width * 24 + 4,
      height: board.height * 24 + 4,
      board,
      extra_class: css_class,
      show_start: true,
    });
  }
  return b;
}

function activeCategory() {
  const game = getGame();
  if (!game) return 'beginner';
  const id = Number(game.boardId);
  if (id >= BoardBox.CUSTOM_COURSE_IDX) return 'custom';
  if (id >= BoardBox.BEGINNER_COURSE_CNT) return 'expert';
  return 'beginner';
}

Template.boardselect.helpers({
  beginnerBoards() {
    return buildBoards(0, BoardBox.BEGINNER_COURSE_CNT);
  },
  expertBoards() {
    return buildBoards(BoardBox.BEGINNER_COURSE_CNT, BoardBox.CUSTOM_COURSE_IDX);
  },
  customBoards() {
    return buildBoards(BoardBox.CUSTOM_COURSE_IDX, BoardBox.CATALOG.length);
  },
  beginnerActive() {
    return activeCategory() === 'beginner' ? 'active' : '';
  },
  expertActive() {
    return activeCategory() === 'expert' ? 'active' : '';
  },
  customActive() {
    return activeCategory() === 'custom' ? 'active' : '';
  },
});

Template.boardselect.events({
  'click .boardchoice'(e) {
    e.preventDefault();

    const thumbnail = e.currentTarget.querySelector('.board-thumbnail');
    if (!thumbnail) return;
    const boardName = thumbnail.id;
    const game = getGame();
    if (!game) return;

    Meteor.callAsync('selectBoard', boardName, game._id).then(
      () => FlowRouter.go(FlowRouter.path('game.page', { _id: game._id })),
      (error) => modalAlert(error.reason)
    );
  },
});
