"""Opt-in request and SQL timing used by the reproducible performance suite.

The middleware is deliberately disabled by default.  It records timing and
query-shape metadata only when ``PERFORMANCE_INSTRUMENTATION=1`` is set, so
the normal application contract and request path remain unchanged.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import threading
from collections import Counter
from pathlib import Path
from time import perf_counter, process_time

from django.conf import settings
from django.db import connection


_WRITE_LOCK = threading.Lock()
_WHITESPACE = re.compile(r"\s+")
_LITERAL = re.compile(r"'(?:''|[^'])*'|(?<!\w)\d+(?:\.\d+)?(?!\w)")


def query_shape(sql: str) -> str:
    """Return a privacy-safe, stable identifier for a SQL statement."""

    normalized = _WHITESPACE.sub(" ", sql).strip().lower()
    normalized = _LITERAL.sub("?", normalized)
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:12]


class QueryTimer:
    """Django ``execute_wrapper`` collecting timing without query parameters."""

    def __init__(self) -> None:
        self.count = 0
        self.sql_time_ms = 0.0
        self.durations_ms: list[float] = []
        self.shapes: Counter[str] = Counter()

    def __call__(self, execute, sql, params, many, context):  # noqa: ANN001
        started = perf_counter()
        try:
            return execute(sql, params, many, context)
        finally:
            elapsed_ms = (perf_counter() - started) * 1000
            self.count += 1
            self.sql_time_ms += elapsed_ms
            self.durations_ms.append(elapsed_ms)
            self.shapes[query_shape(sql)] += 1


def _append_record(record: dict) -> None:
    destination = getattr(settings, "PERFORMANCE_METRICS_PATH", "")
    if not destination:
        return
    path = Path(destination)
    path.parent.mkdir(parents=True, exist_ok=True)
    serialized = json.dumps(record, ensure_ascii=False, separators=(",", ":"))
    with _WRITE_LOCK:
        with path.open("a", encoding="utf-8") as stream:
            stream.write(serialized)
            stream.write("\n")


def _rss_bytes() -> int | None:
    """Return current-process RSS without adding a runtime dependency."""

    if os.name == "nt":
        try:
            import ctypes
            from ctypes import wintypes

            class MemoryCounters(ctypes.Structure):
                _fields_ = [
                    ("cb", wintypes.DWORD),
                    ("page_fault_count", wintypes.DWORD),
                    ("peak_working_set_size", ctypes.c_size_t),
                    ("working_set_size", ctypes.c_size_t),
                    ("quota_peak_paged_pool_usage", ctypes.c_size_t),
                    ("quota_paged_pool_usage", ctypes.c_size_t),
                    ("quota_peak_non_paged_pool_usage", ctypes.c_size_t),
                    ("quota_non_paged_pool_usage", ctypes.c_size_t),
                    ("pagefile_usage", ctypes.c_size_t),
                    ("peak_pagefile_usage", ctypes.c_size_t),
                ]

            counters = MemoryCounters()
            counters.cb = ctypes.sizeof(counters)
            process = ctypes.windll.kernel32.GetCurrentProcess()
            get_memory_info = ctypes.windll.psapi.GetProcessMemoryInfo
            get_memory_info.argtypes = [wintypes.HANDLE, ctypes.POINTER(MemoryCounters), wintypes.DWORD]
            get_memory_info.restype = wintypes.BOOL
            if get_memory_info(process, ctypes.byref(counters), counters.cb):
                return int(counters.working_set_size)
        except (AttributeError, OSError, ValueError):
            return None
        return None
    try:
        import resource

        value = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        return int(value * 1024 if os.uname().sysname == "Darwin" else value)
    except (ImportError, AttributeError, OSError):
        return None


class PerformanceMetricsMiddleware:
    """Record opt-in request metrics for benchmark runs."""

    def __init__(self, get_response):  # noqa: ANN001
        self.get_response = get_response

    def __call__(self, request):  # noqa: ANN001
        if not getattr(settings, "PERFORMANCE_INSTRUMENTATION", False):
            return self.get_response(request)

        started = perf_counter()
        cpu_started_at = process_time()
        cpu_started = os.times()
        timer = QueryTimer()
        response = None
        status_code = 500
        try:
            with connection.execute_wrapper(timer):
                response = self.get_response(request)
            status_code = response.status_code
            return response
        finally:
            response_bytes = 0
            if response is not None:
                try:
                    response_bytes = len(response.content)
                except (AttributeError, TypeError):
                    response_bytes = 0
            _append_record(
                {
                    "request": request.path,
                    "method": request.method,
                    "duration_ms": round((perf_counter() - started) * 1000, 3),
                    "process_cpu_ms": round((process_time() - cpu_started_at) * 1000, 3),
                    "process_user_ms": round((os.times().user - cpu_started.user) * 1000, 3),
                    "process_system_ms": round((os.times().system - cpu_started.system) * 1000, 3),
                    "rss_bytes": _rss_bytes(),
                    "sql_queries": timer.count,
                    "sql_time_ms": round(timer.sql_time_ms, 3),
                    "slowest_sql_ms": round(max(timer.durations_ms, default=0.0), 3),
                    "repeated_query_shapes": sum(count - 1 for count in timer.shapes.values() if count > 1),
                    "query_shapes": dict(timer.shapes),
                    "response_bytes": response_bytes,
                    "status_code": status_code,
                }
            )
