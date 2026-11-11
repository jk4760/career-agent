"""限流纪律：间隔控制 + 总量封顶 + 302 检测（§3，写死不可协商）。"""

import logging
import time

log = logging.getLogger("ratelimit")


class RateLimiter:
    def __init__(self, interval_sec: float):
        self.interval = interval_sec
        self._last = 0.0

    def wait(self) -> None:
        delta = time.monotonic() - self._last
        if delta < self.interval:
            time.sleep(self.interval - delta)
        self._last = time.monotonic()


class DetailBudget:
    """单 run 详情页请求封顶；超限即停，余下岗位下 run 再抓。"""

    def __init__(self, cap: int):
        self.cap = cap
        self.used = 0

    def try_consume(self) -> bool:
        if self.used >= self.cap:
            return False
        self.used += 1
        return True


class RateLimitedError(Exception):
    """详情页触发 302 临时限流：本次 run 停止详情抓取，不尝试绕过。"""


def check_not_limited(status_code: int, url: str) -> None:
    if status_code in (301, 302, 303, 307, 308):
        log.warning("详情页收到 %d（临时限流）: %s —— 本次 run 停止详情抓取", status_code, url)
        raise RateLimitedError(url)
