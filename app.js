const $ = id => document.getElementById(id);
const post = (u, b) => fetch(u, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(b)}).then(r => r.json());
const LANGS = {en:{name:"English",voice:"en-US"},hi:{name:"Hindi",voice:"hi-IN"},mr:{name:"Marathi",voice:"mr-IN"},or:{name:"Odia",voice:"or-IN"}};
let direction = "en-hi", speakLang = "hi-IN", sourceLang = "en-US", target = "", last = {};
function updateDirection() {
  const from = $("fromLang").value, to = $("toLang").value;
  if (from === to) { $("toLang").value = from === "en" ? "hi" : "en"; }
  direction = $("fromLang").value + "-" + $("toLang").value;
  sourceLang = LANGS[$("fromLang").value].voice; speakLang = LANGS[$("toLang").value].voice;
  $("src").placeholder = "Type or speak in " + LANGS[$("fromLang").value].name + "…";
}
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

// ---------- tabs & chips ----------
document.querySelectorAll("#tabs button").forEach(b => b.onclick = () => {
  document.querySelectorAll("#tabs button,.tab").forEach(x => x.classList.remove("on"));
  b.classList.add("on"); $(b.dataset.t).classList.add("on");
  if (b.dataset.t === "progress") loadStats();
  if (b.dataset.t === "vocabulary") loadVocabulary();
  if (b.dataset.t === "coach" && !$("chat").children.length) coachTurn("");
});
function chips(id, key, cb) { $(id).onclick = e => { const b = e.target.closest("b"); if (!b) return;
  $(id).querySelectorAll("b").forEach(x => x.classList.remove("on")); b.classList.add("on"); cb(b.dataset[key]); }; }

// ---------- speech helpers ----------
function speak(text, lang, rate) {
  if (!("speechSynthesis" in window)) return;
  speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text);
  u.lang = lang; u.rate = rate || parseFloat($("rate").value); speechSynthesis.speak(u);
}
function listen(lang, onText, onEnd) {
  if (!SR) return alert("Speech recognition needs Google Chrome or Edge.");
  const r = new SR(); r.lang = lang; r.onresult = e => onText(e.results[0][0].transcript);
  r.onerror = () => alert("Could not hear you. Check microphone permission."); r.onend = onEnd; r.start();
}
let stream, ac, raf;
async function viz(on) {
  const c = $("viz"), x = c.getContext("2d");
  if (!on) { cancelAnimationFrame(raf); stream && stream.getTracks().forEach(t => t.stop()); x.clearRect(0, 0, c.width, c.height); return; }
  try {
    stream = await navigator.mediaDevices.getUserMedia({audio: true});
    ac = new AudioContext(); const an = ac.createAnalyser(); an.fftSize = 128; ac.createMediaStreamSource(stream).connect(an);
    const d = new Uint8Array(an.frequencyBinCount); c.width = c.clientWidth;
    (function draw() { raf = requestAnimationFrame(draw); an.getByteFrequencyData(d); x.clearRect(0, 0, c.width, c.height);
      const w = c.width / d.length; d.forEach((v, i) => { x.fillStyle = `hsl(${170 - v / 3},85%,60%)`; const h = v / 255 * 56; x.fillRect(i * w, 30 - h / 2, w - 2, Math.max(h, 3)); }); })();
  } catch (e) {}
}
// generic "speak and score" used by Studio, Challenges
function practice(t, lang, done) {
  listen(lang, async spoken => done(await post("/api/score", {target: t, spoken, lang}), spoken), () => { viz(false); $("mic").classList.remove("rec"); });
}

// ---------- studio ----------
$("fromLang").onchange = updateDirection;
$("toLang").onchange = updateDirection;
$("swap").onclick = () => { const a = $("fromLang").value; $("fromLang").value = $("toLang").value; $("toLang").value = a; updateDirection(); };
$("listenSrc").onclick = () => $("src").value && speak($("src").value, sourceLang);
$("listen").onclick = () => { speak(target, speakLang); playMouth(); };
let seq = 0, liveTimer = null, liveWanted = false, lrec = null;
async function doTranslate(save) {
  const text = $("src").value.trim(); if (!text) return;
  const my = ++seq; $("live").classList.add("busy"); if (save) $("go").textContent = "Translating…";
  let d; try { d = await post("/api/translate", {text, direction, save}); } catch (e) { return; }
  if (my !== seq) return;                      // a newer request exists, drop this stale answer
  $("live").classList.remove("busy"); $("go").textContent = "Translate →";
  if (d.error) { if (save) alert(d.error); else { $("result").classList.remove("hidden"); $("mode").textContent = d.error; } return; }
  $("mode").textContent = "engine: " + d.mode + (save ? "" : " · live");
  target = d.translation; speakLang = d.speak_lang; $("out").textContent = target;
  $("roman").textContent = d.roman ? "Say it like: " + d.roman : "";
  $("result").classList.remove("hidden"); $("score").classList.add("hidden"); $("coachbox").classList.add("hidden");
  speakLang = d.speak_lang || LANGS[$("toLang").value].voice; sourceLang = d.source_lang || LANGS[$("fromLang").value].voice; setupMouth(d, text);
  if (save) { updateDirection(); loadHistory(); loadStats(); }
  return d;
}
$("go").onclick = () => doTranslate(true);
$("src").oninput = () => { if (!$("liveToggle").checked) return; clearTimeout(liveTimer); liveTimer = setTimeout(() => doTranslate(false), 450); };
$("src").onkeydown = e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); clearTimeout(liveTimer); doTranslate(true); } };
$("swap").addEventListener("click", () => { if (target) $("src").value = target; if ($("src").value.trim()) doTranslate(false); });

// live voice: continuous speech recognition with interim results -> instant translation
function stopLive() { liveWanted = false; lrec && lrec.stop(); }
$("liveVoice").onclick = () => {
  if (!SR) return alert("Live voice needs Google Chrome or Edge.");
  if (liveWanted) return stopLive();
  liveWanted = true; $("liveVoice").classList.add("rec"); $("liveVoice").lastChild.textContent = " Stop live voice";
  let finalText = ""; $("src").value = "";
  const start = () => {
    lrec = new SR(); lrec.lang = sourceLang; lrec.continuous = true; lrec.interimResults = true;
    lrec.onresult = e => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) { const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += t + " "; else interim += t; }
      $("src").value = (finalText + interim).trim();
      clearTimeout(liveTimer);
      liveTimer = setTimeout(async () => { const d = await doTranslate(false);
        if (d && !interim && $("autoSpeak").checked) speak(d.translation, d.speak_lang, 1); }, 250);
    };
    lrec.onerror = ev => { if (ev.error === "not-allowed") { alert("Allow microphone access."); liveWanted = false; } };
    lrec.onend = () => { if (liveWanted) return start();   // Chrome stops after silence, so restart
      $("liveVoice").classList.remove("rec"); $("liveVoice").lastChild.textContent = " Live voice"; lrec = null;
      if ($("src").value.trim()) doTranslate(true); };
    lrec.start();
  };
  start();
};
$("mic").onclick = () => { $("mic").classList.add("rec"); viz(true);
  practice(target, speakLang, (d, spoken) => { showScore(d, spoken); loadStats(); });
};
function showScore(d, spoken) {
  last = {target, spoken, score: d.score, words: d.words};
  $("score").classList.remove("hidden"); $("tip").textContent = d.tip; $("heard").textContent = spoken || "—"; $("num").textContent = d.score;
  $("arc").style.strokeDashoffset = 327 - 327 * d.score / 100;
  $("arc").style.stroke = d.score >= 85 ? "#3ddbc0" : d.score >= 60 ? "#ff9f45" : "#ff5d73";
  $("words").innerHTML = d.words.map(w => `<span class="w ${w.status}" title="heard: ${w.heard || "nothing"}">${w.word}</span>`).join("");
  if (d.score >= 85) boom();
}
$("askAI").onclick = async () => { $("coachbox").classList.remove("hidden"); $("coachbox").textContent = "AI coach is thinking…";
  const d = await post("/api/tutor", last); $("coachbox").textContent = (d.mode === "llm" ? "🤖 " : "📘 ") + d.feedback; };
$("insightBtn").onclick = async () => {
  const box = $("insightBox"); box.classList.remove("hidden"); box.textContent = "✨ Analysing meaning, tone and cultural context…";
  try { const d = await post("/api/insight", {source: $("src").value.trim(), translation: target, from: $("fromLang").value, to: $("toLang").value});
    box.textContent = (d.mode === "llm" ? "🤖 Generative AI insight\n\n" : "📘 Smart language notes (add ANTHROPIC_API_KEY for live GenAI)\n\n") + d.insight;
  } catch (e) { box.textContent = "Could not generate an insight. Check your connection and try again."; }
};

// ---------- history / stats / profile ----------
async function loadHistory() {
  const list = $("hist");
  if (!list) return;
  list.innerHTML = "<li>Loading recent phrases…</li>";
  try {
    const response = await fetch("/api/history", {cache: "no-store"});
    if (!response.ok) throw new Error("History request failed");
    const rows = await response.json();
    list.innerHTML = rows.map(r => `<li data-s="${encodeURIComponent(r.source_text)}" data-direction="${r.direction || "en-hi"}" tabindex="0" role="button" title="Click to reuse this phrase">${escapeHistory(r.source_text)}<small>${escapeHistory(r.translated_text)}</small></li>`).join("") || "<li>No phrases yet. Translate a phrase to save it here.</li>";
  } catch (err) {
    list.innerHTML = "<li>Recent phrases couldn't load. Refresh the page and try again.</li>";
    console.error("Recent phrases error:", err);
  }
}
function escapeHistory(value) {
  const el = document.createElement("span");
  el.textContent = value == null ? "" : String(value);
  return el.innerHTML;
}
async function reuseHistoryPhrase(li) {
  if (!li || !li.dataset.s) return;
  const values = decodeURIComponent(li.dataset.s);
  const parts = (li.dataset.direction || "en-hi").split("-");
  if ($("fromLang") && LANGS[parts[0]]) $("fromLang").value = parts[0];
  if ($("toLang") && LANGS[parts[1]]) $("toLang").value = parts[1];
  updateDirection();
  $("src").value = values;
  document.querySelector('[data-t="studio"]')?.click();
  await doTranslate(true);
}
$("hist").onclick = e => reuseHistoryPhrase(e.target.closest("li[data-s]"));
$("hist").onkeydown = e => {
  if ((e.key === "Enter" || e.key === " ") && e.target.matches("li[data-s]")) {
    e.preventDefault(); reuseHistoryPhrase(e.target);
  }
};
$("clear").onclick = async () => {
  try { await fetch("/api/history", {method: "DELETE"}); await loadHistory(); await loadStats(); }
  catch (err) { console.error("Could not clear recent phrases:", err); }
};
async function loadStats() {
  const [s, p] = await Promise.all([fetch("/api/stats").then(r => r.json()), fetch("/api/profile").then(r => r.json())]);
  $("sT").textContent = s.translations; $("sA").textContent = s.attempts; $("sAvg").textContent = s.average; $("sBest").textContent = s.best;
  $("hxp").textContent = p.xp; $("hstreak").textContent = p.streak; $("plvl").textContent = p.level; $("pbar").style.width = p.into + "%";
  $("aipill").textContent = p.llm ? "● AI: Claude LLM" : "● AI: offline mode"; 
  $("badges").innerHTML = p.badges.map(b => `<div class="bd ${b.earned ? "on" : ""}"><b>${b.icon}</b>${b.name}<br><span>${b.desc}</span></div>`).join("");
  $("dEn").textContent = p.daily.en; $("dHi").textContent = p.daily.hi; window.daily = p.daily;
  const c = $("trend"), x = c.getContext("2d"); c.width = c.clientWidth || 600; x.clearRect(0, 0, c.width, c.height);
  const bw = c.width / Math.max(s.trend.length, 1);
  s.trend.forEach((v, i) => { const h = v / 100 * 95; x.fillStyle = v >= 85 ? "#3ddbc0" : v >= 60 ? "#ff9f45" : "#ff5d73"; x.fillRect(i * bw + 6, 104 - h, bw - 12, h); });
}
$("dTry").onclick = () => { document.querySelector('[data-t=studio]').click(); $("src").value = window.daily.en; $("go").click(); };

// ---------- AI coach ----------
let scene = "cafe", clang = "hi", chatHist = [], cLangCode = "hi-IN";
chips("scenes", "s", v => { scene = v; resetChat(); }); chips("clang", "l", v => { clang = v; resetChat(); });
function resetChat() { chatHist = []; $("chat").innerHTML = ""; coachTurn(""); }
function bubble(cls, text, sub) { const d = document.createElement("div"); d.className = "bub " + cls; d.textContent = text;
  if (sub) { const s = document.createElement("small"); s.textContent = sub; d.appendChild(s); } $("chat").appendChild(d); $("chat").scrollTop = 1e6; }
let coachBusy = false;
async function coachTurn(message) {
  if (coachBusy) return;
  coachBusy = true;
  const sendButton = $("send");
  sendButton.disabled = true;
  sendButton.textContent = "Thinking…";
  try {
    const d = await post("/api/coach", {scenario: scene, lang: clang, history: chatHist, message});
    if (!d || !d.reply) throw new Error(d && d.error ? d.error : "The coach returned an empty response.");
    if (message) chatHist.push({role: "user", content: message});
    chatHist.push({role: "assistant", content: d.reply});
    bubble("ai", d.reply, [d.roman, d.tip && "💡 " + d.tip].filter(Boolean).join("\n"));
    cLangCode = d.speak_lang || (clang === "hi" ? "hi-IN" : "en-US");
    speak(d.reply, cLangCode, 0.9);
  } catch (err) {
    bubble("ai", "I couldn't reach the AI coach just now. Please check your connection/API settings and try again.", err.message || "Request failed");
  } finally {
    coachBusy = false;
    sendButton.disabled = false;
    sendButton.textContent = "Send";
    $("msg").focus();
  }
}
function sendCoachMessage() {
  if (coachBusy) return;
  const field = $("msg");
  const message = field.value.trim();
  if (!message) { field.focus(); return; }
  field.value = "";
  bubble("me", message);
  coachTurn(message);
}
$("send").addEventListener("click", sendCoachMessage);
$("msg").addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendCoachMessage(); }
});
$("cmic").onclick = () => { $("cmic").classList.add("rec"); listen(cLangCode, t => { $("msg").value = t; sendCoachMessage(); }, () => $("cmic").classList.remove("rec")); };

// ---------- challenges ----------
let lvl = "easy", clg = "en";
chips("lvl", "v", v => lvl = v); chips("clg", "l", v => clg = v);
$("gen").onclick = async () => {
  $("chlist").innerHTML = "<p class='heard' style='margin-top:14px'>Generating…</p>";
  const d = await post("/api/challenge", {lang: clg, level: lvl, topic: $("topic").value});
  $("chlist").innerHTML = ""; d.items.forEach(t => { const el = document.createElement("div"); el.className = "ch";
    el.innerHTML = `<span>${t}</span><span><button class="btn ghost">🔊</button> <button class="btn mic"><span class="dot"></span></button> <b class="sc"></b></span>`;
    const [b1, b2] = el.querySelectorAll("button");
    b1.onclick = () => speak(t, d.speak_lang, 0.8);
    b2.onclick = () => { b2.classList.add("rec"); listen(d.speak_lang, async sp => { const r = await post("/api/score", {target: t, spoken: sp, lang: d.speak_lang});
      el.querySelector(".sc").textContent = r.score; el.querySelector(".sc").style.color = r.score >= 85 ? "#3ddbc0" : r.score >= 60 ? "#ff9f45" : "#ff5d73";
      if (r.score >= 85) boom(); loadStats(); }, () => b2.classList.remove("rec")); };
    $("chlist").appendChild(el); });
};

// ---------- confetti ----------
function boom() { const c = $("confetti"), x = c.getContext("2d"); c.width = innerWidth; c.height = innerHeight;
  const P = Array.from({length: 90}, () => ({x: innerWidth / 2, y: innerHeight / 3, vx: (Math.random() - .5) * 14, vy: Math.random() * -12, s: 4 + Math.random() * 6, h: Math.random() * 360}));
  let f = 0; (function a() { x.clearRect(0, 0, c.width, c.height); P.forEach(p => { p.x += p.vx; p.y += p.vy; p.vy += .35; x.fillStyle = `hsl(${p.h},90%,60%)`; x.fillRect(p.x, p.y, p.s, p.s); });
    if (++f < 110) requestAnimationFrame(a); else x.clearRect(0, 0, c.width, c.height); })(); }
loadHistory(); loadStats();

// ---------- mouth coach (interactive pronunciation visuals) ----------
const SHAPES = {A:[34,26,0,0], E:[42,12,0,0], I:[40,7,0,0], O:[19,22,0,0], U:[12,12,0,0], M:[28,2,0,0], F:[32,9,0,1], T:[30,13,1,0], S:[34,7,0,1], R:[14,3,0,0]};
const TIPS = {A:"Open wide, jaw drops (aa)", E:"Smile and open a little (e / ai)", I:"Lips spread thin, tongue high (ee)", O:"Round the lips, medium opening (o)", U:"Tiny round lips pushed forward (oo)", M:"Lips pressed together (m, b, p)", F:"Top teeth touch lower lip (f, v)", T:"Tongue tip taps behind the teeth (t, d, n, l)", S:"Teeth close, air hisses through (s, sh, ch)"};
function mouthHTML(id) { return document.getElementById(id); }
function setMouth(v, svgId) {
  const svg = document.getElementById(svgId || "mouthsvg"), [rx, ry, tg, th] = SHAPES[v] || SHAPES.M;
  const mo = svg.querySelector(".mo"), mt = svg.querySelector(".mt"), mu = svg.querySelector(".mu");
  mo.style.rx = rx; mo.style.ry = ry; mt.style.rx = rx * .7; mt.style.ry = tg ? ry * .6 : 0;
  mu.style.height = th ? Math.min(ry + 4, 10) : 0; mu.setAttribute("width", rx * 1.4); mu.setAttribute("x", 100 - rx * .7);
}
function buildFace(id) { document.getElementById(id).innerHTML = `<circle cx="100" cy="85" r="78" fill="#ffe3cf" stroke="#f3b99a" stroke-width="3"/><circle cx="68" cy="58" r="6" fill="#2b2340"/><circle cx="132" cy="58" r="6" fill="#2b2340"/><ellipse cx="55" cy="90" rx="13" ry="8" fill="#ffb4a2" opacity=".6"/><ellipse cx="145" cy="90" rx="13" ry="8" fill="#ffb4a2" opacity=".6"/><ellipse class="mo" cx="100" cy="115" rx="14" ry="3" fill="#7a2338"/><ellipse class="mt" cx="100" cy="122" rx="12" ry="0" fill="#ff7b9c"/><rect class="mu" x="80" y="108" width="40" height="0" rx="3" fill="#fff"/>`; }
document.getElementById("mouthsvg").innerHTML = ""; buildFace("mouthsvg"); buildFace("mouthsvg2");
function visemes(text) {
  const out = []; const t = text.toLowerCase().replace(/[^a-z ]/g, "");
  for (let i = 0; i < t.length; i++) { const c = t[i], two = t.substr(i, 2);
    let v = null, label = c;
    if (two === "sh" || two === "ch") { v = "S"; label = two; i++; }
    else if (two === "th") { v = "T"; label = two; i++; }
    else if (two === "oo" || two === "uu") { v = "U"; label = two; i++; }
    else if (two === "ee" || two === "ii") { v = "I"; label = two; i++; }
    else if (two === "aa") { v = "A"; label = two; i++; }
    else if ("a".includes(c)) v = "A"; else if ("e".includes(c)) v = "E"; else if ("i".includes(c)) v = "I";
    else if ("o".includes(c)) v = "O"; else if ("u".includes(c)) v = "U";
    else if ("mbp".includes(c)) v = "M"; else if ("fv".includes(c)) v = "F"; else if ("tdnlr".includes(c)) v = "T";
    else if ("szjcxkgqh".includes(c)) v = "S"; else if ("wy".includes(c)) v = c === "w" ? "U" : "I";
    if (v) out.push([v, label]);
  }
  return out;
}
let mouthText = "", mouthTimer = null;
function playMouth() {
  clearInterval(mouthTimer); const seq = visemes(mouthText); let i = 0; if (!seq.length) return;
  mouthTimer = setInterval(() => { if (i >= seq.length) { clearInterval(mouthTimer); setMouth("M"); $("mchar").textContent = "–"; return; }
    const [v, l] = seq[i++]; setMouth(v); $("mchar").textContent = l; $("mtip").textContent = TIPS[v]; }, 230);
}
$("mplay").onclick = () => { speak(target, speakLang, 0.7); playMouth(); };
const EMO = {water:"💧",sun:"☀️",moon:"🌙",tree:"🌳",flower:"🌸",food:"🍛",tea:"🍵",milk:"🥛",rain:"🌧️",book:"📖",home:"🏠",house:"🏠",school:"🏫",love:"❤️",friend:"🤝",mother:"👩",father:"👨",dog:"🐶",cat:"🐱",bird:"🐦",cow:"🐄",train:"🚆",bus:"🚌",car:"🚗",phone:"📱",money:"💰",time:"⏰",night:"🌃",morning:"🌅",india:"🇮🇳",hello:"👋",thank:"🙏",happy:"😊",eat:"🍽️",fire:"🔥",star:"⭐",mango:"🥭",apple:"🍎",fish:"🐟",elephant:"🐘"};
const EMO_HI = {"पानी":"💧","सूरज":"☀️","चाँद":"🌙","पेड़":"🌳","फूल":"🌸","खाना":"🍛","चाय":"🍵","दूध":"🥛","बारिश":"🌧️","किताब":"📖","घर":"🏠","प्यार":"❤️","दोस्त":"🤝","माँ":"👩","कुत्ता":"🐶","बिल्ली":"🐱","पक्षी":"🐦","गाय":"🐄","रेल":"🚆","पैसा":"💰","नमस्ते":"👋","धन्यवाद":"🙏","आम":"🥭","मछली":"🐟","हाथी":"🐘"};
function setupMouth(d, srcText) {
  mouthText = d.roman || (direction === "en-hi" ? srcText : d.translation); setMouth("M"); $("mchar").textContent = "–";
  $("mtip").textContent = "Press play to watch how your lips move.";
  const words = (srcText + " " + d.translation).toLowerCase().replace(/[.,!?]/g, "").split(/\s+/);
  const e = [...new Set(words.map(w => EMO[w] || EMO_HI[w]).filter(Boolean))].join("  ");
  $("emo").textContent = e;
}
// ---------- sound lab ----------
const LAB = {hi: [["अ","a","A","अनार","🍎","Short, relaxed open mouth"],["आ","aa","A","आम","🥭","Open wide and hold it long"],["इ","i","I","इमली","🌿","Lips spread, tongue high"],["ई","ee","I","ईख","🎋","Same as इ but longer"],["उ","u","U","उल्लू","🦉","Lips rounded and pushed forward"],["ऊ","oo","U","ऊँट","🐪","Like उ, hold it longer"],["ए","e","E","एक","1️⃣","Smile slightly, mid-open mouth"],["ऐ","ai","E","ऐनक","👓","Open mouth wider than ए"],["ओ","o","O","ओस","💧","Round lips, medium opening"],["औ","au","O","औज़ार","🔧","Start open, finish rounded"],
  ["क","k","S","कमल","🪷","Back of tongue touches the soft palate"],["ख","kh","S","खरगोश","🐰","Like क with a puff of air"],["ग","g","S","गाय","🐄","Like क but voiced"],["च","ch","S","चाँद","🌙","Tongue flat against the palate"],["ज","j","S","जहाज़","🚢","Voiced version of च"],["ट","ṭ","T","टमाटर","🍅","Curl tongue tip back to the roof of mouth"],["त","t","T","तारा","⭐","Tongue tip touches the back of the upper teeth"],["द","d","T","दिया","🪔","Voiced version of त"],["न","n","T","नाव","⛵","Tongue tip on the teeth ridge, air through nose"],["प","p","M","पतंग","🪁","Lips pressed, then pop open"],["ब","b","M","बत्तख","🦆","Voiced version of प"],["म","m","M","मछली","🐟","Lips closed, hum through the nose"],["र","r","T","रेल","🚆","Quick tap of the tongue tip"],["ल","l","T","लड्डू","🍡","Tongue tip on the ridge, air flows by the sides"],["व","v","F","वायुयान","✈️","Soft contact between teeth and lip"],["श","sh","S","शेर","🦁","Rounded lips, hushing sound"],["स","s","S","सेब","🍎","Teeth close, sharp hiss"],["ह","h","A","हाथी","🐘","Open throat, gentle breath"]],
  en: [["th","think","T","think","🧠","Tongue tip gently between the teeth, blow air"],["th (voiced)","this","T","this","👉","Same position, add voice"],["v","very","F","very","✅","Top teeth on lower lip, add voice"],["w","water","U","water","💧","Round lips like oo, then open"],["r","red","R","red","🔴","Tongue curls back, never touches the roof"],["æ","cat","A","cat","🐱","Open the jaw wide, spread lips"],["sh","ship","S","ship","🚢","Round lips, tongue pulled back"],["l","light","T","light","💡","Tongue tip taps the ridge behind teeth"],["ee vs i","sheep ship","I","sheep","🐑","ee is long and tense, i is short and relaxed"]]};
let labSet = "hi";
function renderTiles() {
  $("tiles").innerHTML = LAB[labSet].map((t, i) => `<button class="tile" data-i="${i}"><span class="e">${t[4]}</span><b>${t[0]}</b><small>${t[1]}</small><em>${t[3]}</em></button>`).join("");
}
chips("labset", "k", v => { labSet = v; renderTiles(); });
$("tiles").onclick = e => { const b = e.target.closest(".tile"); if (!b) return; const t = LAB[labSet][b.dataset.i], lang = labSet === "hi" ? "hi-IN" : "en-US";
  setMouth(t[2], "mouthsvg2"); $("lchar").textContent = t[0] + "  ·  " + t[1]; $("ltip").textContent = t[5];
  speak(labSet === "hi" ? t[0] + ", " + t[3] : t[3], lang, 0.7); };
renderTiles();


// Vocabulary notebook: persistent saved phrases, search, reuse and delete.
let vocabularyCache = [];
async function loadVocabulary() {
  const box = $("vocabList"); if (!box) return;
  box.innerHTML = '<p class="heard">Loading notebook…</p>';
  try { const r = await fetch('/api/vocabulary', {cache:'no-store'}); if (!r.ok) throw Error(); vocabularyCache = await r.json(); renderVocabulary(); }
  catch { box.innerHTML = '<p class="heard">Could not load the notebook. Check the Flask server and refresh.</p>'; }
}
function renderVocabulary() {
  const box = $("vocabList"); if (!box) return;
  const q = ($("vSearch")?.value || '').trim().toLowerCase();
  const rows = vocabularyCache.filter(v => (v.source_text+' '+v.translated_text).toLowerCase().includes(q));
  $("vCount").textContent = vocabularyCache.length;
  if (!rows.length) { box.innerHTML = `<div class="empty-vocab"><b>${q ? 'No matching phrases' : 'Your notebook is ready'}</b><p>${q ? 'Try another search.' : 'Translate a phrase and press “Save to notebook”.'}</p></div>`; return; }
  box.innerHTML = rows.map(v => `<article class="vocab-item"><div><span class="eyebrow">${escapeHistory(v.direction.toUpperCase())}</span><h3>${escapeHistory(v.source_text)}</h3><p>${escapeHistory(v.translated_text)}</p></div><div class="vocab-actions"><button class="btn ghost" data-vlisten="${v.id}">🔊</button><button class="btn ghost" data-vreuse="${v.id}">Practise</button><button class="btn danger" data-vdelete="${v.id}">Delete</button></div></article>`).join('');
}
$("vSearch")?.addEventListener('input', renderVocabulary);
$("vocabList")?.addEventListener('click', async e => {
 const b=e.target.closest('[data-vlisten],[data-vreuse],[data-vdelete]'); if(!b)return;
 const id=Number(b.dataset.vlisten||b.dataset.vreuse||b.dataset.vdelete), v=vocabularyCache.find(x=>x.id===id); if(!v)return;
 if(b.dataset.vdelete){if(!confirm('Delete this saved phrase?'))return; await fetch('/api/vocabulary/'+id,{method:'DELETE'}); await loadVocabulary();}
 else if(b.dataset.vreuse){const [a,z]=v.direction.split('-'); $('fromLang').value=a;$('toLang').value=z;updateDirection();$('src').value=v.source_text;document.querySelector('[data-t="studio"]')?.click();await doTranslate(true);}
 else speak(v.translated_text,LANGS[v.direction.split('-')[1]].voice,0.85);
});
$("saveVocab")?.addEventListener('click', async () => {
 if(!target||!$('src').value.trim()){alert('Translate a phrase first.');return;}
 const b=$('saveVocab');b.disabled=true;
 try{const r=await fetch('/api/vocabulary',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({direction,source_text:$('src').value.trim(),translated_text:target})});const d=await r.json();if(!r.ok)throw Error(d.error||'Save failed');b.textContent='✓ Saved';await loadVocabulary();}
 catch(e){alert(e.message||'Could not save phrase.');}finally{setTimeout(()=>{b.textContent='＋ Save to notebook';b.disabled=false;},1000);}
});


// ---------- real-time speech-to-speech conversation translator ----------
(() => {
  const ids = ["convFrom", "convTo", "convStart", "convStop", "convSource", "convTranslation", "convStatus", "convAutoSpeak", "convTurns"];
  if (!ids.every(id => $(id))) return;
  let recognition = null, running = false, finalTranscript = "", turns = [];
  const voiceCodes = {en:"en-US", hi:"hi-IN", mr:"mr-IN", or:"or-IN"};
  const languageNames = {en:"English", hi:"Hindi", mr:"Marathi", or:"Odia"};
  function setStatus(message) { $("convStatus").textContent = message; }
  function syncPair() {
    if ($("convFrom").value === $("convTo").value) $("convTo").value = $("convFrom").value === "en" ? "hi" : "en";
  }
  function setRunning(value) {
    running = value; $("convStart").disabled = value; $("convStop").disabled = !value;
    $("convStart").classList.toggle("rec", value);
  }
  function addTurn(source, translated, from, to) {
    turns.push({source, translated, from, to, time: new Date().toLocaleTimeString()});
    const li = document.createElement("li");
    const strong = document.createElement("strong"); strong.textContent = `${languageNames[from]} → ${languageNames[to]}`;
    const time = document.createElement("small"); time.textContent = ` · ${turns[turns.length-1].time}`;
    const original = document.createElement("div"); original.textContent = source;
    const result = document.createElement("div"); result.textContent = translated;
    li.append(strong, time, original, result); $("convTurns").prepend(li);
  }
  async function translateRecognised(shouldSave = true) {
    const source = $("convSource").textContent.trim();
    if (!source || source === "Your speech will appear here…") { setStatus("Speak first, or type text into the recognised speech box by using Translate text after entering text."); return; }
    const from = $("convFrom").value, to = $("convTo").value;
    if (from === to) { setStatus("Choose two different languages."); return; }
    setStatus("Translating…");
    try {
      const response = await post("/api/translate", {text: source, direction: `${from}-${to}`, save: shouldSave});
      if (!response || response.error) throw new Error(response?.error || "Translation failed.");
      $("convTranslation").textContent = response.translation;
      setStatus(`Translated from ${languageNames[from]} to ${languageNames[to]} using ${response.mode || "translation service"}.`);
      if (shouldSave) addTurn(source, response.translation, from, to);
      if ($("convAutoSpeak").checked && "speechSynthesis" in window) {
        speechSynthesis.cancel(); const utterance = new SpeechSynthesisUtterance(response.translation);
        utterance.lang = response.speak_lang || voiceCodes[to]; utterance.rate = 0.92; speechSynthesis.speak(utterance);
      }
    } catch (error) { setStatus(error.message || "Could not translate. Check your connection and try again."); }
  }
  $("convFrom").onchange = syncPair; $("convTo").onchange = syncPair;
  $("convSwap").onclick = () => { const old = $("convFrom").value; $("convFrom").value = $("convTo").value; $("convTo").value = old; };
  $("convStart").onclick = () => {
    const SRClass = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SRClass) { setStatus("Speech recognition is unavailable. Open this project in Chrome or Edge."); return; }
    if (!navigator.mediaDevices) { setStatus("Microphone access is unavailable in this browser context."); return; }
    try {
      recognition = new SRClass(); recognition.lang = voiceCodes[$("convFrom").value];
      recognition.continuous = true; recognition.interimResults = true; finalTranscript = "";
      $("convSource").textContent = "Listening…"; setRunning(true); setStatus("Listening. Speak clearly; press Stop when you finish.");
      recognition.onresult = event => {
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const phrase = event.results[i][0].transcript;
          if (event.results[i].isFinal) finalTranscript += phrase + " "; else interim += phrase;
        }
        $("convSource").textContent = (finalTranscript + interim).trim() || "Listening…";
      };
      recognition.onerror = event => setStatus(event.error === "not-allowed" ? "Microphone permission denied. Allow microphone access in your browser." : `Speech recognition error: ${event.error}`);
      recognition.onend = () => { if (running) { setRunning(false); setStatus("Listening stopped. Press Translate text to translate the recognised speech."); } };
      recognition.start();
    } catch (error) { setRunning(false); setStatus("Could not start microphone: " + error.message); }
  };
  $("convStop").onclick = () => { running = false; if (recognition) recognition.stop(); setRunning(false); setStatus("Recording stopped. Translating recognised speech…"); translateRecognised(true); };
  $("convTranslate").onclick = () => translateRecognised(true);
  $("convReplay").onclick = () => { const text = $("convTranslation").textContent.trim(); if (!text || text === "Your translation will appear here…") return; if (!("speechSynthesis" in window)) return setStatus("Speech playback is not supported in this browser."); speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.lang = voiceCodes[$("convTo").value]; speechSynthesis.speak(u); };
  $("convClear").onclick = () => { if (running && recognition) recognition.stop(); setRunning(false); $("convSource").textContent = "Your speech will appear here…"; $("convTranslation").textContent = "Your translation will appear here…"; $("convTurns").replaceChildren(); turns = []; setStatus("Conversation cleared."); };
  $("convExport").onclick = () => {
    if (!turns.length) return setStatus("There are no conversation turns to export yet.");
    const csv = ["Time,Source Language,Source Text,Target Language,Translation", ...turns.map(t => [t.time,languageNames[t.from],t.source,languageNames[t.to],t.translated].map(v => '"'+String(v).replace(/"/g,'""')+'"').join(","))].join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], {type:"text/csv;charset=utf-8;"})); const a = document.createElement("a"); a.href = url; a.download = "pronouncegpt_conversation.csv"; a.click(); URL.revokeObjectURL(url);
  };
  // Allow users to type or edit recognised text before translating.
  $("convSource").contentEditable = "true"; $("convSource").setAttribute("role", "textbox"); $("convSource").setAttribute("aria-label", "Recognised or manually entered speech");
})();
