// Inlines src/core.js into src/page.html and writes two builds:
//   dist/ring-band-stl-maker.html   standalone page (open in any browser; saves .stl directly)
//   dist/claude-artifact.html       body-only version for publishing as a Claude artifact
const fs = require('fs');
const path = require('path');
const src = (f) => path.join(__dirname, 'src', f);
const dist = (f) => path.join(__dirname, 'dist', f);

const core = fs.readFileSync(src('core.js'), 'utf8');
const page = fs.readFileSync(src('page.html'), 'utf8').replace('/*__CORE__*/', () => core);
const head = page.match(/<!--HEAD-->([\s\S]*?)<!--\/HEAD-->/);
if (!head) throw new Error('src/page.html is missing its <!--HEAD--> ... <!--/HEAD--> block');

const artifact = page.replace('<!--HEAD-->', '').replace('<!--/HEAD-->', '').trim() + '\n';
const body = page.replace(head[0], '').trim();
const standalone = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${head[1].trim()}
</head>
<body>
${body}
</body>
</html>
`;

fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.writeFileSync(dist('ring-band-stl-maker.html'), standalone);
fs.writeFileSync(dist('claude-artifact.html'), artifact);
console.log(`dist/ring-band-stl-maker.html  ${standalone.length} bytes`);
console.log(`dist/claude-artifact.html      ${artifact.length} bytes`);
