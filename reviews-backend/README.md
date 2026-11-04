# PeraPlan reviews backend (Google Apps Script)

Reviews from the app are saved in a Google Sheet in **your** Google account and
shown on the website. No server to pay for.

## Set up (once, about 5 minutes)

1. Go to <https://sheets.new> and name the spreadsheet `PeraPlan Reviews`.
2. In the sheet: **Extensions → Apps Script**.
3. Delete what's in `Code.gs`, paste everything from [`Code.gs`](Code.gs), and save.
4. At the top, choose the function **`setup`** and click **Run**. Allow the
   permissions it asks for (it only uses this spreadsheet and calls Google to
   check sign-in tokens).
5. **Deploy → New deployment → ⚙ → Web app**
   - Description: `PeraPlan reviews`
   - Execute as: **Me**
   - Who has access: **Anyone**
   - Click **Deploy** and copy the **Web app URL** (ends with `/exec`).
6. Send the URL to Claude (or put it in `reviews-config.json` here and in the
   app's live update as `reviewsUrl`).

## Moderating

Open the sheet. The `status` column is:

- `published` — shown on the website
- `pending` — has a link or a bad word; change it to `published` to show it
- `hidden` — never shown, and that account can't edit it anymore

The website refreshes its copy every 5 minutes.

## How it's protected

| Risk | Protection |
| --- | --- |
| Fake reviewers / bots | Every review needs a Google ID token. The script checks it with Google and requires it was made for PeraPlan's own client id (`aud`), by Google (`iss`), not expired, with a verified email. |
| Many reviews from one person | One review per Google account; sending again edits it. One review per device (another account on the same phone is refused). |
| Flooding | One submit per minute per account, a daily cap, body size limits, a lock so two submits can't race. |
| Code injected into the website (XSS) | The page shows reviews with `textContent` only (never HTML) and has a strict Content-Security-Policy. |
| Formula injection in the sheet | Cells starting with `= + - @` are stored as plain text. |
| Spam links / bad words | Held as `pending` until you publish them. |
| Leaking personal data | Only salted hashes of the account and device are stored — no email. The salt is a secret Script Property. |
| Secrets in the app | The app holds no key or token. The URL is public on purpose; it's useless without a valid Google sign-in. |
