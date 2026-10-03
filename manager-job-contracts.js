(function (root, factory) {
    const req = typeof module === 'object' && module.exports;
    const api = factory(req ? require('./manager-validation.js') : root.ManagerValidation, req ? require('./conversation-ref.js') : root.ConversationRef);
    if (req)
        module.exports = api;
    root.ManagerJobContracts = api;
})(globalThis, function (V, Ref) {
    'use strict';
    const NEXT = {
        planned: ['running', 'cancelled'],
        running: ['paused', 'failed', 'completed', 'cancelled'],
        paused: ['running', 'cancelled'],
        failed: [],
        completed: [],
        cancelled: []
    };
    function create({ id, type, refs, now = Date.now() }) {
        const unique = [...new Set(refs || [])];
        unique.forEach(Ref.decode);
        if (!unique.length)
            throw new Error('Job requires conversation refs');
        return {
            schema_version: 1,
            id: V.id(id),
            type: V.choice(type, ['capture', 'analysis', 'move', 'export'], 'future job kind'),
            state: 'planned',
            refs: unique,
            created_at: V.whole(now),
            updated_at: now,
            progress: {
                completed: 0,
                total: unique.length
            },
            revision: 1
        };
    }
    function transition(job, state, { now = Date.now(), completed = job.progress.completed } = {}) {
        if (!NEXT[job.state]?.includes(state))
            throw new Error('Invalid job transition');
        V.whole(completed, 'completed');
        if (completed < job.progress.completed || completed > job.progress.total)
            throw new Error('Invalid job progress');
        if (state === 'completed' && completed !== job.progress.total)
            throw new Error('Job is not complete');
        return { ...job, state,
            updated_at: now,
            progress: { ...job.progress, completed },
            revision: job.revision + 1 };
    }
    return { create, transition };
});
