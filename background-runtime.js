(function attachBackgroundRuntime(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BackgroundRuntime = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createRuntimeModule() {
  'use strict';

  const COMMANDS = Object.freeze({
    'delete_job:get': (controller) => controller.getJob(),
    'delete_job:start_plan': (controller, request) => controller.startPlan({
      ids: request.ids,
      intervalSeconds: request.interval_seconds,
      approvedProjectIds: request.approved_project_ids
    }),
    'delete_job:create_plan': (controller, request) => controller.createPlan({
      ids: request.ids,
      intervalSeconds: request.interval_seconds
    }),
    'delete_job:refresh_plan': (controller) => controller.refreshPlan(),
    'delete_job:remove_blocked': (controller) => controller.removeBlocked(),
    'delete_job:approve_projects': (controller) => controller.approveProjects(),
    'delete_job:start': (controller) => controller.start(),
    'delete_job:pause': (controller) => controller.pause(),
    'delete_job:resume': (controller) => controller.resume(),
    'delete_job:cancel': (controller) => controller.cancel(),
    'delete_job:dismiss_terminal': (controller) => controller.dismissTerminal()
  });

  const PUBLIC_ERROR_CODES = new Set([
    'active_job_exists',
    'no_active_job',
    'job_not_terminal',
    'invalid_job_state',
    'plan_not_ready',
    'project_approval_required',
    'invalid_request'
  ]);

  function sanitizedErrorCode(error) {
    return PUBLIC_ERROR_CODES.has(error?.code) ? error.code : 'internal_error';
  }

  function createBackgroundRuntime({
    chromeApi,
    controller,
    executor,
    openDashboard
  }) {
    if (!chromeApi?.runtime?.onMessage?.addListener ||
        !chromeApi?.runtime?.onStartup?.addListener ||
        !chromeApi?.alarms?.onAlarm?.addListener) {
      throw new TypeError('chromeApi runtime and alarms events are required');
    }
    if (!controller || typeof controller.getJob !== 'function' ||
        typeof controller.handleBrowserStartup !== 'function') {
      throw new TypeError('controller is invalid');
    }
    if (!executor || typeof executor.ensureSchedule !== 'function' ||
        typeof executor.executeStep !== 'function' ||
        typeof executor.recoverInterruptedRequest !== 'function') {
      throw new TypeError('executor is invalid');
    }
    if (typeof openDashboard !== 'function') {
      throw new TypeError('openDashboard must be a function');
    }

    let registered = false;
    let workerRecoveryPromise = null;

    function ensureWorkerRecovery() {
      if (!workerRecoveryPromise) {
        workerRecoveryPromise = Promise.resolve()
          .then(() => executor.recoverInterruptedRequest())
          .then(
            () => true,
            () => false
          );
      }
      return workerRecoveryPromise;
    }

    function handleMessage(request, _sender, sendResponse) {
      Promise.resolve().then(async () => {
        const recoverySucceeded = await ensureWorkerRecovery();
        if (!recoverySucceeded && request?.action !== 'open_dashboard') {
          return { ok: false, error_code: 'internal_error' };
        }
        if (request?.action === 'open_dashboard') {
          await openDashboard();
          return { ok: true };
        }
        const command = COMMANDS[request?.type];
        if (!command) return { ok: false, error_code: 'unknown_command' };
        try {
          const job = await command(controller, request);
          return { ok: true, job };
        } catch (error) {
          return { ok: false, error_code: sanitizedErrorCode(error) };
        }
      }).then(sendResponse, () => {
        sendResponse({ ok: false, error_code: 'internal_error' });
      });
      return true;
    }

    async function handleAlarm(alarm) {
      try {
        if (!await ensureWorkerRecovery()) return;
        await executor.executeStep(alarm);
      } catch (_error) {
        // Durable executor state is authoritative. Never expose private errors.
      }
    }

    async function handleStartup() {
      try {
        await controller.handleBrowserStartup();
      } catch (_error) {
        // Invalid durable state remains unexecuted for explicit review.
      }
    }

    async function register() {
      if (registered) return;
      registered = true;
      chromeApi.runtime.onMessage.addListener(handleMessage);
      chromeApi.alarms.onAlarm.addListener(handleAlarm);
      chromeApi.runtime.onStartup.addListener(handleStartup);
      void ensureWorkerRecovery();
    }

    return { register };
  }

  return {
    createBackgroundRuntime
  };
});
