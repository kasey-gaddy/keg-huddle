'use strict';
/** Single route table shared by Azure Functions and the local dev server. */
module.exports = [
  ...require('./employee'),
  ...require('./manage'),
  ...require('./roles')
];
