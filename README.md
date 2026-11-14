# Civic Air Quality Briefing Studio

Turns raw, messy air quality readings into three things a local team can act on:

1. an **internal briefing note** with trends, hotspots and data caveats,
2. **prioritised actions** matched to who is asking (ward officer, housing society or school),
3. a **citizen advisory** in several languages and reading levels, with extra care for children, older adults and people sensitive to poor air.

Every finding links back to the rows it came from, unreliable readings are flagged instead of silently fixed, and each new brief is compared with the previous one.

Built for the PromptWars warm-up challenge. Generative AI (Google Gemini) is the core writer and interpreter; a deterministic engine does the arithmetic and keeps the app working if the model is unavailable.

## Try it in one minute

1. Open the app and click **Week 2, compared with Week 1** (a deliberately messy sample).
2. Pick an audience and press **Generate briefing**.
3. Click any row chip such as `R15` to jump to the exact row behind a finding.
4. Switch audience with the buttons under the actions, and switch language and reading level in the advisory.

## How the challenge requirements are met

| Requirement | How it is handled |
|---|---|
| Interpret pasted or uploaded tables, including messy ones | Accepts CSV, TSV, semicolon, Markdown pipe tables, aligned columns and JSON, in wide or long layout. Handles mixed date formats, units written in cells or headers (µg/m³, mg/m³, ppb, ppm), blanks, `N/A`, sensor codes such as `999`, negatives, zeros, duplicate rows, stuck sensors, spikes, merged spellings and blank "merged" cells. If no table can be found at all (free-text field notes), Gemini extracts the readings and keeps the original line numbers. |
| Summarise trends and likely hotspots in plain language | Gemini writes the summary, trends and hotspots from statistics computed directly from the rows (averages, peaks, CPCB band, trend within the period, time-of-day pattern). |
| Prioritised actions suited to who is asking | The prompt states what each audience can actually do. A school or society brief centres on its own site when the data contains it. |
| Every finding traceable to the data | Every row gets an ID equal to its line number (`R7` = line 7). Each trend, hotspot, data issue and action cites row IDs, shown as clickable chips. The server rejects any row ID the model invents and marks findings left without evidence. |
| Data gaps and unreliable readings clearly flagged | 15 flag types. Excluded readings are shown in red with the reason, kept-but-doubtful ones in amber, low-confidence locations are striped in the chart, and the brief has its own "Data gaps" section. |
| Compare each new brief with the previous one | Each brief is saved in the browser and the next is compared with it automatically. Earlier data can also be pasted alongside for an instant comparison. Changes are computed from the numbers (per location, new and resolved hotspots, data coverage). |
| Internal briefing note and citizen advisory | Internal note: copy, download or print. Advisory: 12 languages, each with an easy-read version (9-year-old reading level), a standard version, an SMS, and tips for children, older adults and sensitive people. |

## How it works

```
pasted / uploaded text
        │
        ▼
  parse.js      detect layout, units, dates; flag every problem; assign row IDs
        │            (no table found → Gemini extracts records, then re-parse)
        ▼
  analyze.js    per-location statistics, CPCB bands, hotspots, trends, time of day
        │
        ▼
  compare.js    difference from the previous brief
        │
        ▼
  prompts.js → Gemini    writes the brief over those statistics, citing row IDs
        │
        ▼
  brief.js      validate shape, check every cited row exists, fill gaps from rules
        │
        ▼
  rules.js      rule-based brief and advisory (fallback, and the gap filler)
```

**Division of labour.** The model interprets, explains, prioritises and translates. It does not do arithmetic: every number comes from `analyze.js`, and the prompt tells the model to quote, not recompute. This is what makes the output traceable.

**Resilience.** If there is no API key, the model is slow, or it returns something unusable, the rule engine produces the full brief and the UI says so. One broken step never blanks the page.

### Prompt design

The three prompts live in `src/prompts.js`. Each one:

- states the role and the audience's real powers, so actions are feasible for that audience;
- supplies computed statistics as the authoritative source and forbids new calculations;
- requires 1 to 6 row IDs as evidence for every finding and action;
- fences user data between `<<<DATA` and `DATA>>>` and declares it untrusted, so text in a cell cannot act as an instruction;
- asks for a fixed JSON shape, which the server then validates and length-limits.

The advisory prompt receives only a small set of facts (status, worst areas, peak time), never raw data, and sets explicit rules for each reading level and for health wording.

## Google services

- **Gemini API** (Google AI Studio key) through the REST `generateContent` endpoint. The client tries current Flash models newest first and remembers the one that works; override with `GEMINI_MODEL`.
- Hosting: the same `server.js` runs on Vercel (live demo), on **Cloud Run** via the included Dockerfile, or locally.

## Run locally

Requires Node.js 20 or newer. There are no dependencies to install.

```bash
cp .env.example .env        # add your GEMINI_API_KEY
npm run dev                 # http://localhost:8080
```

Without a key the app still runs, using the rule engine.

```bash
npm test                    # 38 tests, no network needed
npm run lint                # ESLint (no-var, prefer-const, eqeqeq, no-shadow ...)
```

## Deploy to Vercel

Import the repository in Vercel, add `GEMINI_API_KEY` under Settings → Environment Variables, and deploy. Vercel detects `server.js`, whose export is the request handler, so no extra configuration is needed. `vercel.json` only adds security headers to CDN-served static files.

## Deploy to Cloud Run

```bash
gcloud run deploy civic-air-briefing-studio \
  --source . \
  --region asia-south1 \
  --allow-unauthenticated \
  --set-env-vars GEMINI_API_KEY=YOUR_KEY
```

The command prints the public URL. The header badge shows "Gemini connected" when the key is picked up.

## API

Routes are matched by their final segment, so `/api/analyze` and `/svc/analyze` are equivalent. The front end uses `/svc/` because some hosts reserve the `/api` prefix.

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | Liveness and whether Gemini is configured |
| `GET /api/config` | Languages, audiences, flag descriptions |
| `POST /api/analyze` | `{ raw, audience, place?, previousRaw?, previous?, useAI? }` → parsed rows, statistics, comparison, brief, internal note |
| `POST /api/advisory` | `{ facts, language, audience }` → advisory in one language |

## Efficiency

- No runtime dependencies and no build step; cold starts load only the standard library.
- Static files are read once, pre-compressed with gzip and served from memory with ETags; JSON responses over 1 KB are gzip-compressed.
- Identical model requests are served from a short-lived cache, so re-opening a brief costs no model call.
- Advisories for each language are requested in parallel and rendered as they arrive.
- Large tables are sampled before being sent to the model (all flagged rows are always kept), which bounds prompt size.

## Security

- The API key is read from the environment, used only on the server and sent in a header, never in a URL or to the browser.
- Strict Content-Security-Policy (`default-src 'none'`, no inline script or style), plus `nosniff`, frame denial, HSTS and a referrer policy.
- The front end builds every node with DOM APIs; pasted data and model output are never inserted as HTML.
- Request size limit, per-IP rate limit, input validation on every field, and validation of snapshots returned from the browser.
- Prompt-injection defence as described above; model output is treated as untrusted and normalised.
- Nothing is stored on the server. Saved briefs live in the browser's local storage and can be deleted from the form.

## Accessibility

Semantic landmarks and headings, a skip link, labelled controls, visible focus, keyboard-reachable evidence chips and tables, live status announcements, `lang` and `dir` set on each advisory (including right-to-left Urdu), reduced-motion support, a print layout, and no meaning carried by colour alone: every band and flag also has a text label.

## Assumptions and limits

- Bands follow India's CPCB National AQI breakpoints, applied to the average of the supplied readings. This is indicative; an official AQI needs 24-hour averages from reference monitors.
- Ambiguous dates such as `03/04/2026` are read day-first.
- Gas readings in ppb are converted at 25 °C and 1 atm.
- Up to 1,500 rows and 200,000 characters per brief.
- Translations are written by the model; have a fluent speaker check them before wide circulation. Without a key, only English and Hindi advisories are available.
- The advisory gives standard precautions and is not medical advice.

## Project layout

```
server.js          HTTP server, security headers, rate limit, cache
src/parse.js       messy-table parser and flagging
src/analyze.js     statistics, bands, hotspots, trends
src/compare.js     previous-versus-current comparison
src/prompts.js     Gemini prompts and language list
src/gemini.js      Gemini REST client with fallbacks
src/brief.js       validation of model output, internal note text
src/rules.js       rule-based brief and audience action library
src/advisory-templates.js  built-in English and Hindi advisory text
src/pipeline.js    orchestration and input validation
public/            front end (no framework, no build step)
test/              node:test suites
```

## License

MIT
