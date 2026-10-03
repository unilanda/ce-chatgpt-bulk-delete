'use strict';

function conversationHit(overrides = {}) {
  return {
    source_type: 'conversation',
    source_key: 'conversation',
    title: 'Synthetic planning chat',
    update_time: 1789486324.789347,
    match_kind: 'title',
    payload: {
      kind: 'conversation',
      conversation_id: 'conv-synthetic-001',
      message_id: 'msg-synthetic-001',
      is_archived: false,
      is_starred: false
    },
    ...overrides,
    payload: {
      kind: 'conversation',
      conversation_id: 'conv-synthetic-001',
      message_id: 'msg-synthetic-001',
      is_archived: false,
      is_starred: false,
      ...(overrides.payload || {})
    }
  };
}

function projectHit() {
  return {
    source_type: 'project',
    source_key: 'project',
    title: 'Synthetic project',
    payload: { kind: 'project', project_id: 'project-synthetic-001' }
  };
}

function libraryHit() {
  return {
    source_type: 'library',
    source_key: 'library',
    title: 'Synthetic library item',
    payload: { kind: 'file', file_id: 'file-synthetic-001' }
  };
}

function searchResponse({
  items = [],
  cursor = null,
  hasMore = false,
  extra = {}
} = {}) {
  return {
    items,
    cursor,
    source_statuses: [
      {
        source_type: 'conversation',
        source_key: 'conversation',
        has_more: hasMore
      }
    ],
    ...extra
  };
}

module.exports = {
  conversationHit,
  libraryHit,
  projectHit,
  searchResponse
};
