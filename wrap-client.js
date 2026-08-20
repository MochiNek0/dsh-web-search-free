const fs = require('fs');
const path = require('path');

const clientJsPath = path.join(__dirname, 'dist', 'client.js');
let code = fs.readFileSync(clientJsPath, 'utf8');

// If already wrapped, do nothing
if (code.includes('window.__ModuleLoader__.load')) {
  console.log('Already wrapped');
  process.exit(0);
}

// Convert require to use the wrapper's require
const wrappedCode = `window.__ModuleLoader__.load({
  id: "dsh-plugin-web-search-free",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    
${code}

    return module.exports;
  }
});`;

fs.writeFileSync(clientJsPath, wrappedCode, 'utf8');
console.log('Successfully wrapped dist/client.js');
