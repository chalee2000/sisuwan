"""Preview-image browser regression checks against a running production server.
Network fixtures are explicit; this does not claim live publisher availability.
"""
import os
import re
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get('SMOKE_URL', 'http://127.0.0.1:3001')
ROOT = Path(__file__).resolve().parents[1]

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'), args=['--no-sandbox', '--disable-dev-shm-usage'])
    context = browser.new_context(viewport={'width': 1280, 'height': 800}, service_workers='block')
    context.add_init_script("localStorage.setItem('worldbrief.lang', JSON.stringify('en'))")
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    requests = []
    state = {'repaired': False}
    articles = [{'id': f'{index:020x}', 'title': f'AI coding image fixture {index}', 'category': 'coding',
                 'categories': ['coding'], 'language': 'en', 'source': 'Fixture publisher', 'summary': '',
                 'url': f'https://publisher.example/story/{index}', 'imageUrl': None, 'publishedAt': None}
                for index in range(1, 25)]

    def api(route):
        url = route.request.url
        if '/api/article-image/' in url:
            story_id = url.split('/api/article-image/')[1].split('?')[0]
            requests.append(story_id)
            route.fulfill(json={'imageUrl': f'https://photos.example/{story_id}.png'})
        elif '/api/refresh' in url:
            route.fulfill(json={})
        else:
            stories = [dict(article) for article in articles]
            if state['repaired']:
                stories[0]['imageUrl'] = 'https://photos.example/repaired.png'
            route.fulfill(json={'edition': 'ai', 'articles': stories, 'sources': [], 'status': 'live', 'loading': False})

    def photo(route):
        if route.request.url.endswith(f'{1:020x}.png'):
            route.fulfill(status=404)
        else:
            route.fulfill(content_type='image/png', body=(ROOT/'public/icon-192.png').read_bytes())

    page.route('**/api/**', api)
    page.route('https://photos.example/**', photo)
    page.goto(BASE)
    page.locator('nav.navigation').get_by_role('button', name='AI coding', exact=True).click()
    cards = page.locator('.news-card')
    first_image = cards.nth(0).locator('img')
    second_image = cards.nth(1).locator('img')
    expect(second_image).to_have_attribute('src', f'https://photos.example/{2:020x}.png')
    page.wait_for_function("document.querySelectorAll('.news-card img')[1].naturalWidth > 0")
    expect(second_image).to_have_attribute('referrerpolicy', 'no-referrer')
    expect(second_image).to_have_attribute('decoding', 'async')
    expect(first_image).to_have_attribute('src', re.compile(r'^/photos/.+\.webp$'))
    expect(cards.nth(0).locator('.image-illustration')).to_be_visible()
    page.wait_for_function("document.querySelector('.news-card img').naturalWidth > 0")
    assert len(requests) < len(articles), 'Offscreen/unrendered stories must not all fetch images at once'
    print('PASS visible stories resolve images lazily; broken remote image loads labelled bundled photograph', flush=True)

    before = requests.count(f'{2:020x}')
    cards.nth(1).locator('.story-title-button').click()
    expect(page.get_by_role('dialog').locator('img')).to_have_attribute('src', f'https://photos.example/{2:020x}.png')
    assert requests.count(f'{2:020x}') == before, 'Dialog must share the resolved image cache'
    page.keyboard.press('Escape')
    state['repaired'] = True
    page.get_by_role('button', name='Refresh news', exact=True).click()
    expect(first_image).to_have_attribute('src', 'https://photos.example/repaired.png')
    page.wait_for_function("document.querySelector('.news-card img').naturalWidth > 0")
    expect(cards.nth(0).locator('.image-illustration')).to_have_count(0)
    print('PASS image cache reused by dialog; updated source retries after previous failure', flush=True)
    assert not errors, errors
    context.close()

    # Reproduce the user's problem: every external thumbnail is unavailable,
    # and an old news cache still supplies SVG category artwork.
    local = browser.new_context(viewport={'width': 390, 'height': 844}, service_workers='block')
    local.add_init_script("localStorage.setItem('worldbrief.lang', JSON.stringify('en'))")
    localpage = local.new_page()
    local_articles = [dict(article, imageUrl='/art/coding.svg') for article in articles]
    for story, category in zip(local_articles, ['models', 'tools', 'research']):
        story.update(category=category, categories=[category])
    def no_external_images(route):
        if '/api/article-image/' in route.request.url:
            route.fulfill(json={'imageUrl': None})
        else:
            route.fulfill(json={'edition': 'ai', 'articles': local_articles, 'sources': [], 'status': 'live', 'loading': False})
    localpage.route('**/api/**', no_external_images)
    localpage.goto(BASE)
    expect(localpage.locator('.lead-story > img')).to_have_attribute('src', re.compile(r'^/photos/.+\.webp$'))
    localpage.wait_for_function("document.querySelector('.lead-story > img').naturalWidth === 1536")
    expect(localpage.locator('.lead-story .image-illustration-en')).to_be_visible()
    localpage.locator('.lead-story').scroll_into_view_if_needed()
    results = ROOT/'playwright-results'
    results.mkdir(exist_ok=True)
    localpage.screenshot(path=str(results/'local-photos-mobile.png'))
    localpage.get_by_role('button', name='TH', exact=True).click()
    expect(localpage.locator('.lead-story .image-illustration-th')).to_be_visible()
    assert not localpage.evaluate('document.documentElement.scrollWidth > innerWidth + 1')
    localpage.set_viewport_size({'width': 1440, 'height': 1000})
    localpage.locator('.lead-story').scroll_into_view_if_needed()
    localpage.screenshot(path=str(results/'local-photos-desktop.png'))
    print('PASS real bundled photos display on mobile and desktop when every publisher image fails; legacy artwork and bilingual labels handled', flush=True)
    local.close()
    browser.close()
