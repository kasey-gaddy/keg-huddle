'use strict';
/** Pretends to send. Used for demos and tests. Never touches HCSS. */
async function importEmployeeSkills(items) {
  return items.map((i) => ({ id: i.id, ok: true }));
}
module.exports = { importEmployeeSkills };
