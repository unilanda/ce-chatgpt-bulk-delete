#!/usr/bin/env python3
"""Real Chromium DOM/CSS smoke with injected storage/runtime fakes; fully offline.
This tests rendering/wiring, NOT native IndexedDB persistence or extension runtime.
"""
import argparse,json,re
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[2]
def main():
 p=argparse.ArgumentParser();p.add_argument('--output',required=True);p.add_argument('--chromium',default='/usr/bin/chromium');args=p.parse_args();out=Path(args.output);out.mkdir(parents=True,exist_ok=True)
 html=(ROOT/'dashboard.html').read_text();scripts=re.findall(r'<script src="([^"]+)"></script>',html)
 html=re.sub(r'<script[^>]*>.*?</script>','',html,flags=re.S)
 html=re.sub(r'<link[^>]*href="dashboard.css"[^>]*>',lambda _: '<style>'+(ROOT/'dashboard.css').read_text()+'</style>',html)
 fake=(ROOT/'tests/helpers/dashboard-harness.js').read_text();fake=fake[fake.index('function requestWith('):fake.index('function conversationRecord(')]
 records=[{'id':'sample-one','title':'Example standalone conversation','gizmo_id':None,'classification':'standalone-safe'}, {'id':'sample-project','title':'Example Project conversation','gizmo_id':'g-p-fixture','classification':'project-protected'}, {'id':'sample-custom','title':'Example Custom GPT conversation','gizmo_id':'g-fixture','classification':'custom-gpt-protected'}]
 for row in records:row.update(classification_evidence='history-sync',discovery_sources=['history'],update_time=1700000000)
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path=args.chromium,headless=True,args=['--no-sandbox']);page=browser.new_page(viewport={'width':1365,'height':1000});page.set_default_timeout(7000);errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.route('**/*',lambda route:route.abort());page.set_content(html)
  page.add_script_tag(content=fake+'\nObject.defineProperty(globalThis,"indexedDB",{value:new FakeIndexedDB('+json.dumps(records)+'),configurable:true});')
  page.add_script_tag(content='''if(!crypto.randomUUID){let fixtureId=0;crypto.randomUUID=()=>`offline-fixture-${++fixtureId}`;}globalThis.BroadcastChannel=undefined;globalThis.chrome={runtime:{getManifest:()=>({permissions:['storage','alarms']}),sendMessage:async()=>({ok:true,job:null})},storage:{local:{get:async()=>({delete_interval_seconds:600}),set:async()=>{}},onChanged:{addListener(){},removeListener(){}}}};globalThis.fetch=async url=>{if(url==='https://chatgpt.com/api/auth/session')return new Response(JSON.stringify({accessToken:'synthetic-session-not-live'}),{status:200});throw new Error('Offline test forbids network');};''')
  for script in scripts:
   print('Injecting',script,flush=True);page.add_script_tag(content=(ROOT/script).read_text())
  print('Errors',errors,flush=True);print(page.locator('#manager-metadata-status').inner_text(),flush=True)
  page.wait_for_selector('#chat-list-body .row-checkbox');page.wait_for_function("document.getElementById('manager-metadata-status').textContent.includes('Collections and tags are local')")
  page.locator('#select-all-checkbox').check()
  for id in ['save-update-btn','analyze-selected-btn','summarize-selected-btn','merge-selected-btn','move-selected-btn']:assert page.locator('#'+id).is_disabled(),id
  page.locator('#add-to-collection-btn').click();page.locator('#collection-modal-name').fill('RNA research');page.locator('#collection-modal-confirm-btn').click();print('COLLECTION STATUS',page.locator('#collection-modal-status').inner_text(),flush=True);page.wait_for_selector('.collection-filter-btn')
  page.locator('#tag-selected-btn').click();page.locator('#tag-modal-name').fill('Read next');page.locator('#tag-modal-confirm-btn').click();page.wait_for_selector('.tag-filter-btn')
  assert page.locator('#selected-count-text').inner_text()=='3 selected'
  page.locator('.tag-rename-btn').click();page.locator('#tag-modal-name').fill('Important');page.locator('#tag-modal-confirm-btn').click();page.wait_for_function("document.getElementById('tags-list').textContent.includes('Important')")
  page.locator('#manager-view-filter').select_option('projects');assert page.locator('#chat-list-body .row-checkbox').count()==1
  page.locator('#manager-view-filter').select_option('all')
  page.evaluate('window.scrollTo(0,0)');page.screenshot(path=str(out/'dashboard-desktop.png'),full_page=True);page.screenshot(path=str(out/'dashboard-viewport.png'))
  page.set_viewport_size({'width':760,'height':1000});page.evaluate('window.scrollTo(0,0)');page.screenshot(path=str(out/'dashboard-narrow.png'),full_page=True)
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),'page overflow at 760px'
  assert not errors,errors
  report={'passed':7,'failed':0,'engine':browser.version,'storage':'Injected synthetic IndexedDB; native IndexedDB NOT tested','network':'No external requests; synthetic session only','cases':['real dashboard script initialization','disabled future actions with reasons','collection create/add mixed types','tag create/add/rename','selection preserved','Projects view filters actual type','responsive layout at 760px without page overflow']}
  (out/'renderer-results.json').write_text(json.dumps(report,indent=2));print(json.dumps(report));browser.close()
if __name__=='__main__':main()
