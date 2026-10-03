(function (root, factory) {
    const req = typeof module === 'object' && module.exports;
    const api = factory(req ? require('./manager-validation.js') : root.ManagerValidation, req ? require('./conversation-ref.js') : root.ConversationRef, req ? require('./archive-freshness.js') : root.ArchiveFreshness);
    if (req)
        module.exports = api;
    root.ArtifactService = api;
})(globalThis, function (V, Ref, Fresh) {
    'use strict';
    const TYPES = Object.freeze(['summary', 'technical_summary', 'timeline', 'decision_log', 'open_questions', 'handoff', 'raw_merge', 'structured_merge', 'canonical_merge', 'synthesis', 'cluster_report', 'similarity_report', 'duplicate_report', 'superseded_report']);
    function createService({ store, now = () => Date.now(), idFactory = () => crypto.randomUUID() }) {
        const sources = id => store.getAll('artifact_sources', 'artifact_id', V.id(id));
        async function create(input) {
            const id = V.id(idFactory()), type = V.choice(input.type, TYPES, 'artifact type');
            const item = { id, type,
                title: V.text(input.title, 'artifact title'),
                status: 'draft',
                revision: 1,
                created_at: now(),
                updated_at: now(),
                producer: {
                    id: V.id(input.producer?.id, 'producer id'),
                    version: V.text(input.producer?.version, 'producer version')
                },
                config_hash: V.hash(input.config_hash, 'configuration hash'),
                payload_ref: null };
            if (!Array.isArray(input.sources) || !input.sources.length)
                throw V.error('missing_sources', 'At least one archive source is required');
            const selected = input.sources.map(source => {
                Ref.decode(source.conversation_ref);
                V.whole(source.revision, 'source revision', 1);
                return {
                    conversation_ref: source.conversation_ref,
                    revision: source.revision
                };
            });
            if (new Set(selected.map(s => `${s.conversation_ref}|${s.revision}`)).size !== selected.length)
                throw V.error('duplicate_source', 'Duplicate artifact source');
            return store.atomic(['artifacts', 'artifact_sources', 'archive_revisions'], 'readwrite', async (io) => {
                for (let ordinal = 0; ordinal < selected.length; ordinal++) {
                    const s = selected[ordinal];
                    const revision = await io.get('archive_revisions', `${s.conversation_ref}|${s.revision}`);
                    if (!revision)
                        throw V.error('missing_source', 'Archive source revision is unavailable');
                    if (revision.completeness !== 'complete' || revision.payload_state !== 'committed' || !revision.payload_ref)
                        throw V.error('incomplete_source', 'Artifact sources require complete committed captures');
                    await io.add('artifact_sources', {
                        key: `${id}|${ordinal}`,
                        artifact_id: id, ordinal, ...s,
                        content_hash: revision.content_hash,
                        normalized_hash: revision.normalized_hash,
                        normalizer_version: revision.normalizer_version,
                        scope: revision.scope,
                        branch_key: revision.branch_key
                    });
                }
                await io.add('artifacts', item);
                return item;
            });
        }
        async function commit(id, { payload_ref, expectedRevision } = {}) {
            V.id(id);
            const payload = V.payload(payload_ref);
            return store.atomic(['artifacts', 'artifact_sources', 'archive_revisions'], 'readwrite', async (io) => {
                const old = await io.get('artifacts', id);
                if (!old)
                    throw V.error('not_found', 'Artifact not found');
                if (old.status === 'ready')
                    throw V.error('immutable_artifact', 'Ready artifacts are immutable; create a new artifact');
                const rows = await io.all('artifact_sources', 'artifact_id', id);
                if (!rows.length)
                    throw V.error('missing_sources', 'Artifact sources missing');
                for (const s of rows) {
                    const r = await io.get('archive_revisions', `${s.conversation_ref}|${s.revision}`);
                    if (!r || r.content_hash !== s.content_hash || r.normalized_hash !== s.normalized_hash || r.scope !== s.scope || r.branch_key !== s.branch_key || r.normalizer_version !== s.normalizer_version)
                        throw V.error('source_mismatch', 'Artifact source has changed or disappeared');
                }
                const item = { ...old,
                    status: 'ready',
                    revision: V.revision(old, expectedRevision),
                    payload_ref: payload,
                    updated_at: now() };
                await io.put('artifacts', item);
                return item;
            });
        }
        async function freshness(id, observations = {}) {
            return store.atomic(['artifacts', 'artifact_sources', 'archive_records', 'archive_revisions'], 'readonly', async (io) => {
                const item = await io.get('artifacts', V.id(id));
                if (!item || item.status !== 'ready')
                    return {
                        state: 'unknown',
                        reasons: ['Artifact is not ready']
                    };
                const refs = await io.all('artifact_sources', 'artifact_id', id);
                if (!refs.length)
                    return {
                        state: 'unknown',
                        reasons: ['Artifact provenance is missing']
                    };
                let state = 'current';
                const reasons = [];
                const set = (next, why) => {
                    if (next === 'stale' || state === 'current')
                        state = next;
                    reasons.push(why);
                };
                for (const source of refs) {
                    const captured = await io.get('archive_revisions', `${source.conversation_ref}|${source.revision}`);
                    const head = await io.get('archive_records', source.conversation_ref);
                    if (!captured || !head?.snapshot) {
                        set('unknown', 'Source snapshot unavailable');
                        continue;
                    }
                    if (captured.content_hash !== source.content_hash || captured.normalized_hash !== source.normalized_hash || captured.scope !== source.scope || captured.branch_key !== source.branch_key || captured.normalizer_version !== source.normalizer_version) {
                        set('unknown', 'Pinned source integrity mismatch');
                        continue;
                    }
                    const latest = head.snapshot;
                    const hashField = item.type === 'raw_merge' ? 'content_hash' : 'normalized_hash';
                    if (latest[hashField] !== source[hashField] || latest.scope !== source.scope || latest.branch_key !== source.branch_key || latest.normalizer_version !== source.normalizer_version) {
                        set('stale', 'Source content, branch or normalizer changed');
                        continue;
                    }
                    if (head.invalidated)
                        set('stale', 'Source explicitly marked changed');
                    if (Object.hasOwn(observations, source.conversation_ref)) {
                        const f = Fresh.evaluate(head, observations[source.conversation_ref]);
                        if (f.state !== 'current')
                            set(f.state === 'stale' ? 'stale' : 'unknown', f.reason);
                    }
                }
                return { state,
                    basis: 'archived_sources', reasons,
                    remote_freshness_checked: Object.keys(observations).length > 0 };
            });
        }
        return { create, commit,
            get: id => store.get('artifacts', V.id(id)),
            list: () => store.getAll('artifacts'), sources, freshness };
    }
    return { TYPES, createService };
});
