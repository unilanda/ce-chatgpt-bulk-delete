(function attachConversationRef(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports)
        module.exports = api;
    root.ConversationRef = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createConversationRefModule() {
    'use strict';
    const DEFAULT_PROVIDER = 'chatgpt';
    function normalizeProvider(provider) {
        if (typeof provider !== 'string' || provider.trim() === '') {
            throw new TypeError('provider must be a non-empty string');
        }
        const normalized = provider.trim().toLowerCase();
        if (!/^[a-z0-9][a-z0-9_-]*$/.test(normalized)) {
            throw new TypeError('provider contains unsupported characters');
        }
        return normalized;
    }
    function normalizeProviderConversationId(id) {
        if (typeof id !== 'string' || id.trim() === '') {
            throw new TypeError('provider conversation id must be a non-empty string');
        }
        if (id !== id.trim() || /[\u0000-\u001f\u007f]/.test(id) || id.length > 2048) {
            throw new TypeError('provider conversation id is invalid');
        }
        return id;
    }
    function create(provider, providerConversationId) {
        return Object.freeze({
            provider: normalizeProvider(provider),
            providerConversationId: normalizeProviderConversationId(providerConversationId)
        });
    }
    function fromInventoryRecord(record, { defaultProvider = DEFAULT_PROVIDER } = {}) {
        if (!record || typeof record !== 'object') {
            throw new TypeError('conversation record is required');
        }
        const provider = record.provider || defaultProvider;
        const providerConversationId = record.provider_conversation_id || record.id;
        return create(provider, providerConversationId);
    }
    function encode(refOrProvider, maybeId) {
        const ref = typeof refOrProvider === 'string'
            ? create(refOrProvider, maybeId)
            : create(refOrProvider?.provider, refOrProvider?.providerConversationId);
        return `${encodeURIComponent(ref.provider)}:${encodeURIComponent(ref.providerConversationId)}`;
    }
    function decode(value) {
        if (typeof value !== 'string')
            throw new TypeError('conversation ref must be a string');
        const separator = value.indexOf(':');
        if (separator <= 0 || separator === value.length - 1) {
            throw new TypeError('conversation ref is malformed');
        }
        try {
            const ref = create(decodeURIComponent(value.slice(0, separator)), decodeURIComponent(value.slice(separator + 1)));
            if (encode(ref) !== value)
                throw new TypeError('conversation ref is not canonical');
            return ref;
        }
        catch (error) {
            if (error instanceof TypeError)
                throw error;
            throw new TypeError('conversation ref is malformed');
        }
    }
    function encodeInventoryRecord(record, options) {
        return encode(fromInventoryRecord(record, options));
    }
    function isProvider(value, provider) {
        return decode(value).provider === normalizeProvider(provider);
    }
    return {
        DEFAULT_PROVIDER,
        create,
        fromInventoryRecord,
        encode,
        decode,
        encodeInventoryRecord,
        isProvider
    };
});
