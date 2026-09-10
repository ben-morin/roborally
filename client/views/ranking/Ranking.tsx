// The two highscore lists. Both are rebuilt server-side into one collection and told
// apart by `type`, so this is two cursors over the same rows.
import { useFind } from 'meteor/react-meteor-data';
import { Highscores } from '../../../collections/highscores.ts';
import type { HighscoreDoc } from '../../../collections/highscores.ts';

function Places({ rows }: { rows: HighscoreDoc[] }) {
  return rows.map((row) => (
    <p key={row._id} className="text-base leading-normal">
      {row.rank}. {row.name} ({row.value})
    </p>
  ));
}

export function Ranking() {
  const mostPlayed = useFind(() => Highscores.find({ type: 'mostPlayed' }));
  const mostWon = useFind(() => Highscores.find({ type: 'mostWon' }));

  return (
    <div className="highscores">
      <h2 className="mt-0 text-3xl">Most games played</h2>
      <hr className="star-well mt-3 mb-7" />
      <Places rows={mostPlayed} />
      <h2 className="mt-10 text-3xl">Most games won</h2>
      <hr className="star-well mt-3 mb-7" />
      <Places rows={mostWon} />
    </div>
  );
}
