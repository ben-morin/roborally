// Where the `adminGames` publication's documents land in the browser: one collection for the
// games, one for who sits in them. No server collection has either name: the publication
// names them as it sends, and only an admin's browser ever receives a document. Nothing
// writes to them from here.
import { Mongo } from 'meteor/mongo';
import type { AdminGameDoc, AdminPlayerDoc } from '../../lib/adminGames.ts';

export const AdminGames = new Mongo.Collection<AdminGameDoc>('adminGames');
export const AdminPlayers = new Mongo.Collection<AdminPlayerDoc>('adminPlayers');
