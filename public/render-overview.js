/**
 * Overview section: headline, key numbers and charts.
 */

import { h, replace, catChip, withUnit } from './dom.js';
import { evidence } from './evidence.js';
import { state, $ } from './state.js';

export function renderOverview() {
  const r = state.result;
  const s = r.stats;
  const hot = s.locations.filter((l) => { return l.isHotspot; });
  const scaleMax = Math.max.apply(null, s.locations.map((l) => { return l.mean || 0; }).concat([s.breakpoints[2] * 1.15]));
  const poorFrom = s.breakpoints[2];

  const bars = s.locations.filter((l) => { return l.mean != null; }).map((l) => {
    const fill = h('div', { class: `bar-fill cat-${  l.category.key  }${l.reliability === 'low' ? ' low' : ''}` });
    fill.style.width = `${Math.max(1, Math.round((l.mean / scaleMax) * 100))  }%`;
    const mark = h('div', { class: 'bar-mark', 'aria-hidden': 'true' });
    mark.style.left = `${Math.round((poorFrom / scaleMax) * 100)  }%`;
    const trend = l.trend.direction === 'unknown' ? '' : `, ${  l.trend.direction  }${l.trend.pct ? ` ${  l.trend.pct > 0 ? '+' : ''  }${l.trend.pct  }%` : ''}`;
    return h('div', { class: 'bar-row', role: 'listitem', title: `${l.name  }: average ${  withUnit(l.mean, s.unit)  }, peak ${  withUnit(l.max, s.unit)  } (row ${  l.maxRow  })${  trend}` },
      h('div', { class: 'bar-name' }, l.name,
        h('small', null, `${l.isHotspot ? 'Hotspot · ' : ''  }peak ${  l.max  }${trend  }${l.reliability === 'low' ? ' · low confidence' : ''}`)),
      h('div', { class: 'bar-track' }, fill, mark),
      h('div', { class: 'bar-value' }, withUnit(l.mean, s.unit), catChip(l.category))
    );
  });

  const bands = ['Good', 'Satisfactory', 'Moderate', 'Poor', 'Very Poor', 'Severe'];
  const keys = ['good', 'satisfactory', 'moderate', 'poor', 'very_poor', 'severe'];
  const bandKey = bands.map((label, i) => {
    const lo = i === 0 ? 0 : s.breakpoints[i - 1];
    const range = i === 5 ? `above ${  s.breakpoints[4]}` : `${lo  }–${  s.breakpoints[i]}`;
    return h('span', { class: `cat cat-${  keys[i]}`, text: `${label  } ${  range}` });
  });

  const tod = s.timeOfDay;
  let todBlock = null;
  if (tod) {
    const todMax = Math.max.apply(null, tod.buckets.map((b) => { return b.mean; }));
    todBlock = h('div', null,
      h('h3', { text: 'By time of day' }),
      h('div', { class: 'chart compact', role: 'list', 'aria-label': `Average ${  s.primaryLabel  } by time of day` }, tod.buckets.map((b) => {
        const fill = h('div', { class: 'bar-fill' });
        fill.style.width = `${Math.round((b.mean / todMax) * 100)  }%`;
        fill.style.background = b.key === tod.peak ? 'var(--accent)' : '#9db8b3';
        return h('div', { class: 'bar-row', role: 'listitem' },
          h('div', { class: 'bar-name' }, b.label, h('small', null, `${b.n  } readings${  b.key === tod.peak ? ' · highest' : b.key === tod.best ? ' · lowest' : ''}`)),
          h('div', { class: 'bar-track' }, fill),
          h('div', { class: 'bar-value' }, withUnit(b.mean, s.unit)));
      })),
      tod.meaningful ? null : h('p', { class: 'hint small', text: 'The difference between times of day is small, so it is not treated as a pattern.' })
    );
  }

  const others = s.otherPollutants.filter((p) => { return p.mean != null; });
  const othersBlock = others.length ? h('div', null,
    h('h3', { text: 'Other pollutants in this data' }),
    h('div', { class: 'table-scroll' }, h('table', null,
      h('thead', null, h('tr', null, h('th', { scope: 'col', text: 'Pollutant' }), h('th', { scope: 'col', class: 'num', text: 'Average' }), h('th', { scope: 'col', class: 'num', text: 'Peak' }), h('th', { scope: 'col', text: 'Band' }))),
      h('tbody', null, others.map((p) => {
        return h('tr', null, h('th', { scope: 'row', text: p.label }), h('td', { class: 'num', text: withUnit(p.mean, p.unit) }),
          h('td', { class: 'num' }, withUnit(p.max, p.unit), evidence([p.maxRow])), h('td', null, catChip(p.category)));
      }))
    ))
  ) : null;

  replace($('overview-body'),
    r.mode === 'ai'
      ? h('p', { class: 'notice info', text: `Written by Gemini (${  r.model  }) from statistics computed directly from your rows. Cited rows were checked against the data.` })
      : h('p', { class: 'notice', text: r.aiNotice }),
    r.restructured ? h('p', { class: 'notice', text: 'Your input was not a regular table, so Gemini extracted the readings from the text. Check the Data section before relying on this brief.' }) : null,
    h('p', { class: 'headline', text: r.brief.headline }),
    h('p', { text: r.brief.summary }),
    h('p', { class: 'meta-line', text: `For: ${  r.audienceLabel  }${r.place ? ` · ${  r.place}` : ''  } · Data period: ${  s.period.label}` }),
    h('div', { class: 'tiles' },
      h('div', { class: 'tile' }, h('div', { class: 'tile-label', text: `Overall ${  s.primaryLabel}` }),
        h('div', { class: 'tile-value' }, String(s.overall.mean), ' ', h('small', { text: s.unit })), h('div', { class: 'tile-note' }, catChip(s.overall.category))),
      h('div', { class: 'tile' }, h('div', { class: 'tile-label', text: 'Hotspots' }),
        h('div', { class: 'tile-value' }, String(hot.length), ' ', h('small', { text: `of ${  s.totals.locations  } locations` })),
        h('div', { class: 'tile-note', text: hot.length ? hot.slice(0, 2).map((l) => { return l.name; }).join(', ') : 'None in the Poor range or worse' })),
      h('div', { class: 'tile' }, h('div', { class: 'tile-label', text: 'Highest reading' }),
        h('div', { class: 'tile-value' }, String(s.overall.max), ' ', h('small', { text: s.unit })),
        h('div', { class: 'tile-note' }, evidence([s.overall.maxRow]))),
      h('div', { class: 'tile' }, h('div', { class: 'tile-label', text: 'Usable data' }),
        h('div', { class: 'tile-value' }, `${s.totals.coveragePct  }%`),
        h('div', { class: 'tile-note', text: `${s.totals.usable  } of ${  s.totals.readings  } readings; ${  s.totals.excluded  } missing or flagged` }))
    ),
    h('h3', { text: `Average ${  s.primaryLabel  } by location` }),
    h('div', { class: 'chart', role: 'list', 'aria-label': `Average ${  s.primaryLabel  } by location, highest first` }, bars),
    h('div', { class: 'chart-key' }, h('span', null, h('span', { class: 'dash', 'aria-hidden': 'true' }), `Poor starts above ${  withUnit(poorFrom, s.unit)}`), bandKey),
    h('p', { class: 'hint small', text: `Striped bars are low-confidence locations. ${  s.standard}` }),
    h('div', { class: 'split' }, todBlock, othersBlock)
  );
}
