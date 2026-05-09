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
      board: board,
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
  beginnerBoards: function () {
    return buildBoards(0, BoardBox.BEGINNER_COURSE_CNT);
  },
  expertBoards: function () {
    return buildBoards(BoardBox.BEGINNER_COURSE_CNT, BoardBox.CUSTOM_COURSE_IDX);
  },
  customBoards: function () {
    return buildBoards(BoardBox.CUSTOM_COURSE_IDX, BoardBox.CATALOG.length);
  },
  beginnerActive: function () {
    return activeCategory() === 'beginner' ? 'active' : '';
  },
  expertActive: function () {
    return activeCategory() === 'expert' ? 'active' : '';
  },
  customActive: function () {
    return activeCategory() === 'custom' ? 'active' : '';
  },
});

Template.boardselect.events({
  'click .boardchoice': function (e) {
    e.preventDefault();

    const thumbnail = e.currentTarget.querySelector('.board-thumbnail');
    if (!thumbnail) return;
    const boardName = thumbnail.id;
    const game = getGame();
    if (!game) return;

    Meteor.callAsync('selectBoard', boardName, game._id).then(
      function () {
        FlowRouter.go(FlowRouter.path('game.page', { _id: game._id }));
      },
      function (error) {
        modalAlert(error.reason);
      }
    );
  },
});
