'use strict';
const { uid, addMonths, daysBetween, todayStr } = require('./util');

/**
 * Build a completion record. The expiration date is stamped at completion
 * time from the module's setting, so changing a module later does not
 * rewrite history.
 */
function mkCompletion(module, empId, rosterId, sessionCode, date, score) {
  const pass = +module.pass || 0;
  const passed = !pass || (score != null && score >= pass);
  return {
    id: 'c_' + uid(),
    empId,
    moduleId: module.id,
    moduleName: module.name,
    rosterId: rosterId || null,
    sessionCode,
    date,
    score,
    passed,
    expires: passed && +module.expires ? addMonths(date, module.expires) : null,
    hcss: passed && module.hcssCourseCode ? { courseCode: module.hcssCourseCode, status: 'queued' } : null
  };
}

function cStatus(c, today = todayStr()) {
  if (!c) return { k: 'none', label: 'Not taken' };
  if (!c.passed) return { k: 'retake', label: 'Needs retake' };
  if (!c.expires) return { k: 'ok', label: 'Complete' };
  const d = daysBetween(today, c.expires);
  if (d < 0) return { k: 'expired', label: 'Expired' };
  if (d <= 60) return { k: 'soon', label: `Expires in ${d} day${d === 1 ? '' : 's'}` };
  return { k: 'ok', label: 'Current' };
}

module.exports = { mkCompletion, cStatus };
