(function (root, factory) {
    const req = typeof module === 'object' && module.exports;
    const api = factory(req ? require('./conversation-ref.js') : root.ConversationRef, req ? require('./timestamp-utils.js') : root.TimestampUtils);
    if (req)
        module.exports = api;
    root.ProviderAdapters = api;
})(globalThis, function (Ref, Time) {
    'use strict';
    function observation(record) {
        return {
            conversation_ref: Ref.encodeInventoryRecord(record),
            title: typeof record.title === 'string' ? record.title : 'Untitled conversation',
            created_at_ms: Time.toEpochMilliseconds(record.create_time),
            updated_at_ms: Time.toEpochMilliseconds(record.update_time),
            provider_metadata: {
                classification: record.classification || 'unknown-protected',
                gizmo_id: Object.hasOwn(record, 'gizmo_id') ? record.gizmo_id : undefined
            }
        };
    }
    function chatGPTURL(ref) {
        const value = Ref.decode(ref);
        if (value.provider !== 'chatgpt')
            throw new Error('ChatGPT adapter cannot open another provider');
        return `https://chatgpt.com/c/${encodeURIComponent(value.providerConversationId)}`;
    }
    function matchesChatGPTURL(url, ref) {
        try {
            const u = new URL(url);
            const value = Ref.decode(ref);
            return value.provider === 'chatgpt' && u.origin === 'https://chatgpt.com' && decodeURIComponent(/^\/c\/([^/]+)$/.exec(u.pathname)?.[1] || '') === value.providerConversationId;
        }
        catch (_) {
            return false;
        }
    }
    function createChatGPTAdapter({ inventory, history, search } = {}) {
        return {
            provider: 'chatgpt',
            capture: null,
            conversationURL: chatGPTURL,
            matchesConversationURL: matchesChatGPTURL,
            observe: observation, async get(ref) {
                const r = Ref.decode(ref);
                if (r.provider !== 'chatgpt')
                    throw new Error('Wrong provider');
                if (!inventory?.getConversation)
                    throw new Error('Inventory adapter not connected');
                return inventory.getConversation(r.providerConversationId);
            }, history, search
        };
    }
    return { observation, chatGPTURL, matchesChatGPTURL, createChatGPTAdapter,
        claudeContract: Object.freeze({
            provider: 'claude',
            status: 'contract-only',
            capture: null
        }) };
});
