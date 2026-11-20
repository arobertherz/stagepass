// `node --test cdn/test` treats the directory as one entry. This file loads the suite.
import './routing.test.mjs';
import './headers.test.mjs';
import './worker.test.mjs';
import './build-assets.test.mjs';
import './verify-live.test.mjs';
import './usage.test.mjs';
