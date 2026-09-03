import { expect, test, type Page } from '@playwright/test';

async function addDestination(page: Page, name: string) {
  await page.getByLabel(/Search (San Francisco|Hyderabad)/u).fill(name);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page
    .getByRole('list', { name: 'Location matches' })
    .getByRole('button')
    .filter({ hasText: name })
    .first()
    .click();
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
}

async function addPriority(
  page: Page,
  options: {
    type: 'travel' | 'place';
    mode: 'bike' | 'walk' | 'car';
    category?: 'grocery' | 'school' | 'healthcare' | 'park' | 'cinema';
    minutes: number;
  },
) {
  await page.getByLabel('Priority type').selectOption(options.type);
  if (options.category) {
    await page.getByLabel('New priority place category').selectOption(options.category);
  }
  await page.getByLabel('New priority travel mode').selectOption(options.mode);
  await page.getByLabel('New priority minutes').fill(String(options.minutes));
  await page.getByRole('button', { name: 'Add priority', exact: true }).click();
}

test.describe('SweetSpot manual flow', () => {
  test('builds, edits, undoes, and shares a workspace', async ({ page, context }) => {
    test.setTimeout(150_000);
    await page.goto('/');
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: new URL(page.url()).origin,
    });
    await expect(
      page.getByRole('heading', { name: 'Find the neighborhood where your whole life fits.' }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Start planning in San Francisco' }).click();
    await expect(page).toHaveURL(/\/app\?city=sf$/u);
    await expect(page.getByRole('heading', { name: 'Where do you need to go?' })).toBeVisible();
    await expect(page.getByText('Try with ChatGPT')).toBeVisible();

    await addDestination(page, 'San Francisco City Hall');
    await addPriority(page, { type: 'travel', mode: 'car', minutes: 30 });
    await addPriority(page, { type: 'place', mode: 'walk', category: 'grocery', minutes: 10 });
    await addPriority(page, { type: 'place', mode: 'walk', category: 'park', minutes: 8 });
    await page.getByRole('button', { name: 'Find matching areas' }).click();
    await expect(page.getByTestId('candidate-list')).toBeVisible({ timeout: 45_000 });

    const travelInput = page.getByLabel(/Minutes for 30-minute drive to San Francisco City Hall/u);
    await page.getByRole('button', { name: 'Workspace', exact: true }).click();
    const activityCount = await page.locator('.activity-list li').count();
    await page.getByRole('button', { name: 'Close workspace options' }).click();
    await travelInput.fill('35');
    await travelInput.press('Enter');
    const updateButton = page
      .locator('.topbar-actions')
      .getByRole('button', { name: 'Update matching areas' });
    await expect(updateButton).toBeEnabled();
    await expect(page.getByRole('heading', { name: 'Results need updating' })).toBeVisible();
    await updateButton.click();
    await expect(page.getByTestId('candidate-list')).toBeVisible({ timeout: 30_000 });

    await page.getByRole('button', { name: 'Workspace', exact: true }).click();
    await expect(page.locator('.activity-list li')).toHaveCount(activityCount + 2);
    await page.getByRole('button', { name: 'Undo last change' }).click();
    await expect(
      page.locator('.activity-list').getByText(/Undid the most recent workspace change/u),
    ).toBeVisible();
    await expect(
      page.getByLabel(/Minutes for 30-minute drive to San Francisco City Hall/u),
    ).toHaveValue('30');

    await page.getByRole('button', { name: 'Share plan' }).click();
    await expect(page.getByText('Share link copied')).toBeVisible();
    const sharedUrl = await page.evaluate(() => navigator.clipboard.readText());
    expect(sharedUrl).toContain('#w=');
    await page.goto(sharedUrl);
    await expect(page.getByText('San Francisco City Hall', { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(
      page.locator('.topbar-actions').getByRole('button', { name: 'Update matching areas' }),
    ).toBeVisible();
    await expect(
      page.locator('.topbar-actions').getByRole('button', { name: 'Reset', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Matching areas' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
  });

  test('supports Hyderabad and multiple nearby-place categories', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/');
    await page.getByRole('button', { name: /Hyderabad India/u }).click();
    await page.getByRole('link', { name: 'Start planning in Hyderabad' }).click();

    await expect(page).toHaveURL(/\/app\?city=hyderabad$/u);
    await addDestination(page, 'Gachibowli');
    await addPriority(page, { type: 'place', mode: 'walk', category: 'school', minutes: 20 });
    await addPriority(page, { type: 'place', mode: 'bike', category: 'healthcare', minutes: 20 });
    await page.getByRole('button', { name: 'Find matching areas' }).click();
    await expect(page.getByText(/of Hyderabad fits your current priorities/u)).toBeVisible({
      timeout: 60_000,
    });
  });

  test('keeps prompt onboarding and manual controls available without native WebMCP', async ({
    page,
  }) => {
    await page.goto('/app?city=sf');
    await expect(page.getByText('Try with ChatGPT')).toBeVisible();
    await expect(page.getByLabel('Priority type')).toBeVisible();
    const workspaceButton = page.getByRole('button', { name: 'Workspace' });
    await workspaceButton.click();
    await expect(page.getByText(/browser assistant tools ready/u)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Close workspace options' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(workspaceButton).toBeFocused();
  });

  test('recovers when the dataset manifest fails to load once', async ({ page }) => {
    let shouldFail = true;
    await page.route('**/data/sf/metadata.json', async (route) => {
      if (shouldFail) {
        shouldFail = false;
        await route.abort('failed');
      } else {
        await route.continue();
      }
    });

    await page.goto('/app?city=sf');
    await expect(page.getByRole('button', { name: 'Retry data' })).toBeVisible();
    await page.getByRole('button', { name: 'Retry data' }).click();
    await expect(page.getByText('Search San Francisco')).toBeVisible({ timeout: 20_000 });
    await page.getByLabel('Search San Francisco').fill('San Francisco City Hall');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(
      page
        .getByRole('list', { name: 'Location matches' })
        .getByRole('button')
        .filter({ hasText: 'San Francisco City Hall' })
        .first(),
    ).toBeVisible();
  });
});
