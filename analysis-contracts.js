(function (root, factory) {
    const req = typeof module === 'object' && module.exports;
    const api = factory(req ? require('./manager-validation.js') : root.ManagerValidation, req ? require('./conversation-ref.js') : root.ConversationRef);
    if (req)
        module.exports = api;
    root.AnalysisContracts = api;
})(globalThis, function (V, Ref) {
    'use strict';
    const OPERATIONS = Object.freeze({
        'summarize': {
            output: 'summary',
            modes: ['general', 'technical', 'timeline', 'decision_log', 'open_questions', 'handoff']
        },
        'merge.raw': {
            output: 'raw_merge',
            modes: ['source_preserving']
        },
        'merge.structured': {
            output: 'structured_merge',
            modes: ['deduplicated_with_provenance']
        },
        'merge.canonical': {
            output: 'canonical_merge',
            modes: ['current_knowledge']
        },
        'synthesize': {
            output: 'synthesis',
            modes: ['handoff', 'master_context']
        },
        'analyze.similar': {
            output: 'similarity_report',
            modes: ['semantic']
        },
        'analyze.cluster': {
            output: 'cluster_report',
            modes: ['semantic']
        },
        'analyze.duplicates': {
            output: 'duplicate_report',
            modes: ['exact', 'near']
        },
        'analyze.superseded': {
            output: 'superseded_report',
            modes: ['evidence_review']
        }
    });
    function request(input) {
        const spec = OPERATIONS[input?.operation];
        if (!spec)
            throw V.error('unsupported_operation', 'Unknown analysis operation');
        if (!Array.isArray(input.sources) || !input.sources.length)
            throw V.error('missing_sources', 'Pinned archive sources are required');
        const sources = input.sources.map(s => {
            Ref.decode(s.conversation_ref);
            return Object.freeze({
                conversation_ref: s.conversation_ref,
                revision: V.whole(s.revision, 'archive revision', 1),
                content_hash: V.hash(s.content_hash),
                normalized_hash: V.hash(s.normalized_hash),
                normalizer_version: V.text(s.normalizer_version, 'normalizer version'),
                scope: V.choice(s.scope, ['selected_branch', 'whole_tree'], 'scope'),
                branch_key: V.text(s.branch_key, 'branch key')
            });
        });
        return Object.freeze({
            operation: input.operation,
            mode: V.choice(input.mode, spec.modes, 'analysis mode'),
            output_type: spec.output,
            sources: Object.freeze(sources),
            instruction_hash: V.hash(input.instruction_hash),
            losslessness: input.operation === 'merge.raw' ? 'source-preserving-only' : 'not-guaranteed',
            remote_submission_requires_user_consent: true
        });
    }
    function notConnected() {
        throw V.error('engine_not_connected', 'Analysis engine not connected; no result was produced');
    }
    return { OPERATIONS, request,
        execute: notConnected };
});
