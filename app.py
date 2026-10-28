"""PronounceGPT - AI-powered pronunciation and speaking assistant (English <-> Hindi).
Backend: Flask + SQLite.  Speech I/O: Web Speech API in the browser.
"""
import os, re, sqlite3, difflib
from datetime import datetime
from flask import Flask, render_template, request, jsonify, g
from translit import deva_to_roman

try:
    from deep_translator import GoogleTranslator
except ImportError:  # offline fallback keeps the demo alive
    GoogleTranslator = None

app = Flask(__name__)
DB_PATH = os.environ.get("DB_PATH", os.path.join(os.path.dirname(__file__), "pronouncegpt.db"))

# ---------- tiny offline dictionary (fallback when no internet) ----------
OFFLINE = {
    "en-hi": {"hello": "नमस्ते", "thank you": "धन्यवाद", "good morning": "सुप्रभात",
              "how are you": "आप कैसे हैं", "water": "पानी", "welcome": "स्वागत है",
              "good night": "शुभ रात्रि", "i love india": "मैं भारत से प्यार करता हूँ"},
}
OFFLINE["hi-en"] = {v: k for k, v in OFFLINE["en-hi"].items()}

# ---------- database ----------
def db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
    return g.db

@app.teardown_appcontext
def close_db(_):
    d = g.pop("db", None)
    if d:
        d.close()

def init_db():
    con = sqlite3.connect(DB_PATH)
    con.executescript("""
    CREATE TABLE IF NOT EXISTS translations(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        direction TEXT NOT NULL, source_text TEXT NOT NULL,
        translated_text TEXT NOT NULL, roman TEXT, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS chats(
        id INTEGER PRIMARY KEY AUTOINCREMENT, scenario TEXT, role TEXT, content TEXT, created_at TEXT);
    CREATE TABLE IF NOT EXISTS attempts(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lang TEXT NOT NULL, target_text TEXT NOT NULL, spoken_text TEXT NOT NULL,
        score REAL NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS vocabulary(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        direction TEXT NOT NULL, source_text TEXT NOT NULL,
        translated_text TEXT NOT NULL, note TEXT DEFAULT '', created_at TEXT NOT NULL,
        UNIQUE(direction, source_text, translated_text));
    """)
    con.commit(); con.close()

# ---------- core logic ----------
def google_free(text, src, dest):
    """Free Google Translate endpoint via urllib - no extra library, works for any sentence."""
    import json, urllib.parse, urllib.request
    url = ("https://translate.googleapis.com/translate_a/single?client=gtx&sl=%s&tl=%s&dt=t&q=%s"
           % (src, dest, urllib.parse.quote(text)))
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=10) as r:
        data = json.loads(r.read().decode("utf-8"))
    return "".join(p[0] for p in data[0] if p and p[0])

def translate(text, direction):
    """Tries 4 engines in order: deep-translator -> Google endpoint -> LLM -> offline dictionary."""
    src, dest = direction.split("-")
    if GoogleTranslator:
        try:
            return GoogleTranslator(source=src, target=dest).translate(text), "deep-translator"
        except Exception:
            pass
    try:
        return google_free(text, src, dest), "google"
    except Exception:
        pass
    import ai
    names = {"en": "English", "hi": "Hindi", "mr": "Marathi", "or": "Odia"}
    out = ai.ask_llm("You are a translator. Output ONLY the translation, nothing else.",
                     [{"role": "user", "content": "Translate from %s to %s: %s" % (names[src], names[dest], text)}], 300)
    if out:
        return out, "llm"
    hit = OFFLINE.get(direction, {}).get(text.strip().lower().rstrip("?.!"))
    if hit:
        return hit, "offline"
    return None, "error"

def normalize(t):
    return re.sub(r"[^\w\s\u0900-\u097F]", "", t.lower()).split()

def score_speech(target, spoken):
    """Word-level alignment (difflib) + per-word fuzzy similarity -> 0..100 score."""
    t, s = normalize(target), normalize(spoken)
    if not t:
        return 0, []
    sm = difflib.SequenceMatcher(None, t, s)
    results = []
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            results += [{"word": w, "heard": w, "sim": 1.0} for w in t[i1:i2]]
        elif tag == "replace":
            tw, sw = t[i1:i2], s[j1:j2]
            for k, w in enumerate(tw):
                h = sw[k] if k < len(sw) else ""
                results.append({"word": w, "heard": h,
                                "sim": difflib.SequenceMatcher(None, w, h).ratio() if h else 0})
        elif tag == "delete":
            results += [{"word": w, "heard": "", "sim": 0.0} for w in t[i1:i2]]
    for r in results:
        r["status"] = "good" if r["sim"] >= 0.85 else "close" if r["sim"] >= 0.5 else "miss"
    return round(sum(r["sim"] for r in results) / len(results) * 100), results

# ---------- routes ----------
@app.route("/")
def index():
    return render_template("index.html")

@app.post("/api/translate")
def api_translate():
    d = request.get_json(force=True)
    text, direction = (d.get("text") or "").strip(), d.get("direction", "en-hi")
    if not text or not re.fullmatch(r"[a-z]{2}-[a-z]{2}", direction) or direction.split("-")[0] not in {"en","hi","mr","or"} or direction.split("-")[1] not in {"en","hi","mr","or"} or direction.split("-")[0] == direction.split("-")[1]:
        return jsonify(error="Enter some text first."), 400
    out, mode = translate(text[:500], direction)
    if out is None:
        return jsonify(error="Translation needs an internet connection (or an API key in .env). Check your connection and try again."), 503
    roman = deva_to_roman(out) if re.search(r"[\u0900-\u097F\u0B00-\u0B7F]", out) else ""
    if d.get("save", True):  # live previews (save=false) are not stored in history
        db().execute("INSERT INTO translations(direction,source_text,translated_text,roman,created_at) VALUES(?,?,?,?,?)",
                     (direction, text, out, roman, datetime.now().isoformat(timespec="seconds")))
        db().commit()
    voice_codes = {"en": "en-US", "hi": "hi-IN", "mr": "mr-IN", "or": "or-IN"}
    return jsonify(translation=out, roman=roman, mode=mode,
                   speak_lang=voice_codes[direction.split("-")[1]], source_lang=voice_codes[direction.split("-")[0]])

@app.post("/api/score")
def api_score():
    d = request.get_json(force=True)
    target, spoken, lang = d.get("target", ""), d.get("spoken", ""), d.get("lang", "en-US")
    score, words = score_speech(target, spoken)
    db().execute("INSERT INTO attempts(lang,target_text,spoken_text,score,created_at) VALUES(?,?,?,?,?)",
                 (lang, target, spoken, score, datetime.now().isoformat(timespec="seconds")))
    db().commit()
    tip = ("Excellent clarity!" if score >= 85 else "Good - slow down on the highlighted words."
           if score >= 60 else "Listen again, then repeat word by word.")
    return jsonify(score=score, words=words, tip=tip)

@app.get("/api/history")
def api_history():
    rows = db().execute("SELECT * FROM translations ORDER BY id DESC LIMIT 12").fetchall()
    return jsonify([dict(r) for r in rows])

@app.delete("/api/history")
def api_clear():
    db().execute("DELETE FROM translations"); db().commit()
    return jsonify(ok=True)

@app.get("/api/vocabulary")
def api_vocabulary():
    return jsonify([dict(r) for r in db().execute("SELECT * FROM vocabulary ORDER BY id DESC").fetchall()])

@app.post("/api/vocabulary")
def api_save_vocabulary():
    data = request.get_json(silent=True) or {}
    direction = (data.get("direction") or "en-hi").strip()
    source = (data.get("source_text") or "").strip()[:500]
    translated = (data.get("translated_text") or "").strip()[:1000]
    if not source or not translated:
        return jsonify(error="A source phrase and translation are required."), 400
    if not re.fullmatch(r"(en|hi|mr|or)-(en|hi|mr|or)", direction) or direction.split("-")[0] == direction.split("-")[1]:
        return jsonify(error="Choose two different supported languages."), 400
    db().execute("INSERT OR IGNORE INTO vocabulary(direction,source_text,translated_text,created_at) VALUES(?,?,?,?)",
                 (direction, source, translated, datetime.now().isoformat(timespec="seconds")))
    db().commit()
    return jsonify(ok=True)

@app.delete("/api/vocabulary/<int:item_id>")
def api_delete_vocabulary(item_id):
    db().execute("DELETE FROM vocabulary WHERE id=?", (item_id,)); db().commit()
    return jsonify(ok=True)

@app.get("/api/vocabulary/export")
def api_export_vocabulary():
    import csv, io
    from flask import Response
    rows = db().execute("SELECT direction,source_text,translated_text,created_at FROM vocabulary ORDER BY id DESC").fetchall()
    output = io.StringIO(); writer = csv.writer(output)
    writer.writerow(["Language direction", "Original phrase", "Translation", "Saved at"])
    writer.writerows([tuple(r) for r in rows])
    return Response("\ufeff" + output.getvalue(), mimetype="text/csv; charset=utf-8",
                    headers={"Content-Disposition": "attachment; filename=pronouncegpt_vocabulary.csv"})

@app.get("/api/stats")
def api_stats():
    q = lambda s: db().execute(s).fetchone()[0]
    recent = db().execute("SELECT score FROM attempts ORDER BY id DESC LIMIT 10").fetchall()
    return jsonify(translations=q("SELECT COUNT(*) FROM translations"),
                   attempts=q("SELECT COUNT(*) FROM attempts"),
                   average=round(q("SELECT IFNULL(AVG(score),0) FROM attempts")),
                   best=round(q("SELECT IFNULL(MAX(score),0) FROM attempts")),
                   trend=[r[0] for r in recent][::-1])

import ai
ai.register(app, db)
init_db()
if __name__ == "__main__":
    app.run(debug=True, port=5000)
