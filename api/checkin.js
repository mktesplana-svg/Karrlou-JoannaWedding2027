// /api/checkin
//   POST { name, typed, attend: "yes" | "no", email }  -> saves a guest's check-in (called by the Check-In tab)
//        answers are final: a second check-in for the same guest gets 409 with the first answer
//   GET  (header x-admin-key)                          -> all check-ins (called by the Admin manifest every few seconds)
//   DELETE { key } (header x-admin-key)                -> clears one guest's check-in (Admin > Edit > Clear check-in)
import { makeHandler } from './_checkins.js';

const handle = makeHandler();

export default {
  fetch(request) {
    return handle(request);
  },
};
