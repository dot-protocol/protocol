"""
DOT Protocol — The Universal Container for Observed Truth
Version: 1.0
"""

from .crypto import generate_keypair, KeyPair
from .container import create, open, verify, chain, rotate

__all__ = ["generate_keypair", "KeyPair", "create", "open", "verify", "chain", "rotate"]
__version__ = "1.0.0"
