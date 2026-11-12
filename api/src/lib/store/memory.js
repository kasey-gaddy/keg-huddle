'use strict';
const { ConflictError, PreconditionError, clone } = require('../util');

/**
 * In-memory document store. Used for local development and tests only.
 * Same contract as CosmosStore: documents have { id, pk, ... } and an _etag.
 */
class MemoryStore {
  constructor() { this.parts = new Map(); this.n = 0; }
  _p(pk) { if (!this.parts.has(pk)) this.parts.set(pk, new Map()); return this.parts.get(pk); }
  _tag() { return 'm' + (++this.n); }
  async get(pk, id) { const d = this._p(pk).get(id); return d ? clone(d) : null; }
  async create(doc) {
    const p = this._p(doc.pk);
    if (p.has(doc.id)) throw new ConflictError();
    const d = { ...clone(doc), _etag: this._tag() };
    p.set(doc.id, d);
    return clone(d);
  }
  async upsert(doc) { const d = { ...clone(doc), _etag: this._tag() }; this._p(doc.pk).set(doc.id, d); return clone(d); }
  async replace(doc, etag) {
    const cur = this._p(doc.pk).get(doc.id);
    if (!cur || cur._etag !== etag) throw new PreconditionError();
    return this.upsert(doc);
  }
  async list(pk) { return [...this._p(pk).values()].map(clone); }
  async remove(pk, id) { this._p(pk).delete(id); }
}

module.exports = { MemoryStore };
