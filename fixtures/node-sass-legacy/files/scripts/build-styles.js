/* Compiles the SCSS entrypoint to dist/retro.css. */
const fs = require('fs');
const path = require('path');

// Historically this was node-sass; dart-sass exposes the same renderSync API.
let sass;
try {
  sass = require('node-sass');
} catch (err) {
  sass = require('sass');
}

const SRC = path.join(__dirname, '..', 'src', 'retro.scss');
const OUT_DIR = path.join(__dirname, '..', 'dist');
const OUT = path.join(OUT_DIR, 'retro.css');

const result = sass.renderSync({ file: SRC, outputStyle: 'expanded' });

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT, result.css);

console.log('wrote ' + OUT + ' (' + result.css.length + ' bytes)');
