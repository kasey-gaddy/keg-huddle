'use strict';
let store = null;

/**
 * Returns the configured store. Memory storage must be asked for explicitly
 * (STORE=memory) so a missing setting in Azure fails loudly instead of
 * silently keeping data in memory.
 */
function getStore() {
  if (store) return store;
  if (process.env.STORE === 'memory') {
    const { MemoryStore } = require('./memory');
    store = new MemoryStore();
  } else {
    const { CosmosStore } = require('./cosmos');
    store = new CosmosStore();
  }
  return store;
}
function setStore(s) { store = s; }

module.exports = { getStore, setStore };
