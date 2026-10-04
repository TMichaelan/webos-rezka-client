'use strict';

const METHODS = new Set(['status', 'configure', 'login', 'logout', 'catalog', 'search', 'details', 'person', 'partRatings', 'trailer', 'streams', 'subtitle', 'bookmarkLists', 'bookmarks', 'setBookmark', 'setEpisodeWatched', 'continueWatching', 'progress', 'saveProgress']);
const MESSAGES = {
  INVALID_INPUT: 'Проверьте введённые данные.',
  AUTH_REQUIRED: 'Войдите в аккаунт HDRezka.',
  BAD_CREDENTIALS: 'Сайт отклонил логин или пароль.',
  LOGIN_FAILED: 'Не удалось подтвердить вход. Проверьте логин и пароль.',
  NETWORK_ERROR: 'Не удалось связаться с сайтом. Проверьте соединение.',
  TIMEOUT: 'Сайт не ответил вовремя. Повторите попытку.',
  REQUEST_TIMEOUT: 'Сайт не ответил вовремя. Повторите попытку.',
  ABORTED: 'Запрос отменён.',
  UNSUPPORTED_PROTOCOL: 'Формат ответа сайта изменился или эта операция пока недоступна.',
  CHALLENGE_UNSUPPORTED: 'Сайт изменил проверку доступа. Нужна совместимая версия клиента.',
  CHALLENGE_FAILED: 'Не удалось пройти проверку сайта. Повторите попытку позже.',
  CHALLENGE_LIMIT: 'Проверка сайта превысила допустимое время или сложность.',
  UNTRUSTED_URL: 'Сайт перенаправил запрос на неподдерживаемый адрес.',
  UNSAFE_URL: 'Адрес запроса не разрешён.',
  BLOCKED_URL: 'Адрес запроса не разрешён.',
  UNSUPPORTED_CHALLENGE: 'Сайт изменил проверку доступа. Нужна совместимая версия клиента.',
  REDIRECT_LIMIT: 'Сайт перенаправляет запрос слишком много раз.',
  RESPONSE_TOO_LARGE: 'Ответ сайта превышает допустимый размер.',
  INVALID_RESPONSE: 'Сайт вернул неожиданный формат данных.',
  INVALID_REQUEST: 'Некорректные параметры запроса.',
  SESSION_STORAGE: 'Не удалось сохранить сессию на устройстве.',
  SESSION_CHANGED: 'Сессия изменилась. Повторите действие.',
  TLS_ERROR: 'Не удалось проверить защищённое соединение с сайтом.',
  HTTP_ERROR: 'Сайт вернул ошибку. Повторите попытку позже.',
  INTERNAL_ERROR: 'Не удалось выполнить операцию. Повторите попытку.',
};

function createDispatcher(provider) {
  return async function rpc(request) {
    if (!request || !METHODS.has(request.method) || !request.params || typeof request.params !== 'object' || Array.isArray(request.params)) {
      return { returnValue: false, errorCode: 'INVALID_INPUT', errorText: MESSAGES.INVALID_INPUT, retryable: false };
    }
    try {
      return { returnValue: true, result: await provider.dispatch(request.method, request.params) };
    } catch (error) {
      const code = typeof error.code === 'string' && /^[A-Z_]{3,40}$/.test(error.code) ? error.code : 'INTERNAL_ERROR';
      const text = typeof error.publicMessage === 'string' ? error.publicMessage.slice(0,500) : MESSAGES[code] || MESSAGES.INTERNAL_ERROR;
      return { returnValue: false, errorCode: code, errorText: text, retryable: error.retryable === true };
    }
  };
}

module.exports = { createDispatcher };
