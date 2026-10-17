const images = {
  neural: '/photos/neural-computing.webp',
  developer: '/photos/developer-workspace.webp',
  robotics: '/photos/robotics-lab.webp',
  hardware: '/photos/data-center.webp',
};

const categoryImages = {
  models: ['neural'],
  research: ['robotics'],
  tools: ['developer'],
  coding: ['developer', 'neural', 'hardware'],
  business: ['developer', 'hardware', 'neural'],
  policy: ['developer', 'hardware', 'neural'],
  robotics: ['robotics', 'neural'],
  hardware: ['hardware', 'neural'],
  creative: ['developer', 'neural'],
  thailand: ['developer', 'robotics', 'neural', 'hardware'],
  technology: ['neural', 'developer', 'hardware'],
  science: ['neural', 'robotics'],
  education: ['developer', 'neural'],
  automotive: ['robotics', 'hardware'],
};

export function illustrationForArticle(article) {
  const choices = Object.hasOwn(categoryImages, article.category) ? categoryImages[article.category] : ['neural', 'developer', 'robotics', 'hardware'];
  const seed = `${article.category || ''}:${article.id || article.title || ''}`;
  let hash = 0;
  for (const character of seed) hash = (hash * 31 + character.codePointAt(0)) >>> 0;
  return images[choices[hash % choices.length]];
}
