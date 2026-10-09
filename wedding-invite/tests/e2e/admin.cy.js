import { RSVP_KEY } from './helpers';

const rows = [
  { guest_code: 'a', name: 'Иван Петров', attending: 'yes', guests: 3, note: 'Без глутен', created_at: '2027-01-01T10:00:00Z' },
  { guest_code: 'b', name: 'Мария Иванова', attending: 'yes', guests: 2, note: null, created_at: '2027-01-02T10:00:00Z' },
  { guest_code: 'c', name: 'Петър Стоянов', attending: 'no', guests: 0, note: null, created_at: '2027-01-03T10:00:00Z' }
];

function visitWith(data) {
  cy.visit('/admin.html', {
    onBeforeLoad(win) {
      win.localStorage.setItem(RSVP_KEY, JSON.stringify(data));
    }
  });
}

describe('Табло на младоженците', () => {
  it('в демо режим показва предупреждение', () => {
    cy.visit('/admin.html');
    cy.get('[data-testid=demo-banner]').should('be.visible');
  });

  it('обобщението смята правилно отговорите и душите', () => {
    visitWith(rows);
    cy.get('[data-testid=sum-answers]').should('have.text', '3');
    cy.get('[data-testid=sum-yes]').should('have.text', '2');
    cy.get('[data-testid=sum-persons]').should('have.text', '5');
    cy.get('[data-testid=sum-no]').should('have.text', '1');
    cy.get('[data-testid=rsvp-row]').should('have.length', 3);
  });

  it('HTML в името се показва като текст и не се изпълнява', () => {
    visitWith([{ ...rows[0], name: '<img src=x onerror="window.__xss=1">', note: '<script>window.__xss=1</script>' }]);
    cy.get('[data-testid=rsvp-row] td').first().should('have.text', '<img src=x onerror="window.__xss=1">');
    cy.get('[data-testid=rsvp-table] img').should('not.exist');
    cy.window().its('__xss').should('be.undefined');
  });

  it('може да превключва между отговори и снимки', () => {
    visitWith(rows);
    cy.get('[data-testid=tab-photos]').click();
    cy.get('[data-testid=photo-counts]').should('be.visible');
    cy.get('[data-testid=rsvp-table]').should('not.be.visible');
    cy.get('[data-testid=tab-rsvp]').click();
    cy.get('[data-testid=rsvp-table]').should('be.visible');
  });

  it('ZIP без одобрени снимки съобщава, че няма какво да се свали', () => {
    cy.visit('/admin.html');
    cy.get('[data-testid=tab-photos]').click();
    cy.get('[data-testid=download-zip]').click();
    cy.get('[data-testid=zip-status]').should('contain.text', 'Няма одобрени');
  });
});
