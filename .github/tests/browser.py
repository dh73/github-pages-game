import argparse,asyncio,functools,http.server,json,math,os,pathlib,struct,threading,time,wave,io
from playwright.async_api import async_playwright
parser=argparse.ArgumentParser();parser.add_argument('--engine',default='chromium',choices=['chromium','webkit']);parser.add_argument('--live',action='store_true');args=parser.parse_args()
root=pathlib.Path(__file__).resolve().parents[2];shots=pathlib.Path('/tmp/cuatrimoto-shots');shots.mkdir(exist_ok=True)
class Handler(http.server.SimpleHTTPRequestHandler):
 def log_message(self,*a): pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(root)))
threading.Thread(target=server.serve_forever,daemon=True).start()
base='https://dh73.github.io/github-pages-game/?v=route-4' if args.live else f'http://127.0.0.1:{server.server_port}/'
async def state(page): return await page.locator('#game').evaluate('(e)=>({...e.dataset})')
async def run():
 async with async_playwright() as p:
  opts={'headless':True}
  if args.engine=='chromium':opts['args']=['--enable-unsafe-swiftshader','--use-angle=swiftshader']
  browser=await getattr(p,args.engine).launch(**opts)
  sizes=[(393,852),(844,390),(320,568),(834,1112)] if not args.live else [(393,852)]
  for idx,(width,height) in enumerate(sizes):
   context=await browser.new_context(viewport={'width':width,'height':height},device_scale_factor=1,has_touch=True,is_mobile=True)
   page=await context.new_page();errors=[];requests=[]
   page.on('pageerror',lambda e:errors.append(str(e)))
   page.on('request',lambda r:requests.append(r.url))
   try:
    await page.goto(base,wait_until='networkidle');await page.wait_for_function("document.getElementById('game')?.dataset.sceneReady === 'true'",timeout=60000)
    assert (await state(page))['version']=='4.0'
    assert await page.locator('iframe').count()==0
    assert not any('google.com/maps' in u or 'gstatic' in u for u in requests),requests
    for b in await page.locator('.drive').all():
     r=await b.bounding_box();assert r['width']>=44 and r['height']>=44 and r['x']>=0 and r['x']+r['width']<=width+1 and r['y']+r['height']<=height+1,r
    await page.screenshot(path=str(shots/f'{args.engine}-{width}-intro.png'))
    # No scenery requests can succeed after this point; full play is genuinely offline.
    count=len(requests);await context.set_offline(True)
    await page.locator('#start').tap();await page.wait_for_function("document.getElementById('game').dataset.status === 'playing'",timeout=10000)
    await page.wait_for_function("cuatrimoto.diagnostics().audio.rms > .001",timeout=15000)
    diag=await page.evaluate('cuatrimoto.diagnostics()');assert diag['audio']['state']=='running',diag
    assert diag['audio']['rms']>.001,diag
    assert diag['audio']['peak']<.99,diag
    # Simultaneous controls, cancel, camera, engine mute and resume.
    for k,i in [('gas',1),('right',2)]:await page.locator(f'[data-key={k}]').dispatch_event('pointerdown',{'pointerId':i,'pointerType':'touch','buttons':1})
    await page.wait_for_function("Number(document.getElementById('game').dataset.lane)>.12 && Number(document.getElementById('game').dataset.speed)>0",timeout=20000)
    st=await state(page);assert float(st['speed'])>0 and float(st['lane'])>.05,st
    for k,i in [('gas',1),('right',2)]:await page.locator(f'[data-key={k}]').dispatch_event('pointercancel',{'pointerId':i,'pointerType':'touch'})
    await page.locator('#camera').tap();await page.wait_for_timeout(200);assert (await state(page))['camera']=='driver'
    await page.screenshot(path=str(shots/f'{args.engine}-{width}-driver.png'))
    await page.locator('#camera').tap()
    await page.locator('#sound').tap();await page.wait_for_timeout(500)
    assert (await page.evaluate('cuatrimoto.diagnostics()'))['audio']['rms']<.0001
    await page.locator('#sound').tap();await page.wait_for_timeout(400)
    assert (await page.evaluate('cuatrimoto.diagnostics()'))['audio']['rms']>.001
    await page.locator('#pause').tap();await page.wait_for_timeout(300);before=(await state(page))['distance'];await page.wait_for_timeout(500);assert (await state(page))['distance']==before
    await page.locator('#resume').tap();await page.wait_for_timeout(300)
    assert (await page.evaluate('cuatrimoto.diagnostics()'))['audio']['starts']==1
    assert len(requests)==count,requests[count:]
    if idx==0:
     await page.locator('#pause').tap();await page.locator('#restart-pause').tap();await page.locator('#start').tap()
     await page.wait_for_function("document.getElementById('game').dataset.status === 'playing'")
     await page.keyboard.down('w');direction=None;until=time.monotonic()+110
     while time.monotonic()<until:
      st=await state(page)
      if st['status']=='finished':break
      assert st['status']=='playing',st
      cue=await page.locator('#next-object').evaluate('(e)=>({...e.dataset})');lane=float(cue['lane'])
      target=lane if cue['kind']=='seal' else (.55 if lane<=0 else -.55) if cue['kind']=='cone' else 0
      diff=target-float(st['lane'])-float(st['lateralSpeed'])*.2/2.8
      key='d' if diff>.05 else 'a' if diff<-.05 else None
      if key!=direction:
       if direction:await page.keyboard.up(direction)
       if key:await page.keyboard.down(key)
       direction=key
      await page.wait_for_timeout(35)
     await page.keyboard.up('w')
     if direction:await page.keyboard.up(direction)
     st=await state(page);assert st['status']=='finished' and float(st['distance'])>410,st
     assert int(st['collected'])>=6,st
     assert len(requests)==count,requests[count:]
     await page.screenshot(path=str(shots/f'{args.engine}-{width}-finish.png'))
     print('OFFLINE COMPLETE',args.engine,json.dumps(st),flush=True)
    await page.screenshot(path=str(shots/f'{args.engine}-{width}-drive.png'))
    print('RENDER',args.engine,width,json.dumps(await page.evaluate('cuatrimoto.diagnostics()')),flush=True)
    # Optional music UI: local audio is decoded and played, not a silent placeholder.
    await page.locator('#radio-toggle').tap();await page.wait_for_timeout(100)
    assert await page.locator('#radio-track option').count()==5
    assert await page.locator('#radio-player iframe').count()==0
    assert (await state(page))['music']=='offline'
    wav=io.BytesIO()
    with wave.open(wav,'wb') as w:
     w.setparams((1,2,24000,0,'NONE','not compressed'));w.writeframes(b''.join(struct.pack('<h',int(math.sin(i/24000*440*math.tau)*1000)) for i in range(24000*3)))
    tone=shots/f'{args.engine}-{width}-audio.wav';tone.write_bytes(wav.getvalue())
    await page.locator('#music-file').set_input_files(str(tone))
    await page.wait_for_function("document.getElementById('local-audio').getAttribute('src')?.startsWith('data:audio/')",timeout=10000)
    await page.locator('#radio-play').click()
    try:await page.wait_for_function("document.getElementById('local-audio').readyState>=2 && document.getElementById('local-audio').currentTime>0",timeout=12000)
    except Exception:
     print('MEDIA ERROR',await page.locator('#local-audio').evaluate('(e)=>({src:e.currentSrc.slice(0,70),state:e.readyState,network:e.networkState,error:e.error?.message,support:e.canPlayType("audio/wav"),paused:e.paused})'),flush=True);raise
    media=await page.locator('#local-audio').evaluate('(e)=>({time:e.currentTime,paused:e.paused,ready:e.readyState})');assert media['time']>0 and not media['paused'] and media['ready']>=2,media
    await page.locator('#radio-close').tap();assert await page.locator('iframe').count()==0
    assert await page.locator('#local-audio').evaluate('(e)=>e.paused')
    assert not errors,errors
    print('PASS',args.engine,width,height,'audio RMS',diag['audio']['rms'],'route offline',flush=True)
   except Exception:
    print('FAILED',args.engine,width,'STATE',await state(page),'ERRORS',errors,flush=True)
    print('GAME ERROR',await page.locator('#error-message').text_content(),'RADIO',await page.locator('#radio-note').text_content(),flush=True)
    await page.screenshot(path=str(shots/f'{args.engine}-{width}-failure.png'));raise
   await context.close()
  await browser.close()
try:asyncio.run(run())
finally:server.shutdown()
