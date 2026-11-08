// /api/admin — Admin data shared by every device (guest-list edits, VVIP marks, "seen" mark)
//   GET  ?public=1                       -> what guests' devices need: added / removed / renamed guests, VVIP marks
//   GET  (header x-admin-key)            -> full admin data (?fresh=1 skips the cache)
//   POST { ops: [...] } (x-admin-key)    -> save changes from a device; returns the new admin data
// The Admin manifest also gets this data with every check-in poll (GET /api/checkin).
import { makeAdminHandler } from './_admin.js';

const handle = makeAdminHandler();

export default {
  fetch(request) {
    return handle(request);
  },
};
