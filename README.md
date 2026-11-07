# Karrlou & Joanna's Wedding Website

A single-file, passport-themed wedding website (blues, champagne, beige) with six in-page tabs:
Departure · Our Journey · Itinerary · Guidelines · The Crew · Check-In (RSVP).

The Crew tab lists the full entourage, and the Check-In tab has an **embedded RSVP form** that
checks each guest's typed name against the baked-in guest list before letting them confirm.


> **File layout (Nov 2026):** the full site now lives in `app.html`. `index.html` is a tiny front page that holds the
> link-preview tags (so Messenger/WhatsApp phones can read them quickly) and then loads `app.html`. Wherever this README
> says to edit `index.html`, edit `app.html` instead, except the preview tags, which are in both files.
> The preview picture is `og-image.jpg` (85 KB; Meta's apps skip preview images around 300 KB or more).

## Deploy on Vercel (from GitHub)

1. Create a new GitHub repository and upload the contents of this `github/` folder
   (`index.html`, `og-image.png`, the `photos-1/`, `photos-2/` and `music/` folders and this `README.md`) to the repo root.
   Keep `og-image.png` and both photo folders next to `index.html`. The Messenger preview and the
   Our Journey gallery load from there.
2. Go to https://vercel.com → **Add New… → Project** → import your repo.
3. Framework Preset: **Other**. Leave Build Command empty and Output Directory as the root.
4. Click **Deploy**. Vercel serves `index.html` at your domain.

Every time you push a change to the repo, Vercel redeploys automatically.

## Uploading to GitHub (two photo batches)

GitHub's web uploader takes at most 100 files at a time, so the 153 photos are split into two folders.
The photos are resized for the web (1600px on the long side, about 100–350 KB each), so each folder is
small enough for the web uploader (originals were up to 4 MB each, which made the upload fail):

- `photos-1/`: 77 photos (`FB_…` up to `IMG_4950`)
- `photos-2/`: 76 photos (`IMG_4951` and later)

Steps on github.com → your repo:

1. **Add file → Upload files**: drag in `index.html`, `README.md` and `og-image.png`. Click **Commit changes**.
2. **Add file → Upload files**: drag the whole **`photos-1`** folder in. Commit.
3. **Add file → Upload files**: drag the whole **`photos-2`** folder in. Commit.
4. **Add file → Upload files**: drag the whole **`music`** folder in (contains `palagi.mp3`). Commit.
5. If your repo still has the old `photos/` folder, you can delete it (the site no longer uses it).
6. Vercel redeploys automatically in about a minute. Check
   `https://karrlou-and-joanna-wedding.vercel.app/photos-2/IMG_8125_edit.jpg` to confirm the photos are live.

**Adding a new photo later:** name it `IMG_XXXX_edit.jpg`. If the number is 4951 or higher (e.g. `IMG_9001`) put it in `photos-2/`,
otherwise in `photos-1/`. Then add the number to `static PHOTOS` in `index.html`.

## Background music

- The record button under the countdown on the Departure tab plays **Palagi** (`music/palagi.mp3`). It fades in to 75% volume and loops.
- The song keeps playing as guests switch tabs. Go back to Departure and tap the record again to pause.
- Browsers don't allow music to start on its own, so guests need to tap the button.
- To change the song, replace `music/palagi.mp3` with another MP3 that has the same file name.

## Works on phone, tablet and computer

- Every tab reflows from small phones (320px) up to wide desktops with no sideways scrolling.
- Menu links and buttons have finger-sized tap areas, and the Wedding Pass card stacks on phones.

## Guidelines tab: attire guide

- A "Please don't wear white" banner, then three cards (Guests, Principal Sponsors, Entourage), each with
  its attire illustration, instructions and named color swatches.
- The illustrations are embedded in `index.html`, so no extra files are needed.
- To edit the text or colors, search `index.html` for `FOR NINONG`, `SEMI-FORMAL ATTIRE` or a swatch name like `Dusty Blue`.

## Our Journey photo gallery

- A masonry collage of every photo sits below the love story (2 columns on phones, more on wider screens).
- Tap any photo to enlarge it. Use the arrows, swipe or the ← → keys to move between photos, and tap outside, × or Esc to close.
- Photos are the original files in `photos-1/` and `photos-2/`. They load as you scroll, so the page opens fast.
- **Order / add / remove:** in `index.html` search for `static PHOTOS`. It's a list of file
  numbers (newest first). Add a number to show a new `IMG_XXXX_edit.jpg` you've put in `photos-1/` or `photos-2/` (see above).

## How the RSVP works

- The guest types their name. It is matched (leniently — case, spacing and middle initials are
  ignored) against the **guest list** baked into the page.
- **Not on the list →** they see *“We couldn't find your name — kindly contact the couple.”* and
  cannot check in.
- **On the list + “Yes” →** recorded as attending.
- **On the list + “No” →** still recorded, but marked as **not attending** (their name is not
  counted toward attendees).

### Live check-ins → Admin (automatic)

Every check-in is saved on the server (`api/checkin.js`, stored in the private Vercel Blob store
**wedding-checkins**, file `rsvp/checkins.json`). The Admin manifest reads it every 8 seconds while it is open,
so a guest's answer appears there by itself: status turns **Confirmed** or **Regretfully declined**, the counts
update, the row shows "CHECKED IN" with the time, and **PASS** fills in the email the guest typed.
It works on every device you sign in to Admin on.

- If a guest checks in again, their latest answer replaces the earlier one.
- A guest's own check-in overrides the RSVP status from the guest list or from **Edit** on this device.
- If saving fails, the guest sees "We couldn't save your check-in…" and can try again.
- The Blob store must stay connected to this Vercel project (Vercel → Storage). Don't delete it, or the answers are lost.
- `package.json` only exists so Vercel installs `@vercel/blob` for the check-in function.

Optionally, submissions are **also** posted to your Google Form (which you link to a Google Sheet) once you
wire it up below.

### Wire up the Google Form (→ Google Sheet)

1. Make a Google Form with a **Short answer** question for the name and a **Multiple choice**
   question for attendance (options `Yes, I will gladly attend` / `No, I regret that I am unable to attend`).
2. Form menu **⋮ → Get pre-filled link**, fill dummy answers, copy the link, and note the
   `entry.XXXXXXXXXX` number for each question.
3. Your form's `/viewform` share link with the ending changed to `/formResponse` is the action URL.
4. In `index.html`, search for and replace these three values:
   ```js
   static FORM_ACTION = 'https://docs.google.com/forms/d/e/YOUR_FORM_ID/formResponse';
   static ENTRY_NAME = 'entry.1111111111';   // the name question
   static ENTRY_ATTEND = 'entry.2222222222'; // the attendance question
   static ENTRY_EMAIL = 'entry.3333333333';  // add a Short answer "Email" question too
   ```
5. In the Google Form **Responses** tab → **Link to Sheets**.

## Wedding Pass

- After a guest confirms **Yes**, their personal wedding pass appears with their name on it and a
  **Download** button. Email is required for "Yes" and optional for "No".
- **VVIP guests** who confirm get a gold **"VVIP · PLUS-ONE"** stamp on their pass and a note
  that they may bring a plus-one.

### VVIP list

In Admin, use **Edit → VVIP** to mark guests and the **VVIP** tab to see them. Those marks are
saved on that device. To show the note on guests' own passes, tap **Copy VVIP list**
and paste it over this line in `index.html`:
```js
static VVIP = [];
```

### Emailing a pass (Admin)

On any row, tap **PASS**, then:
1. **Download Pass** saves the PNG.
2. Type the guest's email (it's in your RSVP responses sheet), then tap **Email via Gmail**. Gmail opens
   with the subject and message already written.
3. Attach the downloaded pass and press Send.

## Messenger / Facebook link preview

The preview tags (title, description, `og:image`) sit in the very top `<head>` of `index.html`, so Messenger and Facebook can read them without running the page.
**If you re-export `index.html` later, check that line 5 says `<title>Passport to Marriage: Karrlou &amp; Joanna</title>` and not `Bundled Page`.**

The tags point to
`https://karrlou-and-joanna-wedding.vercel.app/og-image.png`. After deploying, paste the link into
https://developers.facebook.com/tools/debug/ and click **Scrape Again** to refresh Messenger's
cached preview. If your domain changes, update the URLs in those `og:` tags.

## Admin: Passenger Manifest (secret tab)

Click the small **lock icon** in the footer (or open `yoursite/#admin`).

- Username: `KarrlouandJoanna` · Password: `KarrlouandJoanna`
  (change `ADMIN_USER` / `ADMIN_PASS` in `index.html`).
- Shows stat cards, All / Confirmed / Declined / Waiting / VVIP tabs, category filter, search, Print,
  and a **PASS** button per guest.
- Guests' check-ins update the manifest live on every device (see "Live check-ins" above).
- **Add / Edit / Remove** saves on that device only. To update everyone, edit the Google Sheet.
- ⚠️ This is a static site: the login only hides the tab. The password and guest names can be seen
  in the page source, so don't put anything sensitive there.

### Make the manifest live from Google Sheets

1. In the sheet: **File → Share → Publish to web**.
2. Choose the **GUEST LIST** tab and **Comma-separated values (.csv)**, then click **Publish**.
3. Copy the link and paste it into `index.html`:
   ```js
   static SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/.../pub?gid=...&single=true&output=csv';
   ```

The admin page and the Check-In name matching then read the sheet directly, refreshing every
60 seconds. If the sheet can't be reached, the built-in snapshot (106 guests) is used instead.

## Editing content

`index.html` is self-contained — open it in any editor and edit the text directly:

- **Guest list snapshot:** search for `GUESTS = [` (`[name, category, invitationSent, response]`).
- **Entourage names:** search for `principal:`, `party:`, `secondary:`, `bearers:`, or a specific
  name like `Sedrik Gumop-as`.
- **Couple photo:** the photo is embedded as a data URL on the Departure tab. Replace the
  `data:image/png;base64,...` value inside the `<img ... alt="Karrlou and Joanna">` tag.
- **Date / time / venues:** search for `January 9, 2027`, `3:00 PM`, `St. Joseph the Worker Parish`,
  `Queens Garden`.

## Custom domain

In the Vercel project: **Settings → Domains → Add** and follow the DNS instructions.
