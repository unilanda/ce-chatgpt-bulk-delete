(function (root, factory) {
    const req = typeof module === 'object' && module.exports;
    const api = factory(req ? require('./conversation-ref.js') : root.ConversationRef, req ? require('./manager-prerequisites.js') : root.ManagerPrerequisites);
    if (req)
        module.exports = api;
    root.ManagerActions = api;
})(globalThis, function (Ref, Prerequisites) {
    'use strict';
    const definitions = [
        ['collection.add', 'Add to Collection', true, 'local_metadata', []],
        ['tag.add', 'Tag', true, 'local_metadata', []],
        ['delete', 'Delete', true, 'delete_wizard', ['conversation_classification']],
        ['archive.save', 'Save / Update', false, 'capture', ['capture_adapter']],
        ['analyze.similar', 'Find similar', false, 'analysis', ['current_archives', 'analysis_engine']],
        ['analyze.cluster', 'Cluster', false, 'analysis', ['current_archives', 'analysis_engine']],
        ['analyze.duplicates', 'Find duplicates', false, 'analysis', ['current_archives', 'analysis_engine']],
        ['analyze.superseded', 'Find superseded', false, 'analysis', ['current_archives', 'analysis_engine']],
        ['summarize', 'Summarize', false, 'summary', ['current_archives', 'summary_engine']],
        ['merge.raw', 'Merge raw', false, 'merge', ['complete_archives', 'raw_exporter']],
        ['merge.structured', 'Merge structured', false, 'merge', ['current_archives', 'merge_engine']],
        ['merge.canonical', 'Merge canonical', false, 'merge', ['current_archives', 'merge_engine']],
        ['synthesize', 'Synthesis / handoff', false, 'synthesis', ['current_archives', 'synthesis_engine']],
        ['project.move', 'Move to Project', false, 'provider_mutation', ['validated_project_transport']]
    ].map(([id, label, implemented, kind, prerequisites]) => Object.freeze({ id, label, implemented, kind,
        prerequisites: Object.freeze(prerequisites) }));
    const REGISTRY = Object.freeze(Object.fromEntries(definitions.map(d => [d.id, d])));
    const REASONS = Object.freeze({
        'archive.save': 'Capture engine not connected yet. Your Save Chat code will supply it.',
        'project.move': 'Project transport not validated yet.',
        'merge.raw': 'Archive payload reader and raw exporter are not connected yet.',
        'summarize': 'Summary engine not connected yet; complete archived content will also be required.',
        'merge.structured': 'Structured merge engine not connected yet; complete archives will be required.',
        'merge.canonical': 'Canonical merge engine not connected yet; complete archives will be required.',
        'synthesize': 'Synthesis engine not connected yet; complete archives will be required.'
    });
    function evaluate(id, context = {}) {
        const definition = REGISTRY[id];
        if (!definition)
            return {
                enabled: false,
                code: 'unknown_action',
                reason: 'Unknown action'
            };
        let refs;
        try {
            refs = [...new Set(context.refs || [])];
            refs.forEach(Ref.decode);
        }
        catch (_) {
            return {
                enabled: false,
                code: 'invalid_selection',
                reason: 'Selection contains an invalid conversation reference'
            };
        }
        if (!definition.implemented)
            return {
                enabled: false,
                code: 'implementation_missing',
                reason: REASONS[id] || 'Analysis engine not connected yet; complete archived content will also be required.',
                prerequisites: definition.prerequisites
            };
        if (!refs.length)
            return {
                enabled: false,
                code: 'empty_selection',
                reason: 'Select one or more conversations first'
            };
        if (definition.kind === 'local_metadata' && !context.metadataReady)
            return {
                enabled: false,
                code: 'metadata_unavailable',
                reason: 'Local Manager metadata is unavailable; reopen the dashboard'
            };
        if (id === 'delete') {
            if (context.activeDeleteJob)
                return {
                    enabled: false,
                    code: 'active_delete_job',
                    reason: 'Finish or cancel the active deletion job first'
                };
            if (refs.some(ref => Ref.decode(ref).provider !== 'chatgpt'))
                return {
                    enabled: false,
                    code: 'unsupported_provider',
                    reason: 'Delete is currently implemented only for ChatGPT. Local organization supports other providers.'
                };
        }
        return {
            enabled: true,
            code: id === 'delete' ? 'prepare_required' : 'ready',
            reason: id === 'delete' ? 'Opens the existing verification and approval wizard; nothing is deleted by selection.' : 'Local metadata action',
            prerequisites: definition.prerequisites
        };
    }
    function plan(id, context = {}) {
        const refs = Object.freeze([...new Set(context.refs || [])]);
        return Object.freeze({
            action_id: id,
            conversation_refs: refs,
            availability: evaluate(id, { ...context, refs }),
            stages: Object.freeze(['availability', 'prepare', 'acquire_prerequisites', 'review', 'execute', 'result']),
            prerequisites: REGISTRY[id]?.prerequisites || [],
            requirements: Prerequisites.inspect(REGISTRY[id]?.prerequisites || [], { ...context, refs })
        });
    }
    function createRunner({ handlers = {}, onProgress = () => { } } = {}) {
        async function run(id, context = {}, options = {}) {
            const p = plan(id, context);
            if (!p.availability.enabled) {
                const e = new Error(p.availability.code === 'implementation_missing' ? `Action not implemented: ${p.availability.reason}` : p.availability.reason);
                e.code = p.availability.code;
                throw e;
            }
            const handler = handlers[id];
            if (!handler?.execute)
                throw new Error('Action handler is not connected');
            const cancelled = () => {
                if (options.signal?.aborted)
                    throw new DOMException('Action cancelled', 'AbortError');
            };
            cancelled();
            onProgress({
                action_id: id,
                state: 'preparing'
            });
            let prepared = handler.prepare ? await handler.prepare(p, options) : p;
            cancelled();
            if (handler.acquirePrerequisites) {
                onProgress({
                    action_id: id,
                    state: 'acquiring_prerequisites'
                });
                prepared = await handler.acquirePrerequisites(prepared, options);
                cancelled();
            }
            if (handler.review) {
                onProgress({
                    action_id: id,
                    state: 'review'
                });
                if (await handler.review(prepared, options) !== true)
                    return {
                        state: 'cancelled'
                    };
            }
            cancelled();
            onProgress({
                action_id: id,
                state: 'executing'
            });
            const result = await handler.execute(prepared, options);
            onProgress({
                action_id: id,
                state: 'complete'
            });
            return {
                state: 'complete', result
            };
        }
        return { plan, run };
    }
    return { REGISTRY, REASONS, evaluate, plan, createRunner };
});
