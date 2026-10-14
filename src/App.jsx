import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Plane, Utensils, Car, House, Sprout, ArrowDown, ArrowRight, ArrowUpRight, Bookmark, Check, ChevronDown, ChevronLeft, ChevronRight, Clock3, Download, ExternalLink, Globe2, Info, LayoutGrid, LoaderCircle, Moon, Radio, RefreshCw, Search, Settings2, Share2, SlidersHorizontal, Sun, WifiOff, X, Zap, Landmark, ChartNoAxesCombined, Cpu, Orbit, HeartPulse, Trophy, Clapperboard, Coffee, Leaf } from 'lucide-react';
import { categories, copy, demoArticles } from './content';
const categoryIcons = { BookOpen, Plane, Utensils, Car, House, Sprout, LayoutGrid, Globe2, Landmark, ChartNoAxesCombined, Cpu, Orbit, HeartPulse, Trophy, Clapperboard, Coffee, Leaf };
const key = 'worldbrief.';
function stored(name, fallback) { try { return JSON.parse(localStorage.getItem(key + name)) ?? fallback; } catch { return fallback; } }
function persist(name, value) { try { localStorage.setItem(key + name, JSON.stringify(value)); } catch { /* Storage can be unavailable in private mode. */ } }
function safeLink(url) { try { const parsed = new URL(url); return ['https:', 'http:'].includes(parsed.protocol) ? parsed.href : null; } catch { return null; } }
function when(date, lang) {
  if (!date || !Number.isFinite(new Date(date).getTime())) return copy[lang].noDate;
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(date)) / 60000));
  if (minutes < 60) return new Intl.RelativeTimeFormat(lang, { numeric: 'auto' }).format(-minutes, 'minute');
  if (minutes < 1440) return new Intl.RelativeTimeFormat(lang, { numeric: 'auto' }).format(-Math.floor(minutes / 60), 'hour');
  return new Date(date).toLocaleDateString(lang === 'th' ? 'th-TH' : 'en-GB', { day: 'numeric', month: 'short' });
}
function ArticleImage({ article, className = '' }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [article.id, article.imageUrl]);
  const source = !failed && article.imageUrl && (article.imageUrl.startsWith('/art/') || safeLink(article.imageUrl)) ? article.imageUrl : `/art/${article.category || 'world'}.svg`;
  return <img className={className} src={source} alt="" loading="lazy" onError={() => setFailed(true)} />;
}
function Modal({ children, title, close, label, wide = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    const before = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.focus();
    function handle(e) {
      if (e.key === 'Escape') close();
      if (e.key === 'Tab') {
        const elements = ref.current?.querySelectorAll('button, a[href], input, select, [tabindex="0"]');
        if (!elements?.length) return;
        const first = elements[0], last = elements[elements.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && (document.activeElement === last || document.activeElement === ref.current)) { e.preventDefault(); first.focus(); }
      }
    }
    document.addEventListener('keydown', handle);
    return () => { document.body.style.overflow = before; document.removeEventListener('keydown', handle); previous?.focus(); };
  }, [close]);
  return <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) close(); }}><section ref={ref} tabIndex={-1} className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}><button className="icon-button modal-close" onClick={close} aria-label={label}><X size={21}/></button>{children}</section></div>;
}
export default function App() {
  const [lang, setLang] = useState(() => stored('lang', 'th') === 'en' ? 'en' : 'th');
  const t = copy[lang];
  const [theme, setTheme] = useState(() => stored('theme', 'light'));
  const [category, setCategory] = useState('all');
  const [query, setQuery] = useState('');
  const [savedView, setSavedView] = useState(false);
  const [saved, setSaved] = useState(() => { const value = stored('saved', []); return Array.isArray(value) ? value.filter(a => a && typeof a.id === 'string' && typeof a.title === 'string') : []; });
  const [interests, setInterests] = useState(() => { const value = stored('interests', categories.slice(1).map(c => c.id)); return Array.isArray(value) && value.length ? value : categories.slice(1).map(c => c.id); });
  const [draftInterests, setDraftInterests] = useState(interests);
  const [auto, setAuto] = useState(() => stored('auto', true));
  const [data, setData] = useState(() => stored(`news.${lang}`, null));
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(navigator.onLine);
  const [error, setError] = useState(false);
  const [sort, setSort] = useState('latest');
  const [limit, setLimit] = useState(9);
  const [dialog, setDialog] = useState(null);
  const [toast, setToast] = useState('');
  const [installEvent, setInstallEvent] = useState(null);
  const [clock, setClock] = useState(Date.now());
  const searchRef = useRef(null);
  const requestRef = useRef(0);
  const closeDialog = useCallback(() => setDialog(null), []);
  const notify = useCallback(message => setToast(message), []);
  const fetchNews = useCallback(async (manual = false) => {
    const request = ++requestRef.current;
    setLoading(true);
    try {
      if (manual) await fetch(`/api/refresh?lang=${lang}`, { method: 'POST', signal: AbortSignal.timeout(20000) });
      const response = await fetch(`/api/news?lang=${lang}`, { signal: AbortSignal.timeout(20000), cache: 'no-store' });
      if (!response.ok) throw new Error('Unavailable');
      const value = await response.json();
      if (!Array.isArray(value.articles)) throw new Error('Invalid feed');
      if (request !== requestRef.current) return;
      const usable = value.articles.filter(a => a && typeof a.id === 'string' && typeof a.title === 'string');
      const next = { ...value, articles: usable };
      if (usable.length) { persist(`news.${lang}`, next); setData(next); }
      else setData(previous => previous?.articles?.length ? { ...previous, stale: true, sources: value.sources, loading: value.loading } : next);
      setError(value.status === 'unavailable');
      if (manual) notify(value.status === 'unavailable' ? copy[lang].refreshFailed : copy[lang].refreshDone);
    } catch {
      if (request !== requestRef.current) return;
      setError(true);
      setData(previous => previous ? { ...previous, stale: true, loading: false } : { articles: [], status: 'unavailable', sources: [] });
      if (manual) notify(copy[lang].refreshFailed);
    } finally { if (request === requestRef.current) setLoading(false); }
  }, [lang, notify]);
  useEffect(() => { setData(stored(`news.${lang}`, null)); fetchNews(); return () => { requestRef.current++; }; }, [fetchNews, lang]);
  useEffect(() => { if ((!auto && !data?.loading) || !online) return; const timer = setInterval(() => fetchNews(), data?.loading ? 2000 : 300000); return () => clearInterval(timer); }, [auto, online, fetchNews, data?.loading]);
  useEffect(() => {
    function onOnline() { setOnline(true); fetchNews(); } function onOffline() { setOnline(false); }
    window.addEventListener('online', onOnline); window.addEventListener('offline', onOffline);
    return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); };
  }, [fetchNews]);
  useEffect(() => { document.documentElement.lang = lang; persist('lang', lang); document.title = `WORLD BRIEF — ${lang === 'th' ? 'มองโลกให้กว้างขึ้น' : 'A wider perspective'}`; }, [lang]);
  useEffect(() => { document.documentElement.dataset.theme = theme; persist('theme', theme); }, [theme]);
  useEffect(() => { persist('saved', saved); }, [saved]);
  useEffect(() => { persist('auto', auto); }, [auto]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 3200); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 60000); return () => clearInterval(timer); }, []);
  useEffect(() => { const handler = e => { e.preventDefault(); setInstallEvent(e); }; window.addEventListener('beforeinstallprompt', handler); return () => window.removeEventListener('beforeinstallprompt', handler); }, []);
  useEffect(() => { const handler = e => { if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) && !dialog) { e.preventDefault(); searchRef.current?.focus(); } }; document.addEventListener('keydown', handler); return () => document.removeEventListener('keydown', handler); }, [dialog]);
  useEffect(() => { setLimit(9); }, [category, query, savedView, interests, lang]);
  const demo = !data?.articles?.length;
  const articles = useMemo(() => demo ? demoArticles(lang) : data.articles, [demo, data, lang]);
  const savedIds = useMemo(() => new Set(saved.map(a => a.id)), [saved]);
  const currentDemo = useMemo(() => demoArticles(lang), [lang]);
  const filtered = useMemo(() => {
    const pool = savedView ? saved.map(a => a.isDemo ? currentDemo.find(d => d.id === a.id) || a : a) : articles;
    return pool.filter(a => {
      const articleCategories = a.categories || [a.category];
      return (category === 'all' ? (savedView || articleCategories.some(c => interests.includes(c))) : articleCategories.includes(category)) && `${a.title} ${a.summary || ''} ${a.source || ''}`.toLocaleLowerCase().includes(query.toLocaleLowerCase().trim());
    }).sort((a, b) => sort === 'oldest' ? (Date.parse(a.publishedAt) || 0) - (Date.parse(b.publishedAt) || 0) : (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0));
  }, [articles, savedView, saved, category, query, interests, sort, currentDemo]);
  const homeView = category === 'all' && !query && !savedView;
  const featured = useMemo(() => {
    if (!homeView) return [];
    const selected = [];
    for (const preferred of ['world', 'technology', 'business']) {
      const story = filtered.find(a => (a.categories || [a.category]).includes(preferred) && !selected.some(s => s.id === a.id));
      if (story) selected.push(story);
    }
    for (const story of filtered) {
      if (selected.length >= 3) break;
      if (!selected.some(s => s.id === story.id)) selected.push(story);
    }
    return selected;
  }, [homeView, filtered]);
  const list = homeView ? filtered.filter(a => !featured.some(f => f.id === a.id)) : filtered;
  const title = savedView ? t.saved : query ? t.searchResults : category === 'all' ? t.title : categories.find(c => c.id === category)?.[lang];
  function toggleSave(article) {
    const exists = savedIds.has(article.id);
    setSaved(previous => exists ? previous.filter(a => a.id !== article.id) : [article, ...previous].slice(0, 200));
    notify(exists ? t.removedToast : t.savedToast);
  }
  function goCategory(id) { setCategory(id); setSavedView(false); setQuery(''); }
  async function share(article) {
    const url = safeLink(article.url);
    if (!url) return;
    try { if (navigator.share) await navigator.share({ title: article.title, url }); else { await navigator.clipboard.writeText(url); notify(t.copied); } }
    catch (e) { if (e.name !== 'AbortError') notify(t.shareUnavailable); }
  }
  async function install() { if (installEvent) { await installEvent.prompt(); await installEvent.userChoice; setInstallEvent(null); } else setDialog({ type: 'install' }); }
  function reset() { setCategory('all'); setQuery(''); setSavedView(false); setInterests(categories.slice(1).map(c => c.id)); persist('interests', categories.slice(1).map(c => c.id)); }
  function openPreferences() { setDraftInterests(interests); setDialog({ type: 'preferences' }); }
  const labelFor = id => categories.find(c => c.id === id)?.[lang] || t.all;
  const meta = article => <div className="article-meta"><span className={`source-dot ${article.isDemo ? 'sample-dot' : ''}`}/><span>{article.isDemo ? t.sample : article.source}</span><span className="meta-separator">·</span><span>{article.isDemo ? t.demo : when(article.publishedAt, lang)}</span>{!article.isDemo && article.language !== lang && <span className="original-tag">{article.language?.toUpperCase()}</span>}</div>;
  const bookmarkButton = article => <button className={`icon-button bookmark-button ${savedIds.has(article.id) ? 'is-saved' : ''}`} onClick={e => { e.stopPropagation(); toggleSave(article); }} aria-label={savedIds.has(article.id) ? t.unbookmark : t.bookmark} aria-pressed={savedIds.has(article.id)}><Bookmark size={18} fill={savedIds.has(article.id) ? 'currentColor' : 'none'}/></button>;
  const isInitialLoading = loading && !data;
  return <>
    <div className="utility-bar"><div className="container utility-inner"><span><Globe2 size={12}/> {t.editionLabel} <span className="utility-divider">/</span> {t.edition}</span><span className="utility-date">{new Date(clock).toLocaleDateString(lang === 'th' ? 'th-TH' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Bangkok' })}</span><span className="edition-number">EST. 2026</span></div></div>
    <header className="masthead container"><button className="brand" onClick={reset} aria-label="WORLD BRIEF home"><span className="brand-icon"><Globe2 size={30} strokeWidth={1.65}/></span><span className="brand-wordmark">WORLD<span>BRIEF<span className="brand-period">.</span></span></span></button><p className="brand-tagline">{t.tagline}</p><div className="header-actions"><button className={`icon-button saved-header ${savedView ? 'active' : ''}`} aria-label={t.showSaved} onClick={() => { setSavedView(!savedView); setCategory('all'); setQuery(''); }}><Bookmark size={20}/>{saved.length > 0 && <span className="saved-count">{saved.length}</span>}</button><button className="icon-button theme-toggle" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} aria-label={theme === 'light' ? t.dark : t.light}>{theme === 'light' ? <Moon size={20}/> : <Sun size={20}/>}</button><div className="language-switch" role="group" aria-label={t.language}><button aria-pressed={lang === 'th'} className={lang === 'th' ? 'selected' : ''} onClick={() => setLang('th')}>TH</button><span>/</span><button aria-pressed={lang === 'en'} className={lang === 'en' ? 'selected' : ''} onClick={() => setLang('en')}>EN</button></div><button className="install-button" onClick={install}><Download size={15}/><span>{t.install}</span></button></div></header>
    <div className="navigation-wrap"><nav className="container navigation" aria-label={t.filter}>{categories.map(c => { const Icon = categoryIcons[c.icon]; return <button key={c.id} onClick={() => goCategory(c.id)} className={category === c.id && !savedView ? 'nav-item active' : 'nav-item'} aria-current={category === c.id && !savedView ? 'page' : undefined}>{c.id === 'all' && <Icon size={16}/>}<span>{c[lang]}</span></button>; })}</nav></div>
    <main className="container main-content">
      <section className="page-heading"><div><div className="eyebrow"><span className="orange-line"/>{t.today}</div><h1>{title}<span className="title-period">.</span></h1><p>{savedView ? t.savedOffline : t.subtitle}</p></div><div className="heading-tools"><label className="search-field"><Search size={18}/><input ref={searchRef} value={query} onChange={e => setQuery(e.target.value)} placeholder={t.search} aria-label={t.search}/>{query ? <button className="clear-search" onClick={() => setQuery('')} aria-label={t.clearSearch}><X size={15}/></button> : <kbd>/</kbd>}</label><div className="refresh-row"><label className="auto-label"><input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)}/><span className="toggle-track"/><span>{t.auto}</span></label><span className="refresh-divider"/><span className="update-time">{data?.lastUpdated ? `${t.updated} ${new Date(data.lastUpdated).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' })}` : t.autoEvery}</span><button className="icon-button refresh-button" onClick={() => fetchNews(true)} disabled={loading} aria-label={t.refresh}><RefreshCw size={15} className={loading ? 'spin' : ''}/></button></div></div></section>
      {!online ? <div className="notice offline-notice" role="status"><WifiOff size={17}/>{t.offline}</div> : demo && !isInitialLoading ? <div className="notice demo-notice"><Info size={18}/><div><strong>{t.demoBanner}</strong><span>{t.demoInfo}</span></div><button onClick={() => fetchNews(true)} disabled={loading}>{t.retry}<ArrowUpRight size={15}/></button></div> : (data?.stale || error) && !isInitialLoading ? <div className="notice" role="status"><Clock3 size={17}/>{t.stale}</div> : data?.status === 'partial' ? <div className="partial-note"><Info size={13}/>{t.partial}<button onClick={() => setDialog({ type: 'sources' })}>{t.sources}<ArrowUpRight size={12}/></button></div> : null}
      {isInitialLoading ? <div className="initial-loading" role="status"><LoaderCircle className="spin" size={28}/><p>{t.refreshing}</p><div className="skeleton-grid"><div/><div/><div/></div></div> : <>
      {featured.length > 0 && <section className="featured-grid" aria-label={t.editors}><article className="lead-story"><ArticleImage article={featured[0]}/><div className="lead-shade"/><div className="lead-top"><span className="feature-label"><Zap size={12} fill="currentColor"/>{t.editors}</span>{bookmarkButton(featured[0])}</div><div className="lead-content"><span className="category-label">{labelFor(featured[0].category)}</span><button className="story-title-button" onClick={() => setDialog({ type: 'article', article: featured[0] })}><h2>{featured[0].title}</h2></button>{featured[0].summary && <p>{featured[0].summary}</p>}<div className="lead-bottom">{meta(featured[0])}<button className="circle-arrow" onClick={() => setDialog({ type: 'article', article: featured[0] })} aria-label={t.read}><ArrowUpRight size={23}/></button></div></div></article><div className="secondary-stories">{featured.slice(1).map(article => <article className="secondary-story" key={article.id}><button className="secondary-image" onClick={() => setDialog({ type: 'article', article })} aria-label={article.title}><ArticleImage article={article}/><span className="image-arrow"><ArrowUpRight size={17}/></span></button><div className="secondary-content"><span className="category-label">{labelFor(article.category)}</span><button className="story-title-button" onClick={() => setDialog({ type: 'article', article })}><h2>{article.title}</h2></button>{article.summary && <p>{article.summary}</p>}<div className="secondary-bottom">{meta(article)}{bookmarkButton(article)}</div></div></article>)}</div></section>}
      <div className={`content-grid ${!homeView ? 'filtered-grid' : ''}`}><section className="news-section"><div className="section-heading"><div><h2><span className="section-marker"/>{savedView ? t.saved : query ? `${t.searchResults} “${query}”` : t.latest}</h2><p>{homeView ? t.latestSub : `${filtered.length} ${t.results}`}</p></div><label className="sort-select"><select value={sort} aria-label={t.sortLatest} onChange={e => setSort(e.target.value)}><option value="latest">{t.sortLatest}</option><option value="oldest">{t.sortOldest}</option></select><ChevronDown size={14}/></label></div><div className="news-chips">{[categories[0], ...categories.filter(c => ['world','business','technology','climate'].includes(c.id))].map(c => <button key={c.id} className={category === c.id ? 'selected' : ''} onClick={() => { setCategory(c.id); }}><span>{c.id === 'all' ? t.all : c[lang]}</span></button>)}<button className="chip-settings" onClick={openPreferences} aria-label={t.settings}><SlidersHorizontal size={15}/></button></div>
      {list.length === 0 ? <div className="empty-state">{savedView ? <Bookmark size={38} strokeWidth={1.25}/> : <Search size={38} strokeWidth={1.25}/>}<h3>{savedView && !saved.length ? t.savedEmpty : t.noResults}</h3><p>{savedView && !saved.length ? t.savedEmptySub : t.noResultsSub}</p><button className="outline-button" onClick={reset}>{t.seeAll}<ArrowRight size={16}/></button></div> : <><div className="news-grid">{list.slice(0, limit).map(article => <article key={article.id} className="news-card"><button className="card-image" onClick={() => setDialog({ type: 'article', article })} aria-label={article.title}><ArticleImage article={article}/><span className="card-image-label">{labelFor(article.category)}</span><span className="image-arrow"><ArrowUpRight size={17}/></span></button><div className="card-text"><div className="card-kicker"><span className="category-label">{labelFor(article.category)}</span>{bookmarkButton(article)}</div><button className="story-title-button" onClick={() => setDialog({ type: 'article', article })}><h3>{article.title}</h3></button>{article.summary && <p>{article.summary}</p>}{meta(article)}</div></article>)}</div>{list.length > limit && <button className="load-more" onClick={() => setLimit(limit + 9)}>{t.loadMore}<ArrowDown size={16}/><span>{list.length - limit}</span></button>}</>}
      </section><aside className="sidebar"><section className="timeline-panel"><div className="sidebar-heading"><h2>{t.justIn}</h2><span className={`live-pill ${demo ? 'demo-pill' : ''}`}><span/>{demo ? 'DEMO' : 'LIVE'}</span></div><p className="sidebar-subtitle">{t.justInSub}</p><div className="timeline">{articles.slice(0, 5).map((article, i) => <article key={article.id} className="timeline-item"><span className={`timeline-dot ${i === 0 ? 'first' : ''}`}/><span className="timeline-time">{article.isDemo ? `0${i + 1}` : when(article.publishedAt, lang)}</span><span className="category-label">{labelFor(article.category)}</span><button onClick={() => setDialog({ type: 'article', article })}>{article.title}</button></article>)}</div><button className="timeline-bottom" onClick={() => { reset(); document.querySelector('.news-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>{t.seeAll}<ArrowRight size={15}/></button></section><section className="personalize-panel"><div className="personalize-globe"><Globe2 size={72} strokeWidth={0.6}/><span className="globe-orbit"/></div><span className="personalize-eyebrow">CURATED BY YOU</span><h2>{t.yourWorld}</h2><p>{t.yourWorldSub}</p><button onClick={openPreferences}>{t.customize}<ArrowUpRight size={17}/></button><span className="personalize-note">{t.privacy}</span></section><button className="source-status" onClick={() => setDialog({ type: 'sources' })}><span className={`connection-dot ${demo || error ? 'is-offline' : ''}`}/><span>{t.sources}</span><ArrowUpRight size={14}/></button></aside></div>
      </>}
    </main>
    <footer className="footer container"><div className="footer-top"><div><button className="footer-logo" onClick={reset}>WORLD BRIEF<span>.</span></button><p>{t.footer}</p></div><div className="footer-links"><button onClick={() => setDialog({ type: 'sources' })}>{t.sources}</button><button onClick={openPreferences}>{t.customize}</button><button onClick={install}>{t.install}<ArrowUpRight size={13}/></button></div></div><div className="footer-bottom"><span>© {new Date(clock).getFullYear()} WORLD BRIEF</span><p>{t.footerNote}</p><span>STAY CURIOUS.</span></div></footer>
    {toast && <div className="toast" role="status"><Check size={16}/>{toast}</div>}
    {dialog?.type === 'article' && <Modal close={closeDialog} title={dialog.article.title} label={t.close} wide><ArticleImage article={dialog.article} className="article-dialog-image"/><div className="article-dialog-content"><div className="category-label">{labelFor(dialog.article.category)}</div><h2>{dialog.article.isDemo ? currentDemo.find(a => a.id === dialog.article.id)?.title : dialog.article.title}</h2>{meta(dialog.article)}{dialog.article.isDemo && <div className="article-demo-note"><Info size={16}/>{t.demoArticle}</div>}<div className="brief-heading"><span className="section-marker"/>{t.newsBrief}</div><p className="article-summary">{dialog.article.isDemo ? currentDemo.find(a => a.id === dialog.article.id)?.summary : dialog.article.summary || t.summaryMissing}</p><p className="article-disclaimer">{dialog.article.isDemo ? t.demoDetail : t.localSummary}</p><div className="article-actions"><button className={`outline-button ${savedIds.has(dialog.article.id) ? 'is-saved' : ''}`} onClick={() => toggleSave(dialog.article)}><Bookmark size={17} fill={savedIds.has(dialog.article.id) ? 'currentColor' : 'none'}/>{savedIds.has(dialog.article.id) ? t.unbookmark : t.bookmark}</button>{safeLink(dialog.article.url) && <><button className="icon-button" onClick={() => share(dialog.article)} aria-label={t.share}><Share2 size={19}/></button><a className="primary-button" href={safeLink(dialog.article.url)} target="_blank" rel="noopener noreferrer">{t.readSource}<ArrowUpRight size={16}/></a></>}</div></div></Modal>}
    {dialog?.type === 'preferences' && <Modal close={closeDialog} title={t.preferences} label={t.close}><div className="dialog-icon"><Settings2 size={26}/></div><h2>{t.preferences}</h2><p className="dialog-description">{t.preferencesSub}</p><div className="interest-grid">{categories.slice(1).map(c => { const Icon = categoryIcons[c.icon]; return <button key={c.id} className={draftInterests.includes(c.id) ? 'interest selected' : 'interest'} aria-pressed={draftInterests.includes(c.id)} onClick={() => setDraftInterests(prev => prev.includes(c.id) ? prev.filter(id => id !== c.id) : [...prev, c.id])}><Icon size={20}/>{c[lang]}{draftInterests.includes(c.id) && <Check size={14}/>}</button>; })}</div><button className="text-button" onClick={() => setDraftInterests(categories.slice(1).map(c => c.id))}>{t.allSelected}</button><button className="primary-button full-width" disabled={!draftInterests.length} onClick={() => { setInterests(draftInterests); persist('interests', draftInterests); closeDialog(); notify(t.preferencesSaved); }}>{draftInterests.length ? t.savePreferences : t.selectAtLeast}<ArrowRight size={16}/></button></Modal>}
    {dialog?.type === 'install' && <Modal close={closeDialog} title={t.installTitle} label={t.close}><div className="dialog-icon"><Download size={26}/></div><h2>{t.installTitle}</h2><p className="dialog-description">{t.installSub}</p><div className="install-instructions">{t.installInstructions}</div><button className="primary-button full-width" onClick={closeDialog}>{t.close}<Check size={17}/></button></Modal>}
    {dialog?.type === 'sources' && <Modal close={closeDialog} title={t.sources} label={t.close}><div className="dialog-icon"><Radio size={26}/></div><h2>{t.sources}</h2><p className="dialog-description">{t.sourceNote}</p><div className="source-list">{data?.sources?.length ? data.sources.map(source => <div className="source-row" key={source.id}><div><strong>{source.name}</strong><span>{labelFor(source.category)} · {source.language?.toUpperCase()}</span></div><span className={`source-state ${source.status === 'ok' ? 'ok' : ''}`}>{source.status === 'ok' ? t.statusConnected : source.status === 'pending' ? t.statusPending : t.statusError}</span></div>) : <p>{t.noSource}</p>}</div><button className="outline-button full-width" onClick={() => fetchNews(true)} disabled={loading}><RefreshCw size={16} className={loading ? 'spin' : ''}/>{t.retry}</button></Modal>}
  </>;
}
