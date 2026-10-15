export const CATEGORIES = [
  { id: 'models', label: 'โมเดล AI' },
  { id: 'research', label: 'งานวิจัย' },
  { id: 'tools', label: 'เครื่องมือ AI' },
  { id: 'coding', label: 'AI เขียนโค้ด' },
  { id: 'business', label: 'ธุรกิจ AI' },
  { id: 'policy', label: 'นโยบายและความปลอดภัย' },
  { id: 'robotics', label: 'หุ่นยนต์' },
  { id: 'hardware', label: 'ชิปและฮาร์ดแวร์' },
  { id: 'creative', label: 'AI สร้างสรรค์' },
  { id: 'thailand', label: 'AI ในไทย' },
];

// Keep the AI anchor separate from the category alternatives: without the
// parentheses, broad terms such as business or policy can admit general news.
const aiAnchors = {
  th: '(AI OR "ปัญญาประดิษฐ์")',
  en: '(AI OR "artificial intelligence")',
};
const thaiTopics = {
  models: '(โมเดล OR LLM OR GPT OR Claude OR Gemini)',
  research: '(วิจัย OR นักวิจัย OR benchmark OR "machine learning")',
  tools: '(เครื่องมือ OR ผู้ช่วย OR แชตบอต OR chatbot OR agent)',
  coding: '(เขียนโค้ด OR โปรแกรมเมอร์ OR นักพัฒนา OR coding OR Copilot OR Cursor)',
  business: '(ธุรกิจ OR สตาร์ทอัพ OR ลงทุน OR ระดมทุน OR องค์กร)',
  policy: '(นโยบาย OR กฎหมาย OR กำกับดูแล OR ความปลอดภัย OR จริยธรรม OR ลิขสิทธิ์)',
  robotics: '(หุ่นยนต์ OR ฮิวแมนนอยด์ OR robotics OR humanoid)',
  hardware: '(ชิป OR GPU OR เซมิคอนดักเตอร์ OR ดาต้าเซ็นเตอร์ OR "data center")',
  creative: '(สร้างภาพ OR สร้างวิดีโอ OR สร้างเพลง OR ออกแบบ OR ครีเอทีฟ)',
  thailand: '(ไทย OR ประเทศไทย)',
};
const englishTopics = {
  models: '(model OR models OR LLM OR GPT OR Claude OR Gemini)',
  research: '(research OR researchers OR benchmark OR "machine learning")',
  tools: '(tools OR assistant OR chatbot OR agent)',
  coding: '(coding OR programming OR developer OR Copilot OR Cursor)',
  business: '(business OR startup OR funding OR investment OR enterprise)',
  policy: '(regulation OR policy OR law OR safety OR ethics OR copyright)',
  robotics: '(robot OR robotics OR humanoid OR autonomous)',
  hardware: '(chip OR chips OR GPU OR semiconductor OR "data center")',
  creative: '(image OR video OR music OR creative OR design)',
  thailand: '(Thailand OR Thai)',
};

export function getFeeds(language = 'th') {
  const edition = language === 'en' ? 'en' : 'th';
  const topics = edition === 'th' ? thaiTopics : englishTopics;
  return CATEGORIES.map(({ id, label }) => {
    const url = new URL('https://news.google.com/rss/search');
    url.searchParams.set('hl', edition === 'th' ? 'th' : 'en-US');
    url.searchParams.set('gl', edition === 'th' ? 'TH' : 'US');
    url.searchParams.set('ceid', edition === 'th' ? 'TH:th' : 'US:en');
    // Whitespace between the two groups is an AND in Google News search.
    url.searchParams.set('q', `${aiAnchors[edition]} ${topics[id]} when:7d`);
    return {
      id: `google-${id}`, name: `Google News · ${edition === 'th' ? label : id}`,
      url: url.href, category: id, language: edition,
    };
  });
}

export const FEEDS = getFeeds();
export const ALLOWED_FEED_HOSTS = new Set(['news.google.com']);
export const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
