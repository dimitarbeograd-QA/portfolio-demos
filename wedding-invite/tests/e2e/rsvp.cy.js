import { RSVP_KEY } from './helpers';

const stored = win => JSON.parse(win.localStorage.getItem(RSVP_KEY) || '[]');

describe('RSVP форма', () => {
  beforeEach(() => {
    cy.visit('/');
  });

  it('празна форма показва грешки', () => {
    cy.get('[data-testid=rsvp-submit]').click();
    cy.get('[data-testid=error-name]').should('be.visible');
    cy.get('[data-testid=error-attending]').should('be.visible');
    cy.window().then(win => expect(stored(win)).to.have.length(0));
  });

  it('име с 1 символ е грешка', () => {
    cy.get('[data-testid=input-name]').type('И');
    cy.get('[data-testid=attending-no]').check();
    cy.get('[data-testid=rsvp-submit]').click();
    cy.get('[data-testid=error-name]').should('be.visible');
  });

  it('полето за брой души се показва само при "ще присъствам"', () => {
    cy.get('[data-testid=input-guests]').should('not.be.visible');
    cy.get('[data-testid=attending-yes]').check();
    cy.get('[data-testid=input-guests]').should('be.visible');
    cy.get('[data-testid=attending-no]').check();
    cy.get('[data-testid=input-guests]').should('not.be.visible');
  });

  it('брой над позволения за поканата е грешка', () => {
    cy.visit('/?g=petar'); // Петър има 1 място
    cy.get('[data-testid=attending-yes]').check();
    cy.get('[data-testid=input-guests]').clear().type('2');
    cy.get('[data-testid=rsvp-submit]').click();
    cy.get('[data-testid=error-guests]').should('be.visible').and('contain.text', '1');
  });

  it('брой 0 и дробно число са грешка', () => {
    cy.get('[data-testid=input-name]').type('Иван Петров');
    cy.get('[data-testid=attending-yes]').check();
    cy.get('[data-testid=input-guests]').clear().type('0');
    cy.get('[data-testid=rsvp-submit]').click();
    cy.get('[data-testid=error-guests]').should('be.visible');
  });

  it('бележка над 300 символа е грешка', () => {
    cy.get('[data-testid=input-name]').type('Иван Петров');
    cy.get('[data-testid=attending-no]').check();
    cy.get('[data-testid=input-note]').invoke('val', 'x'.repeat(301));
    cy.get('[data-testid=rsvp-submit]').click();
    cy.get('[data-testid=error-note]').should('be.visible');
  });

  it('успешен отговор "ще присъствам"', () => {
    cy.get('[data-testid=input-name]').type('Иван Петров');
    cy.get('[data-testid=attending-yes]').check();
    cy.get('[data-testid=input-guests]').clear().type('2');
    cy.get('[data-testid=input-note]').type('Без глутен');
    cy.get('[data-testid=rsvp-submit]').click();

    cy.get('[data-testid=rsvp-thanks]').should('be.visible').and('contain.text', '2');
    cy.get('[data-testid=rsvp-form]').should('not.be.visible');
    cy.window().then(win => {
      const rows = stored(win);
      expect(rows).to.have.length(1);
      expect(rows[0]).to.include({ name: 'Иван Петров', attending: 'yes', guests: 2, note: 'Без глутен' });
    });
  });

  it('успешен отговор "няма да мога" записва 0 души', () => {
    cy.get('[data-testid=input-name]').type('Мария Георгиева');
    cy.get('[data-testid=attending-no]').check();
    cy.get('[data-testid=rsvp-submit]').click();
    cy.get('[data-testid=rsvp-thanks]').should('be.visible');
    cy.window().then(win => expect(stored(win)[0]).to.include({ attending: 'no', guests: 0 }));
  });

  it('втори отговор със същия код на покана се отказва', () => {
    cy.visit('/?g=fam-ivanovi');
    cy.get('[data-testid=attending-yes]').check();
    cy.get('[data-testid=input-guests]').clear().type('3');
    cy.get('[data-testid=rsvp-submit]').click();
    cy.get('[data-testid=rsvp-thanks]').should('be.visible');

    cy.visit('/?g=fam-ivanovi');
    cy.get('[data-testid=attending-no]').check();
    cy.get('[data-testid=rsvp-submit]').click();
    cy.get('[data-testid=rsvp-status]').should('be.visible').and('contain.text', 'Вече имаме отговор');
    cy.window().then(win => expect(stored(win)).to.have.length(1));
  });

  it('кирилица, тирета и специални символи се запазват точно', () => {
    const name = 'Ивайло Петров-Иванов (младоженеца)';
    const note = 'Алергия: ядки & мляко <b>важно</b>';
    cy.get('[data-testid=input-name]').type(name);
    cy.get('[data-testid=attending-no]').check();
    cy.get('[data-testid=input-note]').type(note, { parseSpecialCharSequences: false });
    cy.get('[data-testid=rsvp-submit]').click();
    cy.window().then(win => expect(stored(win)[0]).to.include({ name, note }));
  });

  it('скритото поле срещу ботове блокира записа', () => {
    cy.get('[data-testid=input-name]').type('Бот Ботов');
    cy.get('[data-testid=attending-no]').check();
    cy.get('input[name=website]').invoke('val', 'http://spam.example');
    cy.get('[data-testid=rsvp-submit]').click();
    cy.window().then(win => expect(stored(win)).to.have.length(0));
  });
});
