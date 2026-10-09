// CBS Language Exchange by ExBo
// One page, two backends: Supabase when config.js has keys, otherwise a localStorage demo.
//
// Anyone can coach some languages and learn others. A pairing is always
// (coach, mentee, language): the language must be in the coach's coach_languages
// and the mentee's learn_languages.

const CFG = window.EXBO_CONFIG || {};
const DOMAIN = (CFG.ALLOWED_DOMAIN || "gsb.columbia.edu").toLowerCase();

// Keep in sync with the CHECK constraints in supabase/schema.sql.
const LANGUAGES = [
  "English", "Chinese (Mandarin)", "Chinese (Cantonese)", "Japanese", "Korean",
  "Vietnamese", "Italian", "German", "French", "Spanish",
  "Dutch", "Russian", "Portuguese", "Hindi", "Bahasa Indonesia",
];
const GREETINGS = ["Hello", "你好", "こんにちは", "안녕하세요", "Xin chào", "Ciao", "Hallo", "Bonjour", "Hola", "Привет", "Olá", "नमस्ते", "Halo"];

// ---------- helpers ----------
const $ = (sel, el = document) => el.querySelector(sel);
const app = $("#app");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const isAllowedEmail = (e) => /^[^\s@]+@[^\s@]+$/.test(e) && e.toLowerCase().endsWith("@" + DOMAIN);
const initials = (name) => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || "").join("");
const firstName = (name) => name.trim().split(/\s+/)[0];
const hue = (id) => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now());
const avatar = (p) => `<div class="avatar" style="--h:${hue(p.id)}" aria-hidden="true">${esc(initials(p.full_name))}</div>`;
const roleTags = (p) =>
  (p.coach_languages.length ? `<span class="tag coach">Coach</span>` : "") +
  (p.learn_languages.length ? `<span class="tag learn">Mentee</span>` : "");
const roleText = (p) => [p.coach_languages.length && "coach", p.learn_languages.length && "mentee"].filter(Boolean).join(" and ");

let toastTimer;
function toast(msg, ms = 3500) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), ms);
}

function friendlyError(err) {
  const msg = err?.message || String(err);
  if (/database error saving new user|only @/i.test(msg)) return `Only @${DOMAIN} email addresses can join.`;
  if (/token has expired|invalid/i.test(msg) && /otp|token|code/i.test(msg)) return "That code is invalid or has expired. Request a new one.";
  if (/rate limit|security purposes/i.test(msg)) return "Too many code requests. Wait a minute and try again.";
  if (/duplicate key|already exists/i.test(msg)) return "You already have a pairing with this person in that direction.";
  return msg;
}

// ---------- Supabase backend ----------
async function makeSupabaseApi(cfg) {
  const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
  const sb = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  const unwrap = ({ data, error }) => { if (error) throw error; return data; };
  const toUser = (u) => (u ? { id: u.id, email: u.email } : null);
  return {
    mode: "live",
    async currentUser() { const { data } = await sb.auth.getSession(); return toUser(data.session?.user); },
    async sendCode(email) { unwrap(await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true } })); },
    async verifyCode(email, token) { return toUser(unwrap(await sb.auth.verifyOtp({ email, token, type: "email" })).user); },
    async signOut() { await sb.auth.signOut(); },
    async getMyProfile(id) { return unwrap(await sb.from("profiles").select("*").eq("id", id).maybeSingle()); },
    async saveProfile(p) { return unwrap(await sb.from("profiles").upsert({ ...p, updated_at: new Date().toISOString() }).select().single()); },
    async deleteProfile(id) { unwrap(await sb.from("profiles").delete().eq("id", id)); },
    async listProfiles() { return unwrap(await sb.from("profiles").select("*").order("created_at", { ascending: false })); },
    async listPairings() { return unwrap(await sb.from("pairings").select("*").order("created_at", { ascending: false })); },
    async requestPair(row) { unwrap(await sb.from("pairings").insert(row)); },
    async acceptPair(id) { unwrap(await sb.rpc("accept_pairing", { pairing_id: id })); },
    async removePair(id) { unwrap(await sb.from("pairings").delete().eq("id", id)); },
    async partnerContacts() {
      const rows = unwrap(await sb.rpc("partner_contacts")) || [];
      return Object.fromEntries(rows.map((r) => [r.partner_id, r.email]));
    },
  };
}

// ---------- Demo backend (localStorage) ----------
const DEMO_KEY = "exbo-demo-v2";
function demoSeed() {
  const people = [
    ["Aiko Tanaka", "MBA '27", ["Japanese", "English"], ["Spanish"], "Grew up in Osaka. Happy to do casual conversation over coffee or help you prep for Tokyo recruiting. Would love to improve my Spanish in return."],
    ["Mateo Álvarez", "MBA '26", ["Spanish", "Portuguese"], ["Japanese", "Korean"], "From Bogotá, spent two years in São Paulo. Flexible on Tuesdays and Thursdays after class."],
    ["Priya Raman", "MBA '27", ["Hindi", "English"], ["French"], "Native Hindi speaker. I like structured sessions with a short reading each week."],
    ["Lucas Moreau", "MBA '27", ["French", "German"], [], "Parisian, worked in Munich for three years. Can help with business French for consulting interviews."],
    ["Wei Zhang", "EMBA", ["Chinese (Mandarin)", "Chinese (Cantonese)"], ["Italian"], "Born in Guangzhou. Weekends work best for me."],
    ["Hannah Kim", "MBA '26", ["Korean", "English"], ["Japanese"], "Heritage Korean speaker. Beginner Japanese, hoping to get conversational before a trek."],
    ["Daniel Okafor", "MBA '27", [], ["Spanish", "French"], "Heading to Madrid for my summer internship. Intermediate Spanish, total beginner in French."],
    ["Sarah Cohen", "MBA '27", [], ["Chinese (Mandarin)"], "Took two years in undergrad and want to get back to it."],
    ["Giulia Rossi", "MBA '26", ["Italian"], ["Chinese (Mandarin)"], "From Milan. Happy to coach Italian over lunch."],
    ["Emily Nguyen", "MBA '27", ["Vietnamese"], ["Spanish"], "Native Vietnamese speaker, learning Spanish for a Latin America role."],
    ["Sven de Vries", "MBA '27", ["Dutch", "German"], ["Portuguese"], "Amsterdam native, fluent German. Learning Portuguese."],
    ["Putri Wijaya", "MBA '26", ["Bahasa Indonesia"], ["Korean"], "From Jakarta. Can coach Bahasa Indonesia at any level."],
    ["Anna Petrova", "MBA '27", ["Russian"], ["Italian"], "Grew up in St. Petersburg. Prefer short, frequent sessions."],
  ];
  const users = [], profiles = [];
  people.forEach(([name, year, coach, learn, bio], i) => {
    const id = "seed-" + i;
    const slug = name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]+/g, ".");
    users.push({ id, email: `${slug}${year.slice(-2)}@${DOMAIN}` });
    profiles.push({ id, full_name: name, class_year: year, coach_languages: coach, learn_languages: learn, bio, created_at: new Date(Date.now() - i * 864e5).toISOString() });
  });
  return { users, profiles, pairings: [], session: null };
}

function makeDemoApi() {
  let db;
  try { db = JSON.parse(localStorage.getItem(DEMO_KEY)); } catch { db = null; }
  db ||= demoSeed();
  const save = () => { try { localStorage.setItem(DEMO_KEY, JSON.stringify(db)); } catch { /* storage unavailable */ } };
  const mine = (p) => p.mentee_id === db.session || p.coach_id === db.session;
  const stillValid = (pr) => {
    const m = db.profiles.find((x) => x.id === pr.mentee_id), c = db.profiles.find((x) => x.id === pr.coach_id);
    return m && c && m.learn_languages.includes(pr.language) && c.coach_languages.includes(pr.language);
  };
  let lastCode = null;

  return {
    mode: "demo",
    async currentUser() { return db.users.find((u) => u.id === db.session) || null; },
    async sendCode(email) {
      if (!isAllowedEmail(email)) throw new Error(`Only @${DOMAIN} email addresses can join.`);
      lastCode = String(Math.floor(100000 + Math.random() * 900000));
      toast(`Demo mode: your code is ${lastCode}`, 20000);
    },
    async verifyCode(email, code) {
      if (!lastCode || code !== lastCode) throw new Error("That code is invalid or has expired. Request a new one.");
      email = email.toLowerCase();
      let u = db.users.find((x) => x.email === email);
      if (!u) { u = { id: uid(), email }; db.users.push(u); }
      db.session = u.id; lastCode = null; save();
      return u;
    },
    async signOut() { db.session = null; save(); },
    async getMyProfile(id) { return db.profiles.find((p) => p.id === id) || null; },
    async saveProfile(p) {
      const prev = db.profiles.find((x) => x.id === p.id);
      const row = { ...prev, ...p, created_at: prev?.created_at || new Date().toISOString() };
      db.profiles = prev ? db.profiles.map((x) => (x.id === p.id ? row : x)) : [row, ...db.profiles];
      db.pairings = db.pairings.filter(stillValid);
      // So a new demo user can try the accept flow, have a seeded match send them a request.
      if (!prev) {
        for (const o of db.profiles.filter((x) => x.id.startsWith("seed-"))) {
          const teach = o.coach_languages.find((l) => row.learn_languages.includes(l));
          const learn = o.learn_languages.find((l) => row.coach_languages.includes(l));
          if (teach || learn) {
            const [mentee, coach, language] = teach ? [row, o, teach] : [o, row, learn];
            db.pairings.push({ id: uid(), mentee_id: mentee.id, coach_id: coach.id, language, requested_by: o.id, status: "pending", created_at: new Date().toISOString() });
            break;
          }
        }
      }
      save();
      return row;
    },
    async deleteProfile(id) {
      db.profiles = db.profiles.filter((p) => p.id !== id);
      db.pairings = db.pairings.filter((x) => x.mentee_id !== id && x.coach_id !== id);
      save();
    },
    async listProfiles() { return db.profiles.slice(); },
    async listPairings() { return db.pairings.filter(mine); },
    async requestPair(row) {
      if (db.pairings.some((x) => x.mentee_id === row.mentee_id && x.coach_id === row.coach_id)) throw new Error("duplicate key");
      const pr = { ...row, id: uid(), status: "pending", created_at: new Date().toISOString() };
      if (!stillValid(pr)) throw new Error("That language isn't a match for both of you.");
      db.pairings.push(pr);
      save();
    },
    async acceptPair(id) {
      const p = db.pairings.find((x) => x.id === id && mine(x) && x.requested_by !== db.session);
      if (!p) throw new Error("Request not found");
      p.status = "accepted"; p.accepted_at = new Date().toISOString(); save();
    },
    async removePair(id) { db.pairings = db.pairings.filter((x) => !(x.id === id && mine(x))); save(); },
    async partnerContacts() {
      const out = {};
      for (const p of db.pairings.filter((x) => mine(x) && x.status === "accepted")) {
        const other = p.mentee_id === db.session ? p.coach_id : p.mentee_id;
        out[other] = db.users.find((u) => u.id === other)?.email;
      }
      return out;
    },
  };
}

// ---------- state ----------
const state = {
  api: null, user: null, me: null,
  profiles: [], pairings: [], contacts: {},
  tab: "directory",
  filters: { show: "match", lang: "any", q: "" },
  pendingEmail: "",
};

const profileById = (id) => state.profiles.find((p) => p.id === id);
const otherId = (pr) => (pr.mentee_id === state.me.id ? pr.coach_id : pr.mentee_id);
const pairingsWith = (id) => state.pairings.filter((p) => p.mentee_id === id || p.coach_id === id);
const incomingCount = () => state.pairings.filter((p) => p.status === "pending" && p.requested_by !== state.me.id).length;

// Every way I could pair with p: they coach me, or I coach them.
function matchOptions(p) {
  const me = state.me;
  return [
    ...p.coach_languages.filter((l) => me.learn_languages.includes(l)).map((language) => ({ dir: "they", language })),
    ...me.coach_languages.filter((l) => p.learn_languages.includes(l)).map((language) => ({ dir: "me", language })),
  ];
}

function describePair(pr, p) {
  return pr.coach_id === p.id
    ? `${esc(firstName(p.full_name))} coaches you in ${esc(pr.language)}`
    : `You coach ${esc(firstName(p.full_name))} in ${esc(pr.language)}`;
}

// ---------- routing ----------
async function boot() {
  try {
    state.api = CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY ? await makeSupabaseApi(CFG) : makeDemoApi();
  } catch (err) {
    app.innerHTML = `<div class="empty"><h3>Couldn't connect</h3><p>${esc(friendlyError(err))}</p></div>`;
    return;
  }
  if (state.api.mode === "demo") $("#demoBanner").hidden = false;
  state.user = await state.api.currentUser();
  await route();
}

async function route() {
  try {
    $("#account").hidden = !state.user;
    $("#accountEmail").textContent = state.user?.email || "";
    if (!state.user) return renderAuth();
    state.me = await state.api.getMyProfile(state.user.id);
    if (!state.me) return renderProfile(true);
    await refresh();
    render();
  } catch (err) {
    toast(friendlyError(err));
  }
}

async function refresh() {
  const [profiles, pairings, contacts] = await Promise.all([
    state.api.listProfiles(), state.api.listPairings(), state.api.partnerContacts(),
  ]);
  Object.assign(state, { profiles, pairings, contacts });
}

function render() {
  if (state.tab === "pairings") renderPairings();
  else if (state.tab === "profile") renderProfile(false);
  else renderDirectory();
  window.scrollTo({ top: 0 });
}

// App shell: sidebar (identity, nav, optional filters) + content.
function shell(content, sideExtra = "") {
  const me = state.me;
  const n = incomingCount();
  const navItem = (tab, label, extra = "") =>
    `<button data-nav="${tab}" ${state.tab === tab ? 'aria-current="page"' : ""}><span>${label}</span>${extra}</button>`;
  app.innerHTML = `
    <div class="layout">
      <aside class="side">
        <div class="card me-card">
          ${avatar(me)}
          <div><strong>${esc(me.full_name)}</strong><div class="tags">${roleTags(me)}</div></div>
        </div>
        <nav class="side-nav" aria-label="Sections">
          ${navItem("directory", "Find a partner")}
          ${navItem("pairings", "My pairings", n ? `<span class="badge">${n}</span>` : "")}
          ${navItem("profile", "My profile")}
        </nav>
        ${sideExtra}
      </aside>
      <section class="content">${content}</section>
    </div>`;
}

// ---------- auth ----------
function renderAuth() {
  const codeStep = !!state.pendingEmail;
  app.innerHTML = `
    <section class="landing-hero">
      <div class="wrap">
        <p class="eyebrow">Columbia Business School · Volunteer-run</p>
        <h1>Trade languages with your <em>classmates</em>.</h1>
        <p class="lede">Coach a language you know, learn one you don't, or do both. Find a CBS partner, pair up, and set your own schedule.</p>
        <div class="greetings" aria-hidden="true">${GREETINGS.map((g) => `<span>${esc(g)}</span>`).join("")}</div>
      </div>
    </section>
    <div class="auth-wrap">
      <div class="card auth-card">
        ${codeStep ? `
          <form id="codeForm" novalidate>
            <h2>Check your inbox</h2>
            <p class="sub">We sent a one-time code to <strong>${esc(state.pendingEmail)}</strong>.</p>
            <div class="field">
              <label for="code">One-time code</label>
              <input id="code" class="otp-input" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="10" required>
            </div>
            <p class="error" id="authError"></p>
            <button class="btn primary" type="submit">Verify and continue</button>
            <div class="auth-foot">
              <button type="button" class="linkbtn" id="changeEmail">Use a different email</button>
              <button type="button" class="linkbtn" id="resend">Resend code</button>
            </div>
          </form>` : `
          <form id="emailForm" novalidate>
            <h2>Sign in or join</h2>
            <p class="sub">Open to CBS students only. No password needed.</p>
            <div class="field">
              <label for="email">CBS email</label>
              <input id="email" type="email" autocomplete="email" placeholder="you@${esc(DOMAIN)}" required>
            </div>
            <p class="error" id="authError"></p>
            <button class="btn primary" type="submit">Email me a code</button>
          </form>`}
      </div>
    </div>
    <section class="how wrap">
      <div><div class="num">1</div><h3>Sign in with your CBS email</h3><p>Only @${esc(DOMAIN)} addresses can join. We email you a one-time code, so there's no password to remember.</p></div>
      <div><div class="num">2</div><h3>Pick what you coach and learn</h3><p>Choose from ${LANGUAGES.length} languages. Coach some, learn others, or do both and make it a two-way exchange.</p></div>
      <div><div class="num">3</div><h3>Pair up and meet</h3><p>Send a request. Once it's accepted, you both see each other's email and schedule sessions yourselves.</p></div>
    </section>`;

  $(codeStep ? "#code" : "#email").focus({ preventScroll: true });
  if (codeStep) {
    $("#codeForm").onsubmit = async (e) => {
      e.preventDefault();
      const code = $("#code").value.replace(/\D/g, "");
      if (code.length < 6) return showAuthError("Enter the code from your email.");
      await withBusy(e.submitter, async () => {
        state.user = await state.api.verifyCode(state.pendingEmail, code);
        state.pendingEmail = "";
        state.tab = "directory";
        await route();
      }, showAuthError);
    };
    $("#changeEmail").onclick = () => { state.pendingEmail = ""; renderAuth(); };
    $("#resend").onclick = (e) => withBusy(e.currentTarget, async () => {
      await state.api.sendCode(state.pendingEmail);
      if (state.api.mode === "live") toast("New code sent.");
      cooldown(e.currentTarget, 60);
    }, showAuthError, false);
  } else {
    $("#emailForm").onsubmit = async (e) => {
      e.preventDefault();
      const email = $("#email").value.trim().toLowerCase();
      if (!isAllowedEmail(email)) return showAuthError(`Use your @${DOMAIN} address. Only CBS students can join.`);
      await withBusy(e.submitter, async () => {
        await state.api.sendCode(email);
        state.pendingEmail = email;
        renderAuth();
      }, showAuthError);
    };
  }
}

function showAuthError(msg) { const el = $("#authError"); if (el) el.textContent = friendlyError(msg); }

function cooldown(btn, secs) {
  btn.disabled = true;
  const label = btn.textContent;
  const tick = () => {
    if (!btn.isConnected) return;
    if (secs <= 0) { btn.disabled = false; btn.textContent = label; return; }
    btn.textContent = `Resend in ${secs--}s`;
    setTimeout(tick, 1000);
  };
  tick();
}

async function withBusy(btn, fn, onError = (m) => toast(friendlyError(m)), restore = true) {
  if (btn) btn.disabled = true;
  try { await fn(); }
  catch (err) { onError(err); restore = true; }
  finally { if (btn && restore && btn.isConnected) btn.disabled = false; }
}

// ---------- profile ----------
function renderProfile(onboarding) {
  const p = state.me || { full_name: "", class_year: "", coach_languages: [], learn_languages: [], bio: "" };
  const form = `
    <form id="profileForm" class="card profile-form" novalidate>
      <div class="two-col">
        <div class="field">
          <label for="full_name">Full name</label>
          <input id="full_name" type="text" maxlength="80" value="${esc(p.full_name)}" required autocomplete="name">
        </div>
        <div class="field">
          <label for="class_year">Program and class <span class="hint">(optional)</span></label>
          <input id="class_year" type="text" maxlength="40" list="years" value="${esc(p.class_year)}" placeholder="e.g. MBA '27">
          <datalist id="years"><option value="MBA '26"><option value="MBA '27"><option value="MBA '28"><option value="EMBA"></datalist>
        </div>
      </div>
      <div class="field">
        <label id="langLabel">Your languages</label>
        <span class="hint">For each language, mark whether you can coach it, want to learn it, or leave it blank. Coach some and learn others to be both a coach and a mentee.</span>
      </div>
      <table class="matrix" aria-labelledby="langLabel">
        <thead><tr><th scope="col">Language</th><th scope="col">I can coach</th><th scope="col">I want to learn</th></tr></thead>
        <tbody>
          ${LANGUAGES.map((l) => `
            <tr>
              <td>${esc(l)}</td>
              <td><label class="toggle"><input type="checkbox" name="coach" value="${esc(l)}" aria-label="I can coach ${esc(l)}" ${p.coach_languages.includes(l) ? "checked" : ""}><span class="c">Coach</span></label></td>
              <td><label class="toggle"><input type="checkbox" name="learn" value="${esc(l)}" aria-label="I want to learn ${esc(l)}" ${p.learn_languages.includes(l) ? "checked" : ""}><span class="l">Learn</span></label></td>
            </tr>`).join("")}
        </tbody>
      </table>
      <p class="role-summary" id="roleSummary"></p>
      <div class="field">
        <label for="bio">About you <span class="hint">(optional, up to 500 characters)</span></label>
        <textarea id="bio" maxlength="500" placeholder="Your level in each language, what you'd like to focus on, and when you're usually free.">${esc(p.bio)}</textarea>
      </div>
      <p class="error" id="profileError"></p>
      <div class="form-actions">
        <button class="btn primary" type="submit">${onboarding ? "Join the exchange" : "Save changes"}</button>
        ${onboarding
          ? `<button type="button" class="btn ghost" id="cancelOnboard">Sign out</button>`
          : `<button type="button" class="btn ghost danger" id="deleteProfile">Remove my profile</button>`}
      </div>
    </form>`;

  const head = `
    <div class="page-head">
      <h2>${onboarding ? "Set up your profile" : "My profile"}</h2>
      <p>${onboarding ? "Classmates will see this when looking for a partner." : "Changes show up for classmates right away."}</p>
    </div>`;
  if (onboarding) app.innerHTML = `<div class="layout" style="grid-template-columns:1fr;max-width:820px">${`<section class="content">${head}${form}</section>`}</div>`;
  else shell(head + form);

  const f = $("#profileForm");
  const picked = (name) => [...f.querySelectorAll(`input[name="${name}"]:checked`)].map((i) => i.value);
  const summarize = () => {
    const c = picked("coach"), l = picked("learn");
    const roles = [c.length && `<strong>coach</strong> (${c.length})`, l.length && `<strong>mentee</strong> (${l.length})`].filter(Boolean);
    $("#roleSummary").innerHTML = roles.length ? `You'll appear as a ${roles.join(" and a ")}.` : "Pick at least one language to coach or learn.";
  };
  summarize();
  f.addEventListener("change", (e) => {
    // A language can't be both coached and learned by the same person.
    if (e.target.checked && (e.target.name === "coach" || e.target.name === "learn")) {
      const other = f.querySelector(`input[name="${e.target.name === "coach" ? "learn" : "coach"}"][value="${CSS.escape(e.target.value)}"]`);
      if (other) other.checked = false;
    }
    summarize();
  });

  f.onsubmit = async (e) => {
    e.preventDefault();
    const err = (m) => { $("#profileError").textContent = m; };
    const next = {
      id: state.user.id,
      full_name: $("#full_name").value.trim(),
      class_year: $("#class_year").value.trim() || null,
      coach_languages: picked("coach"),
      learn_languages: picked("learn"),
      bio: $("#bio").value.trim() || null,
    };
    if (!next.full_name) return err("Add your name.");
    if (!next.coach_languages.length && !next.learn_languages.length) return err("Pick at least one language to coach or learn.");
    const dropped = state.me ? state.pairings.filter((pr) =>
      (pr.coach_id === state.me.id && !next.coach_languages.includes(pr.language)) ||
      (pr.mentee_id === state.me.id && !next.learn_languages.includes(pr.language))) : [];
    if (dropped.length && !confirm(`This change removes ${dropped.length} pairing(s) or request(s) for languages you unselected. Continue?`)) return;

    await withBusy(e.submitter, async () => {
      state.me = await state.api.saveProfile(next);
      toast(onboarding ? "Welcome to the exchange!" : "Profile saved.");
      state.tab = "directory";
      await refresh();
      render();
    }, (m) => err(friendlyError(m)));
  };

  $("#cancelOnboard")?.addEventListener("click", signOut);
  $("#deleteProfile")?.addEventListener("click", async (e) => {
    if (!confirm("Remove your profile and all your pairings? You can rejoin later.")) return;
    await withBusy(e.currentTarget, async () => {
      await state.api.deleteProfile(state.user.id);
      state.me = null;
      toast("Your profile has been removed.");
      await route();
    });
  });
}

// ---------- directory ----------
function renderDirectory() {
  const { me, filters: f } = state;
  const showOpts = [
    ["match", "Matches for me"],
    ...(me.learn_languages.length ? [["they", "Can coach me"]] : []),
    ...(me.coach_languages.length ? [["me", "I can coach"]] : []),
    ["all", "Everyone"],
  ];
  if (!showOpts.some(([v]) => v === f.show)) f.show = "match";

  const filters = `
    <div class="card side-section side-filters">
      <h4>Show</h4>
      <div class="radio-list" role="radiogroup" aria-label="Show">
        ${showOpts.map(([v, label]) => `<label><input type="radio" name="show" value="${v}" ${f.show === v ? "checked" : ""}> ${label}</label>`).join("")}
      </div>
      <h4>Language</h4>
      <select id="fLang" aria-label="Filter by language">
        <option value="any">All languages</option>
        ${LANGUAGES.map((l) => `<option value="${esc(l)}" ${f.lang === l ? "selected" : ""}>${esc(l)}</option>`).join("")}
      </select>
      <input id="fQ" type="search" placeholder="Search names and bios" value="${esc(f.q)}" aria-label="Search">
    </div>`;

  shell(`
    <div class="page-head">
      <h2>Find a partner</h2>
      <p>Highlighted languages are matches with your profile. A pairing is one person coaching the other in one language, and two people can coach each other.</p>
    </div>
    <p class="count" id="count"></p>
    <div id="results"></div>`, filters);

  app.querySelectorAll('input[name="show"]').forEach((r) => (r.onchange = () => { f.show = r.value; renderResults(); }));
  $("#fLang").onchange = (e) => { f.lang = e.target.value; renderResults(); };
  $("#fQ").oninput = (e) => { f.q = e.target.value; renderResults(); };
  renderResults();
}

function renderResults() {
  const { me, filters: f } = state;
  const rows = state.profiles
    .filter((p) => p.id !== me.id)
    .map((p) => ({ p, opts: matchOptions(p), prs: pairingsWith(p.id) }))
    .filter(({ opts, prs }) =>
      f.show === "all" ||
      (f.show === "match" ? opts.length || prs.length : opts.some((o) => o.dir === f.show)))
    .filter(({ p }) => f.lang === "any" || p.coach_languages.includes(f.lang) || p.learn_languages.includes(f.lang))
    .filter(({ p }) => !f.q || `${p.full_name} ${p.class_year || ""} ${p.bio || ""}`.toLowerCase().includes(f.q.toLowerCase()))
    .sort((a, b) => b.opts.length - a.opts.length);

  $("#count").textContent = `${rows.length} ${rows.length === 1 ? "person" : "people"}`;
  $("#results").innerHTML = rows.length
    ? `<div class="people">${rows.map(personRow).join("")}</div>`
    : `<div class="empty card"><h3>No one matches yet</h3><p>Try "Everyone" or "All languages", or add more languages to your profile.</p></div>`;
}

function langLine(label, langs, highlight) {
  if (!langs.length) return "";
  return `<div class="lang-line"><span>${label}</span><ul class="chips">${langs.map((l) =>
    `<li class="chip${highlight.includes(l) ? " match" : ""}">${esc(l)}</li>`).join("")}</ul></div>`;
}

function personRow({ p, opts, prs }) {
  const me = state.me;
  const mutual = opts.some((o) => o.dir === "they") && opts.some((o) => o.dir === "me");
  return `
    <article class="card person">
      <div class="person-main">
        ${avatar(p)}
        <div class="person-info">
          <div class="name-line">
            <h3>${esc(p.full_name)}</h3>
            <span class="muted small">${esc(p.class_year || "CBS")}</span>
            <span class="tags">${roleTags(p)}${mutual ? `<span class="tag mutual">Two-way match</span>` : ""}</span>
          </div>
          ${langLine("Coaches", p.coach_languages, me.learn_languages)}
          ${langLine("Learning", p.learn_languages, me.coach_languages)}
          ${p.bio ? `<p class="bio">${esc(p.bio)}</p>` : ""}
        </div>
      </div>
      <div class="person-actions">${personActions(p, opts, prs)}</div>
    </article>`;
}

function statusBlock(pr, p) {
  const desc = describePair(pr, p);
  if (pr.status === "accepted") {
    const email = state.contacts[p.id];
    return `<div class="status-line ok"><strong>Paired: ${desc}</strong>
      ${email ? `<div class="row"><a class="btn small" href="${mailto(email, p, pr)}">Email ${esc(firstName(p.full_name))}</a></div>` : ""}</div>`;
  }
  if (pr.requested_by === state.me.id) {
    return `<div class="status-line"><strong>Request sent: ${desc}</strong>
      <div class="row"><button class="btn ghost small" data-act="remove" data-id="${pr.id}" data-confirm="Withdraw your request?">Withdraw</button></div></div>`;
  }
  return `<div class="status-line"><strong>Wants to pair: ${desc}</strong>
    <div class="row"><button class="btn primary small" data-act="accept" data-id="${pr.id}">Accept</button>
    <button class="btn ghost small" data-act="remove" data-id="${pr.id}" data-confirm="Decline this request?">Decline</button></div></div>`;
}

function personActions(p, opts, prs) {
  const used = new Set(prs.map((pr) => (pr.coach_id === p.id ? "they" : "me")));
  const avail = opts.filter((o) => !used.has(o.dir));
  const first = esc(firstName(p.full_name));
  const label = (o) => (o.dir === "they" ? `Learn ${esc(o.language)} from ${first}` : `Coach ${first} in ${esc(o.language)}`);
  let html = prs.map((pr) => statusBlock(pr, p)).join("");
  if (avail.length === 1) {
    html += `<button class="btn primary small" data-act="request" data-id="${p.id}" data-opt="${avail[0].dir}|${esc(avail[0].language)}">${label(avail[0])}</button>`;
  } else if (avail.length > 1) {
    html += `<select data-opt-for="${p.id}" aria-label="Choose a pairing">${avail.map((o) =>
      `<option value="${o.dir}|${esc(o.language)}">${label(o)}</option>`).join("")}</select>
      <button class="btn primary small" data-act="request" data-id="${p.id}">Request to pair</button>`;
  }
  if (!html) html = `<p class="no-match">No language match with your profile</p>`;
  return html;
}

function mailto(email, p, pr) {
  const subject = encodeURIComponent(`CBS Language Exchange: ${pr.language}`);
  const body = encodeURIComponent(`Hi ${firstName(p.full_name)},\n\nGlad we're paired for ${pr.language}! A few times that work for me:\n\n- \n- \n\nBest,\n${firstName(state.me.full_name)}`);
  return `mailto:${encodeURIComponent(email)}?subject=${subject}&body=${body}`;
}

// ---------- pairings ----------
function renderPairings() {
  const me = state.me.id;
  const incoming = state.pairings.filter((p) => p.status === "pending" && p.requested_by !== me);
  const outgoing = state.pairings.filter((p) => p.status === "pending" && p.requested_by === me);
  const active = state.pairings.filter((p) => p.status === "accepted");

  const row = (pr, actions) => {
    const p = profileById(otherId(pr));
    if (!p) return "";
    return `
      <div class="card pair-row">
        ${avatar(p)}
        <div class="who"><strong>${esc(p.full_name)}</strong><span>${describePair(pr, p)}${p.class_year ? ` · ${esc(p.class_year)}` : ""}</span></div>
        <div class="actions">${actions(pr, p)}</div>
      </div>`;
  };
  const section = (title, items, empty, actions) => `
    <section class="pair-section">
      <h3>${title} <span class="muted">(${items.length})</span></h3>
      <div class="pair-list">${items.length ? items.map((pr) => row(pr, actions)).join("") : `<p class="pair-empty">${empty}</p>`}</div>
    </section>`;

  shell(`
    <div class="page-head"><h2>My pairings</h2><p>Once you're paired, email each other and schedule sessions directly.</p></div>
    ${active.length ? `<div class="tip"><strong>Tip:</strong> suggest 2–3 specific times and a place (a study room, coffee, or Zoom) in your first email. Short, regular sessions usually work better than long, occasional ones.</div>` : ""}
    ${section("Requests for you", incoming, "No new requests.", (pr) => `
      <button class="btn primary small" data-act="accept" data-id="${pr.id}">Accept</button>
      <button class="btn ghost small" data-act="remove" data-id="${pr.id}" data-confirm="Decline this request?">Decline</button>`)}
    ${section("Active pairs", active, `No pairs yet. <button class="linkbtn" data-nav="directory">Find a partner</button>.`, (pr, p) => {
      const email = state.contacts[p.id];
      return `${email ? `<a class="btn small" href="${mailto(email, p, pr)}">Email ${esc(email)}</a>` : ""}
        <button class="btn ghost small danger" data-act="remove" data-id="${pr.id}" data-confirm="End this pairing with ${esc(p.full_name)}?">End</button>`;
    })}
    ${section("Waiting on them", outgoing, "No pending requests.", (pr) => `
      <button class="btn ghost small" data-act="remove" data-id="${pr.id}" data-confirm="Withdraw your request?">Withdraw</button>`)}`);
}

// ---------- actions (delegated) ----------
app.addEventListener("click", async (e) => {
  const nav = e.target.closest("[data-nav]");
  if (nav) {
    state.tab = nav.dataset.nav;
    try { await refresh(); } catch (err) { toast(friendlyError(err)); }
    return render();
  }

  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const { act, id } = btn.dataset;
  if (btn.dataset.confirm && !confirm(btn.dataset.confirm)) return;

  await withBusy(btn, async () => {
    if (act === "request") {
      const other = profileById(id);
      const sel = app.querySelector(`select[data-opt-for="${CSS.escape(id)}"]`);
      const [dir, language] = (sel ? sel.value : btn.dataset.opt).split("|");
      const [mentee, coach] = dir === "they" ? [state.me, other] : [other, state.me];
      await state.api.requestPair({ mentee_id: mentee.id, coach_id: coach.id, language, requested_by: state.me.id });
      toast(`Request sent to ${firstName(other.full_name)}.`);
    } else if (act === "accept") {
      await state.api.acceptPair(id);
      toast("Paired! Their email is now visible so you can reach out.");
    } else if (act === "remove") {
      await state.api.removePair(id);
    }
    await refresh();
    const y = window.scrollY;
    render();
    window.scrollTo({ top: y });
  });
});

async function signOut() {
  await state.api.signOut();
  Object.assign(state, { user: null, me: null, profiles: [], pairings: [], contacts: {}, tab: "directory", pendingEmail: "" });
  await route();
}
$("#signOut").addEventListener("click", signOut);
$("#resetDemo").addEventListener("click", () => {
  if (!confirm("Reset all demo data in this browser?")) return;
  try { localStorage.removeItem(DEMO_KEY); } catch { /* ignore */ }
  location.reload();
});

boot();
