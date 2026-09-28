import { test, expect } from '@playwright/test'
test.beforeEach(async ({ request }) => { await request.post('http://127.0.0.1:5174/api/test/reset') })

test('cold guest startup is not a login gate', async ({ page }) => {
  const methods: string[] = []
  await page.route('**/api/rpc', async route => {
    methods.push(route.request().postDataJSON().method)
    await route.continue()
  })
  await page.goto('/')
  await expect(page.locator('[data-nav-id="nav-home"]')).toBeVisible()
  await expect(page.locator('.section-heading h2')).toHaveText(['Новинки', 'Популярное'])
  await expect(page.locator('[data-nav-id="new-200"]')).toBeVisible()
  await expect(page.locator('[data-nav-id="nav-bookmarks"]')).toHaveCount(0)
  await expect(page.locator('[data-nav-id="nav-settings"]')).toHaveCount(0)
  await expect(page.getByLabel('Логин или e-mail')).toHaveCount(0)
  await expect(page.locator('[data-nav-id="nav-series"]')).toBeVisible()
  await page.locator('[data-nav-id="nav-series"]').click()
  await expect(page.locator('[data-nav-id="catalog-100"]')).toBeVisible()
  expect(methods).toContain('status')
  expect(methods).toContain('catalog')
  expect(methods.filter(method => ['bookmarkLists', 'bookmarks', 'setBookmark', 'continueWatching', 'progress', 'saveProgress', 'setEpisodeWatched'].includes(method))).toEqual([])
})

test('profile shows the real username and has automatic account refresh without technical settings', async ({ page }) => {
  let statusReads = 0
  await page.route('**/api/rpc', async route => {
    if (route.request().postDataJSON().method === 'status') statusReads++
    await route.continue()
  })
  await page.goto('/')
  await page.locator('[data-nav-id="nav-profile"]').click()
  await expect(page.getByLabel('Логин или e-mail')).toBeFocused()
  await page.getByLabel('Логин или e-mail').fill('demo@example.test')
  await page.getByLabel('Пароль', { exact: true }).fill('demo-only')
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  await expect(page.locator('.sidebar-account')).toContainText('Локальный тест')
  await expect(page.getByRole('heading', { name: 'Профиль', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Локальный тест', exact: true })).toBeVisible()
  await page.locator('[data-nav-id="nav-home"]').click()
  await expect(page.locator('.section-heading h2')).toHaveText(['Продолжить просмотр', 'Мои закладки', 'Новинки', 'Популярное'])
  const before = statusReads
  await page.locator('[data-nav-id="nav-profile"]').click()
  await expect(page.getByRole('heading', { name: 'Локальный тест', exact: true })).toBeVisible()
  await expect.poll(() => statusReads).toBeGreaterThan(before)
  await expect(page.getByRole('button', { name: 'Обновить состояние', exact: true })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: /Зеркало HDRezka|Ваши предпочтения|Состояние приложения/ })).toHaveCount(0)
  await expect(page.getByRole('checkbox')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Выйти из аккаунта', exact: true })).toBeVisible()
  await expect(page.locator('.account-tier')).toContainText('Premium')
  await page.getByRole('button', { name: 'Выйти из аккаунта', exact: true }).click()
  await page.getByRole('button', { name: 'Выйти', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Профиль', exact: true })).toBeVisible()
  await expect(page.getByLabel('Логин или e-mail')).toBeFocused()
  await expect(page.locator('[data-nav-id="nav-bookmarks"]')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.locator('.section-heading h2')).toHaveText(['Новинки', 'Популярное'])
  await expect(page.locator('[data-nav-id="continue-100"]')).toHaveCount(0)
})

test('Home and catalog have no manual refresh buttons, and episode marking is automatic', async ({ page }) => {
  await page.goto('/')
  await page.locator('[data-nav-id="nav-profile"]').click()
  await expect(page.getByLabel('Логин или e-mail')).toBeFocused()
  await page.getByLabel('Логин или e-mail').fill('demo@example.test')
  await page.getByLabel('Пароль', { exact: true }).fill('demo-only')
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Выйти из аккаунта', exact: true })).toBeVisible()
  await page.locator('[data-nav-id="nav-home"]').click()
  await expect(page.getByRole('button', { name: /Обновить/ })).toHaveCount(0)
  await page.locator('[data-nav-id="nav-series"]').click()
  await expect(page.locator('[data-nav-id="catalog-100"]')).toBeVisible()
  await expect(page.getByRole('button', { name: /Обновить/ })).toHaveCount(0)
  await page.locator('[data-nav-id="catalog-100"]').click()
  await expect(page.locator('[data-nav-id="detail-play"]')).toBeVisible()
  await expect(page.getByRole('button', { name: /Отметить серию просмотренной|Снять отметку о просмотре/ })).toHaveCount(0)
})

test('Search has no decorative empty card and visible screens have no Back chrome', async ({ page }) => {
  await page.goto('/')
  await page.locator('[data-nav-id="nav-search"]').click()
  await expect(page.locator('.empty-state, .empty-icon')).toHaveCount(0)
  await expect(page.getByText(/Найдите свою следующую историю|Введите название фильма/)).toHaveCount(0)
  const input = page.getByLabel('Название фильма или сериала')
  await input.fill('не-существует')
  await page.getByRole('button', { name: 'Найти', exact: true }).click()
  await expect(page.getByText('Ничего не найдено', { exact: true })).toBeVisible()
  await expect(page.locator('.empty-state, .empty-icon')).toHaveCount(0)
  await page.locator('[data-nav-id="nav-films"]').click()
  await expect(page.locator('.page-header button')).toHaveCount(0)
  await page.locator('[data-nav-id="catalog-200"]').click()
  await expect(page.locator('.detail-topline')).toHaveCount(0)
  await page.locator('[data-nav-id="detail-play"]').click()
  await expect.poll(() => page.locator('video').evaluate(v => (v as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2)
  await expect(page.locator('.player-heading').getByRole('button', { name: 'Назад', exact: true })).toHaveCount(0)
  await page.locator('.player-stage').focus(); await page.keyboard.press('Escape'); await page.keyboard.press('Escape')
  await expect(page.locator('video')).toHaveCount(0)
})

test('scrollbars stay hidden while native scrolling remains available', async ({ page }) => {
  await page.goto('/')
  for (const selector of ['.content-area', '.poster-row']) {
    const target = page.locator(selector).first()
    await expect(target).toBeVisible()
    expect(await target.evaluate(element => ({ standard: getComputedStyle(element).scrollbarWidth, webkit: getComputedStyle(element, '::-webkit-scrollbar').display }))).toEqual({ standard: 'none', webkit: 'none' })
  }
})

test('an expired account clears private shelves and pending responses before returning to guest browsing', async ({ page, request }) => {
  let release!: () => void
  let started!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const pending = new Promise<void>(resolve => { started = resolve })
  let delay = false
  const guestMethods: string[] = []
  let guest = false
  await page.route('**/api/rpc', async route => {
    const { method } = route.request().postDataJSON()
    if (guest) guestMethods.push(method)
    if (method === 'continueWatching' && delay) {
      const response = await route.fetch()
      started(); await gate
      await route.fulfill({ response })
    } else await route.continue()
  })
  await page.goto('/')
  await page.locator('[data-nav-id="nav-profile"]').click()
  await expect(page.getByLabel('Логин или e-mail')).toBeFocused()
  await page.getByLabel('Логин или e-mail').fill('demo@example.test')
  await page.getByLabel('Пароль', { exact: true }).fill('demo-only')
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Выйти из аккаунта', exact: true })).toBeVisible()
  await page.locator('[data-nav-id="nav-home"]').click()
  await expect(page.locator('[data-nav-id="continue-100"]')).toBeVisible()
  delay = true
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await pending
  await request.post('http://127.0.0.1:5174/api/rpc', { data: { method: 'logout', params: {} } })
  guest = true
  await page.locator('[data-nav-id="nav-profile"]').click()
  await expect(page.getByLabel('Логин или e-mail')).toBeFocused()
  release()
  await page.keyboard.press('Escape')
  await expect(page.locator('.section-heading h2')).toHaveText(['Новинки', 'Популярное'])
  await expect(page.locator('[data-nav-id="new-100"]')).toBeVisible()
  await expect(page.locator('[data-nav-id="continue-100"]')).toHaveCount(0)
  await expect(page.locator('[data-nav-id="nav-bookmarks"]')).toHaveCount(0)
  expect(guestMethods.filter(method => ['bookmarkLists', 'bookmarks', 'continueWatching', 'progress', 'saveProgress'].includes(method))).toEqual([])
})

test('login on Profile keeps Back pointed at the previous public catalog', async ({ page }) => {
  await page.goto('/')
  await page.locator('[data-nav-id="nav-series"]').click()
  await expect(page.locator('[data-nav-id="catalog-100"]')).toBeVisible()
  await page.locator('[data-nav-id="nav-profile"]').click()
  await expect(page.getByLabel('Логин или e-mail')).toBeFocused()
  await page.getByLabel('Логин или e-mail').fill('demo@example.test')
  await page.getByLabel('Пароль', { exact: true }).fill('demo-only')
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Выйти из аккаунта', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('heading', { name: 'Сериалы', exact: true })).toBeVisible()
  await expect(page.locator('[data-nav-id="catalog-100"]')).toBeVisible()
})

test('switching mirror on Profile discards old-origin Details history', async ({ page }) => {
  const calls: { method: string; params: Record<string, unknown> }[] = []
  let switched = false
  await page.route('**/api/rpc', async route => {
    const call = route.request().postDataJSON()
    if (call.method === 'configure') switched = true
    if (switched) calls.push(call)
    await route.continue()
  })
  await page.goto('/')
  await page.locator('[data-nav-id="new-200"]').click()
  await expect(page.locator('[data-nav-id="detail-play"]')).toBeEnabled()
  await page.locator('[data-nav-id="nav-profile"]').click()
  await expect(page.getByLabel('Логин или e-mail')).toBeFocused()
  await page.locator('.mirror-disclosure summary').click()
  await page.getByLabel('Адрес зеркала').fill('https://rezka.ag')
  await page.getByRole('button', { name: 'Сохранить зеркало', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Сохранить зеркало', exact: true })).toBeEnabled()
  await expect(page.getByRole('heading', { name: 'Профиль', exact: true })).toBeVisible()
  await expect(page.getByLabel('Адрес зеркала')).toHaveValue('https://rezka.ag')
  await page.keyboard.press('Escape')
  await expect(page.locator('.section-heading h2')).toHaveText(['Новинки', 'Популярное'])
  await expect(page.locator('[data-nav-id="new-200"]')).toBeVisible()
  expect(calls[0]).toEqual({ method: 'configure', params: { mirror: 'https://rezka.ag' } })
  expect(calls.filter(call => call.method === 'details')).toEqual([])
  expect(calls.filter(call => call.method === 'catalog')).toHaveLength(2)
  await expect(page.getByRole('alert')).toHaveCount(0)
})
