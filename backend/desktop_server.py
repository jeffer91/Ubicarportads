"""Servidor local del modo Electron; no modifica la lógica de PDF."""
import argparse

import uvicorn
from backend.app import app


def main():
    parser = argparse.ArgumentParser(description="API local para Ubicarportads Electron")
    parser.add_argument("--port", type=int, required=True)
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        parser.error("El puerto debe estar entre 1024 y 65535.")
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
