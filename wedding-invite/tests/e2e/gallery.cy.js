import { makeJpeg, setNow } from './helpers';

const DAY_OPEN = '2027-06-12T14:00:00Z';

describe('Галерия', () => {
  it('преди сватбата не позволява качване', () => {
    setNow('2027-06-01T10:00:00Z');
    cy.visit('/gallery.html');
    cy.get('[data-testid=gallery-state]').should('contain.text', 'ще се отвори');
    cy.get('[data-testid=upload-form]').should('not.be.visible');
  });

  it('в деня на сватбата показва формата за качване', () => {
    setNow(DAY_OPEN);
    cy.visit('/gallery.html');
    cy.get('[data-testid=upload-form]').should('be.visible');
    cy.get('[data-testid=gallery-empty]').should('be.visible');
  });

  it('празна форма показва грешки за снимка и съгласие', () => {
    setNow(DAY_OPEN);
    cy.visit('/gallery.html');
    cy.get('[data-testid=upload-submit]').click();
    cy.get('[data-testid=error-files]').should('be.visible');
    cy.get('[data-testid=error-consent]').should('be.visible');
  });

  it('качване без съгласие е блокирано', () => {
    setNow(DAY_OPEN);
    cy.visit('/gallery.html');
    cy.wrap(makeJpeg('a.jpg')).then(f => cy.get('[data-testid=upload-files]').selectFile(f));
    cy.get('[data-testid=upload-submit]').click();
    cy.get('[data-testid=error-consent]').should('be.visible');
  });

  it('файл, който не е снимка, се отказва', () => {
    setNow(DAY_OPEN);
    cy.visit('/gallery.html');
    cy.get('[data-testid=upload-files]').selectFile({
      contents: Cypress.Buffer.from('не съм снимка'),
      fileName: 'belejka.txt',
      mimeType: 'text/plain'
    });
    cy.get('[data-testid=upload-consent]').check();
    cy.get('[data-testid=upload-submit]').click();
    cy.get('[data-testid=error-files]').should('be.visible').and('contain.text', 'JPG');
  });

  it('над 10 снимки наведнъж се отказва', () => {
    setNow(DAY_OPEN);
    cy.visit('/gallery.html');
    const names = Array.from({ length: 11 }, (_, i) => 'f' + i + '.jpg');
    cy.wrap(Cypress.Promise.all(names.map(n => makeJpeg(n)))).then(files => {
      cy.get('[data-testid=upload-files]').selectFile(files);
    });
    cy.get('[data-testid=upload-consent]').check();
    cy.get('[data-testid=upload-submit]').click();
    cy.get('[data-testid=error-files]').should('be.visible').and('contain.text', '10');
  });

  it('пълен поток: качване -> одобрение в таблото -> вижда се в галерията', () => {
    setNow(DAY_OPEN);
    cy.visit('/gallery.html');
    cy.get('[data-testid=upload-name]').type('Петър');
    cy.wrap(makeJpeg('a.jpg')).then(f => cy.get('[data-testid=upload-files]').selectFile(f));
    cy.get('[data-testid=upload-consent]').check();
    cy.get('[data-testid=upload-submit]').click();
    cy.get('[data-testid=upload-status]').should('contain.text', 'одобрение');

    // още не е одобрена -> не се вижда на гостите
    cy.visit('/gallery.html');
    cy.get('[data-testid=gallery-photo]').should('not.exist');

    // младоженците одобряват
    cy.visit('/admin.html');
    cy.get('[data-testid=tab-photos]').click();
    cy.get('[data-testid=photo-card]').should('have.length', 1);
    cy.get('[data-testid=photo-status]').should('have.text', 'На изчакване');
    cy.get('[data-testid=approve-btn]').click();
    cy.get('[data-testid=photo-status]').should('have.text', 'Одобрена');

    // сега се вижда в галерията
    cy.visit('/gallery.html');
    cy.get('[data-testid=gallery-photo]').should('have.length', 1);
    cy.get('[data-testid=gallery-photo] a').should('have.attr', 'download');
  });

  it('скрита (върната) снимка изчезва от галерията', () => {
    setNow(DAY_OPEN);
    cy.visit('/gallery.html');
    cy.wrap(makeJpeg('a.jpg')).then(f => cy.get('[data-testid=upload-files]').selectFile(f));
    cy.get('[data-testid=upload-consent]').check();
    cy.get('[data-testid=upload-submit]').click();
    cy.get('[data-testid=upload-status]').should('contain.text', 'Благодарим');

    cy.visit('/admin.html');
    cy.get('[data-testid=tab-photos]').click();
    cy.get('[data-testid=approve-btn]').click();   // одобрява
    cy.get('[data-testid=photo-status]').should('have.text', 'Одобрена');
    cy.get('[data-testid=approve-btn]').should('have.text', 'Скрий').click();   // скрива
    cy.get('[data-testid=photo-status]').should('have.text', 'На изчакване');
    cy.visit('/gallery.html');
    cy.get('[data-testid=gallery-photo]').should('not.exist');
  });

  it('след срока за качване формата е скрита, но галерията се разглежда', () => {
    setNow('2027-08-01T10:00:00Z');
    cy.visit('/gallery.html');
    cy.get('[data-testid=gallery-state]').should('contain.text', 'Качването приключи');
    cy.get('[data-testid=upload-form]').should('not.be.visible');
  });

  it('след срока за съхранение галерията вече не е достъпна', () => {
    setNow('2029-01-01T10:00:00Z');
    cy.visit('/gallery.html');
    cy.get('[data-testid=gallery-state]').should('contain.text', 'не е достъпна');
    cy.get('[data-testid=gallery-grid]').should('not.be.visible');
  });
});
