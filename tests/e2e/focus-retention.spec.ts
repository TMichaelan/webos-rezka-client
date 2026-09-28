import { test, expect, type Page } from '@playwright/test'

const poster = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450"><path fill="#234b75" d="M0 0h300v450H0z"/></svg>')
const cards = Array.from({ length: 12 }, (_, index) => ({ id: String(200 + index), url: `https://hdrezka-home.tv/films/${200 + index}-test.html`, title: `Фильм ${index + 1}`, type: 'movie', poster }))

async function login(page: Page) {
  await page.goto('/')
  await page.locator('[data-nav-id="nav-profile"]').click()
  await expect(page.getByLabel('Логин или e-mail')).toBeFocused()
  await page.getByLabel('Логин или e-mail').fill('demo@example.test')
  await page.getByLabel('Пароль', { exact: true }).fill('demo-only')
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Выйти из аккаунта', exact: true })).toBeVisible()
  await page.locator('[data-nav-id="nav-home"]').click()
  await expect(page.locator('[data-nav-id="new-200"]')).toBeVisible()
}

test.beforeEach(async ({ request }) => { await request.post('http://127.0.0.1:5174/api/test/reset') })

test('a late Home shelf preserves the card and scroll already chosen by the user', async ({ page }) => {
  let release!: () => void
  let markStarted!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const started = new Promise<void>(resolve => { markStarted = resolve })
  await page.route('**/api/rpc', async route => {
    const { method, params } = route.request().postDataJSON()
    if (method !== 'catalog') { await route.continue(); return }
    if (params.sort === 'popular') { markStarted(); await gate }
    await route.fulfill({ json: { returnValue: true, result: { items: cards, page: 1, hasMore: false } } })
  })
  await login(page); await started
  const card = page.locator('[data-nav-id="new-208"]')
  await page.locator('[data-nav-id="new-207"]').evaluate(element => {
    element.focus({ preventScroll: true })
    element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })
  })
  await page.keyboard.press('ArrowRight')
  await expect(card).toBeFocused()
  const before = await card.evaluate(element => ({ vertical: element.closest('.content-area')!.scrollTop, horizontal: element.closest('.poster-row')!.scrollLeft }))
  expect(before.vertical).toBeGreaterThan(0)
  expect(before.horizontal).toBeGreaterThan(0)
  await expect(card).toBeFocused()
  release()
  await expect(page.locator('[data-nav-id="popular-200"]')).toBeVisible()
  await expect(page.locator('.loading-line')).toHaveCount(0)
  await expect(card).toBeFocused()
  const after = await card.evaluate(element => ({ vertical: element.closest('.content-area')!.scrollTop, horizontal: element.closest('.poster-row')!.scrollLeft }))
  expect(after).toEqual(before)
})

test('a real poster image cannot cover its visible keyboard focus border', async ({ page }) => {
  await page.route('**/api/rpc', async route => {
    if (route.request().postDataJSON().method !== 'catalog') { await route.continue(); return }
    await route.fulfill({ json: { returnValue: true, result: { items: cards, page: 1, hasMore: false } } })
  })
  await login(page)
  await expect(page.locator('.loading-line')).toHaveCount(0)
  const card = page.locator('[data-nav-id="new-200"]')
  await card.scrollIntoViewIfNeeded(); await card.focus()
  await expect.poll(() => card.locator('img').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true)
  await expect.poll(() => card.locator('.poster-image').evaluate(element => getComputedStyle(element, '::after').opacity)).toBe('1')
  const stacking = await card.locator('.poster-image').evaluate(element => ({ overlay: Number(getComputedStyle(element, '::after').zIndex) || 0, image: Number(getComputedStyle(element.querySelector('img')!).zIndex) || 0 }))
  expect(stacking.overlay).toBeGreaterThan(stacking.image)
})
