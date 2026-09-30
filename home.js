// Launch state. null: every "Join the waitlist" spot is a form. A URL: every spot becomes the App Store badge linking to it.
const APP_STORE_URL = null;

(() => {
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const RM = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

/* ---------- waitlist: one handler for every form ---------- */
const NOTE = { idle: 'One email when Seduta is on the App Store. Nothing else.', invalid: 'That doesn’t look like an email address. Check it and try again.', sending: 'One email when Seduta is on the App Store. Nothing else.', done: 'One email when Seduta is on the App Store. Nothing else.', error: 'That didn’t work. Try again, or write to seduta@spert.ai.' };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const TICK = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#37352F" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 12.6 L9.6 17.4 L19.8 6.4"/></svg>';
// ponytail: stand-in badge. Replace with Apple's official "Download on the App Store" SVG (Apple's marketing guidelines) before launch.
const badge = (cls) => `<a class="badge${cls ? ' ' + cls : ''}" href="${APP_STORE_URL}"><span>Download on the</span><span>App Store</span></a>`;

function wlHTML(v) {
  return `<div class="wl${v === 'end' ? ' end' : ''}" data-st="idle"><form class="wl-form" novalidate>` +
    '<input class="wl-in" type="email" name="email" inputmode="email" autocomplete="email" placeholder="you@company.com" aria-label="Email address" aria-describedby="">' +
    '<input class="hp" type="text" name="company" tabindex="-1" autocomplete="off" aria-hidden="true">' +
    '<button class="wl-btn" type="submit">Join the waitlist</button></form>' +
    `<div class="wl-note" role="status">${NOTE.idle}</div>` +
    `<div class="wl-done">${TICK}<b>You’re on the list.</b><span class="em"></span></div></div>`;
}

function wireWl(root) {
  const form = $('.wl-form', root), inp = $('.wl-in', root), hp = $('.hp', root), btn = $('.wl-btn', root), note = $('.wl-note', root);
  const set = (st) => { root.dataset.st = st; note.textContent = NOTE[st] || ''; inp.setAttribute('aria-invalid', st === 'invalid' || st === 'error' ? 'true' : 'false'); btn.textContent = st === 'sending' ? 'Sending…' : 'Join the waitlist'; };
  const id = 'wln' + Math.random().toString(36).slice(2, 7);
  note.id = id; inp.setAttribute('aria-describedby', id);
  inp.addEventListener('input', () => { const s = root.dataset.st; if (s === 'invalid' || s === 'error') set('idle'); });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (root.dataset.st === 'sending') return;
    const email = inp.value.trim();
    if (!EMAIL.test(email)) { set('invalid'); inp.focus(); return; }
    set('sending');
    const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 15000);
    let out = 'error';
    try {
      const r = await fetch('/api/waitlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, company: hp.value }), signal: ctl.signal });
      let j = null; try { j = await r.json(); } catch (_) {}
      if (r.status === 200 && j && j.ok === true) out = 'done';
      else if (r.status === 400 && j && j.error === 'invalid') out = 'invalid';
    } catch (_) { out = 'error'; }
    clearTimeout(to);
    if (out === 'done') $('.em', root).textContent = email;
    set(out);
  });
}

function initSlots() {
  $$('.wl-slot').forEach((slot) => {
    const v = slot.dataset.v;
    if (APP_STORE_URL) {
      slot.innerHTML = v === 'hero' ? `<div class="dl">${badge('')}<span class="free-dl">Free to download</span></div>` : `<div class="dl">${badge('')}</div>`;
    } else {
      slot.innerHTML = wlHTML(v);
      wireWl($('.wl', slot));
    }
  });
  const cta = $('#hdr-cta');
  if (APP_STORE_URL) cta.innerHTML = badge('sm');
  else $$('[data-join]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    const i = $('#join .wl-in'); if (!i) return;
    i.scrollIntoView({ behavior: RM ? 'auto' : 'smooth', block: 'center' });
    setTimeout(() => i.focus({ preventScroll: true }), RM ? 0 : 350);
  }));
}

/* ---------- pricing ---------- */
function initPricing() {
  // Apple's own price for the visitor's storefront (/api/price, by the country Cloudflare sees; table built by
  // scripts/site_prices.py from App Store Connect). CHF 30/5/35 is the base and the fallback, never a converted number.
  const lang = navigator.language || 'en';
  let yearly = false, p = ['CHF', '30', '5', '35'], cc = 'CH';
  const m = (n) => { n = Number(n); try { return new Intl.NumberFormat(lang, { style: 'currency', currency: p[0], minimumFractionDigits: 0, maximumFractionDigits: Number.isInteger(n) ? 0 : 2 }).format(n); } catch (_) { return p[0] + ' ' + n; } };
  const draw = () => {
    $$('[data-p]').forEach((e) => { const k = e.dataset.p; e.textContent = m(k === 'free' ? 0 : k === 'byok' ? p[1] : yearly ? p[3] : p[2]); });
    $('#per').textContent = yearly ? 'a year' : 'a month';
    $$('#per-seg button').forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.y === '1') === yearly)));
    let name = cc; try { name = new Intl.DisplayNames(['en'], { type: 'region' }).of(cc); } catch (_) {}
    $('#price-note').textContent = 'App Store prices for ' + name + '. Other countries see their own price in the App Store.';
  };
  $('#per-seg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { yearly = b.dataset.y === '1'; draw(); } });
  draw();
  fetch('/api/price').then((r) => r.json()).then((j) => { if (j && j.price) { p = j.price; cc = j.country; draw(); } }).catch(() => {});
}

/* ---------- terminal in "Under the hood" ---------- */
function initTerm() {
  const Q = 'What did we decide about the launch date?';
  const A = 'The launch moves to the 21st unless the printer can rush the flyers. Amélie asks for a rush slot on Monday, and you tell the client on Friday.';
  const q = $('#tq'), cq = $('#tcq'), rd = $('#tread'), aw = $('#ta-w'), a = $('#ta'), ca = $('#tca'), src = $('#tsrc');
  const READ = 'Read 1 meeting: Spring campaign review';
  if (RM) { q.textContent = Q; cq.hidden = true; rd.hidden = false; rd.textContent = READ; aw.hidden = false; a.textContent = A; ca.hidden = true; src.hidden = false; return; }
  const T = (ms, fn) => setTimeout(fn, ms);
  const typeQ = (n) => {
    q.textContent = Q.slice(0, n); cq.hidden = false; rd.hidden = true; aw.hidden = true; src.hidden = true; ca.hidden = false;
    if (n < Q.length) T(45 + Math.random() * 50, () => typeQ(n + 1));
    else T(500, () => { cq.hidden = true; rd.hidden = false; rd.textContent = 'Reading your Seduta notes…'; T(1300, () => streamA(0)); });
  };
  const streamA = (n) => {
    rd.textContent = READ; aw.hidden = false; a.textContent = A.slice(0, n); ca.hidden = false;
    if (n < A.length) T(14, () => streamA(Math.min(A.length, n + 3)));
    else T(350, () => { ca.hidden = true; src.hidden = false; T(5200, () => typeQ(0)); });
  };
  T(800, () => typeQ(0));
}

/* ---------- the drawn Mac ---------- */
const TPL = $('#mac');
const mk = () => TPL.content.firstElementChild.cloneNode(true);
const BOX = 'M4.5 4.6 L19.4 4.5 L19.5 19.4 L4.6 19.5 Z', BOXT = BOX + ' M8 12.3 L11 15.4 L19.8 4.8';
const CLK = ['14:29', '14:30', '14:31', '15:02', '15:03', '15:03', '15:04'];
const LABELS = ['Seduta at rest', 'A call starts', 'Recording', 'Menu bar', 'Notes ready', 'Transcript', 'Your summary'];
const CAPS = ['Seduta sits quietly in your menu bar and knows your calendar.', 'It notices the call and asks. No bot joins.', 'Recording both sides of the call. The red dot shows it, the whole time.', 'Everything is one click from the menu bar.', 'When the call ends, your Mac writes it down. On the device.', 'Every word, with who said it.', 'Change the template, edit it, tick things off. It’s your file.'];
const SPEAKER = (step, sub) => step === 2 ? 's' : step === 3 ? ['s', 'j', 'a', 'm', 's'][Math.max(0, sub - 1)] : step === 4 ? 'm' : '';
const fmt = (s) => String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');

// Writes one state object onto a frame root (#demo, or a phone card's .mac). The CSS does the rest.
function paint(root, s) {
  const d = root.dataset;
  d.step = s.step; d.sub = s.sub; d.prog = s.prog ? 1 : 0; d.tpl = s.tpl; d.picker = s.picker ? 1 : 0; d.speak = SPEAKER(s.step, s.sub);
  const q = root._q || (root._q = { tpl: $$('.tpl-name', root), clk: $('.clk', root), tmr: $('.tmr', root), tips: $$('.tip', root), ai: $$('.ai, .aitr', root), pick: $('[data-act="picker"]', root) });
  q.tpl.forEach((e) => { e.textContent = s.tpl; });
  q.clk.textContent = 'Wed 30 Sep  ' + CLK[s.step - 1];
  q.tmr.textContent = fmt(s.secs);
  q.tips.forEach((t, i) => t.classList.toggle('on', i === s.tip));
  q.pick.setAttribute('aria-expanded', String(!!s.picker));
  q.ai.forEach((e) => {
    const on = !!s.checks[+e.dataset.i];
    e.classList.toggle('done', on);
    $('path', e).setAttribute('d', on ? BOXT : BOX);
    $('.cb', e).setAttribute('aria-checked', String(on));
  });
}

// Actions every frame shares (desktop and phone card 7): template picker, ticking action items.
function common(act, el, s, root) {
  if (act === 'picker') { s.picker = !s.picker; }
  else if (act === 'pick') { s.tpl = el.dataset.t; s.picker = false; }
  else if (act === 'chk') { const i = +el.closest('[data-i]').dataset.i; s.checks = s.checks.slice(); s.checks[i] = !s.checks[i]; }
  else return false;
  paint(root, s);
  return true;
}
// Divs that act as buttons need the keyboard too.
function kbd(root) {
  $$('[data-act="row1"],[data-act="open"],[data-act="back"]', root).forEach((e) => { e.tabIndex = 0; e.setAttribute('role', 'button'); });
  root.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role="button"][data-act]')) { e.preventDefault(); e.target.click(); } });
}

/* desktop demo */
function initDemo() {
  const demo = $('#demo'), slot = $('#macslot');
  const mac = mk(); slot.replaceWith(mac);
  const S = { step: 1, sub: 0, prog: false, auto: false, taken: false, ended: false, tpl: 'Standard', picker: false, tip: -1, secs: 47, checks: [true, false, false] };
  let autoOn = false, timers = [], autoTimers = [];
  const cap = $('#cap'), rail = $('#rail'), bPlay = $('#btn-play'), bPrev = $('#btn-prev'), bNext = $('#btn-next');
  rail.innerHTML = LABELS.map((l, i) => `<button type="button" data-go="${i + 1}"><span class="n">${String(i + 1).padStart(2, '0')}</span><span class="l">${l}</span></button>`).join('');
  const rbs = $$('button', rail);
  bPlay.hidden = RM;

  const render = () => {
    paint(demo, S);
    demo.toggleAttribute('data-ended', S.ended);
    cap.textContent = S.ended ? 'That’s the whole flow. Nothing was recorded.' : CAPS[S.step - 1];
    rbs.forEach((b, i) => { const n = i + 1; b.className = n === S.step ? 'cur' : n < S.step ? 'done' : ''; if (n === S.step) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current'); });
    bPrev.style.opacity = S.step === 1 && !S.ended ? .4 : 1;
    const nl = S.step === 7 && !S.ended ? 'Finish' : 'Next step'; bNext.setAttribute('aria-label', nl); bNext.title = nl;
    const pl = S.auto ? 'Pause autoplay' : 'Play automatically'; bPlay.setAttribute('aria-label', pl); bPlay.title = pl;
    $('.i-pause', bPlay).style.display = S.auto ? '' : 'none'; $('.i-play', bPlay).style.display = S.auto ? 'none' : '';
    $('.endc', demo).setAttribute('aria-hidden', String(!S.ended));
  };
  const clear = () => { timers.forEach(clearTimeout); timers = []; };
  const clearAuto = () => { autoTimers.forEach(clearTimeout); autoTimers = []; };
  const at = (ms, fn) => timers.push(setTimeout(fn, ms));
  const aat = (ms, fn) => autoTimers.push(setTimeout(fn, ms));
  const setSub = (k) => () => { S.sub = k; render(); };

  function enter(n) {
    clear(); clearAuto();
    Object.assign(S, { step: n, sub: 0, prog: false, picker: false, tip: -1, ended: false, tpl: 'Standard' });
    if (n === 3) S.secs = 47;
    if (n === 4) S.secs = 724;
    render();
    if (n === 2) at(RM ? 0 : 500, setSub(1));
    if (n === 3) [1, 2, 3, 4, 5].forEach((k, i) => at(RM ? 0 : 300 + i * 750, setSub(RM ? 5 : k)));
    if (n === 5) { at(60, () => { S.prog = true; render(); }); at(1400, setSub(1)); at(2100, setSub(2)); }
    if (n === 6) { at(1400, () => { S.tip = 0; render(); }); at(3400, () => { if (S.tip === 0) { S.tip = -1; render(); } }); }
    if (!autoOn) return;
    const d = 4000, dur = { 1: d * .9, 2: d, 3: d * 1.2, 4: d * .95, 5: d * 1.15, 6: d * 1.05 };
    if (n < 7) aat(dur[n], () => enter(n + 1));
    else {
      aat(1200, () => { S.picker = true; render(); });
      aat(2400, () => { S.picker = false; S.tpl = 'Action items'; render(); });
      aat(d * 1.4, () => { autoOn = false; S.auto = false; S.ended = true; render(); });
    }
  }
  const startAuto = () => { autoOn = true; S.auto = true; const from = S.ended ? 1 : S.step; S.ended = false; enter(from); };
  const stopAuto = () => { if (!autoOn) return false; autoOn = false; clearAuto(); S.auto = false; S.taken = true; render(); return true; };

  // Any click (or key) in the demo takes over from autoplay.
  demo.addEventListener('click', (e) => {
    const was = stopAuto();
    const el = e.target.closest('[data-act],[data-go]');
    if (!el) return;
    if (el.dataset.go) return enter(+el.dataset.go);
    const act = el.dataset.act;
    if (common(act, el, S, demo)) return;
    if (act === 'play') { if (!was) startAuto(); }
    else if (act === 'prev') { if (S.ended) { S.ended = false; render(); } else if (S.step > 1) enter(S.step - 1); }
    else if (act === 'next') { if (S.step < 7) enter(S.step + 1); else { S.ended = true; render(); } }
    else if (act === 'row1') enter(2);
    else if (act === 'open') { if (S.step === 5) enter(6); }
    else if (act === 'back') enter(5);
    else if (act === 'tab-sum') enter(7);
    else if (act === 'tab-tr') enter(6);
    else if (act === 'rec') enter(3);
    else if (act === 'notthis') { S.sub = 0; render(); at(1400, () => { if (S.step === 2) { S.sub = 1; render(); } }); }
    else if (act === 'glyph') { if (S.step === 3) enter(4); else if (S.step === 4) enter(3); }
    else if (act === 'stop') enter(5);
    else if (act === 'notif') { if (S.step === 5) enter(6); }
    else if (act === 'replay') { S.taken = false; S.checks = [true, false, false]; if (RM) enter(1); else { autoOn = true; S.auto = true; enter(1); } }
  });
  demo.addEventListener('focusin', (e) => { if (e.target.closest('.mac')) stopAuto(); });
  demo.addEventListener('keydown', () => stopAuto());
  kbd(demo);
  const tip = (e) => { const t = e.target.closest('[data-tip]'); if (t) { S.tip = e.type === 'mouseover' ? +t.dataset.tip : -1; render(); } };
  demo.addEventListener('mouseover', tip); demo.addEventListener('mouseout', tip);
  setInterval(() => { if ((S.step === 3 || S.step === 4) && !S.ended) { S.secs++; render(); } }, 1000);

  // scale the 1216px bezel down when the window is narrower
  const w = $('.demo-w', demo), fit = () => demo.style.setProperty('--k', Math.min(1, w.clientWidth / 1216).toFixed(4));
  if ('ResizeObserver' in window) new ResizeObserver(fit).observe(w); else addEventListener('resize', fit);
  fit();
  render();
  if (!RM && 'IntersectionObserver' in window) {
    new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting && !S.taken && !autoOn && !S.ended) startAuto(); }), { threshold: 0.4 }).observe(demo);
  }
}

/* phone cards */
const CARDS = [
  { st: { step: 1, sub: 0 }, cls: 'nb0 nw', x: 0, y: 0, s: 0.3868 },
  { st: { step: 2, sub: 1 }, cls: 'pc2', x: 780, y: 0, s: 0.7762 },
  { st: { step: 3, sub: 5 }, cls: 'pc3', x: 900, y: 0, s: 1.0867 },
  { st: { step: 4, sub: 5 }, cls: 'pc4', x: 548, y: 0, s: 0.5 },
  { st: { step: 5, sub: 2, prog: true }, cls: 'nb0 nw pc5', x: 0, y: 0, s: 0.3868 },
  { st: { step: 6, sub: 5, tip: 0 }, cls: 'nb0 nw', x: 0, y: 0, s: 0.3868 },
  { st: { step: 7, sub: 5, picker: true }, cls: 'nb0 nw n7', x: 0, y: 0, s: 0.525 }
];
function initPhone() {
  const box = $('#pcards'), dots = $('#dots');
  const cards = [];
  CARDS.forEach((c, i) => {
    const s = Object.assign({ step: 1, sub: 0, prog: false, tpl: 'Standard', picker: false, tip: -1, secs: c.st.step === 4 ? 724 : 47, checks: [true, false, false] }, c.st);
    const el = document.createElement('div'); el.className = 'pcard' + (i === 6 ? '' : ' click');
    el.innerHTML = `<div class="pv ${c.cls}" style="--x:${c.x}px;--y:${c.y}px;--s:${c.s}"></div><div class="pnum"><b>${String(i + 1).padStart(2, '0')}</b><span>${CAPS[i]}</span></div>`;
    const mac = mk(); $('.pv', el).appendChild(mac);
    paint(mac, s);
    // Cards are pictures; only card 7 works (template picker, ticking, editing).
    if (i === 6) {
      $$('[data-act]', mac).forEach((e) => { if (!/^(picker|pick|chk)$/.test(e.dataset.act)) { e.tabIndex = -1; e.removeAttribute('data-act'); } });
      mac.addEventListener('click', (e) => { const a = e.target.closest('[data-act]'); if (a) common(a.dataset.act, a, s, mac); });
      mac.setAttribute('aria-label', 'Template picker, editable summary and action items'); mac.setAttribute('role', 'group');
    } else { mac.inert = true; mac.setAttribute('aria-hidden', 'true'); }
    box.appendChild(el); cards.push(el);
  });
  const end = document.createElement('div'); end.className = 'pcard';
  end.innerHTML = '<div class="pend"><div class="endlogo"></div><div class="endt">That’s Seduta.</div><div class="wl-slot" data-v="end"></div><button class="replay" type="button">↺ Replay</button></div><div class="pnum"><span style="color:var(--ink2)">That’s the whole flow. Nothing was recorded.</span></div>';
  const lg = $('.brand .logo').cloneNode(true); lg.setAttribute('width', 44); lg.setAttribute('height', 44); $('.endlogo', end).replaceWith(lg);
  box.appendChild(end); cards.push(end);

  dots.innerHTML = cards.map((_, i) => `<button type="button" aria-label="Go to card ${i + 1}"></button>`).join('');
  const db = $$('button', dots);
  let cur = 0;
  const go = (i) => { i = Math.max(0, Math.min(cards.length - 1, i)); const c = cards[i]; box.scrollTo({ left: c.offsetLeft - (box.clientWidth - c.offsetWidth) / 2, behavior: RM ? 'auto' : 'smooth' }); };
  const mark = () => {
    const mid = box.scrollLeft + box.clientWidth / 2; let best = 0, bd = 1e9;
    cards.forEach((c, i) => { const d = Math.abs(c.offsetLeft + c.offsetWidth / 2 - mid); if (d < bd) { bd = d; best = i; } });
    cur = best; db.forEach((b, i) => { b.classList.toggle('on', i === cur); if (i === cur) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current'); });
  };
  box.addEventListener('scroll', mark, { passive: true });
  db.forEach((b, i) => b.addEventListener('click', () => go(i)));
  $('#pc-prev').addEventListener('click', () => go(cur - 1));
  $('#pc-next').addEventListener('click', () => go(cur + 1));
  $('.replay', end).addEventListener('click', () => go(0));
  cards.forEach((c, i) => { if (i < 6) c.addEventListener('click', () => go(i + 1)); });
  box.addEventListener('keydown', (e) => { if (e.target !== box) return; if (e.key === 'ArrowRight') { e.preventDefault(); go(cur + 1); } else if (e.key === 'ArrowLeft') { e.preventDefault(); go(cur - 1); } });
  mark();
}

initPhone();
initSlots();
initPricing();
initTerm();
initDemo();
})();
