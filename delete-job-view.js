(function attachDeleteJobView(root, factory) {
  const deleteJob =
    typeof module === 'object' && module.exports
      ? require('./delete-job.js')
      : root.DeleteJob;
  const api = factory(deleteJob);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.DeleteJobView = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createDeleteJobView(
  deleteJob
) {
  'use strict';

  if (!deleteJob) throw new Error('DeleteJob is required');

  const PLAN_ELEMENT_IDS = Object.freeze([
    'modal-title',
    'delete-confirm-copy',
    'delete-plan-summary',
    'delete-preflight-status',
    'delete-project-warning',
    'delete-project-list',
    'approve-projects-btn',
    'remove-blocked-btn',
    'confirm-delete-btn'
  ]);
  const ACTIVE_JOB_ELEMENT_IDS = Object.freeze([
    'active-jobs-section',
    'active-job-card',
    'active-job-title',
    'active-job-status',
    'active-job-next',
    'active-job-timing',
    'active-job-error',
    'active-job-pause-btn',
    'active-job-resume-btn',
    'active-job-review-btn',
    'active-job-cancel-btn',
    'active-job-view-btn',
    'recent-activity-section',
    'recent-job-title',
    'recent-job-status',
    'recent-job-timing',
    'recent-job-dismiss-btn',
    'fixed-job-bar',
    'fixed-job-summary',
    'fixed-job-timing',
    'fixed-job-pause-btn',
    'fixed-job-resume-btn',
    'fixed-job-details-btn'
  ]);

  function requireElements(elements, ids) {
    for (const id of ids) {
      if (!elements?.[id]) throw new Error(`Missing DeleteJob view element: ${id}`);
    }
  }

  function setHidden(element, hidden) {
    element.hidden = hidden;
    element.classList.toggle('hidden', hidden);
  }

  function plural(count, word) {
    return `${count} ${word}${count === 1 ? '' : 's'}`;
  }

  function formatDurationSeconds(value) {
    if (!Number.isFinite(value) || value < 0) return 'Unknown';
    const totalSeconds = Math.round(value);
    if (totalSeconds === 0) return 'No inter-item waiting needed';
    if (totalSeconds < 60) return `${totalSeconds} second${totalSeconds === 1 ? '' : 's'}`;
    const totalMinutes = Math.round(totalSeconds / 60);
    if (totalMinutes < 60) return `~${totalMinutes} minute${totalMinutes === 1 ? '' : 's'}`;
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return minutes === 0
      ? `~${hours} hour${hours === 1 ? '' : 's'}`
      : `~${hours} hour${hours === 1 ? '' : 's'} ${minutes} minute${minutes === 1 ? '' : 's'}`;
  }

  function renderPlan(elements, job, records = []) {
    requireElements(elements, PLAN_ELEMENT_IDS);
    const summary = deleteJob.summarizeDeleteJob(job);
    const titles = new Map(records.map(record => [record.id, record.title || 'Untitled conversation']));
    const projectItems = job.items.filter(item =>
      item.approved_classification === 'project-protected' &&
      item.status !== deleteJob.ITEM_STATES.COMPLETED
    );

    elements['modal-title'].textContent =
      `Delete ${summary.total} ${summary.total === 1 ? 'conversation' : 'conversations'}?`;
    elements['delete-confirm-copy'].textContent =
      'Review this deletion plan. No conversation is deleted until Start deletion.';
    elements['delete-plan-summary'].textContent = [
      `${summary.total} total`,
      `${summary.standalone} Standalone`,
      `${summary.project} Project`,
      `${job.interval_seconds} second delay`,
      `estimated minimum ${formatDurationSeconds(summary.estimated_minimum_seconds)}`
    ].join(' · ');

    const blockedParts = [];
    if (summary.blocked_unverified || summary.blocked_missing) {
      blockedParts.push(
        `${summary.blocked_unverified + summary.blocked_missing} Needs verification`
      );
    }
    if (summary.blocked_custom_gpt) {
      blockedParts.push(`${summary.blocked_custom_gpt} Custom GPT blocked in V1`);
    }
    elements['delete-preflight-status'].textContent = blockedParts.length
      ? `Blocked: ${blockedParts.join(' · ')}`
      : summary.project_approval_required
        ? `Approval required for ${plural(summary.project, 'Project conversation')}`
        : 'Ready to start. Pause or Cancel remains available after starting.';

    const hasProjects = projectItems.length > 0;
    setHidden(elements['delete-project-warning'], !hasProjects);
    setHidden(elements['delete-project-list'], !hasProjects);
    elements['delete-project-warning'].textContent = hasProjects
      ? 'Selected Project conversations will be permanently deleted. Their Projects themselves are not being deleted.'
      : '';
    elements['delete-project-list'].textContent = projectItems
      .map(item => titles.get(item.conversation_id) || item.conversation_id)
      .join('\n');
    setHidden(elements['approve-projects-btn'], !summary.project_approval_required);
    elements['approve-projects-btn'].textContent =
      `Approve ${plural(summary.project, 'Project conversation')}`;
    setHidden(elements['remove-blocked-btn'], summary.blocked === 0);
    elements['remove-blocked-btn'].textContent =
      `Remove ${plural(summary.blocked, 'blocked conversation')} from this job`;

    const ready = job.state === deleteJob.JOB_STATES.READY;
    elements['confirm-delete-btn'].disabled = !ready;
    elements['confirm-delete-btn'].textContent = 'Start deletion';
    return { ready, summary };
  }

  function formatCountdown(nextRunAt, timestamp = Date.now()) {
    if (!Number.isFinite(nextRunAt)) return '';
    const remainingMs = nextRunAt - timestamp;
    if (remainingMs <= 0) return 'Waiting for Chrome…';
    const totalSeconds = Math.ceil(remainingMs / 1000);
    const seconds = totalSeconds % 60;
    const totalMinutes = Math.floor(totalSeconds / 60);
    if (totalMinutes < 60) {
      return `${String(totalMinutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  function readableTimestamp(timestamp) {
    if (!Number.isFinite(timestamp)) return 'Not available';
    return new Date(timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  function readableError(code) {
    const labels = {
      browser_restarted: 'Deletion paused because Chrome restarted.',
      interrupted_request: 'A prior request was interrupted. Its remote outcome is unknown, so it was not automatically retried.',
      network_error: 'Deletion paused after a network error.',
      session_unavailable: 'Deletion paused because the ChatGPT session is unavailable.',
      eligibility_changed: 'Deletion paused because eligibility changed.',
      local_reconcile_error: 'Remote deletion succeeded, but local inventory needs review.'
    };
    return labels[code] || (code
      ? `Deletion paused: ${String(code).replaceAll('_', ' ')}`
      : '');
  }

  function lastCompletedAt(job) {
    const values = job.items
      .map(item => item.completed_at)
      .filter(Number.isFinite);
    return values.length ? Math.max(...values) : null;
  }

  function renderActiveJob(elements, job, timestamp = Date.now()) {
    requireElements(elements, ACTIVE_JOB_ELEMENT_IDS);
    const visible = Boolean(job);
    const terminal = Boolean(job) && deleteJob.TERMINAL_STATES.has(job.state);
    setHidden(elements['active-jobs-section'], !visible || terminal);
    setHidden(elements['active-job-card'], !visible || terminal);
    setHidden(elements['recent-activity-section'], !visible || !terminal);
    if (!job) {
      setHidden(elements['fixed-job-bar'], true);
      return { visible: false };
    }

    if (terminal) {
      elements['recent-job-title'].textContent =
        job.state === deleteJob.JOB_STATES.COMPLETED
          ? 'Deletion complete'
          : 'Deletion cancelled';
      elements['recent-job-status'].textContent =
        job.state === deleteJob.JOB_STATES.COMPLETED
          ? `${job.counts.completed} / ${job.counts.total} deleted`
          : `${job.counts.completed} / ${job.counts.total} confirmed deleted`;
      elements['recent-job-timing'].textContent = [
        `Finished: ${readableTimestamp(job.finished_at)}`,
        `Target delay: ${job.interval_seconds} seconds`
      ].join(' · ');
      setHidden(elements['recent-job-dismiss-btn'], false);
      setHidden(elements['fixed-job-bar'], true);
      return { visible: true, state: job.state, terminal: true, countdown: '' };
    }

    const reviewRequired = job.state === deleteJob.JOB_STATES.ERROR_PAUSED;
    const userPaused = job.state === deleteJob.JOB_STATES.PAUSED;
    const running = job.state === deleteJob.JOB_STATES.RUNNING;
    const titles = {
      draft: 'Deletion plan needs review',
      ready: 'Deletion ready to start',
      running: 'Deletion running',
      pause_requested: 'Pause requested',
      paused: 'Deletion paused',
      cancel_requested: 'Cancellation requested',
      error_paused: 'Deletion paused — review required',
      completed: 'Deletion complete',
      cancelled: 'Deletion cancelled'
    };
    elements['active-job-title'].textContent = titles[job.state] || 'Deletion job';
    elements['active-job-status'].textContent =
      `${job.counts.completed} / ${job.counts.total} complete · ${job.counts.pending} pending`;
    const countdown = running ? formatCountdown(job.next_run_at, timestamp) : '';
    elements['active-job-next'].textContent = countdown
      ? countdown === 'Waiting for Chrome…' ? countdown : `Next in ${countdown}`
      : '';
    const scheduler = job.interval_seconds >= 30
      ? 'Chrome alarm'
      : 'Fast timer + backup alarm (best effort)';
    elements['active-job-timing'].textContent = [
      `Target delay: ${job.interval_seconds} seconds`,
      `Last completed: ${readableTimestamp(lastCompletedAt(job))}`,
      `Next target: ${readableTimestamp(job.next_run_at)}`,
      `Scheduler: ${scheduler}`
    ].join(' · ');
    elements['active-job-error'].textContent = readableError(job.last_error?.code);
    setHidden(elements['active-job-error'], elements['active-job-error'].textContent === '');

    setHidden(elements['active-job-pause-btn'], !running);
    setHidden(elements['active-job-resume-btn'], !(userPaused || reviewRequired));
    elements['active-job-resume-btn'].textContent = userPaused ? 'Resume' : 'Review & Resume';
    setHidden(elements['active-job-review-btn'], !userPaused);
    setHidden(elements['active-job-cancel-btn'], ![
      deleteJob.JOB_STATES.DRAFT,
      deleteJob.JOB_STATES.READY,
      deleteJob.JOB_STATES.PAUSED,
      deleteJob.JOB_STATES.ERROR_PAUSED
    ].includes(job.state));
    setHidden(elements['active-job-view-btn'], false);

    setHidden(elements['fixed-job-bar'], false);
    {
      elements['fixed-job-summary'].textContent = running
        ? `Deleting ${job.counts.completed} / ${job.counts.total}`
        : reviewRequired
          ? `Deletion paused — review required · ${job.counts.pending} remaining`
          : userPaused
            ? `Deletion paused · ${job.counts.completed} / ${job.counts.total} complete`
            : titles[job.state] || 'Deletion job';
      elements['fixed-job-timing'].textContent = running
        ? `${job.counts.pending} remaining · Target delay: ${job.interval_seconds}s · ${countdown === 'Waiting for Chrome…' ? countdown : `Next in ${countdown}`}`
        : `${job.counts.pending} remaining`;
      setHidden(elements['fixed-job-pause-btn'], !running);
      setHidden(elements['fixed-job-resume-btn'], !(userPaused || reviewRequired));
      elements['fixed-job-resume-btn'].textContent = userPaused ? 'Resume' : 'Review & Resume';
      setHidden(elements['fixed-job-details-btn'], false);
    }
    return { visible: true, state: job.state, countdown };
  }

  return {
    ACTIVE_JOB_ELEMENT_IDS,
    PLAN_ELEMENT_IDS,
    formatCountdown,
    formatDurationSeconds,
    renderActiveJob,
    renderPlan
  };
});
