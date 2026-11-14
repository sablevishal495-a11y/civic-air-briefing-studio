'use strict';

/**
 * Rule-based briefing engine.
 *
 * Produces the same brief shape as the Gemini path using only the computed
 * statistics. It is the safety net: if the model is unavailable, slow or returns
 * something unusable, the user still gets a complete, traceable brief.
 */

const AUDIENCES = {
  ward: {
    key: 'ward',
    label: 'Ward officer',
    powers: 'A municipal ward officer or ward-level team. Can order water sprinkling and mechanical road sweeping, inspect and penalise construction sites, stop open waste burning, manage traffic at junctions, deploy or service monitors, issue public notices and alert schools, clinics and societies. Cannot change city-wide policy alone but can escalate to the pollution control board.',
  },
  society: {
    key: 'society',
    label: 'Housing society',
    powers: 'A housing society / residents welfare association committee. Controls only its own premises: housekeeping (wet mopping instead of dry sweeping), renovation and construction timing, diesel generator use, garbage and leaf handling (no burning), vehicle idling at gates, clubhouse / gym / play-area timings, notice boards and residents\' message groups. Cannot regulate public roads but can report outside sources to the ward office.',
  },
  school: {
    key: 'school',
    label: 'School',
    powers: 'A school administration. Controls the timetable, outdoor PE / sports / assembly, classroom ventilation, bus and pick-up idling at the gate, the health room, and communication with parents. Cannot control the surroundings but can ask the ward office to act.',
  },
};

const bucketWord = { morning: 'in the morning', afternoon: 'in the afternoon', evening: 'in the evening', night: 'at night' };

function value(stats, v) {
  return `${v}${stats.unit ? ` ${stats.unit}` : ''}`;
}

/** Names that suggest a location is the audience's own site. */
const OWN_SITE = {
  school: /school|vidyalaya|vidyalay|college|academy|kindergarten|anganwadi/i,
  society: /society|apartment|residency|residences|housing|colony|enclave|towers?|chs\b|rwa\b/i,
};

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function context(stats, audience) {
  const hot = stats.locations.filter((l) => l.isHotspot);
  const top = stats.locations.find((l) => l.mean != null);
  // A school or society decides from the air at its own gate, when the data has it.
  const own = OWN_SITE[audience] ? stats.locations.find((l) => l.mean != null && OWN_SITE[audience].test(l.name)) || null : null;
  const focus = own || hot[0] || top;
  const tod = stats.timeOfDay && stats.timeOfDay.meaningful ? stats.timeOfDay : null;
  const peakBucket = tod ? tod.buckets.find((b) => b.key === tod.peak) : null;
  const quality = stats.quality.filter((q) => q.excluded || q.type === 'low_coverage');
  return {
    rank: own ? own.category.rank : Math.max(stats.overall.category.rank, focus ? focus.category.rank : 0),
    own,
    focus,
    hotNames: own ? own.name : hot.length ? hot.slice(0, 3).map((l) => l.name).join(', ') : top.name,
    hotEvidence: focus ? focus.rows.slice(0, 5) : [],
    peak: tod ? bucketWord[tod.peak] : '',
    best: tod ? bucketWord[tod.best] : '',
    peakEvidence: peakBucket ? peakBucket.rows.slice(0, 5) : [],
    rising: stats.locations.filter((l) => l.trend.direction === 'rising'),
    lowConfidence: stats.locations.filter((l) => l.reliability === 'low'),
    qualityEvidence: [...new Set(quality.flatMap((q) => q.rows))].slice(0, 6),
    hasQualityIssues: quality.length > 0,
  };
}

/** Action library: each entry applies from a minimum severity rank, optionally with a condition. */
const ACTIONS = {
  ward: [
    { min: 3, timeframe: 'Today', title: (c) => `Start water sprinkling and mechanical sweeping at ${c.hotNames}`, detail: (c) => `Sprinkle and sweep road dust twice a day${c.peak ? `, with one round just before the peak ${c.peak}` : ''}. Stop dry manual sweeping in these stretches.`, ev: 'hot' },
    { min: 3, timeframe: 'Today', title: () => 'Run anti-open-burning patrols', detail: (c) => `Send sanitation staff to check for waste and leaf burning near ${c.hotNames}${c.peak ? `, especially ${c.peak}` : ''}. Penalise repeat sites.`, ev: 'peak' },
    { min: 4, timeframe: 'Today', title: () => 'Alert schools, clinics and housing societies near the hotspots', detail: () => 'Share the citizen advisory from this brief so they can protect children, older adults and people with breathing or heart conditions.', ev: 'hot' },
    { min: 3, timeframe: 'This week', title: (c) => `Inspect construction and demolition sites around ${c.focus.name}`, detail: () => 'Check dust covers, wheel washing, covered transport of debris and green netting. Issue notices where controls are missing.', ev: 'hot' },
    { min: 4, timeframe: 'This week', title: (c) => `Ease traffic at ${c.focus.name}${c.peak ? ` ${c.peak}` : ''}`, detail: () => 'Work with traffic police on signal timing, a no-idling drive and diverting heavy vehicles during the worst hours.', ev: 'peak' },
    { min: 0, when: (c) => c.rising.length > 0, timeframe: 'This week', title: (c) => `Watch the rising trend at ${c.rising.slice(0, 2).map((l) => l.name).join(' and ')}`, detail: (c) => `Readings rose ${c.rising[0].trend.pct}% within this period. Re-check in 2–3 days and escalate to the pollution control board if the rise continues.`, ev: 'rising' },
    { min: 0, when: (c) => c.hasQualityIssues, timeframe: 'This week', title: (c) => `Service the monitors${c.lowConfidence.length ? ` at ${c.lowConfidence.slice(0, 2).map((l) => l.name).join(' and ')}` : ''}`, detail: () => 'Missing, stuck or fault-code readings are weakening this brief. Check power, calibration and data upload before the next review.', ev: 'quality' },
    { min: 2, max: 2, timeframe: 'This week', title: () => 'Keep routine dust control going', detail: (c) => `Levels are moderate. Maintain the sweeping schedule and keep an eye on ${c.hotNames}.`, ev: 'hot' },
    { min: 0, max: 1, timeframe: 'This month', title: () => 'Use the clean spell for preventive work', detail: () => 'Air is acceptable. Use this window to repair broken road edges, clear silt and debris piles, and service monitors before the next bad spell.', ev: 'hot' },
  ],
  society: [
    { min: 3, timeframe: 'Today', title: () => 'Switch from dry sweeping to wet mopping', detail: () => 'Ask housekeeping to sprinkle water before sweeping driveways, parking areas and podiums so dust is not thrown into the air.', ev: 'hot' },
    { min: 3, timeframe: 'Today', title: () => 'Pause dusty renovation work', detail: () => 'Ask flats under renovation to stop cutting, drilling, sanding and debris handling until levels improve. Keep debris covered.', ev: 'hot' },
    { min: 2, timeframe: 'Today', title: () => 'Enforce a strict no-burning rule', detail: () => 'Brief security and gardening staff: no burning of leaves, garbage or packaging anywhere on the premises.', ev: 'hot' },
    { min: 3, timeframe: 'Today', title: (c) => `Move play time and senior walks${c.best ? ` to the cleaner hours ${c.best}` : ' indoors'}`, detail: (c) => `Readings are highest ${c.peak || 'through the day'}. Shift children's outdoor play and walking groups, or use indoor common areas.`, ev: 'peak' },
    { min: 2, timeframe: 'Today', title: () => 'Post the advisory on notice boards and the residents\' group', detail: () => 'Use the easy-read citizen advisory from this brief, in the languages your residents read.', ev: 'hot' },
    { min: 4, timeframe: 'Today', title: () => 'Check on older residents and keep common rooms closed', detail: (c) => `Keep clubhouse and gym windows shut ${c.peak || 'while levels are high'}, and ask floor volunteers to check on older residents living alone.`, ev: 'peak' },
    { min: 3, timeframe: 'This week', title: () => 'Limit diesel generator test runs and gate idling', detail: (c) => `Run generator tests only when needed${c.best ? ` and ${c.best}` : ''}. Ask cabs, delivery vehicles and school buses to switch off engines at the gate.`, ev: 'hot' },
    { min: 3, timeframe: 'This week', title: (c) => `Report outside pollution sources around ${c.focus.name} to the ward office`, detail: () => 'Road dust, garbage burning and construction outside the gate are for the ward office to fix. Send them a written complaint with this brief attached.', ev: 'hot' },
    { min: 0, when: (c) => c.hasQualityIssues, timeframe: 'This week', title: () => 'Check the sensor before relying on it', detail: () => 'Some readings are missing or look faulty. Check that the sensor has power, is not next to a kitchen exhaust or generator, and is uploading data.', ev: 'quality' },
    { min: 0, max: 1, timeframe: 'This week', title: () => 'Good window for outdoor events and airing rooms', detail: () => 'Air is acceptable. Keep the no-burning rule in place and keep watching the readings.', ev: 'hot' },
  ],
  school: [
    { min: 4, timeframe: 'Today', title: () => 'Suspend outdoor activities', detail: (c) => `Hold assembly, PE and sports indoors and keep classroom windows closed ${c.peak || 'while levels are high'}.`, ev: 'hot' },
    { min: 3, max: 3, timeframe: 'Today', title: (c) => `Move PE, sports and assembly indoors${c.best ? ` or to the cleaner hours ${c.best}` : ''}`, detail: (c) => `Avoid running and other hard outdoor exercise${c.peak ? `, above all ${c.peak}` : ''}.`, ev: 'peak' },
    { min: 2, timeframe: 'Today', title: () => 'Keep inhalers within reach and brief the health room', detail: () => 'Identify pupils with asthma or other breathing conditions, make sure their inhalers are accessible, and tell staff what symptoms to watch for.', ev: 'hot' },
    { min: 3, timeframe: 'Today', title: () => 'Send the easy-read advisory to parents', detail: () => 'Use the citizen advisory from this brief. Ask parents to tell the class teacher if their child has breathing problems.', ev: 'hot' },
    { min: 4, timeframe: 'Today', title: () => 'Protect sensitive pupils on the commute', detail: () => 'Recommend well-fitted N95 masks for the journey to school and allow leave without penalty for children with breathing or heart conditions.', ev: 'hot' },
    { min: 2, timeframe: 'This week', title: () => 'Stop engine idling at the school gate', detail: () => 'Ask buses, vans and parents\' vehicles to switch off engines at drop-off and pick-up. Put up a no-idling sign.', ev: 'peak' },
    { min: 3, timeframe: 'This week', title: (c) => `Ask the ward office to act on pollution around ${c.focus.name}`, detail: () => 'Write to the ward officer requesting sprinkling, dust control and a check for waste burning near the school.', ev: 'hot' },
    { min: 0, when: (c) => c.hasQualityIssues, timeframe: 'This week', title: () => 'Do not base decisions on the flagged readings', detail: () => 'Some readings are missing or look faulty. Ask whoever runs the monitor to check it, and use the nearest reliable location meanwhile.', ev: 'quality' },
    { min: 0, max: 1, timeframe: 'Today', title: () => 'Normal outdoor activities can go ahead', detail: () => 'Air is acceptable. Keep watching children with asthma and re-check the readings daily.', ev: 'hot' },
  ],
};

function buildActions(stats, audienceKey, c) {
  const evidence = { hot: c.hotEvidence, peak: c.peakEvidence.length ? c.peakEvidence : c.hotEvidence, quality: c.qualityEvidence, rising: c.rising[0] ? c.rising[0].trend.rows : c.hotEvidence };
  const why = {
    hot: `${c.focus.name} averages ${value(stats, c.focus.mean)} ${stats.primaryLabel} (${c.focus.category.label}).`,
    peak: c.peak ? `Readings are highest ${c.peak} (${stats.timeOfDay.spreadPct}% above the cleanest part of the day).` : `${c.focus.name} averages ${value(stats, c.focus.mean)} ${stats.primaryLabel} (${c.focus.category.label}).`,
    quality: `${stats.totals.excluded} of ${plural(stats.totals.readings, 'reading')} are missing or unreliable.`,
    rising: c.rising[0] ? `${c.rising[0].name} went from ${c.rising[0].trend.from} to ${c.rising[0].trend.to} ${stats.unit} within the period.` : '',
  };
  return (ACTIONS[audienceKey] || ACTIONS.ward)
    .filter((a) => c.rank >= a.min && (a.max == null || c.rank <= a.max) && (!a.when || a.when(c)))
    .slice(0, 6)
    .map((a) => ({ title: a.title(c), detail: a.detail(c), why: why[a.ev], timeframe: a.timeframe, evidence: evidence[a.ev] }));
}

function buildRuleBrief({ stats, comparison, audience, place, notes = [] }) {
  const c = context(stats, audience);
  const where = place || 'The monitored area';
  const cat = stats.overall.category.label;
  const hot = stats.locations.filter((l) => l.isHotspot);

  const headline = hot.length
    ? `${where}: air is ${cat} overall, worst at ${hot[0].name}`
    : `${where}: air is ${cat} overall, no hotspot stands out`;
  const hotList = hot.slice(0, 3).map((l) => l.name).join(', ');
  const ownLine = c.own ? ` At ${c.own.name} the average is ${value(stats, c.own.mean)} (${c.own.category.label}).` : '';
  const summary = `Across ${plural(stats.totals.locations, 'location')} the average ${stats.primaryLabel} is ${value(stats, stats.overall.mean)} (${cat}). ${hot.length ? `${plural(hot.length, 'location')} ${hot.length === 1 ? 'needs' : 'need'} attention: ${hotList}.` : 'No location is in the Poor range or worse.'}${ownLine} ${stats.totals.coveragePct}% of readings were usable.`;

  const trends = [];
  const ot = stats.overall.trend;
  if (ot.direction !== 'unknown') {
    trends.push({
      text: ot.direction === 'steady'
        ? `Overall ${stats.primaryLabel} was steady through the period (${ot.from} → ${ot.to} ${stats.unit}).`
        : `Overall ${stats.primaryLabel} was ${ot.direction} through the period: ${ot.from} → ${ot.to} ${stats.unit} (${ot.pct > 0 ? '+' : ''}${ot.pct}%).`,
      evidence: ot.rows,
      confidence: stats.totals.coveragePct >= 80 ? 'high' : 'medium',
    });
  }
  if (stats.timeOfDay && stats.timeOfDay.meaningful) {
    const tod = stats.timeOfDay;
    const peakB = tod.buckets.find((b) => b.key === tod.peak);
    const bestB = tod.buckets.find((b) => b.key === tod.best);
    trends.push({
      text: `Pollution peaks ${bucketWord[tod.peak]} (average ${value(stats, peakB.mean)}) and is lowest ${bucketWord[tod.best]} (${value(stats, bestB.mean)}).`,
      evidence: peakB.rows,
      confidence: peakB.n >= 4 ? 'high' : 'medium',
    });
  }
  stats.locations.filter((l) => l.trend.direction === 'rising' || l.trend.direction === 'falling').slice(0, 3).forEach((l) => {
    trends.push({
      text: `${l.name} is ${l.trend.direction}: ${l.trend.from} → ${l.trend.to} ${stats.unit} (${l.trend.pct > 0 ? '+' : ''}${l.trend.pct}%).`,
      evidence: l.trend.rows,
      confidence: l.reliability === 'low' ? 'low' : 'medium',
    });
  });
  if (!trends.length) trends.push({ text: 'There are too few readings over time to describe a trend.', evidence: [], confidence: 'low' });

  const hotspotList = (hot.length ? hot : stats.locations.filter((l) => l.mean != null).slice(0, 1)).slice(0, 5).map((l) => ({
    location: l.name,
    text: `${hot.length ? '' : 'Highest of the monitored locations, but not a hotspot. '}Average ${value(stats, l.mean)} ${stats.primaryLabel} (${l.category.label}), peak ${value(stats, l.max)}.${l.worstPollutant && l.worstPollutant.pollutant !== stats.primary && l.worstPollutant.category.rank > l.category.rank ? ` ${l.worstPollutant.label} is worse still (${l.worstPollutant.category.label}).` : ''}${l.reliability === 'low' ? ` Low confidence: ${l.reliabilityReason}.` : ''}`,
    evidence: l.rows.slice(0, 6),
    confidence: l.reliability === 'low' ? 'low' : 'high',
  }));

  const dataQuality = stats.quality.slice(0, 8).map((q) => ({
    text: q.type === 'low_coverage'
      ? `${q.locations[0]}: ${q.explanation}.`
      : `${plural(q.count, 'reading')} flagged "${q.label}"${q.locations.length ? ` at ${q.locations.slice(0, 3).join(', ')}` : ''}. ${q.explanation}.`,
    evidence: q.rows.slice(0, 8),
    impact: q.type === 'low_coverage' ? 'Treat findings for this location as provisional.' : q.excluded ? 'Excluded from all averages and rankings.' : 'Kept in the averages; verify before acting on it.',
  }));
  if (!dataQuality.length) dataQuality.push({ text: 'No missing or suspicious readings were found.', evidence: [], impact: 'Findings can be used as they are.' });

  const actions = buildActions(stats, audience, c);
  const changes = comparison && comparison.available
    ? comparison.summary.map((item) => ({ text: item.text, direction: item.direction }))
    : [];

  const internalNote = {
    subject: `Air quality briefing for ${AUDIENCES[audience].label.toLowerCase()}: ${where} (${stats.period.label})`,
    situation: summary,
    keyFindings: [...hotspotList.map((h) => `${h.location}: ${h.text}`), ...trends.slice(0, 3).map((t) => t.text)],
    recommendedActions: actions.map((a) => `[${a.timeframe}] ${a.title}`),
    risksAndCaveats: [
      stats.totals.excluded ? `${stats.totals.excluded} of ${plural(stats.totals.readings, 'reading')} were missing or unreliable and are left out of every average.` : 'All supplied readings were usable.',
      ...c.lowConfidence.slice(0, 3).map((l) => `${l.name} is low confidence: ${l.reliabilityReason}.`),
      'Possible sources (traffic, dust, burning) are not measured here and should be confirmed on the ground.',
    ],
    nextReview: c.rank >= 4 ? 'Review again tomorrow with fresh readings.' : c.rank >= 3 ? 'Review again within 2–3 days.' : 'Review again next week.',
  };

  return {
    headline, summary, trends, hotspots: hotspotList, dataQuality, actions, changes, internalNote,
    dataInterpretation: notes.length ? notes : ['Columns were recognised from their headers; no assumptions were needed.'],
  };
}

/** Facts handed to the advisory writer. Deliberately small: nothing here can leak raw data. */
function advisoryFacts(stats, place) {
  const c = context(stats);
  return {
    place: place || '',
    status: stats.overall.category.label,
    worstStatus: c.focus.category.label,
    severity: c.rank,
    pollutant: stats.primaryLabel,
    average: stats.overall.mean,
    unit: stats.unit,
    worstAreas: stats.locations.filter((l) => l.isHotspot).slice(0, 4).map((l) => l.name),
    peakTime: stats.timeOfDay && stats.timeOfDay.meaningful ? stats.timeOfDay.peak : '',
    cleanestTime: stats.timeOfDay && stats.timeOfDay.meaningful ? stats.timeOfDay.best : '',
    trend: stats.overall.trend.direction,
    period: stats.period.label,
    dataCaveat: stats.totals.coveragePct < 80 ? `${100 - stats.totals.coveragePct}% of readings were missing or unreliable, so this advisory is provisional.` : '',
  };
}

// ---- Offline citizen advisory (English + Hindi) ------------------------------

const tier = (severity) => (severity <= 1 ? 0 : severity === 2 ? 1 : severity === 3 ? 2 : 3);

const TEXT = {
  en: {
    status: { Good: 'Good', Satisfactory: 'Satisfactory', Moderate: 'Moderate', Poor: 'Poor', 'Very Poor': 'Very Poor', Severe: 'Severe' },
    time: { morning: 'in the morning', afternoon: 'in the afternoon', evening: 'in the evening', night: 'at night' },
    title: (f) => `Air quality advisory${f.place ? `: ${f.place}` : ''}`,
    easyTitle: ['The air is okay today', 'The air is a little dirty', 'The air is dirty', 'The air is very dirty'],
    easy: [
      ['The air is okay today.', 'You can play and walk outside.', 'If breathing feels hard, rest and tell someone.'],
      ['The air is a little dirty.', 'Most people can do their usual things.', 'If you have asthma or a breathing illness, do less hard work outside.'],
      ['The air is dirty.', 'Spend less time outside.', 'Do not run or do hard exercise outside.', 'Children, older people and people with breathing illness should stay indoors more.'],
      ['The air is very dirty.', 'Stay indoors as much as you can.', 'Keep windows and doors closed.', 'If you must go out, wear an N95 mask.', 'See a doctor quickly if you cannot breathe well or your chest hurts.'],
    ],
    standard: (f, t) => [
      `Air quality${f.place ? ` in ${f.place}` : ''} is currently in the "${t.status[f.worstStatus]}" range at the worst-affected locations (average ${f.pollutant} ${f.average} ${f.unit} across all monitors, ${f.period}).`,
      f.worstAreas.length ? `The most affected areas are ${f.worstAreas.join(', ')}.` : 'No single area stands out as a hotspot.',
      f.peakTime ? `Pollution is highest ${t.time[f.peakTime]} and lowest ${t.time[f.cleanestTime]}. Plan outdoor work, exercise and errands for the cleaner hours.` : '',
      ['No special precautions are needed.', 'People who are sensitive to poor air should reduce long or heavy outdoor exertion.', 'Everyone should cut down on prolonged outdoor exertion. Do not burn waste or leaves, and avoid dry sweeping.', 'Avoid outdoor exertion, keep windows closed during the worst hours, and wear a well-fitted N95 mask if you must go out. Do not burn waste or leaves.'][tier(f.severity)],
      f.dataCaveat,
    ].filter(Boolean),
    groups: {
      children: [
        ['Outdoor play is fine.'],
        ['Outdoor play is fine; children with asthma should take breaks and keep their inhaler nearby.'],
        ['Move outdoor play and sports indoors or to the cleaner hours.', 'Children with asthma should keep their inhaler with them.'],
        ['Keep children indoors; no outdoor sports or play.', 'Watch for coughing or wheezing and see a doctor if it does not settle.'],
      ],
      olderAdults: [
        ['Usual walks and activities are fine.'],
        ['Prefer a shorter, gentler walk and avoid busy roads.'],
        ['Walk indoors or during the cleaner hours.', 'Keep regular medicines at hand.'],
        ['Stay indoors and avoid exertion.', 'Seek medical help for breathlessness, chest pain or unusual tiredness.'],
      ],
      sensitive: [
        ['Carry on as usual and keep medicines available.'],
        ['Reduce heavy outdoor exertion and keep reliever medicine with you.'],
        ['Avoid outdoor exertion and follow your asthma or heart-care plan.', 'Wear an N95 mask if you must be outside for long.'],
        ['Stay indoors in the cleanest room you have.', 'Use your prescribed medicines and call a doctor early if symptoms get worse.'],
      ],
    },
    sms: (f, t) => `Air quality${f.place ? ` ${f.place}` : ''}: ${t.status[f.worstStatus]}. ${['Enjoy outdoor activities.', 'Sensitive people: go easy outdoors.', 'Limit time outdoors; children, elders, patients stay in.', 'Stay indoors. N95 mask if you must go out.'][tier(f.severity)]}`,
  },
  hi: {
    status: { Good: 'अच्छी', Satisfactory: 'संतोषजनक', Moderate: 'मध्यम', Poor: 'खराब', 'Very Poor': 'बहुत खराब', Severe: 'गंभीर' },
    time: { morning: 'सुबह', afternoon: 'दोपहर में', evening: 'शाम को', night: 'रात में' },
    title: (f) => `वायु गुणवत्ता सूचना${f.place ? `: ${f.place}` : ''}`,
    easyTitle: ['आज हवा ठीक है', 'हवा थोड़ी खराब है', 'हवा खराब है', 'हवा बहुत खराब है'],
    easy: [
      ['आज हवा ठीक है।', 'आप बाहर खेल सकते हैं और टहल सकते हैं।', 'अगर सांस लेने में तकलीफ हो तो आराम करें और किसी को बताएं।'],
      ['हवा थोड़ी खराब है।', 'ज़्यादातर लोग अपना रोज़ का काम कर सकते हैं।', 'जिन्हें दमा या सांस की बीमारी है, वे बाहर भारी मेहनत कम करें।'],
      ['हवा खराब है।', 'बाहर कम समय बिताएं।', 'बाहर दौड़ना या भारी कसरत न करें।', 'बच्चे, बुज़ुर्ग और सांस के मरीज़ ज़्यादातर घर के अंदर रहें।'],
      ['हवा बहुत खराब है।', 'जितना हो सके घर के अंदर रहें।', 'खिड़की और दरवाज़े बंद रखें।', 'बाहर जाना ज़रूरी हो तो N95 मास्क पहनें।', 'सांस फूले या सीने में दर्द हो तो तुरंत डॉक्टर को दिखाएं।'],
    ],
    standard: (f, t) => [
      `${f.place ? `${f.place} में ` : ''}सबसे ज़्यादा प्रभावित जगहों पर हवा की गुणवत्ता अभी "${t.status[f.worstStatus]}" श्रेणी में है (सभी मॉनिटरों का औसत ${f.pollutant} ${f.average} ${f.unit})।`,
      f.worstAreas.length ? `सबसे ज़्यादा प्रभावित इलाके: ${f.worstAreas.join(', ')}।` : 'कोई एक इलाका बाकी से ज़्यादा प्रदूषित नहीं दिख रहा है।',
      f.peakTime ? `प्रदूषण ${t.time[f.peakTime]} सबसे ज़्यादा और ${t.time[f.cleanestTime]} सबसे कम रहता है। बाहर का काम, कसरत और खरीदारी साफ़ हवा वाले समय में करें।` : '',
      ['किसी खास सावधानी की ज़रूरत नहीं है।', 'जिन लोगों को खराब हवा से जल्दी तकलीफ होती है, वे बाहर लंबी या भारी मेहनत कम करें।', 'सभी लोग बाहर लंबे समय तक मेहनत वाला काम कम करें। कचरा या पत्ते न जलाएं और सूखी झाड़ू न लगाएं।', 'बाहर मेहनत वाला काम न करें, सबसे खराब समय में खिड़कियां बंद रखें और बाहर जाना ज़रूरी हो तो अच्छी तरह फिट होने वाला N95 मास्क पहनें। कचरा या पत्ते न जलाएं।'][tier(f.severity)],
      f.dataCaveat ? 'कुछ रीडिंग उपलब्ध नहीं थीं या भरोसेमंद नहीं थीं, इसलिए यह सूचना अस्थायी है।' : '',
    ].filter(Boolean),
    groups: {
      children: [
        ['बच्चे बाहर खेल सकते हैं।'],
        ['बच्चे बाहर खेल सकते हैं; दमा वाले बच्चे बीच-बीच में आराम करें और इनहेलर पास रखें।'],
        ['बाहर के खेल घर के अंदर या साफ़ हवा वाले समय में कराएं।', 'दमा वाले बच्चे इनहेलर अपने पास रखें।'],
        ['बच्चों को घर के अंदर रखें; बाहर खेल-कूद न कराएं।', 'खांसी या सांस में घरघराहट हो और आराम न मिले तो डॉक्टर को दिखाएं।'],
      ],
      olderAdults: [
        ['रोज़ की सैर और काम सामान्य रूप से कर सकते हैं।'],
        ['छोटी और हल्की सैर करें, व्यस्त सड़कों से दूर रहें।'],
        ['घर के अंदर या साफ़ हवा वाले समय में टहलें।', 'रोज़ की दवाएं पास रखें।'],
        ['घर के अंदर रहें और मेहनत वाला काम न करें।', 'सांस फूलने, सीने में दर्द या ज़्यादा थकान होने पर तुरंत डॉक्टर से मिलें।'],
      ],
      sensitive: [
        ['सामान्य दिनचर्या जारी रखें और दवाएं पास रखें।'],
        ['बाहर भारी मेहनत कम करें और राहत देने वाली दवा साथ रखें।'],
        ['बाहर मेहनत वाला काम न करें और डॉक्टर की बताई योजना का पालन करें।', 'ज़्यादा देर बाहर रहना पड़े तो N95 मास्क पहनें।'],
        ['घर के सबसे साफ़ कमरे में रहें।', 'डॉक्टर की बताई दवाएं लें और तकलीफ बढ़ने पर जल्दी डॉक्टर से संपर्क करें।'],
      ],
    },
    sms: (f, t) => `वायु गुणवत्ता${f.place ? ` ${f.place}` : ''}: ${t.status[f.worstStatus]}। ${['बाहर की गतिविधियां सामान्य रखें।', 'संवेदनशील लोग बाहर मेहनत कम करें।', 'बाहर कम रहें; बच्चे, बुज़ुर्ग, मरीज़ अंदर रहें।', 'घर के अंदर रहें। बाहर जाएं तो N95 मास्क पहनें।'][tier(f.severity)]}`,
  },
};

function buildRuleAdvisory(facts, langCode) {
  const t = TEXT[langCode] || TEXT.en;
  const i = tier(facts.severity);
  return {
    title: t.title(facts),
    easy: { title: t.easyTitle[i], lines: t.easy[i] },
    standard: { title: t.title(facts), paragraphs: t.standard(facts, t) },
    groups: { children: t.groups.children[i], olderAdults: t.groups.olderAdults[i], sensitive: t.groups.sensitive[i] },
    sms: t.sms(facts, t),
    translated: Boolean(TEXT[langCode]),
  };
}

module.exports = { buildRuleBrief, buildRuleAdvisory, advisoryFacts, AUDIENCES };
