#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""netdiag.py — 自宅ネット回線をまとめて実測して JSON に残すツール。

使い方:
    python3 tools/netdiag.py run --label before-router-move
    python3 tools/netdiag.py compare results/A.json results/B.json

測るもの:
    wifi        信号強度 / ノイズ / SNR / リンク速度 / 規格 / チャンネル / 帯域幅
    ipv6        グローバルアドレスの有無 / デフォルト経路の有無 / 実到達性
    wan         接続先ISP(AS名) / 接続先PoP  ※IPoE判断の材料
    latency     GW・1.1.1.1・8.8.8.8 の平均/最大/ロス率/ジッタ
    route       traceroute 先頭4ホップ (IPと応答時間)
    dns         ルーター / 1.1.1.1 / 8.8.8.8 の応答時間比較
    throughput  単一接続DL と 6並列DL
    bufferbloat networkQuality の RPM とアイドル遅延 + 負荷時遅延の実測

設計方針:
    - 測れなかったものは status="unavailable" と reason を必ず残す。黙って0にしない。
    - すべてのセクションが同じ形なので、後から前後比較ができる。
    - 個人特定につながる値(グローバルIP / BSSID)は既定でマスクする。--no-redact で解除。
"""

import argparse
import concurrent.futures as futures
import json
import os
import platform
import random
import re
import socket
import struct
import subprocess
import sys
import threading
import time
import urllib.request
from datetime import datetime, timezone

SCHEMA_VERSION = 1
RAW_LIMIT = 4000

IS_MAC = platform.system() == "Darwin"
IS_LINUX = platform.system() == "Linux"

DEFAULT_DL_URL = "https://speed.cloudflare.com/__down?bytes=1000000000"
META_URL = "https://speed.cloudflare.com/meta"
DNS_PROBE_NAMES = ["www.google.com", "github.com", "www.yahoo.co.jp", "www.apple.com", "www.cloudflare.com"]


# ---------------------------------------------------------------- 共通ヘルパ

def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def trim(s):
    if not s:
        return ""
    s = s.strip()
    return s if len(s) <= RAW_LIMIT else s[:RAW_LIMIT] + "\n...(truncated)"


def run_cmd(cmd, timeout=20):
    """外部コマンドを叩く。落ちてもここで吸収して rc/out/err を返す。"""
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return {"rc": p.returncode, "out": p.stdout, "err": p.stderr}
    except FileNotFoundError:
        return {"rc": 127, "out": "", "err": "command not found: %s" % cmd[0]}
    except PermissionError as e:
        return {"rc": 126, "out": "", "err": str(e)}
    except subprocess.TimeoutExpired:
        return {"rc": 124, "out": "", "err": "timeout after %ss" % timeout}
    except Exception as e:  # 測定ツールが本体ごと落ちるのが一番困る
        return {"rc": 125, "out": "", "err": "%s: %s" % (type(e).__name__, e)}


def have(binname):
    for d in os.environ.get("PATH", "").split(os.pathsep):
        p = os.path.join(d, binname)
        if os.path.isfile(p) and os.access(p, os.X_OK):
            return p
    return None


def ok(data, raw=None, note=None):
    s = {"status": "ok", "data": data}
    if raw:
        s["raw"] = trim(raw)
    if note:
        s["note"] = note
    return s


def unavailable(reason, raw=None):
    s = {"status": "unavailable", "reason": reason, "data": {}}
    if raw:
        s["raw"] = trim(raw)
    return s


def partial(data, reason, raw=None):
    s = {"status": "partial", "reason": reason, "data": data}
    if raw:
        s["raw"] = trim(raw)
    return s


def fnum(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def mask_ip(ip, redact=True):
    if not ip or not redact:
        return ip
    if ":" in ip:  # IPv6 は上位3ブロックだけ残す
        parts = ip.split(":")
        return ":".join(parts[:3]) + ":xxxx(masked)"
    parts = ip.split(".")
    if len(parts) == 4:
        return ".".join(parts[:2]) + ".x.x(masked)"
    return "(masked)"


# ---------------------------------------------------------------- 経路の基本情報

def default_gateway_v4():
    """デフォルトゲートウェイのIPv4アドレスを取る。"""
    if IS_MAC:
        r = run_cmd(["route", "-n", "get", "default"], timeout=8)
        m = re.search(r"gateway:\s*([0-9.]+)", r["out"])
        if m:
            return m.group(1)
        r = run_cmd(["netstat", "-rn", "-f", "inet"], timeout=8)
        for line in r["out"].splitlines():
            f = line.split()
            if len(f) >= 2 and f[0] == "default" and re.match(r"^[0-9.]+$", f[1]):
                return f[1]
        return None
    r = run_cmd(["ip", "-4", "route", "show", "default"], timeout=8)
    m = re.search(r"default\s+via\s+([0-9.]+)", r["out"])
    if m:
        return m.group(1)
    r = run_cmd(["netstat", "-rn"], timeout=8)
    for line in r["out"].splitlines():
        f = line.split()
        if len(f) >= 2 and f[0] in ("default", "0.0.0.0") and re.match(r"^[0-9.]+$", f[1]):
            return f[1]
    return None


# ---------------------------------------------------------------- Wi-Fi

def _walk_find(obj, key):
    """ネストしたJSONから、指定キーを持つ dict を最初に1つ見つける。"""
    if isinstance(obj, dict):
        if key in obj:
            return obj
        for v in obj.values():
            found = _walk_find(v, key)
            if found is not None:
                return found
    elif isinstance(obj, list):
        for v in obj:
            found = _walk_find(v, key)
            if found is not None:
                return found
    return None


def measure_wifi(redact=True):
    if IS_MAC:
        return _wifi_mac(redact)
    if IS_LINUX:
        return _wifi_linux(redact)
    return unavailable("unsupported platform: %s" % platform.system())


def _wifi_mac(redact):
    if not have("system_profiler"):
        return unavailable("system_profiler が無い (macOS 以外か PATH の問題)")
    r = run_cmd(["system_profiler", "SPAirPortDataType", "-json"], timeout=45)
    if r["rc"] != 0:
        return unavailable("system_profiler 失敗: %s" % (r["err"] or r["rc"]), raw=r["out"])
    try:
        doc = json.loads(r["out"])
    except json.JSONDecodeError as e:
        return unavailable("system_profiler のJSONを解釈できない: %s" % e, raw=r["out"])

    cur = _walk_find(doc, "spairport_signal_noise")
    if cur is None:
        return unavailable("現在接続中のWi-Fi情報が見つからない (Wi-Fiオフ / 有線接続 / 権限不足の可能性)",
                           raw=r["out"][:RAW_LIMIT])

    data = {"ssid": cur.get("_name")}

    sn = cur.get("spairport_signal_noise", "")
    m = re.search(r"(-?\d+)\s*dBm\s*/\s*(-?\d+)\s*dBm", sn)
    if m:
        rssi, noise = int(m.group(1)), int(m.group(2))
        data["rssi_dbm"] = rssi
        data["noise_dbm"] = noise
        data["snr_db"] = rssi - noise
    else:
        data["signal_noise_raw"] = sn

    ch = cur.get("spairport_network_channel", "")
    m = re.search(r"^(\d+)", ch.strip())
    if m:
        data["channel"] = int(m.group(1))
    m = re.search(r"(\d+)\s*MHz", ch)
    if m:
        data["width_mhz"] = int(m.group(1))
    m = re.search(r"(2\.4|5|6)\s*GHz", ch)
    if m:
        data["band_ghz"] = m.group(1)
    data["channel_raw"] = ch

    data["phy_mode"] = cur.get("spairport_network_phymode")
    data["tx_rate_mbps"] = fnum(cur.get("spairport_network_rate"))
    data["security"] = cur.get("spairport_security_mode")

    # BSSID は sudo 無しでは取れない。取れたときだけ入れる(既定はマスク)。
    w = run_cmd(["sudo", "-n", "wdutil", "info"], timeout=20)
    if w["rc"] == 0:
        m = re.search(r"BSSID\s*:\s*([0-9a-fA-F:]{17})", w["out"])
        if m:
            data["bssid"] = "(masked)" if redact else m.group(1)
        m = re.search(r"RSSI\s*:\s*(-?\d+)", w["out"])
        if m and "rssi_dbm" not in data:
            data["rssi_dbm"] = int(m.group(1))
    else:
        data["bssid"] = None
        data["bssid_note"] = "BSSID は sudo が要る (sudo wdutil info)。今回は未取得。"

    return ok(data, raw=r["out"][:RAW_LIMIT])


def _wifi_linux(redact):
    iw = have("iw")
    if not iw:
        return unavailable("iw が無い (無線が無い環境か、iw 未インストール)")
    r = run_cmd([iw, "dev"], timeout=10)
    m = re.search(r"Interface\s+(\S+)", r["out"])
    if not m:
        return unavailable("無線インターフェースが見つからない", raw=r["out"])
    dev = m.group(1)

    link = run_cmd([iw, "dev", dev, "link"], timeout=10)
    if "Not connected" in link["out"]:
        return unavailable("Wi-Fi 未接続 (dev=%s)" % dev, raw=link["out"])

    data = {"interface": dev}
    m = re.search(r"SSID:\s*(.+)", link["out"])
    if m:
        data["ssid"] = m.group(1).strip()
    m = re.search(r"signal:\s*(-?\d+)\s*dBm", link["out"])
    if m:
        data["rssi_dbm"] = int(m.group(1))
    m = re.search(r"tx bitrate:\s*([\d.]+)\s*MBit/s", link["out"])
    if m:
        data["tx_rate_mbps"] = float(m.group(1))
    m = re.search(r"freq:\s*(\d+)", link["out"])
    if m:
        data["freq_mhz"] = int(m.group(1))
    m = re.search(r"^Connected to ([0-9a-fA-F:]{17})", link["out"], re.M)
    if m:
        data["bssid"] = "(masked)" if redact else m.group(1)

    info = run_cmd([iw, "dev", dev, "info"], timeout=10)
    m = re.search(r"channel\s+(\d+).*?width:\s*(\d+)\s*MHz", info["out"], re.S)
    if m:
        data["channel"] = int(m.group(1))
        data["width_mhz"] = int(m.group(2))

    # Linux の iw はノイズフロアを直接出さない。survey から拾う。
    surv = run_cmd([iw, "dev", dev, "survey", "dump"], timeout=10)
    blocks = surv["out"].split("Survey data from")
    for b in blocks:
        if "[in use]" in b:
            m = re.search(r"noise:\s*(-?\d+)\s*dBm", b)
            if m:
                data["noise_dbm"] = int(m.group(1))
    if "rssi_dbm" in data and "noise_dbm" in data:
        data["snr_db"] = data["rssi_dbm"] - data["noise_dbm"]
    else:
        data["snr_note"] = "ノイズフロアが取得できず SNR は未算出"

    return ok(data, raw=link["out"])


# ---------------------------------------------------------------- IPv6

def measure_ipv6(redact=True):
    data = {}
    raws = []

    # 1) グローバルアドレスの有無
    addrs = []
    if IS_MAC:
        r = run_cmd(["ifconfig", "-a"], timeout=10)
        raws.append(r["out"])
        for m in re.finditer(r"inet6\s+([0-9a-fA-F:]+)(?:%\w+)?", r["out"]):
            addrs.append(m.group(1))
    else:
        r = run_cmd(["ip", "-6", "addr", "show"], timeout=10)
        raws.append(r["out"])
        for m in re.finditer(r"inet6\s+([0-9a-fA-F:]+)/", r["out"]):
            addrs.append(m.group(1))

    globals_ = []
    ulas = []
    for a in addrs:
        al = a.lower()
        if al.startswith("fe80") or al in ("::1",):
            continue
        if al.startswith("fc") or al.startswith("fd"):  # ULA はグローバルではない
            ulas.append(a)
            continue
        globals_.append(a)

    data["has_global_address"] = len(globals_) > 0
    data["global_addresses"] = [mask_ip(a, redact) for a in globals_]
    data["ula_addresses"] = [mask_ip(a, redact) for a in ulas]

    # 2) デフォルト経路の有無
    if IS_MAC:
        r = run_cmd(["netstat", "-rn", "-f", "inet6"], timeout=10)
    else:
        r = run_cmd(["ip", "-6", "route", "show", "default"], timeout=10)
    raws.append(r["out"])
    has_route = bool(re.search(r"^default\s+\S+", r["out"], re.M)) or bool(
        re.search(r"^default via", r["out"], re.M))
    data["has_default_route"] = has_route

    # 3) 実際に届くか (これが本命。アドレスがあっても届かないことがある)
    reach = _tcp_connect_ms("2606:4700:4700::1111", 443, socket.AF_INET6, timeout=5)
    data["reachable_v6"] = reach is not None
    data["reach_rtt_ms"] = reach
    data["reach_target"] = "2606:4700:4700::1111:443 (Cloudflare DNS over IPv6)"

    status = "ok"
    if not data["has_global_address"] and not has_route:
        note = "IPv6 が全く降りてきていない。PPPoE 接続の可能性が高い(要確認)。"
    elif data["has_global_address"] and not data["reachable_v6"]:
        note = "アドレスはあるが外に届かない。経路 or ファイアウォールの問題。"
    elif data["reachable_v6"]:
        note = "IPv6 で外部到達できている。IPoE(IPv6)が有効。"
    else:
        note = "部分的にしか成立していない。"
    return ok(data, raw="\n---\n".join(raws), note=note)


def _tcp_connect_ms(host, port, family, timeout=5):
    try:
        s = socket.socket(family, socket.SOCK_STREAM)
        s.settimeout(timeout)
        t0 = time.perf_counter()
        s.connect((host, port))
        dt = (time.perf_counter() - t0) * 1000
        s.close()
        return round(dt, 2)
    except Exception:
        return None


# ---------------------------------------------------------------- WAN(ISP判定)

def measure_wan(redact=True, timeout=15):
    """接続先ISPを特定する。IPoE化の相談先を決めるのに要る。"""
    try:
        req = urllib.request.Request(META_URL, headers={"User-Agent": "netdiag/1.0"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            meta = json.loads(resp.read().decode("utf-8", "replace"))
    except Exception as e:
        return unavailable("ISP情報の取得に失敗: %s: %s" % (type(e).__name__, e))
    data = {
        "client_ip": mask_ip(meta.get("clientIp"), redact),
        "asn": meta.get("asn"),
        "as_organization": meta.get("asOrganization"),
        "colo": meta.get("colo"),
        "country": meta.get("country"),
    }
    return ok(data)


# ---------------------------------------------------------------- 遅延

def _ping(host, count, timeout_total):
    if IS_MAC:
        cmd = ["ping", "-c", str(count), "-W", "2000", host]
    else:
        cmd = ["ping", "-c", str(count), "-W", "2", host]
    r = run_cmd(cmd, timeout=timeout_total)
    out = r["out"] + "\n" + r["err"]
    d = {"host": host}
    m = re.search(r"([\d.]+)%\s*packet loss", out)
    d["loss_pct"] = fnum(m.group(1)) if m else None
    m = re.search(r"(?:round-trip|rtt)\s+min/avg/max/(?:stddev|mdev)\s*=\s*"
                  r"([\d.]+)/([\d.]+)/([\d.]+)/([\d.]+)", out)
    if m:
        d["min_ms"] = float(m.group(1))
        d["avg_ms"] = float(m.group(2))
        d["max_ms"] = float(m.group(3))
        d["jitter_ms"] = float(m.group(4))
    d["sent"] = count
    d["raw"] = trim(out)
    d["ok"] = d.get("avg_ms") is not None
    return d


def measure_latency(gateway, count=20):
    if not have("ping"):
        return unavailable("ping が無い")
    targets = []
    if gateway:
        targets.append(("gateway", gateway))
    else:
        targets.append(("gateway", None))
    targets.append(("1.1.1.1", "1.1.1.1"))
    targets.append(("8.8.8.8", "8.8.8.8"))

    results = {}
    budget = count * 1.2 + 15
    with futures.ThreadPoolExecutor(max_workers=3) as ex:
        futs = {}
        for name, host in targets:
            if host is None:
                results[name] = {"ok": False, "reason": "デフォルトゲートウェイを特定できなかった"}
                continue
            futs[ex.submit(_ping, host, count, budget)] = name
        for f in futures.as_completed(futs):
            results[futs[f]] = f.result()

    failed = [k for k, v in results.items() if not v.get("ok")]
    if len(failed) == len(results):
        return unavailable("全ターゲットで ping 失敗", raw=json.dumps(results, ensure_ascii=False)[:RAW_LIMIT])
    if failed:
        return partial(results, "一部失敗: %s" % ", ".join(failed))
    return ok(results)


# ---------------------------------------------------------------- 経路

def measure_route(target="8.8.8.8", max_hops=4):
    tr = have("traceroute")
    if not tr:
        return unavailable("traceroute が無い")
    r = run_cmd([tr, "-n", "-q", "1", "-w", "2", "-m", str(max_hops), target], timeout=60)
    out = r["out"] + r["err"]
    hops = []
    for line in out.splitlines():
        m = re.match(r"\s*(\d+)\s+(.*)$", line)
        if not m:
            continue
        n = int(m.group(1))
        rest = m.group(2)
        ipm = re.search(r"(\d+\.\d+\.\d+\.\d+)", rest)
        tm = re.search(r"([\d.]+)\s*ms", rest)
        hops.append({
            "hop": n,
            "ip": ipm.group(1) if ipm else None,
            "rtt_ms": float(tm.group(1)) if tm else None,
            "timeout": "*" in rest and not ipm,
        })
    if not hops:
        return unavailable("traceroute の出力を解釈できなかった", raw=out)
    return ok({"target": target, "hops": hops}, raw=out)


# ---------------------------------------------------------------- DNS

def _dns_query_ms(server, qname, timeout=2.0):
    """外部ツールに依存せず、素のUDPでDNSを引いて往復時間を測る。"""
    tid = random.randint(0, 0xFFFF)
    header = struct.pack(">HHHHHH", tid, 0x0100, 1, 0, 0, 0)
    qparts = b"".join(bytes([len(p)]) + p.encode("idna") for p in qname.split(".")) + b"\x00"
    pkt = header + qparts + struct.pack(">HH", 1, 1)  # A / IN
    fam = socket.AF_INET6 if ":" in server else socket.AF_INET
    s = socket.socket(fam, socket.SOCK_DGRAM)
    s.settimeout(timeout)
    try:
        t0 = time.perf_counter()
        s.sendto(pkt, (server, 53))
        deadline = t0 + timeout
        while True:
            data, _ = s.recvfrom(4096)
            if len(data) >= 12 and struct.unpack(">H", data[:2])[0] == tid:
                break
            if time.perf_counter() > deadline:
                raise socket.timeout("no matching response")
        dt = (time.perf_counter() - t0) * 1000
        rcode = data[3] & 0x0F
        ancount = struct.unpack(">H", data[6:8])[0]
        return {"ms": round(dt, 2), "rcode": rcode, "answers": ancount}
    except Exception as e:
        return {"ms": None, "error": "%s: %s" % (type(e).__name__, e)}
    finally:
        s.close()


def measure_dns(gateway, repeats=1):
    servers = {}
    if gateway:
        servers["router"] = gateway
    servers["1.1.1.1"] = "1.1.1.1"
    servers["8.8.8.8"] = "8.8.8.8"

    out = {}
    for name, ip in servers.items():
        samples = []
        errors = []
        for _ in range(repeats):
            for qname in DNS_PROBE_NAMES:
                res = _dns_query_ms(ip, qname)
                if res.get("ms") is not None:
                    samples.append(res["ms"])
                else:
                    errors.append("%s: %s" % (qname, res.get("error")))
        if samples:
            samples_sorted = sorted(samples)
            out[name] = {
                "server": ip,
                "queries": len(samples),
                "avg_ms": round(sum(samples) / len(samples), 2),
                "median_ms": samples_sorted[len(samples_sorted) // 2],
                "min_ms": samples_sorted[0],
                "max_ms": samples_sorted[-1],
                "failures": len(errors),
            }
        else:
            out[name] = {"server": ip, "queries": 0, "avg_ms": None,
                         "failures": len(errors), "errors": errors[:3]}
    if all(v.get("avg_ms") is None for v in out.values()):
        return unavailable("全DNSサーバで応答なし (UDP 53 が塞がれている可能性)",
                           raw=json.dumps(out, ensure_ascii=False)[:RAW_LIMIT])
    return ok(out)


# ---------------------------------------------------------------- スループット

class _Counter:
    def __init__(self):
        self.n = 0
        self.lock = threading.Lock()

    def add(self, k):
        with self.lock:
            self.n += k


def _download_stream(url, seconds, counter, stop_evt, warm_after=1.0, timeout=20):
    """指定秒数だけ読み続け、読んだバイト数を counter に足す。"""
    got_after_warm = 0
    t_warm = None
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "netdiag/1.0",
                                                   "Cache-Control": "no-cache"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            t0 = time.perf_counter()
            while not stop_evt.is_set():
                chunk = resp.read(65536)
                if not chunk:
                    break
                counter.add(len(chunk))
                el = time.perf_counter() - t0
                if el >= warm_after:
                    if t_warm is None:
                        t_warm = time.perf_counter()
                    else:
                        got_after_warm += len(chunk)
                if el >= seconds:
                    break
    except Exception as e:
        return {"error": "%s: %s" % (type(e).__name__, e), "warm_bytes": got_after_warm,
                "warm_start": t_warm}
    return {"error": None, "warm_bytes": got_after_warm, "warm_start": t_warm}


def _run_download(url, streams, seconds):
    counter = _Counter()
    stop = threading.Event()
    t0 = time.perf_counter()
    errs = []
    with futures.ThreadPoolExecutor(max_workers=streams) as ex:
        futs = [ex.submit(_download_stream, url, seconds, counter, stop) for _ in range(streams)]
        for f in futures.as_completed(futs, timeout=seconds + 40):
            try:
                r = f.result()
                if r.get("error"):
                    errs.append(r["error"])
            except Exception as e:
                errs.append("%s: %s" % (type(e).__name__, e))
    elapsed = time.perf_counter() - t0
    mbps = (counter.n * 8) / elapsed / 1e6 if elapsed > 0 else None
    return {
        "streams": streams,
        "bytes": counter.n,
        "seconds": round(elapsed, 2),
        "mbps": round(mbps, 2) if mbps is not None else None,
        "errors": errs[:3],
    }


def measure_throughput(url, seconds=10):
    single = _run_download(url, 1, seconds)
    time.sleep(2)  # キューを吐かせてから並列を測る
    parallel = _run_download(url, 6, seconds)

    data = {"url": url, "single": single, "parallel6": parallel}
    if single["bytes"] == 0 and parallel["bytes"] == 0:
        return unavailable("ダウンロードが全く成立しなかった: %s" %
                           (single["errors"] or parallel["errors"]),
                           raw=json.dumps(data, ensure_ascii=False)[:RAW_LIMIT])
    if single["mbps"] and parallel["mbps"]:
        data["parallel_gain"] = round(parallel["mbps"] / single["mbps"], 2)
    if single["errors"] or parallel["errors"]:
        return partial(data, "一部のストリームでエラー")
    return ok(data)


# ---------------------------------------------------------------- バッファブロート

def measure_bufferbloat(url, idle_latency, seconds=10):
    data = {}
    notes = []

    # (a) macOS の networkQuality。RPM が本命。
    nq = have("networkQuality")
    if nq:
        r = run_cmd([nq, "-c"], timeout=180)
        if r["rc"] == 0 and r["out"].strip():
            try:
                j = json.loads(r["out"])
                data["network_quality"] = {
                    "dl_rpm": j.get("dl_responsiveness"),
                    "ul_rpm": j.get("ul_responsiveness"),
                    "dl_throughput_mbps": round(j["dl_throughput"] / 1e6, 2) if j.get("dl_throughput") else None,
                    "ul_throughput_mbps": round(j["ul_throughput"] / 1e6, 2) if j.get("ul_throughput") else None,
                    "base_rtt_ms": j.get("base_rtt"),
                    "responsiveness": j.get("responsiveness"),
                }
            except json.JSONDecodeError:
                data["network_quality_error"] = "JSON を解釈できなかった"
                notes.append(trim(r["out"]))
        else:
            data["network_quality_error"] = r["err"] or ("rc=%s" % r["rc"])
    else:
        data["network_quality_error"] = "networkQuality が無い (macOS 12 未満 or 非macOS)"

    # (b) どの環境でも測れる代替: 6並列DL中の遅延上昇。これがバッファブロートの実体。
    if have("ping"):
        counter = _Counter()
        stop = threading.Event()
        ping_res = {}

        def _pinger():
            ping_res.update(_ping("1.1.1.1", seconds + 2, seconds + 25))

        th = threading.Thread(target=_pinger)
        th.start()
        _run_download(url, 6, seconds)
        th.join(timeout=seconds + 30)

        loaded = ping_res.get("avg_ms")
        base = None
        if isinstance(idle_latency, dict):
            base = (idle_latency.get("1.1.1.1") or {}).get("avg_ms")
        data["loaded_latency"] = {
            "target": "1.1.1.1",
            "idle_avg_ms": base,
            "loaded_avg_ms": loaded,
            "loaded_max_ms": ping_res.get("max_ms"),
            "loss_pct": ping_res.get("loss_pct"),
        }
        if base is not None and loaded is not None:
            data["loaded_latency"]["delta_ms"] = round(loaded - base, 2)
    else:
        data["loaded_latency_error"] = "ping が無いので負荷時遅延を測れない"

    if not data.get("network_quality") and not data.get("loaded_latency"):
        return unavailable("RPM も負荷時遅延も測れなかった")
    if not data.get("network_quality"):
        return partial(data, "networkQuality が使えないため RPM は未取得。負荷時遅延で代替。")
    return ok(data, note="; ".join(notes) if notes else None)


# ---------------------------------------------------------------- 実行

def cmd_run(args):
    started = now_iso()
    t_start = time.time()
    redact = not args.no_redact

    print("[netdiag] label=%s platform=%s" % (args.label, platform.system()), file=sys.stderr)

    gateway = default_gateway_v4()
    print("[netdiag] default gateway: %s" % (gateway or "(不明)"), file=sys.stderr)

    sections = {}

    steps = [
        ("wifi", lambda: measure_wifi(redact)),
        ("ipv6", lambda: measure_ipv6(redact)),
        ("wan", lambda: measure_wan(redact)),
        ("latency", lambda: measure_latency(gateway, args.ping_count)),
        ("route", lambda: measure_route(args.route_target, 4)),
        ("dns", lambda: measure_dns(gateway, args.dns_repeats)),
        ("throughput", lambda: measure_throughput(args.url, args.dl_seconds)),
    ]
    for name, fn in steps:
        if name in args.skip:
            sections[name] = unavailable("--skip で除外")
            continue
        print("[netdiag] measuring %s ..." % name, file=sys.stderr)
        try:
            sections[name] = fn()
        except Exception as e:
            sections[name] = unavailable("測定中に例外: %s: %s" % (type(e).__name__, e))
        print("[netdiag]   -> %s" % sections[name]["status"], file=sys.stderr)

    if "bufferbloat" in args.skip:
        sections["bufferbloat"] = unavailable("--skip で除外")
    else:
        print("[netdiag] measuring bufferbloat ...", file=sys.stderr)
        try:
            sections["bufferbloat"] = measure_bufferbloat(
                args.url, sections.get("latency", {}).get("data"), args.dl_seconds)
        except Exception as e:
            sections["bufferbloat"] = unavailable("測定中に例外: %s: %s" % (type(e).__name__, e))
        print("[netdiag]   -> %s" % sections["bufferbloat"]["status"], file=sys.stderr)

    doc = {
        "schema_version": SCHEMA_VERSION,
        "label": args.label,
        "note": args.note,
        "started_at": started,
        "finished_at": now_iso(),
        "duration_sec": round(time.time() - t_start, 1),
        "host": {
            "os": platform.system(),
            "release": platform.release(),
            "machine": platform.machine(),
            "python": platform.python_version(),
            "hostname": "(masked)" if redact else socket.gethostname(),
        },
        "config": {
            "ping_count": args.ping_count,
            "dl_seconds": args.dl_seconds,
            "url": args.url,
            "route_target": args.route_target,
            "redacted": redact,
        },
        "default_gateway": gateway,
        "sections": sections,
        "summary": build_summary(sections),
    }

    os.makedirs(args.out, exist_ok=True)
    safe = re.sub(r"[^A-Za-z0-9._-]+", "-", args.label).strip("-") or "unlabeled"
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = os.path.join(args.out, "%s_%s.json" % (stamp, safe))
    with open(path, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print_summary(doc)
    print("\n保存先: %s" % path)
    return 0


FLAT_METRICS = [
    ("wifi.rssi_dbm", "Wi-Fi 信号 (dBm)"),
    ("wifi.noise_dbm", "Wi-Fi ノイズ (dBm)"),
    ("wifi.snr_db", "Wi-Fi SNR (dB)"),
    ("wifi.tx_rate_mbps", "リンク速度 (Mbps)"),
    ("wifi.phy_mode", "規格"),
    ("wifi.channel", "チャンネル"),
    ("wifi.width_mhz", "帯域幅 (MHz)"),
    ("ipv6.has_global_address", "IPv6 グローバルaddr"),
    ("ipv6.has_default_route", "IPv6 デフォルト経路"),
    ("ipv6.reachable_v6", "IPv6 到達性"),
    ("wan.as_organization", "ISP (AS名)"),
    ("latency.gateway.avg_ms", "GW 平均 (ms)"),
    ("latency.gateway.loss_pct", "GW ロス (%)"),
    ("latency.1.1.1.1.avg_ms", "1.1.1.1 平均 (ms)"),
    ("latency.1.1.1.1.max_ms", "1.1.1.1 最大 (ms)"),
    ("latency.1.1.1.1.loss_pct", "1.1.1.1 ロス (%)"),
    ("latency.8.8.8.8.avg_ms", "8.8.8.8 平均 (ms)"),
    ("latency.8.8.8.8.loss_pct", "8.8.8.8 ロス (%)"),
    ("dns.router.avg_ms", "DNS ルーター (ms)"),
    ("dns.1.1.1.1.avg_ms", "DNS 1.1.1.1 (ms)"),
    ("dns.8.8.8.8.avg_ms", "DNS 8.8.8.8 (ms)"),
    ("throughput.single.mbps", "単一接続DL (Mbps)"),
    ("throughput.parallel6.mbps", "6並列DL (Mbps)"),
    ("throughput.parallel_gain", "並列/単一 比"),
    ("bufferbloat.network_quality.dl_rpm", "DL RPM"),
    ("bufferbloat.network_quality.ul_rpm", "UL RPM"),
    ("bufferbloat.network_quality.base_rtt_ms", "base RTT (ms)"),
    ("bufferbloat.loaded_latency.idle_avg_ms", "アイドル遅延 (ms)"),
    ("bufferbloat.loaded_latency.loaded_avg_ms", "負荷時遅延 (ms)"),
    ("bufferbloat.loaded_latency.delta_ms", "遅延上昇 (ms)"),
]


def dig_path(sections, dotted):
    """'latency.1.1.1.1.avg_ms' のようなキーを、区切りが曖昧でも辿る。"""
    parts = dotted.split(".")
    sec = parts[0]
    rest = parts[1:]
    node = sections.get(sec, {}).get("data")
    if node is None:
        return None
    # IPアドレスがキーに混ざるので、後ろから最長一致で辿る
    i = 0
    while i < len(rest):
        if not isinstance(node, dict):
            return None
        matched = None
        for j in range(len(rest), i, -1):
            k = ".".join(rest[i:j])
            if k in node:
                matched = (k, j)
                break
        if matched is None:
            return None
        node = node[matched[0]]
        i = matched[1]
    return node


def build_summary(sections):
    s = {}
    for key, label in FLAT_METRICS:
        s[key] = dig_path(sections, key)
    s["_status"] = {k: v.get("status") for k, v in sections.items()}
    return s


def print_summary(doc):
    print("\n===== netdiag: %s (%s) =====" % (doc["label"], doc["finished_at"]))
    for key, label in FLAT_METRICS:
        v = doc["summary"].get(key)
        print("  %-22s %s" % (label, "—(未取得)" if v is None else v))
    print("\n  セクション状態:")
    for k, v in doc["summary"]["_status"].items():
        sec = doc["sections"][k]
        extra = ""
        if v != "ok":
            extra = "  <- %s" % sec.get("reason", "")
        print("    %-12s %-12s%s" % (k, v, extra))


def cmd_compare(args):
    docs = []
    for p in (args.a, args.b):
        with open(p, encoding="utf-8") as f:
            docs.append(json.load(f))
    a, b = docs
    print("A: %-28s %s" % (a["label"], a["finished_at"]))
    print("B: %-28s %s" % (b["label"], b["finished_at"]))
    print()
    print("%-24s %14s %14s %12s" % ("指標", "A", "B", "変化"))
    print("-" * 68)
    for key, label in FLAT_METRICS:
        va = a.get("summary", {}).get(key)
        vb = b.get("summary", {}).get(key)
        if va is None and vb is None:
            continue
        delta = ""
        if isinstance(va, (int, float)) and isinstance(vb, (int, float)) \
                and not isinstance(va, bool) and not isinstance(vb, bool):
            d = vb - va
            pct = (d / va * 100) if va else None
            delta = "%+.2f" % d
            if pct is not None:
                delta += " (%+.0f%%)" % pct
        elif va != vb:
            delta = "変化あり"
        print("%-24s %14s %14s %12s" % (label,
                                        "—" if va is None else va,
                                        "—" if vb is None else vb,
                                        delta))
    return 0



# ---------------------------------------------------------------- 判定

"""判定に使うしきい値。根拠が説明できない数字は置かない。

RSSI      -60 以上=良好 / -70 未満=弱い。Wi-Fi の実効速度が落ち始めるのがこの辺り。
SNR       30dB 以上で最高変調(高いMCS)が乗る。20dB を切ると変調が落ちて速度が出ない。
GW遅延    有線なら 1ms 前後。無線で 5ms を超えるのは再送が起きているサイン。
実効/PHY  実効スループットは PHY リンク速度の 4〜5割が上限。3.5割出ていれば無線は使い切っている。
RPM       Apple の目安で 1000 未満は low。300 未満は体感がはっきり悪化する。
負荷時遅延 アイドル比 +100ms 超はバッファブロートとして明確。
"""
TH = {
    "rssi_good": -60, "rssi_bad": -70,
    "snr_good": 30, "snr_bad": 20,
    "gw_ms_good": 3.0, "gw_ms_bad": 5.0,
    "wan_ms_bad": 30.0,
    "phy_ratio_saturated": 0.35, "phy_ratio_idle": 0.15,
    "rpm_low": 1000, "rpm_severe": 300,
    "bloat_delta_bad": 100.0,
    "parallel_gain_suspicious": 1.8,
}

SEV_ORDER = {"critical": 0, "major": 1, "minor": 2, "info": 3, "unknown": 4}


def _f(summary, key):
    v = summary.get(key)
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def diagnose(doc):
    """実測値からボトルネックを判定する。値が無いものは unknown として明示的に残す。"""
    s = doc.get("summary", {})
    sections = doc.get("sections", {})
    F = []          # findings
    unverified = [] # 測れなかったので判断できないもの

    def add(sev, area, verdict, evidence):
        F.append({"severity": sev, "area": area, "verdict": verdict, "evidence": evidence})

    for name, sec in sections.items():
        if sec.get("status") == "unavailable":
            unverified.append("%s: %s" % (name, sec.get("reason", "理由不明")))

    rssi = _f(s, "wifi.rssi_dbm")
    snr = _f(s, "wifi.snr_db")
    rate = _f(s, "wifi.tx_rate_mbps")
    width = _f(s, "wifi.width_mhz")
    band = s.get("wifi.band_ghz")
    single = _f(s, "throughput.single.mbps")
    par6 = _f(s, "throughput.parallel6.mbps")
    gain = _f(s, "throughput.parallel_gain")
    gw = _f(s, "latency.gateway.avg_ms")
    gw_loss = _f(s, "latency.gateway.loss_pct")
    wan = _f(s, "latency.1.1.1.1.avg_ms")
    wan_max = _f(s, "latency.1.1.1.1.max_ms")
    wan_loss = _f(s, "latency.1.1.1.1.loss_pct")
    rpm = _f(s, "bufferbloat.network_quality.dl_rpm")
    bloat = _f(s, "bufferbloat.loaded_latency.delta_ms")

    # --- 1. 電波そのもの ---
    wifi_weak = None
    if rssi is None:
        add("unknown", "電波", "Wi-Fi 情報が取れておらず、電波の良し悪しを判断できない",
            ["wifi セクション未取得"])
    else:
        ev = ["RSSI %s dBm" % rssi]
        if snr is not None:
            ev.append("SNR %s dB" % snr)
        if rssi < TH["rssi_bad"] or (snr is not None and snr < TH["snr_bad"]):
            wifi_weak = True
            add("major", "電波", "電波が弱い/ノイズが高い。ここが速度低下の一因になっている", ev)
        elif rssi < TH["rssi_good"] or (snr is not None and snr < 25):
            wifi_weak = False
            add("minor", "電波", "電波はやや弱いが、致命的ではない", ev)
        else:
            wifi_weak = False
            add("info", "電波", "電波は良好。置き場所やチャンネル変更で改善する余地はない", ev)

    # --- 2. 無線区間を使い切れているか (電波 vs 上位のどちらが犯人か) ---
    if rate and par6:
        ratio = par6 / rate
        ev = ["PHYリンク速度 %s Mbps" % rate, "6並列DL %s Mbps" % par6,
              "実効/PHY = %.2f" % ratio]
        if ratio >= TH["phy_ratio_saturated"]:
            if wifi_weak:
                # 電波が弱いと PHY リンク速度そのものが下がる。
                # 「上限を使い切っている」ことは Wi-Fi が無罪である根拠にならない。
                add("major", "電波",
                    "低いリンク速度を使い切っている状態。電波が弱いせいでリンク速度自体が"
                    "%s Mbps まで落ちている。電波を改善すればリンク速度ごと上がる" % int(rate), ev)
            else:
                add("info", "切り分け",
                    "無線区間は上限近くまで使い切っている。ボトルネックは Wi-Fi ではなく、"
                    "リンク速度そのもの(規格・帯域幅)か、その先", ev)
        elif ratio < TH["phy_ratio_idle"]:
            if wifi_weak:
                add("major", "切り分け",
                    "無線に余裕があるのに速度が出ていない。電波の弱さによる再送が効いている可能性", ev)
            else:
                add("critical", "切り分け",
                    "電波は良好で無線区間にも余裕があるのに速度が出ていない。"
                    "ボトルネックは宅内の無線ではなく、その先(回線の接続方式・ISP・建物の共用部分)", ev)
        else:
            add("minor", "切り分け", "無線区間は部分的にしか使えていない", ev)
    else:
        add("unknown", "切り分け",
            "リンク速度か実測スループットが欠けており、電波と回線のどちらが犯人か切り分けできない",
            ["tx_rate=%s, parallel6=%s" % (rate, par6)])

    # --- 3. リンク速度の頭打ち (規格・帯域幅) ---
    if band == "2.4":
        add("major", "機器",
            "2.4GHz に接続している。規格上ここが天井になる。5GHz/6GHz に繋ぎ替えるべき",
            ["band 2.4GHz", "channel %s" % s.get("wifi.channel")])
    elif width is not None and band in ("5", "6") and width <= 40:
        add("major", "機器",
            "5GHz なのに帯域幅が %sMHz しか出ていない。80/160MHz が使えれば数倍になる" % int(width),
            ["width %s MHz" % int(width), "PHY %s Mbps" % rate])

    # --- 4. 宅内(GW まで)の健全性 ---
    if gw is None:
        add("unknown", "宅内", "ゲートウェイへの遅延が測れておらず、宅内区間を評価できない", [])
    else:
        ev = ["GW平均 %.2f ms" % gw]
        if gw_loss is not None:
            ev.append("ロス %.1f%%" % gw_loss)
        if (gw_loss or 0) > 0:
            add("major", "宅内", "ルーターまでの区間でパケットが落ちている。無線品質の問題", ev)
        elif gw > TH["gw_ms_bad"]:
            add("major", "宅内", "ルーターまでの遅延が大きい。無線区間で再送が起きている", ev)
        elif gw <= TH["gw_ms_good"]:
            add("info", "宅内", "ルーターまでの区間は健全。宅内の無線は犯人ではない", ev)

    # --- 5. WAN 側 ---
    if wan is not None:
        # 宅内(GWまで)の遅延は WAN の数値にもそのまま乗る。
        # 差し引かないと、Wi-Fi が悪いだけの家を「回線が悪い」と誤診する。
        wan_net = (wan - gw) if (gw is not None) else None
        ev = ["1.1.1.1 平均 %.2f ms" % wan]
        if wan_net is not None:
            ev.append("うち宅内 %.2f ms を引いた WAN 実質 %.2f ms" % (gw, wan_net))
        if wan_max:
            ev.append("最大 %.2f ms" % wan_max)
        if wan_loss is not None:
            ev.append("ロス %.1f%%" % wan_loss)
        judged = wan_net if wan_net is not None else wan
        if (wan_loss or 0) > 1 and (gw_loss or 0) == 0:
            add("critical", "回線", "WAN 側でパケットロスが出ている。回線側の問題", ev)
        elif (wan_loss or 0) > 1:
            add("major", "回線",
                "WAN 側にロスがあるが、宅内でもロスが出ている。宅内を直すまで回線側の評価は確定できない", ev)
        elif judged > TH["wan_ms_bad"]:
            add("major", "回線",
                "WAN 遅延が大きい。網終端装置の輻輳(PPPoE で夕方に起きやすい)を疑う", ev)
        elif gw is not None and gw > TH["gw_ms_bad"]:
            add("info", "回線",
                "WAN 単体の遅延は正常。1.1.1.1 までの数字が悪いのは宅内区間のせい", ev)
        if wan_max and wan and wan_max > wan * 5:
            add("major", "回線", "遅延のばらつきが大きい。経路のどこかが詰まっている",
                ["平均 %.2f ms / 最大 %.2f ms" % (wan, wan_max)])

    # --- 6. IPv6 と接続方式 ---
    v6_reach = s.get("ipv6.reachable_v6")
    v6_addr = s.get("ipv6.has_global_address")
    v6_route = s.get("ipv6.has_default_route")
    isp = s.get("wan.as_organization")
    if v6_reach is True:
        add("info", "接続方式",
            "IPv6 で外部到達できている。IPoE は既に有効。「IPoE 化」は対策として効果なし",
            ["IPv6 到達 OK", "ISP: %s" % (isp or "不明")])
    elif v6_addr is False and v6_route is False:
        add("critical", "接続方式",
            "IPv6 が全く降りていない。PPPoE 接続の可能性が高い。"
            "PPPoE は網終端装置が混雑時間帯のボトルネックになる。IPoE 化が最大の対策候補",
            ["グローバルv6アドレス なし", "v6デフォルト経路 なし", "ISP: %s" % (isp or "不明")])
    elif v6_addr is True and v6_reach is False:
        add("major", "接続方式",
            "IPv6 アドレスはあるが外に届いていない。経路かフィルタの問題",
            ["アドレス あり / 到達 NG"])
    elif v6_reach is None:
        add("unknown", "接続方式", "IPv6 が測れておらず、PPPoE か IPoE かを判断できない", [])

    # --- 7. バッファブロート ---
    if rpm is None and bloat is None:
        add("unknown", "バッファブロート", "RPM も負荷時遅延も取れておらず、判断できない", [])
    else:
        ev = []
        if rpm is not None:
            ev.append("DL RPM %s" % int(rpm))
        if bloat is not None:
            ev.append("負荷時の遅延上昇 +%.1f ms" % bloat)
        severe = (rpm is not None and rpm < TH["rpm_severe"]) or \
                 (bloat is not None and bloat > TH["bloat_delta_bad"])
        low = (rpm is not None and rpm < TH["rpm_low"])
        if severe:
            add("critical", "バッファブロート",
                "バッファブロートが出ている。速度の数字が出ていても体感は悪くなる。"
                "ルーターのキュー制御(SQM/fq_codel)か機器交換が要る", ev)
        elif low:
            add("major", "バッファブロート", "RPM が低い。混雑時に体感が落ちる", ev)
        else:
            add("info", "バッファブロート", "バッファブロートは出ていない。SQM 導入は効果なし", ev)

    # --- 8. 経路上の機器 (2ホップ目) ---
    hops = (sections.get("route", {}).get("data") or {}).get("hops") or []
    hop2 = next((h for h in hops if h.get("hop") == 2), None)
    if not hops:
        add("unknown", "経路", "traceroute が取れておらず、経路上の機器を確認できない", [])
    elif hop2 is None or hop2.get("ip") is None:
        add("unknown", "経路",
            "2ホップ目が応答しない。ICMP を返さない機器がいるだけの可能性もあり、断定できない",
            ["hop2: 無応答"])
    else:
        ip2 = hop2["ip"]
        ev = ["hop2 %s (%s ms)" % (ip2, hop2.get("rtt_ms"))]
        if re.match(r"^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)", ip2):
            add("major", "経路",
                "2ホップ目がまだプライベートIP。ルーターが2段になっている(二重NAT)。"
                "ONU/HGW とルーターの役割が重複している可能性", ev)
        elif re.match(r"^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.", ip2):
            add("major", "経路",
                "2ホップ目が CGNAT 帯 (100.64/10)。ISP 側で共有 IPv4 になっている。"
                "建物やISPの共用部分が混雑の原因になりうる", ev)
        else:
            add("info", "経路", "2ホップ目は ISP 側のグローバル機器。経路は素直", ev)

    # --- 9. 単一接続 vs 並列 ---
    if gain is not None:
        ev = ["単一 %s Mbps" % single, "6並列 %s Mbps" % par6, "比 %.2f" % gain]
        if gain >= TH["parallel_gain_suspicious"]:
            add("major", "回線",
                "並列にすると大きく伸びる。1本あたりが細く抑えられている。"
                "経路の輻輳か、上流での帯域制御を疑う", ev)
        else:
            add("info", "回線", "並列にしても伸びない。帯域の上限そのものに当たっている", ev)

    F.sort(key=lambda x: SEV_ORDER.get(x["severity"], 9))
    return {"findings": F, "unverified": unverified,
            "actions": build_actions(F, s)}


def build_actions(findings, s):
    """対策を効果の大きい順に並べる。効果が無いものは理由付きで切る。

    順序の原則: 宅内(電波・GWまで)が壊れているうちは、その先の数値は信用できない。
    先に宅内を直し、再測定してから回線側を疑う。
    """
    areas = {}
    for f in findings:
        areas.setdefault(f["area"], []).append(f)

    def has(area, *sev):
        return any(f["severity"] in sev for f in areas.get(area, []))

    local_bad = has("電波", "critical", "major") or has("宅内", "critical", "major")
    wifi_weak = has("電波", "critical", "major")

    scored = []  # (優先度, 対策, 期待, 根拠)

    if has("接続方式", "critical"):
        scored.append((100, "IPoE (IPv4 over IPv6) へ切り替える",
                       "混雑時間帯の速度低下に対して最も効果が大きい。"
                       "PPPoE の網終端装置を経由しなくなる",
                       "IPv6 が全く降りていないという実測"))
    if has("バッファブロート", "critical"):
        scored.append((90, "ルーターのキュー制御(SQM/fq_codel)を有効にする、または対応機器へ替える",
                       "速度の数字は変わらないが、体感(応答性)が大きく改善する",
                       "RPM / 負荷時遅延の実測"))
    elif has("バッファブロート", "major"):
        scored.append((65, "ルーターのキュー制御(SQM/fq_codel)を検討する",
                       "混雑時の体感が改善する", "RPM の実測"))
    if has("機器", "major"):
        scored.append((85, "5GHz/6GHz・80MHz 以上で繋がるようにする(バンド指定・機器更新)",
                       "リンク速度の天井が上がる。ここが今の実効速度を直接縛っている",
                       "band / 帯域幅 / PHY リンク速度の実測"))
    if wifi_weak:
        scored.append((80, "ルーターの置き場所を変える、または中継機/メッシュを入れる",
                       "電波が弱いことが実測で出ている。リンク速度ごと上がるので効く",
                       "RSSI / SNR の実測"))
    if has("宅内", "major"):
        scored.append((75, "宅内の無線品質を改善する(干渉源の排除・チャンネル変更)",
                       "GW までの遅延とロスが減る", "ゲートウェイへの ping の実測"))
    if has("経路", "major"):
        scored.append((50, "二重ルーター/CGNAT の構成を解消する",
                       "経路が1段減り、遅延と不安定さが減る", "traceroute 2ホップ目の実測"))

    if has("回線", "critical"):
        scored.append((95 if not local_bad else 45,
                       "回線・ISP 側の問題として扱う(事業者へ実測値を添えて申告する)",
                       "宅内でできることでは改善しない", "WAN 側のロスの実測"))
    elif has("回線", "major"):
        if local_bad:
            scored.append((10,
                           "先に宅内を直してから再測定する。ISP へ申告するのはその後",
                           "今の WAN の数値は宅内区間の劣化を含んでおり、"
                           "回線が悪いかどうかをこの値では判定できない",
                           "GW までの遅延/ロスが既に大きいという実測"))
        else:
            scored.append((60, "回線・ISP 側の問題として扱う(事業者へ実測値を添えて申告する)",
                           "宅内は健全なので、残るのは回線側", "WAN 遅延・並列比の実測"))

    scored.sort(key=lambda x: -x[0])
    eff = [(a, w, b) for _, a, w, b in scored]

    none = []
    if any(f["area"] == "電波" and f["severity"] == "info" for f in findings):
        none.append(("ルーターの置き場所を変える / チャンネルを変える",
                     "電波は既に良好。ここを触っても速度は上がらない"))
    if any(f["area"] == "接続方式" and f["severity"] == "info" for f in findings):
        none.append(("IPoE 化", "IPv6 で到達できており、既に IPoE。切り替える先が無い"))
    if any(f["area"] == "バッファブロート" and f["severity"] == "info" for f in findings):
        none.append(("SQM / QoS の導入",
                     "負荷をかけても遅延が上がっていない。制御すべき滞留が無い"))
    # 「使い切っている」は電波が良好なときだけ、中継機不要の根拠になる
    if not wifi_weak and any("無線区間は上限近くまで" in f["verdict"] for f in findings):
        none.append(("中継機・メッシュの追加",
                     "無線区間は既に使い切っており、電波も良好。台数を増やしても上限は変わらない"))
    if not local_bad and any(f["area"] == "宅内" and f["severity"] == "info" for f in findings):
        none.append(("宅内 LAN 機器の交換(ハブ・ケーブル等)",
                     "ゲートウェイまでの遅延もロスも出ていない。宅内に直すものが無い"))

    return {"effective": eff, "no_effect": none}


def cmd_diagnose(args):
    with open(args.result, encoding="utf-8") as f:
        doc = json.load(f)
    d = diagnose(doc)

    print("===== 判定: %s (%s) =====" % (doc.get("label"), doc.get("finished_at")))
    print("\n[ 実測値が示していること ]")
    labels = {"critical": "重大", "major": "大", "minor": "小", "info": "問題なし", "unknown": "判断不能"}
    for f in d["findings"]:
        if f["severity"] == "unknown":
            continue
        print("\n  [%s] %s — %s" % (labels[f["severity"]], f["area"], f["verdict"]))
        for e in f["evidence"]:
            print("        根拠: %s" % e)

    unknowns = [f for f in d["findings"] if f["severity"] == "unknown"]
    if unknowns:
        print("\n[ 測れていないので判断できないこと ]")
        for f in unknowns:
            print("  - %s: %s" % (f["area"], f["verdict"]))
    if d["unverified"]:
        print("\n[ 取得に失敗したセクション ]")
        for u in d["unverified"]:
            print("  - %s" % u)

    print("\n[ 対策 (効果の大きい順) ]")
    if d["actions"]["effective"]:
        for i, (a, why, basis) in enumerate(d["actions"]["effective"], 1):
            print("  %d. %s" % (i, a))
            print("     期待できること: %s" % why)
            print("     根拠: %s" % basis)
    else:
        print("  (実測から根拠づけられる対策なし)")

    if d["actions"]["no_effect"]:
        print("\n[ 効果なし — やらなくてよい ]")
        for a, why in d["actions"]["no_effect"]:
            print("  x %s" % a)
            print("     理由: %s" % why)
    return 0

def main(argv=None):
    p = argparse.ArgumentParser(description="自宅ネット回線の実測ツール")
    sub = p.add_subparsers(dest="cmd")

    r = sub.add_parser("run", help="測定を実行して results/ に JSON を保存")
    r.add_argument("--label", required=True,
                   help="この測定の名前。前後比較の目印になる (例: before-router-move)")
    r.add_argument("--note", default=None, help="自由記述メモ")
    r.add_argument("--out", default="results", help="保存先ディレクトリ (既定: results)")
    r.add_argument("--ping-count", type=int, default=20, help="各ターゲットへの ping 回数")
    r.add_argument("--dl-seconds", type=int, default=10, help="ダウンロード計測の秒数")
    r.add_argument("--url", default=DEFAULT_DL_URL, help="スループット計測に使うURL")
    r.add_argument("--route-target", default="8.8.8.8", help="traceroute の宛先")
    r.add_argument("--dns-repeats", type=int, default=1, help="DNS 計測の繰り返し回数")
    r.add_argument("--skip", default="", help="除外するセクションをカンマ区切りで")
    r.add_argument("--no-redact", action="store_true",
                   help="グローバルIPやBSSIDをマスクせずそのまま保存する")
    r.set_defaults(func=cmd_run)

    g = sub.add_parser("diagnose", help="結果JSONからボトルネックを判定して対策を出す")
    g.add_argument("result")
    g.set_defaults(func=cmd_diagnose)

    c = sub.add_parser("compare", help="2つの結果JSONを並べて差分を出す")
    c.add_argument("a")
    c.add_argument("b")
    c.set_defaults(func=cmd_compare)

    argv = list(sys.argv[1:] if argv is None else argv)
    if argv and argv[0] not in ("run", "compare", "diagnose", "-h", "--help"):
        argv.insert(0, "run")  # `netdiag.py --label X` も受ける
    args = p.parse_args(argv)
    if not getattr(args, "cmd", None):
        p.print_help()
        return 2
    if args.cmd == "run":
        args.skip = [s.strip() for s in args.skip.split(",") if s.strip()]
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
