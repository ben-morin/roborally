// Publications are cursor factories, so these run the real handler with `this.userId`
// bound the way the DDP layer binds it and assert on what the cursor yields. Two of them
// are security-relevant and both are pinned here: `cards` is the only publication scoped
// to the subscriber, and `onlineUsers` is the only one that hands out documents belonging
// to somebody else — so it is the only one whose *fields* have to be asserted, not just
// which documents come back.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../helpers/server.js';
import {
  loginAs,
  logout,
  registeredPublications,
  resetFakeCollections,
  runPublication,
} from '../setup.js';
import { Cards } from '../../collections/cards.js';
import { Chat } from '../../collections/chat.js';
import { Games } from '../../collections/games.js';
import { Highscores } from '../../collections/highscores.js';
import { Players } from '../../collections/players.js';

beforeEach(() => resetFakeCollections());

describe('publication registration', () => {
  it('registers every publication the client subscribes to', () => {
    expect(registeredPublications()).toEqual([
      'cards',
      'chat',
      'games',
      'highscores',
      'onlineUsers',
      'players',
    ]);
  });
});

describe('games', () => {
  it('publishes only the ten most recently submitted games, newest first', async () => {
    for (let i = 0; i < 12; i++) {
      await Games.insertAsync({ name: `game ${i}`, submitted: 1000 + i });
    }

    const games = (await runPublication('games')).fetch();

    expect(games).toHaveLength(10);
    expect(games.map((g) => g.name)).toEqual([
      'game 11',
      'game 10',
      'game 9',
      'game 8',
      'game 7',
      'game 6',
      'game 5',
      'game 4',
      'game 3',
      'game 2',
    ]);
  });

  it('publishes every game when there are fewer than ten', async () => {
    await Games.insertAsync({ name: 'only', submitted: 1 });

    expect((await runPublication('games')).fetch()).toHaveLength(1);
  });

  // Server-side turn bookkeeping: several kilobytes of players, cards and deck that no
  // template reads, on a publication that ships whole documents to everyone.
  it('withholds the segment snapshot and keeps the rest of the document', async () => {
    await Games.insertAsync({
      name: 'only',
      submitted: 1,
      step: 4,
      segmentSnapshot: { segment: 'play', players: [{ _id: 'p1' }] },
    });

    const [published] = (await runPublication('games')).fetch();

    expect(published.segmentSnapshot).toBeUndefined();
    expect(published).toMatchObject({ name: 'only', step: 4 });
  });
});

describe('chat', () => {
  it('publishes only the last hundred messages of the requested game', async () => {
    for (let i = 0; i < 150; i++) {
      await Chat.insertAsync({ gameId: 'g1', message: `m${i}`, submitted: i });
    }
    await Chat.insertAsync({ gameId: 'g2', message: 'elsewhere', submitted: 0 });

    const chat = (await runPublication('chat', {}, 'g1')).fetch();

    expect(chat).toHaveLength(100);
    expect(chat[0].message).toBe('m50');
    expect(chat.at(-1).message).toBe('m149');
  });

  it('publishes everything when the game has fewer than a hundred messages', async () => {
    for (let i = 0; i < 3; i++) {
      await Chat.insertAsync({ gameId: 'g1', message: `m${i}`, submitted: i });
    }

    expect((await runPublication('chat', {}, 'g1')).fetch()).toHaveLength(3);
  });

  it('publishes nothing for a game with no messages', async () => {
    expect((await runPublication('chat', {}, 'empty')).fetch()).toEqual([]);
  });
});

describe('onlineUsers', () => {
  // A user document as accounts-password and mizzao:user-status actually leave it: the
  // bcrypt hash, the resume login tokens, the forgot-password and email-verification
  // tokens, and the IP address and user agent of the last login. Every one of these was
  // going to every connected browser before the projection was added, so the fixture
  // carries them all and the assertions below are what pins them in.
  const seatUser = (_id, status) =>
    Meteor.users.insertAsync({
      _id,
      profile: { name: `Player ${_id}` },
      emails: [{ address: `${_id}@example.com`, verified: true }],
      status,
      services: {
        password: {
          bcrypt: '$2b$10$notarealhash',
          reset: { token: 'reset-token', email: `${_id}@example.com` },
        },
        resume: { loginTokens: [{ hashedToken: 'resume-token' }] },
        email: { verificationTokens: [{ token: 'verify-token' }] },
      },
    });

  it('publishes only users currently marked online', async () => {
    await loginAs('viewer');
    await seatUser('on', { online: true });
    await seatUser('off', { online: false });
    await seatUser('never', {});

    const users = (await runPublication('onlineUsers')).fetch();

    expect(users.map((u) => u._id).sort()).toEqual(['on', 'viewer']);
  });

  it('sends a display name and presence, and nothing else', async () => {
    await loginAs('viewer');
    await seatUser('other', {
      online: true,
      idle: true,
      lastActivity: new Date(0),
      lastLogin: { date: new Date(0), ipAddr: '203.0.113.7', userAgent: 'Firefox' },
    });

    const other = (await runPublication('onlineUsers')).fetch().find((u) => u._id === 'other');

    expect(other).toEqual({
      _id: 'other',
      profile: { name: 'Player other' },
      status: { online: true, idle: true },
    });
  });

  it('leaks no credential material for any published user', async () => {
    await loginAs('viewer');
    await seatUser('other', {
      online: true,
      lastLogin: { ipAddr: '203.0.113.7', userAgent: 'Firefox' },
    });

    const published = JSON.stringify((await runPublication('onlineUsers')).fetch());

    for (const secret of [
      'notarealhash',
      'reset-token',
      'resume-token',
      'verify-token',
      'other@example.com',
      '203.0.113.7',
      'Firefox',
    ]) {
      expect(published).not.toContain(secret);
    }
  });

  it('publishes nothing at all to a logged-out subscriber', async () => {
    logout();
    await seatUser('on', { online: true });
    const ready = vi.fn();

    // The handler returns no cursor; it marks the subscription ready so the client stops
    // waiting rather than leaving it hanging.
    expect(await runPublication('onlineUsers', { ready })).toBeUndefined();
    expect(ready).toHaveBeenCalled();
  });
});

describe('players', () => {
  it('publishes every player of the requested game and no others', async () => {
    await Players.insertAsync({ gameId: 'g1', name: 'a' });
    await Players.insertAsync({ gameId: 'g1', name: 'b' });
    await Players.insertAsync({ gameId: 'g2', name: 'c' });

    const players = (await runPublication('players', {}, 'g1')).fetch();

    expect(players.map((p) => p.name).sort()).toEqual(['a', 'b']);
  });
});

describe('cards', () => {
  it('publishes only the subscriber’s own hand', async () => {
    await loginAs('me');
    await Cards.insertAsync({ gameId: 'g1', userId: 'me', handCards: [1, 2] });
    await Cards.insertAsync({ gameId: 'g1', userId: 'opponent', handCards: [3, 4] });

    const cards = (await runPublication('cards', {}, 'g1')).fetch();

    expect(cards).toHaveLength(1);
    expect(cards[0].handCards).toEqual([1, 2]);
  });

  it('does not leak another game’s hand to the same user', async () => {
    await loginAs('me');
    await Cards.insertAsync({ gameId: 'g1', userId: 'me', handCards: [1] });
    await Cards.insertAsync({ gameId: 'g2', userId: 'me', handCards: [9] });

    const cards = (await runPublication('cards', {}, 'g1')).fetch();

    expect(cards.map((c) => c.handCards)).toEqual([[1]]);
  });

  it('publishes nothing to an anonymous subscriber', async () => {
    await Cards.insertAsync({ gameId: 'g1', userId: 'someone', handCards: [1] });

    // `this.userId` is null, and no Cards document carries a null userId.
    expect((await runPublication('cards', { userId: null }, 'g1')).fetch()).toEqual([]);
  });
});

describe('highscores', () => {
  it('publishes the whole collection', async () => {
    await Highscores.insertAsync({ type: 'mostWon', name: 'ann', value: 3, rank: 1 });
    await Highscores.insertAsync({ type: 'mostPlayed', name: 'bob', value: 7, rank: 1 });

    expect((await runPublication('highscores')).fetch()).toHaveLength(2);
  });
});
