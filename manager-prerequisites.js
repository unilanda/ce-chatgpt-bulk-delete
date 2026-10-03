(function (root, factory) {
    const req = typeof module === 'object' && module.exports;
    const api = factory(req ? require('./conversation-ref.js') : root.ConversationRef, req ? require('./archive-freshness.js') : root.ArchiveFreshness);
    if (req)
        module.exports = api;
    root.ManagerPrerequisites = api;
})(globalThis, function (Ref, Fresh) {
    'use strict';
    /** Pure prerequisite inspection. Remediation descriptors are NOT permission to run. */
    function inspect(requirements, context = {}) {
        const refs = [...new Set(context.refs || [])];
        refs.forEach(Ref.decode);
        return requirements.map(kind => {
            const result = { kind,
                satisfied: true,
                missing_refs: [],
                stale_refs: [],
                unknown_refs: [],
                remedy: null };
            if (kind === 'current_archives' || kind === 'complete_archives') {
                result.remedy = 'archive.save';
                for (const ref of refs) {
                    const record = context.archives?.[ref];
                    const snapshot = record?.snapshot;
                    if (!snapshot || snapshot.completeness !== 'complete' || snapshot.payload_state !== 'committed' || !snapshot.payload_ref) {
                        result.missing_refs.push(ref);
                    }
                    else if (kind === 'current_archives') {
                        const state = Fresh.evaluate(record, context.observations?.[ref]).state;
                        if (state === 'stale')
                            result.stale_refs.push(ref);
                        else if (state !== 'current')
                            result.unknown_refs.push(ref);
                    }
                }
                result.satisfied = !result.missing_refs.length && !result.stale_refs.length && !result.unknown_refs.length;
            }
            else if (kind === 'conversation_classification') {
                result.remedy = 'existing_delete_preparation';
                result.unknown_refs = refs.filter(ref => !['standalone-safe', 'project-protected', 'custom-gpt-protected'].includes(context.classifications?.[ref]));
                result.satisfied = result.unknown_refs.length === 0;
            }
            else {
                // Future engine/transport requirements are unmet in this build. Metadata
                // cannot grant a missing implementation or a provider mutation capability.
                result.satisfied = false;
            }
            return result;
        });
    }
    return { inspect };
});
