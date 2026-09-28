import { test, expect, type Page } from '@playwright/test'
const backend = 'http://127.0.0.1:5174'
async function login(page: Page) {
  await page.locator('[data-nav-id="nav-profile"]').click()
  await expect(page.getByLabel('Логин или e-mail')).toBeFocused()
  await page.getByLabel('Логин или e-mail').fill('demo@example.test')
  await page.getByLabel('Пароль', { exact: true }).fill('demo-only')
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Выйти из аккаунта', exact: true })).toBeVisible()
}
test.beforeEach(async ({ request }) => { await request.post(backend + '/api/test/reset') })

test('expired Bookmarks refresh deduplicates status recovery and removes private state', async ({ page, request }) => {
  const methods: string[] = []
  let expired = false
  await page.route('**/api/rpc', async route => {
    if (expired) methods.push(route.request().postDataJSON().method)
    await route.continue()
  })
  await page.goto('/')
  await login(page)
  await page.locator('[data-nav-id="nav-bookmarks"]').click()
  await expect(page.locator('[data-nav-id="bookmarks-100"]')).toBeVisible()
  await request.post(backend + '/api/rpc', { data: { method: 'logout', params: {} } })
  expired = true
  await page.getByRole('combobox', { name: 'Список аккаунта', exact: true }).click()
  await page.getByRole('option', { name: /Избранное/ }).click()
  await expect(page.locator('[data-nav-id="nav-bookmarks"], [data-nav-id="bookmarks-100"]')).toHaveCount(0)
  await expect(page.locator('.section-heading h2')).toHaveText(['Новинки', 'Популярное'])
  await expect(page.locator('[data-nav-id="new-200"]')).toBeVisible()
  expect(methods.filter(method => method === 'status')).toHaveLength(1)
  await expect(page.locator('[data-nav-id="nav-profile"]')).toHaveAccessibleName('Профиль, войти в аккаунт')
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-nav-id="bookmarks-100"]')).toHaveCount(0)
})

test('expired player save settles before guest recovery and leaves no pending replay', async ({ page, request }) => {
  const saves: unknown[] = []
  await page.route('**/api/rpc', async route => {
    const call = route.request().postDataJSON()
    if (call.method === 'saveProgress') saves.push(call.params)
    await route.continue()
  })
  await page.goto('/')
  await login(page)
  await page.locator('[data-nav-id="nav-home"]').click()
  await page.locator('[data-nav-id="new-200"]').click()
  await page.locator('[data-nav-id="detail-play"]').click()
  await expect.poll(() => page.locator('video').evaluate(video => !(video as HTMLVideoElement).paused)).toBe(true)
  await request.post(backend + '/api/rpc', { data: { method: 'logout', params: {} } })
  await page.locator('video').evaluate(video => (video as HTMLVideoElement).pause())
  await expect(page.locator('.player, [data-nav-id="nav-bookmarks"]')).toHaveCount(0)
  await expect(page.locator('.section-heading h2')).toHaveText(['Новинки', 'Популярное'])
  expect(saves).toHaveLength(1)
  expect(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('rezka.pending.')))).toEqual([])
  await login(page)
  expect(saves).toHaveLength(1)
  expect((await (await request.get(backend + '/api/test/state')).json()).saves).toEqual([])
})

test('parallel expired private shelves share one in-flight status refresh', async ({ page, request }) => {
  let expired = false
  let statusReads = 0
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/rpc', async route => {
    if (expired && route.request().postDataJSON().method === 'status') { statusReads++; await gate }
    await route.continue()
  })
  await page.goto('/')
  await login(page)
  await request.post(backend + '/api/rpc', { data: { method: 'logout', params: {} } })
  expired = true
  await page.locator('[data-nav-id="nav-home"]').click()
  await expect(page.locator('.shelf [role="alert"]')).toHaveCount(2)
  expect(statusReads).toBe(1)
  release()
  await expect(page.locator('[data-nav-id="nav-bookmarks"]')).toHaveCount(0)
  await expect(page.locator('.section-heading h2')).toHaveText(['Новинки', 'Популярное'])
})

test('failed status recovery removes a private modal and focuses connection Retry', async ({ page, request }) => {
  let failedStatus = false
  const methods: string[] = []
  await page.route('**/api/rpc', async route => {
    const method = route.request().postDataJSON().method
    if (failedStatus) methods.push(method)
    if (failedStatus && method === 'status') return route.fulfill({ json: { returnValue: false, errorCode: 'NETWORK_ERROR', errorText: 'Проверка сессии недоступна' } })
    await route.continue()
  })
  await page.goto('/')
  await login(page)
  await page.locator('[data-nav-id="nav-home"]').click()
  await page.locator('[data-nav-id="new-200"]').click()
  await page.locator('[data-nav-id="detail-bookmark"]').click()
  await expect(page.getByRole('button', { name: 'Добавить', exact: true })).toBeEnabled()
  await request.post(backend + '/api/rpc', { data: { method: 'logout', params: {} } })
  failedStatus = true
  await page.getByRole('button', { name: 'Добавить', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Нет соединения', exact: true })).toBeVisible()
  await expect(page.locator('.modal-backdrop, .sidebar, .player')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Повторить соединение', exact: true })).toBeFocused()
  expect(methods).toEqual(['setBookmark', 'status'])
  failedStatus = false
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-nav-id="new-200"]')).toBeVisible()
  await expect(page.locator('[data-nav-id="nav-bookmarks"]')).toHaveCount(0)
})
