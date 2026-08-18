# netdiag — 自宅ネット回線の実測ツール

「遅い気がする」を数値にするためのツール。推測を減らして、どこがボトルネックかを
実測値で切り分ける。

## 前提

**測定したい端末(自宅の Mac)の上で動かすこと。** クラウドや別ネットワークで動かしても
その回線を測るだけで意味がない。Python 3.8+ のみ、追加パッケージ不要。

## 使い方

```bash
# 1. 測る（ラベルは後で前後比較する時の目印）
python3 tools/netdiag.py run --label before-router-move

# 2. 判定する
python3 tools/netdiag.py diagnose results/2026....json

# 3. 対策後にもう一度測って、前後を比べる
python3 tools/netdiag.py run --label after-ipoe
python3 tools/netdiag.py compare results/<before>.json results/<after>.json
```

主なオプション:

| オプション | 既定値 | 意味 |
|---|---|---|
| `--label` | (必須) | 測定の名前。ファイル名にも入る |
| `--note` | なし | 自由記述メモ（測定時の状況など） |
| `--ping-count` | 20 | 各ターゲットへの ping 回数 |
| `--dl-seconds` | 10 | ダウンロード計測の秒数 |
| `--url` | Cloudflare | スループット計測に使う URL |
| `--skip` | なし | 除外セクション（例: `--skip throughput,bufferbloat`） |
| `--no-redact` | オフ | グローバル IP や BSSID をマスクせず保存する |

## 測っているもの

| セクション | 内容 | 使うもの |
|---|---|---|
| `wifi` | 信号強度 / ノイズ / SNR / リンク速度 / 規格 / チャンネル / 帯域幅 | macOS: `system_profiler` / Linux: `iw` |
| `ipv6` | グローバルアドレス・デフォルト経路の有無、実際の到達性 | `ifconfig` / `netstat` / TCP接続 |
| `wan` | 接続先 ISP(AS名) と PoP。IPoE の相談先を決めるのに要る | Cloudflare `/meta` |
| `latency` | GW / 1.1.1.1 / 8.8.8.8 の平均・最大・ロス・ジッタ | `ping` |
| `route` | traceroute 先頭4ホップ | `traceroute` |
| `dns` | ルーター / 1.1.1.1 / 8.8.8.8 の応答時間 | 素の UDP（外部ツール不要） |
| `throughput` | 単一接続 DL と 6並列 DL | HTTP |
| `bufferbloat` | RPM とアイドル遅延、負荷時の遅延上昇 | `networkQuality`(macOS) + ping |

測れなかった項目は `status: "unavailable"` と理由を必ず残す。0 や「正常」に丸めない。

## 判定に使っているしきい値

数字の根拠を後から検証できるように明示しておく（`TH` 定数と対応）。

| 指標 | 良好 | 問題 | 根拠 |
|---|---|---|---|
| RSSI | -60 dBm 以上 | -70 dBm 未満 | この辺りから実効速度が落ち始める |
| SNR | 30 dB 以上 | 20 dB 未満 | 20dB を切ると変調が落ちて速度が出ない |
| GW 遅延 | 3 ms 以下 | 5 ms 超 | 無線で 5ms 超は再送のサイン |
| WAN 遅延 | — | 30 ms 超 | 宅内分を差し引いた実質値で判定する |
| 実効 / PHY | 0.35 以上 | 0.15 未満 | 実効は PHY の 4〜5割が上限 |
| RPM | 1000 以上 | 300 未満 | Apple の目安で 1000 未満は low |
| 負荷時の遅延上昇 | — | +100 ms 超 | バッファブロートとして明確 |

判定で気をつけていること:

- **WAN 遅延は宅内(GWまで)の遅延を差し引いて評価する。** 差し引かないと、Wi-Fi が
  悪いだけの家を「回線が悪い」と誤診してしまう。
- **電波が弱いときは PHY リンク速度そのものが下がる。** そのため「リンク速度を使い
  切っている」ことは Wi-Fi が無罪である根拠にならない。
- **宅内が壊れているうちは、その先の数値を信用しない。** 先に宅内を直して再測定する
  ことを対策の順序に反映している。

## 注意

- `BSSID` の取得だけは `sudo` が要る（`sudo wdutil info`）。無くても他は全部測れる。
- グローバル IP・IPv6 アドレス・BSSID は既定でマスクして保存する。結果 JSON を
  そのまま他人に渡しても素性が出にくいようにしてある。
- 混雑の影響を見たいなら、**同じラベル規則で時間帯を変えて複数回測る**
  （例: `--label weekday-13h` / `--label weekday-21h`）。夜だけ遅いのか常時遅いのかで
  対策が変わる。

## テスト

```bash
python3 tools/test_netdiag.py
```

macOS の出力を模したサンプルでパーサを検証する。実機が無くても出力の読み違いを検出できる。
