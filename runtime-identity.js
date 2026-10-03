(function attachRuntimeIdentity(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.RuntimeIdentity = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createRuntimeIdentity() {
  'use strict';

  const IDENTITY = Object.freeze({
    product: 'ChatGPT Manager',
    build_label: 'manager-backbone-v3',
    source_marker: 'cm-runtime-20261002-mb3',
    job_schema_version: 1
  });

  function formatMarker() {
    return `${IDENTITY.product} · ${IDENTITY.build_label} · ` +
      `${IDENTITY.source_marker} · job schema ${IDENTITY.job_schema_version}`;
  }

  return { IDENTITY, formatMarker };
});
