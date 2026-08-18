# netdiag.py — 自宅ネットワークの実測診断

推測ではなく実測でボトルネックを特定するための単発診断ツール。
標準ライブラリのみで動く（Python 3.8+）。macOS 主対応、Linux 副対応。

## 使い方

```bash
# 対策前の基準を取る
python3 tools/netdiag.py --label before

# 対策後にもう一度
python3 tools/netdiag.py --label after-ipoe

# 前後を並べて比較
python3 tools/netdiag.py --compare results/before_*.json results/after-ipoe_*.json
```

結果は `results/<label>_<timestamp>.json` に保存される。所要時間は既定で約3〜5分
（うち `networkQuality` が最大2分）。`--quick` で1分程度に短縮できる。

### 主なオプション

| オプション | 意味 |
|---|---|
| `--label NAME` | 計測につける名前。前後比較のキーになる |
| `--outdir DIR` | 保存先（既定 `results`） |
| `--ping-count N` | 各ターゲットへの ping 回数（既定 10） |
| `--dl-seconds N` | スループット計測の秒数（既定 10） |
| `--dl-url URL` | ダウンロード計測先。到達不能なら自動でフォールバック |
| `--skip A,B` | 項目をスキップ（`wifi,ipv6,latency,traceroute,dns,throughput,bufferbloat`） |
| `--quick` | 短縮モード（`networkQuality` を省略） |
| `--compare F1 F2 ...` | 保存済み JSON を表で比較 |

## 測っているもの

1. **Wi-Fi** — RSSI / ノイズ / SNR / リンク速度 / PHY規格 / チャンネル / 帯域幅
   （macOS は `system_profiler` + `wdutil`、Linux は `iw` + `/proc/net/wireless`）
2. **IPv6** — グローバルアドレス、デフォルト経路、**実到達性**（TCP443 で実接続）
3. **遅延** — デフォルトGW / 1.1.1.1 / 8.8.8.8 の avg・max・loss（3並列 ping）
4. **経路** — `traceroute` の最初の4ホップ（IP・RTT・プライベート/CGNAT 判定つき）
5. **DNS** — ルーター（＝GWのIP）/ 1.1.1.1 / 8.8.8.8 の応答時間中央値
   （`dig` 非依存。純Python の UDP DNS クエリで計測）
6. **スループット** — 単一接続DL と 6並列DL。最初の1秒はスロースタートとして除外
7. **バッファブロート** — `networkQuality` の RPM に加え、
   **アイドル時 vs 6並列DL負荷時の遅延差**を自前で計測（macOS 以外でも取れる）

## 判定ロジック

`verdict` セクションに機械判定が入る。主なしきい値：

| 指標 | warn | critical |
|---|---|---|
| SNR | < 25 dB | < 15 dB |
| RSSI | < -67 dBm | < -75 dBm |
| GW への遅延 | > 5 ms | > 10 ms |
| GW へのロス | — | > 0% |
| RPM (下り) | < 1000 | < 200 |
| 負荷時の遅延悪化 | > 30 ms | > 100 ms |
| 実効速度 / リンク速度 | — | > 90%（Wi-Fi が飽和） |
| 6並列 / 単一 の比 | > 2.5倍 | — |

### 重要：計測が成立していなければ判定しない

デフォルトゲートウェイ・WAN遅延・スループットのいずれかが取れていない場合、
`run_valid: false` として**ボトルネックの断定を行わない**。

これは意図的な設計。たとえば VPN 内やコンテナ内では IPv6 が無いのが当たり前で、
それを「PPPoE の証拠」と読むのは誤診になる。接続方式（PPPoE / IPoE）の推論は、
自宅LAN上でGWが見えている計測でのみ発火する。

## 実行上の注意

- **必ず診断したい端末そのもので実行する。** 別マシンやリモート環境の値は無意味。
- **VPN は切る。** 経路・遅延・IPv6 のすべてが VPN 側の値になる。
- Wi-Fi 診断なら**有線を抜く**。デフォルト経路が有線だと Wi-Fi 指標は原因から除外される。
- 前後比較するときは**同じ場所・同じ時間帯**で測る。夜間帯の輻輳は時間帯で大きく変わる。
- `wdutil` の一部項目は `sudo` が要る。SNR が取れない場合は
  `sudo python3 tools/netdiag.py --label before` を試す。

## テスト

判定ロジックは合成データで検証できる（実ネットワークには一切アクセスしない）：

```bash
python3 tools/test_verdict.py
```
