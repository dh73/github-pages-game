"""Validate the exact production panorama URLs, never uncommitted alternatives."""
import asyncio, json, re, subprocess, tempfile
from pathlib import Path
from playwright.async_api import async_playwright
root=Path(__file__).resolve().parents[2]
photos=json.loads(subprocess.check_output(['node','--input-type=module','-e',"import {PHOTOS, streetURL} from './ride-core.mjs'; console.log(JSON.stringify(PHOTOS.map(p=>({...p,url:streetURL(p)}))));"],cwd=root,text=True))
async def main(port):
  async with async_playwright() as pw:
    browser=await pw.chromium.launch(args=['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
    page=await browser.new_page(viewport={'width':640,'height':480})
    await page.goto(f'http://127.0.0.1:{port}',wait_until='domcontentloaded')
    unresolved=[]
    for i,p in enumerate(photos):
      await page.evaluate('url=>{document.body.replaceChildren();const f=document.createElement("iframe");f.style="width:640px;height:480px;border:0";f.src=url;document.body.append(f)}',p['url'])
      body=page.frame_locator('iframe').locator('body')
      try:
        await body.filter(has_text='Guasave').wait_for(timeout=18000)
        label=await body.inner_text()
        valid=bool(re.search('Vicente Guerrero|P[ií]pila',label,re.I))
        print('PRODUCTION PHOTO',json.dumps({'index':i,'location':[p['lat'],p['lng']],'label':label[:250],'valid':valid},ensure_ascii=False),flush=True)
        if not valid: unresolved.append(i)
      except Exception as error:
        print('LOAD FAILURE',i,str(error),flush=True);unresolved.append(i)
    await browser.close()
    assert not unresolved, f'Production panorama failures: {unresolved}'
with tempfile.TemporaryDirectory() as directory:
  Path(directory,'index.html').write_text('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>')
  server=subprocess.Popen(['python3','-m','http.server','8766','--bind','127.0.0.1','--directory',directory],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  try: asyncio.run(main(8766))
  finally: server.terminate(); server.wait()
