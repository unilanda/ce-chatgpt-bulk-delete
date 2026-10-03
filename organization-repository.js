(function (root, factory) {
    const api = factory(typeof module === 'object' && module.exports ? require('./manager-validation.js') : root.ManagerValidation, typeof module === 'object' && module.exports ? require('./conversation-ref.js') : root.ConversationRef);
    if (typeof module === 'object' && module.exports)
        module.exports = api;
    root.OrganizationRepository = api;
})(globalThis, function (V, Ref) {
    'use strict';
    function normalizeName(name) {
        return V.text(name, 'Name', 120).normalize('NFKC').replace(/\s+/g, ' ');
    }
    function createRepository({ store, kind, now = () => Date.now(), idFactory = () => crypto.randomUUID() }) {
        V.choice(kind, ['collection', 'tag'], 'organization kind');
        if (!store?.atomic)
            throw new TypeError('A transactional metadata store is required');
        const entities = kind === 'collection' ? 'collections' : 'tags';
        const memberships = kind === 'collection' ? 'collection_memberships' : 'tag_memberships';
        const field = `${kind}_id`;
        const normalizeRefs = refs => [...new Set(Array.from(refs || [], ref => {
                Ref.decode(ref);
                return ref;
            }))];
        async function existing(io, id, expected) {
            const item = await io.get(entities, V.id(id));
            if (!item)
                throw V.error('not_found', `${kind} not found`);
            V.revision(item, expected);
            return item;
        }
        async function unique(io, nameKey, except) {
            const matches = await io.all(entities, 'name_key', nameKey);
            if (matches.some(row => row.id !== except))
                throw V.error('duplicate_name', `A ${kind} with this name already exists`);
        }
        async function addMembers(io, parent, refs, timestamp) {
            let added = 0;
            for (const ref of refs) {
                const key = `${parent.id}|${ref}`;
                if (!await io.get(memberships, key)) {
                    await io.put(memberships, { key,
                        [field]: parent.id,
                        conversation_ref: ref,
                        added_at: timestamp });
                    added++;
                }
            }
            return added;
        }
        async function create(name, { description = '', refs = [] } = {}) {
            const normalized = normalizeName(name), name_key = normalized.toLowerCase(), id = V.id(idFactory()), timestamp = V.whole(now());
            const uniqueRefs = normalizeRefs(refs);
            const parent = { id,
                name: normalized, name_key,
                description: description ? V.text(description, 'Description', 2000) : '',
                revision: 1,
                created_at: timestamp,
                updated_at: timestamp };
            return store.atomic([entities, memberships], 'readwrite', async (io) => {
                await unique(io, name_key);
                await io.add(entities, parent);
                await addMembers(io, parent, uniqueRefs, timestamp);
                return parent;
            });
        }
        async function rename(id, name, { expectedRevision } = {}) {
            const normalized = normalizeName(name);
            return store.atomic([entities], 'readwrite', async (io) => {
                const old = await existing(io, id, expectedRevision);
                await unique(io, normalized.toLowerCase(), id);
                const item = { ...old,
                    name: normalized,
                    name_key: normalized.toLowerCase(),
                    updated_at: now(),
                    revision: V.revision(old, expectedRevision) };
                await io.put(entities, item);
                return item;
            });
        }
        async function remove(id, { expectedRevision } = {}) {
            return store.atomic([entities, memberships], 'readwrite', async (io) => {
                await existing(io, id, expectedRevision);
                const members = await io.all(memberships, field, id);
                for (const row of members)
                    await io.delete(memberships, row.key);
                await io.delete(entities, id);
                return {
                    removed: members.length
                };
            });
        }
        async function addRefs(id, refs) {
            const uniqueRefs = normalizeRefs(refs);
            return store.atomic([entities, memberships], 'readwrite', async (io) => {
                const old = await existing(io, id);
                const added = await addMembers(io, old, uniqueRefs, now());
                if (added)
                    await io.put(entities, { ...old,
                        revision: V.revision(old),
                        updated_at: now() });
                return uniqueRefs.length;
            });
        }
        async function removeRefs(id, refs) {
            const uniqueRefs = normalizeRefs(refs);
            return store.atomic([entities, memberships], 'readwrite', async (io) => {
                const old = await existing(io, id);
                let removed = 0;
                for (const ref of uniqueRefs) {
                    const key = `${id}|${ref}`;
                    if (await io.get(memberships, key)) {
                        await io.delete(memberships, key);
                        removed++;
                    }
                }
                if (removed)
                    await io.put(entities, { ...old,
                        revision: V.revision(old),
                        updated_at: now() });
                return removed;
            });
        }
        async function snapshot() {
            return store.atomic([entities, memberships], 'readonly', async (io) => {
                const rows = await io.all(entities);
                const members = await io.all(memberships);
                const counts = new Map();
                for (const row of members)
                    counts.set(row[field], (counts.get(row[field]) || 0) + 1);
                return {
                    items: rows.map(row => ({ ...row,
                        count: counts.get(row.id) || 0 })).sort((a, b) => a.name.localeCompare(b.name)),
                    memberships: members
                };
            });
        }
        async function list() {
            return (await snapshot()).items;
        }
        async function refs(id) {
            V.id(id);
            return (await store.getAll(memberships, field, id)).sort((a, b) => a.added_at - b.added_at || a.conversation_ref.localeCompare(b.conversation_ref)).map(row => row.conversation_ref);
        }
        async function membershipsFor(ref) {
            Ref.decode(ref);
            return (await store.getAll(memberships, 'conversation_ref', ref)).map(row => row[field]);
        }
        return { create, rename, remove, addRefs, removeRefs, snapshot, list, refs, membershipsFor };
    }
    return { normalizeName, createRepository };
});
