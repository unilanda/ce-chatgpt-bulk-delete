(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports)
        module.exports = api;
    root.CaptureTabRunner = api;
})(globalThis, function () {
    'use strict';
    function createTabRunner({ browser, tokenFactory = () => crypto.randomUUID() } = {}) {
        if (!browser?.tabs)
            throw new TypeError('Browser tab adapter is required');
        const leases = new Map();
        async function acquire({ mode, ref, provider, tabId, allowFocus = false }) {
            if (!['managed_tab', 'current_tab'].includes(mode))
                throw new Error('Invalid capture tab mode');
            if (typeof provider?.conversationURL !== 'function' || typeof provider.matchesConversationURL !== 'function')
                throw new Error('Provider tab identity contract unavailable');
            const url = provider.conversationURL(ref);
            if (new URL(url).protocol !== 'https:')
                throw new Error('Capture requires an HTTPS provider URL');
            let tab;
            const owned = mode === 'managed_tab';
            if (owned)
                tab = await browser.tabs.create({ url,
                    active: allowFocus });
            else {
                if (!Number.isInteger(tabId))
                    throw new Error('Current-tab capture requires a tab ID');
                tab = await browser.tabs.get(tabId);
            }
            const lease = {
                token: tokenFactory(),
                tabId: tab.id,
                windowId: tab.windowId, ref, owned, provider, allowFocus
            };
            leases.set(lease.token, lease);
            const matches = provider.matchesConversationURL(tab.url, ref);
            const stillOpening = owned && (!tab.url || tab.url === 'about:blank') && (!tab.pendingUrl || provider.matchesConversationURL(tab.pendingUrl, ref));
            if (!matches && !stillOpening) {
                await release(lease);
                throw new Error('Capture tab no longer matches the requested conversation');
            }
            try {
                if (allowFocus) {
                    await browser.tabs.update(tab.id, {
                        active: true
                    });
                    if (browser.windows?.update)
                        await browser.windows.update(tab.windowId, {
                            focused: true
                        });
                }
                return lease;
            }
            catch (error) {
                await release(lease);
                throw error;
            }
        }
        async function assertCurrent(lease, { requiresFocus = false } = {}) {
            if (leases.get(lease.token) !== lease)
                throw new Error('Capture tab lease expired');
            const tab = await browser.tabs.get(lease.tabId);
            const currentMatches = lease.provider.matchesConversationURL(tab.url, lease.ref);
            if (tab.pendingUrl) {
                // A pending destination wins over the currently displayed URL for
                // navigation-away safety. However, a pending *matching* destination
                // is not proof that the requested conversation has finished loading:
                // waitReady() must complete and tab.url itself must match before
                // capture can proceed.
                if (!lease.provider.matchesConversationURL(tab.pendingUrl, lease.ref))
                    throw new Error('Capture tab navigated away');
                if (!currentMatches) {
                    const error = new Error('Capture tab is not ready; still navigating to the requested conversation');
                    error.code = 'tab_not_ready';
                    throw error;
                }
            }
            else if (!currentMatches)
                throw new Error('Capture tab navigated away');
            if (requiresFocus && (!tab.active || !browser.windows?.get || (await browser.windows.get(tab.windowId)).focused !== true)) {
                const error = new Error('Capture requires the active tab; focus changed');
                error.code = 'focus_lost';
                throw error;
            }
            return tab;
        }
        async function release(lease) {
            if (!lease || leases.get(lease.token) !== lease)
                return {
                    closed: false,
                    reason: 'not_owned'
                };
            leases.delete(lease.token);
            if (!lease.owned)
                return {
                    closed: false,
                    reason: 'current_tab'
                };
            try {
                const tab = await browser.tabs.get(lease.tabId);
                // Chrome exposes pendingUrl while a navigation is in flight. Treat that
                // destination as authoritative: it lets us close a newly-created tab that
                // is still loading, while preserving a tab the user has begun navigating
                // away from the captured conversation.
                const identityURL = tab.pendingUrl || tab.url;
                if (!lease.provider.matchesConversationURL(identityURL, lease.ref))
                    return {
                        closed: false,
                        reason: 'user_navigated'
                    };
                await browser.tabs.remove(lease.tabId);
                return {
                    closed: true
                };
            }
            catch (_) {
                return {
                    closed: false,
                    reason: 'tab_unavailable'
                };
            }
        }
        return { acquire, assertCurrent, release };
    }
    return { createTabRunner };
});
