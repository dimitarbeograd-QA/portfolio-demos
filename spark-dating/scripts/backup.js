// Ръчно/по cron резервно копие: node scripts/backup.js  (папка: BACKUP_DIR или data/backups)
process.env.NODE_ENV = process.env.NODE_ENV === 'test' ? 'x' : process.env.NODE_ENV;
const backup = require('../server/backup');
const f = backup.snapshot('manual');
console.log(f ? 'Копие: ' + f : 'Няма копие.');
