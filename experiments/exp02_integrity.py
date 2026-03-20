"""
Experiment 2: Integrity Prism — thin wrapper around exp2_integrity_prism.py
"""

import sys
import os
import subprocess

result = subprocess.run(
    [sys.executable, "experiments/exp2_integrity_prism.py"],
    cwd=os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."),
)
sys.exit(result.returncode)
