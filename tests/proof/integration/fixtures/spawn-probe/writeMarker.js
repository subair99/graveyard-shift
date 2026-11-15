'use strict';
// Script run by the fork probe. It writes the marker file named by argv[2].
require('node:fs').writeFileSync(process.argv[2], 'x');
