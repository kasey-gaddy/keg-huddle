'use strict';
const { app } = require('@azure/functions');
const routes = require('../handlers');
const { run, fromAzure, SECURITY_HEADERS } = require('../lib/http');

// Register every route from the shared table as an HTTP-triggered function.
// authLevel is anonymous because access control happens in run():
// Static Web Apps sign-in for trainers, signed tokens for employees.
for (const route of routes) {
  app.http(route.name, {
    methods: route.methods,
    route: route.route,
    authLevel: 'anonymous',
    handler: async (request, context) => {
      const res = await run(route, fromAzure(request), (m) => context.error(m));
      return { status: res.status, jsonBody: res.body, headers: SECURITY_HEADERS };
    }
  });
}
