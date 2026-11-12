'use strict';
/**
 * Called by Azure Static Web Apps at sign-in (staticwebapp.config.json
 * "rolesSource"). Returns the custom roles for the signed-in user.
 */
const { rolesFor } = require('../lib/auth');

async function roles(req) {
  const b = await req.json();
  return { body: { roles: rolesFor(b.userDetails, b.claims) } };
}

module.exports = [{ name: 'roles', methods: ['POST'], route: 'roles', auth: 'public', handler: roles }];
