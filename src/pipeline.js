'use strict';

/**
 * The briefing pipeline:
 *
 *   raw text → parse (flag, never silently fix) → statistics → comparison with
 *   previous brief → Gemini writes the brief over those statistics → evidence
 *   check → rule-based fill-in for anything missing.
 *
 * If Gemini is not configured or fails at any step, the rule-based engine
 * produces the whole brief, so the user always gets a result.
 */

const { parseTable } = require('./parse');
const { computeStats, makeSnapshot } = require('./analyze');
const { compareSnapshots, sanitizeSnapshot } = require('./compare');
const { buildRuleBrief, advisoryFacts, AUDIENCES } = require('./rules');
const { buildRuleAdvisory } = require('./advisory-templates');
const { buildBriefPrompt, buildAdvisoryPrompt, buildRestructurePrompt, LANGUAGES } = require('./prompts');
const { normalizeBrief, normalizeAdvisory, finalizeRuleBrief, renderInternalNote, recordsToTable } = require('./brief');
const gemini = require('./gemini');

const MAX_RAW_CHARS = 200000;

class InputError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'InputError';
    this.status = status;
  }
}

const cleanText = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b-\u001f]/g, '').trim().slice(0, max) : '');

function validateAnalyzeInput(body) {
  if (!body || typeof body !== 'object') throw new InputError('Request body must be a JSON object.');
  if (typeof body.raw !== 'string' || !body.raw.trim()) throw new InputError('Paste or upload some air quality data first.');
  if (body.raw.length > MAX_RAW_CHARS) throw new InputError(`Data is too large. The limit is ${MAX_RAW_CHARS / 1000} thousand characters.`, 413);
  if (body.previousRaw != null && (typeof body.previousRaw !== 'string' || body.previousRaw.length > MAX_RAW_CHARS)) {
    throw new InputError('Previous data must be text within the size limit.');
  }
  const audience = AUDIENCES[body.audience] ? body.audience : null;
  if (!audience) throw new InputError('Choose who the briefing is for: ward, society or school.');
  return {
    raw: body.raw,
    previousRaw: typeof body.previousRaw === 'string' && body.previousRaw.trim() ? body.previousRaw : '',
    previous: body.previous || null,
    audience,
    place: cleanText(body.place, 80),
    useAI: body.useAI !== false,
  };
}

/** Parse with rules first; if no table can be found, let Gemini restructure the text. */
async function interpret(raw, ai, useAI) {
  const parsed = parseTable(raw);
  const stats = parsed.ok ? computeStats(parsed) : null;
  if (stats && stats.ok) return { parsed, stats, restructured: false };
  const problem = parsed.ok ? stats.error : parsed.error;

  if (useAI && ai.isConfigured()) {
    try {
      const { data } = await ai.generateJson({ ...buildRestructurePrompt(raw), timeoutMs: 40000 });
      const table = recordsToTable(data.records);
      const second = table ? parseTable(table) : null;
      const secondStats = second && second.ok ? computeStats(second) : null;
      if (secondStats && secondStats.ok) {
        const how = Array.isArray(data.notes) && typeof data.notes[0] === 'string' ? ` ${data.notes[0].slice(0, 240)}` : '';
        second.notes.unshift(`No regular table was found, so Gemini extracted the readings from the text. Row IDs point to the original line numbers. Check the Data section before relying on this.${how}`);
        return { parsed: second, stats: secondStats, restructured: true };
      }
    } catch {
      // fall through to the original parser error
    }
  }
  const hint = ai.isConfigured() && useAI
    ? ''
    : ' Tip: with Gemini switched on, free-text notes and unusual layouts can be read as well.';
  throw new InputError(`${problem}${hint}`, 422);
}

function publicRows(parsed) {
  return parsed.rows.map((r) => ({
    id: r.id,
    line: r.line,
    location: r.location,
    time: r.timeLabel,
    remark: r.remark,
    flags: r.flags,
    cells: Object.fromEntries(Object.entries(r.cells).map(([p, c]) => [p, { raw: c.raw, value: c.value, flags: c.flags, ok: c.ok, note: c.note }])),
  }));
}

/**
 * @param {object} body request body
 * @param {{ai?: typeof gemini}} [deps]
 */
async function runAnalysis(body, deps = {}) {
  const ai = deps.ai || gemini;
  const input = validateAnalyzeInput(body);
  const started = Date.now();

  const { parsed, stats, restructured } = await interpret(input.raw, ai, input.useAI);
  const snapshot = makeSnapshot(stats, input.place);

  // Previous brief: either earlier data pasted alongside, or a stored snapshot.
  let previous = null;
  let previousSource = 'none';
  if (input.previousRaw) {
    const prevParsed = parseTable(input.previousRaw);
    const prevStats = prevParsed.ok ? computeStats(prevParsed) : null;
    if (prevStats && prevStats.ok) {
      previous = makeSnapshot(prevStats, input.place);
      previous.createdAt = '';
      previousSource = 'data';
    }
  }
  if (!previous) {
    // Saved briefs arrive newest first; skip any that describe this same data
    // (for example the same table re-run for a different audience).
    const candidates = (Array.isArray(input.previous) ? input.previous : [input.previous]).slice(0, 8);
    previous = candidates.map(sanitizeSnapshot).find((s) => s && !(s.period === snapshot.period && s.overallMean === snapshot.overallMean)) || null;
    if (previous) previousSource = 'saved';
  }
  const comparison = previous ? compareSnapshots(previous, snapshot) : { available: false };
  comparison.source = previousSource;
  if (input.previousRaw && previousSource !== 'data') comparison.warning = 'The earlier data could not be read, so it was not used for comparison.';

  const ruleBrief = finalizeRuleBrief(buildRuleBrief({ stats, comparison, audience: input.audience, place: input.place, notes: parsed.notes }));
  let brief = ruleBrief;
  let mode = 'rules';
  let model = null;
  let aiNotice = '';
  if (!input.useAI) {
    aiNotice = 'AI writing was switched off for this brief.';
  } else if (!ai.isConfigured()) {
    aiNotice = 'No Gemini API key is configured, so this brief was written by the built-in rule engine.';
  } else {
    try {
      const result = await ai.generateJson(buildBriefPrompt({ parsed, stats, comparison, audience: input.audience, place: input.place }));
      brief = normalizeBrief(result.data, new Set(parsed.rows.map((r) => r.id)), ruleBrief);
      mode = 'ai';
      model = result.model;
    } catch (err) {
      aiNotice = `Gemini was unavailable (${err.message}), so this brief was written by the built-in rule engine.`;
    }
  }

  const audienceLabel = AUDIENCES[input.audience].label;
  return {
    mode,
    model,
    aiNotice,
    restructured,
    audience: input.audience,
    audienceLabel,
    place: input.place,
    parsed: {
      format: parsed.format,
      delimiter: parsed.delimiter,
      columns: parsed.columns,
      pollutants: parsed.pollutants,
      notes: parsed.notes,
      ignored: parsed.ignored.slice(0, 30),
      rows: publicRows(parsed),
    },
    stats,
    comparison,
    brief,
    internalNoteText: renderInternalNote({ brief, stats, comparison, audienceLabel, place: input.place, mode }),
    advisoryFacts: advisoryFacts(stats, input.place),
    snapshot,
    tookMs: Date.now() - started,
  };
}

function validateFacts(f) {
  if (!f || typeof f !== 'object') throw new InputError('Advisory facts are missing. Generate a briefing first.');
  const severity = Number.isInteger(f.severity) && f.severity >= 0 && f.severity <= 5 ? f.severity : null;
  if (severity == null) throw new InputError('Advisory facts are invalid. Generate a briefing first.');
  const time = (v) => (['morning', 'afternoon', 'evening', 'night'].includes(v) ? v : '');
  const status = (v) => (['Good', 'Satisfactory', 'Moderate', 'Poor', 'Very Poor', 'Severe'].includes(v) ? v : 'Moderate');
  return {
    place: cleanText(f.place, 80),
    status: status(f.status),
    worstStatus: status(f.worstStatus),
    severity,
    pollutant: cleanText(f.pollutant, 12),
    average: typeof f.average === 'number' && Number.isFinite(f.average) ? f.average : null,
    unit: cleanText(f.unit, 10),
    worstAreas: (Array.isArray(f.worstAreas) ? f.worstAreas : []).slice(0, 4).map((a) => cleanText(a, 80)).filter(Boolean),
    peakTime: time(f.peakTime),
    cleanestTime: time(f.cleanestTime),
    trend: ['rising', 'falling', 'steady'].includes(f.trend) ? f.trend : 'unknown',
    period: cleanText(f.period, 60),
    dataCaveat: cleanText(f.dataCaveat, 200),
  };
}

async function runAdvisory(body, deps = {}) {
  const ai = deps.ai || gemini;
  if (!body || typeof body !== 'object') throw new InputError('Request body must be a JSON object.');
  const language = LANGUAGES[body.language];
  if (!language) throw new InputError('Unsupported language.');
  const audience = AUDIENCES[body.audience] ? body.audience : 'ward';
  const facts = validateFacts(body.facts);
  const fallback = buildRuleAdvisory(facts, language.code);

  let advisory = fallback;
  let mode = 'rules';
  let notice = '';
  if (body.useAI !== false && ai.isConfigured()) {
    try {
      const { data } = await ai.generateJson({ ...buildAdvisoryPrompt({ facts, language: language.code, audience }), timeoutMs: 40000 });
      advisory = normalizeAdvisory(data, fallback);
      mode = 'ai';
    } catch (err) {
      notice = `Gemini was unavailable (${err.message}).`;
    }
  }
  if (mode === 'rules' && !fallback.translated) {
    notice = `${notice} ${language.name} needs Gemini to translate; showing the English advisory instead.`.trim();
  }
  const shown = mode === 'rules' && !fallback.translated ? LANGUAGES.en : language;
  return { language, shownIn: shown, mode, notice, advisory };
}

module.exports = { runAnalysis, runAdvisory, InputError, MAX_RAW_CHARS, validateAnalyzeInput };
