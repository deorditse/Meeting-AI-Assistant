const { test, expect, expectChatAtBottom } = require('./fixture');

async function restore(app, channel = 'transcript:restore') {
  await app.emit(channel, { turns: app.meeting.transcript, chatHistory: app.history });
  await expect(app.page.locator('#messages .response-group')).toHaveCount(app.history.length);
  await expectChatAtBottom(app.page);
}

for (const { edge, dx, dy, width, height } of [
  { edge: 's', dx: 0, dy: -180, width: 1300, height: 420 },
  { edge: 'e', dx: -220, dy: 0, width: 1080, height: 600 },
  { edge: 'se', dx: -220, dy: -180, width: 1080, height: 420 }
]) {
  test(`resizing ${edge} preserves messages and pins the latest answer`, async ({ app }) => {
    const { page } = app;
    await restore(app);
    const original = await page.locator('#messages .response-group').allTextContents();
    const before = await page.locator('#messages').boundingBox();
    const handle = await page.locator(`[data-resize-edge="${edge}"]`).boundingBox();
    const start = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + dx, start.y + dy);
    await expect.poll(() => page.viewportSize()).toEqual({ width, height });
    await page.mouse.up();
    await expect.poll(() => app.saved.at(-1)).toMatchObject({ windowWidth: width - 600, windowHeight: height });
    expect(app.calls.filter((call) => call.channel === 'window:resize-start')).toHaveLength(1);
    expect(app.calls.filter((call) => call.channel === 'window:resize-end')).toHaveLength(1);
    await expectChatAtBottom(page);
    const after = await page.locator('#messages').boundingBox();
    if (dy) expect(after.height).toBeLessThan(before.height);
    if (dx) expect(after.width).toBeLessThan(before.width);
    expect(await page.locator('#messages .response-group').allTextContents()).toEqual(original);
    // Growing again must also preserve layout and reflow the same messages.
    await page.setViewportSize({ width: 1450, height: 800 });
    await expectChatAtBottom(page);
    expect(await page.locator('#messages .response-group').allTextContents()).toEqual(original);
  });
}

test('sending from a scrolled-up chat reveals the question and follows streaming text', async ({ app }) => {
  const { page } = app;
  await page.setViewportSize({ width: 1080, height: 420 });
  await restore(app);
  await page.locator('#messages').evaluate((element) => { element.scrollTop = 0; });
  await page.locator('#input').fill('A new typed question');
  await page.locator('#send-btn').click();
  await expect.poll(() => app.calls.find((call) => call.channel === 'ask')?.args[0]).toMatchObject({ text: 'A new typed question' });
  const question = page.locator('#messages .user-bubble').last();
  await expect(question).toHaveText('A new typed question');
  await expectChatAtBottom(page);
  const questionBox = await question.boundingBox();
  const chatBox = await page.locator('#messages').boundingBox();
  expect(questionBox.y).toBeGreaterThanOrEqual(chatBox.y);
  expect(questionBox.y + questionBox.height).toBeLessThanOrEqual(chatBox.y + chatBox.height);
  for (let i = 0; i < 8; i++) {
    await app.emit('llm:token', { text: `Streaming paragraph ${i}. ` + 'More response text. '.repeat(12) + '\n\n' });
    await expectChatAtBottom(page);
  }
  await app.emit('llm:done', {});
  await expect(page.locator('#stop-generation-btn')).toBeHidden();
  await expectChatAtBottom(page);
});

for (const channel of ['transcript:restore', 'transcript:replace']) {
  test(`${channel} restores ordered history and the latest answer at minimum size`, async ({ app }) => {
    await app.page.setViewportSize({ width: 1080, height: 420 });
    await restore(app, channel);
    await expect(app.page.locator('#messages .user-bubble')).toHaveText(app.history.map((item) => item.userBubble));
    await expect(app.page.locator('#messages .ai-text').last()).toHaveText(app.history.at(-1).assistantText.trim());
    // Replacing an existing history must not append duplicate messages.
    await restore(app, 'transcript:replace');
  });
}

test('resuming a saved session closes the dialog and restores scroll position', async ({ app }) => {
  const { page } = app;
  await page.locator('#sessions-btn').click();
  await expect(page.locator('#meetings-scrim')).toBeVisible();
  await page.locator('#meeting-detail').getByRole('button', { name: 'Продолжить сессию', exact: true }).click();
  await expect(page.locator('#meetings-scrim')).toBeHidden();
  await expect(page.locator('#messages .user-bubble')).toHaveText(app.history.map((item) => item.userBubble));
  await expectChatAtBottom(page);
  expect(app.calls.find((call) => call.channel === 'meetings:resume')?.args).toEqual([app.meeting.id]);
});
