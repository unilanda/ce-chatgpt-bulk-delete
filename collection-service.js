(function (root, factory) {
    const api = factory(typeof module === 'object' && module.exports ? require('./organization-repository.js') : root.OrganizationRepository);
    if (typeof module === 'object' && module.exports)
        module.exports = api;
    root.CollectionService = api;
})(globalThis, function (Organization) {
    'use strict';
    function createService(options) {
        const r = Organization.createRepository({ ...options,
            kind: 'collection' });
        return {
            normalizeName: Organization.normalizeName,
            listCollections: r.list,
            createCollection: r.create,
            renameCollection: r.rename,
            deleteCollection: r.remove,
            addConversationRefs: r.addRefs,
            removeConversationRefs: r.removeRefs,
            listConversationRefs: r.refs,
            listCollectionIdsForConversation: r.membershipsFor,
            snapshot: r.snapshot
        };
    }
    return {
        normalizeName: Organization.normalizeName, createService
    };
});
