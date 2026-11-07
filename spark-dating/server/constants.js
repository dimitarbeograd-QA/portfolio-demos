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
const GOALS = { serious: 'Сериозна връзка', dating: 'Запознанства', friends: 'Приятелство', open: 'Отворен/а съм' };
const SUSPEND_DAYS = [1, 3, 7, 30];
const GENDERS = ['male', 'female', 'other'];
const LOOKING = ['male', 'female', 'any'];
const MIN_AGE = 18;
const MAX_PHOTOS = 6;

module.exports = { GOALS, SUSPEND_DAYS, REPORT_REASONS, INTERESTS, GENDERS, LOOKING, MIN_AGE, MAX_PHOTOS };
