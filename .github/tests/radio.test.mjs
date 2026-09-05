import test from 'node:test';
import assert from 'node:assert/strict';
import {installRadio,TRACKS,SPOTIFY_ARTIST} from '../../radio.mjs';
function fixture(){
  const saved={document:globalThis.document,window:globalThis.window,location:globalThis.location};
  class Element {
    constructor(tag='div'){this.tag=tag;this.children=[];this.attrs={};this.events={};this.style={};this.value='';this.paused=true;this.classList={add(){},remove(){}};}
    append(...items){for(const item of items){item.parentNode=this;this.children.push(item);if(this.tag==='select'&&this.children.length===1)this.value=item.value;}}
    insertBefore(item,before){item.parentNode=this;this.children.splice(this.children.indexOf(before),0,item);}
    replaceChildren(...items){this.children=[];this.append(...items);}
    setAttribute(k,v){this.attrs[k]=v;}
    removeAttribute(k){delete this.attrs[k];delete this[k];}
    addEventListener(k,fn){(this.events[k]??=[]).push(fn);}
    async fire(k){for(const fn of this.events[k]||[])await fn();}
    querySelector(tag){for(const child of this.children){if(child.tag===tag)return child;const found=child.querySelector(tag);if(found)return found;}return null;}
    pause(){this.paused=true;}play(){this.paused=false;return Promise.resolve();}load(){}
  }
  const ids={};for(const id of ['radio-toggle','radio-panel','radio-player','radio-track','radio-next','radio-link','radio-note','radio-close'])ids[id]=new Element(id==='radio-track'?'select':'div');
  const row=new Element();row.append(ids['radio-track'],ids['radio-next']);
  const doc=new Element();doc.hidden=false;doc.getElementById=id=>ids[id];doc.createElement=tag=>new Element(tag);
  globalThis.document=doc;globalThis.window=new Element();globalThis.location={origin:'https://dh73.github.io'};
  const root=new Element();const api=installRadio(root);
  return {ids,source:row.children[0],doc,api,restore(){api.close();Object.assign(globalThis,saved);}};
}
test('radio is lazy and retains all five existing YouTube songs and next control',async()=>{
 const f=fixture();try{
  assert.equal(TRACKS.length,5);assert.equal(f.ids['radio-track'].children.length,5);
  assert.equal(f.ids['radio-player'].children.length,0);
  await f.ids['radio-toggle'].fire('click');
  assert.match(f.ids['radio-player'].children[0].src,/youtube-nocookie\.com\/embed\/BJhj7KrrPSg/);
  await f.ids['radio-next'].fire('click');
  assert.match(f.ids['radio-player'].children[0].src,/\/1wauorb3vyg\?/);
 }finally{f.restore();}
});
test('Spotify switches source without simultaneous players or a copied audio file',async()=>{
 const f=fixture();try{
  await f.ids['radio-toggle'].fire('click');f.source.value='spotify';await f.source.fire('change');
  const mount=f.ids['radio-player'];assert.equal(mount.children.length,1);
  assert.equal(mount.children[0].src,`https://open.spotify.com/embed/artist/${SPOTIFY_ARTIST}?theme=0`);
  assert.match(mount.children[0].allow,/encrypted-media/);assert.equal(f.ids['radio-next'].disabled,true);
  assert.equal(f.ids['radio-link'].textContent,'Abrir en Spotify');
  await f.ids['radio-close'].fire('click');assert.equal(mount.children.length,0);
 }finally{f.restore();}
});
test('local files use device blob URLs, native playback and stop when closed',async()=>{
 const f=fixture();let url;
 try{
  await f.ids['radio-toggle'].fire('click');f.source.value='local';await f.source.fire('change');
  const mount=f.ids['radio-player'];const picker=mount.querySelector('input');
  const file=new Blob(['test audio'],{type:'audio/wav'});file.name='<safe title>.wav';picker.files=[file];
  await picker.fire('change');
  const audio=mount.querySelector('audio');url=audio.src;assert.match(url,/^blob:/);
  assert.equal(mount.querySelector('iframe'),null);assert.equal(audio.paused,false);
  assert.equal(mount.querySelector('select').children[0].textContent,'<safe title>.wav');
  assert.equal(f.ids['radio-next'].disabled,false);
  await f.ids['radio-close'].fire('click');assert.equal(audio.paused,true);assert.equal(mount.children.length,0);
 }finally{if(url)URL.revokeObjectURL(url);f.restore();}
});
test('hidden tabs stop media and never restart a closed radio',async()=>{
 const f=fixture();try{
  await f.ids['radio-toggle'].fire('click');f.doc.hidden=true;await f.doc.fire('visibilitychange');
  assert.equal(f.ids['radio-player'].children.length,0);
  f.doc.hidden=false;await f.doc.fire('visibilitychange');assert.equal(f.ids['radio-player'].children.length,1);
  f.api.close();f.doc.hidden=true;await f.doc.fire('visibilitychange');f.doc.hidden=false;await f.doc.fire('visibilitychange');
  assert.equal(f.ids['radio-player'].children.length,0);
 }finally{f.restore();}
});
