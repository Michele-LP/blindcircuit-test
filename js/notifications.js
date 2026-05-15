// ═══════════════════════════════════════════════════════════════════════════
//  NOTIFICATIONS.JS — v6.6  — Toast, Log, Tooltip
// ═══════════════════════════════════════════════════════════════════════════

const Toast = {
  _container: null, _max: 5,
  _init() { if(this._container)return; this._container=document.createElement('div'); this._container.id='toast-container'; document.body.appendChild(this._container); },
  show(message, opts={}) {
    this._init();
    const t=document.createElement('div'); t.className='toast'+(opts.type?' toast-'+opts.type:'');
    if(opts.color)t.style.borderLeftColor=opts.color; t.textContent=message;
    while(this._container.children.length>=this._max) this._container.removeChild(this._container.firstChild);
    this._container.appendChild(t);
    requestAnimationFrame(()=>t.classList.add('show'));
    setTimeout(()=>{t.classList.remove('show');setTimeout(()=>t.remove(),300);},opts.duration??3000);
  },
  clear(){if(this._container)this._container.innerHTML='';},
};

const Log = {
  _container: null, _max: 100,
  _init(){this._container=document.getElementById('action-log');},
  add(message, opts={}) {
    this._init(); if(!this._container) return;
    const e=document.createElement('div'); e.className='log-entry'+(opts.type?' log-'+opts.type:'');
    if(opts.color)e.style.borderLeftColor=opts.color;
    const t=new Date(),hh=String(t.getHours()).padStart(2,'0'),mm=String(t.getMinutes()).padStart(2,'0'),ss=String(t.getSeconds()).padStart(2,'0');
    const te=document.createElement('span');te.className='log-time';te.textContent=`${hh}:${mm}:${ss}`;
    const me=document.createElement('span');me.className='log-msg';me.textContent=message;
    e.appendChild(te);e.appendChild(me);this._container.appendChild(e);
    while(this._container.children.length>this._max) this._container.removeChild(this._container.firstChild);
    this._container.scrollTop=this._container.scrollHeight;
  },
  clear(){this._init();if(this._container)this._container.innerHTML='';},
};

const Tooltip = {
  _el: null,
  init() {
    if(this._el)return; this._el=document.createElement('div');this._el.id='custom-tooltip';this._el.style.display='none';document.body.appendChild(this._el);
    document.addEventListener('mouseover',e=>{const t=e.target.closest('[data-tooltip]');if(!t)return;this._el.textContent=t.dataset.tooltip;this._el.style.borderLeftColor=t.dataset.tooltipColor||'#1f6feb';this._el.style.display='block';this._move(e);});
    document.addEventListener('mousemove',e=>{if(this._el.style.display!=='none')this._move(e);});
    document.addEventListener('mouseout',e=>{if(e.target.closest('[data-tooltip]'))this._el.style.display='none';});
  },
  _move(e){const P=14,r=this._el.getBoundingClientRect();let x=e.clientX+P,y=e.clientY+P;if(x+r.width>window.innerWidth)x=e.clientX-r.width-P;if(y+r.height>window.innerHeight)y=e.clientY-r.height-P;this._el.style.left=x+'px';this._el.style.top=y+'px';},
};

document.addEventListener('DOMContentLoaded',()=>Tooltip.init());
