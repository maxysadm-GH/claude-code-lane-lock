#!/usr/bin/env python3
"""
Ollama generation helper for claude-code-lane-lock.
Reads prompt from stdin, writes model response to stdout.

Usage:
    echo "prompt here" | python scripts/ollama-gen.py [--model qwen3-coder:latest] [--temperature 0.2]
    python scripts/ollama-gen.py --model glm-4.7-flash:latest < prompt.txt > output.mjs

Per CLAUDE.md: HTTP API via Python urllib (clean output).
"""
import sys
import json
import urllib.request
import urllib.error
import argparse


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="qwen3-coder:latest")
    parser.add_argument("--temperature", type=float, default=0.2)
    parser.add_argument("--host", default="http://localhost:11434")
    parser.add_argument("--timeout", type=int, default=600)
    parser.add_argument("--num-ctx", type=int, default=16384)
    args = parser.parse_args()

    prompt = sys.stdin.read()
    if not prompt.strip():
        sys.stderr.write("ERROR: empty prompt on stdin\n")
        sys.exit(1)

    payload = json.dumps({
        "model": args.model,
        "prompt": prompt,
        "stream": False,
        "options": {
            "temperature": args.temperature,
            "num_ctx": args.num_ctx,
        },
    }).encode("utf-8")

    req = urllib.request.Request(
        f"{args.host}/api/generate",
        data=payload,
        headers={"Content-Type": "application/json"},
    )

    try:
        with urllib.request.urlopen(req, timeout=args.timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.URLError as e:
        sys.stderr.write(f"ERROR: Ollama request failed: {e}\n")
        sys.exit(2)
    except json.JSONDecodeError as e:
        sys.stderr.write(f"ERROR: Ollama returned non-JSON: {e}\n")
        sys.exit(3)

    response = data.get("response", "")
    if not response:
        sys.stderr.write(f"ERROR: Ollama returned empty response. Full payload: {json.dumps(data)[:500]}\n")
        sys.exit(4)

    sys.stdout.write(response)
    sys.stdout.flush()

    eval_count = data.get("eval_count", 0)
    eval_duration_ns = data.get("eval_duration", 1)
    toks_per_sec = (eval_count / (eval_duration_ns / 1e9)) if eval_duration_ns > 0 else 0
    sys.stderr.write(f"\n[ollama] {args.model} | {eval_count} toks | {toks_per_sec:.0f} tok/s\n")


if __name__ == "__main__":
    main()
