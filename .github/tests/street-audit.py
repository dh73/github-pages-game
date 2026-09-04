"""Check the native street-photo selection and keep its visible Maps links in CI."""
import asyncio, json, re, subprocess
from pathlib import Path
from urllib.parse import urlencode
from playwright.async_api import async_playwright
root=Path(__file__).resolve().parents[2]
photos=json.loads(subprocess.check_output(['node','--input-type=module','-e',"import {PHOTOS, pointAt} from './ride-core.mjs'; console.log(JSON.stringify(PHOTOS.map(p=>({...p, alternatives:[-7,7,11].map(delta=>({...pointAt(p.distance+delta),delta}))}))));"],cwd=root,text=True))
async def main():
  async with async_playwright() as pw:
    browser=await pw.chromium.launch(args=['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
    page=await browser.new_page(viewport={'width':640,'height':480})
    for i,p in enumerate(photos):
      candidates=[{**p,'delta':0}]+p['alternatives']
      for candidate in candidates:
        url='https://maps.google.com/maps?'+urlencode({'layer':'c','cbll':f"{candidate['lat']:.7f},{candidate['lng']:.7f}",'cbp':f"12,{candidate['heading']:.1f},,0,0",'source':'embed','output':'svembed','hl':'es'})
        await page.goto(url,wait_until='domcontentloaded')
        await page.locator('body').filter(has_text='Guasave').wait_for(timeout=25000)
        label=await page.locator('body').inner_text()
        links=await page.locator('a[href]').evaluate_all('(nodes)=>nodes.map(n=>({text:n.textContent,href:n.href}))')
        valid=bool(re.search('Vicente Guerrero|P[ií]pila',label,re.I))
        print('PHOTO',json.dumps({'index':i,'delta':candidate['delta'],'location':[candidate['lat'],candidate['lng']],'label':label[:250],'valid':valid,'links':links},ensure_ascii=False),flush=True)
        if valid: break
      if not valid: print('UNRESOLVED',i,flush=True)
    await browser.close()
asyncio.run(main())
