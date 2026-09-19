// Codex の functions.exec 用。ブラウザ不要。Node.js 単体では実行できません。
// 最後の REQUEST を変更して実行します。初期値は読み取りのみです。
async function chatgptDirect(api, request) {
  const { action, threadId, message } = request;
  if (!['read', 'send'].includes(action)) throw new Error('action は read または send です。');
  if (typeof threadId !== 'string' || !threadId.trim()) throw new Error('threadId が必要です。');
  if (typeof api.mcp__codex_app__read_thread !== 'function') {
    throw new Error('このセッションには会話を読むツールがありません。Codex デスクトップの対応環境で実行してください。');
  }
  if (action === 'send' && (typeof message !== 'string' || !message.trim())) {
    throw new Error('送信する message が必要です。');
  }
  if (action === 'send' && typeof api.mcp__codex_app__send_message_to_thread !== 'function') {
    throw new Error('このセッションには会話へ送信するツールがありません。');
  }
  const before = await api.mcp__codex_app__read_thread({
    threadId, turnLimit: 1, maxOutputCharsPerItem: 6000,
  });
  if (before.isError) throw new Error(JSON.stringify(before));
  if (action === 'read') return before;

  // 送信は一度だけ。通信エラー時も勝手に再送しない。
  const result = await api.mcp__codex_app__send_message_to_thread({ threadId, prompt: message });
  if (result.isError) throw new Error(JSON.stringify(result));
  return {
    status: 'submitted', threadId, result,
    next: '受付済みです。回答完了は未確認です。action: read で後から確認してください。自動再送はしません。',
  };
}

const REQUEST = {
  action: 'read',
  threadId: '6aae4a91-41f8-83e8-be3f-43d231427920',
  // action: 'send' にする場合、ユーザーが送信を依頼した文章を指定してください。
  message: '',
};

text(await chatgptDirect(tools, REQUEST));
