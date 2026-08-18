#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""netdiag.py のパーサを、実機の出力を模したサンプルで検証する。

macOS 実機が手元に無い状態でも「出力の読み違い」を潰しておくための最低限のテスト。
実行: python3 tools/test_netdiag.py
"""

import json
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import netdiag  # noqa: E402

FAILS = []


def check(name, got, want):
    if got == want:
        print("  ok   %-42s = %r" % (name, got))
    else:
        print("  FAIL %-42s got=%r want=%r" % (name, got, want))
        FAILS.append(name)


SP_JSON = json.dumps({
    "SPAirPortDataType": [{
        "spairport_airport_interfaces": [{
            "_name": "en0",
            "spairport_current_network_information": {
                "_name": "MyHome-5G",
                "spairport_network_channel": "149 (5GHz, 80MHz)",
                "spairport_network_phymode": "802.11ax",
                "spairport_network_rate": 1200,
                "spairport_security_mode": "spairport_security_mode_wpa3_personal",
                "spairport_signal_noise": "-58 dBm / -92 dBm",
            },
            "spairport_status_information": "spairport_status_connected",
        }]
    }]
})

PING_MAC = """PING 1.1.1.1 (1.1.1.1): 56 data bytes
64 bytes from 1.1.1.1: icmp_seq=0 ttl=57 time=12.345 ms
64 bytes from 1.1.1.1: icmp_seq=1 ttl=57 time=11.100 ms

--- 1.1.1.1 ping statistics ---
20 packets transmitted, 19 packets received, 5.0% packet loss
round-trip min/avg/max/stddev = 10.123/12.345/25.678/3.210 ms
"""

PING_LINUX = """PING 8.8.8.8 (8.8.8.8) 56(84) bytes of data.

--- 8.8.8.8 ping statistics ---
20 packets transmitted, 20 received, 0% packet loss, time 19030ms
rtt min/avg/max/mdev = 8.100/9.200/14.300/1.500 ms
"""

TRACE_MAC = """traceroute to 8.8.8.8 (8.8.8.8), 4 hops max, 52 byte packets
 1  192.168.1.1  3.456 ms
 2  118.155.200.1  8.123 ms
 3  * 
 4  72.14.239.1  12.500 ms
"""

IFCONFIG_MAC = """lo0: flags=8049<UP,LOOPBACK,RUNNING,MULTICAST> mtu 16384
\tinet6 ::1 prefixlen 128
\tinet6 fe80::1%lo0 prefixlen 64 scopeid 0x1
en0: flags=8863<UP,BROADCAST,SMART,RUNNING,SIMPLEX,MULTICAST> mtu 1500
\tinet6 fe80::1cbf:aeff:fe12:3456%en0 prefixlen 64 secured scopeid 0xc
\tinet6 2400:4050:1234:5678:abcd:ef01:2345:6789 prefixlen 64 autoconf secured
\tinet6 fd12:3456::1 prefixlen 64
"""

NETSTAT6_MAC = """Routing tables

Internet6:
Destination      Gateway            Flags     Netif Expire
default          fe80::1%en0        UGcg        en0
::1              ::1                UHL         lo0
"""


def fake_cmds(mapping):
    """run_cmd を差し替える。mapping: コマンド名の一部 -> (rc, out)"""
    def _fake(cmd, timeout=20):
        joined = " ".join(cmd)
        for key, (rc, out) in mapping.items():
            if key in joined:
                return {"rc": rc, "out": out, "err": ""}
        return {"rc": 127, "out": "", "err": "not mocked: %s" % joined}
    return _fake


def test_wifi_mac():
    print("\n[Wi-Fi / macOS system_profiler]")
    orig_cmd, orig_have, orig_mac = netdiag.run_cmd, netdiag.have, netdiag.IS_MAC
    netdiag.run_cmd = fake_cmds({
        "system_profiler": (0, SP_JSON),
        "wdutil": (1, ""),  # sudo なしで失敗する想定
    })
    netdiag.have = lambda b: "/usr/sbin/" + b
    try:
        sec = netdiag._wifi_mac(redact=True)
        d = sec["data"]
        check("status", sec["status"], "ok")
        check("ssid", d.get("ssid"), "MyHome-5G")
        check("rssi_dbm", d.get("rssi_dbm"), -58)
        check("noise_dbm", d.get("noise_dbm"), -92)
        check("snr_db", d.get("snr_db"), 34)
        check("channel", d.get("channel"), 149)
        check("width_mhz", d.get("width_mhz"), 80)
        check("band_ghz", d.get("band_ghz"), "5")
        check("phy_mode", d.get("phy_mode"), "802.11ax")
        check("tx_rate_mbps", d.get("tx_rate_mbps"), 1200.0)
    finally:
        netdiag.run_cmd, netdiag.have, netdiag.IS_MAC = orig_cmd, orig_have, orig_mac


def test_ping_parsing():
    print("\n[ping パース]")
    orig = netdiag.run_cmd
    try:
        netdiag.run_cmd = fake_cmds({"ping": (0, PING_MAC)})
        d = netdiag._ping("1.1.1.1", 20, 30)
        check("mac avg_ms", d.get("avg_ms"), 12.345)
        check("mac max_ms", d.get("max_ms"), 25.678)
        check("mac loss_pct", d.get("loss_pct"), 5.0)
        check("mac jitter_ms", d.get("jitter_ms"), 3.210)
        check("mac ok", d.get("ok"), True)

        netdiag.run_cmd = fake_cmds({"ping": (0, PING_LINUX)})
        d = netdiag._ping("8.8.8.8", 20, 30)
        check("linux avg_ms", d.get("avg_ms"), 9.200)
        check("linux loss_pct", d.get("loss_pct"), 0.0)
    finally:
        netdiag.run_cmd = orig


def test_route():
    print("\n[traceroute パース]")
    orig_cmd, orig_have = netdiag.run_cmd, netdiag.have
    netdiag.run_cmd = fake_cmds({"traceroute": (0, TRACE_MAC)})
    netdiag.have = lambda b: "/usr/sbin/" + b
    try:
        sec = netdiag.measure_route("8.8.8.8", 4)
        hops = sec["data"]["hops"]
        check("hop count", len(hops), 4)
        check("hop1 ip", hops[0]["ip"], "192.168.1.1")
        check("hop2 ip", hops[1]["ip"], "118.155.200.1")
        check("hop2 rtt", hops[1]["rtt_ms"], 8.123)
        check("hop3 timeout", hops[2]["timeout"], True)
        check("hop4 rtt", hops[3]["rtt_ms"], 12.5)
    finally:
        netdiag.run_cmd, netdiag.have = orig_cmd, orig_have


def test_ipv6():
    print("\n[IPv6 パース]")
    orig_cmd, orig_mac, orig_tcp = netdiag.run_cmd, netdiag.IS_MAC, netdiag._tcp_connect_ms
    netdiag.IS_MAC = True
    netdiag.run_cmd = fake_cmds({
        "ifconfig": (0, IFCONFIG_MAC),
        "netstat": (0, NETSTAT6_MAC),
    })
    netdiag._tcp_connect_ms = lambda *a, **k: 8.42
    try:
        sec = netdiag.measure_ipv6(redact=False)
        d = sec["data"]
        check("has_global_address", d["has_global_address"], True)
        check("global addrs", d["global_addresses"],
              ["2400:4050:1234:5678:abcd:ef01:2345:6789"])
        check("ULA は除外", d["ula_addresses"], ["fd12:3456::1"])
        check("has_default_route", d["has_default_route"], True)
        check("reachable_v6", d["reachable_v6"], True)

        # マスクが効くか
        sec = netdiag.measure_ipv6(redact=True)
        check("マスク済み", sec["data"]["global_addresses"][0], "2400:4050:1234:xxxx(masked)")
    finally:
        netdiag.run_cmd, netdiag.IS_MAC, netdiag._tcp_connect_ms = orig_cmd, orig_mac, orig_tcp


def test_dig_path():
    print("\n[サマリのキー解決 (IPがキーに混ざる)]")
    sections = {
        "latency": {"status": "ok", "data": {
            "1.1.1.1": {"avg_ms": 12.3, "loss_pct": 0.0},
            "gateway": {"avg_ms": 2.1},
        }},
        "throughput": {"status": "ok", "data": {"single": {"mbps": 88.5}}},
        "wifi": {"status": "unavailable", "data": {}},
    }
    check("latency.1.1.1.1.avg_ms", netdiag.dig_path(sections, "latency.1.1.1.1.avg_ms"), 12.3)
    check("latency.gateway.avg_ms", netdiag.dig_path(sections, "latency.gateway.avg_ms"), 2.1)
    check("throughput.single.mbps", netdiag.dig_path(sections, "throughput.single.mbps"), 88.5)
    check("欠損は None", netdiag.dig_path(sections, "wifi.rssi_dbm"), None)


def test_compare():
    print("\n[compare モード]")
    a = {"label": "before", "finished_at": "2026-08-18T00:00:00Z",
         "summary": {"throughput.single.mbps": 45.0, "wifi.snr_db": 22,
                     "ipv6.reachable_v6": False}}
    b = {"label": "after", "finished_at": "2026-08-18T01:00:00Z",
         "summary": {"throughput.single.mbps": 310.0, "wifi.snr_db": 38,
                     "ipv6.reachable_v6": True}}
    tmp = tempfile.mkdtemp()
    pa, pb = os.path.join(tmp, "a.json"), os.path.join(tmp, "b.json")
    for p, doc in ((pa, a), (pb, b)):
        with open(p, "w") as f:
            json.dump(doc, f)

    class Args:
        pass
    args = Args()
    args.a, args.b = pa, pb
    rc = netdiag.cmd_compare(args)
    check("compare 終了コード", rc, 0)


def test_dns_packet():
    print("\n[DNS クエリ組み立て (実サーバへ)]")
    res = netdiag._dns_query_ms("1.1.1.1", "www.google.com", timeout=3)
    if res.get("ms") is not None:
        check("rcode=0", res.get("rcode"), 0)
        print("  ok   %-42s = %s ms (回答 %s件)" % ("応答時間", res["ms"], res.get("answers")))
    else:
        print("  skip DNS 実クエリ不可: %s" % res.get("error"))


if __name__ == "__main__":
    test_wifi_mac()
    test_ping_parsing()
    test_route()
    test_ipv6()
    test_dig_path()
    test_compare()
    test_dns_packet()
    print("\n" + ("失敗: %s" % ", ".join(FAILS) if FAILS else "すべて成功"))
    sys.exit(1 if FAILS else 0)
