'use strict';

// Temporary compatibility patch for whatsapp-web.js < a release containing
// https://github.com/wwebjs/whatsapp-web.js/issues/201922.
// WhatsApp Web's MediaData.__x_id can overwrite the new outgoing message ID,
// which makes every document/media send fail while plain text still succeeds.

const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'node_modules', 'whatsapp-web.js', 'src', 'util', 'Injected', 'Utils.js');
const marker = '        delete message.__x_id; // wa-bot media-ID compatibility patch';
const anchor = '        };\n\n        // Bot\'s won\'t reply if canonicalUrl is set (linking)';

if (!fs.existsSync(target)) {
  console.warn('[patch] whatsapp-web.js is not installed; nothing to patch.');
  process.exit(0);
}

const source = fs.readFileSync(target, 'utf8');
if (source.includes(marker)) {
  console.log('[patch] whatsapp-web.js media fix already present.');
  process.exit(0);
}
if (!source.includes(anchor)) {
  console.warn('[patch] whatsapp-web.js layout changed; skipped compatibility patch.');
  process.exit(0);
}

fs.writeFileSync(target, source.replace(anchor, `        };\n\n${marker}\n\n        // Bot's won't reply if canonicalUrl is set (linking)`), 'utf8');
console.log('[patch] Applied whatsapp-web.js media-send compatibility fix.');
