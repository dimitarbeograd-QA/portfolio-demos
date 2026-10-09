/* RSVP: валидация и форма */
const RSVP = (() => {
  const MAX_NAME = 80;
  const MAX_NOTE = 300;

  function validate(input, maxSeats) {
    const errors = {};
    const name = String(input.name || '').trim();
    if (name.length < 2) errors.name = 'Моля, въведете име (поне 2 символа).';
    else if (name.length > MAX_NAME) errors.name = 'Името е твърде дълго (до ' + MAX_NAME + ' символа).';

    if (input.attending !== 'yes' && input.attending !== 'no') {
      errors.attending = 'Моля, изберете отговор.';
    }

    if (input.attending === 'yes') {
      const raw = String(input.guests == null ? '' : input.guests).trim();
      const n = Number(raw);
      if (!/^\d+$/.test(raw) || n < 1) errors.guests = 'Въведете цял брой души (поне 1).';
      else if (n > maxSeats) errors.guests = 'За тази покана са предвидени най-много ' + maxSeats + ' души.';
    }

    if (String(input.note || '').length > MAX_NOTE) {
      errors.note = 'Бележката е твърде дълга (до ' + MAX_NOTE + ' символа).';
    }
    return errors;
  }

  function init(opts) {
    const $ = id => document.getElementById(id);
    const form = $('rsvp-form');
    const maxSeats = opts.maxSeats;
    const guestCode = opts.guestCode || null;
    const submitBtn = $('rsvp-submit');
    const status = $('rsvp-status');
    const fields = { name: 'f-name', guests: 'f-guests', note: 'f-note' };

    if (opts.defaultName) form.elements.name.value = opts.defaultName;
    form.elements.guests.max = String(maxSeats);

    Array.from(form.querySelectorAll('input[name="attending"]')).forEach(r => {
      r.addEventListener('change', () => {
        $('guests-field').hidden = form.elements.attending.value !== 'yes';
      });
    });

    function clearErrors() {
      ['name', 'attending', 'guests', 'note'].forEach(k => {
        const e = $('error-' + k);
        e.textContent = '';
        e.hidden = true;
      });
      Object.keys(fields).forEach(k => $(fields[k]).removeAttribute('aria-invalid'));
      status.hidden = true;
      status.className = 'status';
    }

    function setStatus(text, isError) {
      status.textContent = text;
      status.className = 'status' + (isError ? ' err' : '');
      status.hidden = false;
    }

    function showThanks(attending, guests) {
      form.hidden = true;
      const box = $('rsvp-thanks');
      box.textContent = attending === 'yes'
        ? 'Благодарим! Отбелязахме, че ще присъствате (' + guests + ' души). До скоро!'
        : 'Благодарим, че ни отговорихте. Ще ни липсвате!';
      box.hidden = false;
    }

    form.addEventListener('submit', async e => {
      e.preventDefault();
      clearErrors();

      const input = {
        name: form.elements.name.value,
        attending: form.elements.attending.value,
        guests: form.elements.guests.value,
        note: form.elements.note.value
      };

      // honeypot: ботът попълва скритото поле -> тихо "успех", нищо не се записва
      if (form.elements.website.value) { showThanks(input.attending || 'no', 1); return; }

      const errors = validate(input, maxSeats);
      const keys = Object.keys(errors);
      if (keys.length) {
        keys.forEach(k => {
          const e2 = $('error-' + k);
          e2.textContent = errors[k];
          e2.hidden = false;
          if (fields[k]) $(fields[k]).setAttribute('aria-invalid', 'true');
        });
        const first = keys[0];
        const target = first === 'attending' ? form.querySelector('input[name="attending"]') : $(fields[first]);
        if (target) target.focus();
        return;
      }

      const record = {
        guest_code: guestCode,
        name: input.name.trim(),
        attending: input.attending,
        guests: input.attending === 'yes' ? Number(input.guests) : 0,
        note: input.note.trim() || null
      };

      submitBtn.disabled = true;
      setStatus('Изпращане…', false);
      try {
        const result = await RSVPStore.saveRsvp(record);
        if (result.ok) {
          showThanks(record.attending, record.guests);
        } else if (result.reason === 'duplicate') {
          setStatus('Вече имаме отговор за тази покана. Ако трябва да го промените, свържете се с младоженците.', true);
        } else {
          setStatus('Нещо се обърка. Моля, опитайте отново.', true);
        }
      } finally {
        submitBtn.disabled = false;
      }
    });
  }

  return { validate, init, MAX_NAME, MAX_NOTE };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = RSVP;
