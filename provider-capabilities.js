(function attachProviderCapabilities(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports)
        module.exports = api;
    root.ProviderCapabilities = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createProviderCapabilitiesModule() {
    'use strict';
    const CHATGPT = Object.freeze({
        provider: 'chatgpt',
        status: 'implemented',
        inventory: Object.freeze({
            history: true,
            contentSearch: true
        }),
        capture: Object.freeze({
            available: false,
            adapterRequired: true
        }),
        organize: Object.freeze({
            collections: true,
            moveToProject: 'unvalidated'
        }),
        analysis: Object.freeze({
            localArchiveRequired: true
        }),
        delete: Object.freeze({
            standalone: true,
            project: true,
            custom_gpt: false,
            custom_gpt_reason: 'Deletion transport for Custom GPT conversations has not been live-validated.'
        })
    });
    const CLAUDE = Object.freeze({
        provider: 'claude',
        status: 'contract-only',
        inventory: Object.freeze({
            history: false,
            contentSearch: false
        }),
        capture: Object.freeze({
            available: false,
            adapterRequired: true
        }),
        organize: Object.freeze({
            collections: true,
            moveToProject: 'unvalidated'
        }),
        delete: Object.freeze({
            standalone: false,
            project: false,
            custom_gpt: false
        })
    });
    const PROVIDERS = Object.freeze({
        chatgpt: CHATGPT,
        claude: CLAUDE
    });
    function get(provider) {
        const key = typeof provider === 'string' ? provider.trim().toLowerCase() : '';
        return PROVIDERS[key] || null;
    }
    function requireProvider(provider) {
        const capabilities = get(provider);
        if (!capabilities)
            throw new Error(`Unsupported provider: ${provider}`);
        return capabilities;
    }
    return { PROVIDERS, get, requireProvider };
});
