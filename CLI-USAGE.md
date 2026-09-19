# Luna 固定で ChatGPT に送信する

## 実行

PowerShell で次のように実行します。指定するのは送信先の名前と文章だけです。

```powershell
cd G:\creation\AiWorkSpace\chatgpt-cli
.\Send-ChatGPT.ps1 -To github -Message 'CLIからのテストです。受信しましたとだけ返してください。'
```

別のフォルダからでも使えます。

```powershell
& 'G:\creation\AiWorkSpace\chatgpt-cli\Send-ChatGPT.ps1' -To github -Message 'こんにちは'
```

複数行は PowerShell のヒアストリングで渡せます。

```powershell
$message = @'
AiWorkSpaceの状態を確認してください。
今回は読み取りだけでお願いします。
'@
.\Send-ChatGPT.ps1 -To github -Message $message
```

通常の文章はシングルクォートで囲むと、`$` などが PowerShell で展開されません。文中のシングルクォートは2つ重ねるか、上記のヒアストリングを使ってください。

## 送信先 JSON

`chatgpt-targets.json` に送信先を登録します。

```json
{
  "github": {
    "title": "GitHubアクセス確認",
    "threadId": "6aae4a91-41f8-83e8-be3f-43d231427920"
  }
}
```

`github` が `-To` に渡す名前です。現在は `github` と `consult`（Codexから相談呼び出し）を登録しています。会話名を変更した場合は JSON の title も更新してください。UTF-8 で保存します。

会話IDは ChatGPT の会話URLの `/c/` より後の部分です。対象のIDとタイトルは会話一覧などで確認して登録してください。入力した名前が存在しない場合、CLI を起動する前に停止します。

## 固定している設定

- 操作担当モデル：`gpt-5.6-luna`
- 推論量：`low`
- 作業フォルダ：このスクリプトがあるフォルダ
- ローカルのサンドボックス：read-only（外部の送信操作を禁止する設定ではありません）
- 送信先は既存会話のみ。送信先の回答モデルは変更しません。
- 文章は JSON にして標準入力で CLI に渡すため、本文をシェルコードとして実行しません。
- 送信は1回。返答は最大約2分を目安に確認するよう Codex に指示します。CLI 自体の実行時間の厳密なタイムアウトではありません。

## 必須条件と確認状況

Codex デスクトップを起動しておいてください。ブラウザや送信先のタブを開く必要はありません。CLI の実行時にデスクトップ同梱の公式 `codex_app` MCP サーバーを有効にし、読み取り・送信の2ツールだけを公開します。永続的な CLI 設定は変更しません。

アプリ内ターミナルでは接続先を環境変数から取得します。通常の PowerShell では `.chatgpt-bridge.json` に保存した接続先を使います。この PC の現在のアプリ接続先は設定済みです。このファイルは PC・アプリ起動状態に依存するため Git の対象から除外しています。

アプリ再起動後に接続エラーが出る場合は、Codex アプリ内ターミナルで次を実行するか、デスクトップのタスクに同じスクリプトの実行を依頼してください。

```powershell
& 'G:\creation\AiWorkSpace\chatgpt-cli\Initialize-ChatGPTBridge.ps1'
```

アプリを終了した状態では送信できません。接続可否をモデル起動前に確認し、接続できなければ停止します。アプリ更新で同梱 MCP の仕様が変わった場合は修正が必要になる可能性があります。

2026年9月19日、別の Luna CLI セッションから Astra 宛ての実送信に成功し、送信先の新しい返答も確認済みです。

`COMPLETED` と新しい返答が表示されたら成功です。`SUBMITTED_UNCONFIRMED` / `UNKNOWN` は送信されている可能性があるため、再実行する前に送信先を確認してください。`BUSY` は相手が回答中、`TARGET_ERROR` は会話の取得失敗やタイトル不一致です。これらはモデルが出す結果表示であり、OSの終了コードではありません。

同じ送信先への同時実行は避けてください。実行には Codex の利用枠を消費します。

## ローカル検証

`Test-SendChatGPT.ps1` はモデル実行部分をモックに置き換え、Luna 固定、標準入力経由の受け渡し、日本語・改行・引用符の保持、別フォルダからの JSON 読み込み、不正な送信先・空白本文の拒否を確認します。Windows PowerShell 5.1 でも成功済みです。CLI 接続設定の読み取りとアプリへの接続確認は行いますが、メッセージは送信しません。

