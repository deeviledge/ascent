#!/usr/bin/env python3
"""verdict() のしきい値ロジックを合成データで検証する.

注意: これは計測ではない. 実ネットワークの値は一切含まない.
      netdiag.py の判定分岐が意図どおり発火するかだけを確認する.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from netdiag import verdict  # noqa: E402


def base(**kw):
    """計測が成立している最小構成のドキュメント."""
    d = {
        "gateway": {"ip": "192.168.1.1", "interface": "en0"},
        "wifi": {"link_type": "wifi", "rssi_dbm": -55, "noise_dbm": -92,
                 "snr_db": 37, "tx_rate_mbps": 866, "band": "5GHz",
                 "channel": 44, "channel_width_mhz": 80},
        "ipv6": {"has_global": True, "has_default_route": True,
                 "reachable": True, "global_addresses": ["2400:4050::1"]},
        "latency": {
            "gateway": {"avg_ms": 2.1, "max_ms": 4.0, "loss_pct": 0.0},
            "cloudflare": {"avg_ms": 12.0, "max_ms": 20.0, "loss_pct": 0.0},
            "google": {"avg_ms": 13.0, "max_ms": 21.0, "loss_pct": 0.0}},
        "traceroute": {"hops": [
            {"hop": 1, "ip": "192.168.1.1", "rtt_avg_ms": 2.0, "timeout": False,
             "is_private": True, "is_cgnat": False},
            {"hop": 2, "ip": "203.0.113.1", "rtt_avg_ms": 5.0, "timeout": False,
             "is_private": False, "is_cgnat": False}]},
        "dns": {"router": {"median_ms": 8.0}, "cloudflare": {"median_ms": 12.0},
                "google": {"median_ms": 14.0}},
        "throughput": {"single": {"mbps": 420.0}, "parallel6": {"mbps": 610.0}},
        "bufferbloat": {"networkquality": {"dl_rpm": 1800},
                        "loaded_latency": {"idle_avg_ms": 12.0,
                                           "loaded_avg_ms": 25.0,
                                           "increase_ms": 13.0}},
    }
    for k, val in kw.items():
        if isinstance(val, dict) and isinstance(d.get(k), dict):
            d[k] = {**d[k], **val}
        else:
            d[k] = val
    return d


def codes(d):
    return {f["code"] for f in verdict(d)["findings"]}


FAILS = []


def check(name, cond, detail=""):
    status = "PASS" if cond else "FAIL"
    if not cond:
        FAILS.append(name)
    print(f"[{status}] {name}{'  ' + detail if detail and not cond else ''}")


# 1. 健全な回線 -> critical なし
v = verdict(base())
check("healthy: run_valid", v["run_valid"] is True)
check("healthy: no critical", v["critical_count"] == 0,
      str([f["code"] for f in v["findings"] if f["severity"] == "critical"]))
check("healthy: ok findings present", "wifi_snr_ok" in codes(base()))

# 2. 電波が弱い -> 電波がボトルネック
d = base(wifi={"rssi_dbm": -82, "noise_dbm": -90, "snr_db": 8,
               "tx_rate_mbps": 58}, throughput={"single": {"mbps": 22.0},
                                                "parallel6": {"mbps": 51.0}})
v = verdict(d)
check("weak wifi: snr critical", "wifi_snr_bad" in codes(d))
check("weak wifi: rssi critical", "wifi_rssi_bad" in codes(d))
check("weak wifi: bottleneck=電波", "電波" in v["bottleneck"], v["bottleneck"])

# 3. 電波は良いが IPv6 なし -> 接続方式
d = base(ipv6={"has_global": False, "has_default_route": False,
               "reachable": False, "global_addresses": []})
v = verdict(d)
check("no ipv6: critical fires", "ipv6_absent" in codes(d))
check("no ipv6: bottleneck=接続方式", "接続方式" in v["bottleneck"], v["bottleneck"])
check("no ipv6: wifi still ok", "wifi_snr_ok" in codes(d))

# 4. 速度は出るが RPM が低い -> バッファブロート
d = base(bufferbloat={"networkquality": {"dl_rpm": 90},
                      "loaded_latency": {"idle_avg_ms": 12.0,
                                         "loaded_avg_ms": 460.0,
                                         "increase_ms": 448.0}})
v = verdict(d)
check("bloat: rpm critical", "rpm_bad" in codes(d))
check("bloat: loaded latency critical", "loaded_latency_bad" in codes(d))
check("bloat: bottleneck=バッファブロート",
      "バッファブロート" in v["bottleneck"], v["bottleneck"])

# 5. 単一接続だけ遅い -> セッション帯域を疑う
d = base(throughput={"single": {"mbps": 40.0}, "parallel6": {"mbps": 380.0}})
check("single-stream limited", "single_stream_limited" in codes(d))

# 6. 2ホップ目がプライベート -> 二重NAT
d = base(traceroute={"hops": [
    {"hop": 1, "ip": "192.168.1.1", "rtt_avg_ms": 2.0, "timeout": False,
     "is_private": True, "is_cgnat": False},
    {"hop": 2, "ip": "192.168.0.1", "rtt_avg_ms": 3.0, "timeout": False,
     "is_private": True, "is_cgnat": False}]})
check("hop2 private -> double NAT", "hop2_private" in codes(d))

# 7. 2ホップ目が CGNAT
d = base(traceroute={"hops": [
    {"hop": 1, "ip": "192.168.1.1", "rtt_avg_ms": 2.0, "timeout": False,
     "is_private": True, "is_cgnat": False},
    {"hop": 2, "ip": "100.100.0.1", "rtt_avg_ms": 3.0, "timeout": False,
     "is_private": False, "is_cgnat": True}]})
check("hop2 cgnat", "hop2_cgnat" in codes(d))

# 8. ルーターDNS が遅い
d = base(dns={"router": {"median_ms": 120.0}, "cloudflare": {"median_ms": 11.0},
              "google": {"median_ms": 14.0}})
check("slow router dns", "dns_router_slow" in codes(d))

# 9. 計測不成立 -> 断定しない (最重要)
d = base(gateway={"ip": None, "interface": None},
         latency={"gateway": {}, "cloudflare": {}, "google": {}},
         throughput={"single": {}, "parallel6": {}},
         ipv6={"has_global": False, "has_default_route": False,
               "reachable": False, "global_addresses": []})
v = verdict(d)
check("invalid run: run_valid False", v["run_valid"] is False)
check("invalid run: 判定不能", "判定不能" in v["bottleneck"], v["bottleneck"])
check("invalid run: PPPoE と断定しない", "ipv6_absent" not in codes(d),
      "計測不成立なのに接続方式を断定してしまっている")

# 10. 有線接続なら Wi-Fi を原因から除外
d = base(wifi={"link_type": "wired"})
check("wired: excluded", "wired" in codes(d))
check("wired: no wifi findings",
      not any(c.startswith("wifi_") for c in codes(d)))

print()
if FAILS:
    print(f"FAILED {len(FAILS)}: {FAILS}")
    sys.exit(1)
print("all checks passed")
