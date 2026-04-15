#!/usr/bin/env python3
"""Headless regression probe for Ghost in the Wire.

Collects frame time, dash success rate, and dash input latency from window.__ghostMetrics.
"""

import json
import subprocess
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PORT = 4173
URL = f"http://127.0.0.1:{PORT}"


def main() -> int:
    server = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT)],
        cwd=ROOT,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    time.sleep(0.6)

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page(viewport={"width": 1280, "height": 800})
            page.goto(URL, wait_until="networkidle")

            for _ in range(24):
                page.keyboard.down("d")
                page.wait_for_timeout(45)
                page.keyboard.up("d")
                page.keyboard.press("Space")
                page.wait_for_timeout(45)

            page.wait_for_timeout(1200)
            metrics = page.evaluate("window.__ghostMetrics")
            browser.close()

        print(json.dumps(metrics, indent=2))

        dash_attempts = metrics.get("dashAttempts", 0)
        dash_success = metrics.get("dashSuccesses", 0)
        dash_rate = (dash_success / dash_attempts * 100) if dash_attempts else 0

        checks = [
            (metrics.get("frameAvgMs", 999) <= 25, "avg frame time <= 25ms"),
            (dash_rate >= 20, "dash success rate >= 20%"),
            (metrics.get("dashLatencyMsAvg", 999) <= 150, "dash input latency <= 150ms"),
        ]

        failed = [name for ok, name in checks if not ok]
        if failed:
            print("FAIL:", ", ".join(failed), file=sys.stderr)
            return 1
        print("PASS: regression probe thresholds met")
        return 0
    finally:
        server.terminate()
        server.wait(timeout=3)


if __name__ == "__main__":
    raise SystemExit(main())
