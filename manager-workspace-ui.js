(function (root, factory) {
    const req = typeof module === 'object' && module.exports;
    const api = factory(req ? require('./conversation-ref.js') : root.ConversationRef, req ? require('./collection-service.js') : root.CollectionService, req ? require('./tag-service.js') : root.TagService, req ? require('./manager-actions.js') : root.ManagerActions, req ? require('./archive-freshness.js') : root.ArchiveFreshness, req ? require('./timestamp-utils.js') : root.TimestampUtils);
    if (req)
        module.exports = api;
    root.ManagerWorkspaceUI = api;
})(globalThis, function (Ref, Collections, Tags, Actions, Fresh, Time) {
    'use strict';
    const escape = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    function createController({ document, elements: e, store, getRecords, getSelectedIds, onViewChanged, confirmImpl = globalThis.confirm }) {
        const collection = Collections.createService({ store }), tag = Tags.createService({ store });
        const services = { collection, tag };
        let ready = false, revision = 0, dialog = null, lastActiveDelete = false;
        let snapshot = {
            collections: [],
            collection_memberships: [],
            tags: [],
            tag_memberships: [],
            archive_records: [],
            clusters: []
        };
        const refs = () => getRecords().filter(r => getSelectedIds().has(r.id)).map(r => Ref.encodeInventoryRecord(r));
        const api = kind => kind === 'collection' ? {
            list: 'collections',
            members: 'collection_memberships',
            create: 'createCollection',
            rename: 'renameCollection',
            remove: 'deleteCollection'
        } : {
            list: 'tags',
            members: 'tag_memberships',
            create: 'createTag',
            rename: 'renameTag',
            remove: 'deleteTag'
        };
        const showError = error => {
            e['manager-metadata-status'].textContent = error?.code === 'revision_conflict' ? 'Another view changed this metadata. Reload it before retrying.' : error?.message || 'Local metadata action failed';
        };
        const guarded = fn => async (event) => {
            try {
                await fn(event);
            }
            catch (error) {
                showError(error);
            }
        };
        function readGroup(kind) {
            return snapshot[api(kind).list] || [];
        }
        async function refresh({ notify = true } = {}) {
            const generation = ++revision;
            try {
                const next = await store.atomic(Object.keys(snapshot), 'readonly', async (io) => {
                    const out = {};
                    for (const key of Object.keys(snapshot))
                        out[key] = await io.all(key);
                    return out;
                });
                if (generation !== revision)
                    return;
                snapshot = next;
                ready = true;
                renderGroups('collection');
                renderGroups('tag');
                updateActions({
                    activeDeleteJob: lastActiveDelete
                });
                e['manager-metadata-status'].textContent = 'Collections and tags are local; rebuilding inventory preserves them.';
                if (notify)
                    onViewChanged();
            }
            catch (error) {
                if (generation !== revision)
                    return;
                ready = false;
                showError(error);
                updateActions({
                    activeDeleteJob: lastActiveDelete
                });
            }
        }
        function renderGroups(kind) {
            const spec = api(kind), items = readGroup(kind).sort((a, b) => a.name.localeCompare(b.name));
            const members = snapshot[spec.members];
            const list = e[kind === 'collection' ? 'collections-list' : 'tags-list'];
            const present = new Set(getRecords().map(r => Ref.encodeInventoryRecord(r)));
            list.textContent = '';
            const fragment = document.createDocumentFragment();
            for (const item of items) {
                const own = members.filter(m => m[`${kind}_id`] === item.id), loaded = own.filter(m => present.has(m.conversation_ref)).length;
                const row = document.createElement('div');
                row.classList.add('collection-row');
                row.setAttribute('role', 'listitem');
                row.innerHTML = `<div class="collection-row-main"><button class="collection-row-name ${kind}-filter-btn" data-id="${escape(item.id)}">${escape(item.name)}</button><div class="collection-row-meta">${own.length} members · ${loaded} in inventory</div></div><div class="button-row"><button class="btn btn-ghost ${kind}-rename-btn" data-id="${escape(item.id)}" aria-label="Rename ${escape(item.name)}">Rename</button><button class="btn btn-ghost ${kind}-delete-btn" data-id="${escape(item.id)}" aria-label="Delete local ${kind} ${escape(item.name)}">Delete</button></div>`;
                fragment.appendChild(row);
            }
            list.appendChild(fragment);
            e[kind === 'collection' ? 'collections-empty' : 'tags-empty'].classList.toggle('hidden', items.length > 0);
            const filter = e[`${kind}-filter`], previous = filter.value || 'all';
            filter.innerHTML = `<option value="all">All ${kind}s</option>` + items.map(i => `<option value="${escape(i.id)}">${escape(i.name)}</option>`).join('');
            filter.value = items.some(i => i.id === previous) ? previous : 'all';
            document.querySelectorAll(`.${kind}-filter-btn`).forEach(button => button.addEventListener('click', () => {
                filter.value = button.dataset.id;
                onViewChanged();
            }));
            document.querySelectorAll(`.${kind}-rename-btn`).forEach(button => button.addEventListener('click', () => open(kind, 'rename', button.dataset.id)));
            document.querySelectorAll(`.${kind}-delete-btn`).forEach(button => button.addEventListener('click', guarded(async () => {
                const item = items.find(i => i.id === button.dataset.id);
                if (!confirmImpl(`Delete local ${kind} “${item.name}”?\n\nConversations and saved content will not be deleted.`))
                    return;
                await services[kind][spec.remove](item.id, {
                    expectedRevision: item.revision
                });
                await refresh();
            })));
        }
        function open(kind, mode, id) {
            if (!ready)
                return;
            const spec = api(kind);
            const item = readGroup(kind).find(i => i.id === id);
            if (mode === 'rename' && !item)
                return;
            dialog = { kind, mode, id,
                expectedRevision: item?.revision,
                refs: refs(),
                opener: document.activeElement };
            e[`${kind}-modal-title`].textContent = mode === 'rename' ? `Rename ${kind}` : mode === 'create' ? `New ${kind}` : `Add ${dialog.refs.length} selected to ${kind}`;
            e[`${kind}-modal-copy`].textContent = `This changes only local ${kind} metadata. It does not move or modify provider conversations.`;
            e[`${kind}-modal-select`].innerHTML = `<option value="">Choose a ${kind}</option>` + readGroup(kind).map(i => `<option value="${escape(i.id)}">${escape(i.name)}</option>`).join('');
            e[`${kind}-modal-select`].value = '';
            e[`${kind}-modal-select`].hidden = mode !== 'add';
            e[`${kind}-modal-name`].value = item?.name || '';
            e[`${kind}-modal-status`].textContent = '';
            e[`${kind}-modal-confirm-btn`].textContent = mode === 'rename' ? 'Save name' : mode === 'create' ? 'Create' : 'Add';
            e[`${kind}-modal`].classList.remove('hidden');
            e[`${kind}-modal-name`].focus();
        }
        function close() {
            if (!dialog)
                return;
            const old = dialog;
            dialog = null;
            e[`${old.kind}-modal`].classList.add('hidden');
            old.opener?.focus?.();
        }
        async function confirmDialog() {
            if (!dialog)
                return;
            const d = dialog;
            const spec = api(d.kind), repo = services[d.kind];
            const button = e[`${d.kind}-modal-confirm-btn`];
            button.disabled = true;
            try {
                const name = e[`${d.kind}-modal-name`].value.trim(), chosen = e[`${d.kind}-modal-select`].value;
                if (d.mode === 'rename')
                    await repo[spec.rename](d.id, name, {
                        expectedRevision: d.expectedRevision
                    });
                else if (d.mode === 'create')
                    await repo[spec.create](name);
                else {
                    const runner = Actions.createRunner({
                        handlers: {
                            [`${d.kind}.add`]: {
                                execute: async (plan) => {
                                    if (name)
                                        return repo[spec.create](name, {
                                            refs: plan.conversation_refs
                                        });
                                    if (!chosen)
                                        throw new Error(`Choose a ${d.kind} or enter a new name`);
                                    return repo.addConversationRefs(chosen, plan.conversation_refs);
                                }
                            }
                        }
                    });
                    await runner.run(`${d.kind}.add`, {
                        refs: d.refs,
                        metadataReady: ready
                    });
                }
                close();
                await refresh();
            }
            catch (error) {
                e[`${d.kind}-modal-status`].textContent = error.message || 'Metadata update failed';
            }
            finally {
                button.disabled = false;
            }
        }
        async function removeSelected(kind) {
            const chosen = e[`${kind}-filter`].value;
            if (!chosen || chosen === 'all')
                return;
            await services[kind].removeConversationRefs(chosen, refs());
            await refresh();
        }
        function archiveState(record) {
            const ref = Ref.encodeInventoryRecord(record);
            return Fresh.evaluate(snapshot.archive_records.find(a => a.conversation_ref === ref), {
                updated_at_ms: Time.toEpochMilliseconds(record.update_time)
            });
        }
        function filter(records) {
            if (!ready)
                return records;
            const view = e['manager-view-filter'].value || 'all', collectionId = e['collection-filter'].value || 'all', tagId = e['tag-filter'].value || 'all';
            const cset = new Set(snapshot.collection_memberships.filter(m => collectionId === 'all' || m.collection_id === collectionId).map(m => m.conversation_ref));
            const tset = new Set(snapshot.tag_memberships.filter(m => m.tag_id === tagId).map(m => m.conversation_ref));
            e['manager-view-help'].textContent = view === 'archived' || view === 'needs_update' ? 'Archive metadata view. Capture engine is not connected yet; no saved content is fabricated.' : view === 'projects' ? 'Project conversations known from provider metadata; this view does not enumerate Project names.' : view === 'collections' ? 'Shows inventory conversations that belong to local Collections. Memberships survive inventory rebuild.' : 'All loaded inventory. Use Collections and Tags without changing the provider chats.';
            return records.filter(record => {
                const ref = Ref.encodeInventoryRecord(record);
                if ((collectionId !== 'all' || view === 'collections') && !cset.has(ref))
                    return false;
                if (tagId !== 'all' && !tset.has(ref))
                    return false;
                if (view === 'projects' && record.classification !== 'project-protected')
                    return false;
                const archive = snapshot.archive_records.find(a => a.conversation_ref === ref);
                if (view === 'archived' && !(archive?.snapshot?.payload_state === 'committed' && archive.snapshot.payload_ref))
                    return false;
                if (view === 'needs_update' && archiveState(record).state !== 'stale')
                    return false;
                return view !== 'clusters';
            });
        }
        function updateActions({ activeDeleteJob = false } = {}) {
            lastActiveDelete = activeDeleteJob;
            const context = {
                refs: refs(),
                metadataReady: ready, activeDeleteJob
            };
            const map = {
                'add-to-collection-btn': 'collection.add',
                'tag-selected-btn': 'tag.add',
                'save-update-btn': 'archive.save',
                'analyze-selected-btn': 'analyze.similar',
                'summarize-selected-btn': 'summarize',
                'merge-selected-btn': 'merge.canonical',
                'move-selected-btn': 'project.move',
                'delete-selected-btn': 'delete'
            };
            for (const [element, action] of Object.entries(map)) {
                const result = Actions.evaluate(action, context);
                e[element].disabled = !result.enabled;
                e[element].title = result.reason;
                e[element].setAttribute('aria-describedby', `${element}-reason`);
                const help = e[`${element}-reason`];
                if (help)
                    help.textContent = result.reason;
            }
            e['new-collection-btn'].disabled = !ready;
            e['new-tag-btn'].disabled = !ready;
            e['remove-from-collection-btn'].hidden = (e['collection-filter'].value || 'all') === 'all';
            e['remove-tag-btn'].hidden = (e['tag-filter'].value || 'all') === 'all';
        }
        function rowMetadata(record) {
            const ref = Ref.encodeInventoryRecord(record), ids = new Set(snapshot.tag_memberships.filter(m => m.conversation_ref === ref).map(m => m.tag_id));
            const names = snapshot.tags.filter(t => ids.has(t.id)).map(t => t.name);
            const state = archiveState(record);
            const label = {
                never_saved: 'Not saved',
                current: 'Up to date by metadata',
                stale: 'Needs update',
                unknown: 'Unknown freshness'
            }[state.state];
            return `<span title="${escape(state.reason)}">${escape(label)}</span>${names.length ? `<span class="manager-row-tags">${escape(names.join(' · '))}</span>` : ''}`;
        }
        function bind() {
            for (const kind of ['collection', 'tag']) {
                e[kind === 'collection' ? 'new-collection-btn' : 'new-tag-btn'].addEventListener('click', () => open(kind, 'create'));
                e[kind === 'collection' ? 'add-to-collection-btn' : 'tag-selected-btn'].addEventListener('click', () => open(kind, 'add'));
                e[kind === 'collection' ? 'remove-from-collection-btn' : 'remove-tag-btn'].addEventListener('click', guarded(() => removeSelected(kind)));
                e[`${kind}-filter`].addEventListener('change', onViewChanged);
                e[`${kind}-modal-cancel-btn`].addEventListener('click', close);
                e[`${kind}-modal-confirm-btn`].addEventListener('click', confirmDialog);
                e[`${kind}-modal`].addEventListener('keydown', event => {
                    if (event.key === 'Escape') {
                        event.preventDefault();
                        close();
                        return;
                    }
                    if (event.key !== 'Tab')
                        return;
                    const focusable = ['select', 'name', 'cancel-btn', 'confirm-btn']
                        .map(suffix => e[`${kind}-modal-${suffix}`])
                        .filter(node => !node.hidden && !node.disabled);
                    const first = focusable[0], last = focusable.at(-1);
                    if (event.shiftKey && document.activeElement === first) {
                        event.preventDefault();
                        last.focus();
                    }
                    else if (!event.shiftKey && document.activeElement === last) {
                        event.preventDefault();
                        first.focus();
                    }
                });
            }
            e['manager-view-filter'].addEventListener('change', onViewChanged);
        }
        const unsubscribe = store.subscribe?.(() => {
            void refresh();
        });
        return { bind, refresh, filter, rowMetadata, updateActions, close, dispose() {
                unsubscribe?.();
                store.close();
            }, get ready() {
                return ready;
            } };
    }
    return { createController };
});
