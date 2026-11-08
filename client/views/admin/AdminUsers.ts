// Where the `adminUsers` publication's documents land in the browser. No server collection
// has this name: the publication names it as it sends, and only an admin's browser ever
// receives a document. Nothing writes to it from here.
import { Mongo } from 'meteor/mongo';
import type { AdminUserDoc } from '../../lib/adminUsers.ts';

export const AdminUsers = new Mongo.Collection<AdminUserDoc>('adminUsers');
