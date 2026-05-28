(() => {
  const STORAGE_KEY = 'workmap_mvp_state_v1';
  const CLOUD_VIEW_KEY = 'workmap_cloud_view_v1';
  const CLOUD_BOARD_KEY = 'workmap_cloud_board_v1';
  const CLOUD_BOARD_SETTINGS_FALLBACK_KEY = 'workmap_cloud_board_settings_v2';
  const CLOUD_CONFIG = window.WORKMAP_SUPABASE || {};
  const CLOUD_ENABLED = Boolean(CLOUD_CONFIG.url && CLOUD_CONFIG.anonKey && window.supabase);
  const supabaseClient = CLOUD_ENABLED ? window.supabase.createClient(CLOUD_CONFIG.url, CLOUD_CONFIG.anonKey) : null;
  const DEFAULT_STATUSES = ['남은 카드', '광고/리드 확보', '문의/방문', '입찰 진행 중', '설계/제작 준비', '설치/시공 중', '마감 예정', '완료', '확인 필요'];
  const CATEGORIES = ['광고 부분', '고객사 확보', '사업부분', '기타'];
  const PRIORITIES = ['낮음', '보통', '높음', '긴급'];
  const STATUS_COLOR = {
    '남은 카드': 'gray',
    '광고/리드 확보': 'green',
    '문의/방문': 'blue',
    '입찰 진행 중': 'orange',
    '설계/제작 준비': 'purple',
    '설치/시공 중': 'blue',
    '마감 예정': 'red',
    '완료': 'green',
    '확인 필요': 'red'
  };
  const CATEGORY_COLOR = {
    '광고 부분': '#32a66b',
    '고객사 확보': '#2f5cff',
    '사업부분': '#7a5cff',
    '기타': '#6d7788'
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  let state = getInitialState();
  let selectedTaskId = null;
  let saveTimer = null;
  let currentUser = null;
  let currentBoardId = null;
  let realtimeChannel = null;
  let applyingRemoteChange = false;
  const pendingCloudTaskTimers = new Map();
  let boardTitleSaveTimer = null;
  let boardSettingsSaveTimer = null;
  let boardSettingsColumnMissing = false;
  let mindDragSuppressClick = false;

  const els = {
    boardTitle: $('#boardTitle'),
    saveStatus: $('#saveStatus'),
    viewHeader: $('#viewHeader'),
    viewRoot: $('#viewRoot'),
    summaryCards: $('#summaryCards'),
    categoryList: $('#categoryList'),
    drawer: $('#drawer'),
    drawerTitle: $('#drawerTitle'),
    drawerBody: $('#drawerBody'),
    shareModal: $('#shareModal'),
    modalBackdrop: $('#modalBackdrop'),
    memberList: $('#memberList'),
    shareUrl: $('#shareUrl'),
    inviteEmail: $('#inviteEmail'),
    inviteRole: $('#inviteRole'),
    cloudStatus: $('#cloudStatus'),
    userEmail: $('#userEmail'),
    signOutBtn: $('#signOutBtn'),
    authScreen: $('#authScreen'),
    authEmail: $('#authEmail'),
    authPassword: $('#authPassword'),
    authMessage: $('#authMessage')
  };

  init();

  async function init() {
    bindGlobalEvents();
    bindAuthEvents();
    renderCloudStatus();
    if (CLOUD_ENABLED) {
      await initCloudMode();
    } else {
      render();
    }
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }


  function bindAuthEvents() {
    if (!CLOUD_ENABLED) return;
    $('#loginBtn')?.addEventListener('click', () => signInWithPassword(false));
    $('#signupBtn')?.addEventListener('click', () => signInWithPassword(true));
    $('#magicLinkBtn')?.addEventListener('click', signInWithMagicLink);
    els.signOutBtn?.addEventListener('click', signOut);
    supabaseClient.auth.onAuthStateChange(async (_event, session) => {
      if (!session) {
        currentUser = null;
        currentBoardId = null;
        if (realtimeChannel) supabaseClient.removeChannel(realtimeChannel);
        realtimeChannel = null;
        renderCloudStatus();
        showAuthScreen(true);
        return;
      }
      if (!currentUser || currentUser.id !== session.user.id) {
        currentUser = session.user;
        await bootSignedInUser();
      }
    });
  }

  async function initCloudMode() {
    try {
      const { data, error } = await supabaseClient.auth.getSession();
      if (error) throw error;
      if (!data.session) {
        showAuthScreen(true);
        els.saveStatus.textContent = '로그인 필요';
        return;
      }
      currentUser = data.session.user;
      await bootSignedInUser();
    } catch (err) {
      console.error(err);
      setAuthMessage(`초기화 오류: ${err.message || err}`, true);
      showAuthScreen(true);
    }
  }

  async function bootSignedInUser() {
    try {
      showAuthScreen(false);
      renderCloudStatus('연결 중…');
      try {
        const { error: inviteClaimError } = await supabaseClient.rpc('claim_board_invites');
        if (inviteClaimError) console.warn('초대 권한 적용 건너뜀:', inviteClaimError.message || inviteClaimError);
      } catch (inviteClaimError) {
        console.warn('초대 권한 적용 건너뜀:', inviteClaimError.message || inviteClaimError);
      }
      await loadOrCreateCloudBoard();
      await subscribeToBoardRealtime();
      renderCloudStatus('Cloud 동기화');
      els.saveStatus.textContent = '동기화됨';
      render();
    } catch (err) {
      console.error(err);
      setAuthMessage(`보드 로딩 오류: ${err.message || err}`, true);
      showAuthScreen(true);
    }
  }

  async function signInWithPassword(signup) {
    const email = els.authEmail.value.trim();
    const password = els.authPassword.value;
    if (!email || !password) return setAuthMessage('이메일과 비밀번호를 입력하세요.', true);
    setAuthMessage(signup ? '회원가입 중…' : '로그인 중…');
    const request = signup
      ? supabaseClient.auth.signUp({ email, password })
      : supabaseClient.auth.signInWithPassword({ email, password });
    const { data, error } = await request;
    if (error) return setAuthMessage(error.message, true);

    // Supabase 설정에 따라 회원가입 직후 또는 로그인 직후 세션이 바로 생길 수 있습니다.
    // 이 경우 Auth 상태 변경 이벤트를 기다리지 않고 곧바로 앱 화면으로 전환합니다.
    if (data?.session?.user) {
      currentUser = data.session.user;
      setAuthMessage('로그인 완료. 보드를 불러오는 중…');
      await bootSignedInUser();
      return;
    }

    setAuthMessage(signup ? '회원가입 완료. 메일 확인이 필요한 설정이면 확인 후 로그인하세요.' : '로그인 완료.');
  }

  async function signInWithMagicLink() {
    const email = els.authEmail.value.trim();
    if (!email) return setAuthMessage('이메일을 입력하세요.', true);
    setAuthMessage('로그인 링크를 보내는 중…');
    const { error } = await supabaseClient.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: location.href.split('#')[0] }
    });
    if (error) return setAuthMessage(error.message, true);
    setAuthMessage('메일함에서 로그인 링크를 확인하세요.');
  }

  async function signOut() {
    await supabaseClient.auth.signOut();
  }

  function setAuthMessage(message, isError = false) {
    if (!els.authMessage) return;
    els.authMessage.textContent = message || '';
    els.authMessage.classList.toggle('danger-text', Boolean(isError));
  }

  function showAuthScreen(show) {
    if (!els.authScreen) return;
    els.authScreen.hidden = !show;
    // 일부 브라우저/스타일 조합에서 hidden 속성이 .auth-screen display:grid에 덮이는 문제를 방지합니다.
    els.authScreen.style.display = show ? 'grid' : 'none';
    $('#app').style.display = show ? 'none' : '';
  }

  function renderCloudStatus(custom) {
    if (!els.cloudStatus) return;
    if (!CLOUD_ENABLED) {
      els.cloudStatus.textContent = '로컬 모드';
      els.userEmail.textContent = '';
      if (els.signOutBtn) els.signOutBtn.hidden = true;
      return;
    }
    els.cloudStatus.innerHTML = custom ? `<strong>${escapeHtml(custom)}</strong>` : '<strong>Cloud 준비</strong>';
    els.userEmail.textContent = currentUser?.email || '';
    if (els.signOutBtn) els.signOutBtn.hidden = !currentUser;
  }

  async function loadOrCreateCloudBoard() {
    const urlBoardId = new URLSearchParams(location.search).get('board');
    let preferredBoardId = urlBoardId || localStorage.getItem(CLOUD_BOARD_KEY) || '';
    let board = null;
    if (preferredBoardId) {
      const { data } = await supabaseClient.from('boards').select('*').eq('id', preferredBoardId).maybeSingle();
      board = data || null;
    }
    if (!board) {
      const { data: boards, error } = await supabaseClient.from('boards').select('*').order('updated_at', { ascending: false });
      if (error) throw error;
      board = boards?.[0] || null;
    }
    if (!board) {
      const { data: created, error } = await supabaseClient.from('boards').insert({ title: demoState().boardName }).select('*').single();
      if (error) throw error;
      board = created;
      await seedDemoTasks(board.id);
    }
    currentBoardId = board.id;
    localStorage.setItem(CLOUD_BOARD_KEY, currentBoardId);
    await loadCloudBoard(currentBoardId);
  }

  async function loadCloudBoard(boardId) {
    const [{ data: board, error: boardError }, { data: tasks, error: tasksError }, { data: members, error: membersError }] = await Promise.all([
      supabaseClient.from('boards').select('*').eq('id', boardId).single(),
      supabaseClient.from('tasks').select('*').eq('board_id', boardId).order('sort_order', { ascending: true }).order('created_at', { ascending: true }),
      supabaseClient.from('board_members').select('*').eq('board_id', boardId).order('created_at', { ascending: true })
    ]);
    if (boardError) throw boardError;
    if (tasksError) throw tasksError;
    if (membersError) throw membersError;
    state = normalizeState({
      boardName: board.title,
      view: localStorage.getItem(CLOUD_VIEW_KEY) || state.view || 'table',
      calendarDate: state.calendarDate || '2026-05-01',
      members: (members || []).map(memberFromRow),
      tasks: (tasks || []).map(taskFromRow),
      settings: mergeBoardSettings(loadLocalBoardSettings(boardId), board.settings)
    });
  }

  async function resetCloudDemo() {
    els.saveStatus.textContent = '샘플 복원 중…';
    const { error: deleteError } = await supabaseClient.from('tasks').delete().eq('board_id', currentBoardId);
    if (deleteError) {
      console.error(deleteError);
      alert('기존 업무 삭제에 실패했습니다.');
      return;
    }
    await seedDemoTasks(currentBoardId);
    await loadCloudBoard(currentBoardId);
    selectedTaskId = null;
    closeDrawer();
    render();
    els.saveStatus.textContent = '샘플 복원됨';
  }

  async function seedDemoTasks(boardId) {
    const sample = demoState().tasks;
    const idMap = new Map(sample.map((t) => [t.id, globalThis.crypto?.randomUUID?.() || t.id]));
    const rows = sample.map((t, index) => ({
      id: idMap.get(t.id),
      board_id: boardId,
      title: t.title,
      category: t.category,
      parent_id: t.parentId ? idMap.get(t.parentId) : null,
      status: t.status,
      start_date: t.startDate || null,
      end_date: t.endDate || null,
      assignee: t.assignee || null,
      priority: t.priority,
      memo: t.memo || null,
      sort_order: index
    }));
    const { error } = await supabaseClient.from('tasks').insert(rows);
    if (error) throw error;
  }

  async function subscribeToBoardRealtime() {
    if (!currentBoardId) return;
    if (realtimeChannel) await supabaseClient.removeChannel(realtimeChannel);
    realtimeChannel = supabaseClient
      .channel(`workmap-board-${currentBoardId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks', filter: `board_id=eq.${currentBoardId}` }, handleTaskRealtime)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'boards', filter: `id=eq.${currentBoardId}` }, handleBoardRealtime)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'board_members', filter: `board_id=eq.${currentBoardId}` }, handleMemberRealtime)
      .subscribe((status) => renderCloudStatus(status === 'SUBSCRIBED' ? '실시간 연결됨' : `실시간 ${status}`));
  }

  function handleTaskRealtime(payload) {
    applyingRemoteChange = true;
    try {
      if (payload.eventType === 'DELETE') {
        state.tasks = state.tasks.filter((t) => t.id !== payload.old.id);
      } else {
        const next = taskFromRow(payload.new);
        const idx = state.tasks.findIndex((t) => t.id === next.id);
        if (idx >= 0) state.tasks[idx] = next;
        else state.tasks.push(next);
      }
      els.saveStatus.textContent = '동기화됨';
      render();
    } finally {
      applyingRemoteChange = false;
    }
  }

  function handleBoardRealtime(payload) {
    let shouldRender = false;
    if (payload.new?.title && payload.new.title !== state.boardName) {
      state.boardName = payload.new.title;
      shouldRender = true;
    }
    if (payload.new && Object.prototype.hasOwnProperty.call(payload.new, 'settings')) {
      const settings = mergeBoardSettings({}, payload.new.settings || {});
      state.statuses = normalizeStatusList(settings.statuses || state.statuses, state.tasks);
      state.mindPositions = normalizeMindPositions(settings.mindPositions || state.mindPositions);
      shouldRender = true;
    }
    if (shouldRender) render();
  }

  function handleMemberRealtime(payload) {
    if (payload.eventType === 'DELETE') {
      state.members = state.members.filter((m) => m.id !== payload.old.id);
    } else {
      const next = memberFromRow(payload.new);
      const idx = state.members.findIndex((m) => m.id === next.id);
      if (idx >= 0) state.members[idx] = next;
      else state.members.push(next);
    }
    if (!els.shareModal.hidden) renderShareModal();
  }

  function taskFromRow(row) {
    return {
      id: row.id,
      title: row.title || '새 업무',
      category: row.category || '기타',
      parentId: row.parent_id || '',
      status: row.status || '남은 카드',
      startDate: row.start_date || '',
      endDate: row.end_date || '',
      assignee: row.assignee || '',
      priority: row.priority || '보통',
      memo: row.memo || '',
      createdAt: row.created_at || new Date().toISOString(),
      updatedAt: row.updated_at || new Date().toISOString()
    };
  }

  function taskToRow(t) {
    return {
      board_id: currentBoardId,
      title: t.title,
      category: t.category || '기타',
      parent_id: t.parentId || null,
      status: t.status || '남은 카드',
      start_date: t.startDate || null,
      end_date: t.endDate || null,
      assignee: t.assignee || null,
      priority: t.priority || '보통',
      memo: t.memo || null
    };
  }

  function memberFromRow(row) {
    return { id: row.id, email: row.email, role: row.role, status: row.status || 'pending' };
  }

  function queueCloudTaskSave(id) {
    if (!CLOUD_ENABLED || !currentBoardId || applyingRemoteChange) return;
    clearTimeout(pendingCloudTaskTimers.get(id));
    els.saveStatus.textContent = 'Cloud 저장 중…';
    pendingCloudTaskTimers.set(id, setTimeout(() => saveCloudTask(id), 450));
  }

  async function saveCloudTask(id) {
    const t = getTask(id);
    if (!t) return;
    const { error } = await supabaseClient.from('tasks').update(taskToRow(t)).eq('id', id).eq('board_id', currentBoardId);
    if (error) {
      console.error(error);
      els.saveStatus.textContent = 'Cloud 저장 실패';
    } else {
      els.saveStatus.textContent = 'Cloud 저장됨';
    }
  }

  function queueBoardTitleSave() {
    if (!CLOUD_ENABLED || !currentBoardId || applyingRemoteChange) return;
    clearTimeout(boardTitleSaveTimer);
    els.saveStatus.textContent = '보드명 저장 중…';
    boardTitleSaveTimer = setTimeout(async () => {
      const { error } = await supabaseClient.from('boards').update({ title: state.boardName }).eq('id', currentBoardId);
      els.saveStatus.textContent = error ? '보드명 저장 실패' : '보드명 저장됨';
      if (error) console.error(error);
    }, 500);
  }

  function queueBoardSettingsSave(immediate = false) {
    scheduleSave(immediate);
    saveLocalBoardSettings();
    if (!CLOUD_ENABLED || !currentBoardId || applyingRemoteChange || boardSettingsColumnMissing) return;
    clearTimeout(boardSettingsSaveTimer);
    const run = () => saveCloudBoardSettings();
    if (immediate) run();
    else boardSettingsSaveTimer = setTimeout(run, 450);
  }

  async function saveCloudBoardSettings() {
    if (!CLOUD_ENABLED || !currentBoardId || boardSettingsColumnMissing) return;
    const settings = getBoardSettings();
    const { error } = await supabaseClient
      .from('boards')
      .update({ settings })
      .eq('id', currentBoardId);
    if (error) {
      console.warn('보드 설정 저장 실패:', error.message || error);
      if (String(error.message || '').toLowerCase().includes('settings')) {
        boardSettingsColumnMissing = true;
        els.saveStatus.textContent = '설정은 로컬 저장됨 · SQL 패치 필요';
      } else {
        els.saveStatus.textContent = '보드 설정 저장 실패';
      }
      return;
    }
    els.saveStatus.textContent = '보드 설정 저장됨';
  }

  function getBoardSettings() {
    return {
      statuses: normalizeStatusList(state.statuses, state.tasks),
      mindPositions: normalizeMindPositions(state.mindPositions || {})
    };
  }

  function loadLocalBoardSettings(boardId) {
    if (!boardId) return {};
    try {
      return JSON.parse(localStorage.getItem(`${CLOUD_BOARD_SETTINGS_FALLBACK_KEY}:${boardId}`) || '{}');
    } catch (_) {
      return {};
    }
  }

  function saveLocalBoardSettings() {
    const key = currentBoardId ? `${CLOUD_BOARD_SETTINGS_FALLBACK_KEY}:${currentBoardId}` : `${CLOUD_BOARD_SETTINGS_FALLBACK_KEY}:local`;
    try { localStorage.setItem(key, JSON.stringify(getBoardSettings())); } catch (_) {}
  }

  function mergeBoardSettings(...items) {
    return items.reduce((merged, item) => {
      if (!item || typeof item !== 'object') return merged;
      return {
        statuses: item.statuses || merged.statuses,
        mindPositions: item.mindPositions || merged.mindPositions
      };
    }, { statuses: DEFAULT_STATUSES, mindPositions: {} });
  }

  function getInitialState() {
    const shared = loadSharedStateFromHash();
    if (shared) return normalizeState(shared);
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try { return normalizeState(JSON.parse(saved)); } catch (_) {}
    }
    return demoState();
  }

  function demoState() {
    return {
      boardName: 'LED 전광판 사업 진행 상황',
      view: 'table',
      calendarDate: '2026-05-01',
      statuses: DEFAULT_STATUSES.slice(),
      mindPositions: {},
      members: [
        { id: uid(), email: 'project@sangsangin.co.kr', role: '관리자' }
      ],
      tasks: [
        task('t1', '네이버 키워드 광고', '광고 부분', '', '완료', '2026-05-26', '2026-05-26', '', '보통', '1차 완료'),
        task('t2', '메일 광고', '광고 부분', '', '광고/리드 확보', '2026-05-27', '', '', '보통', '매주 수요일 11시~1시반 발송중'),
        task('t3', '오픈마켓 쇼핑몰 광고', '광고 부분', '', '광고/리드 확보', '', '', '', '보통', '플레이오토를 통해 상품 등록 예정'),
        task('t4', '전화문의 고객사 방문', '고객사 확보', '', '문의/방문', '', '', '문희연 과장, 지상우 이사', '보통', '전화 문의 후 고객사 방문'),
        task('t5', '철원야간경관 사업', '사업부분', '', '입찰 진행 중', '2026-05-29', '', '', '높음', '입찰 진행 중'),
        task('t6', '핵심업체 미팅', '사업부분', 't5', '확인 필요', '2026-05-26', '2026-05-26', '', '높음', '26일 2시 미팅'),
        task('t7', '함체(텍스코스)', '사업부분', 't6', '설계/제작 준비', '', '', '', '보통', '철원야간경관 사업 관련'),
        task('t8', '구조물 작업(유의제 대표)', '사업부분', 't6', '설계/제작 준비', '', '', '유의제 대표', '보통', '철원야간경관 사업 관련'),
        task('t9', '제주국립박물관', '사업부분', '', '설치/시공 중', '2026-05-26', '2026-06-28', '', '높음', '5월 26일부터 설치 작업진행'),
        task('t10', '예천야간경관사업', '사업부분', '', '마감 예정', '2026-05-27', '2026-06-10', '', '높음', '6월 10일 전 마무리'),
        task('t11', '연앙시장 LED 사업', '사업부분', '', '마감 예정', '2026-06-15', '2026-06-30', '', '보통', '6월 중순 사업 진행 예정'),
        task('t12', '시공테크 이동식 실감사업', '사업부분', '', '설계/제작 준비', '', '', '', '보통', '사업 설계중'),
        task('t13', '시공테크 본사 LED 사업', '사업부분', '', '설계/제작 준비', '', '', '', '보통', '사업설계 중')
      ]
    };
  }

  function task(id, title, category, parentId, status, startDate, endDate, assignee, priority, memo) {
    return { id, title, category, parentId, status, startDate, endDate, assignee, priority, memo, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  }

  function normalizeState(raw) {
    const base = demoState();
    const settings = mergeBoardSettings(raw.settings, raw);
    const clean = {
      boardName: raw.boardName || base.boardName,
      view: raw.view || 'table',
      calendarDate: raw.calendarDate || '2026-05-01',
      statuses: Array.isArray(settings.statuses) ? settings.statuses : base.statuses.slice(),
      mindPositions: normalizeMindPositions(settings.mindPositions || raw.mindPositions || {}),
      members: Array.isArray(raw.members) ? raw.members : [],
      tasks: Array.isArray(raw.tasks) ? raw.tasks : []
    };
    clean.tasks = clean.tasks.map((t) => ({
      id: t.id || uid(),
      title: t.title || '새 업무',
      category: t.category || '기타',
      parentId: t.parentId || '',
      status: t.status || '남은 카드',
      startDate: t.startDate || '',
      endDate: t.endDate || '',
      assignee: t.assignee || '',
      priority: t.priority || '보통',
      memo: t.memo || '',
      createdAt: t.createdAt || new Date().toISOString(),
      updatedAt: t.updatedAt || new Date().toISOString()
    }));
    clean.statuses = normalizeStatusList(clean.statuses, clean.tasks);
    return clean;
  }

  function normalizeStatusList(list, tasks = []) {
    const source = Array.isArray(list) && list.length ? list : DEFAULT_STATUSES;
    const normalized = Array.from(new Set([...source, ...tasks.map((t) => t.status)].map((s) => String(s || '').trim()).filter(Boolean)));
    if (!normalized.includes('남은 카드')) normalized.unshift('남은 카드');
    return normalized;
  }

  function normalizeMindPositions(value) {
    const output = {};
    if (!value || typeof value !== 'object') return output;
    Object.entries(value).forEach(([key, pos]) => {
      const x = Number(pos?.x);
      const y = Number(pos?.y);
      if (Number.isFinite(x) && Number.isFinite(y)) output[key] = { x, y };
    });
    return output;
  }

  function getStatuses() {
    state.statuses = normalizeStatusList(state.statuses, state.tasks);
    return state.statuses;
  }

  function bindGlobalEvents() {
    els.boardTitle.addEventListener('input', (e) => {
      state.boardName = e.target.value.trim() || '무제 보드';
      scheduleSave();
      queueBoardTitleSave();
      renderSummary();
      if (state.view === 'mindmap') renderCurrentView();
    });

    $$('.tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        state.view = tab.dataset.view;
        if (CLOUD_ENABLED) localStorage.setItem(CLOUD_VIEW_KEY, state.view);
        scheduleSave();
        render();
      });
    });

    $('#closeDrawer').addEventListener('click', closeDrawer);
    $('#shareBtn').addEventListener('click', openShareModal);
    $('#closeShareModal').addEventListener('click', closeShareModal);
    els.modalBackdrop.addEventListener('click', closeShareModal);
    $('#addMemberBtn').addEventListener('click', addMemberFromModal);
    $('#makeShareLinkBtn').addEventListener('click', makeShareLink);
    $('#copyShareLinkBtn').addEventListener('click', copyShareLink);
    $('#exportBtn').addEventListener('click', exportJson);
    $('#importFile').addEventListener('change', importJson);
    $('#resetDemoBtn').addEventListener('click', async () => {
      if (!confirm('현재 데이터를 샘플 데이터로 덮어쓸까요?')) return;
      if (CLOUD_ENABLED && currentBoardId) {
        await resetCloudDemo();
      } else {
        state = demoState();
        selectedTaskId = null;
        scheduleSave(true);
        render();
        closeDrawer();
      }
    });

    document.addEventListener('click', (e) => {
      if (mindDragSuppressClick) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      const addStatusButton = e.target.closest('[data-action="add-status"]');
      if (addStatusButton) {
        addKanbanColumn();
        return;
      }
      const resetMindButton = e.target.closest('[data-action="reset-mindmap-layout"]');
      if (resetMindButton) {
        resetMindmapLayout();
        return;
      }
      const deleteStatusButton = e.target.closest('[data-delete-status]');
      if (deleteStatusButton) {
        deleteKanbanColumn(deleteStatusButton.dataset.deleteStatus);
        return;
      }
      const addTaskButton = e.target.closest('[data-action="add-task"]');
      if (addTaskButton) {
        addTask(addTaskButton.dataset.status || '남은 카드');
      }
      const openTaskButton = e.target.closest('[data-open-task]');
      if (openTaskButton) openDrawer(openTaskButton.dataset.openTask);
      const deleteButton = e.target.closest('[data-delete-task]');
      if (deleteButton) deleteTask(deleteButton.dataset.deleteTask);
    });
  }

  function render() {
    els.boardTitle.value = state.boardName;
    $$('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.view === state.view));
    renderSummary();
    renderCategoryList();
    renderCurrentView();
    renderDrawer();
  }

  function renderCurrentView() {
    const viewMap = {
      table: renderTableView,
      mindmap: renderMindmapView,
      kanban: renderKanbanView,
      timeline: renderTimelineView,
      calendar: renderCalendarView
    };
    (viewMap[state.view] || renderTableView)();
  }

  function renderSummary() {
    const total = state.tasks.length;
    const done = state.tasks.filter((t) => t.status === '완료').length;
    const dated = state.tasks.filter((t) => t.startDate || t.endDate).length;
    const overdue = state.tasks.filter((t) => t.endDate && new Date(t.endDate) < startOfDay(new Date()) && t.status !== '완료').length;
    els.summaryCards.innerHTML = [
      summaryCard(total, '전체 업무'),
      summaryCard(done, '완료'),
      summaryCard(dated, '일정 있음'),
      summaryCard(overdue, '마감 지남')
    ].join('');
  }

  function summaryCard(value, label) {
    return `<div class="summary-card"><b>${escapeHtml(value)}</b><span>${escapeHtml(label)}</span></div>`;
  }

  function renderCategoryList() {
    const counts = new Map();
    state.tasks.forEach((t) => counts.set(t.category, (counts.get(t.category) || 0) + 1));
    const categories = Array.from(new Set([...CATEGORIES, ...state.tasks.map((t) => t.category).filter(Boolean)]));
    els.categoryList.innerHTML = categories.map((cat) => `
      <div class="category-pill">
        <span>${escapeHtml(cat)}</span>
        <small>${counts.get(cat) || 0}</small>
      </div>
    `).join('');
  }

  function setHeader(title, subtitle, actions = '') {
    els.viewHeader.innerHTML = `
      <div>
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(subtitle)}</p>
      </div>
      <div class="header-actions">${actions}</div>
    `;
  }

  function emptyState() {
    const tpl = $('#emptyStateTemplate');
    return tpl.innerHTML;
  }

  function renderTableView() {
    setHeader(
      '테이블 원본',
      '이 표가 모든 보기의 기준입니다. 여기서 수정하면 마인드맵, 칸반, 타임라인, 캘린더가 즉시 다시 그려집니다.',
      '<button class="primary-btn" data-action="add-task">업무 추가</button>'
    );
    if (!state.tasks.length) {
      els.viewRoot.innerHTML = emptyState();
      return;
    }
    const parentOptions = (currentId) => ['<option value="">상위 없음</option>']
      .concat(state.tasks.filter((t) => t.id !== currentId).map((t) => `<option value="${escapeAttr(t.id)}">${escapeHtml(t.title)}</option>`))
      .join('');

    els.viewRoot.innerHTML = `
      <div class="data-table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th style="width:190px">업무명</th>
              <th style="width:140px">분류</th>
              <th style="width:170px">상위 업무</th>
              <th style="width:150px">상태</th>
              <th style="width:140px">시작일</th>
              <th style="width:140px">마감일</th>
              <th style="width:140px">담당자</th>
              <th style="width:110px">우선순위</th>
              <th style="width:230px">메모</th>
              <th class="action-cell">삭제</th>
            </tr>
          </thead>
          <tbody>
            ${state.tasks.map((t) => `
              <tr>
                <td><input class="data-input" data-field="title" data-id="${escapeAttr(t.id)}" value="${escapeAttr(t.title)}"></td>
                <td>${selectHtml('category', t.id, categoriesWithCurrent(t.category), t.category)}</td>
                <td><select class="data-select" data-field="parentId" data-id="${escapeAttr(t.id)}">${markSelected(parentOptions(t.id), t.parentId)}</select></td>
                <td>${selectHtml('status', t.id, statusesWithCurrent(t.status), t.status)}</td>
                <td><input class="data-input" type="date" data-field="startDate" data-id="${escapeAttr(t.id)}" value="${escapeAttr(t.startDate)}"></td>
                <td><input class="data-input" type="date" data-field="endDate" data-id="${escapeAttr(t.id)}" value="${escapeAttr(t.endDate)}"></td>
                <td><input class="data-input" data-field="assignee" data-id="${escapeAttr(t.id)}" value="${escapeAttr(t.assignee)}"></td>
                <td>${selectHtml('priority', t.id, PRIORITIES, t.priority)}</td>
                <td><textarea class="data-input" data-field="memo" data-id="${escapeAttr(t.id)}">${escapeHtml(t.memo)}</textarea></td>
                <td><button class="mini-btn danger-btn" data-delete-task="${escapeAttr(t.id)}">삭제</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
    bindEditableFields(els.viewRoot);
  }

  function bindEditableFields(root) {
    $$('[data-field]', root).forEach((el) => {
      const eventName = el.tagName === 'SELECT' || el.type === 'date' ? 'change' : 'input';
      el.addEventListener(eventName, (e) => {
        updateTask(e.target.dataset.id, e.target.dataset.field, e.target.value, false);
      });
    });
  }

  function categoriesWithCurrent(current) {
    return Array.from(new Set([...CATEGORIES, current].filter(Boolean)));
  }

  function statusesWithCurrent(current) {
    return Array.from(new Set([...getStatuses(), current].filter(Boolean)));
  }

  function selectHtml(field, id, options, current) {
    return `<select class="data-select" data-field="${escapeAttr(field)}" data-id="${escapeAttr(id)}">${options.map((opt) => `<option value="${escapeAttr(opt)}" ${opt === current ? 'selected' : ''}>${escapeHtml(opt)}</option>`).join('')}</select>`;
  }

  function markSelected(optionsHtml, selectedValue) {
    if (!selectedValue) return optionsHtml;
    return optionsHtml.replace(`value="${escapeAttr(selectedValue)}"`, `value="${escapeAttr(selectedValue)}" selected`);
  }

  function renderKanbanView() {
    setHeader(
      '칸반 보기',
      '컬럼을 직접 추가/삭제할 수 있고, 카드를 다른 컬럼으로 드래그하면 상태값이 전체 보기에 반영됩니다.',
      '<button class="ghost-btn" data-action="add-status">+ 컬럼 추가</button><button class="primary-btn" data-action="add-task">업무 추가</button>'
    );
    const statuses = getStatuses();
    els.viewRoot.innerHTML = `
      <div class="kanban-board">
        ${statuses.map((status) => {
          const tasks = state.tasks.filter((t) => t.status === status);
          const canDelete = statuses.length > 1 && status !== '남은 카드';
          return `
            <section class="kanban-column" data-drop-status="${escapeAttr(status)}">
              <div class="kanban-column-header">
                <div class="kanban-column-title">
                  <span>${escapeHtml(status)}</span>
                  <span class="badge gray">${tasks.length}</span>
                </div>
                ${canDelete ? `<button class="kanban-delete-column" title="컬럼 삭제" data-delete-status="${escapeAttr(status)}">×</button>` : ''}
              </div>
              <div class="kanban-cards">
                ${tasks.map(kanbanCard).join('')}
              </div>
              <button class="mini-btn add-card-in-column" data-action="add-task" data-status="${escapeAttr(status)}">+ 카드 추가</button>
            </section>
          `;
        }).join('')}
      </div>
    `;
    bindKanbanDrag();
  }

  function kanbanCard(t) {
    return `
      <article class="kanban-card" draggable="true" data-drag-task="${escapeAttr(t.id)}" data-open-task="${escapeAttr(t.id)}">
        <h3>${escapeHtml(t.title)}</h3>
        <div class="card-meta">
          <span class="badge ${STATUS_COLOR[t.status] || 'gray'}">${escapeHtml(t.status)}</span>
          <span class="badge ${categoryBadgeColor(t.category)}">${escapeHtml(t.category)}</span>
          ${dateRangeLabel(t) ? `<span>📅 ${escapeHtml(dateRangeLabel(t))}</span>` : ''}
          ${t.assignee ? `<span>👤 ${escapeHtml(t.assignee)}</span>` : ''}
        </div>
        ${t.memo ? `<div class="card-memo">${escapeHtml(t.memo)}</div>` : ''}
      </article>
    `;
  }

  function bindKanbanDrag() {
    $$('[data-drag-task]', els.viewRoot).forEach((card) => {
      card.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', card.dataset.dragTask);
        e.dataTransfer.effectAllowed = 'move';
      });
    });
    $$('[data-drop-status]', els.viewRoot).forEach((col) => {
      col.addEventListener('dragover', (e) => {
        e.preventDefault();
        col.classList.add('drag-over');
      });
      col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
      col.addEventListener('drop', (e) => {
        e.preventDefault();
        col.classList.remove('drag-over');
        const id = e.dataTransfer.getData('text/plain');
        if (id) updateTask(id, 'status', col.dataset.dropStatus);
      });
    });
  }

  function addKanbanColumn() {
    const name = prompt('추가할 칸반 컬럼명을 입력하세요.');
    const status = String(name || '').trim();
    if (!status) return;
    if (getStatuses().includes(status)) {
      alert('이미 있는 컬럼입니다.');
      return;
    }
    state.statuses = normalizeStatusList([...getStatuses(), status], state.tasks);
    queueBoardSettingsSave(true);
    render();
  }

  async function deleteKanbanColumn(status) {
    if (!status || status === '남은 카드') {
      alert('남은 카드 컬럼은 기본 컬럼이라 삭제할 수 없습니다.');
      return;
    }
    const affected = state.tasks.filter((t) => t.status === status);
    const fallback = getStatuses().find((s) => s === '남은 카드') || '남은 카드';
    const message = affected.length
      ? `'${status}' 컬럼을 삭제하고, 이 컬럼의 카드 ${affected.length}개를 '${fallback}'로 이동할까요?`
      : `'${status}' 컬럼을 삭제할까요?`;
    if (!confirm(message)) return;

    state.statuses = getStatuses().filter((s) => s !== status);
    if (!state.statuses.includes(fallback)) state.statuses.unshift(fallback);
    affected.forEach((t) => {
      t.status = fallback;
      t.updatedAt = new Date().toISOString();
    });

    if (CLOUD_ENABLED && currentBoardId && affected.length) {
      const { error } = await supabaseClient
        .from('tasks')
        .update({ status: fallback })
        .eq('board_id', currentBoardId)
        .eq('status', status);
      if (error) console.warn('컬럼 삭제 후 카드 이동 저장 실패:', error.message || error);
    }
    queueBoardSettingsSave(true);
    render();
  }

  function renderMindmapView() {
    setHeader(
      '마인드맵 보기',
      '노드를 드래그해서 위치를 조정할 수 있습니다. 노드를 클릭하면 상세 정보를 수정합니다.',
      '<button class="ghost-btn" data-action="reset-mindmap-layout">자동정렬 초기화</button><button class="primary-btn" data-action="add-task">업무 추가</button>'
    );
    if (!state.tasks.length) {
      els.viewRoot.innerHTML = emptyState();
      return;
    }
    const tree = buildMindmapTree();
    layoutTree(tree);
    applySavedMindPositions(tree);
    const allNodes = flattenTree(tree);
    const minX = Math.min(...allNodes.map((n) => n.x)) - 150;
    const maxX = Math.max(...allNodes.map((n) => n.x)) + 150;
    const maxY = Math.max(...allNodes.map((n) => n.y)) + 110;
    const viewBox = `${minX} 0 ${maxX - minX} ${maxY}`;
    const links = [];
    const nodes = [];
    walkTree(tree, (node) => {
      node.children.forEach((child) => links.push(renderMindLink(node, child)));
      nodes.push(renderMindNode(node));
    });
    els.viewRoot.innerHTML = `
      <div class="mindmap-shell">
        <svg class="mindmap-svg" viewBox="${viewBox}" width="${Math.max(1200, maxX - minX)}" height="${Math.max(640, maxY)}">
          ${links.join('')}
          ${nodes.join('')}
        </svg>
      </div>
    `;
    bindMindmapDrag();
  }

  function buildMindmapTree() {
    const root = { id: 'root', type: 'root', title: state.boardName, children: [] };
    const cats = new Map();
    const nodes = new Map();
    const categories = Array.from(new Set(state.tasks.map((t) => t.category || '기타')));
    categories.forEach((cat) => {
      const node = { id: `cat:${cat}`, type: 'category', title: cat, category: cat, children: [] };
      cats.set(cat, node);
      root.children.push(node);
    });
    state.tasks.forEach((t) => {
      nodes.set(t.id, { id: t.id, type: 'task', task: t, title: t.title, category: t.category, children: [] });
    });
    state.tasks.forEach((t) => {
      const node = nodes.get(t.id);
      const parent = t.parentId && nodes.get(t.parentId);
      if (parent && parent.id !== node.id && !createsCycle(t.id, t.parentId)) parent.children.push(node);
      else (cats.get(t.category) || root).children.push(node);
    });
    return root;
  }

  function createsCycle(childId, parentId) {
    let cursor = parentId;
    const seen = new Set();
    while (cursor) {
      if (cursor === childId || seen.has(cursor)) return true;
      seen.add(cursor);
      const t = getTask(cursor);
      cursor = t ? t.parentId : '';
    }
    return false;
  }

  function layoutTree(root) {
    const xSpacing = 190;
    const ySpacing = 112;
    let leaf = 0;
    function layout(node, depth) {
      node.depth = depth;
      node.y = 56 + depth * ySpacing;
      if (!node.children.length) {
        node.x = leaf * xSpacing;
        leaf += 1;
      } else {
        node.children.forEach((child) => layout(child, depth + 1));
        node.x = node.children.reduce((sum, child) => sum + child.x, 0) / node.children.length;
      }
    }
    layout(root, 0);
  }

  function applySavedMindPositions(root) {
    const positions = state.mindPositions || {};
    walkTree(root, (node) => {
      const saved = positions[node.id];
      if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
        node.x = saved.x;
        node.y = saved.y;
      }
    });
  }

  function renderMindLink(parent, child) {
    const py = parent.y + 23;
    const cy = child.y - 23;
    const mid = (py + cy) / 2;
    const color = child.type === 'category' ? (CATEGORY_COLOR[child.category] || '#9fb2dd') : '#9fb2dd';
    return `<path class="mind-link" d="M ${parent.x} ${py} V ${mid} H ${child.x} V ${cy}" style="stroke:${color}"/>`;
  }

  function renderMindNode(node) {
    const isRoot = node.type === 'root';
    const isCategory = node.type === 'category';
    const taskObj = node.task;
    const width = isRoot ? 250 : Math.min(240, Math.max(126, String(node.title).length * 13 + 38));
    const height = isRoot ? 58 : taskObj && taskObj.memo ? 58 : 46;
    const x = node.x - width / 2;
    const y = node.y - height / 2;
    const stroke = isRoot ? '#2f5cff' : isCategory ? (CATEGORY_COLOR[node.category] || '#6d7788') : '#9fb2dd';
    const fill = isRoot ? '#ffffff' : isCategory ? '#ffffff' : '#ffffff';
    const textColor = isRoot ? '#254ad8' : isCategory ? stroke : '#172033';
    const titleLines = wrapText(node.title, isRoot ? 15 : 18, isRoot ? 2 : 1);
    const meta = taskObj ? (dateRangeLabel(taskObj) || taskObj.status) : '';
    return `
      <g class="mind-node" transform="translate(${x},${y})" data-mind-id="${escapeAttr(node.id)}" data-mind-x="${node.x}" data-mind-y="${node.y}" data-mind-width="${width}" data-mind-height="${height}" ${taskObj ? `data-open-task="${escapeAttr(taskObj.id)}"` : ''}>
        <rect width="${width}" height="${height}" rx="12" fill="${fill}" stroke="${stroke}" stroke-width="1.7"></rect>
        ${titleLines.map((line, i) => `<text x="${width / 2}" y="${isRoot ? 23 + i * 20 : 20 + i * 15}" text-anchor="middle" fill="${textColor}" font-size="${isRoot ? 18 : 12}" font-weight="${isRoot ? 900 : isCategory ? 900 : 800}">${escapeHtml(line)}</text>`).join('')}
        ${taskObj ? `<text x="${width / 2}" y="${height - 11}" text-anchor="middle" fill="#6d7788" font-size="10" font-weight="700">${escapeHtml(meta)}</text>` : ''}
      </g>
    `;
  }


  function bindMindmapDrag() {
    const svg = $('.mindmap-svg', els.viewRoot);
    if (!svg) return;
    const svgPoint = (event) => {
      const point = svg.createSVGPoint();
      point.x = event.clientX;
      point.y = event.clientY;
      const matrix = svg.getScreenCTM();
      return matrix ? point.matrixTransform(matrix.inverse()) : { x: event.clientX, y: event.clientY };
    };
    $$('[data-mind-id]', svg).forEach((node) => {
      node.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        const id = node.dataset.mindId;
        const width = Number(node.dataset.mindWidth) || 140;
        const height = Number(node.dataset.mindHeight) || 46;
        const original = { x: Number(node.dataset.mindX), y: Number(node.dataset.mindY) };
        const start = svgPoint(event);
        let latest = original;
        let moved = false;
        node.setPointerCapture?.(event.pointerId);
        node.classList.add('dragging');

        const onMove = (moveEvent) => {
          const now = svgPoint(moveEvent);
          const dx = now.x - start.x;
          const dy = now.y - start.y;
          if (Math.abs(dx) > 2 || Math.abs(dy) > 2) moved = true;
          latest = { x: original.x + dx, y: original.y + dy };
          node.setAttribute('transform', `translate(${latest.x - width / 2},${latest.y - height / 2})`);
        };
        const onUp = () => {
          node.removeEventListener('pointermove', onMove);
          node.removeEventListener('pointerup', onUp);
          node.removeEventListener('pointercancel', onUp);
          node.classList.remove('dragging');
          if (moved) {
            mindDragSuppressClick = true;
            setTimeout(() => { mindDragSuppressClick = false; }, 0);
            state.mindPositions = { ...(state.mindPositions || {}) };
            state.mindPositions[id] = { x: Math.round(latest.x), y: Math.round(latest.y) };
            queueBoardSettingsSave(true);
            renderCurrentView();
          }
        };
        node.addEventListener('pointermove', onMove);
        node.addEventListener('pointerup', onUp);
        node.addEventListener('pointercancel', onUp);
      });
    });
  }

  function resetMindmapLayout() {
    if (!confirm('마인드맵 노드 위치를 자동정렬 상태로 되돌릴까요?')) return;
    state.mindPositions = {};
    queueBoardSettingsSave(true);
    renderCurrentView();
  }

  function wrapText(text, maxChars, maxLines) {
    const normalized = String(text || '').trim();
    if (normalized.length <= maxChars) return [normalized];
    const lines = [];
    let rest = normalized;
    while (rest.length && lines.length < maxLines) {
      if (lines.length === maxLines - 1 && rest.length > maxChars) {
        lines.push(rest.slice(0, maxChars - 1) + '…');
        break;
      }
      lines.push(rest.slice(0, maxChars));
      rest = rest.slice(maxChars);
    }
    return lines;
  }

  function flattenTree(root) {
    const nodes = [];
    walkTree(root, (node) => nodes.push(node));
    return nodes;
  }

  function walkTree(node, fn) {
    fn(node);
    node.children.forEach((child) => walkTree(child, fn));
  }

  function renderTimelineView() {
    setHeader(
      '타임라인 보기',
      '시작일/마감일이 있는 업무가 자동으로 막대로 표시됩니다. 막대를 클릭해 날짜를 수정하면 다른 보기에도 반영됩니다.',
      '<button class="primary-btn" data-action="add-task">업무 추가</button>'
    );
    if (!state.tasks.length) {
      els.viewRoot.innerHTML = emptyState();
      return;
    }
    const datedTasks = state.tasks.filter((t) => t.startDate || t.endDate);
    const undatedTasks = state.tasks.filter((t) => !t.startDate && !t.endDate);
    if (!datedTasks.length) {
      els.viewRoot.innerHTML = `<div class="empty-state"><div class="empty-icon">📅</div><h3>일정이 있는 업무가 없습니다.</h3><p>테이블에서 시작일이나 마감일을 입력하면 타임라인이 자동 생성됩니다.</p></div>`;
      return;
    }
    const dates = datedTasks.flatMap((t) => [t.startDate, t.endDate].filter(Boolean)).map((d) => new Date(d));
    const min = addDays(startOfDay(new Date(Math.min(...dates))), -3);
    const max = addDays(startOfDay(new Date(Math.max(...dates))), 10);
    const totalDays = Math.max(1, daysBetween(min, max) + 1);
    const dayMarks = getDayMarks(min, max);
    const timelineWidth = Math.max(960, totalDays * 58);

    els.viewRoot.innerHTML = `
      <div class="timeline-wrap timeline-daily">
        <div class="timeline-left">
          <div class="timeline-head">업무명</div>
          ${datedTasks.map((t) => `<div class="timeline-label" title="${escapeAttr(t.title)}">${escapeHtml(t.title)}</div>`).join('')}
        </div>
        <div class="timeline-right" style="min-width:${timelineWidth}px">
          <div class="timeline-axis timeline-axis-days" style="--day-count:${totalDays}">
            ${dayMarks.map((d) => `<div class="timeline-day ${d.isMonthStart ? 'month-start' : ''}"><b>${escapeHtml(d.day)}</b><span>${escapeHtml(d.weekday)}</span>${d.isMonthStart ? `<em>${escapeHtml(d.month)}</em>` : ''}</div>`).join('')}
          </div>
          ${datedTasks.map((t) => renderTimelineRow(t, min, totalDays)).join('')}
        </div>
      </div>
      ${undatedTasks.length ? `
        <div class="undated-list">
          <h3>날짜 미정 업무</h3>
          ${undatedTasks.map((t) => `<div class="undated-card"><span>${escapeHtml(t.title)} <span class="badge ${categoryBadgeColor(t.category)}">${escapeHtml(t.category)}</span></span><button class="mini-btn" data-open-task="${escapeAttr(t.id)}">날짜 입력</button></div>`).join('')}
        </div>
      ` : ''}
    `;
  }

  function renderTimelineRow(t, min, totalDays) {
    const start = startOfDay(new Date(t.startDate || t.endDate));
    const end = startOfDay(new Date(t.endDate || t.startDate));
    const left = Math.max(0, daysBetween(min, start)) / totalDays * 100;
    const width = Math.max(2.2, (daysBetween(start, end) + 1) / totalDays * 100);
    const color = timelineColor(t);
    return `
      <div class="timeline-row" style="--day-count:${totalDays}">
        <div class="timeline-bar" data-open-task="${escapeAttr(t.id)}" style="left:${left}%; width:${width}%; background:${color.bg}; border-color:${color.border}; color:${color.text};" title="${escapeAttr(t.title)} · ${escapeAttr(dateRangeLabel(t))}">
          ${escapeHtml(t.title)} ${dateRangeLabel(t) ? `· ${escapeHtml(dateRangeLabel(t))}` : ''}
        </div>
      </div>
    `;
  }

  function getDayMarks(min, max) {
    const marks = [];
    const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
    let cursor = startOfDay(min);
    while (cursor <= max) {
      marks.push({
        day: `${cursor.getMonth() + 1}/${cursor.getDate()}`,
        weekday: weekdays[cursor.getDay()],
        month: `${cursor.getFullYear()}.${String(cursor.getMonth() + 1).padStart(2, '0')}`,
        isMonthStart: cursor.getDate() === 1
      });
      cursor = addDays(cursor, 1);
    }
    return marks;
  }

  function timelineColor(t) {
    const color = STATUS_COLOR[t.status] || categoryBadgeColor(t.category);
    const palette = {
      blue: { bg: '#dbe7ff', border: '#b9ccff', text: '#18388f' },
      green: { bg: '#dff5e9', border: '#bee7d0', text: '#17643d' },
      purple: { bg: '#e8e2ff', border: '#d2c7ff', text: '#4d36b0' },
      orange: { bg: '#ffe6cf', border: '#ffd0a7', text: '#8a4714' },
      red: { bg: '#ffdfe2', border: '#ffc2c8', text: '#a3222c' },
      gray: { bg: '#edf0f5', border: '#dfe5ef', text: '#4b5568' }
    };
    return palette[color] || palette.gray;
  }

  function renderCalendarView() {
    setHeader(
      '캘린더 보기',
      '같은 업무는 날짜별로 반복하지 않고 시작일부터 종료일까지 이어지는 막대로 표시합니다.',
      '<button class="primary-btn" data-action="add-task">업무 추가</button>'
    );
    const cursor = parseMonth(state.calendarDate);
    const gridStart = addDays(new Date(cursor.getFullYear(), cursor.getMonth(), 1), -mondayOffset(new Date(cursor.getFullYear(), cursor.getMonth(), 1)));
    const weeks = Array.from({ length: 6 }, (_, weekIndex) => Array.from({ length: 7 }, (_, dayIndex) => addDays(gridStart, weekIndex * 7 + dayIndex)));
    const weekdayLabels = ['월', '화', '수', '목', '금', '토', '일'];

    els.viewRoot.innerHTML = `
      <div class="calendar-toolbar">
        <div class="calendar-title">${cursor.getFullYear()}년 ${cursor.getMonth() + 1}월</div>
        <div class="calendar-nav">
          <button class="ghost-btn" id="prevMonthBtn">이전 달</button>
          <button class="ghost-btn" id="todayMonthBtn">이번 달</button>
          <button class="ghost-btn" id="nextMonthBtn">다음 달</button>
        </div>
      </div>
      <div class="calendar-board">
        <div class="calendar-weekdays">
          ${weekdayLabels.map((w) => `<div class="weekday">${w}</div>`).join('')}
        </div>
        <div class="calendar-weeks">
          ${weeks.map((week) => renderCalendarWeek(week, cursor)).join('')}
        </div>
      </div>
    `;
    $('#prevMonthBtn').addEventListener('click', () => changeMonth(-1));
    $('#nextMonthBtn').addEventListener('click', () => changeMonth(1));
    $('#todayMonthBtn').addEventListener('click', () => {
      const now = new Date();
      state.calendarDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      scheduleSave();
      renderCurrentView();
    });
  }

  function renderCalendarWeek(week, cursor) {
    const segments = calendarSegmentsForWeek(week);
    const laneCount = Math.max(2, ...segments.map((s) => s.lane + 1));
    return `
      <div class="calendar-week" style="--calendar-lanes:${laneCount}">
        ${week.map((day) => {
          const isOut = day.getMonth() !== cursor.getMonth();
          return `
            <div class="calendar-day-shell ${isOut ? 'out-month' : ''}">
              <div class="day-number">${day.getDate()}</div>
            </div>
          `;
        }).join('')}
        <div class="calendar-event-layer">
          ${segments.map((segment) => {
            const color = timelineColor(segment.task);
            const left = ((segment.colStart - 1) / 7) * 100;
            const width = (segment.span / 7) * 100;
            const classes = [
              'calendar-event-bar',
              segment.startsBefore ? 'continues-before' : '',
              segment.endsAfter ? 'continues-after' : ''
            ].filter(Boolean).join(' ');
            return `<div class="${classes}" data-open-task="${escapeAttr(segment.task.id)}" style="left:${left}%; width:calc(${width}% - 8px); top:${segment.lane * 30}px; background:${color.bg}; border-color:${color.border}; color:${color.text};" title="${escapeAttr(segment.task.title)} · ${escapeAttr(dateRangeLabel(segment.task))}">${escapeHtml(segment.task.title)}</div>`;
          }).join('')}
        </div>
      </div>
    `;
  }

  function calendarSegmentsForWeek(week) {
    const weekStart = startOfDay(week[0]);
    const weekEnd = startOfDay(week[6]);
    const segments = state.tasks
      .filter((t) => t.startDate || t.endDate)
      .map((task) => {
        const taskStart = startOfDay(new Date(task.startDate || task.endDate));
        const taskEnd = startOfDay(new Date(task.endDate || task.startDate));
        if (taskEnd < weekStart || taskStart > weekEnd) return null;
        const segmentStart = taskStart < weekStart ? weekStart : taskStart;
        const segmentEnd = taskEnd > weekEnd ? weekEnd : taskEnd;
        const colStart = mondayOffset(segmentStart) + 1;
        const span = daysBetween(segmentStart, segmentEnd) + 1;
        return {
          task,
          colStart,
          span,
          lane: 0,
          startsBefore: taskStart < weekStart,
          endsAfter: taskEnd > weekEnd
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.colStart - b.colStart || b.span - a.span || a.task.title.localeCompare(b.task.title));

    const laneEnds = [];
    segments.forEach((segment) => {
      const segmentEndCol = segment.colStart + segment.span - 1;
      let lane = laneEnds.findIndex((endCol) => segment.colStart > endCol);
      if (lane < 0) lane = laneEnds.length;
      laneEnds[lane] = segmentEndCol;
      segment.lane = lane;
    });
    return segments;
  }

  function taskOccursOn(t, dayKey) {
    if (!t.startDate && !t.endDate) return false;
    const start = t.startDate || t.endDate;
    const end = t.endDate || t.startDate;
    return dayKey >= start && dayKey <= end;
  }

  function changeMonth(delta) {
    const cursor = parseMonth(state.calendarDate);
    cursor.setMonth(cursor.getMonth() + delta);
    state.calendarDate = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-01`;
    scheduleSave();
    renderCurrentView();
  }

  function parseMonth(value) {
    const d = value ? new Date(value) : new Date();
    if (Number.isNaN(d.getTime())) return new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  }

  function openDrawer(id) {
    selectedTaskId = id;
    renderDrawer();
    els.drawer.classList.add('open');
    els.drawer.setAttribute('aria-hidden', 'false');
  }

  function closeDrawer() {
    selectedTaskId = null;
    els.drawer.classList.remove('open');
    els.drawer.setAttribute('aria-hidden', 'true');
  }

  function renderDrawer() {
    const t = selectedTaskId ? getTask(selectedTaskId) : null;
    if (!t) {
      els.drawerTitle.textContent = '업무';
      els.drawerBody.innerHTML = '<p class="muted">업무를 선택하세요.</p>';
      return;
    }
    els.drawerTitle.textContent = t.title;
    els.drawerBody.innerHTML = `
      <div class="form-grid">
        ${drawerField('업무명', `<input data-drawer-field="title" value="${escapeAttr(t.title)}">`)}
        ${drawerField('분류', drawerSelect('category', categoriesWithCurrent(t.category), t.category))}
        ${drawerField('상위 업무', `<select data-drawer-field="parentId"><option value="">상위 없음</option>${state.tasks.filter((item) => item.id !== t.id).map((item) => `<option value="${escapeAttr(item.id)}" ${item.id === t.parentId ? 'selected' : ''}>${escapeHtml(item.title)}</option>`).join('')}</select>`)}
        ${drawerField('상태', drawerSelect('status', statusesWithCurrent(t.status), t.status))}
        <div class="field-row" style="display:grid; grid-template-columns:1fr 1fr; gap:10px">
          ${drawerField('시작일', `<input type="date" data-drawer-field="startDate" value="${escapeAttr(t.startDate)}">`)}
          ${drawerField('마감일', `<input type="date" data-drawer-field="endDate" value="${escapeAttr(t.endDate)}">`)}
        </div>
        ${drawerField('담당자', `<input data-drawer-field="assignee" value="${escapeAttr(t.assignee)}" placeholder="담당자명">`)}
        ${drawerField('우선순위', drawerSelect('priority', PRIORITIES, t.priority))}
        ${drawerField('상세 정보 / 메모', `<textarea data-drawer-field="memo">${escapeHtml(t.memo)}</textarea>`)}
        <div class="drawer-actions">
          <button class="ghost-btn" data-action="add-child-task" data-parent="${escapeAttr(t.id)}">하위 업무 추가</button>
          <button class="mini-btn danger-btn" data-delete-task="${escapeAttr(t.id)}">삭제</button>
        </div>
      </div>
    `;
    $$('[data-drawer-field]', els.drawerBody).forEach((el) => {
      const eventName = el.tagName === 'SELECT' || el.type === 'date' ? 'change' : 'input';
      el.addEventListener(eventName, (e) => {
        const shouldRerender = el.tagName === 'SELECT' || el.type === 'date';
        updateTask(t.id, e.target.dataset.drawerField, e.target.value, shouldRerender);
      });
    });
    $('[data-action="add-child-task"]', els.drawerBody)?.addEventListener('click', async (e) => {
      const parentId = e.target.dataset.parent;
      const parent = getTask(parentId);
      const newTask = await addTask(parent?.status || '남은 카드', false, parent?.category || '기타', parentId);
      if (newTask?.id) openDrawer(newTask.id);
    });
  }

  function drawerField(label, control) {
    return `<div class="field"><label>${escapeHtml(label)}</label>${control}</div>`;
  }

  function drawerSelect(field, options, current) {
    return `<select data-drawer-field="${escapeAttr(field)}">${options.map((opt) => `<option value="${escapeAttr(opt)}" ${opt === current ? 'selected' : ''}>${escapeHtml(opt)}</option>`).join('')}</select>`;
  }

  function addTask(status = '남은 카드', open = true, category = '기타', parentId = '') {
    if (CLOUD_ENABLED && currentBoardId) return addCloudTask(status, open, category, parentId);
    const newTask = task(uid(), '새 업무', category, parentId, status, '', '', '', '보통', '');
    state.tasks.push(newTask);
    scheduleSave(true);
    render();
    if (open) openDrawer(newTask.id);
    return newTask;
  }

  async function addCloudTask(status = '남은 카드', open = true, category = '기타', parentId = '') {
    const sortOrder = state.tasks.length;
    const { data, error } = await supabaseClient.from('tasks').insert({
      board_id: currentBoardId,
      title: '새 업무',
      category,
      parent_id: parentId || null,
      status,
      priority: '보통',
      sort_order: sortOrder
    }).select('*').single();
    if (error) {
      console.error(error);
      alert('업무 추가에 실패했습니다.');
      return null;
    }
    const newTask = taskFromRow(data);
    if (!state.tasks.some((t) => t.id === newTask.id)) state.tasks.push(newTask);
    render();
    if (open) openDrawer(newTask.id);
    return newTask;
  }

  function updateTask(id, field, value, rerender = true) {
    const t = getTask(id);
    if (!t) return;
    if (field === 'parentId' && (value === id || createsCycle(id, value))) {
      alert('자기 자신 또는 하위 업무를 상위 업무로 지정할 수 없습니다.');
      render();
      return;
    }
    t[field] = value;
    t.updatedAt = new Date().toISOString();
    scheduleSave();
    queueCloudTaskSave(id);
    if (selectedTaskId === id) {
      els.drawerTitle.textContent = t.title;
    }
    if (rerender) render();
    else {
      renderSummary();
      renderCategoryList();
    }
  }

  async function deleteTask(id) {
    const t = getTask(id);
    if (!t) return;
    if (!confirm(`'${t.title}' 업무를 삭제할까요? 하위 업무는 상위 없음으로 변경됩니다.`)) return;
    if (CLOUD_ENABLED && currentBoardId) {
      const { error } = await supabaseClient.from('tasks').delete().eq('id', id).eq('board_id', currentBoardId);
      if (error) {
        console.error(error);
        alert('업무 삭제에 실패했습니다.');
        return;
      }
    }
    state.tasks = state.tasks.filter((item) => item.id !== id).map((item) => item.parentId === id ? { ...item, parentId: '', updatedAt: new Date().toISOString() } : item);
    if (selectedTaskId === id) closeDrawer();
    scheduleSave(true);
    render();
  }

  function getTask(id) {
    return state.tasks.find((t) => t.id === id);
  }

  function scheduleSave(immediate = false) {
    els.saveStatus.textContent = '저장 중…';
    clearTimeout(saveTimer);
    const doSave = () => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        els.saveStatus.textContent = '저장됨';
      } catch (err) {
        els.saveStatus.textContent = '저장 실패';
        console.error(err);
      }
    };
    if (immediate) doSave();
    else saveTimer = setTimeout(doSave, 350);
  }

  function openShareModal() {
    renderShareModal();
    els.modalBackdrop.hidden = false;
    els.shareModal.hidden = false;
  }

  function closeShareModal() {
    els.modalBackdrop.hidden = true;
    els.shareModal.hidden = true;
  }

  function renderShareModal() {
    const note = $('#shareNote');
    if (note) {
      note.innerHTML = CLOUD_ENABLED && currentBoardId
        ? '<b>Cloud 공유</b><br>초대한 이메일 계정이 이 보드 링크로 접속해 로그인하면 같은 DB 데이터를 실시간으로 봅니다.'
        : '<b>로컬 공유</b><br>현재 데이터가 URL에 들어갑니다. 실시간 공동 편집은 Supabase 설정 후 사용할 수 있습니다.';
    }
    els.memberList.innerHTML = state.members.length ? state.members.map((m) => `
      <div class="member-item">
        <div><b>${escapeHtml(m.email)}</b><br><span class="badge gray">${escapeHtml(m.role)}</span> <span class="badge ${m.status === 'active' ? 'green' : 'orange'}">${escapeHtml(m.status || 'local')}</span></div>
        <button class="mini-btn danger-btn" data-remove-member="${escapeAttr(m.id)}">삭제</button>
      </div>
    `).join('') : '<p style="color:var(--muted); margin:0">아직 초대 목록이 없습니다.</p>';
    $$('[data-remove-member]', els.memberList).forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (CLOUD_ENABLED && currentBoardId) {
          const { error } = await supabaseClient.from('board_members').delete().eq('id', btn.dataset.removeMember).eq('board_id', currentBoardId);
          if (error) return alert('멤버 삭제에 실패했습니다. 관리자 권한이 필요할 수 있습니다.');
        }
        state.members = state.members.filter((m) => m.id !== btn.dataset.removeMember);
        scheduleSave(true);
        renderShareModal();
      });
    });
  }

  async function addMemberFromModal() {
    const email = els.inviteEmail.value.trim();
    if (!email) return alert('이메일을 입력하세요.');
    if (CLOUD_ENABLED && currentBoardId) {
      const role = els.inviteRole.value;
      const { data, error } = await supabaseClient.from('board_members').insert({
        board_id: currentBoardId,
        email,
        role,
        status: 'pending'
      }).select('*').single();
      if (error) {
        console.error(error);
        return alert('초대 등록에 실패했습니다. 관리자 권한이 필요하거나 이미 등록된 이메일일 수 있습니다.');
      }
      state.members.push(memberFromRow(data));
    } else {
      state.members.push({ id: uid(), email, role: els.inviteRole.value, status: 'local' });
    }
    els.inviteEmail.value = '';
    scheduleSave(true);
    renderShareModal();
  }

  function makeShareLink() {
    if (CLOUD_ENABLED && currentBoardId) {
      const base = location.href.split('#')[0].split('?')[0];
      els.shareUrl.value = `${base}?board=${encodeURIComponent(currentBoardId)}`;
      return;
    }
    const encoded = encodeState(state);
    const base = location.href.split('#')[0];
    const url = `${base}#data=${encoded}`;
    els.shareUrl.value = url;
  }

  async function copyShareLink() {
    if (!els.shareUrl.value) makeShareLink();
    try {
      await navigator.clipboard.writeText(els.shareUrl.value);
      alert('공유 링크를 복사했습니다.');
    } catch (_) {
      els.shareUrl.select();
      document.execCommand('copy');
      alert('공유 링크를 복사했습니다.');
    }
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${sanitizeFileName(state.boardName)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function importJson(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const data = JSON.parse(reader.result);
        const imported = normalizeState(data);
        if (CLOUD_ENABLED && currentBoardId) {
          if (!confirm('Cloud 보드의 기존 업무를 가져온 JSON으로 교체할까요?')) return;
          await supabaseClient.from('tasks').delete().eq('board_id', currentBoardId);
          const idMap = new Map(imported.tasks.map((t) => [t.id, globalThis.crypto?.randomUUID?.() || t.id]));
          const rows = imported.tasks.map((t, index) => ({
            id: idMap.get(t.id),
            board_id: currentBoardId,
            title: t.title,
            category: t.category,
            parent_id: t.parentId ? idMap.get(t.parentId) : null,
            status: t.status,
            start_date: t.startDate || null,
            end_date: t.endDate || null,
            assignee: t.assignee || null,
            priority: t.priority,
            memo: t.memo || null,
            sort_order: index
          }));
          if (rows.length) {
            const { error } = await supabaseClient.from('tasks').insert(rows);
            if (error) throw error;
          }
          await supabaseClient.from('boards').update({ title: imported.boardName }).eq('id', currentBoardId);
          await loadCloudBoard(currentBoardId);
        } else {
          state = imported;
        }
        selectedTaskId = null;
        scheduleSave(true);
        render();
        closeDrawer();
      } catch (err) {
        console.error(err);
        alert('JSON 파일을 읽을 수 없습니다.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  function loadSharedStateFromHash() {
    if (!location.hash.startsWith('#data=')) return null;
    try {
      return decodeState(location.hash.slice(6));
    } catch (err) {
      console.warn('공유 링크 데이터를 읽지 못했습니다.', err);
      return null;
    }
  }

  function encodeState(obj) {
    const json = JSON.stringify(obj);
    const bytes = new TextEncoder().encode(json);
    let binary = '';
    bytes.forEach((b) => { binary += String.fromCharCode(b); });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function decodeState(str) {
    const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - str.length % 4) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const json = new TextDecoder().decode(bytes);
    return JSON.parse(json);
  }

  function dateRangeLabel(t) {
    if (t.startDate && t.endDate && t.startDate !== t.endDate) return `${formatShortDate(t.startDate)}~${formatShortDate(t.endDate)}`;
    if (t.startDate) return formatShortDate(t.startDate);
    if (t.endDate) return `${formatShortDate(t.endDate)} 마감`;
    return '';
  }

  function formatShortDate(value) {
    if (!value) return '';
    const [y, m, d] = value.split('-');
    return `${Number(m)}/${Number(d)}`;
  }

  function categoryBadgeColor(category) {
    if (category === '광고 부분') return 'green';
    if (category === '고객사 확보') return 'blue';
    if (category === '사업부분') return 'purple';
    return 'gray';
  }

  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function addDays(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
  }

  function daysBetween(a, b) {
    const ms = startOfDay(b).getTime() - startOfDay(a).getTime();
    return Math.round(ms / 86400000);
  }

  function mondayOffset(date) {
    return (date.getDay() + 6) % 7;
  }

  function toDateInput(date) {
    const d = new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function uid() {
    return (globalThis.crypto?.randomUUID?.() || `id_${Math.random().toString(36).slice(2)}_${Date.now()}`).replace(/-/g, '').slice(0, 18);
  }

  function sanitizeFileName(name) {
    return String(name || 'workmap').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/'/g, '&#039;');
  }
})();
