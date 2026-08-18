#!/usr/bin/env python3
"""
netdiag.py - 自宅ネットワークのボトルネックを実測で特定する単発診断ツール.

依存: 標準ライブラリのみ (Python 3.8+)
対応: macOS (主), Linux (副)

使い方:
    python3 tools/netdiag.py --label before
    python3 tools/netdiag.py --label after-ipoe
    python3 tools/netdiag.py --compare results/before_*.json results/after-ipoe_*.json

測るもの:
    1. Wi-Fi   信号強度 / ノイズ / SNR / リンク速度 / 規格 / チャンネル / 帯域幅
    2. IPv6    グローバルアドレス / デフォルト経路 / 実到達性
    3. 遅延    GW, 1.1.1.1, 8.8.8.8 の avg/max/loss
    4. 経路    traceroute 最初の4ホップ
    5. DNS     ルーター / 1.1.1.1 / 8.8.8.8 の応答時間
    6. 速度    単一接続DL と 6並列DL
    7. bloat   networkQuality の RPM + 自前のアイドル vs 負荷時遅延

計測値はすべて results/<label>_<timestamp>.json に保存される。
verdict セクションに、しきい値に基づく機械判定が入る。
"""

import argparse
import concurrent.futures as cf
import ipaddress
import json
import os
import platform
import random
import re
import shutil
import socket
import statistics
import struct
import subprocess
import sys
import threading
import time
import urllib.request
from datetime import datetime, timezone

SCHEMA_VERSION = 1

# ---------------------------------------------------------------- helpers

def run(cmd, timeout=60, want_rc=False):
    """コマンドを実行して stdout を返す. 失敗時は None."""
    try:
        p = subprocess.run(cmd, capture_output=True, text=True,
                           timeout=timeout, check=False)
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError) as e:
        return (None, -1, str(e)) if want_rc else None
    out = (p.stdout or "") + (p.stderr or "")
    if want_rc:
        return (p.stdout, p.returncode, p.stderr)
    if p.returncode != 0 and not p.stdout:
        return None
    return out


def have(tool):
    return shutil.which(tool) is not None


def num(s):
    """文字列から float を取り出す. 取れなければ None."""
    if s is None:
        return None
    m = re.search(r"-?\d+(?:\.\d+)?", str(s))
    return float(m.group(0)) if m else None


IS_MAC = platform.system() == "Darwin"
IS_LINUX = platform.system() == "Linux"

log_lock = threading.Lock()

def log(msg):
    with log_lock:
        print(msg, file=sys.stderr, flush=True)


# ---------------------------------------------------------------- 0. env

def collect_env():
    env = {
        "os": platform.system(),
        "os_release": platform.release(),
        "python": platform.python_version(),
        "hostname": socket.gethostname(),
        "machine": platform.machine(),
        "proxy_env": {k: os.environ.get(k) for k in
                      ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy")
                      if os.environ.get(k)},
        "tools": {t: have(t) for t in
                  ("ping", "ping6", "traceroute", "traceroute6", "networkQuality",
                   "wdutil", "system_profiler", "networksetup", "route", "ip",
                   "iw", "nmcli", "scutil")},
    }
    if IS_MAC:
        env["os_product_version"] = (run(["sw_vers", "-productVersion"]) or "").strip()
    # 有線か無線かの判定はデフォルト経路のIFで行う
    env["is_container_like"] = os.path.exists("/.dockerenv")
    return env


def default_gateway():
    """(gateway_ip, interface) を返す."""
    if IS_MAC:
        out = run(["route", "-n", "get", "default"]) or ""
        gw = re.search(r"gateway:\s*([0-9.]+)", out)
        ifc = re.search(r"interface:\s*(\w+)", out)
        return (gw.group(1) if gw else None, ifc.group(1) if ifc else None)
    out = run(["ip", "route", "show", "default"]) or ""
    gw = re.search(r"default via ([0-9.]+)", out)
    ifc = re.search(r"dev (\S+)", out)
    return (gw.group(1) if gw else None, ifc.group(1) if ifc else None)


# ---------------------------------------------------------------- 1. Wi-Fi

def wifi_interface_mac():
    out = run(["networksetup", "-listallhardwareports"]) or ""
    m = re.search(r"Hardware Port:\s*Wi-Fi\s*\nDevice:\s*(\w+)", out)
    return m.group(1) if m else None


def collect_wifi():
    """Wi-Fi の物理層メトリクスを取る. 有線なら link_type=wired."""
    res = {
        "link_type": None, "interface": None, "ssid": None, "bssid": None,
        "rssi_dbm": None, "noise_dbm": None, "snr_db": None,
        "tx_rate_mbps": None, "rx_rate_mbps": None,
        "phy_mode": None, "channel": None, "channel_width_mhz": None,
        "band": None, "source": [], "notes": [],
    }
    gw_ip, gw_if = default_gateway()
    res["interface"] = gw_if

    if IS_MAC:
        wifi_if = wifi_interface_mac()
        # デフォルト経路が Wi-Fi IF かどうかで有線/無線を判定
        if wifi_if and gw_if and wifi_if != gw_if:
            res["link_type"] = "wired"
            res["notes"].append(
                f"デフォルト経路が {gw_if} (Wi-Fi は {wifi_if}) なので有線接続. "
                "Wi-Fi 指標は無関係.")
            return res
        res["link_type"] = "wifi" if wifi_if else "unknown"

        # system_profiler は sudo 不要で RSSI/ノイズ/PHY/チャンネルが取れる
        sp = run(["system_profiler", "SPAirPortDataType", "-detailLevel", "basic"],
                 timeout=45)
        if sp:
            res["source"].append("system_profiler")
            # "Current Network Information:" 直後のブロックを読む
            blk = sp.split("Current Network Information:")
            blk = blk[1] if len(blk) > 1 else sp
            def sp_get(key):
                m = re.search(rf"^\s*{re.escape(key)}:\s*(.+)$", blk, re.M)
                return m.group(1).strip() if m else None
            res["ssid"] = res["ssid"] or (blk.strip().splitlines()[0].strip().rstrip(":")
                                          if blk.strip() else None)
            res["phy_mode"] = sp_get("PHY Mode")
            res["bssid"] = sp_get("BSSID")
            ch = sp_get("Channel")
            if ch:
                # 例: "44 (5GHz, 80MHz)"
                res["channel"] = int(num(ch))
                bw = re.search(r"(\d+)\s*MHz", ch)
                if bw:
                    res["channel_width_mhz"] = int(bw.group(1))
                bd = re.search(r"(2\.4|5|6)\s*GHz", ch)
                if bd:
                    res["band"] = bd.group(1) + "GHz"
            res["rssi_dbm"] = num(sp_get("Signal / Noise") or sp_get("Signal"))
            sn = sp_get("Signal / Noise")
            if sn:
                vals = re.findall(r"(-?\d+)\s*dBm", sn)
                if len(vals) >= 2:
                    res["rssi_dbm"] = float(vals[0])
                    res["noise_dbm"] = float(vals[1])
            res["tx_rate_mbps"] = num(sp_get("Transmit Rate"))

        # wdutil は補完 (macOS 13+). sudo なしだと一部伏字.
        if have("wdutil"):
            wd = run(["wdutil", "info"], timeout=30)
            if wd:
                res["source"].append("wdutil")
                def wd_get(key):
                    m = re.search(rf"^\s*{re.escape(key)}\s*:\s*(.+)$", wd, re.M)
                    return m.group(1).strip() if m else None
                if res["rssi_dbm"] is None:
                    res["rssi_dbm"] = num(wd_get("RSSI"))
                if res["noise_dbm"] is None:
                    res["noise_dbm"] = num(wd_get("Noise"))
                if res["tx_rate_mbps"] is None:
                    res["tx_rate_mbps"] = num(wd_get("Tx Rate"))
                if res["phy_mode"] is None:
                    res["phy_mode"] = wd_get("PHY Mode")
                if res["channel_width_mhz"] is None:
                    chw = wd_get("Channel")
                    if chw:
                        bw = re.search(r"/(\d+)", chw)
                        if bw:
                            res["channel_width_mhz"] = int(bw.group(1))
                if os.geteuid() != 0:
                    res["notes"].append(
                        "wdutil は sudo なしのため一部項目が伏字. "
                        "完全な値が要るなら sudo で再実行.")

    elif IS_LINUX:
        wifi_ifs = []
        try:
            for n in os.listdir("/sys/class/net"):
                if os.path.exists(f"/sys/class/net/{n}/wireless"):
                    wifi_ifs.append(n)
        except OSError:
            pass
        if not wifi_ifs:
            res["link_type"] = "wired_or_none"
            res["notes"].append("無線インターフェースが存在しない (有線 or 仮想環境).")
            return res
        ifc = gw_if if gw_if in wifi_ifs else wifi_ifs[0]
        res["interface"] = ifc
        res["link_type"] = "wifi"
        if have("iw"):
            res["source"].append("iw")
            link = run(["iw", "dev", ifc, "link"]) or ""
            res["ssid"] = (re.search(r"SSID:\s*(.+)", link) or [None, None])[1] \
                if re.search(r"SSID:\s*(.+)", link) else None
            m = re.search(r"freq:\s*(\d+)", link)
            if m:
                freq = int(m.group(1))
                res["band"] = "2.4GHz" if freq < 3000 else ("6GHz" if freq > 5925 else "5GHz")
            m = re.search(r"tx bitrate:\s*([\d.]+)", link)
            if m:
                res["tx_rate_mbps"] = float(m.group(1))
            m = re.search(r"rx bitrate:\s*([\d.]+)", link)
            if m:
                res["rx_rate_mbps"] = float(m.group(1))
            m = re.search(r"signal:\s*(-?\d+)", link)
            if m:
                res["rssi_dbm"] = float(m.group(1))
            m = re.search(r"(\d+)MHz", link)
            if m:
                res["channel_width_mhz"] = int(m.group(1))
            info = run(["iw", "dev", ifc, "info"]) or ""
            m = re.search(r"channel\s+(\d+)", info)
            if m:
                res["channel"] = int(m.group(1))
            m = re.search(r"width:\s*(\d+)\s*MHz", info)
            if m and not res["channel_width_mhz"]:
                res["channel_width_mhz"] = int(m.group(1))
            if "HE" in link or "EHT" in link:
                res["phy_mode"] = "802.11ax/be"
        # /proc/net/wireless はノイズの代替
        try:
            with open("/proc/net/wireless") as f:
                for line in f:
                    if line.strip().startswith(ifc):
                        parts = line.split()
                        if len(parts) >= 5:
                            res["rssi_dbm"] = res["rssi_dbm"] or float(parts[3].rstrip("."))
                            res["noise_dbm"] = float(parts[4].rstrip("."))
                        res["source"].append("/proc/net/wireless")
        except OSError:
            pass

    if res["rssi_dbm"] is not None and res["noise_dbm"] is not None:
        res["snr_db"] = round(res["rssi_dbm"] - res["noise_dbm"], 1)
    if res["rssi_dbm"] is not None and res["noise_dbm"] is None:
        res["notes"].append("ノイズ値が取得できないため SNR は未算出.")
    return res


# ---------------------------------------------------------------- 2. IPv6

def collect_ipv6():
    res = {"global_addresses": [], "has_global": False, "has_default_route": False,
           "default_route": None, "reachable": None, "reach_detail": None,
           "notes": []}
    # グローバルアドレス
    try:
        for fam, _, _, _, sa in socket.getaddrinfo(socket.gethostname(), None,
                                                   socket.AF_INET6):
            pass
    except socket.gaierror:
        pass
    if IS_MAC:
        out = run(["ifconfig"]) or ""
        for m in re.finditer(r"inet6\s+([0-9a-fA-F:]+)(%\w+)?\s+prefixlen\s+\d+"
                             r"(?!.*(?:temporary|deprecated))", out):
            addr = m.group(1)
            try:
                a = ipaddress.IPv6Address(addr)
                if a.is_global:
                    res["global_addresses"].append(addr)
            except ValueError:
                continue
        rt = run(["route", "-n", "get", "-inet6", "default"]) or ""
        gw = re.search(r"gateway:\s*(\S+)", rt)
        if gw and "not in table" not in rt:
            res["has_default_route"] = True
            res["default_route"] = gw.group(1)
    else:
        out = run(["ip", "-6", "addr"]) or ""
        for m in re.finditer(r"inet6\s+([0-9a-fA-F:]+)/\d+\s+scope\s+global", out):
            res["global_addresses"].append(m.group(1))
        rt = run(["ip", "-6", "route", "show", "default"]) or ""
        if rt.strip():
            res["has_default_route"] = True
            res["default_route"] = rt.strip().splitlines()[0]

    res["global_addresses"] = sorted(set(res["global_addresses"]))
    res["has_global"] = len(res["global_addresses"]) > 0

    # アドレスと経路があっても実際に通るとは限らないので実到達性を見る
    try:
        s = socket.socket(socket.AF_INET6, socket.SOCK_STREAM)
        s.settimeout(5)
        # Cloudflare DNS の IPv6
        s.connect(("2606:4700:4700::1111", 443))
        s.close()
        res["reachable"] = True
        res["reach_detail"] = "TCP443 to 2606:4700:4700::1111 OK"
    except Exception as e:
        res["reachable"] = False
        res["reach_detail"] = f"{type(e).__name__}: {e}"
    return res


# ---------------------------------------------------------------- 3. latency

PING_SUMMARY = re.compile(
    r"(?P<tx>\d+)\s+packets transmitted,\s+(?P<rx>\d+)\s+(?:packets\s+)?received"
    r".*?(?P<loss>[\d.]+)%\s+packet loss", re.S)
PING_RTT = re.compile(
    r"(?:round-trip|rtt)\s+min/avg/max/(?:stddev|mdev)\s*=\s*"
    r"([\d.]+)/([\d.]+)/([\d.]+)/([\d.]+)")


def ping_target(name, host, count):
    res = {"name": name, "host": host, "sent": None, "received": None,
           "loss_pct": None, "avg_ms": None, "max_ms": None, "min_ms": None,
           "jitter_ms": None, "raw": None, "error": None}
    if host is None:
        res["error"] = "ターゲット未解決 (デフォルトGWが取れていない可能性)"
        return res
    if not have("ping"):
        res["error"] = "ping コマンドが無い"
        return res
    cmd = ["ping", "-c", str(count), "-W", "2000" if IS_MAC else "2", host]
    out = run(cmd, timeout=count * 2 + 20)
    if out is None:
        res["error"] = "ping 実行失敗 (到達不能 or タイムアウト)"
        return res
    res["raw"] = out.strip()[-1200:]
    m = PING_SUMMARY.search(out)
    if m:
        res["sent"] = int(m.group("tx"))
        res["received"] = int(m.group("rx"))
        res["loss_pct"] = float(m.group("loss"))
    m = PING_RTT.search(out)
    if m:
        res["min_ms"] = float(m.group(1))
        res["avg_ms"] = float(m.group(2))
        res["max_ms"] = float(m.group(3))
        res["jitter_ms"] = float(m.group(4))
    if res["avg_ms"] is None and res["loss_pct"] in (None, 100.0):
        res["error"] = res["error"] or "応答なし (100% loss)"
    return res


def collect_latency(gw, count):
    targets = [("gateway", gw), ("cloudflare", "1.1.1.1"), ("google", "8.8.8.8")]
    out = {}
    with cf.ThreadPoolExecutor(max_workers=3) as ex:
        futs = {ex.submit(ping_target, n, h, count): n for n, h in targets}
        for f in cf.as_completed(futs):
            r = f.result()
            out[r["name"]] = r
    return out


# ---------------------------------------------------------------- 4. route

def collect_traceroute(max_hops=4):
    res = {"hops": [], "error": None, "raw": None}
    if not have("traceroute"):
        res["error"] = "traceroute コマンドが無い"
        return res
    cmd = ["traceroute", "-n", "-w", "2", "-q", "3", "-m", str(max_hops), "1.1.1.1"]
    out = run(cmd, timeout=90)
    if out is None:
        res["error"] = "traceroute 実行失敗"
        return res
    res["raw"] = out.strip()
    for line in out.splitlines():
        m = re.match(r"\s*(\d+)\s+(.*)", line)
        if not m:
            continue
        hop_no = int(m.group(1))
        rest = m.group(2)
        ips = re.findall(r"\b(?:\d{1,3}\.){3}\d{1,3}\b", rest)
        rtts = [float(x) for x in re.findall(r"([\d.]+)\s*ms", rest)]
        ip = ips[0] if ips else None
        entry = {
            "hop": hop_no,
            "ip": ip,
            "rtt_ms": rtts,
            "rtt_avg_ms": round(statistics.mean(rtts), 3) if rtts else None,
            "timeout": ip is None,
            "is_private": None,
            "is_cgnat": None,
        }
        if ip:
            try:
                a = ipaddress.IPv4Address(ip)
                entry["is_private"] = a.is_private
                entry["is_cgnat"] = a in ipaddress.IPv4Network("100.64.0.0/10")
            except ValueError:
                pass
        res["hops"].append(entry)
    return res


# ---------------------------------------------------------------- 5. DNS

def dns_query_time(server, qname, timeout=3.0, port=53):
    """純Python の A レコード問い合わせ. (elapsed_ms, ok, detail) を返す."""
    tid = random.randint(0, 0xFFFF)
    header = struct.pack(">HHHHHH", tid, 0x0100, 1, 0, 0, 0)
    q = b"".join(bytes([len(p)]) + p.encode("ascii")
                 for p in qname.rstrip(".").split(".")) + b"\x00"
    packet = header + q + struct.pack(">HH", 1, 1)
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.settimeout(timeout)
    t0 = time.perf_counter()
    try:
        s.sendto(packet, (server, port))
        while True:
            data, _ = s.recvfrom(4096)
            if len(data) >= 2 and struct.unpack(">H", data[:2])[0] == tid:
                break
        el = (time.perf_counter() - t0) * 1000
        rcode = data[3] & 0x0F
        return (round(el, 2), rcode == 0, f"rcode={rcode}")
    except Exception as e:
        return (None, False, f"{type(e).__name__}: {e}")
    finally:
        s.close()


DNS_PROBE_DOMAINS = ["www.google.com", "www.cloudflare.com", "www.wikipedia.org",
                     "www.yahoo.co.jp", "www.amazon.co.jp"]


def dns_bench(name, server, rounds=2):
    res = {"name": name, "server": server, "samples": [], "median_ms": None,
           "mean_ms": None, "max_ms": None, "failures": 0, "error": None}
    if server is None:
        res["error"] = "サーバー未特定"
        return res
    for _ in range(rounds):
        for d in DNS_PROBE_DOMAINS:
            el, ok, detail = dns_query_time(server, d)
            if ok and el is not None:
                res["samples"].append({"domain": d, "ms": el})
            else:
                res["failures"] += 1
                res["error"] = res["error"] or detail
    vals = [s["ms"] for s in res["samples"]]
    if vals:
        res["median_ms"] = round(statistics.median(vals), 2)
        res["mean_ms"] = round(statistics.mean(vals), 2)
        res["max_ms"] = round(max(vals), 2)
    return res


def system_resolvers():
    out = []
    if IS_MAC:
        sc = run(["scutil", "--dns"]) or ""
        out = re.findall(r"nameserver\[\d+\]\s*:\s*([0-9.]+)", sc)
    try:
        with open("/etc/resolv.conf") as f:
            out += re.findall(r"^\s*nameserver\s+([0-9.]+)", f.read(), re.M)
    except OSError:
        pass
    seen, uniq = set(), []
    for x in out:
        if x not in seen:
            seen.add(x)
            uniq.append(x)
    return uniq


def collect_dns(gw):
    resolvers = system_resolvers()
    results = {}
    # ルーターDNS は「デフォルトGWのIP」に限る. GW が取れない環境で
    # resolv.conf の外部DNSを "router" と称すると比較が無意味になる.
    results["router"] = dns_bench("router", gw)
    if gw is None:
        results["router"]["error"] = ("デフォルトゲートウェイ不明のため "
                                      "ルーターDNSは未計測")
    results["cloudflare"] = dns_bench("cloudflare", "1.1.1.1")
    results["google"] = dns_bench("google", "8.8.8.8")
    results["_system_resolvers"] = resolvers
    if resolvers:
        results["system_first"] = dns_bench("system_first", resolvers[0])
    return results


# ---------------------------------------------------------------- 6. throughput

DEFAULT_DL_URL = "https://speed.cloudflare.com/__down?bytes=2000000000"

_stop = threading.Event()


def _dl_worker(url, duration, counter, idx, ramp=1.0):
    """time-boxed download. スロースタート区間 (ramp 秒) は集計から除外."""
    try:
        req = urllib.request.Request(url, headers={
            "User-Agent": "netdiag/1.0", "Cache-Control": "no-cache"})
        with urllib.request.urlopen(req, timeout=20) as r:
            t0 = time.perf_counter()
            counted = 0
            while True:
                chunk = r.read(1 << 16)
                if not chunk:
                    break
                el = time.perf_counter() - t0
                if el >= ramp:
                    counted += len(chunk)
                if el >= duration or _stop.is_set():
                    break
            counter[idx] = (counted, max(el - ramp, 1e-9))
    except Exception as e:
        counter[idx] = (0, 0.0, f"{type(e).__name__}: {e}")


def throughput(url, streams, duration, ramp=1.0):
    counter = {}
    _stop.clear()
    threads = [threading.Thread(target=_dl_worker,
                                args=(url, duration, counter, i, ramp))
               for i in range(streams)]
    t0 = time.perf_counter()
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=duration + 30)
    wall = time.perf_counter() - t0
    total_bytes = sum(v[0] for v in counter.values())
    errors = [v[2] for v in counter.values() if len(v) > 2]
    eff = max((v[1] for v in counter.values()), default=0.0)
    mbps = (total_bytes * 8) / eff / 1e6 if eff > 0 else None
    return {
        "streams": streams,
        "url": url,
        "duration_s": duration,
        "ramp_excluded_s": ramp,
        "bytes": total_bytes,
        "measured_window_s": round(eff, 2),
        "wall_s": round(wall, 2),
        "mbps": round(mbps, 2) if mbps else None,
        "errors": errors,
    }


FALLBACK_DL_URLS = [
    DEFAULT_DL_URL,
    "https://speed.hetzner.de/1GB.bin",
    "https://proof.ovh.net/files/1Gb.dat",
]


def pick_dl_url(preferred):
    """実際に本文が読める URL を1つ選ぶ. 全滅なら preferred を返す."""
    cands = [preferred] + [u for u in FALLBACK_DL_URLS if u != preferred]
    for u in cands:
        probe = {}
        _stop.clear()
        _dl_worker(u, 2.0, probe, 0, ramp=0.0)
        got = probe.get(0, (0, 0))
        if got[0] > 200_000:  # 2秒で 200KB 以上読めれば使える
            if u != preferred:
                log(f"      (計測先を {u} に切替)")
            return u
        log(f"      ({u} は使用不可: {got[2] if len(got) > 2 else 'データ不足'})")
    return preferred


def collect_throughput(url, duration):
    log("  [6/7] 計測先を選択中...")
    url = pick_dl_url(url)
    log("  [6/7] 単一接続ダウンロード...")
    single = throughput(url, 1, duration)
    time.sleep(2)
    log("  [6/7] 6並列ダウンロード...")
    multi = throughput(url, 6, duration)
    return {"single": single, "parallel6": multi, "chosen_url": url}


# ---------------------------------------------------------------- 7. bufferbloat

def networkquality():
    res = {"available": have("networkQuality"), "raw": None, "error": None,
           "dl_rpm": None, "ul_rpm": None, "base_rtt_ms": None,
           "dl_throughput_mbps": None, "ul_throughput_mbps": None}
    if not res["available"]:
        res["error"] = "networkQuality は macOS 12+ のみ"
        return res
    out = run(["networkQuality", "-c", "-s"], timeout=180)
    if not out:
        out = run(["networkQuality", "-c"], timeout=180)
    if not out:
        res["error"] = "networkQuality 実行失敗"
        return res
    try:
        start = out.index("{")
        data = json.loads(out[start:])
        res["raw"] = data
        res["dl_rpm"] = data.get("dl_responsiveness")
        res["ul_rpm"] = data.get("ul_responsiveness")
        res["base_rtt_ms"] = data.get("base_rtt")
        if data.get("dl_throughput"):
            res["dl_throughput_mbps"] = round(data["dl_throughput"] / 1e6, 2)
        if data.get("ul_throughput"):
            res["ul_throughput_mbps"] = round(data["ul_throughput"] / 1e6, 2)
    except (ValueError, KeyError) as e:
        res["error"] = f"JSON 解析失敗: {e}"
        res["raw"] = out[-2000:]
    return res


def loaded_latency(url, duration=10):
    """アイドル時と6並列DL負荷時の遅延を自前で比較する (networkQuality の代替兼補強)."""
    res = {"idle_avg_ms": None, "idle_max_ms": None,
           "loaded_avg_ms": None, "loaded_max_ms": None,
           "increase_ms": None, "approx_rpm": None, "error": None}
    idle = ping_target("idle", "1.1.1.1", 8)
    res["idle_avg_ms"] = idle["avg_ms"]
    res["idle_max_ms"] = idle["max_ms"]
    if idle["avg_ms"] is None:
        res["error"] = "アイドル遅延が取れず負荷時比較を断念"
        return res

    counter = {}
    _stop.clear()
    threads = [threading.Thread(target=_dl_worker, args=(url, duration, counter, i, 0.0))
               for i in range(6)]
    for t in threads:
        t.start()
    time.sleep(2)  # 帯域が埋まるのを待つ
    loaded = ping_target("loaded", "1.1.1.1", max(duration - 3, 5))
    _stop.set()
    for t in threads:
        t.join(timeout=20)
    _stop.clear()

    res["loaded_avg_ms"] = loaded["avg_ms"]
    res["loaded_max_ms"] = loaded["max_ms"]
    if loaded["avg_ms"] is not None:
        res["increase_ms"] = round(loaded["avg_ms"] - idle["avg_ms"], 2)
        # RPM の定義に近い近似: 60秒 / 負荷時往復遅延
        res["approx_rpm"] = round(60000.0 / loaded["avg_ms"]) if loaded["avg_ms"] > 0 else None
    return res


# ---------------------------------------------------------------- verdict

def coverage(d):
    """各カテゴリが実際に数値を出せたかを判定する.

    計測が成立していない環境 (コンテナ, VPN 内, ツール欠落) で
    推論だけが独り歩きするのを防ぐためのゲート.
    """
    c = {}
    w = d.get("wifi") or {}
    c["wifi"] = w.get("link_type") == "wifi" and (
        w.get("rssi_dbm") is not None or w.get("tx_rate_mbps") is not None)
    c["wired"] = w.get("link_type") == "wired"
    c["gateway"] = bool((d.get("gateway") or {}).get("ip"))
    lat = d.get("latency") or {}
    c["latency_wan"] = any((lat.get(k) or {}).get("avg_ms") is not None
                           for k in ("cloudflare", "google"))
    c["latency_gw"] = (lat.get("gateway") or {}).get("avg_ms") is not None
    c["ipv6"] = (d.get("ipv6") or {}).get("reachable") is not None
    c["traceroute"] = bool((d.get("traceroute") or {}).get("hops"))
    dns = d.get("dns") or {}
    c["dns"] = any((dns.get(k) or {}).get("median_ms") is not None
                   for k in ("router", "cloudflare", "google")
                   if isinstance(dns.get(k), dict))
    tp = d.get("throughput") or {}
    c["throughput"] = (tp.get("single") or {}).get("mbps") is not None or \
                      (tp.get("parallel6") or {}).get("mbps") is not None
    bb = d.get("bufferbloat") or {}
    c["bufferbloat"] = (bb.get("networkquality") or {}).get("dl_rpm") is not None or \
                       (bb.get("loaded_latency") or {}).get("increase_ms") is not None

    # 「自宅回線を測れている」と言える最低条件:
    #   デフォルトGWが見えて, WAN 側への遅延が測れて, 速度が出せていること
    c["_valid_run"] = bool(c["gateway"] and c["latency_wan"] and c["throughput"])
    c["_measured"] = sorted(k for k, val in c.items()
                            if not k.startswith("_") and val)
    c["_missing"] = sorted(k for k, val in c.items()
                           if not k.startswith("_") and not val)
    return c


def verdict(d):
    """しきい値ベースの機械判定. 断定は実測値がある項目のみ."""
    v = {"findings": [], "bottleneck": None, "unmeasured": []}
    def add(sev, code, msg, evidence=None):
        v["findings"].append({"severity": sev, "code": code,
                              "message": msg, "evidence": evidence})

    cov = coverage(d)
    v["coverage"] = cov
    v["run_valid"] = cov["_valid_run"]
    if not cov["_valid_run"]:
        v["bottleneck"] = ("判定不能: 計測が成立していない "
                           f"(取得できた項目: {', '.join(cov['_measured']) or 'なし'})")
        add("critical", "run_invalid",
            "デフォルトゲートウェイ・WAN 遅延・スループットのいずれかが取れていない. "
            "この結果から自宅回線のボトルネックを論じることはできない. "
            "対象マシン上で、VPN を切った状態で再実行すること.",
            {"missing": cov["_missing"]})
        v["unmeasured"] = [f"{k} (数値なし)" for k in cov["_missing"]]
        v["critical_count"] = 1
        v["warn_count"] = 0
        return v

    w = d.get("wifi", {})
    lat = d.get("latency", {})
    tp = d.get("throughput", {})
    v6 = d.get("ipv6", {})
    dns = d.get("dns", {})
    tr = d.get("traceroute", {})
    bb = d.get("bufferbloat", {})

    single = (tp.get("single") or {}).get("mbps")
    par = (tp.get("parallel6") or {}).get("mbps")

    # --- Wi-Fi 電波
    snr, rssi, link = w.get("snr_db"), w.get("rssi_dbm"), w.get("tx_rate_mbps")
    if w.get("link_type") == "wifi":
        if snr is not None:
            if snr < 15:
                add("critical", "wifi_snr_bad",
                    f"SNR {snr} dB は復調限界に近い. 電波がボトルネック.", {"snr_db": snr})
            elif snr < 25:
                add("warn", "wifi_snr_marginal",
                    f"SNR {snr} dB は不足気味. 変調が落ちてリンク速度が下がる.", {"snr_db": snr})
            else:
                add("ok", "wifi_snr_ok", f"SNR {snr} dB は十分. 電波は原因ではない.",
                    {"snr_db": snr})
        else:
            v["unmeasured"].append("SNR (ノイズ値が取得不可)")
        if rssi is not None:
            if rssi < -75:
                add("critical", "wifi_rssi_bad",
                    f"RSSI {rssi} dBm は弱すぎる. 置き場所/中継が効く可能性が高い.",
                    {"rssi_dbm": rssi})
            elif rssi < -67:
                add("warn", "wifi_rssi_marginal", f"RSSI {rssi} dBm はやや弱い.",
                    {"rssi_dbm": rssi})
            else:
                add("ok", "wifi_rssi_ok",
                    f"RSSI {rssi} dBm は良好. 置き場所の変更では改善しない.",
                    {"rssi_dbm": rssi})
        if link is not None and par is not None:
            if par > link * 0.4:
                add("ok", "wifi_not_limiting",
                    f"実効 {par} Mbps はリンク速度 {link} Mbps の {par/link*100:.0f}%. "
                    "Wi-Fi 区間は飽和しておらず、上位がボトルネック.",
                    {"link_mbps": link, "measured_mbps": par})
            elif par > link * 0.9:
                add("critical", "wifi_saturated",
                    f"実効 {par} Mbps がリンク速度 {link} Mbps に張り付いている. "
                    "Wi-Fi がボトルネック.", {"link_mbps": link, "measured_mbps": par})
        if w.get("band") == "2.4GHz":
            add("warn", "wifi_24ghz",
                "2.4GHz に接続中. 5GHz/6GHz が使えるなら帯域幅で上回る.",
                {"band": "2.4GHz", "width_mhz": w.get("channel_width_mhz")})
        if w.get("channel_width_mhz") and w["channel_width_mhz"] <= 20 \
                and w.get("band") != "2.4GHz":
            add("warn", "wifi_narrow_width",
                f"チャンネル幅 {w['channel_width_mhz']} MHz は狭い. "
                "80MHz 以上が使えるか確認.", {"width_mhz": w["channel_width_mhz"]})
    elif w.get("link_type") == "wired":
        add("ok", "wired", "有線接続のため Wi-Fi は原因から除外できる.")

    # --- 遅延
    gw = lat.get("gateway", {})
    cf_l = lat.get("cloudflare", {})
    if gw.get("avg_ms") is not None:
        if gw["avg_ms"] > 10:
            add("critical", "gw_latency_high",
                f"ゲートウェイまで平均 {gw['avg_ms']} ms. LAN 内で既に遅い. "
                "無線区間か router 本体の問題.", {"gw_avg_ms": gw["avg_ms"]})
        elif gw["avg_ms"] > 5:
            add("warn", "gw_latency_elevated",
                f"ゲートウェイまで平均 {gw['avg_ms']} ms. 無線区間の揺らぎを疑う.",
                {"gw_avg_ms": gw["avg_ms"]})
        else:
            add("ok", "gw_latency_ok",
                f"ゲートウェイまで平均 {gw['avg_ms']} ms. LAN 内は健全.",
                {"gw_avg_ms": gw["avg_ms"]})
    if gw.get("loss_pct"):
        add("critical", "gw_loss",
            f"ゲートウェイへのパケットロス {gw['loss_pct']}%. 無線品質かハード不良.",
            {"loss_pct": gw["loss_pct"]})
    if cf_l.get("avg_ms") is not None and gw.get("avg_ms") is not None:
        wan = round(cf_l["avg_ms"] - gw["avg_ms"], 2)
        if wan > 30:
            add("warn", "wan_latency_high",
                f"GW から先で +{wan} ms. WAN 側 (ISP/網終端) が遅い.",
                {"wan_delta_ms": wan})
        else:
            add("ok", "wan_latency_ok", f"GW から先は +{wan} ms. 経路は正常範囲.",
                {"wan_delta_ms": wan})

    # --- IPv6 / 接続方式
    if v6.get("has_global") and v6.get("has_default_route") and v6.get("reachable"):
        add("ok", "ipv6_ok",
            "IPv6 グローバルアドレス・デフォルト経路・実到達性すべて有り. "
            "IPoE (v6 ネイティブ) が有効な可能性が高い.",
            {"addrs": v6["global_addresses"]})
    elif not v6.get("has_global"):
        # このマシンが実際に自宅LANに居る時だけ接続方式の話に踏み込む.
        # コンテナ/VPN内では IPv6 が無いのは当たり前で、PPPoE の根拠にならない.
        if cov["gateway"] and cov["latency_gw"]:
            add("critical", "ipv6_absent",
                "IPv6 グローバルアドレスが無い. PPPoE 単独接続の可能性が高い. "
                "夜間の速度低下は網終端装置の輻輳で説明がつく. IPoE 化が最優先. "
                "※ ルーター側で IPv6 が無効化されているだけの場合もあるので、"
                "ISP の契約種別と突き合わせて確定すること.",
                {"has_global": False,
                 "has_default_route": v6.get("has_default_route")})
        else:
            add("warn", "ipv6_absent_unverified",
                "IPv6 グローバルアドレスが無いが、自宅LAN上での計測と確認できないため "
                "接続方式 (PPPoE/IPoE) の判断材料にはしない.",
                {"has_global": False})
    elif not v6.get("reachable"):
        add("warn", "ipv6_broken",
            "IPv6 アドレスはあるが実通信に失敗. 経路またはフィルタの問題.",
            {"detail": v6.get("reach_detail")})

    # --- DNS
    r_dns = (dns.get("router") or {}).get("median_ms") if cov["gateway"] else None
    c_dns = (dns.get("cloudflare") or {}).get("median_ms")
    g_dns = (dns.get("google") or {}).get("median_ms")
    ext = [x for x in (c_dns, g_dns) if x is not None]
    if r_dns is not None and ext:
        best_ext = min(ext)
        if r_dns > best_ext * 2 and r_dns - best_ext > 20:
            add("warn", "dns_router_slow",
                f"ルーターDNS {r_dns} ms に対し外部 {best_ext} ms. "
                "DNS 変更で体感の初動が改善する.",
                {"router_ms": r_dns, "best_external_ms": best_ext})
        else:
            add("ok", "dns_ok",
                f"ルーターDNS {r_dns} ms / 外部 {best_ext} ms. DNS はボトルネックでない.",
                {"router_ms": r_dns, "best_external_ms": best_ext})

    # --- traceroute 2ホップ目
    hops = tr.get("hops") or []
    hop2 = next((h for h in hops if h["hop"] == 2), None)
    if hop2 is None:
        v["unmeasured"].append("traceroute 2ホップ目 (取得できず)")
    elif hop2["timeout"]:
        add("warn", "hop2_timeout",
            "2ホップ目が無応答. ICMP を返さない機器 (ONU/HGW/網終端) が居る可能性. "
            "これ単体では異常と断定できない.", {"hop2": hop2})
    else:
        if hop2.get("is_cgnat"):
            add("warn", "hop2_cgnat",
                f"2ホップ目 {hop2['ip']} が CGNAT 帯 (100.64/10). "
                "ISP 側で共有 IP を使っている.", {"hop2": hop2})
        elif hop2.get("is_private"):
            add("warn", "hop2_private",
                f"2ホップ目 {hop2['ip']} がプライベート IP. "
                "ルーターの下にもう1台 NAT 機器が居る (二重 NAT の疑い).",
                {"hop2": hop2})
        else:
            add("ok", "hop2_isp",
                f"2ホップ目 {hop2['ip']} は ISP 側グローバル IP "
                f"(RTT {hop2['rtt_avg_ms']} ms). 経路構成は想定どおり.",
                {"hop2": hop2})

    # --- スループット
    if single is not None and par is not None:
        ratio = par / single if single > 0 else None
        if ratio and ratio > 2.5:
            add("warn", "single_stream_limited",
                f"単一 {single} Mbps に対し6並列 {par} Mbps ({ratio:.1f}倍). "
                "1本あたりが絞られている. 輻輳や PPPoE セッション帯域を疑う.",
                {"single_mbps": single, "parallel_mbps": par, "ratio": round(ratio, 2)})
        else:
            add("ok", "single_stream_ok",
                f"単一 {single} Mbps / 6並列 {par} Mbps. "
                "並列化で伸びず、帯域そのものが上限.",
                {"single_mbps": single, "parallel_mbps": par})

    # --- バッファブロート
    rpm = bb.get("networkquality", {}).get("dl_rpm")
    ll = bb.get("loaded_latency", {}) or {}
    inc = ll.get("increase_ms")
    if rpm is not None:
        if rpm < 200:
            add("critical", "rpm_bad",
                f"RPM {rpm} は低い. バッファブロート発生. "
                "速度が出ていても体感は悪くなる.", {"dl_rpm": rpm})
        elif rpm < 1000:
            add("warn", "rpm_fair", f"RPM {rpm} は並. 改善余地あり.", {"dl_rpm": rpm})
        else:
            add("ok", "rpm_good", f"RPM {rpm} は良好. バッファブロートは無い.",
                {"dl_rpm": rpm})
    else:
        v["unmeasured"].append("networkQuality の RPM (macOS 以外 or 実行不可)")
    if inc is not None:
        if inc > 100:
            add("critical", "loaded_latency_bad",
                f"負荷時に遅延が +{inc} ms 悪化. バッファブロートの直接証拠. "
                "SQM/fq_codel が効く.",
                {"idle_ms": ll.get("idle_avg_ms"), "loaded_ms": ll.get("loaded_avg_ms")})
        elif inc > 30:
            add("warn", "loaded_latency_fair",
                f"負荷時に遅延が +{inc} ms 悪化. 軽度のバッファブロート.",
                {"idle_ms": ll.get("idle_avg_ms"), "loaded_ms": ll.get("loaded_avg_ms")})
        else:
            add("ok", "loaded_latency_ok",
                f"負荷時の遅延悪化は +{inc} ms のみ. キュー制御は健全.",
                {"idle_ms": ll.get("idle_avg_ms"), "loaded_ms": ll.get("loaded_avg_ms")})

    # --- ボトルネック総合判定 (実測値がある項目のみで決める)
    crit = [f for f in v["findings"] if f["severity"] == "critical"]
    order = ["wifi_saturated", "wifi_snr_bad", "wifi_rssi_bad", "gw_loss",
             "gw_latency_high", "ipv6_absent", "rpm_bad", "loaded_latency_bad"]
    labels = {
        "wifi_saturated": "電波 (Wi-Fi 区間が飽和)",
        "wifi_snr_bad": "電波 (SNR 不足)",
        "wifi_rssi_bad": "電波 (信号が弱い)",
        "gw_loss": "機器/電波 (LAN 内でロス)",
        "gw_latency_high": "機器 (ルーター応答が遅い)",
        "ipv6_absent": "回線の接続方式 (PPPoE 輻輳の疑い)",
        "rpm_bad": "バッファブロート (キュー制御)",
        "loaded_latency_bad": "バッファブロート (キュー制御)",
    }
    for code in order:
        if any(f["code"] == code for f in crit):
            v["bottleneck"] = labels[code]
            break
    if v["bottleneck"] is None:
        v["bottleneck"] = ("致命的な指標なし. 実測レンジ内では単一のボトルネックを"
                           "特定できない (契約帯域そのものが上限の可能性)")
    v["critical_count"] = len(crit)
    v["warn_count"] = len([f for f in v["findings"] if f["severity"] == "warn"])
    return v


# ---------------------------------------------------------------- compare

def load(path):
    with open(path) as f:
        return json.load(f)


def fmt(x, unit=""):
    return "n/a" if x is None else f"{x}{unit}"


def compare(paths):
    docs = [(p, load(p)) for p in paths]
    rows = [
        ("label",            lambda d: d.get("label")),
        ("timestamp",        lambda d: d.get("timestamp")),
        ("link type",        lambda d: d["wifi"].get("link_type")),
        ("RSSI dBm",         lambda d: d["wifi"].get("rssi_dbm")),
        ("noise dBm",        lambda d: d["wifi"].get("noise_dbm")),
        ("SNR dB",           lambda d: d["wifi"].get("snr_db")),
        ("link Mbps",        lambda d: d["wifi"].get("tx_rate_mbps")),
        ("PHY",              lambda d: d["wifi"].get("phy_mode")),
        ("ch / width",       lambda d: f'{d["wifi"].get("channel")}/'
                                       f'{d["wifi"].get("channel_width_mhz")}MHz'),
        ("IPv6 global",      lambda d: d["ipv6"].get("has_global")),
        ("IPv6 reachable",   lambda d: d["ipv6"].get("reachable")),
        ("GW avg ms",        lambda d: d["latency"]["gateway"].get("avg_ms")),
        ("GW loss %",        lambda d: d["latency"]["gateway"].get("loss_pct")),
        ("1.1.1.1 avg ms",   lambda d: d["latency"]["cloudflare"].get("avg_ms")),
        ("1.1.1.1 max ms",   lambda d: d["latency"]["cloudflare"].get("max_ms")),
        ("8.8.8.8 avg ms",   lambda d: d["latency"]["google"].get("avg_ms")),
        ("hop2 ip",          lambda d: next((h["ip"] for h in d["traceroute"]["hops"]
                                             if h["hop"] == 2), None)),
        ("DNS router ms",    lambda d: d["dns"]["router"].get("median_ms")),
        ("DNS 1.1.1.1 ms",   lambda d: d["dns"]["cloudflare"].get("median_ms")),
        ("DL single Mbps",   lambda d: d["throughput"]["single"].get("mbps")),
        ("DL x6 Mbps",       lambda d: d["throughput"]["parallel6"].get("mbps")),
        ("RPM (dl)",         lambda d: d["bufferbloat"]["networkquality"].get("dl_rpm")),
        ("idle ms",          lambda d: d["bufferbloat"]["loaded_latency"].get("idle_avg_ms")),
        ("loaded ms",        lambda d: d["bufferbloat"]["loaded_latency"].get("loaded_avg_ms")),
        ("bloat +ms",        lambda d: d["bufferbloat"]["loaded_latency"].get("increase_ms")),
        ("bottleneck",       lambda d: d["verdict"].get("bottleneck")),
    ]
    w0 = 18
    wn = max(24, max(len(os.path.basename(p)) for p, _ in docs) + 2)
    print("=" * (w0 + wn * len(docs)))
    print("metric".ljust(w0) + "".join(os.path.basename(p).ljust(wn) for p, _ in docs))
    print("-" * (w0 + wn * len(docs)))
    for name, getter in rows:
        cells = []
        for _, d in docs:
            try:
                cells.append(str(getter(d)))
            except (KeyError, TypeError):
                cells.append("n/a")
        print(name.ljust(w0) + "".join(c[:wn - 1].ljust(wn) for c in cells))
    print("=" * (w0 + wn * len(docs)))


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser(
        description="自宅ネットワークのボトルネックを実測で特定する",
        formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--label", default=None,
                    help="この計測につける名前 (例: before, after-ipoe, 5ghz-living)")
    ap.add_argument("--outdir", default="results", help="JSON の保存先 (既定: results)")
    ap.add_argument("--ping-count", type=int, default=10, help="各ターゲットへの ping 回数")
    ap.add_argument("--dl-seconds", type=int, default=10, help="各スループット計測の秒数")
    ap.add_argument("--dl-url", default=DEFAULT_DL_URL, help="ダウンロード計測用 URL")
    ap.add_argument("--skip", default="", help="スキップする項目をカンマ区切りで "
                    "(wifi,ipv6,latency,traceroute,dns,throughput,bufferbloat)")
    ap.add_argument("--quick", action="store_true",
                    help="短縮モード (ping 5回 / DL 5秒 / networkQuality 省略)")
    ap.add_argument("--compare", nargs="+", metavar="JSON",
                    help="保存済み JSON を並べて比較する")
    args = ap.parse_args()

    if args.compare:
        compare(args.compare)
        return 0

    if args.quick:
        args.ping_count = min(args.ping_count, 5)
        args.dl_seconds = min(args.dl_seconds, 5)

    skip = {s.strip() for s in args.skip.split(",") if s.strip()}
    if args.quick:
        skip.add("networkquality")

    label = args.label or "run"
    ts = datetime.now(timezone.utc).astimezone()

    log(f"netdiag: label={label} os={platform.system()}")
    doc = {
        "schema_version": SCHEMA_VERSION,
        "label": label,
        "timestamp": ts.isoformat(),
        "timestamp_utc": ts.astimezone(timezone.utc).isoformat(),
        "argv": sys.argv[1:],
        "env": collect_env(),
    }

    gw, gw_if = default_gateway()
    doc["gateway"] = {"ip": gw, "interface": gw_if}
    if gw is None:
        log("  ! デフォルトゲートウェイが取得できない. GW 依存の項目は欠測になる.")

    log("  [1/7] Wi-Fi ...")
    doc["wifi"] = {} if "wifi" in skip else collect_wifi()

    log("  [2/7] IPv6 ...")
    doc["ipv6"] = {} if "ipv6" in skip else collect_ipv6()

    log(f"  [3/7] 遅延 (ping x{args.ping_count}) ...")
    doc["latency"] = {} if "latency" in skip else collect_latency(gw, args.ping_count)

    log("  [4/7] traceroute ...")
    doc["traceroute"] = {} if "traceroute" in skip else collect_traceroute(4)

    log("  [5/7] DNS ...")
    doc["dns"] = {} if "dns" in skip else collect_dns(gw)

    doc["throughput"] = {}
    if "throughput" not in skip:
        doc["throughput"] = collect_throughput(args.dl_url, args.dl_seconds)

    doc["bufferbloat"] = {}
    if "bufferbloat" not in skip:
        log("  [7/7] バッファブロート (自前の負荷時遅延) ...")
        bb_url = (doc.get("throughput") or {}).get("chosen_url") or args.dl_url
        doc["bufferbloat"]["loaded_latency"] = loaded_latency(bb_url,
                                                              args.dl_seconds)
        if "networkquality" in skip:
            doc["bufferbloat"]["networkquality"] = {
                "available": have("networkQuality"), "error": "スキップ",
                "dl_rpm": None, "ul_rpm": None}
        else:
            log("  [7/7] networkQuality (最大2分) ...")
            doc["bufferbloat"]["networkquality"] = networkquality()

    doc["verdict"] = verdict(doc)

    os.makedirs(args.outdir, exist_ok=True)
    safe = re.sub(r"[^A-Za-z0-9._-]", "-", label)
    path = os.path.join(args.outdir,
                        f"{safe}_{ts.strftime('%Y%m%dT%H%M%S')}.json")
    with open(path, "w") as f:
        json.dump(doc, f, indent=2, ensure_ascii=False)
        f.write("\n")

    # --- 端末向けサマリ
    v = doc["verdict"]
    print()
    print("=" * 68)
    print(f"netdiag  label={label}  {ts.isoformat()}")
    print("=" * 68)
    cov = v.get("coverage", {})
    print(f"計測の成立: {'OK' if v.get('run_valid') else '不成立 (判定は保留)'}")
    if cov:
        print(f"  取得できた: {', '.join(cov.get('_measured') or []) or 'なし'}")
        print(f"  取れなかった: {', '.join(cov.get('_missing') or []) or 'なし'}")
    print("-" * 68)
    print(f"ボトルネック判定: {v['bottleneck']}")
    print(f"critical={v['critical_count']}  warn={v['warn_count']}")
    print("-" * 68)
    rank = {"critical": 0, "warn": 1, "ok": 2}
    for f_ in sorted(v["findings"], key=lambda x: rank.get(x["severity"], 9)):
        mark = {"critical": "[!!]", "warn": "[! ]", "ok": "[ok]"}[f_["severity"]]
        print(f"{mark} {f_['message']}")
    if v["unmeasured"]:
        print("-" * 68)
        print("未計測 (この環境では取得できなかった項目):")
        for u in v["unmeasured"]:
            print(f"  - {u}")
    print("=" * 68)
    print(f"保存: {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
