'use strict';
const $ = (s, root = document) => root.querySelector(s);
const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = value => Number(value || 0).toFixed(2);
const state = { data: null, page: 'dashboard', query: '', filter: '', tab: 'all', index: 1, size: 8, busy: false };
const titles = { dashboard: '工作台', books: '图书馆藏', readers: '读者管理', borrows: '借阅记录' };
const enTitles = { dashboard: 'YOUR LIBRARY, AT A GLANCE', books: 'A WORLD BETWEEN THE PAGES', readers: 'PEOPLE WHO LOVE TO READ', borrows: 'EVERY BOOK HAS A JOURNEY' };
let toastTimer;
let confirmation = null;

function toast(message, error = false) {
  const el = $('#toast');
  el.textContent = message; el.className = `toast show${error ? ' error' : ''}`;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), error ? 7000 : 3500);
}

async function request(path, method = 'GET', body) {
  const response = await fetch(`/api${path}`, {
    method, headers: { 'Content-Type': 'application/json', 'X-Library-Client': 'library-local' },
    body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store'
  });
  let result;
  try { result = await response.json(); }
  catch { throw new Error('服务没有响应，请确认本地程序仍在运行'); }
  if (!response.ok) throw new Error(result.message || '操作未完成，请稍后重试');
  return result;
}

async function refresh(notify = false) {
  try {
    state.data = await request('/data');
    updateChrome(); render();
    if (notify) toast('数据已刷新');
  } catch (error) {
    if (state.data) toast(error.message, true);
    else $('#main').innerHTML = `<div class="error-screen">${icon('db')}<h2>暂时无法读取数据</h2><p>${esc(error.message)}</p><button class="button" data-action="refresh">重新加载</button></div>`;
  }
}

function updateChrome() {
  const d = state.data;
  $('#nav-book-count').textContent = d.books.length;
  $('#nav-borrow-count').textContent = d.borrows.filter(x => !x.returntime).length;
  $('#source-name').textContent = d.source;
  $('#source-detail').textContent = d.demo ? '点击连接你的 MySQL' : '已连接 · 本机数据库';
  $('#breadcrumb').textContent = titles[state.page];
  document.querySelectorAll('[data-page]').forEach(el => {
    el.classList.toggle('active', el.dataset.page === state.page);
    if (el.dataset.page === state.page) el.setAttribute('aria-current','page'); else el.removeAttribute('aria-current');
  });
  document.title = `${titles[state.page]} · 阅见`;
}

function cover(book, n = 0) {
  const label = String(book.bname || '图书').replace(/[^\p{L}\p{N}]/gu,'').slice(0,4);
  return `<span class="book-cover cover-${n % 6}" aria-hidden="true">${esc(label)}</span>`;
}
function bookCell(book, n) {
  return `<div class="book-cell">${cover(book,n)}<div class="book-meta"><strong title="${esc(book.bname)}">${esc(book.bname)}</strong><small>${esc(book.author || '作者未填写')} · ${esc(book.publisher || '出版社未填写')}</small></div></div>`;
}
function badge(row) {
  if (row.returntime) return '<span class="badge gray">已归还</span>';
  if (Number(row.overdue_days)>0) return `<span class="badge red">逾期 ${esc(row.overdue_days)} 天</span>`;
  return '<span class="badge">借阅中</span>';
}
function empty(message = '还没有相关记录', detail = '试试其他关键词，或添加一条新记录。') {
  return `<div class="empty">${icon('book')}<p>${esc(message)}</p><p class="counter-note">${esc(detail)}</p></div>`;
}
function notice() {
  return state.data.demo
    ? `<div class="notice">${icon('db')}<span>示例预览 · 数据来自项目 CSV，当前操作不影响 MySQL；重启后示例数据恢复。</span><button data-action="connect">连接我的 MySQL →</button></div>`
    : `<div class="notice live">${icon('check')}<span>已连接本机 MySQL · librarydb，当前操作会保存到你的数据库。</span><button data-action="connect">连接设置</button></div>`;
}
function heading() {
  const d = state.data;
  const subtitles = {
    dashboard: '一本书，一段旅程。今天，也让知识继续流动。',
    books: `有序整理每一本书，发现馆藏中的更多可能。`,
    readers: '连接每一位读者，记录与知识相遇的时刻。',
    borrows: '从借出到归还，每一次流转都有迹可循。'
  };
  const primary = state.page==='books' ? ['add-book','plus','新增图书'] : state.page==='readers' ? ['add-reader','plus','添加读者'] : ['borrow','plus','登记借阅'];
  return `<div class="page-heading"><div><p class="eyebrow">${enTitles[state.page]}</p><h1>${titles[state.page]}</h1><p class="subheading">${subtitles[state.page]}</p></div><div class="heading-actions"><button class="button secondary" data-action="refresh">${icon('refresh')}刷新</button><button class="button" data-action="${primary[0]}">${icon(primary[1])}${primary[2]}</button></div></div>${notice()}`;
}
function render() {
  if (!state.data) return;
  const focused = document.activeElement;
  const focusId = focused?.id;
  const caret = focused instanceof HTMLInputElement ? focused.selectionStart : null;
  $('#main').innerHTML = heading() + ({ dashboard: dashboard, books: booksPage, readers: readersPage, borrows: borrowsPage }[state.page])();
  updateChrome();
  if (focusId && $(`#${focusId}`)) {
    const target = $(`#${focusId}`); target.focus();
    if (caret !== null && target instanceof HTMLInputElement) target.setSelectionRange(caret,caret);
  }
}

function dashboard() {
  const d=state.data, active=d.borrows.filter(x=>!x.returntime), overdue=active.filter(x=>Number(x.overdue_days)>0);
  const available=d.books.reduce((sum,b)=>sum+Number(b.total||0),0);
  const stats=[['馆藏图书',d.books.length,'种','book',`可借库存 ${available} 本`],['在册读者',d.readers.length,'位','users',`${d.types.length} 类读者 · 各有所读`],['当前借出',active.length,'本','swap',`累计借阅 ${d.borrows.length} 次`],['逾期待还',overdue.length,'本','clock',overdue.length?'及时提醒，让好书早日回家':'归还及时，借阅井然有序']];
  const ranked=[...d.books].sort((a,b)=>Number(b.borrow_count)-Number(a.borrow_count)).slice(0,5);
  const departments={}; for(const row of d.borrows){const key=row.dept||'未填写院系';departments[key]=(departments[key]||0)+1;}
  const distribution=Object.entries(departments).sort((a,b)=>b[1]-a[1]).slice(0,4);
  const max=Math.max(1,...distribution.map(x=>x[1]));
  return `<section class="hero"><div class="hero-copy"><p class="eyebrow">A LITTLE ORDER. A LOT OF POSSIBILITY.</p><h2>书页之间，自有新的世界。</h2><p>管理每一本书的去向，留住每一次阅读的热爱。<br>你的图书馆，今天也井然有序。</p><a href="#books" class="text-button">探索全部馆藏 ${icon('arrow')}</a></div><div class="hero-art" aria-hidden="true"><div class="art-circle"></div><div class="art-base"></div><div class="art-book one">阅读与生活</div><div class="art-book two">知识的形状</div><div class="art-book three">书间时光</div><div class="art-leaf">${icon('leaf')}</div></div></section>
  <section class="stats" aria-label="图书馆数据概览">${stats.map(s=>`<article class="stat"><div class="stat-label">${s[0]}<span class="stat-icon">${icon(s[3])}</span></div><div class="stat-number">${s[1]}<small>${s[2]}</small></div><div class="stat-foot"><span class="dot"></span>${s[4]}</div></article>`).join('')}</section>
  <div class="dashboard-grid"><section class="panel"><div class="panel-header"><div><h2>热门馆藏</h2><p>被翻开的每一页，都是知识的回响。</p></div><span class="tag">累计借阅排行</span></div>${ranked.length?`<div class="table-wrap"><table><thead><tr><th>图书信息</th><th>借阅次数</th><th>可借库存</th></tr></thead><tbody>${ranked.map((b,i)=>`<tr><td>${bookCell(b,i)}</td><td><strong>${Number(b.borrow_count)}</strong> <span class="counter-note">次</span></td><td><span class="badge ${Number(b.total)>0?'':'gray'}">${Number(b.total||0)} 本可借</span></td></tr>`).join('')}</tbody></table></div>`:empty('馆藏等待上新')}<div class="table-footer"><span>共 ${d.books.length} 种图书 · 按累计借阅次数排序</span><a href="#books" class="text-button">全部馆藏 ${icon('arrow')}</a></div></section>
  <div class="dashboard-right"><section class="panel"><div class="panel-header"><h2>最近借阅</h2><a href="#borrows" class="text-button">查看全部 ${icon('arrow')}</a></div><div class="activity-list">${d.borrows.slice(0,4).map(row=>`<div class="activity"><span class="activity-avatar">${esc(String(row.rname||'?').slice(-2))}</span><div class="activity-copy"><strong>${esc(row.rname)} · ${esc(row.bname)}</strong><span>${row.returntime?'已归还':'借阅中'}</span></div><span class="activity-date">${esc(row.borrowtime)}</span></div>`).join('')||empty('暂无借阅记录','登记第一笔借阅吧。')}</div></section>
  <section class="panel"><div class="panel-header"><h2>院系借阅分布</h2><span class="tag">累计</span></div><div class="distribution">${distribution.map(([name,n])=>`<div class="distribution-row"><div><span>${esc(name)}</span><strong>${n} 次</strong></div><progress value="${n}" max="${max}" aria-label="${esc(name)} ${n} 次"></progress></div>`).join('')||'<p class="counter-note">借阅发生后，这里会展示院系分布。</p>'}</div><div class="panel-note">每一份求知欲，都值得被记录。</div></section></div></div>
  <div class="quick-actions"><button class="button" data-action="add-book">${icon('plus')}新书入库</button><button class="button" data-action="add-reader">${icon('users')}添加读者</button><button class="button" data-action="borrow">${icon('swap')}登记借阅</button><a class="button" href="#borrows">${icon('clock')}查看待还</a></div>`;
}

function searchBar(placeholder, options='') {
  return `<div class="toolbar"><label class="search-field">${icon('search')}<input id="list-search" type="search" value="${esc(state.query)}" placeholder="${placeholder}" aria-label="${placeholder}" autocomplete="off"></label>${options}<span class="result-count" id="result-count"></span></div>`;
}
function pageRows(rows) {
  const pages=Math.max(1,Math.ceil(rows.length/state.size));
  state.index=Math.min(Math.max(1,state.index),pages);
  return rows.slice((state.index-1)*state.size,state.index*state.size);
}
function pager(total) {
  const pages=Math.max(1,Math.ceil(total/state.size));
  const first=total?(state.index-1)*state.size+1:0,last=Math.min(total,state.index*state.size);
  return `<div class="table-footer"><span>显示 ${first}–${last} 条，共 ${total} 条记录</span><div class="pagination"><button data-action="page-prev" ${state.index<=1?'disabled':''} aria-label="上一页">‹</button><span>${state.index} / ${pages}</span><button data-action="page-next" ${state.index>=pages?'disabled':''} aria-label="下一页">›</button></div></div>`;
}
function matched(row,keys) {const q=state.query.trim().toLowerCase();return !q||keys.some(k=>String(row[k]||'').toLowerCase().includes(q));}

function booksPage() {
  const options=`<select id="list-filter" aria-label="库存筛选"><option value="">全部库存</option><option value="available" ${state.filter==='available'?'selected':''}>有库存</option><option value="empty" ${state.filter==='empty'?'selected':''}>暂无库存</option></select>`;
  const rows=state.data.books.filter(b=>matched(b,['bid','bname','author','publisher'])&&(!state.filter||(state.filter==='available'?Number(b.total)>0:Number(b.total)<=0)));
  const visible=pageRows(rows);
  return `<section class="panel">${searchBar('搜索书名、编号、作者或出版社',options)}${visible.length?`<div class="table-wrap"><table><thead><tr><th>图书信息</th><th>图书编号</th><th>定价</th><th>可借库存</th><th>馆藏位置</th><th>操作</th></tr></thead><tbody>${visible.map((b,i)=>`<tr><td>${bookCell(b,i)}</td><td>${esc(b.bid)}</td><td>¥ ${money(b.price)}</td><td><span class="badge ${Number(b.total)>0?'':'gray'}">${Number(b.total||0)} 本</span></td><td>${esc(b.position||'—')}</td><td><div class="actions"><button class="icon-button" data-action="edit-book" data-id="${esc(b.bid)}" aria-label="编辑 ${esc(b.bname)}" title="编辑">${icon('edit')}</button><button class="icon-button delete" data-action="delete-book" data-id="${esc(b.bid)}" aria-label="删除 ${esc(b.bname)}" title="删除">${icon('trash')}</button></div></td></tr>`).join('')}</tbody></table></div>`:empty(state.query||state.filter?'没有找到匹配的图书':'图书馆等待第一本书')}${pager(rows.length)}</section>`;
}
function readersPage() {
  const options=`<select id="list-filter" aria-label="读者类别筛选"><option value="">全部类别</option>${state.data.types.map(t=>`<option value="${t.typeno}" ${String(t.typeno)===state.filter?'selected':''}>${esc(t.typename)}</option>`).join('')}</select>`;
  const rows=state.data.readers.filter(r=>matched(r,['rid','rname','dept','tel'])&&(!state.filter||String(r.typeno)===state.filter));
  const visible=pageRows(rows);
  return `<section class="panel">${searchBar('搜索姓名、学号 / 工号、院系或电话',options)}${visible.length?`<div class="table-wrap"><table><thead><tr><th>读者姓名</th><th>学号 / 工号</th><th>类别</th><th>所属院系</th><th>当前借阅</th><th>联系电话</th><th>操作</th></tr></thead><tbody>${visible.map(r=>`<tr><td><div class="reader-name"><span class="activity-avatar">${esc(String(r.rname||'?').slice(-2))}</span><strong>${esc(r.rname)}</strong></div></td><td>${esc(r.rid)}</td><td><span class="badge ${r.typename==='教师'?'orange':''}">${esc(r.typename||'未分类')}</span></td><td>${esc(r.dept||'—')}</td><td><strong>${Number(r.active_count)}</strong> / ${esc(r.max_quantity??'—')} 本</td><td>${esc(r.tel||'—')}</td><td><div class="actions"><button class="icon-button" data-action="edit-reader" data-id="${esc(r.rid)}" aria-label="编辑 ${esc(r.rname)}" title="编辑">${icon('edit')}</button><button class="icon-button delete" data-action="delete-reader" data-id="${esc(r.rid)}" aria-label="删除 ${esc(r.rname)}" title="删除">${icon('trash')}</button></div></td></tr>`).join('')}</tbody></table></div>`:empty('没有找到匹配的读者')}${pager(rows.length)}</section>`;
}
function borrowsPage() {
  const tabs=[['all','全部记录'],['active','借阅中'],['overdue','逾期待还'],['returned','已归还']];
  const rows=state.data.borrows.filter(b=>matched(b,['id','rid','rname','bid','bname'])&&(state.tab==='all'||state.tab==='active'&&!b.returntime||state.tab==='overdue'&&!b.returntime&&Number(b.overdue_days)>0||state.tab==='returned'&&!!b.returntime));
  const visible=pageRows(rows);
  return `<section class="panel"><div class="tabs" role="group" aria-label="借阅状态">${tabs.map(([id,label])=>`<button class="tab ${state.tab===id?'active':''}" data-action="tab" data-id="${id}" aria-pressed="${state.tab===id}">${label}</button>`).join('')}</div>${searchBar('搜索书名、读者姓名、图书编号或读者编号')}${visible.length?`<div class="table-wrap"><table><thead><tr><th>图书 / 读者</th><th>借阅日期</th><th>应还日期</th><th>归还日期</th><th>状态</th><th>操作</th></tr></thead><tbody>${visible.map(b=>`<tr><td><div class="book-meta"><strong>${esc(b.bname||b.bid)}</strong><small>${esc(b.rname||b.rid)} · ${esc(b.rid)} · #${b.id}</small></div></td><td>${esc(b.borrowtime||'—')}</td><td>${esc(b.due_date||'—')}</td><td>${esc(b.returntime||'—')}</td><td>${badge(b)}</td><td>${!b.returntime?`<button class="button secondary small" data-action="return" data-id="${b.id}">${icon('check')}登记归还</button>`:'<span class="counter-note">已完成</span>'}</td></tr>`).join('')}</tbody></table></div>`:empty('当前没有符合条件的借阅记录')}${pager(rows.length)}</section>`;
}

function openModal(title,subtitle,content,footer='',kind='') {
  const modal=$('#modal');
  $('#modal-content').innerHTML=`<form id="dialog-form" data-kind="${kind}"><div class="modal-header"><div><h2 id="modal-title">${title}</h2><p>${subtitle}</p></div><button type="button" class="icon-button" data-action="close" aria-label="关闭">${icon('close')}</button></div><div class="modal-body">${content}<p id="form-error" class="form-error" role="alert"></p></div><div class="modal-footer"><button type="button" class="button secondary" data-action="close">${footer?'取消':'知道了'}</button>${footer?`<button id="form-submit" type="submit" class="button">${footer}</button>`:''}</div></form>`;
  if(!modal.open) modal.showModal();
}
function closeModal() {
  if(state.busy) return;
  $('#modal').close(); $('#modal-content').replaceChildren(); confirmation=null;
}
function inputField(label,key,value='',type='text',max=50,required=false,extra='') {
  return `<label class="field">${label}${required?' *':''}<input name="${key}" type="${type}" value="${esc(value)}" maxlength="${max}" ${required?'required':''} ${extra}></label>`;
}
function bookModal(id) {
  const b=state.data.books.find(b=>b.bid===id)||{};
  openModal(id?'编辑图书':'新书入库',id?'维护图书信息与当前可借库存。':'为图书馆添一本新书。',`<div class="form-grid">${inputField('图书编号','bid',b.bid,'text',20,true,id?'readonly':'placeholder="保留编号开头的 0"')}${inputField('书名','bname',b.bname,'text',50,true)}${inputField('作者','author',b.author,'text',30)}${inputField('出版社','publisher',b.publisher,'text',30)}${inputField('出版日期','publishdate',b.publishdate,'date')}${inputField('定价（元）','price',b.price,'number',20,true,'min="0.01" max="99999999.99" step="0.01"')}${inputField('可借库存（本）','total',b.total??0,'number',10,true,'min="0" max="2147483647" step="1"')}${inputField('馆藏位置','position',b.position,'text',20)}</div>`,'保存图书','book');
  $('#dialog-form').dataset.id=id||'';
}
function readerModal(id) {
  const r=state.data.readers.find(r=>r.rid===id)||{};
  openModal(id?'编辑读者':'添加读者',id?'更新读者信息与借阅类别。':'为新的阅读旅程建立档案。',`<div class="form-grid">${inputField('学号 / 工号','rid',r.rid,'text',20,true,id?'readonly':'')}${inputField('姓名','rname',r.rname,'text',20,true)}<label class="field">性别 *<select name="sex" required><option value="女" ${r.sex==='女'?'selected':''}>女</option><option value="男" ${r.sex==='男'?'selected':''}>男</option></select></label><label class="field">读者类别 *<select name="typeno" required>${state.data.types.map(t=>`<option value="${t.typeno}" ${r.typeno===t.typeno?'selected':''}>${esc(t.typename)} · ${esc(t.max_quantity)} 本 / ${esc(t.max_days)} 天</option>`).join('')}</select></label>${inputField('所属院系','dept',r.dept,'text',40)}${inputField('联系电话','tel',r.tel,'tel',20)}</div>`,'保存读者','reader');
  $('#dialog-form').dataset.id=id||'';
}
function borrowModal() {
  const available=state.data.books.filter(b=>Number(b.total)>0);
  if(!available.length){toast('当前没有可借图书，请先添加图书或补充库存',true);return;}
  if(!state.data.readers.length){toast('请先添加一位读者',true);return;}
  openModal('登记借阅','让一本好书，遇见下一位读者。',`<p class="modal-hint">借阅成功后，系统会自动扣减 1 本库存。借阅数量上限和归还期限由读者类别决定。</p><div class="form-grid"><label class="field full">选择读者 *<select name="rid" required><option value="">请选择读者</option>${state.data.readers.map(r=>`<option value="${esc(r.rid)}">${esc(r.rname)} · ${esc(r.rid)} · ${Number(r.active_count)} / ${esc(r.max_quantity)} 本</option>`).join('')}</select></label><label class="field full">选择图书 *<select name="bid" required><option value="">请选择图书</option>${available.map(b=>`<option value="${esc(b.bid)}">${esc(b.bname)} · ${esc(b.bid)} · 可借 ${Number(b.total)} 本</option>`).join('')}</select></label>${inputField('借阅日期','borrowtime',state.data.today,'date',10,false,'readonly')}</div>`,'确认借阅','borrow');
}
function connectionModal() {
  openModal('连接本机 MySQL','在这里接入你已经建好的 librarydb。',`<p class="modal-hint">${state.data.demo?'当前为示例预览。连接成功后，将显示并操作你的 MySQL 数据。':'当前已连接 MySQL。可以重新连接，或切换回独立的示例预览。'}<br>连接地址：127.0.0.1:3306 / librarydb<br>密码仅用于当前进程连接，不写入项目文件。</p><div class="form-grid">${inputField('数据库账号','username','root','text',100,true,'autocomplete="username"')}<label class="field">数据库密码<input type="password" name="password" autocomplete="current-password" placeholder="输入你本机的 MySQL 密码"></label></div><p class="guide">${state.data.demo?'':'<button type="button" class="text-button" data-action="preview">切换到示例预览 →</button>'}</p>`,'连接数据库','connection');
}
function confirmModal(title,content,callback) {
  openModal(title,'请确认本次操作。',`<p class="confirm-copy">${content}</p>`,'确认','confirm');
  confirmation=callback;
}
function helpModal() {
  openModal('欢迎使用阅见','一个轻巧、有序的图书馆工作空间。',`<div class="guide"><p><strong>图书馆藏</strong><br>查看、搜索、新增和编辑图书；库存指当前仍可借出的册数。已有借阅历史的图书不能删除，以保留历史记录。</p><p><strong>读者管理</strong><br>管理教师、学生等读者信息。可借数量和天数读取自数据库的读者类别表。</p><p><strong>借阅记录</strong><br>登记借书、归还图书，库存会同步更新。已经归还的记录不能重复归还，同一读者不能重复借出同一本未还图书。</p><p><strong>示例预览与 MySQL</strong><br>示例预览在独立内存数据库运行，重启会恢复。点击左下角数据来源，输入本机 MySQL 账号密码，即可连接 librarydb。原始 CSV 的借阅日期在 2022 年，按今天计算出现逾期是正常的。</p><p><strong>本地使用</strong><br>本版本仅监听本机地址。双击“停止图书管理.cmd”可停止后台服务；使用终端启动时按 Ctrl+C 停止。</p></div>`);
}

async function mutate(callback) {
  if(state.busy)return;
  state.busy=true;
  const button=$('#form-submit');if(button){button.disabled=true;button.textContent='处理中…';}
  try {
    const result=await callback();
    state.busy=false;closeModal();toast(result.message||'操作成功');await refresh();
  } catch(error) {
    const errorEl=$('#form-error');
    if(errorEl)errorEl.textContent=error.message;else toast(error.message,true);
  } finally {
    state.busy=false;
    if(button?.isConnected){button.disabled=false;button.textContent='重试';}
  }
}

document.addEventListener('click', event=>{
  const button=event.target.closest('[data-action]'); if(!button||button.disabled)return;
  const id=button.dataset.id, action=button.dataset.action;
  switch(action){
    case'refresh':refresh(true);break;
    case'connect':if(state.data)connectionModal();break;
    case'close':closeModal();break;
    case'help':helpModal();break;
    case'add-book':bookModal();break;
    case'edit-book':bookModal(id);break;
    case'add-reader':readerModal();break;
    case'edit-reader':readerModal(id);break;
    case'borrow':borrowModal();break;
    case'preview':mutate(()=>request('/preview','POST',{}));break;
    case'page-prev':state.index--;render();break;
    case'page-next':state.index++;render();break;
    case'tab':state.tab=id;state.index=1;render();break;
    case'delete-book':{
      const book=state.data.books.find(x=>x.bid===id);
      confirmModal('删除图书',`确定删除《${esc(book?.bname)}》吗？已有借阅历史的图书会被保留。`,()=>request(`/books/${encodeURIComponent(id)}`,'DELETE'));break;
    }
    case'delete-reader':{
      const reader=state.data.readers.find(x=>x.rid===id);
      confirmModal('删除读者',`确定删除读者 ${esc(reader?.rname)} 吗？已有借阅历史的读者会被保留。`,()=>request(`/readers/${encodeURIComponent(id)}`,'DELETE'));break;
    }
    case'return':{
      const record=state.data.borrows.find(x=>String(x.id)===id);
      confirmModal('登记归还',`确认 ${esc(record?.rname)} 已归还《${esc(record?.bname)}》？归还日期为 ${esc(state.data.today)}，库存将增加 1 本。`,()=>request(`/borrows/${encodeURIComponent(id)}/return`,'POST',{}));break;
    }
  }
});
document.addEventListener('submit',event=>{
  if(event.target.id!=='dialog-form')return;
  event.preventDefault();
  const form=event.target,body=Object.fromEntries(new FormData(form)),id=form.dataset.id;
  switch(form.dataset.kind){
    case'book':mutate(()=>request(id?`/books/${encodeURIComponent(id)}`:'/books',id?'PUT':'POST',body));break;
    case'reader':mutate(()=>request(id?`/readers/${encodeURIComponent(id)}`:'/readers',id?'PUT':'POST',body));break;
    case'borrow':mutate(()=>request('/borrows','POST',body));break;
    case'connection':mutate(()=>request('/connection','POST',body));break;
    case'confirm':if(confirmation)mutate(confirmation);break;
  }
});
document.addEventListener('input',event=>{if(event.target.id==='list-search'){state.query=event.target.value;state.index=1;render();}});
document.addEventListener('change',event=>{if(event.target.id==='list-filter'){state.filter=event.target.value;state.index=1;render();}});
$('#modal').addEventListener('cancel',event=>{event.preventDefault();closeModal();});
$('#modal').addEventListener('click',event=>{if(event.target===$('#modal')){const r=$('#modal').getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)closeModal();}});
window.addEventListener('hashchange',navigate);
function navigate(){
  const page=location.hash.slice(1)||'dashboard';
  state.page=Object.hasOwn(titles,page)?page:'dashboard';
  state.query='';state.filter='';state.tab='all';state.index=1;
  render();window.scrollTo({top:0,behavior:'instant'});
}
$('#header-date').textContent=new Intl.DateTimeFormat('zh-CN',{year:'numeric',month:'long',day:'numeric',weekday:'long',timeZone:'Asia/Shanghai'}).format(new Date());
navigate();refresh();
