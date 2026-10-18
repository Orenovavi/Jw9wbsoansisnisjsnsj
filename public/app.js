/* =========================================================
   DenzcOne REST API Console — app.js (FINAL FIX)
   ========================================================= */

let registry = {};
let activeEndpoint = null;
let currentCategory = 'all';
let isTerminalTyping = false;
let rawResponseText = '';
const openFolders = new Set();

const safeLower = (v) => (typeof v === 'string' ? v.toLowerCase() : '');
const safeArr   = (v) => (Array.isArray(v) ? v : []);
const safeIcon  = () => { try { if (window.lucide) window.lucide.createIcons(); } catch (e) {} };
const safeSwal  = (opts) => { if (window.Swal) return Swal.fire(opts); };

function smoothNavigate(targetView) {
  const homeView = document.getElementById('view-home');
  const docsView = document.getElementById('view-docs');
  if (!homeView || !docsView) return;

  const current     = targetView === 'docs' ? homeView : docsView;
  const destination = targetView === 'docs' ? docsView : homeView;

  current.classList.remove('view-enter');
  current.classList.add('view-leave');

  setTimeout(() => {
    current.classList.add('hidden');
    destination.classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });

    setTimeout(() => {
      destination.classList.remove('view-leave');
      destination.classList.add('view-enter');
    }, 50);
  }, 200);
}

const notify = (icon, title) => {
  safeSwal({
    icon, title, position: 'center', showConfirmButton: false, timer: 1600,
    customClass: { popup: 'custom-swal-center' },
    iconColor: icon === 'success' ? '#10B981' : '#FF7675'
  });
};

const formatCodeHighlight = (data) => {
  let json = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  json = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return json.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, (match) => {
    let cls = 'json-number';
    if (/^"/.test(match)) cls = /:$/.test(match) ? 'json-key' : 'json-string';
    else if (/true|false/.test(match)) cls = 'json-boolean';
    else if (/null/.test(match)) cls = 'json-null';
    return `<span class="${cls}">${match}</span>`;
  });
};

/* ---------- Terminal Animation ---------- */
const typeTerminalLine = (text, speed = 12) => {
  return new Promise((resolve) => {
    const typingEl = document.getElementById('terminal-typing');
    const bodyEl = document.getElementById('terminal-body');
    if (!typingEl || !bodyEl) return resolve();
    let index = 0;
    typingEl.textContent = '';
    const interval = setInterval(() => {
      if (index < text.length) {
        typingEl.textContent += text.charAt(index);
        index++;
        bodyEl.scrollTop = bodyEl.scrollHeight;
      } else { clearInterval(interval); setTimeout(resolve, 30); }
    }, speed);
  });
};

const commitTerminalLine = (colorClass = 'text-white/60') => {
  const typingEl = document.getElementById('terminal-typing');
  const contentEl = document.getElementById('terminal-content');
  const bodyEl = document.getElementById('terminal-body');
  if (!typingEl || !contentEl || !bodyEl) return;
  const lineDiv = document.createElement('div');
  lineDiv.className = colorClass;
  lineDiv.textContent = typingEl.textContent;
  contentEl.appendChild(lineDiv);
  typingEl.textContent = '';
  bodyEl.scrollTop = bodyEl.scrollHeight;
};

const runConsoleBootSequence = async () => {
  if (isTerminalTyping) return;
  isTerminalTyping = true;
  const contentEl = document.getElementById('terminal-content');
  if (!contentEl) { isTerminalTyping = false; return; }
  contentEl.innerHTML = '';

  await typeTerminalLine('[ OK ] DenzcOne Engine Initialized', 7);
  commitTerminalLine('text-neo-mint font-mono font-bold');

  await typeTerminalLine('[ OK ] Synchronized Router Engine', 7);
  commitTerminalLine('text-neo-mint font-mono font-bold');

  await typeTerminalLine('justputu@DenzcOne:~# denzcone-cli scan', 8);
  commitTerminalLine('text-white font-bold');

  const categories = Object.keys(registry);
  let totalLoaded = 0;

  for (const cat of categories) {
    const list = safeArr(registry[cat]);
    for (const ep of list) {
      totalLoaded++;
      const method = (Array.isArray(ep.method) ? ep.method[0] : ep.method) || 'GET';
      const path = ep.endpoint || '/';
      await typeTerminalLine(`[LOADED] ${method} ${path}`, 4);
      commitTerminalLine('text-neo-violet font-mono');
    }
  }

  await typeTerminalLine(`[INFO] ${totalLoaded} endpoints active`, 7);
  commitTerminalLine('text-white font-bold');
  await typeTerminalLine('justputu@DenzcOne:~# ready', 7);
  commitTerminalLine('text-white/40');
  isTerminalTyping = false;
};

async function rescanConsole() {
  try {
    await fetchEndpoints();
    await runConsoleBootSequence();
    notify('success', 'Katalog berhasil dimuat ulang');
  } catch (e) { notify('error', 'Gagal re-scan'); }
}

async function fetchEndpoints() {
  try {
    const res = await fetch(`/api/endpoints?_t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data && data.status && data.result) {
      registry = data.result.endpoints || {};
      document.getElementById('stat-total').textContent = data.result.total || 0;
      document.getElementById('stat-categories').textContent = Object.keys(registry).length;
      buildCategoryTabs();
      renderEndpoints();
    }
  } catch (err) {
    document.getElementById('endpoint-container').innerHTML = `
      <div class="text-center py-12 neo-card bg-neo-rose text-white text-xs font-mono font-bold">Gagal memuat endpoint: ${err.message}</div>
    `;
  }
}

function buildCategoryTabs() {
  const container = document.getElementById('category-tabs');
  if (!container) return;
  container.innerHTML = `<button onclick="filterCategory('all')" class="neo-btn px-3.5 py-1.5 text-xs font-mono font-bold shrink-0 ${currentCategory === 'all' ? 'bg-neo-violet text-white' : 'bg-white text-neo-dark'}">SEMUA</button>`;
  Object.keys(registry).forEach((cat) => {
    const btn = document.createElement('button');
    btn.onclick = () => filterCategory(cat);
    btn.className = `neo-btn px-3.5 py-1.5 text-xs font-mono font-bold uppercase shrink-0 ${currentCategory === cat ? 'bg-neo-violet text-white' : 'bg-white text-neo-dark'}`;
    btn.textContent = cat;
    container.appendChild(btn);
  });
}

function filterCategory(cat) {
  currentCategory = cat;
  buildCategoryTabs();
  const s = document.getElementById('search-input');
  renderEndpoints(s ? s.value.trim().toLowerCase() : '');
}

function toggleFolder(cat) {
  const content = document.getElementById(`folder-content-${cat}`);
  const chevron = document.getElementById(`folder-chevron-${cat}`);
  const icon    = document.getElementById(`folder-icon-${cat}`);
  if (!content) return;
  const isNowOpen = !openFolders.has(cat);
  if (isNowOpen) {
    openFolders.add(cat); content.classList.add('open');
    if (chevron) chevron.style.transform = 'rotate(180deg)';
    if (icon) icon.setAttribute('data-lucide', 'folder-open');
  } else {
    openFolders.delete(cat); content.classList.remove('open');
    if (chevron) chevron.style.transform = 'rotate(0deg)';
    if (icon) icon.setAttribute('data-lucide', 'folder');
  }
  safeIcon();
}

function renderEndpoints(searchQuery = '') {
  const container = document.getElementById('endpoint-container');
  if (!container) return;
  container.innerHTML = '';
  let count = 0;

  Object.keys(registry).forEach((cat) => {
    if (currentCategory !== 'all' && currentCategory !== cat) return;
    const endpoints = safeArr(registry[cat]).filter((ep) => {
      if (!searchQuery) return true;
      return safeLower(ep.name).includes(searchQuery) || safeLower(ep.endpoint).includes(searchQuery) || safeLower(ep.description).includes(searchQuery);
    });
    if (endpoints.length === 0) return;
    count += endpoints.length;

    if (currentCategory === 'all' && !searchQuery) {
      const isOpen = openFolders.has(cat);
      const folderBox = document.createElement('div');
      folderBox.className = 'neo-card bg-white overflow-hidden';
      folderBox.innerHTML = `
        <div onclick="toggleFolder('${cat}')" class="p-4 flex items-center justify-between cursor-pointer bg-neo-bg/40 hover:bg-neo-bg border-b-2 border-neo-dark">
          <div class="flex items-center gap-3">
            <div class="w-9 h-9 bg-neo-violet text-white border-2 border-neo-dark rounded-xl flex items-center justify-center shadow-brutal-sm">
              <i data-lucide="${isOpen ? 'folder-open' : 'folder'}" id="folder-icon-${cat}" class="w-4 h-4"></i>
            </div>
            <div>
              <h3 class="text-xs font-heading font-black uppercase text-neo-dark">${cat}</h3>
              <span class="text-[10px] font-mono font-bold text-neo-dark/60">${endpoints.length} ENDPOINTS</span>
            </div>
          </div>
          <div class="w-7 h-7 bg-white border-2 border-neo-dark rounded-lg flex items-center justify-center shadow-brutal-sm">
            <i data-lucide="chevron-down" id="folder-chevron-${cat}" class="w-3.5 h-3.5 transition-transform duration-300" style="transform: ${isOpen ? 'rotate(180deg)' : 'rotate(0deg)'}"></i>
          </div>
        </div>
        <div id="folder-content-${cat}" class="folder-content ${isOpen ? 'open' : ''}"><div class="overflow-hidden"><div class="p-4 grid grid-cols-1 gap-3" id="folder-grid-${cat}"></div></div></div>
      `;
      container.appendChild(folderBox);
      const grid = document.getElementById(`folder-grid-${cat}`);
      if (grid) endpoints.forEach((ep) => grid.appendChild(createEndpointCard(ep)));
    } else {
      const block = document.createElement('div');
      block.className = 'space-y-3';
      block.innerHTML = `
        <div class="flex items-center gap-2 pb-1 border-b-2 border-neo-dark">
          <span class="w-3 h-3 bg-neo-violet border border-neo-dark rounded-sm"></span>
          <h3 class="text-xs font-heading font-black uppercase text-neo-dark">${cat}</h3>
          <span class="text-[10px] font-mono font-bold text-neo-dark/60">(${endpoints.length})</span>
        </div>
        <div class="grid grid-cols-1 gap-3" id="grid-${cat}"></div>
      `;
      container.appendChild(block);
      const grid = document.getElementById(`grid-${cat}`);
      if (grid) endpoints.forEach((ep) => grid.appendChild(createEndpointCard(ep)));
    }
  });

  if (count === 0) container.innerHTML = `<div class="text-center py-16 neo-card bg-white text-xs font-mono font-bold">Tidak ada endpoint yang cocok.</div>`;
  safeIcon();
}

function createEndpointCard(ep) {
  const card = document.createElement('div');
  card.className = 'neo-card neo-card-hover bg-white p-4 cursor-pointer flex flex-col justify-between space-y-3';
  card.onclick = () => openModal(ep);
  const method = (Array.isArray(ep.method) ? ep.method[0] : ep.method) || 'GET';
  const methodBadge = method === 'POST' ? 'bg-neo-blue text-white' : 'bg-neo-mint text-neo-dark';
  card.innerHTML = `
    <div>
      <div class="flex items-center justify-between gap-2 mb-1.5">
        <h4 class="text-xs font-heading font-black uppercase text-neo-dark">${ep.name || 'Untitled'}</h4>
        <span class="px-2 py-0.5 text-[9px] font-mono font-black border-2 border-neo-dark rounded-md ${methodBadge}">${method}</span>
      </div>
      <p class="text-[11px] text-neo-dark/80 font-semibold leading-relaxed">${ep.description || 'Tanpa deskripsi.'}</p>
    </div>
    <div class="flex items-center justify-between pt-2.5 border-t-2 border-neo-dark/10 text-[11px] font-mono font-bold">
      <span class="truncate max-w-[180px] sm:max-w-[260px] text-neo-violet">${ep.endpoint || '/'}</span>
      <div class="flex items-center gap-1 text-neo-dark font-black"><span>TEST</span><i data-lucide="arrow-right" class="w-3.5 h-3.5"></i></div>
    </div>
  `;
  return card;
}

/* ==========================================
   MODAL LOGIC (ANTI NYANGKUT)
   ========================================== */
function openModal(ep) {
  activeEndpoint = ep;
  const modal = document.getElementById('modal-sheet');
  const backdrop = document.getElementById('modal-backdrop');
  if (!modal || !backdrop) return;

  const method = (Array.isArray(ep.method) ? ep.method[0] : ep.method) || 'GET';
  document.getElementById('modal-title').textContent = ep.name || 'Endpoint';
  document.getElementById('modal-desc').textContent = ep.description || '-';
  document.getElementById('modal-path').textContent = ep.endpoint || '/';
  document.getElementById('modal-badge-method').textContent = method;

  const inputsContainer = document.getElementById('modal-inputs');
  inputsContainer.innerHTML = '';
  const params = ep.params && typeof ep.params === 'object' ? ep.params : {};
  const keys = Object.keys(params);

  if (keys.length === 0) {
    inputsContainer.innerHTML = `<div class="text-xs font-mono font-bold text-neo-dark/70 p-3 bg-neo-bg border-2 border-neo-dark rounded-xl">Tidak perlu parameter.</div>`;
  } else {
    keys.forEach((key) => {
      const item = params[key];
      const isReq = typeof item === 'object' ? !!item.required : false;
      const desc = typeof item === 'object' ? (item.description || '') : '';
      inputsContainer.innerHTML += `
        <div class="space-y-1">
          <div class="flex items-center justify-between text-xs font-mono font-bold gap-2">
            <label class="text-neo-dark uppercase">${key} ${isReq ? '<span class="text-neo-rose">*</span>' : ''}</label>
            <span class="text-[10px] text-neo-dark/60 truncate">${desc}</span>
          </div>
          <input type="text" name="${key}" ${isReq ? 'required' : ''} placeholder="Masukkan ${key}..." class="w-full neo-input px-3 py-2 text-xs font-mono font-bold bg-neo-bg focus:bg-white" />
        </div>
      `;
    });
  }

  document.getElementById('modal-response-wrapper').classList.add('hidden');
  document.body.style.overflow = 'hidden';

  // Animasi Buka Modal
  backdrop.classList.remove('opacity-0', 'pointer-events-none');
  backdrop.classList.add('opacity-100', 'pointer-events-auto');

  modal.classList.remove('hidden');
  void modal.offsetWidth; // Trigger reflow
  modal.classList.remove('translate-y-full', 'opacity-0', 'sm:-translate-y-[40%]');
  modal.classList.add('translate-y-0', 'opacity-100', 'sm:-translate-y-1/2');

  safeIcon();
}

function closeModal() {
  const modal = document.getElementById('modal-sheet');
  const backdrop = document.getElementById('modal-backdrop');
  if (!modal || !backdrop) return;

  // Animasi Tutup Modal
  modal.classList.remove('translate-y-0', 'opacity-100', 'sm:-translate-y-1/2');
  modal.classList.add('translate-y-full', 'opacity-0', 'sm:-translate-y-[40%]');
  
  backdrop.classList.remove('opacity-100', 'pointer-events-auto');
  backdrop.classList.add('opacity-0', 'pointer-events-none');
  
  document.body.style.overflow = '';
  activeEndpoint = null;

  setTimeout(() => { modal.classList.add('hidden'); }, 300);
}

async function executeRequest(e) {
  e.preventDefault();
  if (!activeEndpoint) return;

  const submitBtn = document.getElementById('btn-submit');
  const submitText = document.getElementById('btn-submit-text');
  const submitIcon = document.getElementById('btn-submit-icon');
  const responseWrapper = document.getElementById('modal-response-wrapper');
  const responseBody = document.getElementById('modal-response-body');
  const statusPill = document.getElementById('modal-status-pill');
  const timePill = document.getElementById('modal-time-pill');

  submitBtn.disabled = true;
  submitBtn.classList.add('opacity-70');
  submitText.textContent = 'Memproses...';
  submitIcon.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i>';
  safeIcon();

  const formData = new FormData(e.target);
  const queryParams = new URLSearchParams();
  const bodyPayload = {};

  for (const [key, val] of formData.entries()) {
    if (val.trim()) { queryParams.append(key, val.trim()); bodyPayload[key] = val.trim(); }
  }

  const method = (Array.isArray(activeEndpoint.method) ? activeEndpoint.method[0] : activeEndpoint.method) || 'GET';
  let url = activeEndpoint.endpoint || '/';
  const options = { method };

  if (method === 'GET') {
    const qs = queryParams.toString();
    if (qs) url += (url.includes('?') ? '&' : '?') + qs;
  } else {
    options.headers = { 'Content-Type': 'application/json' };
    options.body = JSON.stringify(bodyPayload);
  }

  const start = performance.now();
  try {
    const response = await fetch(url, options);
    const duration = Math.round(performance.now() - start);
    const json = await response.json();
    rawResponseText = JSON.stringify(json, null, 2);
    statusPill.textContent = `${response.status} ${response.statusText || 'OK'}`;
    statusPill.className = response.ok ? 'text-[10px] font-mono font-bold px-2 py-0.5 bg-neo-mint border-2 border-neo-dark rounded-md text-neo-dark' : 'text-[10px] font-mono font-bold px-2 py-0.5 bg-neo-rose border-2 border-neo-dark rounded-md text-white';
    timePill.textContent = `${duration}ms`;
    responseBody.innerHTML = formatCodeHighlight(json);
    responseWrapper.classList.remove('hidden');
    notify(response.ok ? 'success' : 'error', response.ok ? `Berhasil (${response.status})` : (json.message || 'Gagal'));
  } catch (err) {
    const duration = Math.round(performance.now() - start);
    const errorObj = { status: false, message: err.message };
    rawResponseText = JSON.stringify(errorObj, null, 2);
    statusPill.textContent = 'Error';
    statusPill.className = 'text-[10px] font-mono font-bold px-2 py-0.5 bg-neo-rose border-2 border-neo-dark rounded-md text-white';
    timePill.textContent = `${duration}ms`;
    responseBody.innerHTML = formatCodeHighlight(errorObj);
    responseWrapper.classList.remove('hidden');
    notify('error', err.message || 'Gagal request');
  } finally {
    submitBtn.disabled = false;
    submitBtn.classList.remove('opacity-70');
    submitText.textContent = 'Jalankan Request';
    submitIcon.innerHTML = '<i data-lucide="send" class="w-4 h-4"></i>';
    safeIcon();
  }
}

function copyRoute() {
  if (!activeEndpoint) return;
  navigator.clipboard.writeText(window.location.origin + (activeEndpoint.endpoint || '/'));
  notify('success', 'Route disalin');
}

function copyResponse() {
  if (rawResponseText) {
    navigator.clipboard.writeText(rawResponseText);
    notify('success', 'JSON disalin');
  }
}

async function checkLatency() {
  const el = document.getElementById('bottom-latency');
  if (!el) return;
  const start = performance.now();
  try {
    await fetch('/tools/ping');
    el.textContent = `${Math.round(performance.now() - start)}ms`;
  } catch {
    el.textContent = 'Offline';
  }
}

window.addEventListener('DOMContentLoaded', async () => {
  safeIcon();
  await fetchEndpoints();
  checkLatency();
  await runConsoleBootSequence();
  const searchInput = document.getElementById('search-input');
  if (searchInput) searchInput.addEventListener('input', (e) => renderEndpoints(e.target.value.trim().toLowerCase()));
});
