/* Sample datasets (fictional ward). Deliberately messy: mixed date formats, units
   in cells, blanks, error codes, a stuck sensor, a duplicate row and merged spellings. */
(function (root) {
  'use strict';

  var week1 = [
    'Ward 14 air monitoring - weekly sheet (exported from field tablets)',
    'Station,Date,Time,PM2.5 (ug/m3),PM10,NO2 (ppb),Remarks',
    'Shivaji Nagar Junction,02/11/2026,08:00,148,262,41,heavy traffic',
    'Shivaji Nagar Junction,02/11/2026,14:00,112,205,33,',
    'Shivaji Nagar Junction,02/11/2026,8:00 PM,171 ug/m3,298,47,',
    'shivaji nagar junction,2026-11-03,08:00,156,270,44,',
    'Shivaji Nagar Junction,2026-11-03,14:00,118,N/A,35,',
    'Shivaji Nagar Junction,3 Nov 2026,20:00,183,311,49,garbage burning seen nearby',
    'Industrial Estate Road,02/11/2026,08:00,196,340,52,',
    'Industrial Estate Road,02/11/2026,14:00,178,322,48,',
    'Industrial Estate Road,02/11/2026,20:00,221,371,55,',
    'Industrial Estate Road,03/11/2026,08:00,204,352,53,',
    'Industrial Estate Road,03/11/2026,14:00,0.189 mg/m3,330,50,unit changed after service',
    'Industrial Estate Road,03/11/2026,20:00,236,999,57,PM10 channel fault?',
    'Govt Primary School No. 4,02/11/2026,08:00,84,150,22,',
    'Govt Primary School No. 4,02/11/2026,14:00,66,121,18,',
    'Govt Primary School No. 4,02/11/2026,20:00,91,163,24,',
    'Govt. Primary School No 4,03/11/2026,08:00,88,155,23,',
    'Govt Primary School No. 4,03/11/2026,14:00,-,118,17,',
    'Govt Primary School No. 4,03/11/2026,20:00,95,170,25,',
    'Lakeview Housing Society Gate,02/11/2026,08:00,72,131,19,',
    'Lakeview Housing Society Gate,02/11/2026,14:00,58,104,15,',
    'Lakeview Housing Society Gate,02/11/2026,20:00,79,142,21,',
    'Lakeview Housing Society Gate,03/11/2026,08:00,75,136,20,',
    'Lakeview Housing Society Gate,03/11/2026,14:00,61,-12,16,',
    'Lakeview Housing Society Gate,03/11/2026,20:00,83,149,22,DG set running',
    'Riverside Park,02/11/2026,08:00,46,84,12,',
    'Riverside Park,02/11/2026,14:00,38,70,10,',
    'Riverside Park,02/11/2026,20:00,52,93,13,',
    'Riverside Park,03/11/2026,08:00,52,88,12,',
    'Riverside Park,03/11/2026,14:00,52,74,sensor offline,',
    'Riverside Park,03/11/2026,20:00,52,97,14,stuck?'
  ].join('\n');

  var week2 = [
    '| Location | Timestamp | pm2_5 | pm10 | no2_ppb | notes |',
    '|---|---|---|---|---|---|',
    '| Shivaji Nagar Junction | 2026-11-09 08:00 | 109 | 196 | 36 | sprinkling started 6 Nov |',
    '| Shivaji Nagar Junction | 2026-11-09 14:00 | 86 | 160 | 29 | |',
    '| Shivaji Nagar Junction | 2026-11-09 20:00 | 124 | 221 | 40 | |',
    '| Shivaji Nagar Junction | 2026-11-10 08:00 | 104 | 189 | 35 | |',
    '| Shivaji Nagar Junction | 2026-11-10 08:00 | 104 | 189 | 35 | uploaded twice |',
    '| Shivaji Nagar Junction | 2026-11-10 14:00 | 81 | 152 | 28 | |',
    '| Shivaji Nagar Junction | 2026-11-10 20:00 | 117 | 210 | 38 | |',
    '| Industrial Estate Road | 2026-11-09 08:00 | 232 | 388 | 58 | |',
    '| Industrial Estate Road | 2026-11-09 14:00 | 211 | 356 | 54 | |',
    '| Industrial Estate Road | 2026-11-09 20:00 | 268 | 420 | 63 | new demolition site |',
    '| Industrial Estate Road | 2026-11-10 08:00 | 247 | 401 | 60 | |',
    '| Industrial Estate Road | 2026-11-10 14:00 | NA | NA | NA | power cut |',
    '| Industrial Estate Road | 2026-11-10 20:00 | 291 | 447 | 66 | |',
    '| Govt Primary School No. 4 | 2026-11-09 08:00 | 104 | 184 | 27 | |',
    '| Govt Primary School No. 4 | 2026-11-09 14:00 | 88 | 158 | 22 | |',
    '| Govt Primary School No. 4 | 2026-11-09 20:00 | 118 | 207 | 30 | |',
    '| Govt Primary School No. 4 | 2026-11-10 08:00 | 121 | 214 | 31 | |',
    '| Govt Primary School No. 4 | 2026-11-10 14:00 | 102 | 181 | 26 | |',
    '| Govt Primary School No. 4 | 2026-11-10 20:00 | 137 | 240 | 34 | road digging outside gate |',
    '| Lakeview Housing Society Gate | 2026-11-09 08:00 | 70 | 128 | 19 | |',
    '| Lakeview Housing Society Gate | 2026-11-09 14:00 | 56 | 101 | 15 | |',
    '| Lakeview Housing Society Gate | 2026-11-09 20:00 | 77 | 139 | 21 | |',
    '| Lakeview Housing Society Gate | 2026-11-10 08:00 | 73 | 133 | 20 | |',
    '| Lakeview Housing Society Gate | 2026-11-10 14:00 | 59 | 107 | 16 | |',
    '| Lakeview Housing Society Gate | 2026-11-10 20:00 | 80 | 145 | 22 | |',
    '| Riverside Park | 2026-11-09 08:00 | 44 | 80 | 12 | sensor replaced |',
    '| Riverside Park | 2026-11-09 14:00 | 36 | 66 | 10 | |',
    '| Riverside Park | 2026-11-09 20:00 | 49 | 89 | 13 | |',
    '| Riverside Park | 2026-11-10 08:00 | 47 | 85 | 12 | |',
    '| Riverside Park | 2026-11-10 14:00 | 39 | 71 | 11 | |',
    '| Riverside Park | 2026-11-10 20:00 | 53 | 95 | 14 | |'
  ].join('\n');

  var notes = [
    'Field notes, Ward 14, 12 Nov 2026 (handheld monitor)',
    'Reached Shivaji Nagar Junction around 8 in the morning, PM2.5 was showing 162 and PM10 about 280.',
    'By 2pm the junction had come down to 120 (PM2.5).',
    'Industrial Estate Road 9am - PM2.5 244, PM10 410. Evening 7pm reading there was 301!!',
    'School No. 4 gate at 8:30am: 126 PM2.5. Meter battery died in the afternoon so no second reading.',
    'Lakeview Society gate 10am PM2.5 74, 6pm 88.',
    'Riverside Park 11am - 48.'
  ].join('\n');

  var samples = {
    week1: { raw: week1, previousRaw: '', place: 'Ward 14' },
    week2: { raw: week2, previousRaw: week1, place: 'Ward 14' },
    notes: { raw: notes, previousRaw: '', place: 'Ward 14' }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = samples;
  else root.SAMPLES = samples;
})(typeof self !== 'undefined' ? self : this);
