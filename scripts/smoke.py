"""Browser smoke checks. Run a production server, then: python scripts/smoke.py.
Requires Python playwright and Chromium at CHROMIUM_PATH (default /usr/bin/chromium).
Requests are intercepted only in fixture contexts; PWA checks use the real server.
"""
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get('SMOKE_URL', 'http://127.0.0.1:3001')
RESULTS = Path(__file__).resolve().parents[1] / 'playwright-results'
RESULTS.mkdir(exist_ok=True)
REPORT = []

def passed(name):
    REPORT.append(name)
    print('PASS', name, flush=True)

def overflow(page):
    return page.evaluate('document.documentElement.scrollWidth > innerWidth + 1')

def fixture_article(id='live-en', language='en', url='https://example.com/ai/story'):
    return {'id': id, 'title': 'Verified AI model headline' if language == 'en' else 'หัวข้อข่าวโมเดล AI ที่ตรวจสอบแล้ว',
            'summary': 'Publisher summary about artificial intelligence.' if language == 'en' else 'บทสรุปจากผู้เผยแพร่เกี่ยวกับโมเดล AI',
            'category':'models', 'categories':['models'], 'source':'Test publisher', 'language':language,
            'publishedAt':'2026-10-13T10:00:00Z', 'url':url, 'imageUrl':'/art/models.svg'}

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'), args=['--no-sandbox','--disable-dev-shm-usage'])
    context = browser.new_context(viewport={'width':1440, 'height':1000}, service_workers='block')
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda err: errors.append(str(err)))
    state = {'mode':'demo', 'refresh':0}
    def handle(route):
        url = route.request.url
        if '/api/refresh' in url:
            assert route.request.method == 'POST'
            state['refresh'] += 1
            route.fulfill(json={'status':'ok'})
            return
        if state['mode'] == 'fail':
            route.fulfill(status=503, json={'error':'Unavailable'})
            return
        lang = 'th' if 'lang=th' in url else 'en'
        articles = [] if state['mode'] == 'demo' else [fixture_article(language=lang)]
        if state['mode'] == 'unsafe':
            articles = [fixture_article(id='unsafe', url='javascript:alert(1)')]
            articles[0]['title'] = '<img src=x onerror=alert(1)> unsafe story'
        route.fulfill(json={'edition':'ai', 'articles':articles, 'status':'unavailable' if state['mode']=='demo' else 'ok', 'loading':False,
                            'stale':state['mode']=='stale', 'lastUpdated':'2026-10-13T10:00:00Z',
                            'sources':[{'id':'google-models','name':'Google News','category':'models','language':'en','status':'ok'},
                                       {'id':'test','name':'Unavailable source','category':'research','language':'en','status':'error'}]})
    page.route('**/api/**', handle)
    page.goto(BASE)
    expect(page.get_by_text('กำลังแสดงข้อมูลตัวอย่าง', exact=True)).to_be_visible()
    expect(page.locator('html')).to_have_attribute('lang', 'th')
    page.get_by_role('button', name='EN', exact=True).click()
    expect(page.locator('html')).to_have_attribute('lang', 'en')
    page.reload()
    expect(page.locator('html')).to_have_attribute('lang', 'en')
    expect(page.get_by_text('You’re exploring a demo edition', exact=True)).to_be_visible()
    passed('Thai default and persistent English switch')

    nav = page.locator('nav.navigation')
    expect(nav.get_by_role('button')).to_have_count(11)
    category_names = nav.get_by_role('button').all_text_contents()[1:]
    for category in category_names:
        nav.get_by_role('button', name=category, exact=True).click()
        expect(page.locator('h1')).to_contain_text(category)
        assert page.locator('.news-card').count() >= 1, category
        assert all(x == category for x in page.locator('.news-card .category-label').all_text_contents()), category
    passed('All 10 AI category filters contain correctly categorized stories')
    page.get_by_role('button', name='AI BRIEF home').click()
    page.keyboard.press('/')
    expect(page.get_by_role('textbox')).to_be_focused()
    search_title = page.locator('.lead-story h2').inner_text()
    page.get_by_role('textbox').fill(search_title)
    expect(page.locator('.news-card')).to_have_count(1)
    expect(page.locator('.news-card h3')).to_have_text(search_title)
    page.get_by_role('textbox').fill('xyz-does-not-exist')
    expect(page.get_by_role('heading', name='No stories found')).to_be_visible()
    page.get_by_role('button', name='Clear search').click()
    passed('Search shortcut, title search, empty results, clear search')

    first = page.locator('.lead-story .story-title-button')
    original_title = first.inner_text()
    first.click()
    expect(page.get_by_role('dialog')).to_be_visible()
    assert page.evaluate('document.activeElement.getAttribute("role")') == 'dialog'
    page.keyboard.press('Shift+Tab')
    assert page.evaluate('document.activeElement.closest("[role=dialog]") !== null')
    page.keyboard.press('Tab')
    expect(page.get_by_role('button', name='Close', exact=True)).to_be_focused()
    page.keyboard.press('Escape')
    expect(page.get_by_role('dialog')).to_have_count(0)
    expect(first).to_be_focused()
    page.locator('.lead-story').get_by_role('button', name='Save story', exact=True).click()
    page.get_by_role('button', name='Open saved stories').click()
    expect(page.locator('.news-card')).to_have_count(1)
    expect(page.locator('.news-card h3')).to_have_text(original_title)
    page.reload()
    page.get_by_role('button', name='Open saved stories').click()
    expect(page.locator('.news-card')).to_have_count(1)
    page.get_by_role('button', name='TH', exact=True).click()
    expect(page.locator('.news-card h3')).not_to_have_text(original_title)
    expect(page.locator('.news-card')).to_have_count(1)
    page.get_by_role('button', name='EN', exact=True).click()
    passed('Article modal focus trapping/Escape restoration and persistent bilingual saved stories')

    page.get_by_role('button', name='AI BRIEF home').click()
    page.get_by_role('button', name='Interest preferences').click()
    expect(page.locator('.interest')).to_have_count(10)
    for button in page.locator('.interest').all():
        button.click()
    expect(page.get_by_role('button', name='Choose at least one topic')).to_be_disabled()
    selected_category = page.locator('.interest').nth(1).inner_text()
    page.locator('.interest').nth(1).click()
    page.get_by_role('button', name='Save interests', exact=True).click()
    expect(page.locator('.lead-content .category-label')).to_have_text(selected_category)
    page.reload()
    expect(page.locator('.lead-content .category-label')).to_have_text(selected_category)
    page.get_by_role('button', name='AI BRIEF home').click()
    passed('Interest selection validation, filtering, and persistence')

    page.get_by_role('button', name='Refresh news', exact=True).click()
    expect(page.get_by_role('button', name='Refresh news', exact=True)).to_be_enabled()
    assert state['refresh'] == 1
    page.locator('.source-status').click()
    expect(page.locator('.source-row')).to_have_count(2)
    expect(page.locator('.source-state.ok')).to_have_text('Connected')
    expect(page.get_by_text('Unavailable', exact=True)).to_be_visible()
    page.keyboard.press('Escape')
    page.locator('.install-button').click()
    expect(page.get_by_role('dialog')).to_contain_text('Add to Home Screen')
    page.keyboard.press('Escape')
    page.get_by_role('checkbox').focus()
    page.keyboard.press('Space')
    page.reload()
    expect(page.get_by_role('checkbox')).not_to_be_checked()
    passed('Refresh POST, source connection statuses, install instructions, auto-refresh preference')

    page.get_by_role('button', name='Switch to dark mode').click()
    page.reload()
    expect(page.locator('html')).to_have_attribute('data-theme','dark')
    page.screenshot(path=str(RESULTS/'desktop-dark.png'), full_page=True)
    page.get_by_role('button', name='Switch to light mode').click()
    page.screenshot(path=str(RESULTS/'desktop-demo-en.png'), full_page=True)
    for width in [320,375,390,768,1024,1440]:
        page.set_viewport_size({'width':width,'height':900})
        assert not overflow(page), f'Overflow at {width}px'
        if width == 390:
            page.get_by_role('button', name='TH', exact=True).click()
            page.screenshot(path=str(RESULTS/'mobile-demo-th.png'), full_page=True)
            page.locator('.lead-story .story-title-button').click()
            assert not overflow(page), 'Modal mobile overflow'
            page.keyboard.press('Escape')
            page.get_by_role('button', name='EN', exact=True).click()
    passed('Persistent dark mode and no horizontal overflow at 320–1440px')
    page.set_viewport_size({'width':1440,'height':1000})

    state['mode'] = 'live'
    page.reload()
    expect(page.locator('.lead-story h2')).to_have_text('Verified AI model headline')
    expect(page.locator('.demo-notice')).to_have_count(0)
    page.locator('.lead-story .story-title-button').click()
    source_link = page.get_by_role('link', name='Read original story')
    expect(source_link).to_have_attribute('href','https://example.com/ai/story')
    expect(source_link).to_have_attribute('target','_blank')
    expect(source_link).to_have_attribute('rel','noopener noreferrer')
    page.keyboard.press('Escape')
    page.get_by_role('button', name='TH', exact=True).click()
    expect(page.locator('.lead-story h2')).to_have_text('หัวข้อข่าวโมเดล AI ที่ตรวจสอบแล้ว')
    page.get_by_role('textbox').fill('โมเดล')
    expect(page.locator('.news-card')).to_have_count(1)
    page.get_by_role('button', name='EN', exact=True).click()
    expect(page.get_by_role('heading', name='No stories found')).to_be_visible()
    page.get_by_role('button', name='Clear search').click()
    state['mode'] = 'stale'
    page.reload()
    expect(page.get_by_text('Showing cached stories · We’ll try refreshing automatically')).to_be_visible()
    state['mode'] = 'fail'
    page.reload()
    expect(page.locator('.lead-story h2')).to_have_text('Verified AI model headline')
    expect(page.get_by_text('Showing cached stories · We’ll try refreshing automatically')).to_be_visible()
    state['mode'] = 'demo'
    page.reload()
    expect(page.locator('.lead-story h2')).to_have_text('Verified AI model headline')
    expect(page.get_by_text('Showing cached stories · We’ll try refreshing automatically')).to_be_visible()
    state['mode'] = 'unsafe'
    page.reload()
    page.locator('.lead-story .story-title-button').click()
    expect(page.get_by_role('dialog')).to_contain_text('<img src=x onerror=alert(1)> unsafe story')
    expect(page.get_by_role('link', name='Read original story')).to_have_count(0)
    assert not errors, errors
    passed('Mock live/stale/error/empty states, safe source URLs/text, language-sensitive search')
    context.close()

    # Preserve bookmarks/preferences while isolating old general-news caches.
    migrated = browser.new_context(service_workers='block')
    legacy = {'id': 'demo-0', 'title': 'Legacy saved world story', 'summary': 'Original saved summary.',
              'category': 'world', 'source': 'Legacy publisher', 'language': 'en', 'isDemo': True,
              'imageUrl': '/art/world.svg', 'publishedAt': None, 'url': None}
    migrated.add_init_script(script='''const old = %s;
      localStorage.setItem('worldbrief.lang', JSON.stringify('en'));
      localStorage.setItem('worldbrief.theme', JSON.stringify('dark'));
      localStorage.setItem('worldbrief.interests', JSON.stringify(['sports', 'travel']));
      localStorage.setItem('worldbrief.news.en', JSON.stringify({articles:[old], status:'live'}));
      localStorage.setItem('worldbrief.saved', JSON.stringify([old]));''' % json.dumps(legacy))
    migrated_page = migrated.new_page()
    migrated_page.route('**/api/**', lambda route: route.fulfill(json={'edition':'ai', 'articles':[], 'sources':[], 'status':'unavailable', 'loading':False}))
    migrated_page.goto(BASE)
    expect(migrated_page.locator('html')).to_have_attribute('lang','en')
    expect(migrated_page.locator('html')).to_have_attribute('data-theme','dark')
    expect(migrated_page.locator('.lead-story')).to_be_visible()
    expect(migrated_page.get_by_text('Legacy saved world story', exact=True)).to_have_count(0)
    expect(migrated_page.locator('.demo-notice')).to_be_visible()
    migrated_page.get_by_role('button', name='Open saved stories').click()
    expect(migrated_page.locator('.news-card h3')).to_have_text('Legacy saved world story')
    migrated_page.locator('.news-card .story-title-button').click()
    expect(migrated_page.get_by_role('dialog')).to_contain_text('Legacy saved world story')
    expect(migrated_page.get_by_role('dialog')).to_contain_text('Original saved summary.')
    migrated_page.keyboard.press('Escape')
    migrated_page.get_by_role('button', name='AI BRIEF home').click()
    # Ignore an old API version during a rolling server deployment too.
    migrated_page.unroute('**/api/**')
    migrated_page.route('**/api/**', lambda route: route.fulfill(json={'articles':[legacy], 'sources':[], 'status':'live', 'loading':False}))
    migrated_page.reload()
    expect(migrated_page.get_by_text('Legacy saved world story', exact=True)).to_have_count(0)
    expect(migrated_page.locator('.demo-notice')).to_be_visible()
    migrated.close()
    passed('AI edition migration preserves bookmarks, language and theme; excludes old feed cache and legacy API')

    # Real production API + actual service worker, without request interception.
    real = browser.new_context(viewport={'width':1440,'height':1000})
    realpage = real.new_page()
    realpage.goto(BASE)
    realpage.wait_for_selector('.story-title-button', timeout=30000)
    realpage.evaluate('navigator.serviceWorker.ready')
    realpage.wait_for_function('navigator.serviceWorker.controller !== null')
    realpage.locator('.lead-story').get_by_role('button', name='บันทึกข่าว', exact=True).click()
    real_title = realpage.locator('.lead-story h2').inner_text()
    realpage.screenshot(path=str(RESULTS/'desktop-live-th.png'), full_page=True)
    cache_urls = realpage.evaluate('''async () => { const keys = await caches.keys(); return (await Promise.all(keys.map(async key => (await (await caches.open(key)).keys()).map(r=>r.url)))).flat(); }''')
    assert any('/assets/' in url and '.js' in url for url in cache_urls), cache_urls
    assert all('/api/' not in url for url in cache_urls)
    real.set_offline(True)
    realpage.reload(wait_until='domcontentloaded')
    expect(realpage.get_by_text('คุณกำลังออฟไลน์ · แสดงข้อมูลที่เก็บไว้ในอุปกรณ์')).to_be_visible()
    realpage.get_by_role('button', name='เปิดข่าวที่บันทึก').click()
    expect(realpage.locator('.news-card')).to_have_count(1)
    expect(realpage.locator('.news-card h3')).to_have_text(real_title)
    realpage.locator('.news-card .story-title-button').click()
    expect(realpage.get_by_role('dialog')).to_contain_text(real_title)
    realpage.screenshot(path=str(RESULTS/'offline-saved-article.png'), full_page=True)
    passed('Real API production load, actual PWA shell cache, offline reload and saved article reading')
    real.close()
    browser.close()

(RESULTS/'smoke-report.json').write_text(json.dumps({'passed':REPORT}, ensure_ascii=False, indent=2))
print(f'{len(REPORT)} test groups passed. Screenshots: {RESULTS}', flush=True)
