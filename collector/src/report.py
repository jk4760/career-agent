"""run 结束输出计数报告（§9.2.7）：新增 N / 跳过 N / 过滤 N / 详情配额用量。"""

import logging

log = logging.getLogger("report")


def print_report(
    searched: int,
    filtered: dict[str, int],
    detail_used: int,
    detail_cap: int,
    ingest_result: dict,
    rate_limited: bool,
    official_extracted: int = 0,
    official_result: dict | None = None,
) -> None:
    official_result = official_result or {}
    lines = [
        "",
        "========== 采集报告 ==========",
        f"猎聘搜索获取岗位：{searched}",
        f"过滤丢弃：{sum(filtered.values())}" + (f"（明细：{filtered}）" if filtered else ""),
        f"详情页配额用量：{detail_used}/{detail_cap}",
        f"临时限流（302）：{'是（本次提前停手）' if rate_limited else '否'}",
        f"猎聘入库：新增 {ingest_result.get('inserted', 0)} / 重复跳过 {ingest_result.get('skipped', 0)}"
        f" / 补回 JD {ingest_result.get('updated', 0)}",
        f"官网监控命中：{official_extracted}；入库：新增 {official_result.get('inserted', 0)}"
        f" / 重复跳过 {official_result.get('skipped', 0)} / 补回 JD {official_result.get('updated', 0)}",
        "==============================",
    ]
    for line in lines:
        log.info(line)
