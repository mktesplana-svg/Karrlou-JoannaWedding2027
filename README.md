# Karrlou & Joanna's Wedding Website

A single-file, passport-themed wedding website (blues, champagne, beige) with six in-page tabs:
Departure · Our Journey · Itinerary · Guidelines · The Crew · Check-In (RSVP).

The Crew tab lists the full entourage, and the Check-In tab has an **embedded RSVP form** that
checks each guest's typed name against the baked-in guest list before letting them confirm.

## Deploy on Vercel (from GitHub)

1. Create a new GitHub repository and upload the contents of this `github/` folder
   (`index.html`, `og-image.png`, the `photos/` folder and this `README.md`) to the repo root.
   Keep `og-image.png` and `photos/` next to `index.html`. The Messenger preview and the
   Our Journey gallery load from there.
2. Go to https://vercel.com → **Add New… → Project** → import your repo.
3. Framework Preset: **Other**. Leave Build Command empty and Output Directory as the root.
4. Click **Deploy**. Vercel serves `index.html` at your domain.

Every time you push a change to the repo, Vercel redeploys automatically.

## Updating an existing repo (this release)

The ZIP contains the full repo. To replace what's on GitHub:

1. On github.com, open your repo → **Add file → Upload files**.
2. Drag in `index.html`, `README.md` and `og-image.png`. Click **Commit changes**.
3. Upload the photos: **Add file → Upload files**, drag the whole `photos` folder in, and commit.
   GitHub's web uploader takes **at most 100 files per upload**. There are 153 photos, so do it
   in two batches: drag the folder once, and if it stops at 100, upload the rest the same way
   into `photos/`.
4. Vercel redeploys automatically in about a minute. Check
   `https://karrlou-and-joanna-wedding.vercel.app/photos/IMG_8125_edit.jpg` to confirm the photos are live.

(Using GitHub Desktop instead? Copy the ZIP contents over your local repo folder, commit, push.)

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
- Photos are the original files in `photos/`. They load as you scroll, so the page opens fast.
- **Order / add / remove:** in `index.html` search for `static PHOTOS`. It's a list of file
  numbers (newest first). Add a number to show a new `IMG_XXXX_edit.jpg` you've put in `photos/`.

## How the RSVP works

- The guest types their name. It is matched (leniently — case, spacing and middle initials are
  ignored) against the **guest list** baked into the page.
- **Not on the list →** they see *“We couldn't find your name — kindly contact the couple.”* and
  cannot check in.
- **On the list + “Yes” →** recorded as attending.
- **On the list + “No” →** still recorded, but marked as **not attending** (their name is not
  counted toward attendees).

Submissions post **silently in the background to your Google Form** (which you link to a Google
Sheet). Until you wire that up, the form runs in demo mode and just shows the success screen.

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

The `<head>` contains Open Graph tags pointing to
`https://karrlou-and-joanna-wedding.vercel.app/og-image.png`. After deploying, paste the link into
https://developers.facebook.com/tools/debug/ and click **Scrape Again** to refresh Messenger's
cached preview. If your domain changes, update the URLs in those `og:` tags.

## Admin: Passenger Manifest (secret tab)

Click the small **lock icon** in the footer (or open `yoursite/#admin`).

- Username: `KarrlouandJoanna` · Password: `KarrlouandJoanna`
  (change `ADMIN_USER` / `ADMIN_PASS` in `index.html`).
- Shows stat cards, All / Confirmed / Declined / Waiting / VVIP tabs, category filter, search, Print,
  and a **PASS** button per guest.
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
