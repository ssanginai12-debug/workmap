/**
 * WorkMap Supabase Auth hotfix
 *
 * Supabase 공식 문서에 안내된 onAuthStateChange 비동기 교착 문제를 피하기 위해
 * 콜백을 즉시 반환하고 실제 비동기 처리는 다음 이벤트 루프에서 실행합니다.
 *
 * 이 파일은 반드시 config.js 다음, app.js 이전에 로드해야 합니다.
 */
(() => {
  'use strict';

  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    console.error('[WorkMap] Supabase SDK가 로드되지 않아 인증 핫픽스를 적용하지 못했습니다.');
    return;
  }

  const originalCreateClient = window.supabase.createClient.bind(window.supabase);

  window.supabase.createClient = function patchedCreateClient(url, key, options = {}) {
    const client = originalCreateClient(url, key, {
      ...options,
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        ...(options.auth || {})
      }
    });

    const originalOnAuthStateChange = client.auth.onAuthStateChange.bind(client.auth);

    client.auth.onAuthStateChange = function patchedOnAuthStateChange(callback) {
      return originalOnAuthStateChange((event, session) => {
        // 중요: Supabase Auth 콜백 안에서 await/DB 호출을 직접 실행하지 않습니다.
        // setTimeout으로 다음 이벤트 루프로 넘겨 인증 잠금이 먼저 해제되도록 합니다.
        setTimeout(() => {
          try {
            const result = callback(event, session);
            if (result && typeof result.catch === 'function') {
              result.catch((error) => {
                console.error('[WorkMap] 인증 상태 후속 처리 오류:', error);
              });
            }
          } catch (error) {
            console.error('[WorkMap] 인증 상태 처리 오류:', error);
          }
        }, 0);
      });
    };

    return client;
  };
})();
