# Kasa Pri Maca (waiter POS)

A tap-to-order point-of-sale for a Bulgarian restaurant (Гостилница „При Маца“), built as one static page for phones and tablets. Waiters take orders at the table, the cook sees them on a kitchen display, and the manager gets reports. Content is in Bulgarian.

**Live demo:** https://dimitarbeograd-qa.github.io/portfolio-demos/kasa-pri-maca/

Use one of the "Тестов вход" buttons (manager, waiter, cook) on the login screen. Test mode keeps its own separate data and needs no password. In test mode the role switcher at the top changes between the three roles in one tap.

## Features

- Tap-to-order menu with categories, pizza sizes and a running bill; 50 tables with pending orders
- Non-fiscal receipt, cash or card payment with change, manual tip kept separate from turnover, optional invoice with buyer and seller data
- Three roles: waiter, manager and cook, with device-local accounts (PBKDF2-hashed passwords)
- Kitchen display: new orders appear for the cook at once, the cook marks them ready, the waiter gets a bird-chirp alert and takes the order
- Order timers: live time in the kitchen, time waiting to be picked up, and average cooking time and pickup wait in the daily report
- Table notes and reservations (hour, number of people, note) shown on the table tile
- Manager menu editor: edit items and prices by hand, or import a menu from a photo
- Waiter reports by date, copyable as text
- Large, high-contrast type for tired staff; works at phone width (checked at 360 px and 320 px)

## Demo limits

- Sync between different devices and the photo menu import rely on the Claude artifact runtime (shared database and an AI call). On GitHub Pages or as a plain `.html` file, waiter, cook and manager still talk to each other on the same device (tabs of one browser, or the role switcher in test mode) through localStorage and BroadcastChannel. Two separate phones need a server, which this demo does not have. Photo import is off.
- The receipt is a non-fiscal slip. A real deployment needs a fiscal device and a check with an accountant.
- Fonts (Fira Sans, Lora) load from Google Fonts; without them the page falls back to system fonts.

## Stack

Vanilla HTML, CSS and JavaScript in one file, localStorage, Web Crypto (PBKDF2), WebAudio for the alert sound.

## QA documentation

- [Test plan](docs/test-plan.md)
- [Test cases](docs/test-cases.md) (29 passed, 15 not yet run)
- [Bug reports](docs/bug-reports/README.md) (9 found, all fixed)

## Testing

Automated tests use Playwright Test (15 tests in `tests/`). They run against `index.html` with an in-memory stand-in for the shared database.

```
npm install
npx playwright install chromium
npm test
```

Set `CHROMIUM_PATH` to use an already installed Chromium. The tests cover roles, the kitchen flow with timers, reservations, payment and tips, menu loading and layout at 360 px and 320 px. Sound, the real shared database between devices and photo menu import are checked by hand (see the test cases).
