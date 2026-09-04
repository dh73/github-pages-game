"""Check native street-photo selection in an ordinary HTTP embedding page."""
import asyncio, json, re, subprocess, tempfile
from pathlib import Path
from urllib.parse import urlencode
from playwright.async_api import async_playwright
root=Path(__file__).resolve().parents[2]
photos=json.loads(subprocess.check_output(['node','--input-type=module','-e',"import {PHOTOS, pointAt} from './ride-core.mjs'; console.log(JSON.stringify(PHOTOS.map(p=>({...p, alternatives:[-7,7,11].map(delta=>({...pointAt(p.distance+delta),delta}))}))));"],cwd=root,text=True))
async def main(port):
  async with async_playwright() as pw:
    browser=await pw.chromium.launch(args=['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
    page=await browser.new_page(viewport={'width':640,'height':480})
    await page.goto(f'http://127.0.0.1:{port}',wait_until='domcontentloaded')
    unresolved=[]
    for i,p in enumerate(photos):
      candidates=[{**p,'delta':0}]+p['alternatives']
      valid=False
      for candidate in candidates:
        url='https://maps.google.com/maps?'+urlencode({'layer':'c','cbll':f"{candidate['lat']:.7f},{candidate['lng']:.7f}",'cbp':f"12,{candidate['heading']:.1f},,0,0",'source':'embed','output':'svembed','hl':'es'})
        await page.evaluate('url=>{document.body.replaceChildren();const f=document.createElement("iframe");f.style="width:640px;height:480px;border:0";f.src=url;document.body.append(f)}',url)
        body=page.frame_locator('iframe').locator('body')
        try: await body.filter(has_text='Guasave').wait_for(timeout=18000)
        except Exception: print('LOAD FAILURE',i,candidate['delta'],await body.inner_text(timeout=3000),flush=True); continue
        label=await body.inner_text()
        links=await page.frame_locator('iframe').locator('a[href]').evaluate_all('(nodes)=>nodes.map(n=>({text:n.textContent,href:n.href}))')
        valid=bool(re.search('Vicente Guerrero|P[ií]pila',label,re.I))
        print('PHOTO',json.dumps({'index':i,'delta':candidate['delta'],'location':[candidate['lat'],candidate['lng']],'label':label[:250],'valid':valid,'links':links},ensure_ascii=False),flush=True)
        if valid: break
      if not valid: unresolved.append(i)
    await browser.close()
    assert not unresolved, f'Unresolved street references: {unresolved}'
with tempfile.TemporaryDirectory() as directory:
  Path(directory,'index.html').write_text('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>')
  server=subprocess.Popen(['python3','-m','http.server','8766','--bind','127.0.0.1','--directory',directory],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  try: asyncio.run(main(8766))
  finally: server.terminate(); server.wait()
