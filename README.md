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

## Bluetooth拡張入力の開始

DualSenseはBluetooth接続直後、タッチパッドやIMUを含まない最小入力レポート`0x01`を送ることがあります。

このページは接続時にFeature Report `0x05`を読み取ります。

```javascript
await device.receiveFeatureReport(0x05);
```

これにより、タッチパッド、ジャイロ、加速度などを含むBluetooth拡張入力レポート`0x31`の送信開始を要求します。

さらに、環境差へのフォールバックとして、CRC32付きBluetooth出力レポート`0x31`も送信します。この出力は振動やライトを動作させないゼロ指令です。

## WebHIDのReport ID

WebHIDの`inputreport`イベントでは、Report IDとpayloadが分離されています。

```javascript
function handleInputReport(event) {
  const reportId = event.reportId;
  const payload = event.data;
}
```

このREADMEとソースコードに記載するoffsetは、Report IDを含まない`event.data`内の位置です。

## Bluetooth `0x31`の主なoffset

| 値 | offset |
|---|---:|
| 左スティックX | 1 |
| 左スティックY | 2 |
| 右スティックX | 3 |
| 右スティックY | 4 |
| L2アナログ | 5 |
| R2アナログ | 6 |
| Sequence | 7 |
| Buttons 0～3 | 8～11 |
| Gyro X/Y/Z | 16～21 |
| Accel X/Y/Z | 22～27 |
| Sensor timestamp | 28～31 |
| Touch point 1 | 33～36 |
| Touch point 2 | 37～40 |
| Battery status | 53 |

USB入力`0x01 / 63 bytes`では、Bluetoothヘッダがないため共通データのoffsetが1つ前になります。

## タッチ座標の復号

1つのタッチ点は4 byteです。

```text
byte 0: bit7=非接触、bit0～6=Contact ID
byte 1: X下位8 bit
byte 2: 下位4 bit=X上位、上位4 bit=Y下位
byte 3: Y上位8 bit
```

```javascript
active = (byte0 & 0x80) === 0;
id = byte0 & 0x7f;
x = byte1 | ((byte2 & 0x0f) << 8);
y = ((byte2 & 0xf0) >> 4) | (byte3 << 4);
```

座標範囲はおおむね次のとおりです。

```text
X: 0～1919
Y: 0～1079
```

指を離した後も最後の座標が残るため、座標値だけでなく接触フラグを必ず確認します。

## ボタンの配置

`Buttons 0`の下位4 bitが十字キーです。

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

残りのbitからフェイスボタン、ショルダーボタン、Create、Options、L3/R3、PS、タッチパッド押し込み、Muteを復号します。

## バッテリー表示について

バッテリー状態byteの下位4 bitを0～10段階として扱い、10%刻みの推定残量を表示しています。これは簡易表示であり、OSが表示する残量と完全には一致しない場合があります。raw値も同時に確認してください。

## ローカル起動

静的ファイルだけで動作します。

```bash
python -m http.server 8000
```

ブラウザで次を開きます。

```text
http://localhost:8000
```

WebHIDはセキュアコンテキストが必要です。GitHub PagesのHTTPSと`localhost`で利用できます。

## 対応状況

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

## ファイル

```text
index.html   画面構成
styles.css  表示スタイル
app.js      WebHID接続、拡張入力開始、入力レポート解析
README.md   仕様と使い方
```

## 注意

このツールは入力の調査・可視化用です。コントローラ出力機能は、Bluetooth拡張入力開始のためのゼロ出力フォールバックだけを使用しています。振動、ライトバー、プレイヤーLED、アダプティブトリガーの操作画面はまだ実装していません。
