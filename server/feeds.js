export const CATEGORIES = [
  { id: 'world', label: 'รอบโลก' },
  { id: 'politics', label: 'การเมือง' },
  { id: 'business', label: 'เศรษฐกิจ' },
  { id: 'technology', label: 'เทคโนโลยี' },
  { id: 'science', label: 'วิทยาศาสตร์' },
  { id: 'health', label: 'สุขภาพ' },
  { id: 'sports', label: 'กีฬา' },
  { id: 'entertainment', label: 'บันเทิง' },
  { id: 'lifestyle', label: 'ไลฟ์สไตล์' },
  { id: 'climate', label: 'สิ่งแวดล้อม' },
  { id: 'thailand', label: 'ข่าวไทย' },
  { id: 'education', label: 'การศึกษา' },
  { id: 'travel', label: 'ท่องเที่ยว' },
  { id: 'food', label: 'อาหาร' },
  { id: 'automotive', label: 'ยานยนต์' },
  { id: 'realestate', label: 'อสังหาริมทรัพย์' },
  { id: 'agriculture', label: 'เกษตร' },
];

const topics = {
  world: 'WORLD', business: 'BUSINESS', technology: 'TECHNOLOGY',
  science: 'SCIENCE', health: 'HEALTH', sports: 'SPORTS', entertainment: 'ENTERTAINMENT',
};
const thaiSearches = {
  politics: 'การเมือง ต่างประเทศ when:3d',
  lifestyle: '(ไลฟ์สไตล์ OR แฟชั่น) when:3d',
  climate: '(สิ่งแวดล้อม OR ภูมิอากาศ) when:3d',
  // The Thai edition's NATION topic is used for domestic news below.
  thailand: 'ข่าวไทย when:3d',
  education: '(การศึกษา OR มหาวิทยาลัย) when:3d',
  travel: '(ท่องเที่ยว OR การเดินทาง) when:3d',
  food: '(อาหาร OR ร้านอาหาร) when:3d',
  automotive: '(ยานยนต์ OR รถยนต์) when:3d',
  realestate: '(อสังหาริมทรัพย์ OR ตลาดที่อยู่อาศัย) when:3d',
  agriculture: '(เกษตร OR เกษตรกรรม) when:3d',
};

const englishSearches = {
  politics: 'international politics when:3d',
  lifestyle: '(lifestyle OR fashion) when:3d',
  climate: '(climate OR environment) when:3d',
  thailand: 'Thailand (news OR government OR economy OR society) when:3d',
  education: '(education OR universities) when:3d',
  travel: '(travel OR tourism) when:3d',
  food: '(food OR restaurants) when:3d',
  automotive: '(automotive OR cars) when:3d',
  realestate: '("real estate" OR "housing market") when:3d',
  agriculture: '(agriculture OR farming) when:3d',
};

function googleFeeds(language) {
  const searches = language === 'th' ? thaiSearches : englishSearches;
  return CATEGORIES.map(({ id, label }) => {
    const topic = id === 'thailand' && language === 'th' ? 'NATION' : topics[id];
    const url = topic
      ? new URL(`https://news.google.com/rss/headlines/section/topic/${topic}`)
      : new URL('https://news.google.com/rss/search');
    url.searchParams.set('hl', language === 'th' ? 'th' : 'en-US');
    url.searchParams.set('gl', language === 'th' ? 'TH' : 'US');
    url.searchParams.set('ceid', language === 'th' ? 'TH:th' : 'US:en');
    if (!topic && searches[id]) url.searchParams.set('q', searches[id]);
    return { id: `google-${id}`, name: `Google News · ${language === 'th' ? label : id}`, url: url.href, category: id, language };
  });
}

const bbcTopics = {
  world: 'news/world', politics: 'news/politics', business: 'news/business',
  technology: 'news/technology', science: 'news/science_and_environment',
  health: 'news/health', sports: 'sport', entertainment: 'news/entertainment_and_arts',
};
const bbcFeeds = Object.entries(bbcTopics).map(([category, path]) => ({
  id: `bbc-${category}`, name: 'BBC News',
  url: `https://feeds.bbci.co.uk/${path}/rss.xml`, category, language: 'en',
}));

export function getFeeds(language = 'th') { return [...googleFeeds(language), ...bbcFeeds]; }
export const FEEDS = getFeeds();
export const ALLOWED_FEED_HOSTS = new Set(FEEDS.map(feed => new URL(feed.url).hostname));
export const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
