(()=>{'use strict';
const API=window.APP_CONFIG.API_URL;
const builtins=[
  {id:'studentServicesBox',kind:'builtin',title:'บริการนักศึกษา',visible:true},
  {id:'readBookTimeBox',kind:'builtin',title:'อ่านหนังสือสะสมเวลา',visible:true},
  {id:'learningSourceBox',kind:'builtin',title:'แหล่งเรียนรู้',visible:true},
  {id:'bestPracticeBox',kind:'builtin',title:'Best Practice',visible:true},
  {id:'FBpostBox',kind:'builtin',title:'Facebook',visible:true},
  {id:'cliproomBox',kind:'builtin',title:'หลักสูตรออนไลน์',visible:true},
  {id:'learningBaseModule',kind:'builtin',title:'ช้อปกิจกรรม',visible:true}
];
const builtinIds=new Set(builtins.map(x=>x.id));
let layout=builtins.map(x=>({...x})),saving=false,pendingSave=false;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const clamp=(n,min,max)=>Math.min(max,Math.max(min,Number(n)||min));
function customId(){return 'custom-section-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8)}
function normalizeItem(raw){
  const id=String(raw?.id||'').trim();
  const builtin=builtinIds.has(id);
  if(!id||(!builtin&&!/^custom-section-[a-z0-9-]+$/i.test(id)))return null;
  const base=builtin?builtins.find(x=>x.id===id):null;
  const rawType=String(raw?.sourceType||'url').toLowerCase();
  return {
    id,
    kind:builtin?'builtin':'custom',
    title:String(raw?.title||base?.title||'SECTION ใหม่').trim().slice(0,120)||'SECTION ใหม่',
    visible:raw?.visible!==false,
    sourceType:builtin?'':(rawType==='embed'?'embed':(rawType==='image'?'image':'url')),
    source:builtin?'':String(raw?.source||''),
    height:builtin?0:clamp(raw?.height||620,260,1600),
    detailUrl:builtin?'':String(raw?.detailUrl||'').trim(),
    buttonLabel:builtin?'':String(raw?.buttonLabel||'').trim().slice(0,60)
  };
}
function normalize(items){
  const incoming=Array.isArray(items)?items:[];
  const out=[],seen=new Set();
  incoming.forEach(raw=>{const item=normalizeItem(raw);if(item&&!seen.has(item.id)){seen.add(item.id);out.push(item)}});
  builtins.forEach(base=>{if(seen.has(base.id))return;if(base.id==='readBookTimeBox'){const at=out.findIndex(item=>item.id==='studentServicesBox');if(at>=0)out.splice(at+1,0,{...base});else out.unshift({...base});}else out.push({...base})});
  return out;
}
async function getLayout(){
  if(window.SiteFast?.getHomeFast){
    try{
      const home=await window.SiteFast.getHomeFast();
      const homeData=home?.data||home||{};
      if(Array.isArray(homeData.sectionLayout))return normalize(homeData.sectionLayout);
    }catch(e){console.warn('sectionLayout homefast fallback:',e)}
  }
  if(window.SiteFast?.fetchMode){
    const j=await window.SiteFast.fetchMode('sectionlayout',{}, {key:'section-layout-v3',ttl:5*60*1000,staleTtl:24*60*60*1000});
    if(j?.success===false)throw new Error(j.message||'โหลดการจัดเรียง Section ไม่สำเร็จ');
    return normalize(j?.items||[]);
  }
  const r=await fetch(API+'?mode=sectionlayout&_t='+Date.now(),{cache:'no-store'}),j=await r.json();
  if(!r.ok||j.success===false)throw new Error(j.message||'โหลดการจัดเรียง Section ไม่สำเร็จ');
  return normalize(j.items);
}
async function apiAdmin(action,data){
  const token=sessionStorage.getItem('LP360:TAMBOL:mysiteAdminToken')||'';
  const r=await fetch(API,{method:'POST',cache:'no-store',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({mode:'sectionlayoutadmin',action,token,data:data||{}})}),j=await r.json();
  if(!r.ok||!j.success)throw new Error(j.message||'ดำเนินการไม่สำเร็จ');
  return j.data||{};
}
async function saveLayout(){
  if(saving){pendingSave=true;return}
  saving=true;
  const snapshot=layout.map(x=>({...x}));
  status('กำลังบันทึก...');
  try{
    const data=await apiAdmin('save',{items:snapshot});
    if(!pendingSave){layout=normalize(data?.items);renderCustomSections();apply();status('บันทึกแล้ว',900)}
  }catch(e){status('บันทึกไม่สำเร็จ: '+e.message,3200)}
  finally{saving=false;if(pendingSave){pendingSave=false;saveLayout()}}
}
function status(text,delay=0){
  let el=document.querySelector('.admin-section-save-status');
  if(!el){el=document.createElement('div');el.className='admin-section-save-status';document.body.appendChild(el)}
  el.textContent=text;el.hidden=false;clearTimeout(el._timer);if(delay)el._timer=setTimeout(()=>el.hidden=true,delay);
}
function looksLikeImageUrl(value){
  const v=String(value||'').trim();
  return /\.(?:avif|bmp|gif|jpe?g|png|svg|webp)(?:[?#].*)?$/i.test(v)||/^https:\/\/(?:lh\d+\.)?googleusercontent\.com\//i.test(v)||/^https:\/\/drive\.google\.com\/uc\?/i.test(v);
}
function renderCustomContent(section,item){
  section.innerHTML='';
  section.className='dynamic-section';
  section.dataset.dynamicSection='true';
  const wrap=document.createElement('div');wrap.className='dynamic-section-wrap';
  const heading=document.createElement('div');heading.className='dynamic-section-heading';
  const title=document.createElement('h2');title.textContent=item.title;heading.appendChild(title);
  if(item.detailUrl){
    const detail=document.createElement('a');
    detail.className='dynamic-section-detail-button shopactivity-open-all';
    detail.href=item.detailUrl;detail.target='_blank';detail.rel='noopener noreferrer';
    detail.textContent=item.buttonLabel||'ดูรายละเอียด';
    heading.appendChild(detail);
  }
  wrap.appendChild(heading);
  const frameWrap=document.createElement('div');frameWrap.className='dynamic-section-frame-wrap';
  const isImage=item.sourceType==='image'||(item.sourceType!=='embed'&&looksLikeImageUrl(item.source));
  if(isImage){
    const image=document.createElement('img');
    image.className='dynamic-section-image';image.loading='lazy';image.decoding='async';image.src=item.source||'';image.alt=item.title;
    image.style.maxHeight=item.height+'px';
    frameWrap.appendChild(image);
  }else{
    const frame=document.createElement('iframe');
    frame.className='dynamic-section-frame';frame.loading='lazy';frame.referrerPolicy='strict-origin-when-cross-origin';
    frame.style.height=item.height+'px';frame.title=item.title;
    frame.setAttribute('allow','accelerometer; autoplay; clipboard-write; encrypted-media; fullscreen; geolocation; gyroscope; picture-in-picture; web-share');
    if(item.sourceType==='embed'){
      frame.setAttribute('sandbox','allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads');
      frame.srcdoc=item.source||'<p style="font-family:sans-serif;padding:24px">ยังไม่มีโค้ดฝัง</p>';
    }else{
      frame.src=item.source||'about:blank';
    }
    frameWrap.appendChild(frame);
    if(item.sourceType==='url'&&item.source){
      const fallback=document.createElement('a');fallback.className='dynamic-section-open-page';fallback.href=item.source;fallback.target='_blank';fallback.rel='noopener noreferrer';fallback.textContent='เปิดหน้าเพจในแท็บใหม่';frameWrap.appendChild(fallback);
    }
  }
  wrap.appendChild(frameWrap);section.appendChild(wrap);
}
function renderCustomSections(){
  const main=document.querySelector('main');if(!main)return;
  const wanted=new Set(layout.filter(x=>x.kind==='custom').map(x=>x.id));
  main.querySelectorAll('section[data-dynamic-section="true"]').forEach(el=>{if(!wanted.has(el.id))el.remove()});
  layout.filter(x=>x.kind==='custom').forEach(item=>{
    let section=document.getElementById(item.id);
    if(!section){section=document.createElement('section');section.id=item.id;main.appendChild(section)}
    renderCustomContent(section,item);
  });
}
function syncLinkedMenus(){
  layout.forEach(item=>{
    document.querySelectorAll(`a[href="#${CSS.escape(item.id)}"]`).forEach(link=>{link.hidden=item.visible===false;link.dataset.sectionVisibilityLinked='1'});
  });
  // learningBaseModule controls nav-profile-actions: ปิด SECTION แล้วซ่อนชุดข้อมูลสมาชิกด้วย
  const learningBaseItem = layout.find(item => item.id === 'learningBaseModule');
  const profileVisible = !learningBaseItem || learningBaseItem.visible !== false;
  document.querySelectorAll('.nav-profile-actions').forEach(actions => {
    actions.hidden = !profileVisible;
    actions.setAttribute('aria-hidden', profileVisible ? 'false' : 'true');
    if (profileVisible) actions.style.removeProperty('display');
    else actions.style.setProperty('display', 'none', 'important');
  });
  try{window.MobileBottomNav?.syncVisibility?.()}catch(_){ }
}
function marker(item,index){
  const section=document.getElementById(item.id);if(!section)return;
  let box=section.querySelector(':scope > .admin-section-marker');
  if(!box){box=document.createElement('div');box.className='admin-section-marker';section.prepend(box)}
  const custom=item.kind==='custom';
  box.innerHTML=`<button class="admin-section-control admin-section-eye" type="button" title="${item.visible?'ปิดการมองเห็น':'เปิดการมองเห็น'}" aria-label="${item.visible?'ปิด':'เปิด'}การมองเห็น SECTION ${index+1}"><i class="fa-solid ${item.visible?'fa-eye':'fa-eye-slash'}"></i></button><span class="admin-section-marker-title">SECTION</span><strong class="admin-section-marker-number">${index+1}</strong><button class="admin-section-control admin-section-up" type="button" aria-label="เลื่อน SECTION ${index+1} ขึ้น" ${index===0?'disabled':''}><i class="fa-solid fa-arrow-up"></i></button><button class="admin-section-control admin-section-down" type="button" aria-label="เลื่อน SECTION ${index+1} ลง" ${index===layout.length-1?'disabled':''}><i class="fa-solid fa-arrow-down"></i></button>${custom?'<button class="admin-section-extra admin-section-edit" type="button"><i class="fa-solid fa-pen"></i> แก้ไข</button><button class="admin-section-extra admin-section-delete" type="button"><i class="fa-solid fa-trash"></i> ลบ</button>':''}`;
  box.querySelector('.admin-section-eye').onclick=e=>{e.stopPropagation();layout[index].visible=!layout[index].visible;apply();saveLayout()};
  box.querySelector('.admin-section-up').onclick=e=>{e.stopPropagation();if(index<1)return;[layout[index-1],layout[index]]=[layout[index],layout[index-1]];apply();saveLayout()};
  box.querySelector('.admin-section-down').onclick=e=>{e.stopPropagation();if(index>=layout.length-1)return;[layout[index],layout[index+1]]=[layout[index+1],layout[index]];apply();saveLayout()};
  box.querySelector('.admin-section-edit')?.addEventListener('click',e=>{e.stopPropagation();openSectionEditor(item,index)});
  box.querySelector('.admin-section-delete')?.addEventListener('click',e=>{e.stopPropagation();deleteCustomSection(item,index)});
  let msg=section.querySelector(':scope > .admin-section-hidden-message');
  if(!msg){msg=document.createElement('div');msg.className='admin-section-hidden-message';msg.textContent='section นี้ถูกปิดการมองเห็น';section.appendChild(msg)}
}
function apply(){
  const main=document.querySelector('main');if(!main)return;
  renderCustomSections();
  layout.forEach((item,index)=>{
    const section=document.getElementById(item.id);if(!section)return;
    main.appendChild(section);section.dataset.adminSection=String(index+1);section.dataset.sectionVisible=String(item.visible);marker(item,index);
  });
  syncLinkedMenus();
  document.dispatchEvent(new CustomEvent('site:section-layout-changed',{detail:{items:layout.map(x=>({...x}))}}));
}
function validPageUrl(value){
  const v=String(value||'').trim();
  if(!v||/^(?:javascript|data|vbscript):/i.test(v))return false;
  return /^(?:https?:\/\/|\/|\.\/|\.\.\/|[\w.-]+\.html(?:[?#].*)?$)/i.test(v);
}
function fileToDataUrl(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result||''));reader.onerror=()=>reject(new Error('อ่านไฟล์รูปภาพไม่สำเร็จ'));reader.readAsDataURL(file)})}
async function uploadSectionImage(file){
  if(!file)return '';
  if(!/^image\//i.test(file.type||''))throw new Error('กรุณาเลือกไฟล์รูปภาพเท่านั้น');
  if(file.size>15*1024*1024)throw new Error('รูปภาพมีขนาดใหญ่เกิน 15 MB');
  const imageData=await fileToDataUrl(file);
  const result=await apiAdmin('uploadimage',{imageData,imageName:file.name||'section-image'});
  if(!result.url)throw new Error('อัปโหลดรูปภาพไม่สำเร็จ');
  return result.url;
}
function editorHtml(item){
  const type=item?.sourceType==='embed'?'embed':'url';
  return `<div class="dynamic-section-editor"><label>ชื่อ SECTION</label><input id="dynamicSectionTitle" class="swal2-input" value="${esc(item?.title||'')}" maxlength="120" placeholder="เช่น ห้องเรียนออนไลน์"><label>รูปแบบเนื้อหา</label><select id="dynamicSectionType" class="swal2-select"><option value="url" ${type==='url'?'selected':''}>URL หน้าเพจ/รูปภาพ</option><option value="embed" ${type==='embed'?'selected':''}>ฝังโค้ด HTML / iframe / embed</option></select><div id="dynamicSectionUrlWrap"><label>URL หน้าเพจ/รูปภาพ</label><input id="dynamicSectionUrl" class="swal2-input" value="${esc(type==='url'?(item?.source||''):'')}" placeholder="https://... / page.html / URL รูปภาพ"><label>หรืออัปโหลดรูปภาพ</label><input id="dynamicSectionImageFile" class="dynamic-section-file-input" type="file" accept="image/*"><small>หากเลือกรูปภาพ ระบบจะอัปโหลดเข้า Google Drive และใช้รูปที่อัปโหลดแทน URL ในช่องด้านบน</small></div><div id="dynamicSectionEmbedWrap"><label>โค้ดที่ต้องการฝัง</label><textarea id="dynamicSectionEmbed" class="swal2-textarea" placeholder="วาง iframe / HTML / embed code">${esc(type==='embed'?(item?.source||''):'')}</textarea><small>โค้ดฝังทำงานภายใน iframe แบบ sandbox เพื่อไม่ให้ชนกับระบบหลักของเว็บไซต์</small></div><label>ระบุ URL รายละเอียด</label><input id="dynamicSectionDetailUrl" class="swal2-input" value="${esc(item?.detailUrl||'')}" placeholder="https://... หรือ page.html"><label>ชื่อปุ่ม</label><input id="dynamicSectionButtonLabel" class="swal2-input" value="${esc(item?.buttonLabel||'')}" maxlength="60" placeholder="เช่น ดูทั้งหมด / เข้าชม / รายละเอียดเพิ่มเติม"><small>เมื่อระบุ URL รายละเอียด ระบบจะแสดงปุ่มมุมบนขวาของ SECTION และเปิดหน้าใหม่เมื่อคลิก</small><label>ความสูง SECTION (px)</label><input id="dynamicSectionHeight" class="swal2-input" type="number" min="260" max="1600" step="10" value="${Number(item?.height||620)}"></div>`;
}
async function openSectionEditor(item,index){
  if(!window.Swal){status('ยังโหลดเครื่องมือแก้ไขไม่เสร็จ กรุณากดอีกครั้ง',1800);return}
  const editing=!!item;
  const result=await Swal.fire({title:editing?'แก้ไข SECTION':'เพิ่ม SECTION ใหม่',html:editorHtml(item),width:'min(820px,96vw)',showCancelButton:true,confirmButtonText:editing?'บันทึกการแก้ไข':'เพิ่ม SECTION',cancelButtonText:'ยกเลิก',confirmButtonColor:'#dc2626',showLoaderOnConfirm:true,didOpen:()=>{
    const type=document.getElementById('dynamicSectionType'),urlWrap=document.getElementById('dynamicSectionUrlWrap'),embedWrap=document.getElementById('dynamicSectionEmbedWrap');
    const sync=()=>{const isEmbed=type.value==='embed';urlWrap.hidden=isEmbed;embedWrap.hidden=!isEmbed};type.addEventListener('change',sync);sync();
  },preConfirm:async()=>{
    const title=document.getElementById('dynamicSectionTitle').value.trim();
    const selectedType=document.getElementById('dynamicSectionType').value;
    const imageFile=document.getElementById('dynamicSectionImageFile')?.files?.[0]||null;
    let source=(selectedType==='embed'?document.getElementById('dynamicSectionEmbed').value:document.getElementById('dynamicSectionUrl').value).trim();
    const detailUrl=document.getElementById('dynamicSectionDetailUrl').value.trim();
    const buttonLabel=document.getElementById('dynamicSectionButtonLabel').value.trim();
    const height=clamp(document.getElementById('dynamicSectionHeight').value,260,1600);
    if(!title)return Swal.showValidationMessage('กรุณาระบุชื่อ SECTION');
    if(selectedType==='url'&&!source&&!imageFile)return Swal.showValidationMessage('กรุณาระบุ URL หน้าเพจ/รูปภาพ หรืออัปโหลดรูปภาพ');
    if(selectedType==='embed'&&!source)return Swal.showValidationMessage('กรุณาวางโค้ดที่ต้องการฝัง');
    if(source.length>45000)return Swal.showValidationMessage('โค้ด/URL ยาวเกิน 45,000 ตัวอักษร');
    if(selectedType==='url'&&source&&!validPageUrl(source))return Swal.showValidationMessage('URL ไม่ถูกต้อง กรุณาใช้ https://... หรือชื่อไฟล์ เช่น page.html');
    if(detailUrl&&!validPageUrl(detailUrl))return Swal.showValidationMessage('URL รายละเอียดไม่ถูกต้อง');
    if(detailUrl&&!buttonLabel)return Swal.showValidationMessage('กรุณากำหนดชื่อปุ่มสำหรับ URL รายละเอียด');
    if(buttonLabel&&!detailUrl)return Swal.showValidationMessage('กรุณาระบุ URL รายละเอียด หรือเว้นชื่อปุ่มให้ว่าง');
    let sourceType=selectedType;
    try{
      if(imageFile){
        source=await uploadSectionImage(imageFile);
        sourceType='image';
      }else if(selectedType==='url'&&looksLikeImageUrl(source)){
        sourceType='image';
      }
    }catch(e){return Swal.showValidationMessage(e.message||'อัปโหลดรูปภาพไม่สำเร็จ')}
    return {title,sourceType,source,height,detailUrl,buttonLabel};
  }});
  if(!result.isConfirmed)return;
  if(editing){layout[index]={...layout[index],...result.value}}
  else{layout.push({id:customId(),kind:'custom',visible:true,...result.value})}
  apply();await saveLayout();
}
async function deleteCustomSection(item,index){
  if(item.kind!=='custom')return;
  const result=await Swal.fire({icon:'warning',title:'ลบ SECTION นี้?',text:`${item.title} จะถูกนำออกจากหน้าเว็บไซต์`,showCancelButton:true,confirmButtonText:'ลบ SECTION',cancelButtonText:'ยกเลิก',confirmButtonColor:'#dc2626'});
  if(!result.isConfirmed)return;
  const section=document.getElementById(item.id);if(section)section.remove();layout.splice(index,1);apply();await saveLayout();
}
function addCreateButton(){
  if(document.getElementById('adminAddSectionButton'))return;
  const button=document.createElement('button');button.id='adminAddSectionButton';button.type='button';button.className='admin-add-section-button admin-only';button.innerHTML='<i class="fa-solid fa-plus"></i><span>เพิ่ม SECTION</span>';button.addEventListener('click',()=>openSectionEditor(null,-1));document.body.appendChild(button);
}
async function init(){addCreateButton();try{layout=await getLayout()}catch(e){console.warn(e);layout=normalize([])}renderCustomSections();apply()}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
