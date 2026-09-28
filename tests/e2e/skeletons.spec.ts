import { test, expect, type Page, type Locator } from '@playwright/test'

const backend = 'http://127.0.0.1:5174'
const focusable = 'button, a[href], input, select, textarea, summary, [tabindex], [contenteditable="true"]'
async function delayRpc(page: Page, method: string, fail = false) {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/rpc', async route => {
    if (route.request().postDataJSON().method !== method) return route.fallback()
    await gate
    if (fail) await route.fulfill({ json: { returnValue: false, errorCode: 'TEST_FAILURE', errorText: 'Delayed request failed' } })
    else await route.continue()
  })
  return release
}
async function checkSkeleton(page: Page, kind: string): Promise<Locator> {
  const skeleton = page.locator(`[data-skeleton="${kind}"]`).first()
  await expect(skeleton).toBeVisible()
  await expect(skeleton).toHaveAttribute('aria-hidden', 'true')
  await expect(skeleton.locator(focusable)).toHaveCount(0)
  await expect(page.locator('.spinner:visible')).toHaveCount(0)
  await expect(skeleton.locator('.skeleton-block').first()).toBeVisible()
  return skeleton
}
async function login(page: Page) {
  await page.locator('[data-nav-id="nav-profile"]').click()
  await expect(page.getByLabel('Логин или e-mail')).toBeFocused()
  await page.getByLabel('Логин или e-mail').fill('demo@example.test')
  await page.getByLabel('Пароль', { exact: true }).fill('demo-only')
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Выйти из аккаунта', exact: true })).toBeVisible()
  await page.locator('[data-nav-id="nav-home"]').click()
  await expect(page.locator('[data-nav-id="continue-100"]')).toBeVisible()
}

test.beforeEach(async ({ request }) => { await request.post(backend + '/api/test/reset') })

for (const fail of [false, true]) {
  for (const kind of ['boot', 'shelves', 'grid', 'details', 'profile']) {
    test(`${kind} skeleton reserves geometry until ${fail ? 'error' : 'success'}`, async ({ page }) => {
      if (kind !== 'boot' && kind !== 'shelves') {
        await page.goto('/')
        await expect(page.locator('[data-nav-id="new-200"]')).toBeVisible()
      }
      if (kind === 'profile') await login(page)
      const method = kind === 'boot' || kind === 'profile' ? 'status' : kind === 'details' ? 'details' : 'catalog'
      const release = await delayRpc(page, method, fail)
      if (kind === 'boot' || kind === 'shelves') await page.goto('/')
      if (kind === 'grid') await page.locator('[data-nav-id="nav-series"]').click()
      if (kind === 'details') await page.locator('[data-nav-id="new-200"]').click()
      if (kind === 'profile') await page.locator('[data-nav-id="nav-profile"]').click()
      const skeleton = await checkSkeleton(page, kind)
      if (kind === 'shelves' || kind === 'grid') {
        const poster = await skeleton.locator('.poster-image').first().boundingBox()
        expect(poster!.height / poster!.width).toBeCloseTo(1.5, 1)
        expect(await skeleton.locator('.poster-image').count()).toBeGreaterThanOrEqual(6)
      }
      if (kind === 'details') await expect(skeleton.locator('.detail-artwork')).toBeVisible()
      if (kind === 'profile') await expect(skeleton.locator('.profile-avatar')).toBeVisible()
      if (kind === 'boot') {
        await expect(skeleton.locator('img')).toBeVisible()
        await expect(skeleton.locator('.skeleton-block')).toHaveCount(2)
        await expect(page.locator('.sidebar, .login-form')).toHaveCount(0)
      }
      release()
      await expect(page.locator(`[data-skeleton="${kind}"]`)).toHaveCount(0)
      if (fail) await expect(page.getByRole('alert').first()).toContainText('Delayed request failed')
      else if (kind === 'details') await expect(page.locator('[data-nav-id="detail-play"]')).toBeVisible()
      else if (kind === 'profile') await expect(page.getByRole('heading', { name: 'Локальный тест', exact: true })).toBeVisible()
      else await expect(page.locator('.poster-card').first()).toBeVisible()
    })
  }
}

test('reduced motion keeps all loading shapes static', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const release = await delayRpc(page, 'status')
  await page.goto('/')
  const skeleton = await checkSkeleton(page, 'boot')
  expect(await skeleton.locator('.skeleton-block').evaluateAll(shapes => shapes.every(shape => getComputedStyle(shape).animationName === 'none'))).toBe(true)
  release()
})

test('player loading surface clears on native ready and never masks playback errors', async ({ page }) => {
  await page.goto('/')
  await page.locator('[data-nav-id="new-200"]').click()
  await expect(page.locator('[data-nav-id="detail-play"]')).toBeEnabled()
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/test-video*', async route => { await gate; await route.continue() })
  await page.locator('[data-nav-id="detail-play"]').click()
  const skeleton = await checkSkeleton(page, 'player')
  await expect(skeleton.locator('.skeleton-timeline')).toBeVisible()
  await expect(skeleton.locator('.skeleton-player-actions')).toBeVisible()
  await expect(page.locator('video')).toBeAttached()
  await page.locator('video').dispatchEvent('error', { bubbles: false })
  await page.locator('video').dispatchEvent('waiting')
  await expect(page.locator('.player-error')).toBeVisible()
  await expect(skeleton).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Повторить загрузку', exact: true })).toBeFocused()
  await page.keyboard.press('Enter')
  release()
  await expect(skeleton).toHaveCount(0)
  await expect.poll(() => page.locator('video').evaluate(v => (v as HTMLVideoElement).paused)).toBe(false)
  await expect(page.locator('.player-error')).toHaveCount(0)
})

for (const fail of [false, true]) {
  test(`player loading yields to ${fail ? 'progress error' : 'resume'} dialog`, async ({ page }) => {
    await page.goto('/')
    await login(page)
    await page.locator('[data-nav-id="continue-100"]').click()
    const release = await delayRpc(page, 'progress', fail)
    await page.locator('[data-nav-id="detail-play"]').click()
    await checkSkeleton(page, 'player')
    release()
    await expect(page.locator(fail ? '[data-progress-error]' : '[data-resume-dialog]')).toBeVisible()
    await page.locator('video').dispatchEvent('waiting')
    await expect(page.locator('[data-skeleton="player"]')).toHaveCount(0)
    await expect(page.getByRole('dialog').getByRole('button').first()).toBeFocused()
  })
}

for (const origin of ['Home', 'Catalog']) {
  test(`Bookmarks shows its skeleton during the list request from ${origin}`, async ({ page }) => {
    await page.goto('/')
    await login(page)
    if (origin === 'Catalog') {
      await page.locator('[data-nav-id="nav-series"]').click()
      await expect(page.locator('[data-nav-id="catalog-100"]')).toBeVisible()
    }
    const release = await delayRpc(page, 'bookmarkLists')
    await page.locator('[data-nav-id="nav-bookmarks"]').click()
    await expect(page.locator('.poster-grid .poster-card')).toHaveCount(0)
    await expect(page.getByText('Ничего не найдено', { exact: true })).toHaveCount(0)
    await checkSkeleton(page, 'grid')
    release()
    await expect(page.locator('[data-skeleton="grid"]')).toHaveCount(0)
    await expect(page.locator('.poster-grid .poster-card').first()).toBeVisible()
  })
}


test('failed bootstrap keeps public requests behind a focused connection retry', async ({ page }) => {
  const methods: string[] = []
  let fail = true
  await page.route('**/api/rpc', async route => {
    const method = route.request().postDataJSON().method
    methods.push(method)
    if (method === 'status' && fail) return route.fulfill({ json: { returnValue: false, errorCode: 'NETWORK', errorText: 'Нет соединения' } })
    await route.continue()
  })
  await page.goto('/')
  await expect(page.getByRole('alert')).toContainText('Нет соединения')
  await expect(page.locator('.sidebar, .login-form')).toHaveCount(0)
  const retry = page.getByRole('button', { name: 'Повторить соединение', exact: true })
  await expect(retry).toBeFocused()
  expect(await retry.evaluate(button => getComputedStyle(button).outlineStyle)).toBe('solid')
  expect(methods).toEqual(['status'])
  fail = false
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-nav-id="new-200"]')).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(methods).toContain('catalog')
})

for (const phase of ['loading', 'error']) {
  test(`Profile connection retry owns Back during ${phase} and preserves its public history`, async ({ page }) => {
    const methods: string[] = []
    let retrying = false
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    await page.route('**/api/rpc', async route => {
      const method = route.request().postDataJSON().method
      if (retrying) methods.push(method)
      if (method === 'status' && retrying) {
        await gate
        return route.fulfill({ json: { returnValue: false, errorCode: 'NETWORK', errorText: 'Повторное соединение недоступно' } })
      }
      await route.continue()
    })
    await page.goto('/')
    await expect(page.locator('[data-nav-id="new-200"]')).toBeVisible()
    await page.locator('[data-nav-id="nav-profile"]').click()
    await expect(page.getByLabel('Логин или e-mail')).toBeFocused()
    await page.locator('.mirror-disclosure summary').click()
    retrying = true
    await page.getByRole('button', { name: 'Повторить соединение', exact: true }).click()
    await expect(page.locator('[data-skeleton="boot"]')).toBeVisible()
    if (phase === 'error') {
      release()
      await expect(page.getByRole('alert')).toContainText('Повторное соединение недоступно')
    }
    await page.keyboard.press('Escape')
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    expect(methods).toEqual(['status'])
    await expect(page.locator('.sidebar, .login-form')).toHaveCount(0)
    release()
    await expect(page.getByRole('alert')).toContainText('Повторное соединение недоступно')
    retrying = false
    await page.getByRole('button', { name: 'Повторить соединение', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Профиль', exact: true })).toBeVisible()
    await expect(page.getByLabel('Логин или e-mail')).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page.locator('.section-heading h2')).toHaveText(['Новинки', 'Популярное'])
  })
}


test('poster shelf reserves final title and metadata line heights', async ({ page }) => {
  const release = await delayRpc(page, 'catalog')
  await page.goto('/')
  await checkSkeleton(page, 'shelves')
  const before = await page.locator('.shelf').first().boundingBox()
  release()
  await expect(page.locator('[data-nav-id="new-200"]')).toBeVisible()
  const after = await page.locator('.shelf').first().boundingBox()
  expect(Math.abs(after!.height - before!.height)).toBeLessThanOrEqual(1)
})

test('player keeps the placeholder until a first frame on startup and paused quality change', async ({ page }) => {
  await page.addInitScript(() => {
    const state = window as typeof window & { blockFrame: boolean }
    state.blockFrame = true
    const readyState = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'readyState')!
    Object.defineProperty(HTMLMediaElement.prototype, 'readyState', { configurable: true, get() { return state.blockFrame ? 1 : readyState.get!.call(this) } })
    document.addEventListener('loadedmetadata', event => { const media = event.target as HTMLVideoElement; media.dataset.metadata = String(Number(media.dataset.metadata || 0) + 1) }, true)
    for (const type of ['loadeddata', 'canplay', 'playing']) document.addEventListener(type, event => { if (state.blockFrame) event.stopImmediatePropagation() }, true)
  })
  await page.goto('/')
  await page.locator('[data-nav-id="new-200"]').click()
  await page.locator('[data-nav-id="detail-play"]').click()
  const video = page.locator('video')
  await expect(video).toHaveAttribute('data-metadata', '1')
  await expect(page.locator('[data-skeleton="player"]')).toBeVisible()
  await video.evaluate(media => { (window as typeof window & { blockFrame: boolean }).blockFrame = false; media.dispatchEvent(new Event('loadeddata')) })
  await expect(page.locator('[data-skeleton="player"]')).toHaveCount(0)
  await video.evaluate(media => (media as HTMLVideoElement).pause())
  await page.evaluate(() => { (window as typeof window & { blockFrame: boolean }).blockFrame = true })
  await page.getByRole('combobox', { name: 'Качество', exact: true }).click()
  await page.locator('[role="option"][data-value="360p"]').click()
  await expect(video).toHaveAttribute('data-metadata', '2')
  await expect(page.locator('[data-skeleton="player"]')).toBeVisible()
  await video.evaluate(media => { (window as typeof window & { blockFrame: boolean }).blockFrame = false; media.dispatchEvent(new Event('canplay')) })
  await expect(page.locator('[data-skeleton="player"]')).toHaveCount(0)
  expect(await video.evaluate(media => (media as HTMLVideoElement).paused)).toBe(true)
})
