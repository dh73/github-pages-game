"""Exercise production controls; --live uses real, unmodified Google embeds."""
import argparse, asyncio, json, os, re, subprocess, time
from pathlib import Path
from playwright.async_api import async_playwright

parser = argparse.ArgumentParser()
parser.add_argument('--live', action='store_true')
parser.add_argument('--engine', choices=['chromium', 'webkit'], default='chromium')
args = parser.parse_args()
root = Path(__file__).resolve().parents[2]
shots = Path(os.environ.get('SHOT_DIR', '/tmp/cuatrimoto-shots'))
shots.mkdir(parents=True, exist_ok=True)
server = subprocess.Popen(['python3', '-m', 'http.server', '8765', '--bind', '127.0.0.1'], cwd=root, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

async def state(page):
    return await page.locator('#game').evaluate('(e)=>({...e.dataset})')

async def run():
    async with async_playwright() as p:
        options = {'headless': True}
        if args.engine == 'chromium':
            if os.environ.get('CHROMIUM_PATH'): options['executable_path'] = os.environ['CHROMIUM_PATH']
            options['args'] = ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
        browser = await getattr(p, args.engine).launch(**options)
        sizes = [('phone',390,844), ('landscape',844,390), ('tablet',834,1112)] if args.live else [('phone',390,844), ('small-phone',320,568), ('landscape',844,390), ('small-landscape',568,320), ('tablet',834,1112)]
        for name, width, height in sizes:
            context = await browser.new_context(viewport={'width':width,'height':height}, is_mobile=True, has_touch=True, device_scale_factor=1)
            page = await context.new_page()
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)) if 'game.js' in (e.stack or '') or 'ride-core' in (e.stack or '') else None)
            if not args.live:
                await context.route('https://maps.google.com/**', lambda route: route.fulfill(status=200, content_type='text/html', body='<html><body style="margin:0;background:#374349;color:white"><p>TEST PANORAMA FIXTURE — NOT REAL IMAGERY</p></body></html>'))
                await page.clock.install()
            async def wait(ms):
                if args.live: await page.wait_for_timeout(ms)
                else: await page.clock.run_for(ms)
            try:
                await page.goto('http://127.0.0.1:8765/', wait_until='domcontentloaded')
                if args.live:
                    await page.wait_for_function("!document.getElementById('start').disabled", timeout=45000)
                    # Verify the provider contents, not just the parent iframe load event.
                    await page.frame_locator('#views iframe.visible').locator('body').filter(has_text=re.compile('Vicente Guerrero|P[ií]pila', re.I)).wait_for(timeout=25000)
                    body = await page.frame_locator('#views iframe.visible').locator('body').inner_text()
                    assert re.search(r'Guasave', body, re.I), body
                    assert not re.search(r'not available|no est[aá] disponible|for development purposes', body, re.I), body
                    print('LIVE STREET', name, body[:350].replace('\n',' | '), flush=True)
                    await wait(1800)
                else:
                    await wait(2300)
                assert await page.locator('#start').is_enabled()
                await page.screenshot(path=str(shots / f'{args.engine}-{name}-intro.png'))
                assert await page.locator('#map,.leaflet-container').count() == 0
                assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth')
                for button in await page.locator('.drive').all():
                    r = await button.bounding_box()
                    assert r and r['width']>=44 and r['height']>=44 and r['x']>=0 and r['y']+r['height']<=height+1, (name,r)
                road = await page.locator('#street').bounding_box()
                assert road['width']>=200 and road['height']>=200, (name,road)
                await page.locator('#start').tap()
                await wait(3250)
                assert (await state(page))['status']=='playing'
                await page.locator('#sound').tap()
                await wait(100)
                assert await page.locator('#sound').get_attribute('aria-pressed')=='true'
                # Two real simultaneous fingers in Chromium. WebKit uses the same PointerEvent path.
                if args.engine == 'chromium':
                    cdp = await context.new_cdp_session(page)
                    def point(r, i): return {'x':r['x']+r['width']/2,'y':r['y']+r['height']/2,'id':i}
                    gas = point(await page.locator('[data-key=gas]').bounding_box(),1)
                    right = point(await page.locator('[data-key=right]').bounding_box(),2)
                    await cdp.send('Input.dispatchTouchEvent', {'type':'touchStart','touchPoints':[gas,right]})
                    await wait(850)
                    st = await state(page)
                    assert float(st['speed'])>0 and float(st['lane'])>.05, st
                    await cdp.send('Input.dispatchTouchEvent', {'type':'touchCancel','touchPoints':[]})
                else:
                    for key, pointer in [('gas',1),('right',2)]:
                        await page.locator(f'[data-key={key}]').dispatch_event('pointerdown', {'pointerId':pointer,'pointerType':'touch','buttons':1})
                    await wait(850)
                    st = await state(page)
                    assert float(st['speed'])>0 and float(st['lane'])>.05, st
                    for key,pointer in [('gas',1),('right',2)]:
                        await page.locator(f'[data-key={key}]').dispatch_event('pointercancel', {'pointerId':pointer,'pointerType':'touch'})
                assert await page.locator('.drive.active').count()==0
                await page.keyboard.down('w'); await wait(6500); await page.keyboard.up('w')
                st = await state(page)
                assert float(st['distance'])>17 and int(st['photo'])>=1, st
                assert await page.locator('#views iframe').count()<=3
                await page.screenshot(path=str(shots / f'{args.engine}-{name}-driving.png'))
                # Regression for the previous resume failure; do it twice, with iframe focus/blur.
                for _ in range(2):
                    await page.locator('#pause').tap(); await wait(200)
                    frozen = await state(page); await wait(800)
                    assert (await state(page))['distance']==frozen['distance']
                    assert (await state(page))['elapsed']==frozen['elapsed']
                    await page.locator('#resume').tap(); await wait(200)
                    assert (await state(page))['status']=='playing', await state(page)
                    await page.evaluate("window.dispatchEvent(new Event('blur'))")
                    await wait(150)
                    assert (await state(page))['status']=='playing'
                # Network interruption/repair must preserve distance and not collect unseen seals.
                await page.evaluate("window.dispatchEvent(new Event('offline'))")
                before = await state(page)
                assert (await state(page))['status']=='error'
                await wait(1000)
                assert (await state(page))['distance']==before['distance']
                await page.locator('#retry').tap()
                if args.live: await page.wait_for_function("!document.getElementById('resume').disabled", timeout=45000)
                else: await wait(2300)
                await page.locator('#resume').tap(); await wait(100)
                assert (await state(page))['status']=='playing'
                await page.locator('#pause').tap(); await page.locator('#restart-pause').tap()
                if args.live: await page.wait_for_function("!document.getElementById('start').disabled", timeout=45000)
                else: await wait(2300)
                assert float((await state(page))['distance'])==0
                assert int((await state(page))['score'])==0
                # Complete one challenge through actual keyboard controls, no state injection.
                if name=='phone':
                    await page.locator('#start').tap(); await wait(3250)
                    await page.keyboard.down('w')
                    direction = None; deadline = time.monotonic()+210
                    seen = set()
                    while (await state(page))['status']=='playing' and time.monotonic()<deadline:
                        st = await state(page)
                        cue = await page.locator('#next-object').evaluate('(e)=>({...e.dataset})')
                        lane = float(cue['lane'])
                        target = lane if cue['kind']=='seal' else (.55 if lane<=0 else -.55) if cue['kind']=='cone' else 0
                        diff = target-float(st['lane'])
                        key = 'd' if diff>.065 else 'a' if diff<-.065 else None
                        if key != direction:
                            if direction: await page.keyboard.up(direction)
                            if key: await page.keyboard.down(key)
                            direction=key
                        if args.live and st['photo'] not in seen:
                            label = await page.frame_locator('#views iframe.visible').locator('body').inner_text()
                            assert re.search(r'Vicente Guerrero|P[ií]pila',label,re.I), (st,label)
                            seen.add(st['photo'])
                        await wait(100)
                    await page.keyboard.up('w')
                    if direction: await page.keyboard.up(direction)
                    st=await state(page)
                    assert st['status']=='finished',st
                    assert int(st['collected'])==8 and int(st['hits'])==0,st
                    assert await page.locator('#result-stars').get_attribute('aria-label')=='3 de 3 estrellas'
                    assert float(st['distance'])>400 and int(st['photo'])==25,st
                    await page.screenshot(path=str(shots / f'{args.engine}-{name}-finish.png'))
                    print('FULL CHALLENGE',args.engine, 'LIVE' if args.live else 'FIXTURE',json.dumps(st),'verified panoramas',len(seen),flush=True)
                    await page.reload(wait_until='domcontentloaded')
                    if not args.live: await wait(2300)
                    await page.wait_for_function("document.getElementById('best').textContent.includes('TU RÉCORD')", timeout=30000)
                assert not errors,errors
                print('PASS',args.engine,name,'controls, brake release, pause/resume, network repair, restart, layout',flush=True)
            except Exception as exc:
                print('FAILED',args.engine,name,repr(exc),errors,flush=True)
                try: await page.screenshot(path=str(shots / f'{args.engine}-{name}-FAIL.png'))
                except Exception: pass
                raise
            finally: await context.close()
        if args.live:
            context = await browser.new_context(viewport={'width':1024,'height':768})
            page = await context.new_page()
            await page.goto('https://dh73.github.io/github-pages-game/?v=release-2', wait_until='domcontentloaded')
            await page.wait_for_function("document.getElementById('game')?.dataset.version === '2.0'", timeout=60000)
            await page.wait_for_function("!document.getElementById('start').disabled", timeout=45000)
            label = await page.frame_locator('#views iframe.visible').locator('body').inner_text()
            assert re.search(r'Vicente Guerrero|P[ií]pila', label, re.I), label
            await page.locator('#start').click(); await page.wait_for_timeout(3300)
            await page.keyboard.down('w'); await page.wait_for_timeout(1800); await page.keyboard.up('w')
            assert float((await state(page))['distance'])>0
            await page.screenshot(path=str(shots/'published.png'))
            print('PASS PUBLISHED GITHUB PAGES', await page.title(), json.dumps(await state(page)), flush=True)
            await context.close()
        await browser.close()
try: asyncio.run(run())
finally: server.terminate(); server.wait()
