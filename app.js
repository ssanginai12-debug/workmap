(() => {
  const STORAGE_KEY = 'workmap_mvp_state_v1';
  const LOCAL_TABLES_KEY = 'workmap_local_tables_v1';
  const LOCAL_CURRENT_TABLE_KEY = 'workmap_local_current_table_v1';
  const CLOUD_VIEW_KEY = 'workmap_cloud_view_v1';
  const CLOUD_BOARD_KEY = 'workmap_cloud_board_v1';
  const CLOUD_BOARD_SETTINGS_FALLBACK_KEY = 'workmap_cloud_board_settings_v2';
  const REMEMBER_EMAIL_KEY = 'workmap_remember_email_v1';
  const ADD_CATEGORY_VALUE = '__workmap_add_category__';
  const ADD_STATUS_VALUE = '__workmap_add_status__';
  const DELETE_CATEGORY_VALUE = '__workmap_delete_category__';
  const DELETE_STATUS_VALUE = '__workmap_delete_status__';
  const SURFACE_ZOOM_DEFAULTS = { kanban: 1, timeline: 1, calendar: 1 };
  const CLOUD_INVITE_TIMEOUT_MS = 4000;
  const CLOUD_QUERY_TIMEOUT_MS = 9000;
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
  const FIXED_KOREAN_HOLIDAYS = {
    '01-01': '신정',
    '03-01': '삼일절',
    '05-05': '어린이날',
    '06-06': '현충일',
    '08-15': '광복절',
    '10-03': '개천절',
    '10-09': '한글날',
    '12-25': '성탄절'
  };
  const KOREAN_HOLIDAYS_BY_YEAR = {
    2026: {
      '2026-01-01': '신정',
      '2026-02-16': '설날',
      '2026-02-17': '설날',
      '2026-02-18': '설날',
      '2026-03-01': '삼일절',
      '2026-03-02': '대체공휴일',
      '2026-05-01': '근로자의 날',
      '2026-05-05': '어린이날',
      '2026-05-24': '부처님오신날',
      '2026-05-25': '대체공휴일',
      '2026-06-03': '지방선거',
      '2026-06-06': '현충일',
      '2026-07-17': '제헌절',
      '2026-08-15': '광복절',
      '2026-09-24': '추석',
      '2026-09-25': '추석',
      '2026-09-26': '추석',
      '2026-10-03': '개천절',
      '2026-10-05': '대체공휴일',
      '2026-10-09': '한글날',
      '2026-12-25': '성탄절'
    }
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  let currentLocalTableId = localStorage.getItem(LOCAL_CURRENT_TABLE_KEY) || '';
  let state = getInitialState();
  let selectedTaskId = null;
  let saveTimer = null;
  let currentUser = null;
  let currentBoardId = null;
  let availableCloudBoards = [];
  let realtimeChannel = null;
  let applyingRemoteChange = false;
  const pendingCloudTaskTimers = new Map();
  let boardTitleSaveTimer = null;
  let boardSettingsSaveTimer = null;
  let boardSettingsColumnMissing = false;
  let mindDragSuppressClick = false;
  let kanbanDragSuppressClick = false;
  let activeTouchCount = 0;
  let pinchGestureBlockUntil = 0;
  let hadMultiTouchGesture = false;

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
    authMessage: $('#authMessage'),
    rememberEmail: $('#rememberEmail'),
    tableSelect: $('#tableSelect'),
    newTableModal: $('#newTableModal'),
    newTableLabel: $('#newTableLabel'),
    projectListModal: $('#projectListModal'),
    projectListBody: $('#projectListBody')
  };

  init();

  async function init() {
    hydrateRememberedEmail();
    bindGlobalEvents();
    bindAuthEvents();
    renderCloudStatus();
    if (CLOUD_ENABLED) {
      await initCloudMode();
    } else {
      renderPreservingViewport();
    }
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }


  function bindAuthEvents() {
    if (!CLOUD_ENABLED) return;
    els.rememberEmail?.addEventListener('change', () => {
      if (els.rememberEmail.checked) persistRememberedEmail(els.authEmail.value.trim());
      else localStorage.removeItem(REMEMBER_EMAIL_KEY);
    });
    els.authEmail?.addEventListener('input', () => {
      if (els.rememberEmail?.checked) persistRememberedEmail(els.authEmail.value.trim());
    });
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
      renderBootLoadingState();
      try {
        const { error: inviteClaimError } = await withTimeout(
          supabaseClient.rpc('claim_board_invites'),
          '초대 권한 확인',
          CLOUD_INVITE_TIMEOUT_MS
        );
        if (inviteClaimError) console.warn('초대 권한 적용 건너뜀:', inviteClaimError.message || inviteClaimError);
      } catch (inviteClaimError) {
        console.warn('초대 권한 적용 건너뜀:', inviteClaimError.message || inviteClaimError);
      }
      await loadOrCreateCloudBoard();
      await subscribeToBoardRealtime();
      renderCloudStatus('Cloud 동기화');
      els.saveStatus.textContent = '동기화됨';
      renderPreservingViewport();
    } catch (err) {
      console.error(err);
      setAuthMessage(`보드 로딩 오류: ${err.message || err}`, true);
      showAuthScreen(false);
      renderCloudLoadError(err);
    }
  }

  function withTimeout(promise, label, ms) {
    let timer = null;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} 응답이 지연되고 있습니다.`)), ms);
    });
    return Promise.race([
      Promise.resolve(promise).finally(() => clearTimeout(timer)),
      timeout
    ]);
  }

  function renderBootLoadingState() {
    if (!els.viewHeader || !els.viewRoot) return;
    els.boardTitle.value = state.boardName || '';
    renderTableSelect();
    setHeader(
      '프로젝트를 불러오는 중입니다',
      '새로고침 후 저장된 프로젝트와 업무 데이터를 확인하고 있습니다.',
      ''
    );
    els.viewRoot.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">＋</div>
        <h3>잠시만 기다려주세요.</h3>
        <p>프로젝트 목록, 업무, 권한 정보를 불러오는 중입니다.</p>
      </div>
    `;
  }

  function renderCloudLoadError(err) {
    renderCloudStatus('연결 확인 필요');
    els.saveStatus.textContent = '프로젝트 로딩 실패';
    setHeader(
      '프로젝트를 불러오지 못했습니다',
      err?.message || String(err || '네트워크 또는 권한 설정을 확인해야 합니다.'),
      '<button class="primary-btn" data-action="reload-cloud-board">다시 불러오기</button>'
    );
    els.viewRoot.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">!</div>
        <h3>연결을 다시 시도해 주세요.</h3>
        <p>새로 만든 프로젝트가 바로 보이지 않으면 Supabase 권한 패치가 적용되었는지도 확인해야 합니다.</p>
        <button class="primary-btn" data-action="reload-cloud-board">다시 불러오기</button>
      </div>
    `;
  }

  async function signInWithPassword(signup) {
    const email = els.authEmail.value.trim();
    const password = els.authPassword.value;
    if (!email || !password) return setAuthMessage('이메일과 비밀번호를 입력하세요.', true);
    persistRememberedEmail(email);
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
    persistRememberedEmail(email);
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

  function hydrateRememberedEmail() {
    const remembered = localStorage.getItem(REMEMBER_EMAIL_KEY) || '';
    if (els.authEmail && remembered) els.authEmail.value = remembered;
    if (els.rememberEmail) els.rememberEmail.checked = Boolean(remembered);
  }

  function persistRememberedEmail(email) {
    if (!els.rememberEmail?.checked) {
      localStorage.removeItem(REMEMBER_EMAIL_KEY);
      return;
    }
    if (email) localStorage.setItem(REMEMBER_EMAIL_KEY, email);
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

  async function createCloudBoard(title) {
    const payload = { title: normalizeProjectName(title) };
    if (currentUser?.id) payload.owner_id = currentUser.id;

    let result = await supabaseClient
      .from('boards')
      .insert(payload)
      .select('id,title,updated_at')
      .single();

    const message = String(result.error?.message || '').toLowerCase();
    if (result.error && payload.owner_id && (message.includes('owner_id') || message.includes('schema cache') || message.includes('column'))) {
      result = await supabaseClient
        .from('boards')
        .insert({ title: payload.title })
        .select('id,title,updated_at')
        .single();
    }

    if (result.error) throw result.error;
    return result.data;
  }

  async function loadOrCreateCloudBoard() {
    const urlBoardId = new URLSearchParams(location.search).get('board');
    let preferredBoardId = urlBoardId || localStorage.getItem(CLOUD_BOARD_KEY) || '';
    let board = null;
    if (preferredBoardId) {
      const { data } = await withTimeout(
        supabaseClient.from('boards').select('id,title,updated_at').eq('id', preferredBoardId).maybeSingle(),
        '현재 프로젝트 조회',
        CLOUD_QUERY_TIMEOUT_MS
      );
      board = data || null;
    }

    const { data: boards, error: boardsError } = await withTimeout(
      supabaseClient
        .from('boards')
        .select('id,title,updated_at')
        .order('updated_at', { ascending: false }),
      '프로젝트 목록 조회',
      CLOUD_QUERY_TIMEOUT_MS
    );
    if (boardsError) throw boardsError;
    availableCloudBoards = boards || [];
    if (!board) {
      board = boards?.[0] || null;
    }
    if (!board) {
      const created = await createCloudBoard(demoState().boardName);
      board = created;
      availableCloudBoards = [created];
      try {
        await seedDemoTasks(board.id);
      } catch (seedError) {
        console.warn('샘플 업무 생성 건너뜀:', seedError.message || seedError);
      }
    }
    if (board && !availableCloudBoards.some((item) => item.id === board.id)) {
      availableCloudBoards.unshift(board);
    }
    currentBoardId = board.id;
    localStorage.setItem(CLOUD_BOARD_KEY, currentBoardId);
    await loadCloudBoard(currentBoardId);
  }

  async function loadCloudBoard(boardId) {
    const [{ data: board, error: boardError }, { data: tasks, error: tasksError }] = await withTimeout(
      Promise.all([
        supabaseClient.from('boards').select('*').eq('id', boardId).single(),
        supabaseClient.from('tasks').select('*').eq('board_id', boardId).order('sort_order', { ascending: true }).order('created_at', { ascending: true })
      ]),
      '프로젝트 데이터 조회',
      CLOUD_QUERY_TIMEOUT_MS
    );
    if (boardError) throw boardError;
    if (tasksError) throw tasksError;
    let members = [];
    try {
      const { data, error } = await withTimeout(
        supabaseClient.from('board_members').select('*').eq('board_id', boardId).order('created_at', { ascending: true }),
        '멤버 목록 조회',
        5000
      );
      if (error) throw error;
      members = data || [];
    } catch (memberError) {
      console.warn('멤버 목록 조회 건너뜀:', memberError.message || memberError);
    }
    const projectTitle = normalizeProjectName(board.title);
    state = normalizeState({
      boardName: projectTitle,
      view: localStorage.getItem(CLOUD_VIEW_KEY) || state.view || 'table',
      calendarDate: state.calendarDate || '2026-05-01',
      members: (members || []).map(memberFromRow),
      tasks: (tasks || []).map(taskFromRow),
      settings: mergeBoardSettings(loadLocalBoardSettings(boardId), board.settings)
    });
    const boardOption = availableCloudBoards.find((item) => item.id === boardId);
    if (boardOption) boardOption.title = projectTitle;
    if (board.title !== projectTitle) {
      withTimeout(
        supabaseClient.from('boards').update({ title: projectTitle }).eq('id', boardId),
        '프로젝트명 정리',
        5000
      ).catch((titleError) => console.warn('프로젝트명 정리 건너뜀:', titleError.message || titleError));
    }
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
      renderPreservingViewport();
      return;
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
      state.mindZoom = normalizeMindZoom(settings.mindZoom || state.mindZoom);
      state.viewZooms = normalizeViewZooms(settings.viewZooms || state.viewZooms);
      shouldRender = true;
    }
    if (shouldRender) renderPreservingViewport();
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
      mindPositions: normalizeMindPositions(state.mindPositions || {}),
      mindZoom: normalizeMindZoom(state.mindZoom),
      viewZooms: normalizeViewZooms(state.viewZooms || {})
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
        mindPositions: item.mindPositions || merged.mindPositions,
        mindZoom: item.mindZoom || merged.mindZoom,
        viewZooms: item.viewZooms || merged.viewZooms
      };
    }, { statuses: DEFAULT_STATUSES, mindPositions: {}, mindZoom: 1, viewZooms: { ...SURFACE_ZOOM_DEFAULTS } });
  }

  function getInitialState() {
    const shared = loadSharedStateFromHash();
    if (shared) return normalizeState(shared);
    const localTables = getLocalTables();
    const selectedTable = currentLocalTableId && localTables[currentLocalTableId];
    if (selectedTable) return normalizeState(selectedTable);
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = normalizeState(JSON.parse(saved));
        if (!currentLocalTableId) {
          currentLocalTableId = uid();
          localStorage.setItem(LOCAL_CURRENT_TABLE_KEY, currentLocalTableId);
          saveLocalTableState(parsed);
        }
        return parsed;
      } catch (_) {}
    }
    const initial = demoState();
    if (!currentLocalTableId) {
      currentLocalTableId = uid();
      localStorage.setItem(LOCAL_CURRENT_TABLE_KEY, currentLocalTableId);
    }
    saveLocalTableState(initial);
    return initial;
  }

  function getLocalTables() {
    try {
      const parsed = JSON.parse(localStorage.getItem(LOCAL_TABLES_KEY) || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function saveLocalTableState(nextState = state) {
    if (!currentLocalTableId) return;
    const tables = getLocalTables();
    tables[currentLocalTableId] = normalizeState(nextState);
    localStorage.setItem(LOCAL_TABLES_KEY, JSON.stringify(tables));
    localStorage.setItem(LOCAL_CURRENT_TABLE_KEY, currentLocalTableId);
  }

  function blankState(label) {
    return normalizeState({
      boardName: normalizeProjectName(label),
      view: 'table',
      calendarDate: localDateKey(new Date()).slice(0, 8) + '01',
      statuses: DEFAULT_STATUSES.slice(),
      mindPositions: {},
      mindZoom: 1,
      viewZooms: { ...SURFACE_ZOOM_DEFAULTS },
      members: [],
      tasks: []
    });
  }

  function demoState() {
    return {
      boardName: 'LED전광판 사업 진행 현황',
      view: 'table',
      calendarDate: '2026-05-01',
      statuses: DEFAULT_STATUSES.slice(),
      mindPositions: {},
      mindZoom: 1,
      viewZooms: { ...SURFACE_ZOOM_DEFAULTS },
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
      boardName: normalizeProjectName(raw.boardName || base.boardName),
      view: raw.view || 'table',
      calendarDate: raw.calendarDate || '2026-05-01',
      statuses: Array.isArray(settings.statuses) ? settings.statuses : base.statuses.slice(),
      mindPositions: normalizeMindPositions(settings.mindPositions || raw.mindPositions || {}),
      mindZoom: normalizeMindZoom(settings.mindZoom || raw.mindZoom || base.mindZoom),
      viewZooms: normalizeViewZooms(settings.viewZooms || raw.viewZooms || base.viewZooms),
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

  function normalizeMindZoom(value) {
    const zoom = Number(value);
    if (!Number.isFinite(zoom)) return 1;
    return Math.min(1.8, Math.max(0.6, Math.round(zoom * 100) / 100));
  }

  function normalizeSurfaceZoom(value) {
    const zoom = Number(value);
    if (!Number.isFinite(zoom)) return 1;
    return Math.min(1.8, Math.max(0.55, Math.round(zoom * 100) / 100));
  }

  function normalizeViewZooms(value) {
    return Object.keys(SURFACE_ZOOM_DEFAULTS).reduce((zoomMap, key) => {
      zoomMap[key] = normalizeSurfaceZoom(value?.[key] || SURFACE_ZOOM_DEFAULTS[key]);
      return zoomMap;
    }, {});
  }

  function getStatuses() {
    state.statuses = normalizeStatusList(state.statuses, state.tasks);
    return state.statuses;
  }

  function getSurfaceZoom(view) {
    state.viewZooms = normalizeViewZooms(state.viewZooms || {});
    return normalizeSurfaceZoom(state.viewZooms[view]);
  }

  function isMobileSurfaceZoomEnabled() {
    return window.matchMedia?.('(max-width: 720px)').matches || false;
  }

  function getRenderedSurfaceZoom(view) {
    return 1;
  }

  function getLiveSurfaceZoom(view) {
    const surface = $(`[data-pinch-zoom-view="${view}"]`, els.viewRoot);
    const zoom = Number(surface?.style.zoom || (surface ? getComputedStyle(surface).zoom : 1));
    return normalizeSurfaceZoom(zoom || 1);
  }

  function markPinchGesture() {
    if (!isMobileSurfaceZoomEnabled()) return;
    pinchGestureBlockUntil = Date.now() + 260;
  }

  function isPinchGestureActive() {
    return isMobileSurfaceZoomEnabled() && (activeTouchCount > 1 || Date.now() < pinchGestureBlockUntil);
  }

  document.addEventListener('touchstart', (event) => {
    activeTouchCount = event.touches?.length || 0;
    if (activeTouchCount > 1) {
      hadMultiTouchGesture = true;
      markPinchGesture();
    }
  }, { capture: true, passive: true });

  document.addEventListener('touchmove', (event) => {
    activeTouchCount = event.touches?.length || 0;
    if (activeTouchCount > 1) {
      hadMultiTouchGesture = true;
      markPinchGesture();
    }
  }, { capture: true, passive: true });

  const settleTouchGesture = (event) => {
    activeTouchCount = event.touches?.length || 0;
    if (activeTouchCount <= 1 && hadMultiTouchGesture) markPinchGesture();
    if (activeTouchCount === 0) hadMultiTouchGesture = false;
  };
  document.addEventListener('touchend', settleTouchGesture, { capture: true, passive: true });
  document.addEventListener('touchcancel', settleTouchGesture, { capture: true, passive: true });

  function bindGlobalEvents() {
    els.boardTitle.addEventListener('input', (e) => {
      state.boardName = normalizeProjectName(e.target.value);
      if (CLOUD_ENABLED && currentBoardId) {
        const board = availableCloudBoards.find((item) => item.id === currentBoardId);
        if (board) board.title = state.boardName;
      } else {
        saveLocalTableState(state);
      }
      scheduleSave();
      queueBoardTitleSave();
      renderTableSelect();
      renderSummary();
      if (state.view === 'mindmap') renderCurrentView();
    });

    $$('.tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        const viewChanged = state.view !== tab.dataset.view;
        state.view = tab.dataset.view;
        if (CLOUD_ENABLED) localStorage.setItem(CLOUD_VIEW_KEY, state.view);
        scheduleSave();
        render();
        if (viewChanged && els.viewRoot) {
          els.viewRoot.scrollLeft = 0;
          els.viewRoot.scrollTop = 0;
        }
      });
    });

    $('#closeDrawer').addEventListener('click', closeDrawer);
    $('#shareBtn').addEventListener('click', openShareModal);
    $('#closeShareModal').addEventListener('click', closeShareModal);
    els.modalBackdrop.addEventListener('click', closeAllModals);
    $('#addMemberBtn').addEventListener('click', addMemberFromModal);
    $('#makeShareLinkBtn').addEventListener('click', makeShareLink);
    $('#copyShareLinkBtn').addEventListener('click', copyShareLink);
    $('#exportBtn').addEventListener('click', exportJson);
    $('#importFile').addEventListener('change', importJson);
    $('#projectListBtn')?.addEventListener('click', openProjectListModal);
    $('#closeProjectListModal')?.addEventListener('click', closeProjectListModal);
    $('#projectListNewBtn')?.addEventListener('click', () => {
      closeProjectListModal();
      openNewTableModal();
    });
    $('#newTableBtn')?.addEventListener('click', openNewTableModal);
    $('#deleteProjectBtn')?.addEventListener('click', deleteCurrentProject);
    $('#closeNewTableModal')?.addEventListener('click', closeNewTableModal);
    $('#cancelNewTableBtn')?.addEventListener('click', closeNewTableModal);
    $('#newTableForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      createNewTable(els.newTableLabel?.value);
    });
    els.tableSelect?.addEventListener('change', switchTable);
    $('#resetDemoBtn')?.addEventListener('click', async () => {
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
      if (mindDragSuppressClick || kanbanDragSuppressClick) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      const addStatusButton = e.target.closest('[data-action="add-status"]');
      if (addStatusButton) {
        addKanbanColumn();
        return;
      }
      const reloadCloudBoardButton = e.target.closest('[data-action="reload-cloud-board"]');
      if (reloadCloudBoardButton) {
        bootSignedInUser();
        return;
      }
      const openProjectButton = e.target.closest('[data-project-open]');
      if (openProjectButton) {
        switchProjectById(openProjectButton.dataset.projectOpen);
        return;
      }
      const resetMindButton = e.target.closest('[data-action="reset-mindmap-layout"]');
      if (resetMindButton) {
        resetMindmapLayout();
        return;
      }
      const mindZoomButton = e.target.closest('[data-mind-zoom]');
      if (mindZoomButton) {
        setMindZoom(mindZoomButton.dataset.mindZoom);
        return;
      }
      const deleteStatusButton = e.target.closest('[data-delete-status]');
      if (deleteStatusButton) {
        deleteKanbanColumn(deleteStatusButton.dataset.deleteStatus);
        return;
      }
      const deleteCategoryButton = e.target.closest('[data-delete-category]');
      if (deleteCategoryButton) {
        deleteCategory(deleteCategoryButton.dataset.deleteCategory);
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

  async function createNewTable(label) {
    const tableLabel = normalizeProjectName(label);
    if (!tableLabel) return;
    closeDrawer();
    closeNewTableModal();
    if (CLOUD_ENABLED && currentUser) {
      try {
        els.saveStatus.textContent = '새 프로젝트 생성 중…';
        const board = await createCloudBoard(tableLabel);
        currentBoardId = board.id;
        availableCloudBoards = [board, ...availableCloudBoards.filter((item) => item.id !== board.id)];
        localStorage.setItem(CLOUD_BOARD_KEY, currentBoardId);
        state = blankState(tableLabel);
        saveLocalBoardSettings(currentBoardId, getBoardSettings());
        queueBoardSettingsSave(true);
        await loadCloudBoard(currentBoardId);
        await subscribeToBoardRealtime();
        els.saveStatus.textContent = '새 프로젝트 생성됨';
        render();
        return;
      } catch (err) {
        console.error(err);
        alert('새 프로젝트 생성에 실패했습니다. Supabase 권한 또는 settings 컬럼을 확인하세요.');
        els.saveStatus.textContent = '새 프로젝트 생성 실패';
        return;
      }
    }
    scheduleSave(true);
    currentLocalTableId = uid();
    state = blankState(tableLabel);
    saveLocalTableState(state);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    selectedTaskId = null;
    els.saveStatus.textContent = '새 프로젝트 생성됨';
    render();
  }

  async function switchTable(e) {
    const tableId = e.target.value;
    if (!tableId) return;
    await switchProjectById(tableId);
  }

  async function switchProjectById(tableId) {
    if (!tableId) return;
    closeDrawer();
    closeProjectListModal();
    if (CLOUD_ENABLED && currentUser) {
      try {
        els.saveStatus.textContent = '프로젝트 전환 중…';
        currentBoardId = tableId;
        localStorage.setItem(CLOUD_BOARD_KEY, currentBoardId);
        await loadCloudBoard(currentBoardId);
        await subscribeToBoardRealtime();
        els.saveStatus.textContent = '프로젝트 전환됨';
        render();
      } catch (err) {
        console.error(err);
        alert('프로젝트를 불러오지 못했습니다.');
        els.saveStatus.textContent = '프로젝트 전환 실패';
      }
      return;
    }
    scheduleSave(true);
    const tables = getLocalTables();
    if (!tables[tableId]) return;
    currentLocalTableId = tableId;
    localStorage.setItem(LOCAL_CURRENT_TABLE_KEY, currentLocalTableId);
    state = normalizeState(tables[tableId]);
    selectedTaskId = null;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    els.saveStatus.textContent = '프로젝트 전환됨';
    render();
  }

  async function deleteCurrentProject() {
    const projectName = normalizeProjectName(state.boardName);
    if (!confirm(`현재 프로젝트 "${projectName}"를 삭제할까요?\n\n이 프로젝트의 업무, 마인드맵 위치, 칸반 설정이 함께 삭제됩니다.`)) return;
    closeDrawer();

    if (CLOUD_ENABLED && currentUser && currentBoardId) {
      try {
        els.saveStatus.textContent = '프로젝트 삭제 중…';
        const deletingId = currentBoardId;
        const { error } = await supabaseClient.from('boards').delete().eq('id', deletingId);
        if (error) throw error;
        availableCloudBoards = availableCloudBoards.filter((board) => board.id !== deletingId);

        if (!availableCloudBoards.length) {
          const created = await createCloudBoard('새 프로젝트');
          availableCloudBoards = [created];
        }

        currentBoardId = availableCloudBoards[0].id;
        localStorage.setItem(CLOUD_BOARD_KEY, currentBoardId);
        selectedTaskId = null;
        await loadCloudBoard(currentBoardId);
        await subscribeToBoardRealtime();
        els.saveStatus.textContent = '프로젝트 삭제됨';
        render();
      } catch (err) {
        console.error(err);
        alert('프로젝트 삭제에 실패했습니다. 관리자 권한을 확인하세요.');
        els.saveStatus.textContent = '프로젝트 삭제 실패';
      }
      return;
    }

    const tables = getLocalTables();
    delete tables[currentLocalTableId];
    let ids = Object.keys(tables);
    if (!ids.length) {
      const fallbackId = uid();
      tables[fallbackId] = blankState('새 프로젝트');
      ids = [fallbackId];
    }
    currentLocalTableId = ids[0];
    localStorage.setItem(LOCAL_TABLES_KEY, JSON.stringify(tables));
    localStorage.setItem(LOCAL_CURRENT_TABLE_KEY, currentLocalTableId);
    state = normalizeState(tables[currentLocalTableId]);
    selectedTaskId = null;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    els.saveStatus.textContent = '프로젝트 삭제됨';
    render();
  }

  function render() {
    els.boardTitle.value = state.boardName;
    renderTableSelect();
    $$('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.view === state.view));
    renderSummary();
    renderCategoryList();
    renderCurrentView();
    renderDrawer();
    if (els.projectListModal && !els.projectListModal.hidden) renderProjectListModal();
  }

  function renderPreservingViewport() {
    const snapshot = captureCurrentViewport();
    render();
    restoreCurrentViewport(snapshot);
  }

  function captureCurrentViewport() {
    if (state.view === 'kanban') {
      return { view: 'kanban', snapshot: captureKanbanViewport() };
    }
    if (state.view === 'mindmap') {
      const shell = $('[data-mindmap-shell]', els.viewRoot);
      return {
        view: 'mindmap',
        left: shell?.scrollLeft || 0,
        top: shell?.scrollTop || 0
      };
    }
    return {
      view: state.view,
      left: els.viewRoot?.scrollLeft || 0,
      top: els.viewRoot?.scrollTop || 0
    };
  }

  function restoreCurrentViewport(snapshot) {
    if (!snapshot || snapshot.view !== state.view) return;
    if (snapshot.view === 'kanban') {
      restoreKanbanViewport(snapshot.snapshot);
      return;
    }
    const apply = () => {
      if (snapshot.view === 'mindmap') {
        const shell = $('[data-mindmap-shell]', els.viewRoot);
        if (!shell) return;
        shell.scrollLeft = snapshot.left;
        shell.scrollTop = snapshot.top;
        return;
      }
      if (!els.viewRoot) return;
      els.viewRoot.scrollLeft = snapshot.left;
      els.viewRoot.scrollTop = snapshot.top;
    };
    requestAnimationFrame(() => {
      apply();
      requestAnimationFrame(apply);
      setTimeout(apply, 120);
      setTimeout(apply, 420);
    });
  }

  function renderTableSelect() {
    if (!els.tableSelect) return;
    const options = CLOUD_ENABLED && currentUser
      ? availableCloudBoards.map((board) => ({ id: board.id, label: normalizeProjectName(board.title) }))
      : Object.entries(getLocalTables()).map(([id, table]) => ({ id, label: normalizeProjectName(table.boardName) }));
    const currentId = CLOUD_ENABLED && currentUser ? currentBoardId : currentLocalTableId;
    const deleteButton = $('#deleteProjectBtn');
    if (deleteButton) {
      deleteButton.hidden = !options.length;
      deleteButton.disabled = !currentId;
    }
    if (!options.length) {
      els.tableSelect.hidden = true;
      return;
    }
    els.tableSelect.hidden = false;
    els.tableSelect.innerHTML = options
      .map((item) => `<option value="${escapeAttr(item.id)}" ${item.id === currentId ? 'selected' : ''}>${escapeHtml(item.label)}</option>`)
      .join('');
  }

  function getProjectOptions() {
    return CLOUD_ENABLED && currentUser
      ? availableCloudBoards.map((board) => ({ id: board.id, label: normalizeProjectName(board.title) }))
      : Object.entries(getLocalTables()).map(([id, table]) => ({ id, label: normalizeProjectName(table.boardName) }));
  }

  function renderProjectListModal() {
    if (!els.projectListBody) return;
    const currentId = CLOUD_ENABLED && currentUser ? currentBoardId : currentLocalTableId;
    const options = getProjectOptions();
    els.projectListBody.innerHTML = options.length ? options.map((project) => `
      <button class="project-list-item ${project.id === currentId ? 'active' : ''}" data-project-open="${escapeAttr(project.id)}">
        <span>${escapeHtml(project.label)}</span>
        <small>${project.id === currentId ? '현재 프로젝트' : '열기'}</small>
      </button>
    `).join('') : '<p class="muted">아직 프로젝트가 없습니다.</p>';
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

  function metricsStripHtml(tasks = state.tasks) {
    const total = tasks.length;
    const done = tasks.filter((t) => t.status === '완료').length;
    const dated = tasks.filter((t) => t.startDate || t.endDate).length;
    const overdue = tasks.filter(isTaskOverdue).length;
    const invalid = tasks.filter(hasInvalidDateRange).length;
    return `
      <div class="view-metrics" aria-label="업무 현황 요약">
        <div><b>${total}</b><span>표시 업무</span></div>
        <div><b>${done}</b><span>완료</span></div>
        <div><b>${dated}</b><span>일정 있음</span></div>
        <div class="${overdue ? 'danger-metric' : ''}"><b>${overdue}</b><span>마감 지남</span></div>
        <div class="${invalid ? 'danger-metric' : ''}"><b>${invalid}</b><span>날짜 확인</span></div>
      </div>
    `;
  }

  function statusAccent(status) {
    const key = STATUS_COLOR[status] || 'gray';
    const colors = {
      blue: '#2f5cff',
      green: '#2fa66a',
      purple: '#7a5cff',
      orange: '#f28b36',
      red: '#ef5962',
      gray: '#8b95a5'
    };
    return colors[key] || colors.gray;
  }

  function hasInvalidDateRange(t) {
    return Boolean(t.startDate && t.endDate && t.startDate > t.endDate);
  }

  function isTaskOverdue(t) {
    return Boolean(t.endDate && t.endDate < localDateKey(new Date()) && t.status !== '완료');
  }

  function taskHealthClass(t) {
    return [
      t.status === '완료' ? 'is-complete' : '',
      isTaskOverdue(t) ? 'is-overdue' : '',
      hasInvalidDateRange(t) ? 'has-date-error' : ''
    ].filter(Boolean).join(' ');
  }

  function taskIntersectsMonth(task, monthDate) {
    if (!task.startDate && !task.endDate) return false;
    const monthStart = localDateKey(new Date(monthDate.getFullYear(), monthDate.getMonth(), 1));
    const monthEnd = localDateKey(new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0));
    const start = task.startDate || task.endDate;
    const end = task.endDate || task.startDate;
    return end >= monthStart && start <= monthEnd;
  }

  function renderCategoryList() {
    const counts = new Map();
    state.tasks.forEach((t) => counts.set(t.category, (counts.get(t.category) || 0) + 1));
    const categories = Array.from(new Set([...CATEGORIES, ...state.tasks.map((t) => t.category).filter(Boolean)]));
    els.categoryList.innerHTML = categories.map((cat) => `
      <div class="category-pill">
        <span>${escapeHtml(cat)}</span>
        <div class="category-pill-actions">
          <small>${counts.get(cat) || 0}</small>
          ${canDeleteCategory(cat) ? `<button class="category-delete-btn" title="분류 삭제" aria-label="${escapeAttr(cat)} 분류 삭제" data-delete-category="${escapeAttr(cat)}">×</button>` : ''}
        </div>
      </div>
    `).join('');
  }

  function canDeleteCategory(category) {
    return Boolean(category && category !== '기타' && !CATEGORIES.includes(category));
  }

  async function promptDeleteCategoryFromSelect(id) {
    const deletable = categoriesWithCurrent(getTask(id)?.category).filter(canDeleteCategory);
    if (!deletable.length) {
      alert('삭제할 수 있는 분류가 없습니다.');
      render();
      return;
    }
    const task = getTask(id);
    const defaultValue = task && canDeleteCategory(task.category) ? task.category : deletable[0];
    const name = prompt(`삭제할 분류명을 입력하세요.\n삭제 가능 분류: ${deletable.join(', ')}`, defaultValue);
    const category = String(name || '').trim();
    if (!category) {
      render();
      return;
    }
    if (!deletable.includes(category)) {
      alert('목록에 있는 분류명만 삭제할 수 있습니다.');
      render();
      return;
    }
    await deleteCategory(category);
  }

  async function deleteCategory(category) {
    if (!canDeleteCategory(category)) {
      alert('기본 분류는 삭제할 수 없습니다.');
      return;
    }
    const affected = state.tasks.filter((task) => task.category === category);
    const message = affected.length
      ? `'${category}' 분류를 삭제하고, 이 분류의 업무 ${affected.length}개를 '기타'로 이동할까요?`
      : `'${category}' 분류를 삭제할까요?`;
    if (!confirm(message)) return;

    if (CLOUD_ENABLED && currentBoardId && affected.length) {
      const { error } = await supabaseClient
        .from('tasks')
        .update({ category: '기타' })
        .eq('board_id', currentBoardId)
        .eq('category', category);
      if (error) {
        console.error(error);
        alert('분류 삭제에 실패했습니다.');
        return;
      }
    }

    affected.forEach((task) => {
      task.category = '기타';
      task.updatedAt = new Date().toISOString();
    });
    scheduleSave(true);
    render();
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
      '업무 테이블',
      '프로젝트 업무를 수정하면 마인드맵, 칸반, 타임라인, 캘린더가 즉시 다시 그려집니다.',
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
      ${metricsStripHtml()}
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
              <tr class="${taskHealthClass(t)}">
                <td class="task-title-cell"><input class="data-input" data-field="title" data-id="${escapeAttr(t.id)}" value="${escapeAttr(t.title)}"></td>
                <td>${selectHtml('category', t.id, categoriesWithCurrent(t.category), t.category)}</td>
                <td><select class="data-select" data-field="parentId" data-id="${escapeAttr(t.id)}">${markSelected(parentOptions(t.id), t.parentId)}</select></td>
                <td>${selectHtml('status', t.id, statusesWithCurrent(t.status), t.status)}</td>
                <td><input class="data-input" type="date" data-field="startDate" data-id="${escapeAttr(t.id)}" value="${escapeAttr(t.startDate)}"></td>
                <td><input class="data-input" type="date" data-field="endDate" data-id="${escapeAttr(t.id)}" value="${escapeAttr(t.endDate)}"></td>
                <td><input class="data-input" data-field="assignee" data-id="${escapeAttr(t.id)}" value="${escapeAttr(t.assignee)}"></td>
                <td>${selectHtml('priority', t.id, PRIORITIES, t.priority)}</td>
                <td><textarea class="data-input" data-field="memo" data-id="${escapeAttr(t.id)}">${escapeHtml(t.memo)}</textarea></td>
                <td class="action-cell"><button class="mini-btn danger-btn" data-delete-task="${escapeAttr(t.id)}">삭제</button></td>
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
        handleEditableFieldChange(e.target.dataset.id, e.target.dataset.field, e.target.value, false);
      });
    });
  }

  function categoriesWithCurrent(current) {
    return Array.from(new Set([...CATEGORIES, ...state.tasks.map((t) => t.category), current].filter(Boolean)));
  }

  function statusesWithCurrent(current) {
    return Array.from(new Set([...getStatuses(), current].filter(Boolean)));
  }

  function selectHtml(field, id, options, current) {
    const extra = field === 'category'
      ? `<option value="${ADD_CATEGORY_VALUE}">+ 새 분류 추가...</option><option value="${DELETE_CATEGORY_VALUE}">- 분류 삭제...</option>`
      : field === 'status'
        ? `<option value="${ADD_STATUS_VALUE}">+ 새 상태 추가...</option><option value="${DELETE_STATUS_VALUE}">- 상태 삭제...</option>`
        : '';
    return `<select class="data-select" data-field="${escapeAttr(field)}" data-id="${escapeAttr(id)}">${options.map((opt) => `<option value="${escapeAttr(opt)}" ${opt === current ? 'selected' : ''}>${escapeHtml(opt)}</option>`).join('')}${extra}</select>`;
  }

  function markSelected(optionsHtml, selectedValue) {
    if (!selectedValue) return optionsHtml;
    return optionsHtml.replace(`value="${escapeAttr(selectedValue)}"`, `value="${escapeAttr(selectedValue)}" selected`);
  }

  function renderKanbanView() {
    const zoom = getRenderedSurfaceZoom('kanban');
    setHeader(
      '칸반 보기',
      '컬럼을 직접 추가/삭제할 수 있고, 카드를 다른 컬럼으로 드래그하면 상태값이 전체 보기에 반영됩니다.',
      '<button class="ghost-btn" data-action="add-status">+ 컬럼 추가</button><button class="primary-btn" data-action="add-task">업무 추가</button>'
    );
    const statuses = getStatuses();
    els.viewRoot.innerHTML = `
      ${metricsStripHtml()}
      <div class="kanban-board zoomable-surface ${zoom !== 1 ? 'is-zoomed' : ''}" data-pinch-zoom-view="kanban" style="zoom:${zoom}">
        ${statuses.map((status) => {
          const tasks = state.tasks.filter((t) => t.status === status);
          const canDelete = statuses.length > 1 && canDeleteStatus(status);
          return `
            <section class="kanban-column" data-drop-status="${escapeAttr(status)}" style="--status-accent:${statusAccent(status)}">
              <div class="kanban-column-header">
                <div class="kanban-column-title">
                  <span>${escapeHtml(status)}</span>
                  <span class="badge gray">${tasks.length}</span>
                </div>
                ${canDelete ? `<button class="kanban-delete-column" title="컬럼 삭제" data-delete-status="${escapeAttr(status)}">×</button>` : ''}
              </div>
              <div class="kanban-cards">
                ${tasks.length ? tasks.map(kanbanCard).join('') : '<div class="kanban-empty">카드를 끌어오거나 새로 추가하세요.</div>'}
              </div>
              <button class="mini-btn add-card-in-column" data-action="add-task" data-status="${escapeAttr(status)}">+ 카드 추가</button>
            </section>
          `;
        }).join('')}
      </div>
    `;
    bindKanbanDrag();
    bindSurfacePinchZoom($('.kanban-board', els.viewRoot), 'kanban');
  }

  function kanbanCard(t) {
    return `
      <article class="kanban-card ${taskHealthClass(t)}" data-drag-task="${escapeAttr(t.id)}" data-open-task="${escapeAttr(t.id)}" style="--card-accent:${statusAccent(t.status)}">
        <h3>${escapeHtml(t.title)}</h3>
        <div class="card-meta">
          <span class="badge ${STATUS_COLOR[t.status] || 'gray'}">${escapeHtml(t.status)}</span>
          <span class="badge ${categoryBadgeColor(t.category)}">${escapeHtml(t.category)}</span>
          ${dateRangeLabel(t) ? `<span class="date-chip">${escapeHtml(dateRangeLabel(t))}</span>` : '<span class="date-chip muted-chip">날짜 미정</span>'}
          ${t.assignee ? `<span class="date-chip">${escapeHtml(t.assignee)}</span>` : ''}
          ${isTaskOverdue(t) ? '<span class="date-chip danger-chip">마감 지남</span>' : ''}
          ${hasInvalidDateRange(t) ? '<span class="date-chip danger-chip">날짜 확인</span>' : ''}
        </div>
        ${t.memo ? `<div class="card-memo">${escapeHtml(t.memo)}</div>` : ''}
      </article>
    `;
  }

  function bindKanbanDrag() {
    $$('[data-drag-task]', els.viewRoot).forEach((card) => {
      card.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        const isTouchPointer = event.pointerType === 'touch';
        if (event.pointerType === 'touch') {
          if (isPinchGestureActive()) return;
        } else {
          event.preventDefault();
        }
        const start = { x: event.clientX, y: event.clientY };
        const id = card.dataset.dragTask;
        const dragStartViewport = captureKanbanViewport();
        let moved = false;
        let cancelKanbanCommit = false;
        let dragArmed = !isTouchPointer;
        let touchHoldTimer = null;
        let activeColumn = null;
        let dragGhost = null;
        let cardRect = null;
        let pointerOffset = { x: 0, y: 0 };
        let lastPointer = null;
        let autoScrollTimer = null;
        let previousBoardSnapType = null;
        const capturePointer = () => {
          try {
            card.setPointerCapture?.(event.pointerId);
          } catch (captureError) {
            // Synthetic touch tests may not register an active pointer before this call.
          }
        };
        if (isTouchPointer) {
          touchHoldTimer = setTimeout(() => {
            dragArmed = true;
            capturePointer();
          }, 220);
        } else {
          capturePointer();
        }

        const onTouchPinchCancel = (touchEvent) => {
          if (touchEvent.touches.length <= 1) return;
          markPinchGesture();
          cancelKanbanCommit = true;
          onUp({ clientX: start.x, clientY: start.y });
        };

        const setDropColumn = (column) => {
          if (activeColumn === column) return;
          activeColumn?.classList.remove('drag-over');
          activeColumn = column;
          activeColumn?.classList.add('drag-over');
        };
        const ensureDragGhost = () => {
          if (dragGhost) return;
          cardRect = card.getBoundingClientRect();
          pointerOffset = {
            x: start.x - cardRect.left,
            y: start.y - cardRect.top
          };
          dragGhost = card.cloneNode(true);
          dragGhost.removeAttribute('data-open-task');
          dragGhost.removeAttribute('data-drag-task');
          dragGhost.classList.add('kanban-drag-ghost');
          dragGhost.style.width = `${cardRect.width}px`;
          dragGhost.style.height = `${cardRect.height}px`;
          dragGhost.style.left = `${cardRect.left}px`;
          dragGhost.style.top = `${cardRect.top}px`;
          document.body.appendChild(dragGhost);
          card.classList.add('drag-source');
          document.body.classList.add('kanban-drag-active');
          const board = $('.kanban-board', els.viewRoot);
          if (board && previousBoardSnapType === null) {
            previousBoardSnapType = board.style.scrollSnapType || '';
            board.style.scrollSnapType = 'none';
          }
          if (!autoScrollTimer) {
            autoScrollTimer = setInterval(() => {
              if (lastPointer) autoScrollKanbanBoard(lastPointer);
            }, 40);
          }
        };
        const moveDragGhost = (moveEvent) => {
          if (!dragGhost) return;
          dragGhost.style.left = `${moveEvent.clientX - pointerOffset.x}px`;
          dragGhost.style.top = `${moveEvent.clientY - pointerOffset.y}px`;
        };
        const autoScrollKanbanBoard = (moveEvent) => {
          const board = $('.kanban-board', els.viewRoot);
          if (!board) return;
          const rootRect = els.viewRoot?.getBoundingClientRect();
          const rect = rootRect || board.getBoundingClientRect();
          const viewportWidth = window.visualViewport?.width || document.documentElement.clientWidth || window.innerWidth || rect.right;
          const left = Math.max(0, rect.left);
          const right = Math.min(viewportWidth, rect.right);
          const edge = 56;
          const maxStep = 28;
          if (moveEvent.clientX > right - edge) {
            const intensity = Math.min(1, (moveEvent.clientX - (right - edge)) / edge);
            board.scrollLeft += Math.max(8, maxStep * intensity);
          } else if (moveEvent.clientX < left + edge) {
            const intensity = Math.min(1, ((left + edge) - moveEvent.clientX) / edge);
            board.scrollLeft -= Math.max(8, maxStep * intensity);
          }
        };
        const onMove = (moveEvent) => {
          if (moveEvent.pointerType === 'touch' && isPinchGestureActive()) {
            cancelKanbanCommit = true;
            onUp(moveEvent);
            return;
          }
          lastPointer = { clientX: moveEvent.clientX, clientY: moveEvent.clientY };
          const dx = moveEvent.clientX - start.x;
          const dy = moveEvent.clientY - start.y;
          if (isTouchPointer && !dragArmed) {
            if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
              cancelKanbanCommit = true;
              onUp(moveEvent);
            }
            return;
          }
          if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
          if (!moved) return;
          moveEvent.preventDefault();
          ensureDragGhost();
          autoScrollKanbanBoard(moveEvent);
          moveDragGhost(moveEvent);
          dragGhost.style.pointerEvents = 'none';
          setDropColumn(document.elementFromPoint(moveEvent.clientX, moveEvent.clientY)?.closest('[data-drop-status]'));
          dragGhost.style.pointerEvents = '';
        };
        const onUp = (upEvent) => {
          document.removeEventListener('pointermove', onMove);
          document.removeEventListener('pointerup', onUp);
          document.removeEventListener('pointercancel', onUp);
          document.removeEventListener('touchstart', onTouchPinchCancel, true);
          document.removeEventListener('touchmove', onTouchPinchCancel, true);
          if (touchHoldTimer) {
            clearTimeout(touchHoldTimer);
            touchHoldTimer = null;
          }
          if (autoScrollTimer) {
            clearInterval(autoScrollTimer);
            autoScrollTimer = null;
          }
          try {
            card.releasePointerCapture?.(event.pointerId);
          } catch (captureError) {
            // Pointer capture may already be released on touch cancel or synthetic events.
          }
          card.classList.remove('drag-source');
          dragGhost?.remove();
          dragGhost = null;
          document.body.classList.remove('kanban-drag-active');
          const board = $('.kanban-board', els.viewRoot);
          if (board && previousBoardSnapType !== null) {
            const boardZoom = Number(board.style.zoom || getComputedStyle(board).zoom || 1);
            board.style.scrollSnapType = Math.abs(boardZoom - 1) > 0.01 || isMobileSurfaceZoomEnabled() ? 'none' : previousBoardSnapType;
          }
          activeColumn?.classList.remove('drag-over');
          if (moved && !cancelKanbanCommit) {
            kanbanDragSuppressClick = true;
            setTimeout(() => { kanbanDragSuppressClick = false; }, 0);
            const targetColumn = document.elementFromPoint(upEvent.clientX, upEvent.clientY)?.closest('[data-drop-status]') || activeColumn;
            const nextStatus = targetColumn?.dataset.dropStatus;
            const kanbanViewport = captureKanbanViewport();
            kanbanViewport.rootLeft = Math.max(kanbanViewport.rootLeft, dragStartViewport.rootLeft);
            kanbanViewport.boardLeft = Math.max(kanbanViewport.boardLeft, dragStartViewport.boardLeft);
            if (nextStatus) {
              updateTask(id, 'status', nextStatus, false);
              renderCurrentView();
            }
            restoreKanbanViewport(kanbanViewport);
          }
        };
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
        document.addEventListener('pointercancel', onUp);
        if (event.pointerType === 'touch') {
          document.addEventListener('touchstart', onTouchPinchCancel, { capture: true, passive: true });
          document.addEventListener('touchmove', onTouchPinchCancel, { capture: true, passive: true });
        }
      });
    });
  }

  function captureKanbanViewport() {
    const board = $('.kanban-board', els.viewRoot);
    const boardZoom = board ? Number(board.style.zoom || getComputedStyle(board).zoom || 1) || 1 : 1;
    return {
      rootLeft: els.viewRoot?.scrollLeft || 0,
      rootTop: els.viewRoot?.scrollTop || 0,
      boardLeft: board?.scrollLeft || 0,
      boardTop: board?.scrollTop || 0,
      boardZoom,
      columnScrolls: $$('[data-drop-status]', els.viewRoot).map((column) => ({
        status: column.dataset.dropStatus,
        top: $('.kanban-cards', column)?.scrollTop || 0
      }))
    };
  }

  function restoreKanbanViewport(snapshot) {
    if (!snapshot) return;
    requestAnimationFrame(() => {
      if (els.viewRoot) {
        els.viewRoot.scrollLeft = snapshot.rootLeft;
        els.viewRoot.scrollTop = snapshot.rootTop;
      }
      const board = $('.kanban-board', els.viewRoot);
      let previousSnap = '';
      if (board) {
        previousSnap = board.style.scrollSnapType || '';
        if (Math.abs((snapshot.boardZoom || 1) - 1) > 0.01) {
          board.style.zoom = String(snapshot.boardZoom);
          board.classList.add('is-zoomed');
        }
        board.style.scrollSnapType = 'none';
        board.scrollLeft = snapshot.boardLeft;
        board.scrollTop = snapshot.boardTop;
      }
      snapshot.columnScrolls?.forEach((item) => {
        const column = $$('[data-drop-status]', els.viewRoot).find((candidate) => candidate.dataset.dropStatus === item.status);
        const cards = column && $('.kanban-cards', column);
        if (cards) cards.scrollTop = item.top;
      });
      requestAnimationFrame(() => {
        const nextBoard = $('.kanban-board', els.viewRoot);
        if (els.viewRoot) {
          els.viewRoot.scrollLeft = snapshot.rootLeft;
          els.viewRoot.scrollTop = snapshot.rootTop;
        }
        if (nextBoard) {
          if (Math.abs((snapshot.boardZoom || 1) - 1) > 0.01) {
            nextBoard.style.zoom = String(snapshot.boardZoom);
            nextBoard.classList.add('is-zoomed');
          }
          nextBoard.scrollLeft = snapshot.boardLeft;
          nextBoard.scrollTop = snapshot.boardTop;
          const boardZoom = Number(snapshot.boardZoom || nextBoard.style.zoom || getComputedStyle(nextBoard).zoom || 1);
          nextBoard.style.scrollSnapType = Math.abs(boardZoom - 1) > 0.01 || isMobileSurfaceZoomEnabled() ? 'none' : previousSnap;
        }
      });
      setTimeout(() => {
        const delayedBoard = $('.kanban-board', els.viewRoot);
        if (els.viewRoot) {
          els.viewRoot.scrollLeft = snapshot.rootLeft;
          els.viewRoot.scrollTop = snapshot.rootTop;
        }
        if (delayedBoard) {
          delayedBoard.scrollLeft = snapshot.boardLeft;
          delayedBoard.scrollTop = snapshot.boardTop;
          const boardZoom = Number(snapshot.boardZoom || delayedBoard.style.zoom || getComputedStyle(delayedBoard).zoom || 1);
          delayedBoard.style.scrollSnapType = Math.abs(boardZoom - 1) > 0.01 || isMobileSurfaceZoomEnabled() ? 'none' : previousSnap;
        }
      }, 160);
      setTimeout(() => {
        const delayedBoard = $('.kanban-board', els.viewRoot);
        if (els.viewRoot) {
          els.viewRoot.scrollLeft = snapshot.rootLeft;
          els.viewRoot.scrollTop = snapshot.rootTop;
        }
        if (delayedBoard) {
          delayedBoard.scrollLeft = snapshot.boardLeft;
          delayedBoard.scrollTop = snapshot.boardTop;
          const boardZoom = Number(snapshot.boardZoom || delayedBoard.style.zoom || getComputedStyle(delayedBoard).zoom || 1);
          delayedBoard.style.scrollSnapType = Math.abs(boardZoom - 1) > 0.01 || isMobileSurfaceZoomEnabled() ? 'none' : previousSnap;
        }
      }, 420);
    });
  }

  function touchDistance(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.hypot(dx, dy);
  }

  function touchCenter(touches) {
    return {
      clientX: (touches[0].clientX + touches[1].clientX) / 2,
      clientY: (touches[0].clientY + touches[1].clientY) / 2
    };
  }

  function bindSurfacePinchZoom(target, view, customApply) {
    if (!target) return;
    if (view !== 'mindmap' && !isMobileSurfaceZoomEnabled()) return;
    let startDistance = 0;
    let startZoom = 1;
    let lastZoom = 1;
    let pinching = false;

    target.addEventListener('touchstart', (event) => {
      if (event.touches.length !== 2) return;
      markPinchGesture();
      pinching = true;
      startDistance = touchDistance(event.touches);
      startZoom = view === 'mindmap' ? normalizeMindZoom(state.mindZoom) : getLiveSurfaceZoom(view);
      lastZoom = startZoom;
      target.classList.add('pinching');
    }, { passive: true });

    target.addEventListener('touchmove', (event) => {
      if (!pinching || event.touches.length !== 2 || !startDistance) return;
      markPinchGesture();
      event.preventDefault();
      const scale = touchDistance(event.touches) / startDistance;
      const center = touchCenter(event.touches);
      const next = view === 'mindmap'
        ? normalizeMindZoom(startZoom * scale)
        : normalizeSurfaceZoom(startZoom * scale);
      if (Math.abs(next - lastZoom) < 0.01) return;
      lastZoom = next;
      if (customApply) {
        customApply(next, { ...center, saveImmediately: false });
      } else {
        applySurfaceZoom(view, next, { ...center, saveImmediately: false });
      }
    }, { passive: false });

    const finishPinch = () => {
      if (!pinching) return;
      pinching = false;
      startDistance = 0;
      markPinchGesture();
      target.classList.remove('pinching');
      if (view === 'mindmap') queueBoardSettingsSave(true);
    };
    target.addEventListener('touchend', finishPinch, { passive: true });
    target.addEventListener('touchcancel', finishPinch, { passive: true });
  }

  function applySurfaceZoom(view, nextZoom, options = {}) {
    if (!isMobileSurfaceZoomEnabled()) return;
    const oldZoom = getLiveSurfaceZoom(view);
    const normalizedNext = normalizeSurfaceZoom(nextZoom);
    if (normalizedNext === oldZoom) return;
    const surface = $(`[data-pinch-zoom-view="${view}"]`, els.viewRoot);
    const scroller = view === 'kanban' ? surface : els.viewRoot;
    const rect = scroller?.getBoundingClientRect();
    const previousLeft = scroller?.scrollLeft || 0;
    const previousTop = scroller?.scrollTop || 0;
    const anchorX = rect && Number.isFinite(options.clientX) ? options.clientX - rect.left : (rect?.width || 0) / 2;
    const anchorY = rect && Number.isFinite(options.clientY) ? options.clientY - rect.top : (rect?.height || 0) / 2;
    const contentRatioX = scroller && scroller.scrollWidth
      ? Math.min(1, Math.max(0, (scroller.scrollLeft + anchorX) / scroller.scrollWidth))
      : 0.5;
    const contentRatioY = scroller && scroller.scrollHeight
      ? Math.min(1, Math.max(0, (scroller.scrollTop + anchorY) / scroller.scrollHeight))
      : 0.5;
    if (surface) {
      surface.style.zoom = normalizedNext;
      surface.classList.toggle('is-zoomed', Math.abs(normalizedNext - 1) > 0.01);
      if (view === 'kanban') surface.style.scrollSnapType = Math.abs(normalizedNext - 1) > 0.01 ? 'none' : '';
    }
    requestAnimationFrame(() => {
      if (!scroller) return;
      let nextLeft = Math.max(0, scroller.scrollWidth * contentRatioX - anchorX);
      let nextTop = Math.max(0, scroller.scrollHeight * contentRatioY - anchorY);
      if (normalizedNext > oldZoom) {
        nextLeft = Math.max(previousLeft, nextLeft);
        nextTop = Math.max(previousTop, nextTop);
      }
      scroller.scrollLeft = nextLeft;
      scroller.scrollTop = nextTop;
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

  function fallbackStatus() {
    return DEFAULT_STATUSES[0] || '남은 카드';
  }

  function canDeleteStatus(status) {
    return Boolean(status && status !== fallbackStatus());
  }

  async function promptDeleteStatusFromSelect(id) {
    const deletable = getStatuses().filter(canDeleteStatus);
    if (!deletable.length) {
      alert('삭제할 수 있는 상태가 없습니다.');
      render();
      return;
    }
    const task = getTask(id);
    const defaultValue = task && canDeleteStatus(task.status) ? task.status : deletable[0];
    const name = prompt(`삭제할 상태명을 입력하세요.\n삭제 가능 상태: ${deletable.join(', ')}`, defaultValue);
    const status = String(name || '').trim();
    if (!status) {
      render();
      return;
    }
    if (!deletable.includes(status)) {
      alert('목록에 있는 상태명만 삭제할 수 있습니다.');
      render();
      return;
    }
    await deleteKanbanColumn(status);
  }

  async function deleteKanbanColumn(status) {
    if (!canDeleteStatus(status)) {
      alert('남은 카드 컬럼은 기본 컬럼이라 삭제할 수 없습니다.');
      return;
    }
    const affected = state.tasks.filter((t) => t.status === status);
    const fallback = getStatuses().find((s) => s === fallbackStatus()) || fallbackStatus();
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
    const zoom = normalizeMindZoom(state.mindZoom);
    setHeader(
      '마인드맵 보기',
      '노드를 드래그해서 위치를 조정할 수 있습니다. 노드를 클릭하면 상세 정보를 수정합니다.',
      `<div class="mindmap-toolbar" aria-label="마인드맵 확대 축소">
        <button class="icon-control" data-mind-zoom="out" title="축소" aria-label="축소">-</button>
        <span data-mind-zoom-label>${Math.round(zoom * 100)}%</span>
        <button class="icon-control" data-mind-zoom="in" title="확대" aria-label="확대">+</button>
        <button class="ghost-btn compact-btn" data-mind-zoom="reset">100%</button>
      </div><button class="ghost-btn" data-action="reset-mindmap-layout">자동정렬 초기화</button><button class="primary-btn" data-action="add-task">업무 추가</button>`
    );
    if (!state.tasks.length) {
      els.viewRoot.innerHTML = emptyState();
      return;
    }
    const tree = buildMindmapTree();
    layoutTree(tree);
    applySavedMindPositions(tree);
    const allNodes = flattenTree(tree);
    const minX = Math.min(-260, Math.min(...allNodes.map((n) => n.x)) - 180);
    const maxX = Math.max(1080, Math.max(...allNodes.map((n) => n.x)) + 220);
    const maxY = Math.max(...allNodes.map((n) => n.y)) + 110;
    const viewBox = `${minX} 0 ${maxX - minX} ${maxY}`;
    const svgWidth = Math.max(1200, maxX - minX);
    const svgHeight = Math.max(640, maxY);
    const links = [];
    const nodes = [];
    walkTree(tree, (node) => {
      applyMindNodeMetrics(node);
      node.children.forEach((child) => {
        applyMindNodeMetrics(child);
        links.push(renderMindLink(node, child));
      });
      nodes.push(renderMindNode(node));
    });
    els.viewRoot.innerHTML = `
      ${metricsStripHtml()}
      <div class="mindmap-shell" data-mindmap-shell>
        <svg class="mindmap-svg" viewBox="${viewBox}" width="${Math.round(svgWidth * zoom)}" height="${Math.round(svgHeight * zoom)}" data-base-width="${svgWidth}" data-base-height="${svgHeight}">
          <g class="mind-links-layer">${links.join('')}</g>
          <g class="mind-nodes-layer">${nodes.join('')}</g>
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

  function mindLinkPath(parent, child) {
    const py = parent.y + (parent.height || 46) / 2;
    const cy = child.y - (child.height || 46) / 2;
    const mid = (py + cy) / 2;
    return `M ${parent.x} ${py} V ${mid} H ${child.x} V ${cy}`;
  }

  function renderMindLink(parent, child) {
    const color = child.type === 'category' ? (CATEGORY_COLOR[child.category] || '#9fb2dd') : '#9fb2dd';
    return `<path class="mind-link" data-link-parent="${escapeAttr(parent.id)}" data-link-child="${escapeAttr(child.id)}" d="${mindLinkPath(parent, child)}" style="stroke:${color}"/>`;
  }

  function applyMindNodeMetrics(node) {
    const isRoot = node.type === 'root';
    const taskObj = node.task;
    node.width = isRoot ? 250 : Math.min(240, Math.max(126, String(node.title).length * 13 + 38));
    node.height = isRoot ? 58 : taskObj && taskObj.memo ? 58 : 46;
    return node;
  }

  function renderMindNode(node) {
    const isRoot = node.type === 'root';
    const isCategory = node.type === 'category';
    const taskObj = node.task;
    applyMindNodeMetrics(node);
    const width = node.width;
    const height = node.height;
    const x = node.x - width / 2;
    const y = node.y - height / 2;
    const stroke = isRoot ? '#2f5cff' : isCategory ? (CATEGORY_COLOR[node.category] || '#6d7788') : '#9fb2dd';
    const fill = isRoot ? '#ffffff' : isCategory ? '#ffffff' : '#ffffff';
    const textColor = isRoot ? '#254ad8' : isCategory ? stroke : '#172033';
    const titleLines = wrapText(node.title, isRoot ? 15 : 18, isRoot ? 2 : 1);
    const meta = taskObj ? (dateRangeLabel(taskObj) || taskObj.status) : '';
    return `
      <g class="mind-node ${isRoot ? 'root-node' : isCategory ? 'category-node' : 'task-node'}" transform="translate(${x},${y})" data-mind-id="${escapeAttr(node.id)}" data-mind-x="${node.x}" data-mind-y="${node.y}" data-mind-width="${width}" data-mind-height="${height}" ${taskObj ? `data-open-task="${escapeAttr(taskObj.id)}"` : ''}>
        <title>${escapeHtml(node.title)}${taskObj && dateRangeLabel(taskObj) ? ` · ${escapeHtml(dateRangeLabel(taskObj))}` : ''}</title>
        <rect width="${width}" height="${height}" rx="12" fill="${fill}" stroke="${stroke}" stroke-width="1.7"></rect>
        ${taskObj ? `<rect class="mind-node-accent" x="0" y="10" width="4" height="${height - 20}" rx="2" fill="${stroke}"></rect>` : ''}
        ${titleLines.map((line, i) => `<text x="${width / 2}" y="${isRoot ? 23 + i * 20 : 20 + i * 15}" text-anchor="middle" fill="${textColor}" font-size="${isRoot ? 18 : 12}" font-weight="${isRoot ? 900 : isCategory ? 900 : 800}">${escapeHtml(line)}</text>`).join('')}
        ${taskObj ? `<text x="${width / 2}" y="${height - 11}" text-anchor="middle" fill="#6d7788" font-size="10" font-weight="700">${escapeHtml(meta)}</text>` : ''}
      </g>
    `;
  }


  function bindMindmapDrag() {
    const svg = $('.mindmap-svg', els.viewRoot);
    if (!svg) return;
    const shell = $('[data-mindmap-shell]', els.viewRoot);
    const nodeState = new Map($$('[data-mind-id]', svg).map((node) => [node.dataset.mindId, {
      x: Number(node.dataset.mindX),
      y: Number(node.dataset.mindY),
      width: Number(node.dataset.mindWidth) || 140,
      height: Number(node.dataset.mindHeight) || 46
    }]));
    const svgPoint = (event) => {
      const point = svg.createSVGPoint();
      point.x = event.clientX;
      point.y = event.clientY;
      const matrix = svg.getScreenCTM();
      return matrix ? point.matrixTransform(matrix.inverse()) : { x: event.clientX, y: event.clientY };
    };
    const refreshLinks = () => {
      $$('[data-link-parent]', svg).forEach((link) => {
        const parent = nodeState.get(link.dataset.linkParent);
        const child = nodeState.get(link.dataset.linkChild);
        if (!parent || !child) return;
        link.setAttribute('d', mindLinkPath(parent, child));
      });
    };
    if (shell) {
      shell.addEventListener('wheel', (event) => {
        event.preventDefault();
        const current = normalizeMindZoom(state.mindZoom);
        const next = normalizeMindZoom(current + (event.deltaY < 0 ? 0.08 : -0.08));
        applyMindZoom(next, {
          clientX: event.clientX,
          clientY: event.clientY,
          saveImmediately: false
        });
      }, { passive: false });

      shell.addEventListener('pointerdown', (event) => {
        if (event.button !== 0 || event.target.closest('.mind-node')) return;
        if (event.pointerType === 'touch' && isPinchGestureActive()) return;
        const start = { x: event.clientX, y: event.clientY, left: shell.scrollLeft, top: shell.scrollTop };
        try {
          shell.setPointerCapture?.(event.pointerId);
        } catch (captureError) {
          // Synthetic touch tests may not register an active pointer before this call.
        }
        shell.classList.add('panning');
        const onTouchPinchCancel = (touchEvent) => {
          if (touchEvent.touches.length <= 1) return;
          markPinchGesture();
          onUp();
        };
        const onMove = (moveEvent) => {
          if (moveEvent.pointerType === 'touch' && isPinchGestureActive()) {
            onUp();
            return;
          }
          moveEvent.preventDefault();
          shell.scrollLeft = start.left - (moveEvent.clientX - start.x);
          shell.scrollTop = start.top - (moveEvent.clientY - start.y);
        };
        const onUp = () => {
          document.removeEventListener('pointermove', onMove);
          document.removeEventListener('pointerup', onUp);
          document.removeEventListener('pointercancel', onUp);
          document.removeEventListener('touchstart', onTouchPinchCancel, true);
          document.removeEventListener('touchmove', onTouchPinchCancel, true);
          try {
            shell.releasePointerCapture?.(event.pointerId);
          } catch (captureError) {
            // Pointer capture may already be released on touch cancel or synthetic events.
          }
          shell.classList.remove('panning');
        };
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
        document.addEventListener('pointercancel', onUp);
        if (event.pointerType === 'touch') {
          document.addEventListener('touchstart', onTouchPinchCancel, { capture: true, passive: true });
          document.addEventListener('touchmove', onTouchPinchCancel, { capture: true, passive: true });
        }
      });
    }
    $$('[data-mind-id]', svg).forEach((node) => {
      node.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        const isTouchPointer = event.pointerType === 'touch';
        if (event.pointerType === 'touch' && isPinchGestureActive()) return;
        if (!isTouchPointer) event.preventDefault();
        const id = node.dataset.mindId;
        const width = Number(node.dataset.mindWidth) || 140;
        const height = Number(node.dataset.mindHeight) || 46;
        const original = { x: Number(node.dataset.mindX), y: Number(node.dataset.mindY) };
        const start = svgPoint(event);
        const dragScroll = { left: shell?.scrollLeft || 0, top: shell?.scrollTop || 0 };
        let latest = original;
        let moved = false;
        let cancelMindCommit = false;
        let dragArmed = !isTouchPointer;
        let touchHoldTimer = null;
        const capturePointer = () => {
          try {
            node.setPointerCapture?.(event.pointerId);
          } catch (captureError) {
            // Synthetic touch tests may not register an active pointer before this call.
          }
        };
        if (isTouchPointer) {
          touchHoldTimer = setTimeout(() => {
            dragArmed = true;
            capturePointer();
          }, 220);
        } else {
          capturePointer();
        }

        const onTouchPinchCancel = (touchEvent) => {
          if (touchEvent.touches.length <= 1) return;
          markPinchGesture();
          cancelMindCommit = true;
          onUp();
        };

        const onMove = (moveEvent) => {
          if (moveEvent.pointerType === 'touch' && isPinchGestureActive()) {
            cancelMindCommit = true;
            onUp();
            return;
          }
          const now = svgPoint(moveEvent);
          const dx = now.x - start.x;
          const dy = now.y - start.y;
          if (isTouchPointer && !dragArmed) {
            if (Math.abs(moveEvent.clientX - event.clientX) > 8 || Math.abs(moveEvent.clientY - event.clientY) > 8) {
              cancelMindCommit = true;
              onUp();
            }
            return;
          }
          moveEvent.preventDefault();
          if (Math.abs(dx) > 2 || Math.abs(dy) > 2) moved = true;
          node.classList.add('dragging');
          latest = { x: original.x + dx, y: original.y + dy };
          nodeState.set(id, { x: latest.x, y: latest.y, width, height });
          node.setAttribute('transform', `translate(${latest.x - width / 2},${latest.y - height / 2})`);
          refreshLinks();
          if (shell) {
            shell.scrollLeft = dragScroll.left;
            shell.scrollTop = dragScroll.top;
          }
        };
        const onUp = () => {
          document.removeEventListener('pointermove', onMove);
          document.removeEventListener('pointerup', onUp);
          document.removeEventListener('pointercancel', onUp);
          document.removeEventListener('touchstart', onTouchPinchCancel, true);
          document.removeEventListener('touchmove', onTouchPinchCancel, true);
          if (touchHoldTimer) {
            clearTimeout(touchHoldTimer);
            touchHoldTimer = null;
          }
          try {
            node.releasePointerCapture?.(event.pointerId);
          } catch (captureError) {
            // Pointer capture may already be released on touch cancel or synthetic events.
          }
          node.classList.remove('dragging');
          if (moved && cancelMindCommit) {
            nodeState.set(id, { x: original.x, y: original.y, width, height });
            node.setAttribute('transform', `translate(${original.x - width / 2},${original.y - height / 2})`);
            refreshLinks();
            if (shell) {
              shell.scrollLeft = dragScroll.left;
              shell.scrollTop = dragScroll.top;
            }
          }
          if (moved && !cancelMindCommit) {
            mindDragSuppressClick = true;
            setTimeout(() => { mindDragSuppressClick = false; }, 0);
            state.mindPositions = { ...(state.mindPositions || {}) };
            state.mindPositions[id] = { x: Math.round(latest.x), y: Math.round(latest.y) };
            const mindViewport = { view: 'mindmap', left: dragScroll.left, top: dragScroll.top };
            queueBoardSettingsSave(true);
            renderCurrentView();
            restoreCurrentViewport(mindViewport);
          }
        };
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
        document.addEventListener('pointercancel', onUp);
        if (event.pointerType === 'touch') {
          document.addEventListener('touchstart', onTouchPinchCancel, { capture: true, passive: true });
          document.addEventListener('touchmove', onTouchPinchCancel, { capture: true, passive: true });
        }
      });
    });
    bindSurfacePinchZoom(shell, 'mindmap', applyMindZoom);
  }

  function setMindZoom(action) {
    const current = normalizeMindZoom(state.mindZoom);
    const next = action === 'in'
      ? current + 0.15
      : action === 'out'
        ? current - 0.15
        : 1;
    applyMindZoom(normalizeMindZoom(next), { saveImmediately: true });
  }

  function applyMindZoom(nextZoom, options = {}) {
    const oldZoom = normalizeMindZoom(state.mindZoom);
    const normalizedNext = normalizeMindZoom(nextZoom);
    if (normalizedNext === oldZoom) return;
    const shell = $('[data-mindmap-shell]', els.viewRoot);
    const svg = $('.mindmap-svg', els.viewRoot);
    const rect = shell?.getBoundingClientRect();
    const svgRect = svg?.getBoundingClientRect();
    const baseWidth = Number(svg?.dataset.baseWidth);
    const baseHeight = Number(svg?.dataset.baseHeight);
    const previousLeft = shell?.scrollLeft || 0;
    const previousTop = shell?.scrollTop || 0;
    const anchorX = rect && Number.isFinite(options.clientX) ? options.clientX - rect.left : (rect?.width || 0) / 2;
    const anchorY = rect && Number.isFinite(options.clientY) ? options.clientY - rect.top : (rect?.height || 0) / 2;
    const contentRatioX = svgRect && Number.isFinite(options.clientX) && svgRect.width
      ? Math.min(1, Math.max(0, (options.clientX - svgRect.left) / svgRect.width))
      : shell && shell.scrollWidth
        ? Math.min(1, Math.max(0, (shell.scrollLeft + anchorX) / shell.scrollWidth))
        : 0.5;
    const contentRatioY = svgRect && Number.isFinite(options.clientY) && svgRect.height
      ? Math.min(1, Math.max(0, (options.clientY - svgRect.top) / svgRect.height))
      : shell && shell.scrollHeight
        ? Math.min(1, Math.max(0, (shell.scrollTop + anchorY) / shell.scrollHeight))
        : 0.5;
    state.mindZoom = normalizedNext;
    scheduleSave();
    queueBoardSettingsSave(options.saveImmediately !== false);
    const label = $('[data-mind-zoom-label]');
    if (label) label.textContent = `${Math.round(normalizedNext * 100)}%`;
    if (svg && Number.isFinite(baseWidth) && Number.isFinite(baseHeight)) {
      svg.setAttribute('width', String(Math.round(baseWidth * normalizedNext)));
      svg.setAttribute('height', String(Math.round(baseHeight * normalizedNext)));
    } else {
      renderCurrentView();
    }
    requestAnimationFrame(() => {
      const nextShell = $('[data-mindmap-shell]', els.viewRoot);
      if (!nextShell) return;
      let nextLeft = Math.max(0, nextShell.scrollWidth * contentRatioX - anchorX);
      let nextTop = Math.max(0, nextShell.scrollHeight * contentRatioY - anchorY);
      if (normalizedNext > oldZoom) {
        nextLeft = Math.max(previousLeft, nextLeft);
        nextTop = Math.max(previousTop, nextTop);
      }
      nextShell.scrollLeft = nextLeft;
      nextShell.scrollTop = nextTop;
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
    const zoom = getRenderedSurfaceZoom('timeline');
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
      els.viewRoot.innerHTML = `<div class="empty-state"><div class="empty-icon">📅</div><h3>일정이 있는 업무가 없습니다.</h3><p>업무 테이블에서 시작일이나 마감일을 입력하면 타임라인이 자동 생성됩니다.</p></div>`;
      return;
    }
    const dates = datedTasks.flatMap((t) => [t.startDate, t.endDate].filter(Boolean)).map((d) => new Date(d));
    const min = addDays(startOfDay(new Date(Math.min(...dates))), -3);
    const max = addDays(startOfDay(new Date(Math.max(...dates))), 10);
    const totalDays = Math.max(1, daysBetween(min, max) + 1);
    const dayMarks = getDayMarks(min, max);
    const timelineWidth = Math.max(960, totalDays * 58);

    els.viewRoot.innerHTML = `
      ${metricsStripHtml(datedTasks)}
      <div class="timeline-wrap timeline-daily zoomable-surface" data-pinch-zoom-view="timeline" style="zoom:${zoom}">
        <div class="timeline-left">
          <div class="timeline-head">업무명</div>
          ${datedTasks.map((t) => `<div class="timeline-label ${taskHealthClass(t)}" title="${escapeAttr(t.title)}"><span>${escapeHtml(t.title)}</span>${isTaskOverdue(t) ? '<em>지남</em>' : ''}</div>`).join('')}
        </div>
        <div class="timeline-right" style="min-width:${timelineWidth}px">
          <div class="timeline-axis timeline-axis-days" style="--day-count:${totalDays}">
            ${dayMarks.map((d) => `<div class="${escapeAttr(d.className)}" title="${escapeAttr(d.title)}"><b>${escapeHtml(d.day)}</b><span>${escapeHtml(d.weekday)}</span>${d.caption ? `<em>${escapeHtml(d.caption)}</em>` : ''}</div>`).join('')}
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
    bindSurfacePinchZoom($('.timeline-wrap', els.viewRoot), 'timeline');
  }

  function renderTimelineRow(t, min, totalDays) {
    const start = startOfDay(new Date(t.startDate || t.endDate));
    const end = startOfDay(new Date(t.endDate || t.startDate));
    const left = Math.max(0, daysBetween(min, start)) / totalDays * 100;
    const width = Math.max(2.2, (daysBetween(start, end) + 1) / totalDays * 100);
    const color = timelineColor(t);
    return `
      <div class="timeline-row ${taskHealthClass(t)}" style="--day-count:${totalDays}">
        <div class="timeline-bar ${taskHealthClass(t)}" data-open-task="${escapeAttr(t.id)}" style="left:${left}%; width:${width}%; background:${color.bg}; border-color:${color.border}; color:${color.text};" title="${escapeAttr(t.title)} · ${escapeAttr(dateRangeLabel(t))}">
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
      const holidayName = koreanHolidayName(cursor);
      const classes = ['timeline-day', dateToneClasses(cursor), cursor.getDate() === 1 ? 'month-start' : ''].filter(Boolean).join(' ');
      marks.push({
        day: `${cursor.getMonth() + 1}/${cursor.getDate()}`,
        weekday: weekdays[cursor.getDay()],
        month: `${cursor.getFullYear()}.${String(cursor.getMonth() + 1).padStart(2, '0')}`,
        caption: holidayName || (cursor.getDate() === 1 ? `${cursor.getFullYear()}.${String(cursor.getMonth() + 1).padStart(2, '0')}` : ''),
        className: classes,
        title: holidayName ? `${localDateKey(cursor)} ${holidayName}` : localDateKey(cursor)
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
    const zoom = getRenderedSurfaceZoom('calendar');
    setHeader(
      '캘린더 보기',
      '같은 업무는 날짜별로 반복하지 않고 시작일부터 종료일까지 이어지는 막대로 표시합니다.',
      '<button class="primary-btn" data-action="add-task">업무 추가</button>'
    );
    const cursor = parseMonth(state.calendarDate);
    const monthTasks = state.tasks.filter((task) => taskIntersectsMonth(task, cursor));
    const gridStart = addDays(new Date(cursor.getFullYear(), cursor.getMonth(), 1), -mondayOffset(new Date(cursor.getFullYear(), cursor.getMonth(), 1)));
    const weeks = Array.from({ length: 6 }, (_, weekIndex) => Array.from({ length: 7 }, (_, dayIndex) => addDays(gridStart, weekIndex * 7 + dayIndex)));
    const weekdayLabels = [
      { label: '월', className: '' },
      { label: '화', className: '' },
      { label: '수', className: '' },
      { label: '목', className: '' },
      { label: '금', className: '' },
      { label: '토', className: 'saturday' },
      { label: '일', className: 'sunday' }
    ];

    els.viewRoot.innerHTML = `
      ${metricsStripHtml(monthTasks)}
      <div class="calendar-toolbar">
        <div class="calendar-title">${cursor.getFullYear()}년 ${cursor.getMonth() + 1}월</div>
        <div class="calendar-nav">
          <button class="ghost-btn" id="prevMonthBtn">이전 달</button>
          <button class="ghost-btn" id="todayMonthBtn">이번 달</button>
          <button class="ghost-btn" id="nextMonthBtn">다음 달</button>
        </div>
      </div>
        <div class="calendar-board zoomable-surface" data-pinch-zoom-view="calendar" style="zoom:${zoom}">
          <div class="calendar-weekdays">
          ${weekdayLabels.map((w) => `<div class="weekday ${w.className}">${w.label}</div>`).join('')}
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
    bindSurfacePinchZoom($('.calendar-board', els.viewRoot), 'calendar');
  }

  function renderCalendarWeek(week, cursor) {
    const segments = calendarSegmentsForWeek(week);
    const laneCount = Math.max(2, ...segments.map((s) => s.lane + 1));
    return `
      <div class="calendar-week" style="--calendar-lanes:${laneCount}">
        ${week.map((day) => {
          const isOut = day.getMonth() !== cursor.getMonth();
          const holidayName = koreanHolidayName(day);
          const toneClasses = dateToneClasses(day);
          const isToday = localDateKey(day) === localDateKey(new Date());
          return `
            <div class="calendar-day-shell ${isOut ? 'out-month' : ''} ${toneClasses} ${isToday ? 'today' : ''}" title="${escapeAttr(holidayName || localDateKey(day))}">
              <div class="day-number">${day.getDate()}</div>
              ${holidayName ? `<div class="holiday-label">${escapeHtml(holidayName)}</div>` : ''}
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
              taskHealthClass(segment.task),
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
      <div class="drawer-summary">
        <span class="badge ${STATUS_COLOR[t.status] || 'gray'}">${escapeHtml(t.status)}</span>
        <span class="badge ${categoryBadgeColor(t.category)}">${escapeHtml(t.category)}</span>
        ${dateRangeLabel(t) ? `<span class="date-chip">${escapeHtml(dateRangeLabel(t))}</span>` : '<span class="date-chip muted-chip">날짜 미정</span>'}
        ${isTaskOverdue(t) ? '<span class="date-chip danger-chip">마감 지남</span>' : ''}
        ${hasInvalidDateRange(t) ? '<span class="date-chip danger-chip">날짜 확인</span>' : ''}
      </div>
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
        handleEditableFieldChange(t.id, e.target.dataset.drawerField, e.target.value, shouldRerender);
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
    const extra = field === 'category'
      ? `<option value="${ADD_CATEGORY_VALUE}">+ 새 분류 추가...</option>`
      : field === 'status'
        ? `<option value="${ADD_STATUS_VALUE}">+ 새 상태 추가...</option>`
        : '';
    return `<select data-drawer-field="${escapeAttr(field)}">${options.map((opt) => `<option value="${escapeAttr(opt)}" ${opt === current ? 'selected' : ''}>${escapeHtml(opt)}</option>`).join('')}${extra}</select>`;
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

  async function handleEditableFieldChange(id, field, value, rerender = true) {
    if (field === 'category' && value === ADD_CATEGORY_VALUE) {
      const name = prompt('새 분류명을 입력하세요.');
      const category = String(name || '').trim();
      if (!category) {
        render();
        return;
      }
      updateTask(id, field, category, true);
      return;
    }

    if (field === 'category' && value === DELETE_CATEGORY_VALUE) {
      await promptDeleteCategoryFromSelect(id);
      return;
    }

    if (field === 'status' && value === ADD_STATUS_VALUE) {
      const name = prompt('새 상태명을 입력하세요.');
      const status = String(name || '').trim();
      if (!status) {
        render();
        return;
      }
      state.statuses = normalizeStatusList([...getStatuses(), status], state.tasks);
      queueBoardSettingsSave(true);
      updateTask(id, field, status, true);
      return;
    }

    if (field === 'status' && value === DELETE_STATUS_VALUE) {
      await promptDeleteStatusFromSelect(id);
      return;
    }

    updateTask(id, field, value, rerender);
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
      const childIds = state.tasks.filter((item) => item.parentId === id).map((item) => item.id);
      if (childIds.length) {
        const { error: childError } = await supabaseClient
          .from('tasks')
          .update({ parent_id: null })
          .eq('board_id', currentBoardId)
          .in('id', childIds);
        if (childError) {
          console.error(childError);
          alert('하위 업무 정리에 실패했습니다.');
          return;
        }
      }
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
        if (!CLOUD_ENABLED) saveLocalTableState(state);
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
    closeNewTableModal(false);
    closeProjectListModal(false);
    renderShareModal();
    els.modalBackdrop.hidden = false;
    els.shareModal.hidden = false;
  }

  function closeShareModal(hideBackdrop = true) {
    els.shareModal.hidden = true;
    if (hideBackdrop && els.newTableModal?.hidden && els.projectListModal?.hidden) els.modalBackdrop.hidden = true;
  }

  function openNewTableModal() {
    closeShareModal(false);
    closeProjectListModal(false);
    if (els.newTableLabel) els.newTableLabel.value = '';
    els.modalBackdrop.hidden = false;
    els.newTableModal.hidden = false;
    requestAnimationFrame(() => els.newTableLabel?.focus());
  }

  function closeNewTableModal(hideBackdrop = true) {
    if (!els.newTableModal) return;
    els.newTableModal.hidden = true;
    if (hideBackdrop && els.shareModal?.hidden && els.projectListModal?.hidden) els.modalBackdrop.hidden = true;
  }

  function openProjectListModal() {
    closeShareModal(false);
    closeNewTableModal(false);
    renderProjectListModal();
    els.modalBackdrop.hidden = false;
    els.projectListModal.hidden = false;
  }

  function closeProjectListModal(hideBackdrop = true) {
    if (!els.projectListModal) return;
    els.projectListModal.hidden = true;
    if (hideBackdrop && els.shareModal?.hidden && els.newTableModal?.hidden) els.modalBackdrop.hidden = true;
  }

  function closeAllModals() {
    closeShareModal(false);
    closeNewTableModal(false);
    closeProjectListModal(false);
    els.modalBackdrop.hidden = true;
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

  function localDateKey(date) {
    const d = startOfDay(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function koreanHolidayName(date) {
    const key = localDateKey(date);
    const yearly = KOREAN_HOLIDAYS_BY_YEAR[date.getFullYear()] || {};
    return yearly[key] || FIXED_KOREAN_HOLIDAYS[key.slice(5)] || '';
  }

  function calendarTone(date) {
    const holidayName = koreanHolidayName(date);
    return {
      holidayName,
      isHoliday: Boolean(holidayName),
      isSaturday: date.getDay() === 6,
      isSunday: date.getDay() === 0
    };
  }

  function dateToneClasses(date) {
    const tone = calendarTone(date);
    return [
      tone.isHoliday ? 'holiday' : '',
      tone.isSunday ? 'sunday' : '',
      tone.isSaturday ? 'saturday' : ''
    ].filter(Boolean).join(' ');
  }

  function toDateInput(date) {
    const d = new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function uid() {
    return (globalThis.crypto?.randomUUID?.() || `id_${Math.random().toString(36).slice(2)}_${Date.now()}`).replace(/-/g, '').slice(0, 18);
  }

  function normalizeProjectName(name) {
    const title = String(name || '').trim();
    if (title === 'LED 전광판 사업 진행 상황') return 'LED전광판 사업 진행 현황';
    return title || '무제 프로젝트';
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
