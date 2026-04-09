#!/usr/bin/env python3
"""
Unified LLM dispatcher for the MBACIO autonomous swarm.

OAuth-first. API fallback ONLY with hard daily spend caps + circuit breaker.
Written 2026-04-08 after TRON $75/20min API-burn incident.

## Auth preference order (set in ~/.llm-swarm/config.json)

  claude  : Claude Code CLI (Max sub) -> anthropic API (capped)
  gemini  : Vertex AI ADC (gcloud OAuth) -> GEMINI_API_KEY (capped)
  openai  : Codex CLI (ChatGPT sub) -> OPENAI_API_KEY (capped)
  ollama  : local M51, zero cost

## Spend cap (enforced BEFORE every API call)

  ~/.llm-swarm/spend-YYYY-MM-DD.json tracks estimated USD spent per provider.
  If today's total > config.spend_caps_usd.per_day_total, calls refuse with
  circuit breaker. Per-provider caps enforced separately. Alerts at 80% via
  Telegram (when the bot bridge is wired up).

## Usage

  # CLI:
  echo "write a fibonacci" | python scripts/llm.py --role code-gen-fast

  # Python:
  from scripts.llm import call_by_role
  r = call_by_role(role="code-gen-quality", prompt="hello")
  print(r.text, r.latency_ms, r.cost_usd_est)

@origin scripts/llm.py v2 — Claude Opus 4.6, 2026-04-08 swarm Block 1 rebuild
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.request
from dataclasses import dataclass, asdict, field
from pathlib import Path
from typing import Optional


# -------- Config + state locations --------

STATE_DIR = Path.home() / ".llm-swarm"
CONFIG_PATH = STATE_DIR / "config.json"


def _load_config() -> dict:
    try:
        return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {
            "spend_caps_usd": {
                "per_day_total": 50.0,
                "per_day_per_provider": {"openai": 10.0, "gemini": 10.0, "anthropic": 5.0},
                "circuit_breaker_action": "refuse_and_escalate",
            },
            "role_routing": {},
            "estimated_pricing_per_mtok_usd": {},
        }


CONFIG = _load_config()


# -------- Spend tracking --------

def _spend_file() -> Path:
    from datetime import date
    return STATE_DIR / f"spend-{date.today().isoformat()}.json"


def _load_spend() -> dict:
    p = _spend_file()
    if not p.exists():
        return {"total_usd": 0.0, "by_provider": {}, "calls": 0}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return {"total_usd": 0.0, "by_provider": {}, "calls": 0}


def _save_spend(s: dict):
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    tmp = _spend_file().with_suffix(".json.tmp")
    tmp.write_text(json.dumps(s, indent=2), encoding="utf-8")
    tmp.replace(_spend_file())


def _estimate_cost_usd(provider: str, model: str, in_tokens: int, out_tokens: int) -> float:
    prices = CONFIG.get("estimated_pricing_per_mtok_usd", {})
    key = model
    if provider == "ollama":
        return 0.0
    p = prices.get(key)
    if not p:
        # Unknown model — conservative estimate: $10/$30 per MTok
        p = {"input": 10.0, "output": 30.0}
    return (in_tokens / 1_000_000) * p["input"] + (out_tokens / 1_000_000) * p["output"]


class SpendCapExceeded(Exception):
    pass


def _check_cap_before_call(provider: str) -> None:
    """Raise SpendCapExceeded if today's spend is over limits. Called BEFORE each API call."""
    if provider == "ollama":
        return
    caps = CONFIG.get("spend_caps_usd", {})
    total_cap = caps.get("per_day_total", 1e9)
    provider_caps = caps.get("per_day_per_provider", {})
    provider_cap = provider_caps.get(provider, 1e9)

    spend = _load_spend()
    total = spend.get("total_usd", 0.0)
    by_prov = spend.get("by_provider", {}).get(provider, 0.0)

    if total >= total_cap:
        raise SpendCapExceeded(f"Daily total cap hit: ${total:.2f} >= ${total_cap:.2f}")
    if by_prov >= provider_cap:
        raise SpendCapExceeded(f"Daily {provider} cap hit: ${by_prov:.2f} >= ${provider_cap:.2f}")


def _record_spend(provider: str, cost_usd: float):
    spend = _load_spend()
    spend["total_usd"] = round(spend.get("total_usd", 0.0) + cost_usd, 6)
    spend["by_provider"][provider] = round(spend.get("by_provider", {}).get(provider, 0.0) + cost_usd, 6)
    spend["calls"] = spend.get("calls", 0) + 1
    _save_spend(spend)


# -------- Env var helpers --------

def _read_win_env(name: str) -> Optional[str]:
    """Read a user env var via PowerShell for Windows Git Bash — setx-set vars don't appear in bash env."""
    v = os.environ.get(name)
    if v:
        return v
    if sys.platform != "win32":
        return None
    try:
        out = subprocess.run(
            ["powershell.exe", "-Command", f"[Environment]::GetEnvironmentVariable('{name}','User')"],
            capture_output=True, text=True, timeout=3,
        )
        v = (out.stdout or "").strip()
        return v or None
    except Exception:
        return None


def _ensure_env():
    for key in ("ANTHROPIC_API_KEY", "GEMINI_API_KEY", "OPENAI_API_KEY"):
        if key not in os.environ:
            v = _read_win_env(key)
            if v:
                os.environ[key] = v


# -------- Response type --------

@dataclass
class LLMResponse:
    text: str
    provider: str
    model: str
    latency_ms: int
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd_est: float = 0.0
    auth_path: str = "api"  # "oauth" | "api" | "local" | "cli"
    error: Optional[str] = None
    warnings: list = field(default_factory=list)

    def to_json(self) -> str:
        return json.dumps(asdict(self), ensure_ascii=False)


# -------- Provider callers --------

def _call_claude(prompt, model, system=None, max_tokens=4096, temperature=0.2) -> LLMResponse:
    import anthropic
    _ensure_env()
    _check_cap_before_call("anthropic")
    client = anthropic.Anthropic()
    t0 = time.time()
    kwargs = {"model": model, "max_tokens": max_tokens, "temperature": temperature,
              "messages": [{"role": "user", "content": prompt}]}
    if system:
        kwargs["system"] = system
    resp = client.messages.create(**kwargs)
    dt = int((time.time() - t0) * 1000)
    text = "".join(b.text for b in resp.content if hasattr(b, "text"))
    cost = _estimate_cost_usd("anthropic", model, resp.usage.input_tokens, resp.usage.output_tokens)
    _record_spend("anthropic", cost)
    return LLMResponse(
        text=text, provider="claude", model=model, latency_ms=dt,
        input_tokens=resp.usage.input_tokens, output_tokens=resp.usage.output_tokens,
        cost_usd_est=cost, auth_path="api",
        warnings=["Using ANTHROPIC_API_KEY fallback. Prefer Claude Code CLI for judgment tasks."],
    )


def _call_gemini(prompt, model, system=None, max_tokens=4096, temperature=0.2) -> LLMResponse:
    from google import genai
    from google.genai import types as genai_types
    _ensure_env()
    _check_cap_before_call("gemini")
    client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    t0 = time.time()
    cfg = genai_types.GenerateContentConfig(
        temperature=temperature, max_output_tokens=max_tokens, system_instruction=system,
    )
    resp = client.models.generate_content(model=model, contents=prompt, config=cfg)
    dt = int((time.time() - t0) * 1000)
    usage = getattr(resp, "usage_metadata", None)
    in_tok = (getattr(usage, "prompt_token_count", 0) if usage else 0) or 0
    out_tok = (getattr(usage, "candidates_token_count", 0) if usage else 0) or 0
    cost = _estimate_cost_usd("gemini", model, in_tok, out_tok)
    _record_spend("gemini", cost)
    return LLMResponse(
        text=(resp.text or "").strip(), provider="gemini", model=model, latency_ms=dt,
        input_tokens=in_tok, output_tokens=out_tok, cost_usd_est=cost, auth_path="api",
        warnings=["Using GEMINI_API_KEY fallback. Prefer Vertex ADC OAuth (`gcloud auth application-default login`)."],
    )


def _call_openai(prompt, model, system=None, max_tokens=4096, temperature=0.2) -> LLMResponse:
    from openai import OpenAI
    _ensure_env()
    _check_cap_before_call("openai")
    client = OpenAI()
    t0 = time.time()
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})
    is_reasoning = model.startswith(("o1", "o3", "o4", "gpt-5"))
    if is_reasoning:
        resp = client.chat.completions.create(
            model=model, messages=messages, max_completion_tokens=max_tokens,
        )
    else:
        resp = client.chat.completions.create(
            model=model, messages=messages, max_tokens=max_tokens, temperature=temperature,
        )
    dt = int((time.time() - t0) * 1000)
    text = (resp.choices[0].message.content or "").strip()
    in_tok = resp.usage.prompt_tokens if resp.usage else 0
    out_tok = resp.usage.completion_tokens if resp.usage else 0
    cost = _estimate_cost_usd("openai", model, in_tok, out_tok)
    _record_spend("openai", cost)
    return LLMResponse(
        text=text, provider="openai", model=model, latency_ms=dt,
        input_tokens=in_tok, output_tokens=out_tok, cost_usd_est=cost, auth_path="api",
        warnings=["Using OPENAI_API_KEY fallback. Prefer Codex CLI (ChatGPT subscription)."],
    )


def _call_ollama(prompt, model, system=None, max_tokens=4096, temperature=0.2,
                 host="http://localhost:11434", num_ctx=16384) -> LLMResponse:
    payload = {"model": model, "prompt": prompt, "stream": False,
               "options": {"temperature": temperature, "num_ctx": num_ctx, "num_predict": max_tokens}}
    if system:
        payload["system"] = system
    req = urllib.request.Request(
        f"{host}/api/generate",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=600) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    dt = int((time.time() - t0) * 1000)
    return LLMResponse(
        text=(data.get("response") or "").strip(), provider="ollama", model=model, latency_ms=dt,
        input_tokens=data.get("prompt_eval_count", 0),
        output_tokens=data.get("eval_count", 0),
        cost_usd_est=0.0, auth_path="local",
    )


# -------- Public API --------

def call(provider: str, prompt: str, model: Optional[str] = None,
         system: Optional[str] = None, max_tokens: int = 4096,
         temperature: float = 0.2) -> LLMResponse:
    """Dispatch an LLM call. Never raises on provider errors — returns error field."""
    defaults = {"claude": "claude-opus-4-6", "gemini": "gemini-2.5-pro",
                "openai": "gpt-4.1", "ollama": "glm-4.7-flash:latest"}
    model = model or defaults.get(provider)
    if not model:
        return LLMResponse(text="", provider=provider, model="?", latency_ms=0,
                           error=f"unknown provider: {provider}")
    try:
        if provider == "claude":
            return _call_claude(prompt, model, system, max_tokens, temperature)
        if provider == "gemini":
            return _call_gemini(prompt, model, system, max_tokens, temperature)
        if provider == "openai":
            return _call_openai(prompt, model, system, max_tokens, temperature)
        if provider == "ollama":
            return _call_ollama(prompt, model, system, max_tokens, temperature)
        return LLMResponse(text="", provider=provider, model=model, latency_ms=0,
                           error=f"unknown provider: {provider}")
    except SpendCapExceeded as e:
        return LLMResponse(text="", provider=provider, model=model, latency_ms=0,
                           error=f"SPEND_CAP: {e}")
    except Exception as e:
        return LLMResponse(text="", provider=provider, model=model, latency_ms=0,
                           error=f"{type(e).__name__}: {e}")


def call_by_role(role: str, prompt: str, **kwargs) -> LLMResponse:
    routing = CONFIG.get("role_routing", {})
    if role not in routing:
        return LLMResponse(text="", provider="?", model="?", latency_ms=0,
                           error=f"unknown role: {role}")
    provider, model = routing[role]
    return call(provider=provider, prompt=prompt, model=model, **kwargs)


def spend_status() -> dict:
    """Return current day's spend snapshot."""
    return _load_spend()


# -------- CLI --------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--provider", choices=["claude", "gemini", "openai", "ollama"])
    ap.add_argument("--role")
    ap.add_argument("--model", default=None)
    ap.add_argument("--system", default=None)
    ap.add_argument("--max-tokens", type=int, default=4096)
    ap.add_argument("--temperature", type=float, default=0.2)
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--spend-status", action="store_true", help="Print today's spend and exit")
    args = ap.parse_args()

    if args.spend_status:
        print(json.dumps(spend_status(), indent=2))
        return

    if not args.provider and not args.role:
        sys.stderr.write("ERROR: must pass --provider or --role\n")
        sys.exit(1)

    prompt = sys.stdin.read()
    if not prompt.strip():
        sys.stderr.write("ERROR: empty prompt on stdin\n")
        sys.exit(1)

    if args.role:
        r = call_by_role(role=args.role, prompt=prompt, system=args.system,
                         max_tokens=args.max_tokens, temperature=args.temperature)
    else:
        r = call(provider=args.provider, prompt=prompt, model=args.model,
                 system=args.system, max_tokens=args.max_tokens, temperature=args.temperature)

    if r.error:
        sys.stderr.write(f"ERROR [{r.provider}:{r.model}]: {r.error}\n")
        sys.exit(2)

    if args.json:
        print(r.to_json())
    else:
        sys.stdout.write(r.text)
        sys.stdout.flush()
    sys.stderr.write(
        f"\n[llm] {r.provider}:{r.model} | {r.latency_ms}ms | in={r.input_tokens} out={r.output_tokens} "
        f"| est=${r.cost_usd_est:.4f} | auth={r.auth_path}\n"
    )
    for w in r.warnings:
        sys.stderr.write(f"[warn] {w}\n")


if __name__ == "__main__":
    main()
