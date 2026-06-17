/**
 * BanquetTable - 聚餐自動分組分桌系統核心邏輯
 * 包含：狀態管理、隨機分桌演算法、輕量化 Supabase REST Client、CSV 下載與 UI 渲染
 */

const TABLE_NAMES = [
  "吉星高照", "福祿雙全", "喜氣洋洋", "金玉滿堂", 
  "龍鳳呈祥", "闔家歡樂", "步步高升", "大吉大利", 
  "四季平安", "迎春接福", "萬事如意", "心想事成", 
  "富貴吉祥", "鴻運當頭", "雙喜臨門", "五福臨門",
  "前程似錦", "鼎盛昌隆", "瑞氣祥雲", "如意吉祥"
];

class BanquetTableApp {
  constructor() {
    this.state = {
      mode: 'local', // 'local' 或 'cloud'
      eventName: '歡樂聚餐分桌活動',
      tableCount: 5,
      tableCapacity: 8,
      supabaseUrl: '',
      supabaseKey: '',
      eventId: '',
      participants: [],
      myRegistration: null // 本裝置的登記結果 { name, tableNumber }
    };

    // 初始化事件監聽
    window.addEventListener('DOMContentLoaded', () => this.init());
  }

  /**
   * 初始化應用程式
   */
  async init() {
    // 渲染圖示 (Lucide Icons)
    lucide.createIcons();
    
    // 解析網頁 URL 參數，判斷是否為受邀登記頁面
    const isJoinView = this.parseUrlParams();

    if (isJoinView) {
      this.showView('join-view');
      this.updateJoinViewUI();
      // 讀取該活動的最新參與者清單
      await this.fetchParticipants();
      
      // 檢查此裝置是否已經登記過
      this.checkLocalRegistration();
    } else {
      // 載入本地儲存的管理者設定
      this.loadAdminConfig();
      this.showView('setup-view');
      
      if (this.state.eventId) {
        // 如果已經初始化過，直接顯示儀表板
        document.getElementById('admin-dashboard').classList.remove('hidden');
        this.updateShareLinkUI();
        await this.fetchParticipants();
        // 雲端模式下啟動自動輪詢 (每 5 秒更新一次管理面板)
        if (this.state.mode === 'cloud') {
          this.startPolling();
        }
      }
    }
  }

  /**
   * 切換檢視畫面 (setup-view / join-view / result-view)
   */
  showView(viewId) {
    document.querySelectorAll('.app-view').forEach(view => {
      view.classList.remove('active');
    });
    const activeView = document.getElementById(viewId);
    if (activeView) {
      activeView.classList.add('active');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  /**
   * 解析 URL 中的連線參數
   */
  parseUrlParams() {
    const hash = window.location.hash;
    if (!hash.startsWith('#/join')) return false;

    try {
      const urlParams = new URLSearchParams(hash.substring(hash.indexOf('?')));
      const eventId = urlParams.get('id');
      const mode = urlParams.get('mode') || 'local';
      
      if (!eventId) return false;

      this.state.eventId = eventId;
      this.state.mode = mode;
      this.state.eventName = urlParams.get('name') || '聚餐分桌活動';
      this.state.tableCount = parseInt(urlParams.get('tables')) || 5;
      this.state.tableCapacity = parseInt(urlParams.get('cap')) || 8;

      if (mode === 'cloud') {
        // 從 Base64 解碼 Supabase URL 與 Key
        const rawUrl = urlParams.get('sbu');
        const rawKey = urlParams.get('sbk');
        if (rawUrl && rawKey) {
          this.state.supabaseUrl = atob(rawUrl);
          this.state.supabaseKey = atob(rawKey);
        }
      }
      return true;
    } catch (e) {
      console.error("解析邀請網址參數時出錯：", e);
      return false;
    }
  }

  /**
   * 載入管理端配置 (LocalStorage)
   */
  loadAdminConfig() {
    const config = localStorage.getItem('bt_admin_config');
    if (config) {
      try {
        const parsed = JSON.parse(config);
        this.state.mode = parsed.mode || 'local';
        this.state.eventName = parsed.eventName || '歡樂聚餐分桌活動';
        this.state.tableCount = parsed.tableCount || 5;
        this.state.tableCapacity = parsed.tableCapacity || 8;
        this.state.supabaseUrl = parsed.supabaseUrl || '';
        this.state.supabaseKey = parsed.supabaseKey || '';
        this.state.eventId = parsed.eventId || '';

        // 更新 UI 欄位值
        document.getElementById('event-name').value = this.state.eventName;
        document.getElementById('table-count').value = this.state.tableCount;
        document.getElementById('table-capacity').value = this.state.tableCapacity;
        document.getElementById('sb-url').value = this.state.supabaseUrl;
        document.getElementById('sb-key').value = this.state.supabaseKey;

        this.setMode(this.state.mode);
      } catch (e) {
        console.error("載入管理端配置失敗：", e);
      }
    }
  }

  /**
   * 儲存管理者配置並初始化
   */
  async saveSettings() {
    const eventName = document.getElementById('event-name').value.trim();
    const tableCount = parseInt(document.getElementById('table-count').value);
    const tableCapacity = parseInt(document.getElementById('table-capacity').value);
    const mode = this.state.mode;

    if (!eventName) {
      alert("請輸入活動名稱！");
      return;
    }

    let supabaseUrl = '';
    let supabaseKey = '';

    if (mode === 'cloud') {
      supabaseUrl = document.getElementById('sb-url').value.trim();
      supabaseKey = document.getElementById('sb-key').value.trim();

      if (!supabaseUrl || !supabaseKey) {
        alert("選擇雲端同步模式時，必須填入 Supabase URL 及 Anon Key！");
        return;
      }
    }

    // 產生一個唯一的活動 ID (如果是新活動或更新)
    const eventId = this.state.eventId || `evt_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

    this.state.eventName = eventName;
    this.state.tableCount = tableCount;
    this.state.tableCapacity = tableCapacity;
    this.state.supabaseUrl = supabaseUrl;
    this.state.supabaseKey = supabaseKey;
    this.state.eventId = eventId;

    // 儲存設定至本地 LocalStorage
    const adminConfig = { mode, eventName, tableCount, tableCapacity, supabaseUrl, supabaseKey, eventId };
    localStorage.setItem('bt_admin_config', JSON.stringify(adminConfig));

    // 更新連線標誌
    this.updateConnectionStatusBadge();

    // 載入最新的參與者資料並重新繪製 UI
    await this.fetchParticipants();
    
    // 展開管理主控台
    document.getElementById('admin-dashboard').classList.remove('hidden');
    this.updateShareLinkUI();
    
    // 滾動到儀表板
    setTimeout(() => {
      document.getElementById('admin-dashboard').scrollIntoView({ behavior: 'smooth' });
    }, 100);

    // 雲端模式下啟動自動輪詢
    this.stopPolling();
    if (mode === 'cloud') {
      this.startPolling();
    }
  }

  /**
   * 切換模式 Tab (LocalStorage vs Supabase)
   */
  setMode(mode) {
    this.state.mode = mode;
    const btnLocal = document.getElementById('btn-mode-local');
    const btnCloud = document.getElementById('btn-mode-cloud');
    const configDrawer = document.getElementById('supabase-config');

    if (mode === 'local') {
      btnLocal.classList.add('active');
      btnCloud.classList.remove('active');
      configDrawer.classList.add('hidden');
      configDrawer.style.maxHeight = '0px';
    } else {
      btnLocal.classList.remove('active');
      btnCloud.classList.add('active');
      configDrawer.classList.remove('hidden');
      configDrawer.style.maxHeight = '400px'; // 展開抽屜
    }
    
    this.updateConnectionStatusBadge();
  }

  /**
   * 更新連線狀態徽章
   */
  updateConnectionStatusBadge() {
    const badge = document.getElementById('connection-status');
    if (this.state.mode === 'local') {
      badge.className = "status-badge status-local";
      badge.innerHTML = `<i data-lucide="shield-check"></i> <span>單機本機模式</span>`;
    } else {
      badge.className = "status-badge status-cloud";
      badge.innerHTML = `<i data-lucide="cloud-lightning"></i> <span>雲端即時模式</span>`;
    }
    lucide.createIcons();
  }

  /**
   * 更新分享連結輸入框
   */
  updateShareLinkUI() {
    const baseUrl = window.location.origin + window.location.pathname;
    let shareUrl = `${baseUrl}#/join?id=${this.state.eventId}&mode=${this.state.mode}&name=${encodeURIComponent(this.state.eventName)}&tables=${this.state.tableCount}&cap=${this.state.tableCapacity}`;
    
    if (this.state.mode === 'cloud') {
      // 將 Supabase 金鑰與 URL 編碼成 Base64，避免直接出現在網址明文中
      const b64Url = btoa(this.state.supabaseUrl);
      const b64Key = btoa(this.state.supabaseKey);
      shareUrl += `&sbu=${b64Url}&sbk=${b64Key}`;
    }

    document.getElementById('share-link-input').value = shareUrl;
  }

  /**
   * 複製分享連結
   */
  copyShareLink() {
    const copyInput = document.getElementById('share-link-input');
    copyInput.select();
    copyInput.setSelectionRange(0, 99999);
    navigator.clipboard.writeText(copyInput.value);

    const copyBtn = document.getElementById('btn-copy');
    const originalHTML = copyBtn.innerHTML;
    copyBtn.className = "btn btn-accent btn-icon";
    copyBtn.innerHTML = `<i data-lucide="check"></i> <span>已複製！</span>`;
    lucide.createIcons();

    setTimeout(() => {
      copyBtn.className = "btn btn-secondary btn-icon";
      copyBtn.innerHTML = originalHTML;
      lucide.createIcons();
    }, 2000);
  }

  /**
   * 取得參與者列表 (根據當前模式)
   */
  async fetchParticipants() {
    if (this.state.mode === 'local') {
      // 本地模式：從 LocalStorage 讀取該 eventId 的名單
      const localData = localStorage.getItem(`bt_event_${this.state.eventId}`);
      this.state.participants = localData ? JSON.parse(localData) : [];
    } else {
      // 雲端模式：透過輕量化 REST API 呼叫 Supabase
      this.state.participants = await this.supabaseFetch();
    }
    this.renderTables();
    this.updateStats();
  }

  /**
   * 更新登記統計 UI
   */
  updateStats() {
    const count = this.state.participants.length;
    const maxCapacity = this.state.tableCount * this.state.tableCapacity;
    const remaining = Math.max(0, maxCapacity - count);

    const regEl = document.getElementById('stat-registered');
    const capEl = document.getElementById('stat-capacity');
    const remEl = document.getElementById('stat-remaining');

    if (regEl) regEl.textContent = count;
    if (capEl) capEl.textContent = `${count} / ${maxCapacity}`;
    if (remEl) remEl.textContent = remaining;
  }

  /**
   * 取得某一桌的名稱
   */
  getTableName(tableNum) {
    const idx = (tableNum - 1) % TABLE_NAMES.length;
    return `${TABLE_NAMES[idx]}桌`;
  }

  /**
   * 繪製所有分桌卡片至管理面板
   */
  renderTables() {
    const container = document.getElementById('tables-grid');
    if (!container) return;

    container.innerHTML = '';

    for (let t = 1; t <= this.state.tableCount; t++) {
      const tableCard = document.createElement('div');
      tableCard.className = 'table-card';
      
      const mates = this.state.participants.filter(p => p.table_number === t);
      const isFull = mates.length >= this.state.tableCapacity;
      
      if (isFull) {
        tableCard.classList.add('full');
      }

      const tableName = this.getTableName(t);

      // 卡片標頭
      let cardHTML = `
        <div class="table-header">
          <span class="table-title">第 ${t} 桌 (${tableName})</span>
          <span class="table-capacity-tag">${mates.length} / ${this.state.tableCapacity}</span>
        </div>
        <div class="mates-list">
      `;

      // 繪製已入座的人員
      mates.forEach(mate => {
        const firstChar = mate.name.charAt(0);
        cardHTML += `
          <div class="mate-item">
            <div class="mate-avatar">${firstChar}</div>
            <span class="mate-name">${mate.name}</span>
          </div>
        `;
      });

      // 剩餘空位以虛線框表示
      const emptySlots = this.state.tableCapacity - mates.length;
      for (let s = 0; s < emptySlots; s++) {
        cardHTML += `
          <div class="mate-empty-slot">
            <span>待登記</span>
          </div>
        `;
      }

      cardHTML += `</div>`;
      tableCard.innerHTML = cardHTML;
      container.appendChild(tableCard);
    }
  }

  /**
   * 註冊參加人員登記並進行自動隨機分組
   */
  async registerParticipant(event) {
    event.preventDefault();
    const nameInput = document.getElementById('participant-name');
    const name = nameInput.value.trim();
    const errorEl = document.getElementById('join-error');

    if (!name) return;
    errorEl.classList.add('hidden');

    // 禁用送出按鈕防止重複連點
    const submitBtn = document.getElementById('btn-submit-join');
    submitBtn.disabled = true;
    submitBtn.innerHTML = `<i data-lucide="loader" class="animate-spin"></i> 正在排座中...`;
    lucide.createIcons();

    try {
      // 1. 即時重新獲取最新名單，確保不會在超載的桌子上加入
      await this.fetchParticipants();

      // 2. 檢查同名是否已存在
      const isDuplicate = this.state.participants.some(p => p.name.toLowerCase() === name.toLowerCase());
      if (isDuplicate) {
        errorEl.querySelector('span').textContent = "此姓名已存在，請使用其他姓名或加註區別符號！";
        errorEl.classList.remove('hidden');
        submitBtn.disabled = false;
        submitBtn.innerHTML = `<i data-lucide="dice-5"></i> 開始自動隨機分桌`;
        lucide.createIcons();
        return;
      }

      // 3. 尋找尚有空位的桌次，並取得每桌的人數
      const tableCounts = [];
      let minCount = Infinity;

      for (let t = 1; t <= this.state.tableCount; t++) {
        const count = this.state.participants.filter(p => p.table_number === t).length;
        if (count < this.state.tableCapacity) {
          tableCounts.push({ tableNum: t, count: count });
          if (count < minCount) {
            minCount = count;
          }
        }
      }

      if (tableCounts.length === 0) {
        errorEl.querySelector('span').textContent = "所有桌次皆已額滿，無法再加入！請聯絡現場管理人員。";
        errorEl.classList.remove('hidden');
        submitBtn.disabled = false;
        submitBtn.innerHTML = `<i data-lucide="dice-5"></i> 開始自動隨機分桌`;
        lucide.createIcons();
        return;
      }

      // 4. 僅從「人數最少」的可用桌次中隨機選定一桌，以達到平衡分配
      const bestTables = tableCounts.filter(tc => tc.count === minCount).map(tc => tc.tableNum);
      const randomIdx = Math.floor(Math.random() * bestTables.length);
      const assignedTableNum = bestTables[randomIdx];

      // 5. 寫入資料庫或 LocalStorage
      const newParticipant = {
        event_id: this.state.eventId,
        name: name,
        table_number: assignedTableNum
      };

      let success = false;
      if (this.state.mode === 'local') {
        this.state.participants.push(newParticipant);
        localStorage.setItem(`bt_event_${this.state.eventId}`, JSON.stringify(this.state.participants));
        success = true;
      } else {
        success = await this.supabaseInsert(newParticipant);
      }

      if (success) {
        // 6. 成功分組，將此裝置的結果儲存於快取
        const regObj = { name, tableNumber: assignedTableNum };
        localStorage.setItem(`bt_registered_${this.state.eventId}`, JSON.stringify(regObj));
        this.state.myRegistration = regObj;

        // 7. 顯示成功結果畫面並發射灑花特效
        this.showResultView(name, assignedTableNum);
      } else {
        errorEl.querySelector('span').textContent = "寫入失敗，請重試！";
        errorEl.classList.remove('hidden');
        submitBtn.disabled = false;
        submitBtn.innerHTML = `<i data-lucide="dice-5"></i> 開始自動隨機分桌`;
        lucide.createIcons();
      }
    } catch (e) {
      console.error(e);
      errorEl.querySelector('span').textContent = "系統連線異常，請重試！";
      errorEl.classList.remove('hidden');
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<i data-lucide="dice-5"></i> 開始自動隨機分桌`;
      lucide.createIcons();
    }
  }

  /**
   * 檢查本裝置是否已登記過，若是則直接鎖定並顯示結果
   */
  checkLocalRegistration() {
    const reg = localStorage.getItem(`bt_registered_${this.state.eventId}`);
    if (reg) {
      try {
        const parsed = JSON.parse(reg);
        this.state.myRegistration = parsed;
        this.showResultView(parsed.name, parsed.tableNumber, false);
      } catch (e) {
        console.error("解析裝置登記快取失敗：", e);
      }
    }
  }

  /**
   * 顯示結果畫面與夥伴名單
   */
  showResultView(name, tableNumber, fireConfetti = true) {
    this.showView('result-view');
    document.getElementById('res-user-name').textContent = name;
    document.getElementById('res-table-number').textContent = `第 ${tableNumber} 桌`;
    document.getElementById('res-table-name').textContent = this.getTableName(tableNumber);

    // 重新取得同桌夥伴名單
    const mates = this.state.participants.filter(p => p.table_number === tableNumber);
    const matesContainer = document.getElementById('res-table-mates');
    matesContainer.innerHTML = '';

    if (mates.length <= 1) {
      matesContainer.innerHTML = `<div class="mate-empty-slot" style="width:100%"><span>您是這一桌第一個入座的嘉賓！</span></div>`;
    } else {
      mates.forEach(mate => {
        const isMe = mate.name.toLowerCase() === name.toLowerCase();
        const badge = document.createElement('div');
        badge.className = `mate-badge ${isMe ? 'highlight' : ''}`;
        badge.textContent = mate.name + (isMe ? ' (您)' : '');
        matesContainer.appendChild(badge);
      });
    }

    if (fireConfetti) {
      this.celebrate();
    }
  }

  /**
   * 歡慶灑花特效
   */
  celebrate() {
    const duration = 3 * 1000;
    const end = Date.now() + duration;

    (function frame() {
      confetti({
        particleCount: 4,
        angle: 60,
        spread: 55,
        origin: { x: 0, y: 0.8 },
        colors: ['#8a5cf5', '#d4a359', '#10b981']
      });
      confetti({
        particleCount: 4,
        angle: 120,
        spread: 55,
        origin: { x: 1, y: 0.8 },
        colors: ['#8a5cf5', '#d4a359', '#10b981']
      });

      if (Date.now() < end) {
        requestAnimationFrame(frame);
      }
    }());
  }

  /**
   * 用戶在結果頁面點擊「查看完整分桌圖」
   */
  viewAllTablesFromResults() {
    const modal = document.getElementById('all-tables-modal');
    const container = document.getElementById('modal-tables-grid');
    container.innerHTML = '';
    
    // 渲染所有桌次
    for (let t = 1; t <= this.state.tableCount; t++) {
      const tableCard = document.createElement('div');
      tableCard.className = 'table-card';
      const tableName = this.getTableName(t);
      const mates = this.state.participants.filter(p => p.table_number === t);
      
      let cardHTML = `
        <div class="table-header">
          <span class="table-title">第 ${t} 桌 (${tableName})</span>
          <span class="table-capacity-tag">${mates.length} / ${this.state.tableCapacity}</span>
        </div>
        <div class="mates-list">
      `;

      mates.forEach(mate => {
        const isMe = this.state.myRegistration && mate.name.toLowerCase() === this.state.myRegistration.name.toLowerCase();
        const firstChar = mate.name.charAt(0);
        cardHTML += `
          <div class="mate-item" style="${isMe ? 'border: 1px solid var(--accent); background: rgba(212,163,89,0.08)' : ''}">
            <div class="mate-avatar" style="${isMe ? 'background: var(--accent); color:#1a1103' : ''}">${firstChar}</div>
            <span class="mate-name" style="${isMe ? 'color: var(--accent); font-weight:700' : ''}">${mate.name} ${isMe ? '(您)' : ''}</span>
          </div>
        `;
      });

      const emptySlots = this.state.tableCapacity - mates.length;
      for (let s = 0; s < emptySlots; s++) {
        cardHTML += `<div class="mate-empty-slot"><span>待登記</span></div>`;
      }

      cardHTML += `</div>`;
      tableCard.innerHTML = cardHTML;
      container.appendChild(tableCard);
    }

    modal.classList.remove('hidden');
  }

  closeModal() {
    document.getElementById('all-tables-modal').classList.add('hidden');
  }

  /**
   * 載入與登記頁面的基本 UI 文字
   */
  updateJoinViewUI() {
    document.getElementById('join-event-title').textContent = this.state.eventName;
    this.updateConnectionStatusBadge();
  }

  /**
   * 管理者導航至專屬登記頁面
   */
  goToJoinPage() {
    const link = document.getElementById('share-link-input').value;
    if (link) {
      window.open(link, '_blank');
    }
  }

  /**
   * 管理者重設活動，清除所有資料
   */
  async resetEvent() {
    if (!confirm("⚠️ 確定要清除此活動所有已分配的分組名單嗎？此動作將無法復原！")) {
      return;
    }

    if (this.state.mode === 'local') {
      localStorage.removeItem(`bt_event_${this.state.eventId}`);
    } else {
      // 呼叫 Supabase 刪除該 event_id 的所有列
      await this.supabaseDeleteAll();
    }

    await this.fetchParticipants();
    alert("所有分組結果已重設！");
  }

  /**
   * 管理者下載 CSV 分組結果
   */
  downloadCSV() {
    if (this.state.participants.length === 0) {
      alert("目前尚無登記資料可下載！");
      return;
    }

    // CSV 格式首列 (BOM 確保 Excel 中文不亂碼)
    let csvContent = "\uFEFF姓名,分配桌次,桌次名稱\n";

    // 依桌次排序後再依姓名排序，更易閱讀
    const sorted = [...this.state.participants].sort((a, b) => {
      if (a.table_number !== b.table_number) return a.table_number - b.table_number;
      return a.name.localeCompare(b.name, 'zh-hant');
    });

    sorted.forEach(p => {
      const tableName = this.getTableName(p.table_number);
      // 溢出字元轉義保護
      const escapedName = p.name.replace(/"/g, '""');
      csvContent += `"${escapedName}",第 ${p.table_number} 桌,"${tableName}"\n`;
    });

    // 建立 Blob 元素一鍵下載
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `${this.state.eventName}_分組名單.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  /* ====================================================
     輕量化 Supabase REST Client
     使用 Fetch API，免安裝任何 external SDK，速度最快
     ==================================================== */
  
  getSupabaseHeaders() {
    return {
      'apikey': this.state.supabaseKey,
      'Authorization': `Bearer ${this.state.supabaseKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    };
  }

  async supabaseFetch() {
    if (!this.state.supabaseUrl || !this.state.supabaseKey) return [];
    try {
      const url = `${this.state.supabaseUrl}/rest/v1/participants?event_id=eq.${encodeURIComponent(this.state.eventId)}&select=*`;
      const res = await fetch(url, {
        method: 'GET',
        headers: this.getSupabaseHeaders()
      });
      if (!res.ok) throw new Error(`Supabase GET error: ${res.statusText}`);
      return await res.json();
    } catch (e) {
      console.error("Supabase 讀取錯誤：", e);
      return [];
    }
  }

  async supabaseInsert(row) {
    if (!this.state.supabaseUrl || !this.state.supabaseKey) return false;
    try {
      const url = `${this.state.supabaseUrl}/rest/v1/participants`;
      const res = await fetch(url, {
        method: 'POST',
        headers: this.getSupabaseHeaders(),
        body: JSON.stringify(row)
      });
      return res.ok;
    } catch (e) {
      console.error("Supabase 寫入錯誤：", e);
      return false;
    }
  }

  async supabaseDeleteAll() {
    if (!this.state.supabaseUrl || !this.state.supabaseKey) return;
    try {
      const url = `${this.state.supabaseUrl}/rest/v1/participants?event_id=eq.${encodeURIComponent(this.state.eventId)}`;
      await fetch(url, {
        method: 'DELETE',
        headers: this.getSupabaseHeaders()
      });
    } catch (e) {
      console.error("Supabase 刪除錯誤：", e);
    }
  }

  /* ====================================================
     雲端即時同步輪詢機制
     ==================================================== */
  
  startPolling() {
    this.pollInterval = setInterval(() => {
      this.fetchParticipants();
    }, 5000);
  }

  stopPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }
}

// 實例化 app
const app = new BanquetTableApp();
