const fs = require('node:fs');
let t = fs.readFileSync('template.html', 'utf8');
for (const [tag, file] of [['CORE', 'core.js'], ['UI', 'ui.js']]) {
  if (t.indexOf('/*' + tag + '*/') < 0) throw new Error('模板里找不到占位符 /*' + tag + '*/');
  t = t.replace('/*' + tag + '*/', () => fs.readFileSync(file, 'utf8'));
}
fs.writeFileSync('index.html', t);
console.log('index.html', fs.statSync('index.html').size, 'bytes');
