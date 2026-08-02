# DualSense Input Inspector

PS5用DualSenseが送信する入力値を、Chrome / EdgeのWebHIDから直接取得して一覧表示するGitHub Pages向けツールです。

現在確認済みの環境は、Windows PCとDualSenseのBluetooth接続です。

## 表示する値

- 左右スティックのX・Y軸
  - 正規化値 `-1.000～+1.000`
  - 元の8 bit値 `0～255`
- L2 / R2
  - 正規化値 `0.000～1.000`
  - 元の8 bit値 `0～255`
- 十字キー8方向
- Square / Cross / Circle / Triangle
- L1 / R1
- L2 / R2のデジタル押下
- Create / Options
- L3 / R3
- PS / タッチパッド押し込み / Mute
- タッチパッド2点
  - 接触状態
  - Contact ID
  - X / Y座標
- ジャイロ3軸のraw値
- 加速度3軸のraw値
- シーケンス番号
- センサタイムスタンプ
- バッテリー状態raw値と推定残量
- Report ID、payload長、受信レート
- 入力レポート全バイト

## 使い方

1. DualSenseをWindowsへBluetooth接続します。
2. GitHub PagesをChromeまたはEdgeで開きます。
3. `DualSenseへ接続`を押します。
4. デバイス選択画面で`Wireless Controller`を選択します。
5. 入力レポートが`0x31 / 77 bytes`になったことを確認します。
6. コントローラを操作して各表示を確認します。

一度WebHIDアクセスを許可したデバイスは、次回以降ページを開いた際に自動再接続を試みます。

# 技術的な要点

## 1. WebHIDでの接続手順

DualSenseのVendor IDとProduct IDを指定して、WebHIDのデバイス選択画面を開きます。

```javascript
const devices = await navigator.hid.requestDevice({
  filters: [
    {
      vendorId: 0x054c,
      productId: 0x0ce6,
    },
  ],
});
```

選択されたデバイスを開き、`inputreport`イベントを登録します。

```javascript
const device = devices[0];

if (!device.opened) {
  await device.open();
}

device.addEventListener("inputreport", handleInputReport);
```

以後、DualSenseから新しいHID入力レポートが到着するたびに、`handleInputReport()`が呼ばれます。

## 2. 入力レポートを受け取る方法

WebHIDでは、Report IDとその後ろのpayloadが分離されています。

```javascript
function handleInputReport(event) {
  const reportId = event.reportId;
  const payload = event.data;
}
```

- `event.reportId`：HID Report ID
- `event.data`：Report IDを除いたpayload
- `event.data`の型：`DataView`

重要なのは、README内のoffsetはすべて**Report IDを除いた`event.data`先頭を0番とした位置**だという点です。

実際のBluetoothパケット全体では先頭にReport ID `0x31`がありますが、WebHIDの`event.data.getUint8(0)`にはReport IDは入りません。

```text
実際のHIDレポート全体
┌──────────────┬───────────────────────────────┐
│ Report ID    │ payload                       │
│ 0x31         │ byte 0, byte 1, ... byte 76   │
└──────────────┴───────────────────────────────┘

WebHIDイベント
reportId = 0x31
data[0]  = payload byte 0
data[1]  = payload byte 1
...
data[76] = payload byte 76
```

## 3. Bluetooth拡張入力を開始する方法

DualSenseはBluetooth接続直後、スティックと一部ボタンだけを含む基本入力レポート`0x01`を送る場合があります。

基本入力では、タッチパッド、ジャイロ、加速度などの情報を取得できません。

そこで接続後にFeature Report `0x05`を読み取ります。

```javascript
await device.receiveFeatureReport(0x05);
```

これにより、DualSenseへBluetooth拡張入力モードの開始を要求します。

成功すると、入力レポートは次の形式になります。

```text
Report ID : 0x31
payload   : 77 bytes
```

環境差へのフォールバックとして、CRC32付きBluetooth出力レポート`0x31`も送信します。この出力レポートは振動やLEDを動作させないゼロ指令です。

## 4. 受信処理の全体フロー

```text
ページを開く
  ↓
navigator.hid.requestDevice()
  ↓
device.open()
  ↓
inputreportイベントを登録
  ↓
receiveFeatureReport(0x05)
  ↓
Bluetooth拡張入力0x31の送信開始
  ↓
handleInputReport(event)
  ↓
reportIdとpayload長を確認
  ↓
payload内の各offsetを解析
  ↓
スティック・ボタン・タッチ・IMU・バッテリーを画面表示
```

# 入力レポート構造

## 5. Bluetooth `0x31 / 77 bytes`の配置

以下のoffsetは、WebHIDの`event.data`内の位置です。

| payload offset | byte数 | 内容 | データ形式 |
|---:|---:|---|---|
| 0 | 1 | Bluetooth側ヘッダ／シーケンス関連 | `uint8` |
| 1 | 1 | 左スティックX | `uint8` |
| 2 | 1 | 左スティックY | `uint8` |
| 3 | 1 | 右スティックX | `uint8` |
| 4 | 1 | 右スティックY | `uint8` |
| 5 | 1 | L2アナログ値 | `uint8` |
| 6 | 1 | R2アナログ値 | `uint8` |
| 7 | 1 | 入力シーケンス番号 | `uint8` |
| 8 | 1 | Buttons 0 | bit field |
| 9 | 1 | Buttons 1 | bit field |
| 10 | 1 | Buttons 2 | bit field |
| 11 | 1 | Buttons 3／予約領域 | bit field |
| 12～15 | 4 | 予約・状態関連 | raw |
| 16～17 | 2 | Gyro X | `int16 little-endian` |
| 18～19 | 2 | Gyro Y | `int16 little-endian` |
| 20～21 | 2 | Gyro Z | `int16 little-endian` |
| 22～23 | 2 | Accel X | `int16 little-endian` |
| 24～25 | 2 | Accel Y | `int16 little-endian` |
| 26～27 | 2 | Accel Z | `int16 little-endian` |
| 28～31 | 4 | センサタイムスタンプ | `uint32 little-endian` |
| 32 | 1 | タッチ関連カウンタ／予約 | `uint8` |
| 33～36 | 4 | Touch point 0 | packed data |
| 37～40 | 4 | Touch point 1 | packed data |
| 41～52 | 12 | 状態・トリガー関連・予約 | raw |
| 53 | 1 | バッテリー状態 | bit field |
| 54～72 | 19 | 状態・予約領域 | raw |
| 73～76 | 4 | Bluetooth入力レポートCRC | `uint32 little-endian` |

このツールでは、未確定の予約領域も生バイト列として表示します。

## 6. USB `0x01 / 63 bytes`との違い

USB入力ではBluetooth固有の先頭1 byteがありません。

そのため、Bluetooth拡張入力の共通データ領域より、各値のoffsetが1つ前になります。

例：

| 値 | Bluetooth `0x31` | USB `0x01` |
|---|---:|---:|
| 左スティックX | 1 | 0 |
| 左スティックY | 2 | 1 |
| 右スティックX | 3 | 2 |
| 右スティックY | 4 | 3 |
| L2 | 5 | 4 |
| R2 | 6 | 5 |
| Touch point 0 | 33 | 32 |
| Touch point 1 | 37 | 36 |

ソースコードでは、接続方式に応じて共通データ開始位置を切り替えます。

```javascript
let commonOffset;

if (reportId === 0x31 && data.byteLength === 77) {
  commonOffset = 1;
} else if (reportId === 0x01 && data.byteLength === 63) {
  commonOffset = 0;
}
```

以後は、`commonOffset`からの相対位置として同じ解析処理を使います。

# 各値の復号方法

## 7. スティック値

スティック4軸は、それぞれ8 bitの符号なし整数です。

```text
0   : 軸の片側最大
127～128 : 中立付近
255 : 反対側最大
```

正規化には次の式を使用します。

```javascript
const normalized = (raw - 127.5) / 127.5;
```

結果はおおむね`-1.0～+1.0`です。

```javascript
const leftXRaw = data.getUint8(commonOffset + 0);
const leftYRaw = data.getUint8(commonOffset + 1);
const rightXRaw = data.getUint8(commonOffset + 2);
const rightYRaw = data.getUint8(commonOffset + 3);
```

## 8. L2 / R2アナログ値

L2とR2は8 bit値です。

```text
0   : 押していない
255 : 最大まで押している
```

```javascript
const l2Raw = data.getUint8(commonOffset + 4);
const r2Raw = data.getUint8(commonOffset + 5);

const l2 = l2Raw / 255;
const r2 = r2Raw / 255;
```

アナログ量とは別に、L2・R2のデジタル押下bitもButtons 1に含まれます。

## 9. ボタンbit field

### Buttons 0

`Buttons 0`の下位4 bitが十字キー、上位4 bitがフェイスボタンです。

```text
bit 0～3 : 十字キー値
bit 4    : Square
bit 5    : Cross
bit 6    : Circle
bit 7    : Triangle
```

```javascript
const buttons0 = data.getUint8(commonOffset + 7);
const dpad = buttons0 & 0x0f;

const square   = Boolean(buttons0 & 0x10);
const cross    = Boolean(buttons0 & 0x20);
const circle   = Boolean(buttons0 & 0x40);
const triangle = Boolean(buttons0 & 0x80);
```

十字キー値は次のように対応します。

| 値 | 方向 |
|---:|---|
| 0 | 上 |
| 1 | 右上 |
| 2 | 右 |
| 3 | 右下 |
| 4 | 下 |
| 5 | 左下 |
| 6 | 左 |
| 7 | 左上 |
| 8 | 中立 |

### Buttons 1

```text
bit 0 : L1
bit 1 : R1
bit 2 : L2 digital
bit 3 : R2 digital
bit 4 : Create
bit 5 : Options
bit 6 : L3
bit 7 : R3
```

### Buttons 2

```text
bit 0 : PS
bit 1 : Touchpad Click
bit 2 : Mute
bit 3～7 : 状態・予約領域
```

## 10. ジャイロ・加速度

ジャイロと加速度は、2 byteの符号付き16 bit整数です。

格納順はlittle-endianです。

```text
下位byte → 上位byte
```

JavaScriptでは`DataView.getInt16(offset, true)`を使います。第2引数`true`がlittle-endian指定です。

```javascript
const gyroX = data.getInt16(commonOffset + 15, true);
const gyroY = data.getInt16(commonOffset + 17, true);
const gyroZ = data.getInt16(commonOffset + 19, true);

const accelX = data.getInt16(commonOffset + 21, true);
const accelY = data.getInt16(commonOffset + 23, true);
const accelZ = data.getInt16(commonOffset + 25, true);
```

現時点の画面表示はraw値です。角速度や加速度の物理単位への変換係数は、今後の検証対象です。

## 11. センサタイムスタンプ

センサタイムスタンプは4 byteの符号なし32 bit整数です。

```javascript
const timestamp = data.getUint32(commonOffset + 27, true);
```

little-endianで復号します。

## 12. タッチパッド座標

1つのタッチ点は4 byteです。

```text
byte 0
  bit 7    : 非接触フラグ
  bit 0～6 : Contact ID

byte 1
  X座標 下位8 bit

byte 2
  bit 0～3 : X座標 上位4 bit
  bit 4～7 : Y座標 下位4 bit

byte 3
  Y座標 上位8 bit
```

復号方法：

```javascript
const contact = data.getUint8(offset + 0);
const xLow = data.getUint8(offset + 1);
const packed = data.getUint8(offset + 2);
const yHigh = data.getUint8(offset + 3);

const active = (contact & 0x80) === 0;
const id = contact & 0x7f;
const x = xLow | ((packed & 0x0f) << 8);
const y = ((packed & 0xf0) >> 4) | (yHigh << 4);
```

座標範囲はおおむね次のとおりです。

```text
X: 0～1919
Y: 0～1079
```

Bluetooth拡張入力での配置：

```text
Touch point 0 : payload offset 33～36
Touch point 1 : payload offset 37～40
```

指を離した後も最後のX・Y座標が残ります。そのため、座標値だけで接触を判断せず、必ずbit 7の接触フラグを確認します。

## 13. バッテリー状態

バッテリー状態byteはpayload offset 53です。

このツールでは、下位4 bitを0～10の段階値として扱います。

```javascript
const status = data.getUint8(commonOffset + 52);
const level = status & 0x0f;
const chargeState = (status >> 4) & 0x0f;
```

```text
下位4 bit : 残量段階
上位4 bit : 充電状態など
```

残量は簡易的に10%刻みへ変換しています。

```javascript
const estimatedPercent = Math.min(level, 10) * 10;
```

これは推定表示であり、OS表示と完全には一致しない場合があります。解析時にはraw値も確認してください。

## 14. 生バイト表示の読み方

画面下部には次の形式でpayloadを表示します。

```text
00:81  01:80  02:7f  03:80 ...
```

- `00`：payload offset
- `81`：そのoffsetに格納された16進数値

例えば、

```text
02:ff
```

なら、payload offset 2の値が`0xff = 255`という意味です。

入力を1つだけ動かし、前後のraw値を比較することで、未知のボタンや状態値の位置を調査できます。

# Bluetooth出力レポートのフォールバック

Bluetooth拡張入力開始の補助として、Report ID `0x31`の出力レポートを送ります。

WebHIDの`sendReport()`でもReport IDはpayloadと分離します。

```javascript
await device.sendReport(0x31, payload);
```

payloadは77 byteです。

```text
payload[0]  : sequence tag
payload[1]  : tag 0x10
payload[2]  : valid flags
payload[3]～payload[72] : ゼロ指令・予約
payload[73]～payload[76] : CRC32
```

CRC32の計算対象は次の順です。

```text
0xA2
Report ID 0x31
payload[0]～payload[72]
```

算出したCRC32をpayload末尾4 byteへlittle-endianで格納します。

この出力レポートは拡張入力開始の補助だけを目的としており、振動、ライトバー、プレイヤーLED、アダプティブトリガーにはゼロ指令を送ります。

# ローカル起動

静的ファイルだけで動作します。

```bash
python -m http.server 8000
```

ブラウザで次を開きます。

```text
http://localhost:8000
```

WebHIDはセキュアコンテキストが必要です。GitHub PagesのHTTPSと`localhost`で利用できます。

# 対応状況

確認済み：

- PS5 DualSense
- Vendor ID `0x054c`
- Product ID `0x0ce6`
- Windows
- Bluetooth
- Chrome / Edge
- 入力レポート`0x31 / 77 bytes`

未確認または追加検証が必要：

- USB接続での全項目
- macOS / Linux / ChromeOS
- DualSense Edge
- 異なるファームウェア版
- モーション値の物理単位への変換
- バッテリー状態上位4 bitの詳細な状態名
- 予約領域の完全な意味

# ファイル

```text
index.html   画面構成
styles.css  表示スタイル
app.js      WebHID接続、拡張入力開始、入力レポート解析
README.md   通信仕様、データ配置、復号方法、使い方
```

# 注意

このツールは入力の調査・可視化用です。

コントローラ出力機能は、Bluetooth拡張入力開始のためのゼロ出力フォールバックだけを使用しています。振動、ライトバー、プレイヤーLED、アダプティブトリガーの操作画面はまだ実装していません。
