// The right panel on the game list: one field and a button, or a link to the game the
// caller already has open. Replaces the `gameItemPostForm` template.
import { useState } from 'react';
import type { FormEvent } from 'react';
import type { Mongo } from 'meteor/mongo';
import { Link, useNavigate } from 'react-router';
import { useSubscribe, useTracker } from 'meteor/react-meteor-data';
import { createGame } from '../../../both/methods/games.ts';
import { Games } from '../../../collections/games.ts';
import type { GameDoc } from '../../../collections/games.ts';
import { modalAlert } from '../../helper/modalDialogs.ts';
import { paths } from '../routes.ts';

const INPUT =
  'block h-12 w-full rounded-control border border-white/16 bg-raised px-3.5 text-base text-white placeholder:text-muted focus:border-teal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal';
const SUBMIT =
  'mt-4 h-12 w-full cursor-pointer rounded-control border-0 bg-brand px-4 text-base font-semibold text-white hover:bg-[color-mix(in_srgb,var(--color-brand)_88%,white)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal';

export function CreateGameForm() {
  useSubscribe('games');
  const ownGame = useTracker(() => {
    const userId = Meteor.userId();
    if (!userId) return undefined;
    // `{winner: null}` is Mongo's "null or missing" — the game has not ended. The assertion
    // records that: GameDoc types `winner` as an optional string, so the selector type has
    // no way to accept the null.
    const unfinished = { userId, winner: null } as unknown as Mongo.Selector<GameDoc>;
    return Games.findOne(unfinished);
  });
  const [name, setName] = useState('');
  const navigate = useNavigate();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // The empty name is refused by the server, and the message it sends back is what the
    // player reads — so nothing is checked here either.
    createGame({ name }).then(
      (id) => navigate(paths.lobby(id)),
      (error) => modalAlert(error.reason)
    );
  }

  return (
    <>
      <h2 className="mt-0 text-3xl">Create game</h2>
      <hr className="star-well mt-3 mb-7" />
      {ownGame ? (
        <p className="text-base">
          You have an open game named{' '}
          <Link className="font-semibold text-teal" to={paths.lobby(ownGame._id)}>
            {ownGame.name}
          </Link>
        </p>
      ) : (
        <form onSubmit={onSubmit}>
          <input
            className={INPUT}
            name="name"
            type="text"
            placeholder="The name of your game"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <input className={SUBMIT} type="submit" value="Create game" />
        </form>
      )}
    </>
  );
}
