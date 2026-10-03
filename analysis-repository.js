(function (root, factory) {
    const req = typeof module === 'object' && module.exports;
    const api = factory(req ? require('./manager-validation.js') : root.ManagerValidation, req ? require('./conversation-ref.js') : root.ConversationRef);
    if (req)
        module.exports = api;
    root.AnalysisRepository = api;
})(globalThis, function (V, Ref) {
    'use strict';
    const TYPES = ['similar_to', 'duplicate_of', 'supersedes', 'branch_of', 'complements'];
    const SYMMETRIC = new Set(['similar_to', 'duplicate_of', 'complements']);
    function createRepository({ store, now = () => Date.now(), idFactory = () => crypto.randomUUID() }) {
        async function putRelationship(input) {
            const type = V.choice(input.type, TYPES, 'relationship');
            Ref.decode(input.source_ref);
            Ref.decode(input.target_ref);
            if (input.source_ref === input.target_ref)
                throw V.error('self_relation', 'Self relationships are not allowed');
            let pair = [input.source_ref, input.target_ref];
            if (SYMMETRIC.has(type))
                pair.sort();
            const asserted = V.choice(input.asserted_by, ['user', 'model', 'import'], 'assertion source');
            const artifact = input.artifact_id == null ? null : V.id(input.artifact_id);
            if (asserted !== 'user' && !artifact)
                throw V.error('missing_artifact', 'Computed relationships require a provenance artifact');
            const row = {
                key: JSON.stringify([type, ...pair, asserted, artifact]), type,
                source_ref: pair[0],
                target_ref: pair[1],
                asserted_by: asserted,
                artifact_id: artifact,
                confidence: V.confidence(input.confidence),
                note: input.note ? V.text(input.note, 'note', 2000) : '',
                created_at: now()
            };
            return store.atomic(['relationships', 'artifacts'], 'readwrite', async (io) => {
                if (artifact && (await io.get('artifacts', artifact))?.status !== 'ready')
                    throw V.error('missing_artifact', 'Relationship artifact is not ready');
                await io.put('relationships', row);
                return row;
            });
        }
        async function createCluster(input, members) {
            const id = V.id(idFactory());
            const artifactId = V.id(input.source_artifact_id, 'source artifact');
            const list = Array.from(members || [], m => {
                Ref.decode(m.conversation_ref);
                return {
                    conversation_ref: m.conversation_ref,
                    score: V.confidence(m.score)
                };
            });
            if (!list.length)
                throw V.error('empty_cluster', 'A cluster needs members');
            if (new Set(list.map(m => m.conversation_ref)).size !== list.length)
                throw V.error('duplicate_member', 'Duplicate cluster member');
            const item = { id,
                label: V.text(input.label, 'cluster label'),
                method: V.text(input.method, 'cluster method'),
                source_artifact_id: artifactId,
                created_at: now(),
                revision: 1 };
            return store.atomic(['clusters', 'cluster_memberships', 'artifacts', 'artifact_sources'], 'readwrite', async (io) => {
                const artifact = await io.get('artifacts', artifactId);
                if (artifact?.status !== 'ready' || artifact.type !== 'cluster_report')
                    throw V.error('missing_artifact', 'A ready cluster_report artifact is required');
                const allowed = new Set((await io.all('artifact_sources', 'artifact_id', artifactId)).map(s => s.conversation_ref));
                if (list.some(m => !allowed.has(m.conversation_ref)))
                    throw V.error('missing_source', 'Cluster member is not in artifact provenance');
                await io.add('clusters', item);
                for (const m of list)
                    await io.add('cluster_memberships', {
                        key: `${id}|${m.conversation_ref}`,
                        cluster_id: id, ...m
                    });
                return item;
            });
        }
        async function removeCluster(id) {
            return store.atomic(['clusters', 'cluster_memberships'], 'readwrite', async (io) => {
                for (const row of await io.all('cluster_memberships', 'cluster_id', V.id(id)))
                    await io.delete('cluster_memberships', row.key);
                await io.delete('clusters', id);
            });
        }
        return { putRelationship,
            listRelationships: () => store.getAll('relationships'), createCluster,
            listClusters: () => store.getAll('clusters'),
            clusterMembers: id => store.getAll('cluster_memberships', 'cluster_id', V.id(id)), removeCluster };
    }
    return { TYPES, createRepository };
});
