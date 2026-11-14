'use strict';

/**
 * Guards between the model and the user.
 *
 * Model output is never shown as-is. It is coerced to a fixed shape, length
 * limited, and every cited row ID is checked against the rows that really exist.
 * Sections the model left out are filled from the rule-based brief.
 */

const TIMEFRAMES = ['Today', 'This week', 'This month'];
const CONFIDENCE = ['high', 'medium', 'low'];
const DIRECTIONS = ['worse', 'better', 'same', 'new'];

const text = (v, max = 600) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const list = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);
const strings = (v, max, len = 400) => list(v, max).map((s) => text(s, len)).filter(Boolean);
const pick = (v, allowed, fallback) => {
  const hit = allowed.find((a) => a.toLowerCase() === String(v || '').toLowerCase().trim());
  return hit || fallback;
};

/** Keep only row IDs that exist; report whether anything survived. */
function checkEvidence(value, validIds) {
  const ids = [];
  list(value, 12).forEach((raw) => {
    // Accept "R8", "row 8" or a bare "8"; anything else is not a row reference.
    const m = String(raw).match(/^\s*(?:rows?|r)?\s*#?\s*(\d+(?:\.\d+)?)\s*$/i);
    const id = m ? `R${m[1]}` : null;
    if (id && validIds.has(id) && !ids.includes(id)) ids.push(id);
  });
  return ids.slice(0, 8);
}

function normalizeBrief(raw, validIds, fallback) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const withEvidence = (item, extra) => {
    const evidence = checkEvidence(item.evidence, validIds);
    return { ...extra, evidence, unverified: evidence.length === 0 };
  };
  const section = (key, max, map) => {
    const items = list(src[key], max).filter((i) => i && typeof i === 'object').map(map).filter(Boolean);
    return items.length ? items : fallback[key];
  };

  const brief = {
    headline: text(src.headline, 200) || fallback.headline,
    summary: text(src.summary, 700) || fallback.summary,
    dataInterpretation: strings(src.dataInterpretation, 6).length ? strings(src.dataInterpretation, 6) : fallback.dataInterpretation,
    trends: section('trends', 6, (t) => (text(t.text) ? withEvidence(t, { text: text(t.text), confidence: pick(t.confidence, CONFIDENCE, 'medium') }) : null)),
    hotspots: section('hotspots', 8, (h) => (text(h.text) ? withEvidence(h, { location: text(h.location, 80), text: text(h.text), confidence: pick(h.confidence, CONFIDENCE, 'medium') }) : null)),
    dataQuality: section('dataQuality', 10, (d) => (text(d.text) ? withEvidence(d, { text: text(d.text), impact: text(d.impact, 300) }) : null)),
    actions: section('actions', 7, (a) => (text(a.title, 160) ? withEvidence(a, {
      title: text(a.title, 160), detail: text(a.detail, 500), why: text(a.why, 300), timeframe: pick(a.timeframe, TIMEFRAMES, 'This week'),
    }) : null)),
    changes: list(src.changes, 8).filter((c) => c && text(c.text)).map((c) => ({ text: text(c.text), direction: pick(c.direction, DIRECTIONS, 'same') })),
  };
  if (!brief.changes.length) brief.changes = fallback.changes;

  const note = src.internalNote && typeof src.internalNote === 'object' ? src.internalNote : {};
  const fb = fallback.internalNote;
  brief.internalNote = {
    subject: text(note.subject, 200) || fb.subject,
    situation: text(note.situation, 900) || fb.situation,
    keyFindings: strings(note.keyFindings, 6).length ? strings(note.keyFindings, 6) : fb.keyFindings,
    recommendedActions: strings(note.recommendedActions, 7).length ? strings(note.recommendedActions, 7) : fb.recommendedActions,
    risksAndCaveats: strings(note.risksAndCaveats, 6).length ? strings(note.risksAndCaveats, 6) : fb.risksAndCaveats,
    nextReview: text(note.nextReview, 300) || fb.nextReview,
  };
  return brief;
}

/** Mark evidence state on a rule-built brief so both paths share one shape. */
function finalizeRuleBrief(brief) {
  ['trends', 'hotspots', 'dataQuality', 'actions'].forEach((k) => {
    brief[k] = brief[k].map((item) => ({ ...item, unverified: false }));
  });
  return brief;
}

function normalizeAdvisory(raw, fallback) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const easy = src.easy && typeof src.easy === 'object' ? src.easy : {};
  const standard = src.standard && typeof src.standard === 'object' ? src.standard : {};
  const groups = src.groups && typeof src.groups === 'object' ? src.groups : {};
  const or = (a, b) => (a.length ? a : b);
  return {
    title: text(src.title, 160) || fallback.title,
    easy: { title: text(easy.title, 120) || fallback.easy.title, lines: or(strings(easy.lines, 7, 240), fallback.easy.lines) },
    standard: { title: text(standard.title, 160) || fallback.standard.title, paragraphs: or(strings(standard.paragraphs, 5, 900), fallback.standard.paragraphs) },
    groups: {
      children: or(strings(groups.children, 4, 300), fallback.groups.children),
      olderAdults: or(strings(groups.olderAdults, 4, 300), fallback.groups.olderAdults),
      sensitive: or(strings(groups.sensitive, 4, 300), fallback.groups.sensitive),
    },
    sms: text(src.sms, 200) || fallback.sms,
    translated: true,
  };
}

/** Plain-text internal briefing note, ready to paste into an email or file. */
function renderInternalNote({ brief, stats, comparison, audienceLabel, place, mode }) {
  const n = brief.internalNote;
  const refs = (ids) => (ids && ids.length ? ` [rows ${ids.join(', ')}]` : ' [no row reference]');
  const lines = [
    `INTERNAL BRIEFING NOTE`,
    `Subject: ${n.subject}`,
    `For: ${audienceLabel}${place ? ` | Area: ${place}` : ''} | Data period: ${stats.period.label}`,
    `Prepared: ${new Date().toISOString().slice(0, 10)} | Method: ${mode === 'ai' ? 'Gemini analysis over computed statistics' : 'rule-based analysis over computed statistics'}`,
    '',
    'SITUATION',
    n.situation,
    '',
    'KEY NUMBERS',
    `- Overall ${stats.primaryLabel}: average ${stats.overall.mean} ${stats.unit}, peak ${stats.overall.max} ${stats.unit} (row ${stats.overall.maxRow}), category ${stats.overall.category.label}`,
    ...stats.locations.filter((l) => l.mean != null).map((l) => `- ${l.name}: average ${l.mean} ${stats.unit}, ${l.category.label}${l.isHotspot ? ', HOTSPOT' : ''}${l.reliability === 'low' ? ', low confidence' : ''} [rows ${l.rows.slice(0, 4).join(', ')}]`),
    `- Data used: ${stats.totals.usable} of ${stats.totals.readings} readings (${stats.totals.coveragePct}%)`,
    '',
    'KEY FINDINGS',
    ...n.keyFindings.map((f) => `- ${f}`),
    '',
    'HOTSPOTS',
    ...brief.hotspots.map((h) => `- ${h.location}: ${h.text}${refs(h.evidence)}`),
    '',
    'TRENDS',
    ...brief.trends.map((t) => `- ${t.text} (confidence: ${t.confidence})${refs(t.evidence)}`),
    '',
    'RECOMMENDED ACTIONS (in priority order)',
    ...brief.actions.map((a, i) => `${i + 1}. [${a.timeframe}] ${a.title}. ${a.detail} Why: ${a.why}${refs(a.evidence)}`),
    '',
    'WHAT CHANGED SINCE THE LAST BRIEF',
    ...(comparison && comparison.available ? brief.changes.map((c) => `- ${c.text}`) : ['- No previous brief to compare with. This brief is the baseline.']),
    '',
    'DATA GAPS AND CAVEATS',
    ...brief.dataQuality.map((d) => `- ${d.text} ${d.impact}${d.evidence.length ? refs(d.evidence) : ''}`),
    ...n.risksAndCaveats.map((r) => `- ${r}`),
    '',
    'NEXT REVIEW',
    n.nextReview,
    '',
    `Note: ${stats.standard}`,
  ];
  return lines.join('\n');
}

/** Turn model-extracted records into a table the normal parser can read. */
function recordsToTable(records) {
  const cell = (v) => String(v == null ? '' : v).replace(/[\t\r\n]+/g, ' ').slice(0, 120);
  const rows = list(records, 1500)
    .filter((r) => r && typeof r === 'object' && Number.isInteger(Number(r.line)) && Number(r.line) > 0)
    .map((r) => [Number(r.line), cell(r.location), cell(r.datetime), cell(r.pollutant), cell(r.value), cell(r.unit)].join('\t'));
  if (!rows.length) return null;
  return ['source_line\tlocation\tdatetime\tpollutant\tvalue\tunit', ...rows].join('\n');
}

module.exports = { normalizeBrief, normalizeAdvisory, finalizeRuleBrief, renderInternalNote, recordsToTable, checkEvidence };
