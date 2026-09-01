import { expect, test } from '@playwright/test';

// The one browser journey. It is the only test that sees the build: a broken
// rspack.config.js, a stylesheet that stopped applying, a Blaze template whose helper
// renamed a field, a route that renders nothing — the vitest suite cannot see any of
// those, because it never builds a bundle. Keep it to one journey, host only, one player:
// a solo game on the `default` board (min_player 1) plays a full register in one browser
// context, and with one player the 30 s programming timer never starts.
//
// Every run signs up a fresh account, so nothing here depends on the state of the dev
// database and nothing has to be reset between runs.

test('a new player signs up, creates a game and plays a register', async ({ page }) => {
  const stamp = Date.now();
  const email = `e2e-${stamp}@example.com`;
  // The display name is the local part of the address, lowercased (server/accounts.js).
  const displayName = `e2e-${stamp}`;
  let gameId;

  // Collected for the whole journey and asserted at the very end, so a failure
  // anywhere along the way still reports what the browser complained about.
  const browserErrors = [];
  page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`);
  });

  await test.step('the logged-out page renders', async () => {
    await page.goto('/');
    await expect(page.locator('h2', { hasText: 'roborally' })).toBeVisible();
    await expect(page.locator('#login-buttons')).toBeVisible();
    await expect(page.locator('#login-sign-in-link')).toBeVisible();
  });

  await test.step('every stylesheet layer is applied', async () => {
    // One computed-style assertion per layer, each taken from the layer's own rules, so a
    // failure names the stylesheet that stopped applying. The import order in
    // client/main.js is the cascade order; the `base` and `components` rows below are the
    // two places where that order is load-bearing.

    // Package CSS, which still goes through Meteor's bundler rather than Rspack.
    await expect(page.locator('.fa').first()).toHaveCSS('font-family', /FontAwesome/);
    // lib/bootstrap.scss — and `_variables.scss` feeding it: stock Bootstrap is #0d6efd.
    await expect(page.locator(':root')).toHaveCSS('--bs-primary', /#337ab7/);
    await expect(page.locator('.btn-primary').first()).toHaveCSS(
      'background-color',
      'rgb(51, 122, 183)'
    );
    // base.scss beating Bootstrap's _reboot, which alone gives 16px and underline.
    await expect(page.locator('body')).toHaveCSS('font-size', '14px');
    await expect(page.locator('.tutorial a')).toHaveCSS('text-decoration-line', 'none');
    // components.scss, the layer that overrides the accounts-ui package's own CSS.
    await expect(page.locator('#login-buttons')).toHaveCSS('padding-top', '15px');
    // layout.scss: $footer-bg-color.
    await expect(page.locator('.footer-below')).toHaveCSS('background-color', 'rgb(35, 49, 64)');
    // modules/gamecard.scss and game.scss need a board on screen; see 'start the game'.
  });

  await test.step('sign up', async () => {
    await page.locator('#login-sign-in-link').click();
    await page.locator('#signup-link').click();
    await page.locator('#login-email').fill(email);
    await page.locator('#login-password').fill('e2e-password');
    // Reads CREATE ACCOUNT in the sign-up flow; same button, same id, as SIGN IN.
    await page.locator('#login-buttons-password').click();

    await expect(page.locator('#login-name-link')).toContainText(displayName);
    await expect(page.getByRole('link', { name: 'Games' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Ranking' })).toBeVisible();
    await expect(page.locator('h2', { hasText: 'Open games' })).toBeVisible();
  });

  await test.step('create a game', async () => {
    const form = page.locator('form', { has: page.locator('input[name="name"]') });
    await form.locator('input[name="name"]').fill(`e2e ${stamp}`);
    await form.locator('input[type="submit"]').click();

    // createGame resolves with the id and the form handler routes to the lobby.
    await expect(page).toHaveURL(/\/games\/[^/]+$/);
    gameId = page.url().split('/').pop();

    await expect(page.locator('h2', { hasText: 'Game created by' })).toContainText(displayName);
    await expect(page.locator('ol li', { hasText: displayName })).toBeVisible();
    await expect(page.locator('.messages .system', { hasText: 'joined the game' })).toContainText(
      displayName
    );
    // createGame pre-selects board 0, which is `default`.
    await expect(page.locator('.selected-board .board-thumbnail')).toHaveId('default');
    await expect(page.locator('a.start')).toBeVisible();
  });

  const selectBoard = async (boardName) => {
    await page.locator('a.select').click();
    await expect(page).toHaveURL(new RegExp(`/select/${gameId}$`));
    await expect(page.locator('.nav-pills')).toBeVisible();
    // The thumbnail's id is the board name; the click handler reads it from there.
    await page.locator(`.boardchoice:has(#${boardName})`).click();
    await expect(page).toHaveURL(new RegExp(`/games/${gameId}$`));
    await expect(page.locator('.selected-board .board-thumbnail')).toHaveId(boardName);
  };

  await test.step('change the board, then change it back', async () => {
    // `default` is already selected, so a single selection would prove nothing; going
    // through risky_exchange makes both round trips observable. Both boards are on the
    // Beginner tab, the active one for a new game, so no tab click is needed. The game
    // has to END on `default`: it is a min_player 1 board, and the abandoned-game cron
    // ends a started game that has one player online whenever min_player > 1.
    await selectBoard('risky_exchange');
    await selectBoard('default');
  });

  await test.step('start the game', async () => {
    await page.locator('a.start').click();
    // gamePageActions' autorun routes to the board as soon as the game is `started`.
    await expect(page).toHaveURL(new RegExp(`/board/${gameId}$`));
    await expect(page.locator('#board')).toBeVisible();
    await expect(page.locator('.robot.r0')).toBeVisible();
    // Dealing is ~0.5 s of server-side sleeps before the program phase opens.
    await expect(page.locator('.right-panel h3', { hasText: 'Pick your cards' })).toBeVisible();

    // The two stylesheet layers that only apply once a board is on screen.
    // game.scss positions the board; `--tile-size` is then set on it by board.js from
    // the measured width, so a value here also proves that sizing code ran.
    await expect(page.locator('#board')).toHaveCSS('position', 'relative');
    await expect(page.locator('#board')).toHaveCSS('--tile-size', /^\s*\d+px$/);
    // modules/gamecard.scss.
    await expect(page.locator('.gamecard').first()).toHaveCSS('aspect-ratio', '99 / 153');
    await expect(page.locator('.gamecard').first()).toHaveCSS('cursor', 'pointer');
  });

  await test.step('a malformed method call is refused with a 400', async () => {
    // The only place in the repo where the real jam:easy-schema validator runs: the vitest
    // suite swaps it for a pass-through stub, so nothing there can prove a rejection. The
    // page is signed in and on the board, so this exercises `checkArgs` on a live server
    // without disturbing the journey — a 400 means createGame never got as far as writing.
    // `Meteor` is a package global in the browser bundle, so it is on `window` even though
    // no app code uses globals.
    const result = await page.evaluate(() =>
      window.Meteor.callAsync('createGame', { name: 42 }).then(
        () => null,
        (error) => ({ error: error.error, reason: error.reason })
      )
    );
    expect(result?.error).toBe(400);
    // The reason names the offending field, rather than the generic 'Validation failed'
    // that the raw ValidationError would have carried to the browser.
    expect(result?.reason).toMatch(/Name/);
  });

  await test.step('program five cards', async () => {
    // A full hand: nine cards, none damaged yet. Waiting for it here keeps the loop below
    // from clicking before the `cards` subscription has delivered the deal.
    const hand = page.locator('.hand .gamecard.available');
    await expect(hand).toHaveCount(9);

    const unchosen = page.locator('.hand .gamecard.available:not(.chosen)');
    // Turns are preferred because they cannot move the robot: a step card in register 1
    // could walk it into a pit, and a robot waiting to respawn gets no reveal in the
    // registers that follow — which is what the next step counts. Falls back to any card
    // when the hand runs out of turns.
    const turns = unchosen.filter({ hasNot: page.locator('[class*="step-"]') });
    const chosen = page.locator('.playing .gamecard.played');

    for (let i = 0; i < 5; i++) {
      const card = (await turns.count()) > 0 ? turns.first() : unchosen.first();
      await card.click();
      // Each click runs the selectCard stub, which fills the current slot optimistically.
      // Wait for it before the next click so the clicks never outrun the stub.
      await expect(chosen).toHaveCount(i + 1);
    }
    await expect(page.locator('a.playBtn')).not.toHaveClass(/disabled/);
  });

  await test.step('play the cards and let register 1 resolve', async () => {
    await page.locator('a.playBtn').click();

    // Solo game: the one submit is the last submit, so the phase machine starts at once.
    const phase = page.locator('.right-panel h3').first();
    await expect(phase).toHaveText(
      /Revealing cards|Moving bots|Moving board elements|Shooting lasers|Checkpoints|Repairing bots/
    );
    await expect(page.locator('.announce-bar')).toBeVisible();

    // The card being played is announced on the board with a CSS animation from
    // game.scss (`.fadeInAndOut`, 1.75 s, once per register). A running animation on it
    // proves the stylesheet pipeline end to end, and does not depend on which card was
    // drawn — unlike the robot glide, which only plays for step cards.
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const card = document.querySelector('#board .gamecard.fadeInAndOut');
            return card ? card.getAnimations().length : 0;
          }),
        { timeout: 20_000, intervals: [100] }
      )
      .toBeGreaterThan(0);

    // The submitted program shows as five covered cards; each reveal turns one of them
    // into a real card. Two revealed means register 2 has started, which means register 1
    // ran all the way through movement, board elements, lasers and checkpoints.
    const revealed = page.locator('.player-robot .smallhand .gamecard.played');
    await expect.poll(() => revealed.count(), { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
  });

  expect(browserErrors).toEqual([]);
});
