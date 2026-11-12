'use strict';
const { app } = require('@azure/functions');
const hcss = require('../integrations/hcss');

// Every 15 minutes, send queued training completions to HCSS Skills.
// Does nothing while HCSS_MODE is "off" (the default).
app.timer('hcssOutbox', {
  schedule: '0 */15 * * * *',
  handler: async (timer, context) => {
    if (hcss.config().mode === 'off') return;
    try {
      const r = await hcss.processOutbox();
      context.log(`HCSS outbox: sent ${r.sent}, failed ${r.failed}`);
    } catch (e) {
      context.error('HCSS outbox run failed: ' + (e && e.message));
    }
  }
});
