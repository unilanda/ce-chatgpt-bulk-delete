(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports)
        module.exports = api;
    root.ManagerValidation = api;
})(globalThis, function () {
    'use strict';
    function error(code, message) {
        const e = new Error(message || code);
        e.code = code;
        return e;
    }
    function text(value, label = 'text', max = 240) {
        if (typeof value !== 'string' || !value.trim() || value.length > max)
            throw error('invalid_input', `${label} must be non-empty text (maximum ${max} characters)`);
        return value.trim();
    }
    function id(value, label = 'id') {
        const v = text(value, label, 180);
        if (!/^[a-zA-Z0-9_-]+$/.test(v))
            throw error('invalid_input', `${label} contains invalid characters`);
        return v;
    }
    function whole(value, label = 'number', min = 0) {
        if (!Number.isSafeInteger(value) || value < min)
            throw error('invalid_input', `${label} must be an integer >= ${min}`);
        return value;
    }
    function choice(value, choices, label) {
        if (!choices.includes(value))
            throw error('invalid_input', `Invalid ${label}`);
        return value;
    }
    function optionalText(value, label, max) {
        return value == null ? null : text(value, label, max);
    }
    function hash(value, label = 'hash') {
        const v = text(value, label, 80).toLowerCase();
        if (!/^(sha256:)?[a-f0-9]{64}$/.test(v))
            throw error('invalid_hash', `${label} must be a SHA-256 digest`);
        return v.startsWith('sha256:') ? v : `sha256:${v}`;
    }
    function payload(value) {
        if (!value || typeof value !== 'object')
            throw error('missing_payload', 'A committed payload reference is required');
        return {
            store: id(value.store, 'payload store'),
            key: text(value.key, 'payload key', 1024)
        };
    }
    function confidence(v) {
        if (v == null)
            return null;
        if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1)
            throw error('invalid_input', 'confidence must be between 0 and 1');
        return v;
    }
    function revision(record, expected) {
        const current = record?.revision || 0;
        if (expected != null && expected !== current)
            throw error('revision_conflict', 'Metadata changed in another view; reload before retrying');
        return current + 1;
    }
    return { error, text, id, whole, choice, optionalText, hash, payload, confidence, revision };
});
