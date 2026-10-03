(function (root, factory) {
    const api = factory(typeof module === 'object' && module.exports ? require('./organization-repository.js') : root.OrganizationRepository);
    if (typeof module === 'object' && module.exports)
        module.exports = api;
    root.TagService = api;
})(globalThis, function (Organization) {
    'use strict';
    function createService(options) {
        const r = Organization.createRepository({ ...options,
            kind: 'tag' });
        return {
            listTags: r.list,
            createTag: r.create,
            renameTag: r.rename,
            deleteTag: r.remove,
            addConversationRefs: r.addRefs,
            removeConversationRefs: r.removeRefs,
            listConversationRefs: r.refs,
            listTagIdsForConversation: r.membershipsFor,
            snapshot: r.snapshot
        };
    }
    return { createService };
});
