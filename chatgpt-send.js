// Codex の cua_repl 内で実行するスクリプトです。Node.js 単体では動きません。
// TARGET_URL と MESSAGE を変更して使用してください。
// 最後の click() で、実際に ChatGPT にメッセージが送信されます。
{
  const TARGET_URL = 'https://chatgpt.com/c/6aae4a91-41f8-83e8-be3f-43d231427920';
  const MESSAGE = 'GitHub 連携ツールを使って tonakamaru/AiWorkSpace にアクセスできるか確認してください。読み取り確認のみで、ファイルの作成や変更は不要です。';

  if (!MESSAGE.trim()) throw new Error('送信する文章が空です。');

  // 開いているタブだけを対象にする。別の会話やアカウントには送信しない。
  const state = await cua.getState();
  const matches = state.browsers.flatMap(browser =>
    browser.tabs
      .filter(tab => tab.url === TARGET_URL)
      .map(tab => ({ browserId: browser.id, tabId: tab.id }))
  );
  if (matches.length !== 1) {
    throw new Error(`対象タブが ${matches.length} 個あります。送信先の会話を1つだけ開いてください。`);
  }

  const target = matches[0];
  const tab = await cua.getTab(target.tabId, { browser: target.browserId });
  // DOM を確認してから、その画面の入力欄と送信ボタンを操作する。
  const snapshot = await tab.playwright.domSnapshot();
  if (!snapshot.includes('ChatGPT とチャットする')) {
    throw new Error('ChatGPT の入力欄を確認できません。画面を確認してください。');
  }
  const composer = tab.playwright.locator('#prompt-textarea');
  const submit = tab.playwright.locator('#composer-submit-button');
  if (await composer.count() !== 1 || await submit.count() !== 1) {
    throw new Error('画面構造が変わっています。入力欄と送信ボタンを再確認してください。');
  }
  if ((await composer.innerText()).trim()) {
    throw new Error('入力途中の文章があります。上書きせず停止しました。');
  }
  if (await submit.getAttribute('aria-label') === '回答を停止') {
    throw new Error('ChatGPT が回答中です。回答が終わってから実行してください。');
  }

  await composer.fill(MESSAGE);
  await tab.getAXState();
  if (await submit.getAttribute('aria-label') !== 'プロンプトを送信する' ||
      !await submit.isEnabled()) {
    throw new Error('送信ボタンが使用できません。文章は下書きとして残っています。');
  }

  // 二重送信を避けるため、送信操作は1回だけ。失敗時も自動再試行しない。
  await submit.click();
  await tab.getAXState();
  if ((await composer.innerText()).trim()) {
    throw new Error('送信完了を確認できません。再実行する前に会話を確認してください。');
  }
  nodeRepl.write('送信操作が完了し、入力欄が空になったことを確認しました。回答は会話画面で確認してください。');
}
