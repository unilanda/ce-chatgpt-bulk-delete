(function (root, factory) {
    const req = typeof module === 'object' && module.exports;
    const api = factory(req ? require('./conversation-ref.js') : root.ConversationRef);
    if (req)
        module.exports = api;
    root.CaptureOrchestrator = api;
})(globalThis, function (Ref) {
    'use strict';
    /** Dependency-injected orchestration only. Not registered as a production Save job. */
    function createOrchestrator({ providers = {}, tabRunner, payloadStore, archiveRegistry, idFactory = () => crypto.randomUUID(), onCheckpoint = async () => { }, stageTimeoutMs = 60000 } = {}) {
        let running = false;
        async function run({ refs, mode = 'managed_tab', tabId, allowFocus = false, signal, onProgress = () => { } } = {}) {
            if (running)
                throw new Error('A capture run is already active');
            const unique = [...new Set(refs || [])];
            if (!unique.length)
                throw new Error('Select at least one conversation');
            if (!['managed_tab', 'current_tab'].includes(mode))
                throw new Error('Invalid capture mode');
            if (mode === 'current_tab' && unique.length !== 1)
                throw new Error('Current-tab mode accepts exactly one conversation');
            const entries = unique.map(ref => {
                const parsed = Ref.decode(ref);
                const provider = providers[parsed.provider];
                if (typeof provider?.capture?.waitReady !== 'function' || typeof provider?.capture?.capture !== 'function')
                    throw new Error(`Capture engine not connected: ${parsed.provider}`);
                return { ref, provider };
            });
            if (entries.some(entry => entry.provider.capture.requiresFocus === true) && !allowFocus)
                throw new Error('Foreground capture requires explicit focus permission');
            if (!tabRunner?.acquire || !tabRunner?.release || !tabRunner?.assertCurrent || !payloadStore?.persist || !archiveRegistry?.recordCapture)
                throw new Error('Capture persistence/tab adapters are not connected');
            if (!Number.isSafeInteger(stageTimeoutMs) || stageTimeoutMs < 1)
                throw new Error('Invalid capture timeout');
            running = true;
            const controller = new AbortController();
            const abort = () => controller.abort(signal?.reason);
            if (signal?.aborted)
                abort();
            else
                signal?.addEventListener('abort', abort, {
                    once: true
                });
            const result = {
                state: 'complete',
                total: entries.length,
                completed: 0,
                items: [],
                durable_job_host: false
            };
            const check = () => {
                if (controller.signal.aborted)
                    throw new DOMException('Capture cancelled', 'AbortError');
            };
            const stage = async (fn) => {
                check();
                let timer, listener;
                try {
                    return await Promise.race([Promise.resolve().then(() => {
                            check();
                            return fn();
                        }), new Promise((_, reject) => {
                            listener = () => reject(new DOMException('Capture cancelled', 'AbortError'));
                            controller.signal.addEventListener('abort', listener, {
                                once: true
                            });
                            timer = setTimeout(() => {
                                const e = new Error('Capture stage timed out');
                                e.code = 'timeout';
                                reject(e);
                                controller.abort();
                            }, stageTimeoutMs);
                        })]);
                }
                finally {
                    clearTimeout(timer);
                    controller.signal.removeEventListener('abort', listener);
                }
            };
            try {
                for (const entry of entries) {
                    let lease;
                    let committed = false;
                    const captureId = idFactory();
                    try {
                        check();
                        await onCheckpoint({
                            phase: 'opening',
                            conversation_ref: entry.ref,
                            capture_id: captureId
                        });
                        // Acquisition is awaited directly: a created tab must never be orphaned by a
                        // timeout race. Cancellation after acquire is handled in finally/release.
                        lease = await tabRunner.acquire({ mode,
                            ref: entry.ref,
                            provider: entry.provider, tabId, allowFocus });
                        check();
                        const context = {
                            ref: entry.ref,
                            tabId: lease.tabId,
                            signal: controller.signal,
                            capture_id: captureId
                        };
                        onProgress({
                            phase: 'hydrating',
                            completed: result.completed,
                            total: result.total
                        });
                        await stage(() => entry.provider.capture.waitReady(context));
                        await tabRunner.assertCurrent(lease, {
                            requiresFocus: entry.provider.capture.requiresFocus === true
                        });
                        check();
                        onProgress({
                            phase: 'capturing',
                            completed: result.completed,
                            total: result.total
                        });
                        const captured = await stage(() => entry.provider.capture.capture(context));
                        check();
                        await tabRunner.assertCurrent(lease, {
                            requiresFocus: entry.provider.capture.requiresFocus === true
                        });
                        if (captured?.conversation_ref !== entry.ref || captured.completeness !== 'complete')
                            throw new Error('Capture is incomplete or belongs to a different conversation');
                        await onCheckpoint({
                            phase: 'persisting',
                            conversation_ref: entry.ref,
                            capture_id: captureId
                        });
                        const receipt = await payloadStore.persist(captured, {
                            capture_id: captureId,
                            signal: controller.signal
                        });
                        check();
                        if (receipt?.durable !== true || !receipt.payload_ref)
                            throw new Error('Payload storage did not acknowledge a durable commit');
                        const head = await archiveRegistry.recordCapture({ ...captured,
                            capture_id: captureId,
                            payload_ref: receipt.payload_ref });
                        committed = true;
                        result.completed++;
                        result.items.push({
                            conversation_ref: entry.ref,
                            state: 'captured',
                            revision: head.revision
                        });
                        await onCheckpoint({
                            phase: 'committed',
                            conversation_ref: entry.ref,
                            capture_id: captureId,
                            revision: head.revision
                        });
                    }
                    catch (error) {
                        result.state = signal?.aborted || error?.name === 'AbortError' ? 'cancelled' : 'failed';
                        const failure = {
                            conversation_ref: entry.ref,
                            state: committed ? 'captured_checkpoint_failed' : result.state,
                            error_code: ['timeout', 'focus_lost'].includes(error?.code) ? error.code : result.state === 'cancelled' ? 'cancelled' : 'capture_failed'
                        };
                        if (committed)
                            Object.assign(result.items[result.items.length - 1], failure);
                        else
                            result.items.push(failure);
                        break;
                    }
                    finally {
                        if (lease) {
                            try {
                                const cleanup = await tabRunner.release(lease);
                                if (cleanup?.reason === 'user_navigated')
                                    result.cleanup_warning = 'A managed tab was retained because the user navigated it';
                            }
                            catch (_) {
                                result.cleanup_warning = 'A managed tab could not be closed';
                            }
                        }
                    }
                }
                onProgress({
                    phase: result.state,
                    completed: result.completed,
                    total: result.total
                });
                return result;
            }
            finally {
                signal?.removeEventListener('abort', abort);
                running = false;
            }
        }
        return { run };
    }
    return { createOrchestrator };
});
