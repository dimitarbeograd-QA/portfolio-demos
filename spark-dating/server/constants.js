// Общи константи – изпращат се и към клиента през /api/meta.
const INTERESTS = [
  'Пътуване', 'Музика', 'Спорт', 'Кино', 'Книги', 'Готвене', 'Планина',
  'Танци', 'Фотография', 'Технологии', 'Изкуство', 'Кучета', 'Котки',
  'Йога', 'Игри', 'Море',
];

const REPORT_REASONS = {
  harassment: 'Тормоз или обиди',
  spam: 'Спам или реклама',
  scam: 'Измама или искане на пари',
  fake: 'Фалшив профил',
  photos: 'Неподходящи снимки',
  underage: 'Изглежда непълнолетен',
  other: 'Друго',
};
const GENDERS = ['male', 'female', 'other'];
const LOOKING = ['male', 'female', 'any'];
const MIN_AGE = 18;
const MAX_PHOTOS = 6;

module.exports = { REPORT_REASONS, INTERESTS, GENDERS, LOOKING, MIN_AGE, MAX_PHOTOS };
