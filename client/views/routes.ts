// The five URLs, in one place. Components build a link or a navigation from these rather
// than spelling a path, which is what `FlowRouter.path('game.page', { _id })` used to do.
export const paths = {
  gameList: () => '/',
  ranking: () => '/ranking',
  lobby: (gameId: string) => `/games/${gameId}`,
  boardSelect: (gameId: string) => `/select/${gameId}`,
  board: (gameId: string) => `/board/${gameId}`,
};

// The route names the Blaze router used, kept for the one component that asks which page
// it is on, each with the pattern React Router matches it by.
export const ROUTE_PATTERNS = {
  'gamelist.page': '/',
  'ranking.page': '/ranking',
  'game.page': '/games/:_id',
  'boardselect.page': '/select/:_id',
  'board.page': '/board/:_id',
} as const;

export type RouteName = keyof typeof ROUTE_PATTERNS;
