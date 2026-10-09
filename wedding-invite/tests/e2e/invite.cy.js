import { setNow } from './helpers';

describe('Покана', () => {
  it('показва имената, датата и програмата', () => {
    setNow('2026-10-09T13:00:00Z');
    cy.visit('/');
    cy.get('[data-testid=couple-names]').should('have.text', 'Мария и Георги');
    cy.get('[data-testid=wedding-date]').should('contain.text', '2027');
    cy.get('[data-testid=program-list] li').should('have.length', 5);
    cy.get('[data-testid=venue-name]').should('not.be.empty');
  });

  it('отброяването е точно за фиксирана дата', () => {
    setNow('2026-10-09T13:00:00Z');
    cy.visit('/');
    cy.get('#cd-days').should('have.text', '246');
    cy.get('#cd-hours').should('have.text', '00');
  });

  it('в деня след началото показва "Денят настъпи"', () => {
    setNow('2027-06-13T10:00:00Z');
    cy.visit('/');
    cy.get('[data-testid=countdown-done]').should('be.visible');
    cy.get('[data-testid=countdown]').should('not.be.visible');
  });

  it('показва заместителя, когато няма снимка на младоженците', () => {
    cy.visit('/');
    cy.get('[data-testid=couple-photo]').should('have.attr', 'src').and('include', 'couple-placeholder');
  });

  it('персонален линк показва поздрав', () => {
    cy.visit('/?g=fam-ivanovi');
    cy.get('[data-testid=greeting]').should('be.visible').and('contain.text', 'Иванови');
  });

  it('непознат код не показва поздрав', () => {
    cy.visit('/?g=nqma-takuv');
    cy.get('[data-testid=greeting]').should('not.be.visible');
  });

  it('бутонът "Упътване" отваря карта в нов раздел', () => {
    cy.visit('/');
    cy.get('[data-testid=directions]')
      .should('have.attr', 'href').and('include', 'google.com/maps')
      .then(() => {
        cy.get('[data-testid=directions]').should('have.attr', 'target', '_blank').and('have.attr', 'rel').and('include', 'noopener');
      });
  });

  it('преди сватбата няма линк към галерията', () => {
    setNow('2027-06-01T10:00:00Z');
    cy.visit('/');
    cy.get('[data-testid=gallery-link]').should('be.visible').and('have.class', 'soon');
    cy.get('[data-testid=gallery-note]').should('contain.text', 'След сватбата');
  });

  it('в деня на сватбата се появява линк към галерията (с кода на госта)', () => {
    setNow('2027-06-12T14:00:00Z');
    cy.visit('/?g=petar');
    cy.get('[data-testid=gallery-link]').should('be.visible').and('have.attr', 'href', 'gallery.html?g=petar');
  });
});
