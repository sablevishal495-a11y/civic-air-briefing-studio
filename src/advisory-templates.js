'use strict';

/**
 * Built-in citizen advisory text (English and Hindi), used when Gemini is not
 * available and to fill any part of a model-written advisory that is missing.
 * Wording is fixed per severity tier so it can be reviewed once by a human.
 */

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

module.exports = { buildRuleAdvisory };
