"""Push a live camera path out to YouTube / Facebook RTMP.

The phone publishes WHIP (H264 or VP8 + Opus). Facebook/YouTube need H264/AAC
in FLV. Debian ffmpeg is built with GnuTLS; Facebook's RTMPS stack rejects that
handshake. Plain RTMP on port 80 is also dead. OpenSSL TLS 1.2 still works, so
Facebook ingest is proxied through a local TLS 1.2 tunnel, then ffmpeg talks
plain RTMP to 127.0.0.1.
"""

from __future__ import annotations

import asyncio
import re
import shutil
import socket
import ssl
import subprocess
import threading
from collections.abc import Awaitable, Callable
from typing import Any
from urllib.parse import urlparse

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

_lock = threading.Lock()
_procs: dict[str, subprocess.Popen[Any]] = {}
_tasks: dict[str, asyncio.Task[Any]] = {}
_tunnels: dict[str, "_Tls12Tunnel"] = {}


def rtmp_destination(rtmp_url: str, stream_key: str) -> str:
    parsed = urlparse(rtmp_url.strip())
    path = (parsed.path or "").rstrip("/")
    key = stream_key.strip()
    if parsed.query and key and "?" not in key:
        key = f"{key}?{parsed.query}"
    base = f"{parsed.scheme}://{parsed.netloc}{path}" if parsed.scheme else path
    if not key:
        return rtmp_url.strip().rstrip("/")
    name = key.split("?", 1)[0]
    if name and (path.endswith(f"/{name}") or path.rstrip("/").endswith(name)):
        return f"{base}?{key.split('?', 1)[1]}" if "?" in key else base
    return f"{base}/{key}"


def facebook_ingest_host(dest: str) -> str | None:
    parsed = urlparse(dest.strip())
    host = parsed.hostname
    if not host or "facebook.com" not in host.lower():
        return None
    return host


def local_rtmp_via_tunnel(dest: str, local_port: int) -> str:
    parsed = urlparse(dest.strip())
    path = parsed.path or "/rtmp"
    if not path.startswith("/"):
        path = f"/{path}"
    query = f"?{parsed.query}" if parsed.query else ""
    return f"rtmp://127.0.0.1:{local_port}{path}{query}"


def facebook_rtmp_target(dest: str, local_port: int) -> tuple[str, dict[str, str]]:
    """Talk RTMP to the local TLS tunnel; keep Facebook's query on the playpath."""
    parsed = urlparse(dest.strip())
    path = (parsed.path or "/rtmp").strip("/") or "rtmp"
    if "/" in path:
        app, name = path.split("/", 1)
    else:
        app, name = path, ""
    playpath = name
    if parsed.query:
        playpath = f"{playpath}?{parsed.query}" if playpath else parsed.query
    host = parsed.hostname or "live-api-s.facebook.com"
    opts = {
        "rtmp_app": app,
        "rtmp_playpath": playpath,
        "rtmp_tcurl": f"rtmps://{host}:443/{app}",
        "rtmp_flashver": "FMLE/3.0 (compatible; FMSc/1.0)",
        "rtmp_live": "live",
    }
    return f"rtmp://127.0.0.1:{local_port}/{app}", opts


def facebook_tls_context() -> ssl.SSLContext:
    ctx = ssl.create_default_context()
    ctx.minimum_version = ssl.TLSVersion.TLSv1_2
    ctx.maximum_version = ssl.TLSVersion.TLSv1_2
    return ctx


def _copy_stream(src: socket.socket, dst: socket.socket) -> None:
    try:
        while True:
            chunk = src.recv(64 * 1024)
            if not chunk:
                break
            dst.sendall(chunk)
    except OSError:
        return
    try:
        dst.shutdown(socket.SHUT_WR)
    except OSError:
        return


class _Tls12Tunnel:
    def __init__(self, upstream_host: str, upstream_port: int = 443) -> None:
        self.upstream_host = upstream_host
        self.upstream_port = upstream_port
        self.port = 0
        self._stop = threading.Event()
        self._listen: socket.socket | None = None
        self._thread: threading.Thread | None = None

    def start(self) -> int:
        listen = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        listen.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        listen.bind(("127.0.0.1", 0))
        listen.listen(8)
        listen.settimeout(1.0)
        self._listen = listen
        self.port = int(listen.getsockname()[1])
        self._thread = threading.Thread(target=self._accept_loop, daemon=True)
        self._thread.start()
        return self.port

    def _accept_loop(self) -> None:
        listen = self._listen
        ctx = facebook_tls_context()
        while listen is not None and not self._stop.is_set():
            try:
                client, _ = listen.accept()
            except TimeoutError:
                continue
            except OSError:
                break
            threading.Thread(target=self._handle, args=(client, ctx), daemon=True).start()
        if listen is not None:
            try:
                listen.close()
            except OSError:
                return

    def _handle(self, client: socket.socket, ctx: ssl.SSLContext) -> None:
        upstream: ssl.SSLSocket | None = None
        try:
            client.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
            raw = socket.create_connection((self.upstream_host, self.upstream_port), timeout=10)
            raw.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
            upstream = ctx.wrap_socket(raw, server_hostname=self.upstream_host)
            upstream.settimeout(None)
            client.settimeout(None)
            to_up = threading.Thread(target=_copy_stream, args=(client, upstream), daemon=True)
            to_up.start()
            _copy_stream(upstream, client)
            to_up.join(timeout=2)
        except Exception as exc:
            logger.warning(
                "facebook_tls_tunnel_failed",
                extra={"host": self.upstream_host, "error": str(exc)[:200]},
            )
        finally:
            for sock in (client, upstream):
                if sock is None:
                    continue
                try:
                    sock.close()
                except OSError:
                    pass

    def stop(self) -> None:
        self._stop.set()
        listen = self._listen
        self._listen = None
        if listen is not None:
            try:
                listen.close()
            except OSError:
                pass
        thread = self._thread
        if thread is not None and thread.is_alive():
            thread.join(timeout=2)


def _ffmpeg_cmd(
    rtsp_url: str,
    dest: str,
    rtmp_opts: dict[str, str] | None = None,
) -> list[str]:
    # Copy WHIP H264 (no 720p encode) so the RTSP reader keeps up. Opus → AAC
    # with async resample so DTS does not run backwards and Facebook drop us.
    cmd = [
        "ffmpeg",
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "warning",
        "-fflags",
        "+genpts+discardcorrupt+igndts",
        "-avoid_negative_ts",
        "make_zero",
        "-rtsp_transport",
        "tcp",
        "-i",
        rtsp_url,
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?",
        "-c:v",
        "copy",
        "-bsf:v",
        "dump_extra=freq=keyframe",
        "-c:a",
        "aac",
        "-ar",
        "44100",
        "-ac",
        "2",
        "-b:a",
        "128k",
        "-af",
        "aresample=async=1:first_pts=0",
        "-max_interleave_delta",
        "0",
        "-flvflags",
        "no_duration_filesize",
    ]
    if rtmp_opts:
        for flag in ("rtmp_app", "rtmp_playpath", "rtmp_tcurl", "rtmp_flashver", "rtmp_live"):
            value = rtmp_opts.get(flag)
            if value:
                cmd.extend([f"-{flag}", value])
    cmd.extend(["-f", "flv", dest])
    return cmd


def _host_of(url: str) -> str:
    parsed = urlparse(url)
    host = parsed.hostname or ""
    port = parsed.port
    if port:
        return f"{host}:{port}"
    return host


def _sanitize_ffmpeg_line(line: str) -> str:
    line = re.sub(r"rtmps?://\S+", "rtmp://<redacted>", line)
    line = re.sub(r"([?&]a=)[^&\s]+", r"\1<redacted>", line)
    return line[:400]


def _drain_stderr(proc: subprocess.Popen[Any], path: str) -> None:
    stream = proc.stderr
    if stream is None:
        return
    try:
        for raw in iter(stream.readline, b""):
            line = raw.decode("utf-8", "replace").strip()
            if line:
                logger.warning("restream_ffmpeg", extra={"path": path, "line": _sanitize_ffmpeg_line(line)})
    except (OSError, ValueError):
        return


def _ensure_tunnel(path: str, host: str) -> _Tls12Tunnel:
    with _lock:
        existing = _tunnels.get(path)
    if existing and existing.upstream_host == host and existing.port:
        return existing
    if existing:
        existing.stop()
    tunnel = _Tls12Tunnel(host)
    tunnel.start()
    with _lock:
        _tunnels[path] = tunnel
    logger.warning(
        "facebook_tls_tunnel_started",
        extra={"path": path, "host": host, "local_port": tunnel.port},
    )
    return tunnel


def _stop_tunnel(path: str) -> None:
    with _lock:
        tunnel = _tunnels.pop(path, None)
    if tunnel:
        tunnel.stop()


def _kill_proc(path: str) -> None:
    with _lock:
        proc = _procs.pop(path, None)
    if proc and proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(timeout=4)
        except subprocess.TimeoutExpired:
            proc.kill()
        logger.info("restream_stopped", extra={"path": path})


def stop(path: str) -> None:
    with _lock:
        task = _tasks.pop(path, None)
    current: asyncio.Task[Any] | None = None
    try:
        current = asyncio.current_task()
    except RuntimeError:
        current = None
    if task and not task.done() and task is not current:
        task.cancel()
    _kill_proc(path)
    _stop_tunnel(path)


def stop_prefix(prefix: str) -> None:
    with _lock:
        keys = {
            k
            for k in list(_procs) + list(_tunnels) + list(_tasks)
            if k == prefix or k.startswith(f"{prefix}/")
        }
    for key in keys:
        stop(key)


def start(path: str, rtmp_url: str, stream_key: str) -> None:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        logger.warning("restream_skipped_no_ffmpeg", extra={"path": path})
        return
    rtsp_base = (settings.MEDIAMTX_RTSP_URL or "").rstrip("/")
    if not rtsp_base:
        logger.warning("restream_skipped_no_rtsp", extra={"path": path})
        return
    dest = rtmp_destination(rtmp_url, stream_key)
    fb_host = facebook_ingest_host(dest)
    rtmp_opts: dict[str, str] | None = None
    via = "direct"
    out_path = urlparse(dest).path
    if fb_host:
        tunnel = _ensure_tunnel(path, fb_host)
        dest, rtmp_opts = facebook_rtmp_target(dest, tunnel.port)
        via = "facebook_tls12"
    rtsp_url = f"{rtsp_base}/{path.lstrip('/')}"
    _kill_proc(path)
    try:
        proc = subprocess.Popen(
            _ffmpeg_cmd(rtsp_url, dest, rtmp_opts),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )
    except OSError:
        logger.exception("restream_spawn_failed", extra={"path": path})
        return
    threading.Thread(target=_drain_stderr, args=(proc, path), daemon=True).start()
    with _lock:
        _procs[path] = proc
    logger.warning(
        "restream_started",
        extra={
            "path": path,
            "dest_host": fb_host or _host_of(dest),
            "out_path": out_path,
            "via": via,
        },
    )


def schedule(
    path: str,
    rtmp_url: str | None,
    stream_key: str | None,
    delay_s: float = 0.5,
    on_healthy: Callable[[], Awaitable[None]] | None = None,
    on_refresh: Callable[[], Awaitable[tuple[str, str] | None]] | None = None,
) -> None:
    if not rtmp_url or not stream_key:
        return
    stop(path)

    async def _run() -> None:
        url, key = rtmp_url, stream_key
        for attempt in range(8):
            await asyncio.sleep(delay_s if attempt == 0 else 2.0)
            if attempt > 0 and on_refresh is not None:
                try:
                    refreshed = await on_refresh()
                except Exception:
                    logger.exception("restream_refresh_failed", extra={"path": path})
                    refreshed = None
                if refreshed and refreshed[0] and refreshed[1]:
                    url, key = refreshed
                    logger.info("restream_ingest_refreshed", extra={"path": path, "attempt": attempt + 1})
            start(path, url, key)
            await asyncio.sleep(10.0)
            with _lock:
                proc = _procs.get(path)
            if proc is None or proc.poll() is not None:
                logger.warning("restream_retry", extra={"path": path, "attempt": attempt + 1})
                continue
            logger.warning("restream_healthy", extra={"path": path, "attempt": attempt + 1})
            if on_healthy is not None:
                try:
                    await on_healthy()
                except Exception:
                    logger.exception("restream_on_healthy_failed", extra={"path": path})
            await asyncio.get_running_loop().run_in_executor(None, proc.wait)
            with _lock:
                mine = _tasks.get(path)
            if mine is not asyncio.current_task():
                return
            logger.warning("restream_exited", extra={"path": path, "attempt": attempt + 1})

    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        start(path, rtmp_url, stream_key)
        return
    task = loop.create_task(_run())
    with _lock:
        _tasks[path] = task
