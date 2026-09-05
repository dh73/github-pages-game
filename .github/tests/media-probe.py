import asyncio,json,pathlib,sys
from playwright.async_api import async_playwright
async def main():
 async with async_playwright() as p:
  b=await p.webkit.launch(headless=True)
  c=await b.new_context();page=await c.new_page();await page.set_content('<input id="f" type="file">')
  path=pathlib.Path('/tmp/route-file-probe.txt');path.write_text('route-native-file-check')
  for offline in [False,True,False]:
   await c.set_offline(offline)
   await page.locator('#f').set_input_files(str(path))
   result=await page.evaluate('''async()=>{
    const f=document.getElementById('f').files[0];
    const read=blob=>new Promise(resolve=>{const r=new FileReader();r.onload=()=>resolve({ok:true,result:r.result});r.onerror=()=>resolve({ok:false,name:r.error?.name,message:r.error?.message});r.readAsText(blob);});
    return {online:navigator.onLine,file:{name:f.name,size:f.size,type:f.type},native:await read(f),memory:await read(new Blob(['memory-file-check']))};
   }''')
   print('FILE PROBE',offline,json.dumps(result),flush=True)
  await b.close()
asyncio.run(main())
