// /api/checkin
//   POST { name, typed, attend: "yes" | "no", email }  -> saves a guest's check-in (called by the Check-In tab)
//   GET  (header x-admin-key)                          -> all check-ins (called by the Admin manifest every few seconds)
import { makeHandler } from './_checkins.js';

const handle = makeHandler();

export default {
  fetch(request) {
    return handle(request);
  },
};
