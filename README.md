# Civic Air Quality Briefing Studio

Turns raw, messy air quality readings into three things a local team can act on:

1. an **internal briefing note** with trends, hotspots and data caveats,
2. **prioritised actions** matched to who is asking (ward officer, housing society or school),
3. a **citizen advisory** in several languages and reading levels, with extra care for children, older adults and people sensitive to poor air.

Every finding links back to the rows it came from, unreliable readings are flagged instead of silently fixed, and each new brief is compared with the previous one.

## Chosen vertical

**Civic Air Quality Briefing Studio** — an AI-driven civic intelligence assistant for local authorities, housing societies and ward-level teams. The persona is a smart, context-aware briefing assistant: it reads whatever air quality data the user has, works out who is asking (ward officer, housing society or school) and what that audience can actually do, and responds with decisions tailored to that context.

Built for the PromptWars challenge. Generative AI (Google Gemini) is the core writer and interpreter; a deterministic engine does the arithmetic and keeps the app working if the model is unavailable.

## Try it in one minute

1. Open the app and click **Week 2, compared with Week 1** (a deliberately messy sample).
2. Pick an audience and press **Generate briefing**.
3. Click any row chip such as `R15` to jump to the exact row behind a finding.
4. Switch audience with the buttons under the actions, and switch language and reading level in the advisory.

## Problem statement alignment

Each row quotes the problem statement and points to the feature, the code that implements it and the test that proves it.

| Problem statement | How the solution meets it | Code | Test |
|---|---|---|---|
| "AI-driven civic intelligence solution that enables local authorities, housing societies, and ward-level teams to turn raw air quality data into actionable local interventions" | One flow from raw readings to prioritised local actions, an internal note and a public advisory, for three civic audiences. | `src/pipeline.js` | `pipeline.test.js`: "without a key the rule engine writes a complete, traceable brief" |
| "must leverage Generative AI as a core component to interpret pasted or uploaded data tables" | Gemini writes every brief: it interprets the table (its reading of columns, units and messy values is shown under "How the table was interpreted"), explains trends and hotspots, prioritises actions and writes the advisories. When the input is not a table at all, Gemini extracts the readings itself. Paste and file upload are both supported. | `src/prompts.js`, `src/gemini.js`, `public/form.js` | "model output is validated…", "free text is restructured by the model, keeping source line numbers" |
| "including messy ones with inconsistent formats, units, or missing readings" | CSV, TSV, semicolon, Markdown, aligned columns, JSON and free text; mixed date formats; µg/m³, mg/m³, ppb, ppm; blanks, `N/A`, error codes, negatives, duplicates, stuck sensors, merged spellings. Nothing is silently fixed: 15 flag types. | `src/parse/` | `parse.test.js` (11 tests), e.g. "messy CSV sample: every problem is flagged and traceable to its row" |
| "summarize trends and likely hotspots in plain language" | Plain-language headline, summary, trends (over time and by time of day) and ranked hotspots with CPCB bands. | `src/analyze.js`, `src/prompts.js` | "week 1 statistics exclude unreliable readings and rank hotspots", "time-of-day pattern and trends carry evidence rows" |
| "recommend prioritized local actions suited to who is asking, since a ward officer, a housing society, and a school can each do different things" | Audience selector; the prompt states each audience's real powers; actions are ordered by urgency with a timeframe; a school or society brief centres on its own site. One click re-runs the same data for another audience. | `src/rules.js` (`AUDIENCES`, `ACTIONS`), `src/prompts.js` | "actions differ by audience and centre on the audience's own site" |
| "Every finding should be traceable to the underlying data" | Every row has an ID equal to its line number. Each trend, hotspot, data issue and action cites row IDs, shown as chips that jump to the source row. Row IDs the model invents are rejected; findings left without evidence are marked. | `src/brief.js` (`checkEvidence`), `public/evidence.js` | "model output is validated: invented row IDs are dropped, gaps are filled" |
| "with data gaps and unreliable readings clearly flagged" | Excluded readings are shown in red with the reason, doubtful ones in amber, low-confidence locations are striped in the chart, and the brief has a "Data gaps and unreliable readings" section. | `src/parse/checks.js`, `src/analyze.js` (`qualitySummary`) | "data quality summary lists each issue with its rows" |
| "compare each new brief with the previous one to show what changed" | Every brief is saved and the next is compared with it automatically; earlier data can also be pasted alongside. Shows per-location change, new and resolved hotspots, and data coverage. | `src/compare.js`, `public/history.js` | "comparison shows what changed between two briefs", "saved snapshots: the same data is skipped, an older brief is used" |
| "generate both an internal briefing note and a citizen advisory" | Internal note (copy, download, print) and a separate citizen advisory, produced together from the same findings. | `src/brief.js` (`renderInternalNote`), `src/pipeline.js` (`runAdvisory`) | "analyze and advisory work end to end" |
| "in multiple languages, written for different reading levels" | 12 languages (including right-to-left Urdu), each in an easy-read version for a 9-year-old reading level, a standard version and an SMS. | `src/prompts.js` (`LANGUAGES`, `buildAdvisoryPrompt`) | "advisory: offline English and Hindi, model path, and unsupported language" |
| "with extra care for children, older adults, and people sensitive to poor air" | Every advisory has dedicated guidance for each of the three groups, matched to severity; health wording is restricted to standard precautions. | `src/advisory-templates.js`, `src/prompts.js` | same advisory test (asserts all three groups are present) |
| Pro-tip: connected workflows, resilient to a single broken flow | Data → findings → actions → comparison → note → advisory are linked sections of one brief. If Gemini is unavailable, a rule engine produces the full brief, so no flow breaks. | `src/rules.js`, `src/pipeline.js` | "a failing model falls back to rules instead of failing the request" |

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
npm test                    # 39 tests, no network needed
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
- Parsing and statistics are single-pass over the readings: rows are grouped once by location and pollutant, and every figure reuses those groups.
- The rate limiter and the response cache are O(1) per request with bounded memory (fixed-window counters, LRU eviction).
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
server.js                 request handler and server entry (Vercel, Cloud Run, local)
src/pipeline.js           orchestration and input validation
src/parse/                messy-table parser, as a pipeline of small stages
  index.js                  readTable → locateColumns → planColumns → buildRows
  layout.js                 delimiter detection, cell splitting, JSON input
  detect.js                 pollutant, unit and column-role recognition
  time.js / value.js        date-time and cell-value parsing
  checks.js                 duplicates, stuck sensors, spikes, unit mismatches
  constants.js / util.js    pollutant and flag catalogues, shared helpers
src/analyze.js            statistics, CPCB bands, hotspots, trends
src/compare.js            previous-versus-current comparison
src/prompts.js            Gemini prompts and language list
src/gemini.js             Gemini REST client with fallbacks
src/brief.js              validation of model output, internal note text
src/rules.js              rule-based brief and audience action library
src/advisory-templates.js built-in English and Hindi advisory text
src/http/                 routing, static files, responses, body reading,
                          O(1) rate limiter, LRU cache
public/                   front end as ES modules, no framework or build step
  app.js                    entry point: form → backend → sections
  render-*.js               one module per section of the brief
  dom.js, api.js, state.js, history.js, form.js, evidence.js
test/                     node:test suites (39 tests)
.github/workflows/ci.yml  lint and tests on every push
```

## License

MIT
