'use strict';
const { CosmosClient } = require('@azure/cosmos');
const { DefaultAzureCredential } = require('@azure/identity');
const { ConflictError, PreconditionError } = require('../util');

/**
 * Cosmos DB (NoSQL API) document store.
 *
 * In Azure this signs in with the Function App's managed identity
 * (DefaultAzureCredential). No account keys are stored anywhere.
 * COSMOS_KEY is only honored for the local Cosmos emulator.
 */
class CosmosStore {
  constructor() {
    const endpoint = process.env.COSMOS_ENDPOINT;
    if (!endpoint) throw new Error('COSMOS_ENDPOINT is not set');
    const key = process.env.COSMOS_KEY;
    const client = key
      ? new CosmosClient({ endpoint, key })
      : new CosmosClient({ endpoint, aadCredentials: new DefaultAzureCredential() });
    this.c = client.database(process.env.COSMOS_DATABASE || 'huddle').container(process.env.COSMOS_CONTAINER || 'items');
  }
  strip(r) {
    if (!r) return null;
    const { _rid, _self, _attachments, _ts, ...rest } = r; // eslint-disable-line no-unused-vars
    return rest;
  }
  async get(pk, id) {
    try {
      const r = await this.c.item(id, pk).read();
      if (r.statusCode === 404 || !r.resource) return null;
      return this.strip(r.resource);
    } catch (e) {
      if (e.code === 404) return null;
      throw e;
    }
  }
  async create(doc) {
    try { const { resource } = await this.c.items.create(doc); return this.strip(resource); }
    catch (e) { if (e.code === 409) throw new ConflictError(); throw e; }
  }
  async upsert(doc) { const { resource } = await this.c.items.upsert(doc); return this.strip(resource); }
  async replace(doc, etag) {
    try {
      const { resource } = await this.c.item(doc.id, doc.pk).replace(doc, { accessCondition: { type: 'IfMatch', condition: etag } });
      return this.strip(resource);
    } catch (e) { if (e.code === 412) throw new PreconditionError(); throw e; }
  }
  async list(pk) {
    const { resources } = await this.c.items
      .query({ query: 'SELECT * FROM c WHERE c.pk = @pk', parameters: [{ name: '@pk', value: pk }] }, { partitionKey: pk })
      .fetchAll();
    return resources.map((r) => this.strip(r));
  }
  async remove(pk, id) {
    try { await this.c.item(id, pk).delete(); } catch (e) { if (e.code !== 404) throw e; }
  }
}

module.exports = { CosmosStore };
