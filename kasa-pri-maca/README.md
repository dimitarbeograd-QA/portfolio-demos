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

- Shared kitchen sync between devices and the photo menu import rely on the Claude artifact runtime (shared database and an AI call). On GitHub Pages those are not available, so the kitchen view works only with data on the same device, and photo import is off. The rest works as in the real app.
- The receipt is a non-fiscal slip. A real deployment needs a fiscal device and a check with an accountant.
- Fonts (Fira Sans, Lora) load from Google Fonts; without them the page falls back to system fonts.

## Stack

Vanilla HTML, CSS and JavaScript in one file, localStorage, Web Crypto (PBKDF2), WebAudio for the alert sound.

## Testing status

Checked by hand and with scripted Chromium runs (Playwright) at 360 px and 320 px for horizontal overflow, and with a fake shared database for the kitchen flow (order, ready, take, pay, timers). There are no automated tests in the repository yet.
