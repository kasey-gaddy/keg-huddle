'use strict';
/**
 * HCSS Skills API client (cloud).
 *
 * Auth: OAuth client credentials. A KE&G HCSS admin creates the client in
 * HCSS Credentials > Product Setup. The secret lives in Key Vault and
 * reaches this code as the HCSS_CLIENT_SECRET app setting (Key Vault
 * reference). It is never sent to a browser.
 *
 * Import endpoint (documented by HCSS):
 *   POST https://api.hcssapps.com/skills/api/v1/employeeSkills/import?usePayrollCode={bool}
 *   - matches the skill by course code or name
 *   - does not create employees (they must already exist in HCSS)
 *   - re-importing a skill an employee has dismisses the old one and
 *     creates a new one, which keeps history
 *
 * >>> BEFORE ENABLING LIVE MODE <<<
 * HCSS's public docs do not show the full request body. Confirm every field
 * name in toHcss() below against the OpenAPI spec in the HCSS developer
 * portal (logged in) and test against a sandbox. Then set
 * HCSS_MAPPING_VERIFIED=true. Until then live mode refuses to run.
 */
const BASE = process.env.HCSS_BASE_URL || 'https://api.hcssapps.com';

let token = null;
async function getToken() {
  if (token && token.exp > Date.now() + 60000) return token.value;
  const id = process.env.HCSS_CLIENT_ID, secret = process.env.HCSS_CLIENT_SECRET;
  if (!id || !secret) throw new Error('HCSS_CLIENT_ID and HCSS_CLIENT_SECRET must be set');
  const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secret, scope: process.env.HCSS_SCOPES || 'skills:read skills:write' });
  const r = await fetch(BASE + '/identity/connect/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
  if (!r.ok) throw new Error('HCSS token request failed: ' + r.status);
  const j = await r.json();
  token = { value: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return token.value;
}

/** ONE place to map a Huddle completion to an HCSS employee skill. VERIFY. */
function toHcss(item, cfg) {
  const who = cfg.employeeKey === 'payrollCode' ? { employeePayrollCode: item.empId } : { employeeCode: item.empId };
  return {
    ...who,
    courseCode: item.courseCode, // VERIFY field name
    dateCompleted: item.completedOn, // VERIFY field name and format
    ...(item.expiresOn ? { expirationDate: item.expiresOn } : {}) // VERIFY: HCSS may calculate this from the skill's own rule
  };
}

async function importEmployeeSkills(items, cfg) {
  const t = await getToken();
  const usePayroll = cfg.employeeKey === 'payrollCode';
  const r = await fetch(`${BASE}/skills/api/v1/employeeSkills/import?usePayrollCode=${usePayroll}`, {
    method: 'POST',
    headers: { authorization: 'Bearer ' + t, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(items.map((i) => toHcss(i, cfg)))
  });
  if (!r.ok) {
    const msg = `HCSS import failed: ${r.status} ${(await r.text()).slice(0, 200)}`;
    return items.map((i) => ({ id: i.id, ok: false, error: msg }));
  }
  return items.map((i) => ({ id: i.id, ok: true }));
}

module.exports = { importEmployeeSkills, toHcss };
