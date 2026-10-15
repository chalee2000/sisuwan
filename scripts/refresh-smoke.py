"""Verify refresh behavior with a browser clock; no wall-clock five-minute wait."""
import os
from playwright.sync_api import sync_playwright, expect

base = os.environ.get('SMOKE_URL', 'http://127.0.0.1:3001')
article = {'id': 'timer-fixture', 'title': 'Refresh behavior test fixture', 'summary': 'Test data only.',
           'category': 'models', 'categories': ['models'], 'source': 'Test fixture', 'language': 'en',
           'publishedAt': None, 'imageUrl': '/art/models.svg', 'url': 'https://example.com/news'}
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'), args=['--no-sandbox'])
    context = browser.new_context(service_workers='block')
    context.add_init_script("localStorage.setItem('worldbrief.lang', JSON.stringify('en'))")
    page = context.new_page()
    page.clock.install()
    state = {'gets': 0, 'posts': 0, 'loading': False}

    def intercept(route):
        if '/api/refresh' in route.request.url:
            state['posts'] += 1
            state['loading'] = True
        else:
            state['gets'] += 1
        route.fulfill(json={'edition':'ai', 'articles': [article], 'status': 'live', 'loading': state['loading'],
                            'sources': [], 'lastUpdated': '2026-10-14T12:00:00Z', 'refreshIntervalMs': 300000})

    page.route('**/api/**', intercept)
    page.goto(base)
    expect(page.locator('.lead-story')).to_be_visible()
    initial = state['gets']
    with page.expect_response('**/api/news?lang=en'):
        page.clock.fast_forward(300100)
    assert state['gets'] > initial
    print('PASS automatic refresh requests new data after five minutes')

    page.get_by_role('checkbox').focus()
    page.keyboard.press('Space')
    expect(page.get_by_role('checkbox')).not_to_be_checked()
    stopped = state['gets']
    page.clock.fast_forward(600100)
    page.wait_for_timeout(150)
    assert state['gets'] == stopped
    print('PASS disabling auto-refresh stops periodic requests')

    page.get_by_role('button', name='Refresh news', exact=True).click()
    expect(page.get_by_role('button', name='Refresh news', exact=True)).to_be_enabled()
    assert state['posts'] == 1
    before_poll = state['gets']
    with page.expect_response('**/api/news?lang=en'):
        page.clock.fast_forward(2100)
    assert state['gets'] > before_poll
    state['loading'] = False
    with page.expect_response('**/api/news?lang=en'):
        page.clock.fast_forward(2100)
    page.wait_for_timeout(100)
    complete = state['gets']
    page.clock.fast_forward(600100)
    page.wait_for_timeout(150)
    assert state['gets'] == complete
    print('PASS manual refresh polls until complete even with auto-refresh disabled')
    context.close()
    browser.close()
