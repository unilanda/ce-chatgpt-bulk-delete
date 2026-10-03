'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ConversationRef = require('../conversation-ref.js');

test('legacy ChatGPT inventory records become provider-neutral refs', () => {
  const ref = ConversationRef.fromInventoryRecord({ id: 'abc-123' });
  assert.deepEqual(ref, { provider: 'chatgpt', providerConversationId: 'abc-123' });
  assert.equal(ConversationRef.encode(ref), 'chatgpt:abc-123');
});

test('conversation refs safely round-trip provider ids containing punctuation', () => {
  const encoded = ConversationRef.encode('claude', 'a/b:c?d');
  assert.equal(encoded, 'claude:a%2Fb%3Ac%3Fd');
  assert.deepEqual(ConversationRef.decode(encoded), {
    provider: 'claude',
    providerConversationId: 'a/b:c?d'
  });
});

test('explicit provider metadata overrides legacy default', () => {
  assert.equal(ConversationRef.encodeInventoryRecord({
    id: 'legacy-key',
    provider: 'claude',
    provider_conversation_id: 'claude-id'
  }), 'claude:claude-id');
});
