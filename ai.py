"""GenAI layer for PronounceGPT: LLM calls (Anthropic API) with rule-based offline fallback,
plus gamification (XP, streaks, badges)."""
import os, json, random, urllib.request
from datetime import datetime, date, timedelta
from flask import request, jsonify
from translit import deva_to_roman

def _load_env():  # tiny .env reader so VS Code users need no extra package
    p = os.path.join(os.path.dirname(__file__), ".env")
    if os.path.exists(p):
        for line in open(p, encoding="utf-8"):
            if "=" in line and not line.startswith("#"):
                k, v = line.strip().split("=", 1)
                os.environ.setdefault(k, v.strip('"\''))
_load_env()

def ask_llm(system, messages, max_tokens=400):
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        return None
    body = json.dumps({"model": os.environ.get("LLM_MODEL", "claude-sonnet-5-5"),
                       "max_tokens": max_tokens, "system": system, "messages": messages}).encode()
    req = urllib.request.Request("https://api.anthropic.com/v1/messages", body,
          {"content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01"})
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            return json.loads(r.read())["content"][0]["text"].strip()
    except Exception:
        return None

SCENES = {
    "cafe": ("ordering at a cafe", ["नमस्ते! आप क्या लेंगे?", "ज़रूर, और कुछ?", "बिल सौ रुपये का है।"],
             ["Hello! What would you like?", "Sure, anything else?", "That will be 100 rupees."]),
    "airport": ("checking in at an airport", ["आपका पासपोर्ट दिखाइए।", "आप कहाँ जा रहे हैं?", "यह आपका बोर्डिंग पास है।"],
                ["May I see your passport?", "Where are you flying to?", "Here is your boarding pass."]),
    "interview": ("a job interview", ["अपने बारे में बताइए।", "आप यह नौकरी क्यों चाहते हैं?", "धन्यवाद, हम संपर्क करेंगे।"],
                  ["Tell me about yourself.", "Why do you want this job?", "Thank you, we will contact you."]),
    "market": ("bargaining in a market", ["यह कमीज़ सिर्फ़ पाँच सौ की है।", "अच्छा, चार सौ दे दीजिए।", "ठीक है, आपके लिए खास दाम।"],
               ["This shirt is only 500.", "Okay, give me 400.", "Fine, a special price for you."]),
}
TWISTERS = {
    "en": {"easy": ["She sells sea shells", "Red lorry yellow lorry", "Good blood bad blood"],
           "medium": ["Peter Piper picked a peck of pickled peppers", "How can a clam cram in a clean cream can"],
           "hard": ["The sixth sick sheikh's sixth sheep is sick", "Pad kid poured curd pulled cod"]},
    "hi": {"easy": ["कच्चा पापड़ पक्का पापड़", "चंदू के चाचा ने चंदू की चाची को चाँदनी चौक में चाँदी की चम्मच से चटनी चटाई"],
           "medium": ["तेरी बाईं तरफ़ की बगल वाली खिड़की", "सस्ता शरबत सस्ते शरबत की दुकान"],
           "hard": ["भाग भांडा भाड़ में भाग, भाग भांडा भाड़ में"]},
}
DAILY = [("Good morning", "सुप्रभात"), ("Thank you very much", "आपका बहुत धन्यवाद"),
         ("How are you?", "आप कैसे हैं?"), ("I am learning Hindi", "मैं हिन्दी सीख रहा हूँ"),
         ("Where is the station?", "स्टेशन कहाँ है?"), ("Please speak slowly", "कृपया धीरे बोलिए"),
         ("Nice to meet you", "आपसे मिलकर खुशी हुई")]
BADGES = [("first", "🌱", "First Words", "Make 1 attempt"), ("sharp", "🎯", "Sharp Speaker", "Score 85+"),
          ("perfect", "💎", "Perfectionist", "Score 100"), ("fire", "🔥", "On Fire", "3-day streak"),
          ("marathon", "🏃", "Marathoner", "25 attempts"), ("poly", "🌐", "Polyglot", "10 translations")]

def register(app, db):
    @app.post("/api/tutor")
    def tutor():
        d = request.get_json(force=True)
        weak = [w for w in d.get("words", []) if w.get("status") != "good"]
        sys = ("You are PronounceGPT, a warm pronunciation coach for English/Hindi learners. "
               "Give exactly 3 short, concrete tips (mouth position, stress, syllables) and one memory trick. "
               "Under 90 words. Plain text, no markdown.")
        prompt = (f"Target: {d.get('target')}\nLearner said: {d.get('spoken')}\nScore: {d.get('score')}/100\n"
                  f"Weak words: {[(w['word'], w['heard']) for w in weak]}")
        out = ask_llm(sys, [{"role": "user", "content": prompt}])
        if out:
            return jsonify(feedback=out, mode="llm")
        if not weak:
            return jsonify(feedback="Great job! Try it faster, then add emotion like a native speaker.", mode="rules")
        lines = []
        for w in weak[:3]:
            r = deva_to_roman(w["word"]) if any("\u0900" <= c <= "\u097f" for c in w["word"]) else w["word"]
            lines.append(f"• '{w['word']}' ({r}): you said '{w['heard'] or 'nothing'}'. Break it into syllables and say it slowly.")
        lines.append("Trick: record yourself, compare with the Listen button, repeat 3 times.")
        return jsonify(feedback="\n".join(lines), mode="rules")

    @app.post("/api/coach")
    def coach():
        d = request.get_json(force=True)
        scene, lang = d.get("scenario", "cafe"), d.get("lang", "hi")
        hist, msg = d.get("history", []), (d.get("message") or "").strip()
        title, hi, en = SCENES.get(scene, SCENES["cafe"])
        name = {"hi":"Hindi","mr":"Marathi","or":"Odia"}.get(lang, "English")
        sys = (f"Role-play a friendly partner in a scene: {title}. Speak ONLY {name}, 1-2 short sentences. "
               "Then on a new line write 'Tip:' followed by one short English correction or useful phrase "
               "for the learner's last message (or a hint on what to say next).")
        msgs = [{"role": "user", "content": "Start the scene."}] + hist
        if msg:
            msgs.append({"role": "user", "content": msg})
        out = ask_llm(sys, msgs, 300)
        mode = "llm"
        if not out:
            mode = "rules"
            lines = hi if lang == "hi" else en
            out = lines[min(len(hist) // 2, len(lines) - 1)] + "\nTip: Answer in a full sentence and speak slowly."
        reply, _, tip = out.partition("Tip:")
        reply = reply.strip()
        db().execute("INSERT INTO chats(scenario,role,content,created_at) VALUES(?,?,?,?)",
                     (scene, "assistant", reply, datetime.now().isoformat(timespec="seconds")))
        db().commit()
        return jsonify(reply=reply, tip=tip.strip(), mode=mode,
                       roman=deva_to_roman(reply) if lang == "hi" else "", speak_lang="hi-IN" if lang == "hi" else "en-US")

    @app.post("/api/challenge")
    def challenge():
        d = request.get_json(force=True)
        lang, level, topic = d.get("lang", "en"), d.get("level", "easy"), (d.get("topic") or "").strip()
        sys = "Generate 3 pronunciation practice sentences. One per line, no numbering, no extra text."
        prompt = (f"Language: {'Hindi in Devanagari' if lang == 'hi' else 'English'}. Level: {level}. "
                  f"Topic: {topic or 'everyday life'}. Easy=short common words, hard=tongue twisters.")
        out = ask_llm(sys, [{"role": "user", "content": prompt}], 200)
        if out:
            items = [l.strip("-• ").strip() for l in out.splitlines() if l.strip()][:3]
            return jsonify(items=items, mode="llm", speak_lang="hi-IN" if lang == "hi" else "en-US")
        return jsonify(items=TWISTERS[lang][level], mode="rules", speak_lang="hi-IN" if lang == "hi" else "en-US")

    @app.get("/api/profile")
    def profile():
        rows = db().execute("SELECT score, created_at FROM attempts").fetchall()
        n_tr = db().execute("SELECT COUNT(*) FROM translations").fetchone()[0]
        xp = int(sum(r["score"] for r in rows) / 5)
        days = {r["created_at"][:10] for r in rows}
        streak, day = 0, date.today()
        while day.isoformat() in days:
            streak += 1; day -= timedelta(days=1)
        best = max([r["score"] for r in rows], default=0)
        got = {"first": len(rows) >= 1, "sharp": best >= 85, "perfect": best >= 100,
               "fire": streak >= 3, "marathon": len(rows) >= 25, "poly": n_tr >= 10}
        e, h = DAILY[date.today().toordinal() % len(DAILY)]
        return jsonify(xp=xp, level=xp // 100 + 1, into=xp % 100, streak=streak,
                       badges=[{"icon": i, "name": n, "desc": ds, "earned": got[k]} for k, i, n, ds in BADGES],
                       daily={"en": e, "hi": h}, llm=bool(os.environ.get("ANTHROPIC_API_KEY")))

    @app.post("/api/insight")
    def translation_insight():
        d = request.get_json(force=True)
        source = (d.get("source") or "").strip()[:500]
        translated = (d.get("translation") or "").strip()[:700]
        codes = {"en":"English", "hi":"Hindi", "mr":"Marathi", "or":"Odia"}
        src, dest = codes.get(d.get("from"), "English"), codes.get(d.get("to"), "Hindi")
        if not source or not translated:
            return jsonify(error="Translate a phrase first."), 400
        system = ("You are a careful multilingual language tutor. Explain the given translation for a learner. "
                  "Use plain text with these headings: NATURALNESS, TONE, ALTERNATIVE, CULTURAL NOTE, LEARNING TIP. "
                  "Keep each section concise. Do not claim uncertain cultural facts. Respect Marathi and Odia script. "
                  "If the translation looks awkward, say so politely. Do not invent a backstory.")
        prompt = f"Source ({src}): {source}\nTranslation ({dest}): {translated}\nExplain meaning, tone, one natural alternative, cultural nuance if relevant, and one learning tip."
        out = ask_llm(system, [{"role":"user", "content":prompt}], 450)
        if out:
            return jsonify(insight=out, mode="llm")
        fallback = (f"Source language: {src}\nTarget language: {dest}\n\n"
                    "Meaning: Compare the translated phrase with the original sentence and check that names, tense and politeness are preserved.\n"
                    "Tone: The safest default is a neutral, polite tone.\n"
                    "Alternative: Try a shorter everyday expression and compare it with this translation.\n"
                    "Cultural note: Marathi and Odia expressions can vary by region and formality; ask a native speaker for important messages.\n"
                    "Learning tip: Listen to the phrase, repeat it slowly, then use Speak it to practise.")
        return jsonify(insight=fallback, mode="rules")
