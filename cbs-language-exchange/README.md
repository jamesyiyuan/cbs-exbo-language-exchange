# Setup and deployment guide

This guide covers running the CBS Language Exchange locally and deploying your own instance. For project background, see the [main README](../README.md).

Features:

- Sign in with a one-time code sent to an **@gsb.columbia.edu** email (no passwords)
- For each of 18 languages, mark **I can coach** and/or **I want to learn**, so one person can be both a coach and a mentee
- Browse classmates, request a pairing ("Learn Japanese from Aiko" or "Coach Mateo in Spanish"), and accept or decline requests. Two people can coach each other.
- After a pairing is accepted, both people can see each other's email and schedule sessions themselves

It's a static site (`index.html`, `app.js`, `styles.css`, `config.js`) backed by [Supabase](https://supabase.com) for login and data. There's no build step and no server code.

## Try it locally (demo mode)

With the two Supabase values in `config.js` set to empty strings, the site runs in **demo mode**. Data is stored in your browser, the one-time code appears on screen, and the directory comes pre-filled with sample classmates.

```bash
cd cbs-language-exchange && python3 -m http.server 5173
```

Open http://localhost:5173.

## Go live (about 20 minutes)

### 1. Create a Supabase project
Sign up at supabase.com and create a new project (the free tier is enough).

### 2. Create the database
Open **SQL Editor**, paste in all of `supabase/schema.sql`, and click **Run**. (If you already ran an older version, first run `drop table if exists public.pairings, public.profiles cascade;`.) This sets up:
- a trigger on `auth.users` that **rejects any email not ending in @gsb.columbia.edu**, so the domain rule is enforced on the server, not only in the browser
- the `profiles` and `pairings` tables, with row-level security
- `accept_pairing()`: only the person who received a request can accept it
- `partner_contacts()`: emails are shown only to accepted partners

### 3. Set up email sign-in with one-time codes
- **Authentication → Sign In / Providers → Email**: enable it. Turn off "Confirm email" (the code already confirms the address).
- **Authentication → Emails → Templates → Magic Link**: replace the body with a version that shows the code, for example:
  ```html
  <h2>Your CBS Language Exchange code</h2>
  <p>Enter this code to sign in: <strong>{{ .Token }}</strong></p>
  <p>It expires in 1 hour. If you didn't request it, you can ignore this email.</p>
  ```
  Do the same for the **Confirm signup** template, so first-time users also get a code.
- **Set up custom SMTP (strongly recommended):** Supabase's built-in email service only sends a few emails per hour and is meant for testing. Under **Authentication → Emails → SMTP Settings**, connect a provider such as Resend, Postmark, or SendGrid (most have a free tier). Columbia's spam filters are more likely to deliver mail from a verified sending domain.

### 4. Connect the site
In **Project Settings → API**, copy the Project URL and the `anon` public key into `config.js`:

```js
window.EXBO_CONFIG = {
  SUPABASE_URL: "https://xxxx.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOi...",
  ALLOWED_DOMAIN: "gsb.columbia.edu",
};
```

The anon key is meant to be public; the row-level security policies protect the data. **Never** put the `service_role` key in this file.

### 5. Deploy
Any static host works. The simplest options:
- **Netlify Drop:** drag the `cbs-language-exchange` folder onto app.netlify.com/drop
- **Vercel / Cloudflare Pages / GitHub Pages:** push the folder to a repo and import it

Then, in Supabase → **Authentication → URL Configuration**, set the **Site URL** to your deployed address.

## Customizing

- **Languages:** edit `LANGUAGES` in `app.js` **and** both language lists in the `profiles` table in `schema.sql` (`coach_languages` and `learn_languages`). All three lists must match. After launch, change them with `alter table ... drop constraint / add constraint` in the SQL editor.
- **Pending-request limit:** each person can have 10 outstanding requests (`validate_pairing` in `schema.sql`).
- **Branding/colors:** the CSS variables at the top of `styles.css`.

## Admin tips

- See every user, profile, and pairing in Supabase → **Table Editor**.
- To remove someone, delete them under **Authentication → Users**. Their profile and pairings are deleted with them.
