# B KWIK

Admin app for **B IN DALBY** and **KWIK TRIP** — shareholders, mortgage, outgoings, reminders and reports.
Works on phone and laptop. Live at **https://bkwikinfo.github.io**.

- Hosting: GitHub Pages (this repository). No financial data is stored here.
- Data: a Google Sheet in **bkwikinfo@gmail.com**'s Drive, through Google Apps Script.
- Sign-in: Google, allowed for bkwikinfo@gmail.com only.
- Emails: sent by Gmail from **bindalbyptyltd@gmail.com** (B IN DALBY) and **kwiktripptyltd@gmail.com** (KWIK TRIP).

## One-time setup (all signed in as bkwikinfo@gmail.com)

### 1. Company emails as "Send mail as"
Gmail → Settings → See all settings → **Accounts and Import** → **Send mail as** → **Add another email address**.
Add `bindalbyptyltd@gmail.com` and `kwiktripptyltd@gmail.com` (leave "Treat as an alias" ticked), then enter the
confirmation code Gmail sends to each address. Until this is done, emails still send, but from bkwikinfo@gmail.com.

### 2. Google sign-in client ID
1. Open https://console.cloud.google.com → create a project called **Project B KWIK**.
2. **APIs & Services → OAuth consent screen**: External, app name "Project B KWIK", your email, then add
   `bkwikinfo@gmail.com` under **Test users** (or publish the app).
3. **APIs & Services → Credentials → Create credentials → OAuth client ID** → type **Web application**.
   Under **Authorised JavaScript origins** add `https://bkwikinfo.github.io`. Create, then copy the **Client ID**.

### 3. Google Sheet + Apps Script
1. Create a new Google Sheet called **Project B KWIK data**.
2. **Extensions → Apps Script**. Delete what is there and paste all of `apps-script/Code.gs`.
3. At the top, replace `PASTE-YOUR-GOOGLE-OAUTH-CLIENT-ID...` with the Client ID from step 2. Save.
4. Choose the function **setup** and press **Run**. Allow the permissions (Sheets, Gmail, external requests).
   This creates the store and the 8am daily reminder emails.
5. **Deploy → New deployment → Web app**: Execute as **Me**, Who has access **Anyone**. Deploy and copy the
   **Web app URL** (ends in `/exec`).

### 4. Connect the app
Put both values into `config.js`:
```js
window.PBK_CONFIG = { scriptUrl: 'https://script.google.com/macros/s/…/exec', clientId: '….apps.googleusercontent.com' };
```

### 5. Install on your phone
Open https://bkwikinfo.github.io → sign in → iPhone: Share → **Add to Home Screen**; Android: menu → **Install app**.

## Updating the Google Script (needed for automatic emails and the shareholder portal)

1. Open the Google Sheet → **Extensions → Apps Script**.
2. Select everything in `Code.gs`, delete it, and paste in the new `apps-script/Code.gs` from this repo.
3. Click **Save**, then **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy**. The web app link stays the same.
4. Choose `setup` in the function list and click **Run** once (it keeps the 8am daily trigger).

After this:
- **Setup → Automatic emails** in the app controls the monthly summaries, overdue reminders, loan and bill alerts and the weekly backup.
- Shareholders can open the same app link and sign in with the Google email saved for them. They see **only their own** payments, monthly amounts and statements, and can't change anything.

## Notes
- Only bkwikinfo@gmail.com can sign in; every request is checked by the Apps Script.
- The Sheet also gets readable tabs per company (Shareholders, Payments in, Mortgage, Utilities, Project works),
  refreshed on every save. Edit data in the app, not in those tabs.
- Gmail free accounts can send about 100 emails a day.
- If you change `Code.gs`, use **Deploy → Manage deployments → Edit → New version** so the same link keeps working.
