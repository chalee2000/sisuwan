# WORLD BRIEF

แดชบอร์ดข่าวรอบโลกสไตล์หนังสือพิมพ์ รองรับภาษาไทยและอังกฤษ พร้อม 17 หมวดข่าว การค้นหา บุ๊กมาร์ก และการติดตั้งเป็น PWA บนมือถือ

A responsive Thai/English news dashboard with seventeen categories, search, saved articles, and an installable PWA shell.

## เริ่มต้น / Run

Use Node.js 22.12+ (Node.js 24 recommended).

```sh
npm ci
npm run dev
```

Open the Vite URL printed in the terminal (normally `http://localhost:5173`). Vite forwards `/api` requests to the Node server at `http://localhost:3001`. For the production build:

```sh
npm run build
npm start
```

Open `http://localhost:3001`. `PORT` changes the production server port. Build before starting the production server so it can serve `dist/`. For production PWA installation and service workers, host the app on HTTPS; browsers also permit localhost during development.

```sh
npm test
```

Tests cover RSS parsing and sanitization, unsafe XML and links, bounded requests, cache behavior and stale status, deduplication, and separate Thai/English API data.

## แหล่งข่าวและการอัปเดต / Sources and updates

The server fetches Google News RSS in the selected language and BBC RSS in the original English. Thai and English use independent in-memory caches. Categories include world, politics, business, technology, science, health, sports, entertainment, lifestyle, climate, Thailand, education, travel, food, automotive, real estate, and agriculture.

The server refreshes automatically every **5 minutes** while the process runs. The first request can report `loading: true` while the initial feeds load. The API includes the last successful refresh time and each feed's status. Cached articles survive a temporary feed failure and are explicitly marked stale; a server restart clears this memory cache.

Manual refresh retries the configured sources, with a **30-second cooldown per language** to prevent repeated upstream requests. The request waits up to one second, then returns the cache with `loading: true` if collection is still running. The interface can poll the news endpoint until collection completes.

Headlines, excerpts, original publication dates, and publisher attribution come from RSS. Some feeds provide no usable excerpt. Google News links can redirect to the original publisher. The interface language and preferred Google News edition follow the language menu; the app **does not translate publisher articles**. BBC articles retain their English-language label.

เมื่อเข้าถึงแหล่งข่าวไม่ได้ หน้าจอจะแสดงสถานะที่เกิดขึ้นจริง และอาจแสดง **เนื้อหาตัวอย่างที่มีป้ายกำกับชัดเจน** เพื่อสาธิตการจัดวาง ตัวอย่างเหล่านี้ไม่ใช่ข่าวสดหรือข่าวที่ตรวจสอบแล้ว API จะไม่สร้างข่าวทดแทนเอง

If feeds are unavailable, the interface reports that condition and can show explicitly labelled illustrative content to demonstrate the layout. Illustrations are not live or verified news. The API never manufactures replacement stories. The service worker caches the application shell and local assets, **not API responses or live news**; opening the shell offline does not imply fresh news is available.

## เครือข่าย / Network configuration

No API key or account is needed for the configured public RSS feeds. The Node process requires HTTPS access to:

- `news.google.com`
- `feeds.bbci.co.uk`

In a managed cloud environment, add these domains to the environment's outbound allowlist and save/apply the settings. A configuration draft alone does not enable connectivity. The server respects the environment's `HTTPS_PROXY`, `HTTP_PROXY`, `NO_PROXY`, and configured TLS CA trust. Do not disable certificate verification. Where a custom CA is required, configure `NODE_EXTRA_CA_CERTS` before starting Node. Article images, when provided by a publisher, load in the user's browser from that publisher's image host. The configured BBC feeds currently use `ichef.bbci.co.uk`; allow this domain for browser images. When an image is missing or unavailable, the app uses a category illustration.

Feeds have timeouts, a 2 MiB response limit, bounded concurrency, and an explicit HTTPS hostname allowlist. User searches do not alter server fetch destinations. Bookmarks and the chosen language are stored in the browser; there is no user account or cross-device sync.

## API

- `GET /api/health`: server availability and current news status.
- `GET /api/news?lang=th`: cached stories and refresh/source status. `lang` supports `th` and `en`; optional `category` and `search` filter the results.
- `GET /api/sources?lang=th`: configured feeds, category definitions, availability, and last successful fetch timestamps.
- `POST /api/refresh?lang=th`: refresh the selected language's fixed feed list. Returns the news snapshot plus `refreshAccepted` and `retryAfterMs`. HTTP 202 means refresh is still running; HTTP 200 means complete or cooldown. No API key is required.

Supported category IDs: `world`, `politics`, `business`, `technology`, `science`, `health`, `sports`, `entertainment`, `lifestyle`, `climate`, `thailand`, `education`, `travel`, `food`, `automotive`, `realestate`, `agriculture`. Use `all` or omit `category` for the combined feed.

`status` is `live` when every configured feed is healthy, `partial` when some stories are available despite feed failures, and `unavailable` when there are no cached stories. `loading` indicates a refresh in progress. Article `language` is the source language; `categories` preserves all category memberships for stories shared across feeds. Missing RSS timestamps are returned as `publishedAt: null`.

## ตรวจสอบหน้าแอพ / Browser verification

With the production server running, `python scripts/smoke.py` exercises language switching, all category filters, search, saved stories, preferences, keyboard dialogs, refresh behavior, responsive layouts, and service-worker offline reading. This optional development check requires the Python `playwright` package and Chromium at `/usr/bin/chromium`; set `CHROMIUM_PATH` and `SMOKE_URL` to override. It uses clearly separate mocked fixtures for failure cases and real HTTP requests for the installed PWA check. Screenshots and the report are written to the ignored `playwright-results/` directory. Run `python scripts/refresh-smoke.py` to verify the five-minute refresh timer, pause control, and manual-refresh polling with a simulated browser clock.

## นำไปใช้งาน / Deployment

Deploy the complete Node application, not only the `dist/` folder: the RSS API needs the server. Run `npm ci`, `npm run build`, then `npm start` on a Node-capable host, and route HTTPS to the configured `PORT` (default 3001). The process must stay running for automatic refresh. No account, database, or API key is required. The app is a PWA that can be installed from a supported browser; it is not an App Store or Play Store package.

## เปิดให้ทุกคนใช้งานผ่าน Render

เตรียมการตั้งค่าไว้ใน `render.yaml` แล้ว โดยใช้ Web Service แผน Free และ Node.js 24:

1. เปิด [หน้าติดตั้งบน Render](https://render.com/deploy?repo=https://github.com/chalee2000/sisuwan) แล้วเข้าสู่ระบบหรือสมัครบัญชี
2. เชื่อมต่อ GitHub หากระบบร้องขอ แล้วเลือก repository `chalee2000/sisuwan`
3. ตรวจสอบว่าแผนบริการเป็น **Free** แล้วกดสร้าง/Deploy Blueprint ตามหน้าจอ
4. รอให้สถานะเป็น **Live** จากนั้นคัดลอก URL HTTPS ที่ Render แสดงเพื่อส่งให้ทุกคน

ผู้เข้าชมเปิดผ่านลิงก์ได้เลยโดยไม่ต้องติดตั้ง Node.js บนเครื่องตนเอง ไม่ต้องเปิดคอมพิวเตอร์ของผู้สร้างค้างไว้ URL จริงจะได้รับหลังสร้างบริการสำเร็จ

Render จะติดตั้ง dependencies, build หน้าเว็บ และรัน API ภายในบริการเดียวกัน แอพใช้พอร์ตที่โฮสต์กำหนดโดยอัตโนมัติ ไม่ต้องเพิ่มฐานข้อมูลหรือ API key

แผน Free อาจพักบริการเมื่อไม่มีผู้ใช้งาน ทำให้การเปิดครั้งแรกต้องรอเริ่มระบบ และข่าวจะไม่อัปเดตระหว่างที่บริการพัก หากต้องการอัปเดตตลอดเวลา ให้เลือกแผนที่รันต่อเนื่องหลังตรวจสอบราคาและเงื่อนไขของ Render เอง ไฟล์นี้เลือก Free ไว้และไม่ได้สั่งซื้อบริการแบบเสียเงิน

การเพิ่ม `render.yaml` เป็นเพียงการเตรียมติดตั้ง แอพยังไม่เผยแพร่จนกว่าจะสร้างบริการในบัญชี Render สำเร็จ
