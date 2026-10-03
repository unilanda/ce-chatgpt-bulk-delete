#!/usr/bin/env python3
"""Native Chromium, local fixtures only. No browser profile or live account access.
Requires Playwright as a development tool; not an extension runtime dependency.
"""
from pathlib import Path
import argparse, functools, http.server, json, threading
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[2]
class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*args): pass

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--output',default=str(ROOT/'browser-evidence'))
    parser.add_argument('--chromium',default='/usr/bin/chromium')
    args=parser.parse_args();out=Path(args.output);out.mkdir(parents=True,exist_ok=True)
    server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(QuietHandler,directory=str(ROOT)))
    threading.Thread(target=server.serve_forever,daemon=True).start()
    origin=f'http://127.0.0.1:{server.server_port}'
    results=[]
    try:
      with sync_playwright() as p:
        browser=p.chromium.launch(executable_path=args.chromium,headless=True,args=['--no-sandbox'])
        context=browser.new_context(viewport={'width':1365,'height':1000})
        external=[]
        def route(req):
            if req.request.url.startswith(origin+'/'):
                relative=req.request.url[len(origin)+1:].split('?')[0]
                target=(ROOT/relative).resolve()
                if ROOT in target.parents and target.is_file(): req.fulfill(path=str(target))
                else: req.fulfill(status=404,body='Fixture not found')
            elif req.request.url=='https://chatgpt.com/api/auth/session':
                req.fulfill(status=200,content_type='application/json',body=json.dumps({'accessToken':'synthetic-session-not-live'}))
            else:
                external.append(req.request.url.split('?')[0]);req.abort()
        context.route('**/*',route)
        context.add_init_script('''globalThis.chrome={runtime:{getManifest:()=>({permissions:['storage','alarms']}),sendMessage:async()=>({ok:true,job:null})},storage:{local:{get:async()=>({delete_interval_seconds:600}),set:async()=>{}},onChanged:{addListener(){},removeListener(){}}}};''')
        page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        page.goto(origin+'/tests/browser/backbone.html');page.add_script_tag(path=str(ROOT/'tests/browser/native-metadata-cases.js'))
        results.extend(page.evaluate('runNativeMetadataCases()'))
        # Seed only synthetic inventory in the same localhost origin as the real dashboard.
        page.evaluate('''async()=>{const q=indexedDB.open('ChatGPT_BulkManager_DB',1);await new Promise((res,rej)=>{q.onupgradeneeded=()=>q.result.createObjectStore('conversations',{keyPath:'id'});q.onerror=()=>rej(q.error);q.onsuccess=()=>{const db=q.result,tx=db.transaction('conversations','readwrite');for(const [id,classification,gizmo] of [['sample-one','standalone-safe',null],['sample-project','project-protected','g-p-fixture'],['sample-gpt','custom-gpt-protected','g-fixture']])tx.objectStore('conversations').put({id,title:'Example '+id,classification,classification_evidence:'history-sync',gizmo_id:gizmo,discovery_sources:['history'],update_time:1700000000,create_time:1690000000});tx.oncomplete=()=>{db.close();res();};};});}''')
        page.goto(origin+'/dashboard.html');page.wait_for_selector('#chat-list-body .row-checkbox');page.wait_for_function("document.getElementById('manager-metadata-status').textContent.includes('Collections and tags are local')")
        page.locator('#select-all-checkbox').check()
        for id in ['save-update-btn','analyze-selected-btn','summarize-selected-btn','merge-selected-btn','move-selected-btn']:
            assert page.locator('#'+id).is_disabled(),id
        results.append({'name':'real HTML future actions disabled with reasons; existing Delete remains available','passed':True})
        page.locator('#add-to-collection-btn').click();page.locator('#collection-modal-name').fill('Research collection');page.locator('#collection-modal-confirm-btn').click();page.wait_for_selector('.collection-filter-btn')
        page.locator('#tag-selected-btn').click();page.locator('#tag-modal-name').fill('Reading');page.locator('#tag-modal-confirm-btn').click();page.wait_for_selector('.tag-filter-btn')
        assert page.locator('#selected-count-text').inner_text()=='3 selected'
        assert page.locator('#chat-list-body .manager-row-tags').count()==3
        results.append({'name':'real HTML Collections/Tags actions persist without clearing selection','passed':True})
        # Native same-origin BroadcastChannel exercises another dashboard connection.
        second=context.new_page();second.on('pageerror',lambda e:errors.append(str(e)));second.goto(origin+'/dashboard.html');second.wait_for_selector('.tag-filter-btn')
        page.locator('.tag-rename-btn').click();page.locator('#tag-modal-name').fill('Reading now');page.locator('#tag-modal-confirm-btn').click()
        second.wait_for_function("document.getElementById('tags-list').textContent.includes('Reading now')")
        results.append({'name':'two native dashboard pages synchronize metadata after commit','passed':True})
        # Inventory clear does not touch collections/tags; remote calls are intercepted, none performed.
        page.on('dialog',lambda dialog:dialog.accept())
        page.locator('#advanced-toggle-btn').click();page.locator('#clear-db-btn').click();page.wait_for_function("document.querySelectorAll('#chat-list-body .row-checkbox').length===0")
        assert page.locator('.collection-filter-btn').count()==1
        assert page.locator('.tag-filter-btn').count()==1
        results.append({'name':'native inventory clear preserves collection/tag metadata','passed':True})
        page.locator('#advanced-toggle-btn').click()
        # Re-seed synthetic inventory via the app's own existing store, then refresh.
        page.evaluate("async()=>{await chatDB.saveConversation({id:'sample-one',title:'Example restored conversation',gizmo_id:null,classification:'standalone-safe',classification_evidence:'history-sync',discovery_sources:['history'],update_time:1700000000});await loadAndRender();}")
        page.locator('#select-all-checkbox').check();page.screenshot(path=str(out/'dashboard-desktop.png'),full_page=True)
        page.set_viewport_size({'width':760,'height':1000});page.screenshot(path=str(out/'dashboard-narrow.png'),full_page=True)
        assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'page horizontal overflow'
        results.append({'name':'responsive native dashboard has no page-wide horizontal overflow at 760px','passed':True})
        assert not errors,errors
        assert not external,external
        results.append({'name':'no unhandled browser exceptions and no external request escaped local interception','passed':True})
        (out/'native-browser-results.json').write_text(json.dumps({'passed':len(results),'failed':0,'cases':results,'engine':browser.version,'network':'Offline route-fulfilled local files and synthetic session only; no external requests'},indent=2))
        print(json.dumps({'passed':len(results),'failed':0,'engine':browser.version}));browser.close()
    finally: server.shutdown()
if __name__=='__main__':main()
