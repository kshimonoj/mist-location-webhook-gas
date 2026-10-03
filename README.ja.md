# mist-location-webhook-gas

English version: [README.md](README.md)

**Mist の Location 系 Webhook** を Google Apps Script(GAS)で受信し、1イベント1行で Google Sheets に記録する。

用途は、**Location ペイロードの中身の確認**と、1サイトまたは複数サイトからの**簡易・短期のログ収集**。常時運用の受信サーバーではない(下記「制限事項」を参照)。

```
Mist(Site Webhook) --HTTP POST--> Apps Script ウェブアプリ --行を追記--> Google Sheets
```

## 対応トピックの例

| トピック | Mist portal の設定(Webhooks → Topics) |
|---|---|
| `location-client` | Wi-Fi Clients / **Connected** |
| `location-unclient` | Wi-Fi Clients / **Unconnected** |
| `location-asset` | X/Y Coordinates / **Named Assets** |
| `zone` | Entry/Exit Events / **Location Zone** または **Proximity Zone** |
| `vbeacon` | Entry/Exit Events / **Virtual Beacon** |

1回の POST に複数イベントが `events` 配列で入ることがある。スクリプトはイベントごとに1行書く。

## ペイロードのフィールド

スクリプトが列に割り当てるフィールドは下表のとおり。`Raw Event (JSON)` 列にはイベント全体をそのまま残すので、この表にない項目が届いていてもそこで確認できる。

| トピック | フィールド |
|---|---|
| `location-client` | `mac`, `map_id`, `rssi`, `site_id`, `timestamp`, `type`, `x`, `y`(**IP アドレスは含まれない**) |
| `location-unclient` | `location-client` と同じ構成(WLAN に接続していないクライアントの位置) |
| `location-asset` | `mac`, `map_id`, `site_id`, `timestamp`, `x`, `y`。名前を持つアセットでは名前系フィールド(`name` / `device_name`)も |
| `zone` | `zone_id`, `trigger`(enter / exit), `site_id`, `timestamp`。クライアントまたはアセットの識別子(`mac` / `id`)と `name` が付く場合がある |
| `vbeacon` | `vbeacon_id`, `trigger`(enter / exit), `site_id`, `timestamp`。クライアントまたはアセットの識別子と `name` が付く場合がある |

> 実ペイロードで確認済みなのは `location-client` のフィールド一覧のみ。他のトピックの正確なフィールドは、自分のシートの `Raw Event (JSON)` 列で確認すること。

データを使うときの注意点:

- **Location 系には IP アドレスが含まれない。** `location-client` のイベントは `mac` / `map_id` / `rssi` / `site_id` / `timestamp` / `type` / `x` / `y` だけ。
- **`x` / `y` の単位はメートル**で、ピクセルではない。マップ画像上に描画するには、`GET /api/v1/sites/{site_id}/maps` でマップを取得し、`width`(px)と `width_m`(m)から px/m を計算して変換する。
- **名前は Webhook に含まれない。** `zone_id` / `vbeacon_id` / `map_id` は UUID だけが届く。名前が必要なら REST API から取得し、ID で突き合わせる:
  - `GET /api/v1/sites/{site_id}/zones`
  - `GET /api/v1/sites/{site_id}/vbeacons`
  - `GET /api/v1/sites/{site_id}/maps`

### 配信間隔

1クライアントあたり約**60秒周期**で送られる。ただし送信は間引かれることがあり、実測では**2分間隔になるケースの方が多かった**。**60秒を「生存」判定の閾値に使うと誤判定する**(まだ居るのに「消えた」と判定される)。閾値は自環境で観測した間隔に余裕を持たせて決めること。

## セットアップ

1. **スプレッドシートを作成する。** [sheets.new](https://sheets.new/) を開く。
2. **スクリプトを貼る。** スプレッドシートの *拡張機能 → Apps Script* を開き、既定のコードを削除して [`apps-script/Code.gs`](apps-script/Code.gs) を貼り付ける。
3. **`SHARED_KEY` を変更する。** `CHANGE_ME` をランダムな文字列に置き換える。実際の値を公開リポジトリに入れないこと。
4. **動作確認する。** 関数プルダウンで `testWithDummyData` を選んで実行する(初回は権限を承認)。ヘッダー行とダミー1行を持つ `MistWebhookRaw` シートが作られる。
5. **ウェブアプリとしてデプロイする。** *デプロイ → 新しいデプロイ → ウェブアプリ*。次のユーザーとして実行: **自分**、アクセスできるユーザー: **全員**(Mist は Google の認証情報を送らないため)。発行された URL(`https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec`)をコピーする。
6. **Mist portal で Webhook を作成する。** **Site レベル**の Webhook を作る(Organization → Site Configuration → 対象サイト → Webhooks、タイプは HTTP POST)。Target URL に、ウェブアプリの URL へ `?key=` を付けたものを設定する:

   ```
   https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec?key=<SHARED_KEY>
   ```

   *Add Webhook* ダイアログで Target URL を入力し、必要な Location 系トピックを選ぶ(「対応トピック」を参照)。下のスクリーンショットは、Wi-Fi 端末の位置に必要なトピックだけを有効にした状態:

   ![Add Webhook ダイアログ(Location 系トピックを選択した状態)](docs/images/webhook-settings.png)

7. `MistWebhookRaw` シートに行が追加されることを確認する。

### トピックの絞り込み

用途に必要なトピックだけを有効にする。有効にしたトピックの分だけ受信数が増え、受信1回ごとに Apps Script の実行時間クォータを消費する。

- Wi-Fi 端末の位置を見るのが目的なら、`Connected` / `Unconnected` / `Location Zone` / `Proximity Zone` で足りる。
- BLE タグ(`Named Assets`)や `SDK Clients` は、不要なら外しておく。

### 複数サイトの扱い

Location 系の Webhook は Organization ではなく **Site Configuration** 配下に作成する。複数サイトから受けたい場合は、サイトの数だけ Webhook が必要になる。Target URL はすべて同じでよい(デプロイは1つで全サイトを受けられる)ので、`&label=` に人間が読める名前を付けて区別する:

```
https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec?key=<SHARED_KEY>&label=SiteA
```

`Site Label` 列は、次の順で決まる: URL の `label` パラメータ → `Code.gs` の `SITE_LABELS`(`site_id` → 名前)→ site_id そのもの。

### コードを更新するとき

コードを差し替えたら、**デプロイ → デプロイを管理 → 編集(鉛筆) → バージョン: 新バージョン → デプロイ** を使う。「新しいデプロイ」は選ばないこと。URL が変わり、Mist に設定済みの Webhook をすべて直す必要が出る。

## シートの出力例

シートは15列で、時刻は JST(`Asia/Tokyo`)。以下の値はすべて架空。

| Received At (JST) | Site Label | Topic | Event Index | Client Type | Client ID / MAC | Name | Trigger | Zone / vBeacon ID | Site ID | Map ID | X | Y | Event Time (JST) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2026-10-02 16:30:01 | Site A | location-client | 0 | wifi | 001122334455 | | | | 11111111-1111-1111-1111-111111111111 | 22222222-2222-2222-2222-222222222222 | 12.34 | 56.78 | 2026-10-02 16:29:36 |
| 2026-10-02 16:30:03 | Site A | location-asset | 0 | | aabbccddeeff | Sample Tag A | | | 11111111-1111-1111-1111-111111111111 | 22222222-2222-2222-2222-222222222222 | 3.5 | 8.25 | 2026-10-02 16:30:00 |
| 2026-10-02 16:30:31 | Site A | zone | 0 | | 001122334466 | | enter | 33333333-3333-3333-3333-333333333333 | 11111111-1111-1111-1111-111111111111 | | | | 2026-10-02 16:30:30 |

15列目の `Raw Event (JSON)` には受信したイベントがそのまま入る。例:

```json
{"mac":"001122334455","map_id":"22222222-2222-2222-2222-222222222222","rssi":-60,"site_id":"11111111-1111-1111-1111-111111111111","timestamp":1790926176,"type":"wifi","x":12.34,"y":56.78}
```

空欄は、ペイロードにそのフィールドが無かったことを示す。

## 制限事項

- **署名検証はできない。** GAS では受信ヘッダを参照できないため、`X-Mist-Signature` 系の検証は不可能。認証は URL パラメータの共有キーだけ。URL を知っていれば誰でも行を書き込めるので、URL は秘密として扱うこと。
- **`MAX_ROWS` が止めるのは書き込みで、リクエストではない。** シートが `MAX_ROWS` に達すると行の追記は止まるが、`doPost` 自体は Webhook のたびに呼ばれ続けるため、Apps Script の実行時間クォータは消費される。**確認が終わったら、Mist 側で Webhook を無効化すること。**
- **常時運用には向かない。** Location 系トピックは全クライアント分のイベントを継続的に送る。継続運用するなら、受信サーバーを別に用意する方が適している。

## ファイル

| パス | 説明 |
|---|---|
| [`apps-script/Code.gs`](apps-script/Code.gs) | Apps Script 本体。サイト・トピック別の行数を出す `summarizeBySite`、`testWithDummyData`、`resetSheet` も含む |
| [`.githooks/pre-commit`](.githooks/pre-commit) | 実データらしい UUID・MAC・デプロイ URL・トークンを含むコミットをブロックするシークレットスキャン(`git config core.hooksPath .githooks`) |

## ライセンス

[MIT](LICENSE)
