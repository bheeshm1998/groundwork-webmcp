import { expect, test } from '@playwright/test';

test.describe('SweetSpot manual flow', () => {
  test('builds, edits, undoes, and shares the sample workspace', async ({ page, context }) => {
    test.setTimeout(120_000);
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: 'http://127.0.0.1:4173',
    });
    await page.goto('/');
    await expect(
      page.getByRole('heading', { name: 'Find places that fit your preferences' }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Plan in San Francisco' }).click();
    await expect(page).toHaveURL(/\/app\?city=sf$/u);
    await expect(page.getByRole('heading', { name: 'Where do you need to go?' })).toBeVisible();
    await page.getByTestId('load-sample').click();
    await expect(page.getByTestId('candidate-list')).toBeVisible({ timeout: 45_000 });
    await expect(page.getByRole('button', { name: 'Change' })).toBeEnabled({
      timeout: 20_000,
    });

    const bikeInput = page.getByLabel(/Minutes for 25-minute bicycle area/u);
    await bikeInput.fill('30');
    await bikeInput.press('Enter');
    const updateButton = page
      .getByLabel('Plan setup')
      .getByRole('button', { name: 'Update matching areas' });
    await expect(updateButton).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Results need updating' })).toBeVisible();
    await updateButton.click();
    await expect(page.getByTestId('candidate-list')).toBeVisible({ timeout: 20_000 });

    await page.getByRole('button', { name: 'Workspace', exact: true }).click();
    await page.getByRole('button', { name: 'Undo last change' }).click();
    await expect(page.getByText(/Undid the most recent workspace change/u)).toBeVisible();
    await expect(page.getByLabel(/Minutes for 25-minute bicycle area/u)).toHaveValue('25');

    await page.getByRole('button', { name: 'Share plan' }).click();
    await expect(page.getByText('Share link copied')).toBeVisible();
    const sharedUrl = await page.evaluate(() => navigator.clipboard.readText());
    expect(sharedUrl).toContain('#w=');
    await page.goto(sharedUrl);
    await expect(page.getByText('San Francisco City Hall', { exact: true }).first()).toBeVisible({
      timeout: 20_000,
    });
    await page.getByRole('button', { name: 'Workspace', exact: true }).click();
    await expect(page.getByText('Your changes will appear here.')).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Close workspace options' }).click();

    await page.setViewportSize({ width: 800, height: 900 });
    await expect(page.getByRole('complementary', { name: 'Matching areas' })).toBeVisible();
    await expect(page.getByLabel('Interactive San Francisco analysis map')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      800,
    );
  });

  test('selects Hyderabad on the homepage and completes a local analysis', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto('/');
    await page.getByRole('button', { name: /Hyderabad India/u }).click();
    await page.getByRole('link', { name: 'Plan in Hyderabad' }).click();

    await expect(page).toHaveURL(/\/app\?city=hyderabad$/u);
    await expect(page.getByText('Search Hyderabad')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByLabel('Interactive Hyderabad analysis map')).toBeVisible();
    await page.getByTestId('load-sample').click();
    await expect(page.getByText('Ramanthapur', { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId('candidate-list')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/of Hyderabad fits your current priorities/u)).toBeVisible();
  });

  test('works without WebMCP support', async ({ page }) => {
    await page.goto('/app?city=sf');
    const workspaceButton = page.getByRole('button', { name: 'Workspace' });
    await workspaceButton.click();
    await expect(page.getByText(/Manual Mode/u)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Close workspace options' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(workspaceButton).toBeFocused();
    await workspaceButton.click();
    await page.getByRole('button', { name: 'Close workspace options' }).click();
    await page.getByTestId('load-sample').click();
    await expect(page.getByTestId('candidate-list')).toBeVisible({ timeout: 20_000 });
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
      page.getByRole('button', { name: /San Francisco City Hall Place/u }),
    ).toBeVisible();
  });
});
