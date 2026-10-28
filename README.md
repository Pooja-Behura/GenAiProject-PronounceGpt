# PronounceGPT v2 – Generative-AI Pronunciation & Speaking Coach
English, Hindi, Marathi and Odia translation, browser voice input/output, speech scoring, and an LLM-powered coach.

## GenAI features (for the GenAI subject)
| Feature | How GenAI is used |
|---|---|
| 🤖 AI Conversation Coach | LLM role-plays cafe / airport / interview / market scenes in Hindi or English, replies with a correction tip (system-prompted persona, multi-turn memory) |
| 🎓 AI Pronunciation Feedback | Prompt contains target text, what the learner said, score and weak words; LLM returns 3 tips + a memory trick |
| ✨ AI Challenge Generator | LLM generates practice sentences / tongue twisters by level and topic |
| 🗣 Speech pipeline | Speech-to-text (Web Speech API) → word alignment scoring (difflib) → text-to-speech |
| 🔤 Hindi transliteration | Own rule-based Devanagari → Roman engine (`translit.py`) |
| 🎮 Gamification | XP, levels, daily streak, 6 badges, confetti, phrase of the day |
| 🛟 Fallback | With no API key every AI feature falls back to rule-based answers, so the demo never breaks |

Prompt-engineering techniques to mention in your report: role prompting, output-format constraints
("exactly 3 tips", "Tip:" delimiter), context injection, few-shot-free zero-shot prompting, token limits, graceful degradation.

## Added language and voice support
- Translation directions now include English, Hindi, Marathi and Odia using the Google Translate endpoint (`translate.googleapis.com`) through the existing translation fallback chain.
- The source and target language selectors control the translation direction.
- Voice input uses the browser Web Speech recognition API with locale settings: `en-US`, `hi-IN`, `es-ES`, and `fr-FR`.
- Spoken translations use browser text-to-speech with the matching target locale. Available voices depend on the browser and operating system.
- The Google translation endpoint is an unofficial, keyless endpoint and can be rate-limited or changed. For production use, replace it with an official Google Cloud Translation API key or another supported translation API.
- Claude AI features still require `ANTHROPIC_API_KEY` in `.env`; translation itself does not require that key.

## Architecture
Browser (HTML/CSS/JS + Web Speech API + Web Audio) ⇄ Flask REST API (`app.py`, `ai.py`) ⇄ SQLite
Tables: `translations`, `attempts`, `chats`.
API: `/api/translate` `/api/score` `/api/tutor` `/api/coach` `/api/challenge` `/api/profile` `/api/stats` `/api/history`

## Run in VS Code
1. Install Python 3.10+ and VS Code (with the *Python* extension).
2. VS Code → **File → Open Folder** → select `PronounceGPT`.
3. Open the terminal: **Terminal → New Terminal**.
4. Create a virtual environment:
   - Windows: `python -m venv venv` then `venv\Scripts\activate`
   - Mac/Linux: `python3 -m venv venv` then `source venv/bin/activate`
   (If VS Code asks to use the new environment, click **Yes**.)
5. `pip install -r requirements.txt`
6. *(Optional, enables the real LLM)* copy `.env.example` to `.env` and paste your Anthropic API key.
7. `python app.py`
8. Ctrl+Click **http://127.0.0.1:5000** and open it in **Chrome or Edge** (needed for the microphone). Allow mic permission.

## Deploy (GitHub + live link)
Push to GitHub → render.com → New Web Service → build `pip install -r requirements.txt`, start `gunicorn app:app`.
Add `ANTHROPIC_API_KEY` under Environment. Never commit `.env`.

## Limitations / future work
Scoring compares recognised words, not phonemes; future work: phoneme-level scoring, more Indian languages, user accounts.

## Live translation (v4)
- Translates automatically 0.45 s after you stop typing (debounced; stale responses are discarded with a sequence id).
- **Live voice**: continuous speech recognition with interim results; text and translation update while you speak; optional auto-speak of the translation (use headphones to avoid feedback).
- Live previews are not saved; pressing Enter / Translate saves to the database history.


## Updated multilingual and GenAI features
- Translation pairs across English (`en`), Hindi (`hi`), Marathi (`mr`) and Odia (`or`).
- Browser speech recognition and text-to-speech use locale hints (`en-US`, `hi-IN`, `mr-IN`, `or-IN`). Actual voice availability varies by browser and installed voices.
- **GenAI Lab – Meaning, tone & context:** uses the configured Anthropic API to explain naturalness, tone, alternatives, cultural nuance and a learning tip. Without an API key it shows a clearly labelled guidance fallback.
- To enable live AI features, copy `.env.example` to `.env` and add your own `ANTHROPIC_API_KEY`. Never commit `.env` or expose your key in frontend code.
- Translation uses the configured Google translation service via `deep-translator` / fallback endpoint; internet access is required.


## MCA-level extension: Vocabulary Notebook
This module demonstrates persistent CRUD using SQLite and Flask JSON APIs. Users can save translations, search saved phrases, replay the translated phrase, reopen it in the translator, delete entries and export a UTF-8 CSV revision list. It complements the translation studio, AI Coach, speech scoring, Sound Lab, challenges and progress dashboard.

### Viva points
- Frontend: responsive HTML, CSS and JavaScript.
- Backend: Flask routes with input validation and JSON responses.
- Database: SQLite persistence for learning data.
- AI: configured GenAI provider powers coach feedback and context insights; fallback behaviour is used when provider credentials are unavailable.
- Browser speech: Web Speech API support varies by browser and installed voices.
