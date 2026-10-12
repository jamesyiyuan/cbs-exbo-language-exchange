# CBS Language Exchange

A web app that matches Columbia Business School students who want to learn a language with classmates who can coach it. Run by the Global Citizenship team of the CBS Student Government Executive Board (ExBo).

**Live site:** [cbs-exbo-language-exchange.vercel.app](https://cbs-exbo-language-exchange.vercel.app) (sign-in limited to @gsb.columbia.edu emails)

## Background

CBS has a student-run language coaching program where students volunteer to teach their native or fluent languages to classmates. For years, the program was coordinated through a WhatsApp group chat. That worked at small scale but made matching slow and unreliable:

- Requests and offers got buried in the chat, so learners and coaches often never found each other
- There was no single view of who could coach which language
- Following up and scheduling depended on organizers manually connecting people

As VP of Global Citizenship on ExBo, I took the initiative to replace the group chat with a simple self-serve site, so students can find a coach (or a learner) and connect without an organizer in the middle.

## What it does

- **CBS-only sign-in** with a one-time code sent to an @gsb.columbia.edu email (no passwords)
- **Two-sided profiles:** for each of 18 languages, a student can mark "I can coach" and/or "I want to learn", so one person can be both a coach and a learner
- **Directory and matching:** browse classmates by language and send a pairing request (for example, "Learn Japanese from Aiko"); the recipient accepts or declines
- **Privacy by default:** email addresses are revealed only after both sides agree to a pairing; partners then schedule sessions directly

## How it was built

This is a small project, and I want to be transparent about how it was made: the code was written largely with AI coding tools ("vibe coded"). My role was product and execution: defining the problem and requirements (who can sign in, how matching works, what data stays private), iterating on the user flow, setting up the backend and hosting, testing, and rolling it out to students.

**Stack**

| Layer | Choice |
| --- | --- |
| Front end | Static HTML, CSS, and vanilla JavaScript (no framework, no build step) |
| Auth and database | [Supabase](https://supabase.com) (Postgres, email one-time-code login) |
| Access control | Postgres row-level security, plus a server-side trigger that rejects non-CBS emails |
| Hosting | Vercel |

## Repository layout

```
cbs-language-exchange/
├── index.html          # page shell
├── app.js              # all app logic (auth, profiles, directory, pairings)
├── styles.css          # styling
├── config.js           # Supabase project URL and public (anon) key
├── supabase/schema.sql # tables, row-level security policies, and helper functions
└── README.md           # setup and deployment guide
```

## Run it locally

If you blank out the two Supabase values in `config.js`, the site runs in a **demo mode** that stores data in the browser and pre-fills sample classmates:

```bash
cd cbs-language-exchange && python3 -m http.server 5173
# open http://localhost:5173
```

For full setup (Supabase project, database schema, email login, deployment), see [`cbs-language-exchange/README.md`](cbs-language-exchange/README.md).

## Contact

James Yuan, VP of Global Citizenship, CBS ExBo · yyuan27@gsb.columbia.edu
