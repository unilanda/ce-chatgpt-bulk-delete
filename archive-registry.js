(function (root, factory) {
    const req = typeof module === 'object' && module.exports;
    const api = factory(req ? require('./manager-validation.js') : root.ManagerValidation, req ? require('./conversation-ref.js') : root.ConversationRef, req ? require('./timestamp-utils.js') : root.TimestampUtils, req ? require('./archive-freshness.js') : root.ArchiveFreshness);
    if (req)
        module.exports = api;
    root.ArchiveRegistry = api;
})(globalThis, function (V, Ref, Time, Fresh) {
    'use strict';
    const STORE = 'archive_records', REVISIONS = 'archive_revisions';
    // Compatibility names are read-only aliases. Freshness is derived, not capture state.
    const CAPTURE_STATUSES = Object.freeze({
        NEVER: 'never_saved',
        CURRENT: 'current',
        STALE: 'stale',
        FAILED: 'failed',
        UNKNOWN: 'unknown'
    });
    function normalizeSourceTime(value) {
        return Time.toEpochMilliseconds(value);
    }
    function createRegistry({ store, now = () => Date.now() }) {
        if (!store?.atomic)
            throw new TypeError('A transactional metadata store is required');
        const get = ref => {
            Ref.decode(ref);
            return store.get(STORE, ref);
        };
        const getRevision = (ref, revision) => {
            Ref.decode(ref);
            V.whole(revision, 'revision', 1);
            return store.get(REVISIONS, `${ref}|${revision}`);
        };
        async function recordCapture(input) {
            const decoded = Ref.decode(input.conversation_ref), ref = input.conversation_ref;
            const captureId = V.id(input.capture_id, 'capture_id');
            const snapshot = {
                conversation_ref: ref,
                capture_id: captureId,
                source_updated_at_ms: normalizeSourceTime(input.source_updated_at),
                source_version: V.optionalText(input.source_version, 'source version', 500),
                content_hash: V.hash(input.content_hash),
                normalized_hash: V.hash(input.normalized_hash),
                message_count: V.whole(input.message_count, 'message count'),
                formats: [...new Set(input.formats || [])].map(f => V.choice(f, ['md', 'html', 'txt', 'json'], 'format')),
                payload_ref: V.payload(input.payload_ref),
                payload_state: 'committed',
                completeness: V.choice(input.completeness, ['complete', 'partial'], 'completeness'),
                scope: V.choice(input.scope, ['selected_branch', 'whole_tree'], 'capture scope'),
                branch_key: V.text(input.branch_key, 'branch key', 1024),
                capture_version: V.text(input.capture_version, 'capture version'),
                normalizer_version: V.text(input.normalizer_version, 'normalizer version')
            };
            return store.atomic([STORE, REVISIONS], 'readwrite', async (io) => {
                const old = await io.get(STORE, ref);
                const repeat = (await io.all(REVISIONS, 'capture_id', captureId))[0];
                if (repeat) {
                    for (const key of Object.keys(snapshot))
                        if (JSON.stringify(repeat[key]) !== JSON.stringify(snapshot[key]))
                            throw V.error('capture_conflict', 'capture_id was reused for different content');
                    return await io.get(STORE, ref);
                }
                const revision = V.revision(old, input.expected_revision);
                const at = V.whole(now(), 'capture time');
                const immutable = { ...snapshot,
                    key: `${ref}|${revision}`, revision,
                    captured_at: at };
                const head = {
                    conversation_ref: ref,
                    provider: decoded.provider,
                    provider_conversation_id: decoded.providerConversationId,
                    model_version: 2,
                    capture_state: 'captured',
                    capture_status: 'captured', revision,
                    snapshot: immutable,
                    last_captured_at: at,
                    source_updated_at: input.source_updated_at ?? null,
                    content_hash: immutable.content_hash,
                    normalized_hash: immutable.normalized_hash,
                    message_count: immutable.message_count,
                    formats: immutable.formats,
                    invalidated: false,
                    last_attempt: {
                        state: 'captured', at,
                        error_code: null
                    },
                    updated_at: at
                };
                await io.add(REVISIONS, immutable);
                await io.put(STORE, head);
                return head;
            });
        }
        async function markStale(ref, sourceUpdatedAt = null) {
            Ref.decode(ref);
            return store.atomic([STORE], 'readwrite', async (io) => {
                const old = await io.get(STORE, ref);
                if (!old)
                    return null;
                const row = { ...old,
                    invalidated: true,
                    observed_updated_at_ms: normalizeSourceTime(sourceUpdatedAt),
                    updated_at: now() };
                await io.put(STORE, row);
                return row;
            });
        }
        async function markFailed(ref, errorCode = 'capture_failed') {
            const decoded = Ref.decode(ref);
            const allowed = ['capture_failed', 'cancelled', 'payload_failed', 'metadata_failed', 'focus_lost', 'session_unavailable', 'timeout', 'capture_incomplete'];
            const code = allowed.includes(errorCode) ? errorCode : 'capture_failed';
            return store.atomic([STORE], 'readwrite', async (io) => {
                const old = await io.get(STORE, ref);
                const at = now();
                const row = { ...(old || {
                        conversation_ref: ref,
                        provider: decoded.provider,
                        provider_conversation_id: decoded.providerConversationId,
                        model_version: 2,
                        revision: 0,
                        capture_state: 'never'
                    }),
                    capture_state: old?.snapshot ? 'captured' : 'failed',
                    last_attempt: {
                        state: 'failed',
                        error_code: code, at
                    },
                    updated_at: at };
                await io.put(STORE, row);
                return row;
            });
        }
        async function evaluateFreshness(ref, sourceUpdatedAt) {
            return Fresh.evaluate(await get(ref), {
                updated_at_ms: normalizeSourceTime(sourceUpdatedAt)
            }).state;
        }
        return { get,
            list: () => store.getAll(STORE), getRevision, recordCapture, markStale, markFailed, evaluateFreshness };
    }
    return { CAPTURE_STATUSES, createRegistry, normalizeSourceTime };
});
