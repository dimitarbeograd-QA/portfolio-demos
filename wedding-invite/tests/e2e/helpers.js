// Прави истински JPEG в браузъра на теста (без файлове във фикстури)
export function makeJpeg(name = 'foto.jpg') {
  return new Cypress.Promise(resolve => {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 48;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#6b8f71';
    ctx.fillRect(0, 0, 64, 48);
    c.toBlob(blob => {
      blob.arrayBuffer().then(buf => {
        resolve({ contents: Cypress.Buffer.from(buf), fileName: name, mimeType: 'image/jpeg' });
      });
    }, 'image/jpeg');
  });
}

// Фиксира само часовника (Date), таймерите си остават истински
export function setNow(iso) {
  cy.clock(new Date(iso).getTime(), ['Date']);
}

export const RSVP_KEY = 'wedding-invite-demo-rsvps';
export const PHOTOS_KEY = 'wedding-invite-demo-photos';
