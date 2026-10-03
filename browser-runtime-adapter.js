(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports)
        module.exports = api;
    root.BrowserRuntimeAdapter = api;
})(globalThis, function () {
    'use strict';
    // A narrow promise-based Chrome facade. Constructing it performs no operations.
    function createChromeAdapter(chromeImpl) {
        if (!chromeImpl?.runtime)
            throw new TypeError('Chrome runtime is required');
        const call = (group, method, ...args) => {
            if (typeof group?.[method] !== 'function')
                return Promise.reject(new Error(`Browser capability unavailable: ${method}`));
            return Promise.resolve(group[method](...args));
        };
        const permissions = new Set(chromeImpl.runtime.getManifest?.().permissions || []);
        return {
            browser: 'chrome',
            storage: {
                get: key => call(chromeImpl.storage?.local, 'get', key),
                set: value => call(chromeImpl.storage?.local, 'set', value)
            },
            alarms: {
                create: (name, options) => call(chromeImpl.alarms, 'create', name, options),
                clear: name => call(chromeImpl.alarms, 'clear', name)
            },
            tabs: {
                create: options => call(chromeImpl.tabs, 'create', options),
                get: id => call(chromeImpl.tabs, 'get', id),
                update: (id, options) => call(chromeImpl.tabs, 'update', id, options),
                remove: id => call(chromeImpl.tabs, 'remove', id),
                sendMessage: (id, message) => call(chromeImpl.tabs, 'sendMessage', id, message)
            },
            windows: {
                get: id => call(chromeImpl.windows, 'get', id),
                update: (id, options) => call(chromeImpl.windows, 'update', id, options)
            },
            downloads: {
                available: permissions.has('downloads'),
                download: options => permissions.has('downloads') ? call(chromeImpl.downloads, 'download', options) : Promise.reject(new Error('Downloads permission is not granted; export is unavailable'))
            }
        };
    }
    return { createChromeAdapter,
        firefoxContract: Object.freeze({
            browser: 'firefox',
            status: 'contract-only',
            background_model: 'event-page-adapter-required'
        }) };
});
