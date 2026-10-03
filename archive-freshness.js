(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports)
        module.exports = api;
    root.ArchiveFreshness = api;
})(globalThis, function () {
    'use strict';
    function evaluate(record, observation = {}) {
        if (!record)
            return {
                state: 'never_saved',
                basis: 'none',
                reason: 'No capture recorded'
            };
        const s = record.snapshot;
        if (!s)
            return {
                state: (record.revision || record.capture_status === 'current' || record.last_captured_at != null) ? 'unknown' : 'never_saved',
                basis: 'none',
                reason: 'No verified committed snapshot'
            };
        if (s.payload_state !== 'committed' || !s.payload_ref || s.completeness !== 'complete')
            return {
                state: 'unknown',
                basis: 'capture',
                reason: 'Complete archived content is unavailable'
            };
        if (record.invalidated)
            return {
                state: 'stale',
                basis: 'explicit',
                reason: 'Source was marked changed'
            };
        const observed = observation || {};
        if (observed.source_version != null && s.source_version != null)
            return {
                state: observed.source_version === s.source_version ? 'current' : 'stale',
                basis: 'source_version',
                reason: 'Compared provider revision tokens'
            };
        if (Number.isFinite(observed.updated_at_ms) && Number.isFinite(s.source_updated_at_ms))
            return {
                state: observed.updated_at_ms === s.source_updated_at_ms ? 'current' : 'stale',
                basis: 'timestamp',
                reason: 'Compared source metadata; not a live content check'
            };
        return {
            state: 'unknown',
            basis: 'none',
            reason: 'Source freshness evidence is unavailable'
        };
    }
    function analysisReady(record, observation) {
        const result = evaluate(record, observation);
        return {
            ready: result.state === 'current', ...result
        };
    }
    return { evaluate, analysisReady };
});
